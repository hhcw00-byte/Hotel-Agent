"use strict";

const fs = require("fs");
const { requirePlaywright } = require("../shared/require-playwright");
const { selectRooms } = require("./room-select");
const { selectDateRange } = require("./date-select");
const { fillPrices } = require("./price-fill");
const { submitPriceChanges } = require("./submit");
const {
  attachNativeDialogGuard,
  detachNativeDialogGuard,
  dismissBlockingModals
} = require("./modal-guard");
const {
  buildMeituanFailure,
  buildMeituanSuccess,
  throwMeituanError,
  normalizeRuntimeTimeout
} = require("./mapper");

async function executeMeituanSegment(context, options = {}) {
  const segment = context.segment;
  const report = typeof context.progress === "function" ? context.progress : () => {};

  try {
    const runtime = normalizeMeituanRuntime(context.runtime || {});
    const session = await getTaskBrowserSession(context.taskState, runtime);
    const page = session.page;
    page.setDefaultTimeout(runtime.timeoutMs);
    attachNativeDialogGuard(page, session);

    await enterPricePage(page, runtime);
    await dismissBlockingModals(page);
    report("\u9009\u62e9\u623f\u578b");
    await dismissBlockingModals(page);
    const selectedRooms = await selectRooms(page, segment.roomList);
    const expectedRoomCount = Array.isArray(segment.roomList) ? segment.roomList.length : 0;
    if (!Array.isArray(selectedRooms) || selectedRooms.length !== expectedRoomCount) {
      throwMeituanError("ROOM_NOT_FOUND", "match_room", "Meituan room selection did not match expected room count.", {
        expectedRoomCount,
        selectedRoomCount: Array.isArray(selectedRooms) ? selectedRooms.length : 0
      });
    }
    report("\u623f\u578b\u9009\u62e9\u5b8c\u6210");
    report(`\u9009\u62e9\u65e5\u671f ${segment.startDate} ~ ${segment.endDate}`);
    await dismissBlockingModals(page);
    await selectDateRange(page, {
      startDate: segment.startDate,
      endDate: segment.endDate
    });
    report("\u586b\u5199\u4ef7\u683c");
    await dismissBlockingModals(page);
    const roomResults = await fillPrices(page, segment.roomList, selectedRooms);
    report("\u63d0\u4ea4\u4fdd\u5b58");
    await dismissBlockingModals(page);
    const submitResult = await submitPriceChanges(page, {
      timeoutMs: runtime.submitFeedbackTimeoutMs,
      progress: report,
      filledPrices: roomResults
    });
    report("\u63d0\u4ea4\u6210\u529f");

    return buildMeituanSuccess(segment, {
      roomResults,
      submitResult,
      diagnostics: {
        connectMode: runtime.connectMode,
        pricePageUrl: runtime.pricePageUrl,
        selectedPageInitialUrl: session.selectedPageInitialUrl || "",
        cdpPageReused: Boolean(session.cdpPageReused),
        nativeDialogHandled: Boolean(session.nativeDialogHandled),
        nativeDialogMessages: session.nativeDialogMessages || []
      }
    });
  } catch (error) {
    return buildMeituanFailure(segment, error);
  }
}

async function cleanupMeituanTask(taskState) {
  const state = taskState && taskState.meituan;
  if (!state || !state.session) return;
  await cleanupBrowserSession(state.session);
  state.session = null;
}

async function getTaskBrowserSession(taskState, runtime) {
  const state = taskState || {};
  state.meituan = state.meituan || {};
  if (state.meituan.session && state.meituan.session.page && !state.meituan.session.page.isClosed()) {
    return state.meituan.session;
  }
  if (state.meituan.session) {
    await cleanupBrowserSession(state.meituan.session);
  }
  state.meituan.session = await createBrowserSession(runtime);
  return state.meituan.session;
}

function normalizeMeituanRuntime(runtime = {}) {
  return {
    connectMode: String(runtime.connectMode || "").trim().toLowerCase(),
    cdpEndpoint: String(runtime.cdpEndpoint || "").trim(),
    userDataDir: String(runtime.userDataDir || runtime.automationProfileDir || "").trim(),
    browserChannel: String(runtime.browserChannel || "chrome").trim(),
    pricePageUrl: String(runtime.pricePageUrl || "https://me.meituan.com/ebooking/merchant/product/batch-price").trim(),
    timeoutMs: normalizeRuntimeTimeout(runtime.timeoutMs, 30000, 30000),
    submitFeedbackTimeoutMs: normalizeRuntimeTimeout(runtime.submitFeedbackTimeoutMs, 15000)
  };
}

async function createBrowserSession(runtime) {
  if (runtime.connectMode === "cdp" || runtime.cdpEndpoint) {
    return createCdpSession(runtime, loadChromium());
  }
  if (!runtime.userDataDir) {
    throwMeituanError("INPUT_RUNTIME_PATH_NOT_FOUND", "runtime_precheck", "runtime.userDataDir is required when connectMode is not cdp.");
  }
  if (!fs.existsSync(runtime.userDataDir)) {
    throwMeituanError("INPUT_RUNTIME_PATH_NOT_FOUND", "runtime_precheck", `runtime.userDataDir not found: ${runtime.userDataDir}`);
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
    throwMeituanError(code, "runtime_precheck", message);
  }
}

async function createCdpSession(runtime, chromium) {
  if (!runtime.cdpEndpoint) {
    throwMeituanError("CDP_ENDPOINT_UNAVAILABLE", "runtime_precheck", "runtime.cdpEndpoint is required when connectMode=cdp.");
  }
  let browser;
  try {
    browser = await chromium.connectOverCDP(runtime.cdpEndpoint);
  } catch (error) {
    throwMeituanError("CDP_CONNECT_FAILED", "runtime_precheck", `CDP connect failed: ${error && error.message ? error.message : String(error)}`);
  }

  const contexts = browser.contexts();
  if (!contexts.length) {
    throwMeituanError("CDP_NO_CONTEXT", "runtime_precheck", "CDP connected but no browser context found.");
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
    throwMeituanError(
      "RUNTIME_CHROME_LAUNCH_FAILED",
      "runtime_precheck",
      `Playwright is required for Meituan V2 real submit: ${error && error.message ? error.message : String(error)}`
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
    throwMeituanError("PAGE_LOAD_TIMEOUT", "page_load", `Meituan price page load failed: ${error && error.message ? error.message : String(error)}`);
  }

  const currentUrl = safePageUrl(page);
  if (/login|signin|sign-in/i.test(currentUrl)) {
    throwMeituanError("OTA_LOGIN_REQUIRED", "precheck_login", `Meituan login required: ${currentUrl}`);
  }
  if (!isTargetPricePageUrl(currentUrl, runtime.pricePageUrl)) {
    throwMeituanError("TARGET_PAGE_LEFT", "page_guard", `Meituan target price page was not reached: ${currentUrl}`);
  }
}

async function cleanupBrowserSession(session) {
  if (!session) return;
  detachNativeDialogGuard(session);
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
  if (current.includes("/ebooking/merchant/product/batch-price")) return true;
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
  executeMeituanSegment
};

executeMeituanSegment.cleanupTask = cleanupMeituanTask;
