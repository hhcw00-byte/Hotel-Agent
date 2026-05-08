"use strict";

/**
 * login-check — 检测单个 OTA 平台登录状态
 *
 * 用 Electron bgTab + CDP + LoginDetector 检测。
 * 关键：先连 CDP，再创建 bgTab。每次只检测一个平台。
 * 由主进程循环调用，每次传一个平台。
 */

const path = require("path");
const fs = require("fs");
const os = require("os");

const crawlerDist = path.resolve(__dirname, "..", "ai-web-crawler", "dist");
const crawlerNodeModules = path.resolve(__dirname, "..", "ai-web-crawler", "node_modules");
const { chromium } = require(path.join(crawlerNodeModules, "playwright"));
const { LoginDetector } = require(path.join(crawlerDist, "login-detector"));

const tempDir = os.tmpdir();
const LOCK_FILE = path.join(tempDir, "hotel-ai-browser-cdp.lock");

function output(obj) { process.stdout.write(JSON.stringify(obj) + "\n"); }
function log(msg) { console.error(`[login-check] ${msg}`); }

const LOGIN_URL_KEYWORDS = ["/login", "/signin", "/sign-in", "/oauth2/authorize", "/passport", "/sso"];

// ── CDP 锁 ──

async function acquireCdpLock() {
  const timeout = 30000;
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      fs.writeFileSync(LOCK_FILE, String(process.pid), { flag: "wx" });
      return;
    } catch (e) {
      if (e.code === "EEXIST") {
        try {
          const lockPid = parseInt(fs.readFileSync(LOCK_FILE, "utf-8").trim(), 10);
          const stat = fs.statSync(LOCK_FILE);
          let stale = false;
          if (!isNaN(lockPid) && lockPid > 0) {
            try { process.kill(lockPid, 0); } catch (err) { if (err.code === "ESRCH") stale = true; }
          }
          if (!stale && (Date.now() - stat.mtimeMs) > 120000) stale = true;
          if (stale) { try { fs.unlinkSync(LOCK_FILE); } catch (_) {} continue; }
        } catch (_) {}
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }
      throw e;
    }
  }
  throw new Error("CDP lock timeout");
}

function releaseCdpLock() { try { fs.unlinkSync(LOCK_FILE); } catch (_) {} }

// ── bgTab IPC ──

function requestBgTab(url, sessionId) {
  const requestId = `lc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const requestFile = path.join(tempDir, `hotel-ai-browser-ipc-${requestId}.json`);
  const responseFile = path.join(tempDir, `hotel-ai-browser-ipc-${requestId}.response.json`);
  fs.writeFileSync(requestFile, JSON.stringify({
    action: "create_bg_tab", requestId, url, sessionId, timestamp: Date.now()
  }));
  return responseFile;
}

async function waitForResponse(responseFile, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < (timeoutMs || 10000)) {
    await new Promise(r => setTimeout(r, 100));
    if (fs.existsSync(responseFile)) {
      try {
        const resp = JSON.parse(fs.readFileSync(responseFile, "utf8"));
        try { fs.unlinkSync(responseFile); } catch (_) {}
        return resp;
      } catch (_) {}
    }
  }
  throw new Error("bgTab timeout");
}

function destroyBgTab(sessionId) {
  try {
    const reqId = `lc-cleanup-${Date.now()}`;
    fs.writeFileSync(path.join(tempDir, `hotel-ai-browser-ipc-${reqId}.json`), JSON.stringify({
      action: "destroy_bg_tabs_by_session", sessionId, requestId: reqId, timestamp: Date.now()
    }));
  } catch (_) {}
}

// ── 主流程 ──

(async () => {
  try {
    const params = JSON.parse(process.argv[2] || "{}");
    const domain = params.domain || params.cookieDomain;
    const url = params.url;
    const name = params.name || domain;

    if (!domain || !url) {
      output({ success: false, error: "domain and url are required" });
      process.exitCode = 1;
      return;
    }

    const sessionId = `login-check-${Date.now()}`;
    const cdpPort = parseInt(process.env.SMART_PRICE_CDP_PORT || "9222", 10);
    const endpoint = `http://localhost:${cdpPort}`;

    log(`Checking ${name}: url=${url}`);

    // 先清理所有残留 bgTab
    try {
      const cleanId = `lc-preclean-${Date.now()}`;
      fs.writeFileSync(path.join(tempDir, `hotel-ai-browser-ipc-${cleanId}.json`), JSON.stringify({
        action: "destroy_all_bg_tabs", requestId: cleanId, timestamp: Date.now()
      }));
      await new Promise(r => setTimeout(r, 500));
    } catch (_) {}

    await acquireCdpLock();
    const lockKeepAlive = setInterval(() => {
      try { fs.writeFileSync(LOCK_FILE, String(process.pid)); } catch (_) {}
    }, 30000);

    const cleanup = () => {
      clearInterval(lockKeepAlive);
      destroyBgTab(sessionId);
      releaseCdpLock();
    };
    process.once("exit", cleanup);

    let browser = null;
    try {
      // Step 1: 连 CDP（先连再创建 bgTab）
      browser = await chromium.connectOverCDP(endpoint, { timeout: 15000 });
      log("CDP connected");

      // 记录已有 pages
      const existingPages = new Set();
      for (const ctx of browser.contexts()) {
        for (const p of ctx.pages()) existingPages.add(p);
      }

      // 监听新 page
      let resolveNewPage;
      const newPagePromise = new Promise(resolve => { resolveNewPage = resolve; });
      for (const ctx of browser.contexts()) {
        ctx.on("page", (p) => resolveNewPage(p));
      }

      // Step 2: 创建 bgTab
      const responseFile = requestBgTab(url, sessionId);
      await waitForResponse(responseFile, 10000);
      log("bgTab created");

      // Step 3: 找 page
      let page = await Promise.race([
        newPagePromise,
        new Promise(resolve => setTimeout(() => resolve(null), 8000))
      ]);

      if (!page) {
        // fallback: 找新增的 page
        const allPages = browser.contexts().flatMap(c => c.pages());
        page = allPages.find(p => !existingPages.has(p));
      }

      if (!page) {
        throw new Error("Page not found after bgTab creation");
      }

      // Step 4: 等页面加载
      try { await page.waitForLoadState("domcontentloaded", { timeout: 15000 }); } catch (_) {}
      await new Promise(r => setTimeout(r, 3000));

      // 等待可能的重定向稳定
      try { await page.waitForLoadState("load", { timeout: 5000 }); } catch (_) {}

      let finalUrl = "";
      try { finalUrl = page.url() || ""; } catch (_) {}
      // 如果 URL 为空或无效，尝试从所有 page 中找到重定向后的页面
      if (!finalUrl || !finalUrl.startsWith("http")) {
        const allPages = browser.contexts().flatMap(c => c.pages());
        for (const p of allPages) {
          try {
            const u = p.url();
            if (u && u.startsWith("http") && !existingPages.has(p)) {
              finalUrl = u;
              page = p; // 切换到重定向后的 page
              break;
            }
          } catch (_) {}
        }
      }
      log(`${name}: finalUrl=${(finalUrl || "").substring(0, 120)}`);

      // Step 5: 检测
      const detector = new LoginDetector();
      const detection = await detector.detectLogin(page);

      // URL 辅助判断
      const urlIsLogin = finalUrl.startsWith("http") && LOGIN_URL_KEYWORDS.some(kw => finalUrl.toLowerCase().includes(kw));
      // DOM 辅助判断：有密码输入框+登录表单 = 登录页（不依赖 confidence 阈值）
      const domIsLogin = Boolean(detection.indicators && detection.indicators.hasPasswordInput && detection.indicators.hasLoginForm);
      const isLoginPage = detection.isLoginPage || urlIsLogin || domIsLogin;

      log(`${name}: isLoginPage=${isLoginPage}, confidence=${detection.confidence}, urlIsLogin=${urlIsLogin}, domIsLogin=${domIsLogin}`);

      await browser.close();
      browser = null;

      output({
        success: true, domain, url, name,
        isLoggedIn: !isLoginPage,
        confidence: detection.confidence,
        finalUrl,
      });
    } catch (e) {
      log(`Error: ${e.message}`);
      if (browser) { try { await browser.close(); } catch (_) {} }
      output({
        success: true, domain, url, name,
        isLoggedIn: true, confidence: 0, error: e.message,
      });
    } finally {
      cleanup();
    }
  } catch (e) {
    log(`Fatal: ${e.message}`);
    output({ success: false, error: e.message });
    process.exitCode = 1;
  }
})();
