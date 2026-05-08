"use strict";

/**
 * Electron bgTab 运行时模块
 *
 * 统一封装 Electron bgTab 创建逻辑：
 * 1. 获取 CDP 锁（与爬虫共享 hotel-ai-browser-cdp.lock）
 * 2. connectOverCDP 连接 Electron
 * 3. IPC 文件请求创建隐藏 BrowserView（bgTab）
 * 4. 监听 page 事件找到新页面
 * 5. setViewportSize + applyNotificationPolicy
 * 6. cleanup 时销毁 bgTab + 释放锁
 *
 * 所有平台 executor 共用此模块。
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const { requirePlaywright } = require("./require-playwright");

const TEMP_DIR = os.tmpdir();
const LOCK_FILE = path.join(TEMP_DIR, "hotel-ai-browser-cdp.lock");
const LOCK_TIMEOUT_MS = 5 * 60 * 1000;
const LOCK_KEEPALIVE_MS = 30000;
const CDP_CONNECT_TIMEOUT_MS = 8000;
const CDP_CONNECT_RETRIES = 3;
const BGTAB_RESPONSE_TIMEOUT_MS = 8000;
const BGTAB_PAGE_FIND_TIMEOUT_MS = 5000;

/**
 * 创建 Electron bgTab 会话
 * @param {object} options
 * @param {string} options.cdpEndpoint - CDP 端点（默认 http://127.0.0.1:9222）
 * @param {string} options.sessionId - 会话 ID（用于 bgTab 隔离）
 * @param {string} options.pricePageUrl - 目标页面 URL
 * @param {number} [options.timeoutMs] - 超时时间
 * @returns {{ browser, context, page, cleanup, selectedPageInitialUrl, cdpPageReused }}
 */
async function createElectronBgTabSession(options = {}) {
  const cdpEndpoint = options.cdpEndpoint || "http://127.0.0.1:9222";
  const sessionId = options.sessionId || `price-adjust-${Date.now()}`;
  const pricePageUrl = options.pricePageUrl || "";
  const timeoutMs = options.timeoutMs || 30000;

  // ── Step 1: 获取 CDP 锁 ──
  const lockState = await acquireCdpLock();

  // ── Step 2: CDP 连接 Electron ──
  let browser = null;
  const existingPageUrls = new Set();

  for (let attempt = 1; attempt <= CDP_CONNECT_RETRIES; attempt++) {
    try {
      await pruneBlankCdpTargets(cdpEndpoint);
      const chromium = requirePlaywright().chromium;
      browser = await chromium.connectOverCDP(cdpEndpoint, { timeout: CDP_CONNECT_TIMEOUT_MS });
      break;
    } catch (cdpErr) {
      if (attempt === CDP_CONNECT_RETRIES) {
        releaseCdpLock(lockState);
        const error = new Error(`CDP connect failed after ${CDP_CONNECT_RETRIES} attempts: ${cdpErr.message}`);
        error.code = "CDP_CONNECT_FAILED";
        error.stage = "runtime_precheck";
        throw error;
      }
      // 连接失败 → 可能有残留 bgTab 阻塞，请求清理后重试
      requestDestroyAllBgTabs();
      await sleep(3000);
    }
  }

  // 记录已有页面 URL（用于后续区分新创建的 bgTab）
  for (const ctx of browser.contexts()) {
    for (const p of ctx.pages()) {
      try { existingPageUrls.add(p.url()); } catch (_) {}
    }
  }

  // ── Step 3: IPC 请求 Electron 创建 bgTab ──
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const requestFile = path.join(TEMP_DIR, `hotel-ai-browser-ipc-${requestId}.json`);
  const responseFile = path.join(TEMP_DIR, `hotel-ai-browser-ipc-${requestId}.response.json`);

  // 监听 page 事件（在创建 bgTab 之前设置，确保不漏事件）
  let resolveNewPage;
  const newPagePromise = new Promise((resolve) => { resolveNewPage = resolve; });
  const pageHandlers = [];
  for (const ctx of browser.contexts()) {
    const handler = (page) => { resolveNewPage(page); };
    ctx.on("page", handler);
    pageHandlers.push({ ctx, handler });
  }

  fs.writeFileSync(requestFile, JSON.stringify({
    action: "create_bg_tab",
    requestId,
    url: pricePageUrl,
    sessionId,
    timestamp: Date.now()
  }));

  // 等待 Electron 响应
  const responseStart = Date.now();
  let response = null;
  while (Date.now() - responseStart < BGTAB_RESPONSE_TIMEOUT_MS) {
    await sleep(50);
    if (fs.existsSync(responseFile)) {
      try {
        response = JSON.parse(fs.readFileSync(responseFile, "utf8"));
        try { fs.unlinkSync(responseFile); } catch (_) {}
        break;
      } catch (_) {}
    }
  }

  if (!response) {
    for (const { ctx, handler } of pageHandlers) { ctx.off("page", handler); }
    releaseCdpLock(lockState);
    requestDestroyBgTabsBySession(sessionId);
    const error = new Error("Electron did not respond to create_bg_tab within 8s");
    error.code = "CDP_CONNECT_FAILED";
    error.stage = "runtime_precheck";
    throw error;
  }

  // ── Step 4: 查找 bgTab Page ──
  let page = await Promise.race([
    newPagePromise,
    sleep(BGTAB_PAGE_FIND_TIMEOUT_MS).then(() => null)
  ]);
  for (const { ctx, handler } of pageHandlers) { ctx.off("page", handler); }

  if (!page) {
    // Fallback: domain 匹配搜索
    const targetDomain = pricePageUrl.replace(/^https?:\/\//, "").split("/")[0];
    for (let attempt = 0; attempt < 5; attempt++) {
      const allPages = browser.contexts().flatMap((c) => c.pages());
      const match = allPages.find((p) => {
        try {
          const u = p.url();
          return !existingPageUrls.has(u) && u.includes(targetDomain);
        } catch (_) { return false; }
      });
      if (match) { page = match; break; }
      await sleep(500);
    }
  }

  if (!page) {
    // 兜底：取最新的非已有页面
    const allPages = browser.contexts().flatMap((c) => c.pages())
      .filter((p) => {
        const u = safePageUrl(p);
        return u && u !== "about:blank" && !existingPageUrls.has(u);
      });
    if (allPages.length > 0) page = allPages[allPages.length - 1];
  }

  if (!page) {
    releaseCdpLock(lockState);
    requestDestroyBgTabsBySession(sessionId);
    const error = new Error(`Could not find bgTab page for "${pricePageUrl}"`);
    error.code = "CDP_NO_CONTEXT";
    error.stage = "runtime_precheck";
    throw error;
  }

  // ── Step 5: 配置页面 ──
  try {
    await page.waitForLoadState("domcontentloaded", { timeout: 15000 });
  } catch (_) {}

  try {
    await page.setViewportSize({ width: 1280, height: 800 });
  } catch (_) {
    // fallback: CDP emulation
    try {
      const cdpSession = await page.context().newCDPSession(page);
      await cdpSession.send("Emulation.setDeviceMetricsOverride", {
        width: 1280, height: 800, deviceScaleFactor: 1, mobile: false
      });
      await cdpSession.detach();
    } catch (_) {}
  }

  page.setDefaultTimeout(timeoutMs);

  const context = browser.contexts()[0];
  await applyNotificationPolicy(context, pricePageUrl);

  // 禁用截图（bgTab 模式下无意义）
  page.screenshot = async () => Buffer.alloc(0);

  // ── 构建 cleanup 函数 ──
  const cleanup = () => {
    requestDestroyBgTabsBySession(sessionId);
    releaseCdpLock(lockState);
  };
  process.once("exit", cleanup);

  return {
    browser,
    context,
    page,
    cleanup,
    closeContext: false,
    disconnectBrowser: true,
    closeBrowser: false,
    cdpPageReused: false,
    selectedPageInitialUrl: safePageUrl(page),
    electronBgTabId: response.tabId,
    electronSessionId: sessionId
  };
}

/**
 * 释放 Electron bgTab 会话
 */
async function releaseElectronBgTabSession(session) {
  if (!session) return;
  if (typeof session.cleanup === "function") {
    session.cleanup();
  }
  removeAllListenersSafe(session.page);
  removeAllListenersSafe(session.context);
  removeAllListenersSafe(session.browser);
  if (session.disconnectBrowser && session.browser) {
    try {
      if (typeof session.browser.disconnect === "function") {
        await Promise.resolve(session.browser.disconnect()).catch(() => {});
      }
    } catch (_) {}
  }
}

// ── CDP 锁管理 ──

async function acquireCdpLock() {
  const lockStart = Date.now();
  let lockAcquired = false;

  while (Date.now() - lockStart < LOCK_TIMEOUT_MS) {
    try {
      fs.writeFileSync(LOCK_FILE, String(process.pid), { flag: "wx" });
      lockAcquired = true;
      break;
    } catch (e) {
      if (e.code === "EEXIST") {
        let isStale = false;
        try {
          const lockPid = parseInt(fs.readFileSync(LOCK_FILE, "utf-8").trim(), 10);
          const stat = fs.statSync(LOCK_FILE);
          const ageSeconds = Math.round((Date.now() - stat.mtimeMs) / 1000);
          if (!isNaN(lockPid) && lockPid > 0) {
            try { process.kill(lockPid, 0); }
            catch (killErr) { if (killErr.code === "ESRCH") isStale = true; }
          }
          if (!isStale && ageSeconds > 120) isStale = true;
        } catch (_) {}
        if (isStale) {
          try { fs.unlinkSync(LOCK_FILE); } catch (_) {}
          continue;
        }
        await sleep(1000 + Math.floor(Math.random() * 1000));
        continue;
      }
      throw e;
    }
  }

  if (!lockAcquired) {
    const error = new Error("CDP lock acquisition timed out after 5 minutes");
    error.code = "BROWSER_PROFILE_LOCKED";
    error.stage = "runtime_precheck";
    throw error;
  }

  // 定期刷新锁文件 mtime
  const keepAlive = setInterval(() => {
    try { fs.writeFileSync(LOCK_FILE, String(process.pid)); } catch (_) {}
  }, LOCK_KEEPALIVE_MS);

  return { keepAlive };
}

function releaseCdpLock(lockState) {
  if (lockState && lockState.keepAlive) {
    clearInterval(lockState.keepAlive);
    lockState.keepAlive = null;
  }
  try { fs.unlinkSync(LOCK_FILE); } catch (_) {}
}

// ── IPC 文件通信 ──

async function pruneBlankCdpTargets(cdpEndpoint) {
  try {
    const targets = await fetchCdpJson(cdpEndpoint, "/json/list", 1000);
    const blankTargets = Array.isArray(targets)
      ? targets.filter((target) => {
        const url = String(target && target.url || "").trim();
        return target && target.type === "page" && (!url || url === "about:blank");
      })
      : [];
    if (blankTargets.length === 0) return;

    const version = await fetchCdpJson(cdpEndpoint, "/json/version", 1000);
    const wsUrl = version && version.webSocketDebuggerUrl;
    if (!wsUrl) return;

    for (const target of blankTargets) {
      await sendBrowserCdp(wsUrl, "Target.closeTarget", { targetId: target.id }, 1000).catch(() => {});
    }
    await sleep(300);
  } catch (_) {}
}

function fetchCdpJson(cdpEndpoint, pathname, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const url = new URL(pathname, cdpEndpoint);
    const req = http.get(url, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        if (settled) return;
        settled = true;
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    req.setTimeout(timeoutMs, () => {
      if (settled) return;
      settled = true;
      req.destroy();
      reject(new Error(`CDP HTTP request timed out: ${pathname}`));
    });
  });
}

function sendBrowserCdp(wsUrl, method, params, timeoutMs) {
  return new Promise((resolve, reject) => {
    let WebSocketCtor;
    try {
      WebSocketCtor = require("ws");
    } catch (error) {
      reject(error);
      return;
    }

    let settled = false;
    const ws = new WebSocketCtor(wsUrl);
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { ws.close(); } catch (_) {}
      reject(new Error(`CDP WebSocket request timed out: ${method}`));
    }, timeoutMs);

    ws.on("open", () => {
      ws.send(JSON.stringify({ id: 1, method, params }));
    });
    ws.on("message", (message) => {
      if (settled) return;
      let parsed = null;
      try {
        parsed = JSON.parse(String(message));
      } catch (_) {}
      if (!parsed || parsed.id !== 1) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch (_) {}
      if (parsed.error) reject(new Error(parsed.error.message || JSON.stringify(parsed.error)));
      else resolve(parsed.result);
    });
    ws.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
  });
}

function requestDestroyBgTabsBySession(sessionId) {
  try {
    const reqId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const reqFile = path.join(TEMP_DIR, `hotel-ai-browser-ipc-${reqId}.json`);
    fs.writeFileSync(reqFile, JSON.stringify({
      action: "destroy_bg_tabs_by_session",
      sessionId,
      requestId: reqId,
      timestamp: Date.now()
    }));
  } catch (_) {}
}

function requestDestroyAllBgTabs() {
  try {
    const reqId = `cdp-retry-cleanup-${Date.now()}`;
    const reqFile = path.join(TEMP_DIR, `hotel-ai-browser-ipc-${reqId}.json`);
    fs.writeFileSync(reqFile, JSON.stringify({
      action: "destroy_all_bg_tabs",
      requestId: reqId,
      timestamp: Date.now()
    }));
  } catch (_) {}
}

// ── 辅助函数 ──

async function applyNotificationPolicy(context, targetUrl) {
  if (!context || typeof context.grantPermissions !== "function") return;
  try {
    const origin = new URL(targetUrl).origin;
    await context.grantPermissions([], { origin });
  } catch (_) {}
}

function removeAllListenersSafe(target) {
  try {
    if (target && typeof target.removeAllListeners === "function") {
      target.removeAllListeners();
    }
  } catch (_) {}
}

function safePageUrl(page) {
  try {
    return page && typeof page.url === "function" ? page.url() : "";
  } catch (_) {
    return "";
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  createElectronBgTabSession,
  releaseElectronBgTabSession
};
