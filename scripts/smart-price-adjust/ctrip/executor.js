"use strict";

const fs = require("fs");
const { requirePlaywright } = require("../shared/require-playwright");
const { SELECTORS } = require("./selectors");
const { selectRooms } = require("./room-select");
const { selectDateRange } = require("./date-select");
const { fillPrices } = require("./price-fill");
const { submitPriceChanges } = require("./submit");
const {
  buildCtripFailure,
  buildCtripSuccess,
  throwCtripError,
  normalizeRuntimeTimeout
} = require("./mapper");

async function executeCtripSegment(context, options = {}) {
  const segment = context.segment;
  const report = typeof context.progress === "function" ? context.progress : () => {};

  try {
    const runtime = normalizeCtripRuntime(context.runtime || {});
    const session = await getTaskBrowserSession(context.taskState, runtime);
    const page = session.page;
    page.setDefaultTimeout(runtime.timeoutMs);

    await enterPricePage(page, runtime);
    report("选择房型");
    const roomSelectionDiagnostics = {};
    const selectedRooms = await selectRooms(page, segment.roomList, {
      segmentIndex: segment.segmentIndex,
      diagnostics: roomSelectionDiagnostics
    });
    report(`选择日期 ${segment.startDate} ~ ${segment.endDate}`);
    await selectDateRange(page, {
      startDate: segment.startDate,
      endDate: segment.endDate
    });
    await waitForPriceAreaReady(page, runtime.timeoutMs);
    report("填写价格");
    const roomResults = await fillPrices(page, segment.roomList, selectedRooms);
    report("提交保存");
    const submitResult = await submitPriceChanges(page, {
      timeoutMs: runtime.submitFeedbackTimeoutMs,
      progress: report,
      filledPrices: roomResults
    });
    report("提交成功");

    return buildCtripSuccess(segment, {
      roomResults,
      submitResult,
      diagnostics: {
        connectMode: runtime.connectMode,
        pricePageUrl: runtime.pricePageUrl,
        selectedPageInitialUrl: session.selectedPageInitialUrl || "",
        cdpPageReused: Boolean(session.cdpPageReused),
        roomSelection: roomSelectionDiagnostics
      }
    });
  } catch (error) {
    return buildCtripFailure(segment, error);
  }
}

async function cleanupCtripTask(taskState) {
  const state = taskState && taskState.ctrip;
  if (!state || !state.session) return;
  await cleanupBrowserSession(state.session);
  state.session = null;
}

/**
 * 等待"设置价格"区域加载完成。
 * 选完日期后，携程页面会异步请求后端获取当前价格数据并渲染产品行。
 * 必须等待 loading 消失 + 至少一个可编辑的价格输入框出现，才能开始填价。
 */
async function waitForPriceAreaReady(page, timeoutMs) {
  // 快速路径：如果 priceInput 已经可见，直接返回（多段复用同一 page 时常见）
  const quickCheck = page.locator(SELECTORS.priceInput).first();
  if (await quickCheck.isVisible().catch(() => false)) {
    return;
  }

  // 慢路径：等待 loading 消失 + priceInput 出现
  const effectiveTimeout = Math.min(timeoutMs || 15000, 15000);

  // 1. 等待 loading spinner 消失（如果有的话）
  try {
    const loadingLocator = page.locator(SELECTORS.loading).first();
    if (await loadingLocator.isVisible().catch(() => false)) {
      await loadingLocator.waitFor({ state: "hidden", timeout: Math.min(effectiveTimeout, 8000) }).catch(() => {});
    }
  } catch (_) {}

  // 2. 等待至少一个 priceInput 出现且可见
  try {
    await quickCheck.waitFor({ state: "visible", timeout: 5000 });
  } catch (_) {
    // 超时不抛错，让后续 fillPrices 的正常错误处理接管
  }
}

async function getTaskBrowserSession(taskState, runtime) {
  const state = taskState || {};
  state.ctrip = state.ctrip || {};
  if (state.ctrip.session && state.ctrip.session.page && !state.ctrip.session.page.isClosed()) {
    return state.ctrip.session;
  }
  if (state.ctrip.session) {
    await cleanupBrowserSession(state.ctrip.session);
  }
  state.ctrip.session = await createBrowserSession(runtime);
  return state.ctrip.session;
}

function normalizeCtripRuntime(runtime = {}) {
  return {
    connectMode: String(runtime.connectMode || "").trim().toLowerCase(),
    cdpEndpoint: String(runtime.cdpEndpoint || "").trim(),
    sessionId: String(runtime.sessionId || "").trim(),
    userDataDir: String(runtime.userDataDir || runtime.automationProfileDir || "").trim(),
    browserChannel: String(runtime.browserChannel || "chrome").trim(),
    pricePageUrl: String(runtime.pricePageUrl || "https://ebooking.ctrip.com/rateplan/batchPriceSetting").trim(),
    timeoutMs: normalizeRuntimeTimeout(runtime.timeoutMs, 30000, 30000),
    submitFeedbackTimeoutMs: normalizeRuntimeTimeout(runtime.submitFeedbackTimeoutMs, 15000)
  };
}

async function createBrowserSession(runtime) {
  if (runtime.connectMode === "electron-bgtab") {
    const { createElectronBgTabSession } = require("../shared/electron-runtime");
    return createElectronBgTabSession({
      cdpEndpoint: runtime.cdpEndpoint,
      sessionId: runtime.sessionId,
      pricePageUrl: runtime.pricePageUrl,
      timeoutMs: runtime.timeoutMs
    });
  }
  if (!runtime.userDataDir) {
    throwCtripError("INPUT_RUNTIME_PATH_NOT_FOUND", "runtime_precheck", "runtime.userDataDir is required when connectMode is not electron-bgtab.");
  }
  if (!fs.existsSync(runtime.userDataDir)) {
    throwCtripError("INPUT_RUNTIME_PATH_NOT_FOUND", "runtime_precheck", `runtime.userDataDir not found: ${runtime.userDataDir}`);
  }

  const chromium = loadChromium();
  try {
    const context = await chromium.launchPersistentContext(runtime.userDataDir, {
      headless: false,
      channel: runtime.browserChannel,
      args: ["--disable-blink-features=AutomationControlled"]
    });
    const pages = context.pages().filter((page) => !page.isClosed());
    const page = pages[0] || await context.newPage();
    return {
      context,
      page,
      closeContext: true,
      selectedPageInitialUrl: safePageUrl(page)
    };
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    const code = /lock|use|singleton/i.test(message) ? "BROWSER_PROFILE_LOCKED" : "RUNTIME_CHROME_LAUNCH_FAILED";
    throwCtripError(code, "runtime_precheck", message);
  }
}

async function createCdpSession(runtime, chromium) {
  if (!runtime.cdpEndpoint) {
    throwCtripError("CDP_ENDPOINT_UNAVAILABLE", "runtime_precheck", "runtime.cdpEndpoint is required when connectMode=cdp.");
  }
  let browser;
  try {
    browser = await chromium.connectOverCDP(runtime.cdpEndpoint);
  } catch (error) {
    throwCtripError("CDP_CONNECT_FAILED", "runtime_precheck", `CDP connect failed: ${error && error.message ? error.message : String(error)}`);
  }

  const contexts = browser.contexts();
  if (!contexts.length) {
    throwCtripError("CDP_NO_CONTEXT", "runtime_precheck", "CDP connected but no browser context found.");
  }
  const context = contexts[0];
  const pages = context.pages().filter((page) => !page.isClosed());
  const matchedPage = pages.find((page) => isTargetPricePageUrl(safePageUrl(page), runtime.pricePageUrl));
  const page = matchedPage || await context.newPage();
  return {
    browser,
    context,
    page,
    closeContext: false,
    disconnectBrowser: true,
    closeBrowser: false,
    cdpPageReused: Boolean(matchedPage),
    selectedPageInitialUrl: safePageUrl(page)
  };
}

function loadChromium() {
  try {
    return requirePlaywright().chromium;
  } catch (error) {
    throwCtripError(
      "RUNTIME_CHROME_LAUNCH_FAILED",
      "runtime_precheck",
      `Playwright is required for Ctrip V2 real submit: ${error && error.message ? error.message : String(error)}`
    );
  }
}

async function enterPricePage(page, runtime) {
  try {
    if (!isTargetPricePageUrl(safePageUrl(page), runtime.pricePageUrl)) {
      await page.goto(runtime.pricePageUrl, {
        waitUntil: "domcontentloaded",
        timeout: runtime.timeoutMs
      });
    }
    await page.waitForLoadState("networkidle", { timeout: Math.min(runtime.timeoutMs, 15000) }).catch(() => {});
  } catch (error) {
    throwCtripError("PAGE_LOAD_TIMEOUT", "page_load", `Ctrip price page load failed: ${error && error.message ? error.message : String(error)}`);
  }

  const currentUrl = safePageUrl(page);
  if (/login/i.test(currentUrl)) {
    throwCtripError("OTA_LOGIN_REQUIRED", "precheck_login", `Ctrip login required: ${currentUrl}`);
  }
  if (!isTargetPricePageUrl(currentUrl, runtime.pricePageUrl)) {
    throwCtripError("TARGET_PAGE_LEFT", "page_guard", `Ctrip target price page was not reached: ${currentUrl}`);
  }
}

async function cleanupBrowserSession(session) {
  if (!session) return;
  // Electron bgTab 模式有自己的 cleanup
  if (typeof session.cleanup === "function") {
    session.cleanup();
  }
  removeAllListenersSafe(session.page);
  removeAllListenersSafe(session.context);
  removeAllListenersSafe(session.browser);
  if (session.closeContext && session.context) {
    await session.context.close().catch(() => {});
  } else if (session.disconnectBrowser && session.browser) {
    await disconnectBrowserSession(session.browser);
  } else if (session.closeBrowser && session.browser) {
    await session.browser.close().catch(() => {});
  }
}

async function disconnectBrowserSession(browser) {
  if (!browser) return;
  if (typeof browser.disconnect === "function") {
    await Promise.resolve(browser.disconnect()).catch(() => {});
    return;
  }
  await browser.close().catch(() => {});
}

function removeAllListenersSafe(target) {
  try {
    if (target && typeof target.removeAllListeners === "function") {
      target.removeAllListeners();
    }
  } catch (_) {}
}

function isTargetPricePageUrl(currentUrl, targetUrl) {
  const current = String(currentUrl || "").toLowerCase();
  const target = String(targetUrl || "").toLowerCase();
  if (current.includes("batchpricesetting")) return true;
  return Boolean(target && current && current === target);
}

function safePageUrl(page) {
  try {
    return page && typeof page.url === "function" ? page.url() : "";
  } catch (_) {
    return "";
  }
}

module.exports = {
  executeCtripSegment
};

executeCtripSegment.cleanupTask = cleanupCtripTask;
