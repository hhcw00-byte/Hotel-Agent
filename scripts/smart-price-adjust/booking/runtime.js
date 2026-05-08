"use strict";

const { requirePlaywright } = require("../shared/require-playwright");
const { selectors } = require("./selectors");
const {
  normalizeRuntimeTimeout,
  throwBookingError
} = require("./mapper");

function normalizeBookingRuntime(runtime = {}) {
  return {
    connectMode: String(runtime.connectMode || "").trim().toLowerCase(),
    cdpEndpoint: String(runtime.cdpEndpoint || "").trim(),
    sessionId: String(runtime.sessionId || "").trim(),
    pricePageUrl: String(runtime.pricePageUrl || "https://admin.booking.com/hotel/hoteladmin/extranet_ng/manage/calendar/index.html").trim(),
    timeoutMs: normalizeRuntimeTimeout(runtime.timeoutMs, 30000, 30000),
    submitFeedbackTimeoutMs: normalizeRuntimeTimeout(runtime.submitFeedbackTimeoutMs, 12000)
  };
}

async function getTaskBrowserSession(taskState, runtime) {
  const state = taskState || {};
  state.booking = state.booking || {};
  if (state.booking.session && state.booking.session.page && !state.booking.session.page.isClosed()) {
    return state.booking.session;
  }
  if (state.booking.session) await cleanupBrowserSession(state.booking.session);
  state.booking.session = await createBrowserSession(runtime);
  return state.booking.session;
}

async function createBrowserSession(runtime) {
  if (runtime.cdpEndpoint || runtime.connectMode === "cdp") {
    return createCdpSession(runtime);
  }
  if (runtime.connectMode === "electron-bgtab") {
    const { createElectronBgTabSession } = require("../shared/electron-runtime");
    return createElectronBgTabSession({
      cdpEndpoint: runtime.cdpEndpoint,
      sessionId: runtime.sessionId,
      pricePageUrl: runtime.pricePageUrl,
      timeoutMs: runtime.timeoutMs
    });
  }
  return createCdpSession(runtime);
}

async function createCdpSession(runtime) {
  if (runtime.connectMode !== "cdp" && !runtime.cdpEndpoint) {
    throwBookingError(
      "CDP_CONNECT_FAILED",
      "runtime_precheck",
      "Booking V2 only supports CDP live in this phase."
    );
  }
  if (!runtime.cdpEndpoint) {
    throwBookingError("CDP_ENDPOINT_UNAVAILABLE", "runtime_precheck", "runtime.cdpEndpoint is required for Booking V2.");
  }

  let browser;
  try {
    browser = await requirePlaywright().chromium.connectOverCDP(runtime.cdpEndpoint);
  } catch (error) {
    throwBookingError("CDP_CONNECT_FAILED", "runtime_precheck", `CDP connect failed: ${error && error.message ? error.message : String(error)}`);
  }

  const contexts = browser.contexts();
  if (!contexts.length) {
    throwBookingError("CDP_NO_CONTEXT", "runtime_precheck", "CDP connected but no browser context found.", buildBookingPageDiscoveryDiagnostics(runtime, [], null, {}, "no_context"));
  }

  const discoveredPages = await collectDiscoveredPages(contexts);
  const selected = selectBookingCalendarPage(discoveredPages, runtime.pricePageUrl);
  if (selected) {
    await selected.page.bringToFront().catch(() => {});
    const pageState = await collectBookingPageState(selected.page);
    if (pageState.isBadRequestPage) {
      throwBookingBadRequestPage(runtime, discoveredPages, selected, pageState, "selected_calendar_page_bad_request");
    }
    return {
      browser,
      context: selected.context,
      page: selected.page,
      disconnectBrowser: true,
      cdpPageReused: true,
      selectedPageInitialUrl: selected.url,
      selectedPageTitle: selected.title,
      discoveredPages: sanitizeDiscoveredPages(discoveredPages)
    };
  }

  const context = contexts[0];
  const page = await resolveFallbackPage(context, discoveredPages);
  let response = null;
  try {
    response = await page.goto(runtime.pricePageUrl, {
      waitUntil: "domcontentloaded",
      timeout: runtime.timeoutMs
    });
    await page.waitForLoadState("networkidle", { timeout: Math.min(runtime.timeoutMs, 8000) }).catch(() => {});
  } catch (error) {
    throwBookingError("PAGE_LOAD_TIMEOUT", "runtime_precheck", `Booking calendar page load failed: ${error && error.message ? error.message : String(error)}`, buildBookingPageDiscoveryDiagnostics(runtime, discoveredPages, { page, context }, {}, "fallback_goto_failed"));
  }

  const fallbackInfo = {
    page,
    context,
    title: await safeTitle(page),
    url: safePageUrl(page)
  };
  const pageState = await collectBookingPageState(page);
  if ((response && response.status && response.status() === 400) || pageState.isBadRequestPage) {
    throwBookingBadRequestPage(runtime, discoveredPages, fallbackInfo, pageState, "fallback_goto_bad_request");
  }
  return {
    browser,
    context,
    page,
    disconnectBrowser: true,
    cdpPageReused: false,
    selectedPageInitialUrl: safePageUrl(page),
    selectedPageTitle: fallbackInfo.title,
    discoveredPages: sanitizeDiscoveredPages(discoveredPages)
  };
}

async function resolveFallbackPage(context, discoveredPages) {
  const adminPage = discoveredPages.find((item) => /admin\.booking\.com/i.test(String(item.url || "")));
  if (adminPage && adminPage.page && !adminPage.page.isClosed()) return adminPage.page;
  const pages = context.pages().filter((page) => !page.isClosed());
  return pages[0] || await context.newPage();
}

async function collectDiscoveredPages(contexts) {
  const discovered = [];
  for (const context of contexts) {
    const pages = context.pages().filter((page) => !page.isClosed());
    for (const page of pages) {
      discovered.push({
        context,
        page,
        title: await safeTitle(page),
        url: safePageUrl(page)
      });
    }
  }
  return discovered;
}

function selectBookingCalendarPage(discoveredPages, runtimePricePageUrl = "") {
  const hotelIdFromRuntime = extractHotelId(runtimePricePageUrl);
  const runtimeStableUrl = stripVolatileUrlParams(runtimePricePageUrl);
  const candidates = (discoveredPages || [])
    .filter((item) => isBookingCalendarUrl(item.url, runtimePricePageUrl))
    .map((item) => {
      let score = 10;
      if (runtimeStableUrl && stripVolatileUrlParams(item.url) === runtimeStableUrl) score += 100;
      if (hotelIdFromRuntime && extractHotelId(item.url) === hotelIdFromRuntime) score += 60;
      if (/calendar|日历|booking/i.test(String(item.title || ""))) score += 10;
      return { ...item, score };
    })
    .sort((left, right) => right.score - left.score);
  return candidates[0] || null;
}

async function collectBookingPageState(page) {
  const bodyTextSample = await page.locator("body").innerText({ timeout: 500 }).catch(() => "");
  const title = await safeTitle(page);
  return {
    selectedPageUrl: safePageUrl(page),
    selectedPageTitle: title,
    hasCalendarRoomRows: await hasAnyVisible(page, [
      ...(selectors.roomBlock || []),
      ...(selectors.roomNameRow || []),
      ".av-cal-list-room__title"
    ]),
    hasBulkEditButtons: await hasAnyVisible(page, selectors.bulkEditButton || []),
    isBadRequestPage: isBookingBadRequestInfo({ title, url: safePageUrl(page), bodyText: bodyTextSample }),
    bodyTextSample: String(bodyTextSample || "").replace(/\s+/g, " ").trim().slice(0, 500)
  };
}

async function hasAnyVisible(page, selectorList) {
  for (const selector of selectorList) {
    const locator = page.locator(selector).first();
    if (await locator.isVisible({ timeout: 500 }).catch(() => false)) return true;
  }
  return false;
}

function isBookingBadRequestInfo(info = {}) {
  return /400\s+Bad\s+Request/i.test(`${info.title || ""} ${info.url || ""} ${info.bodyText || ""}`);
}

function throwBookingBadRequestPage(runtime, discoveredPages, selectedPageInfo, pageState = {}, failedStep) {
  throwBookingError(
    "BOOKING_BAD_REQUEST_PAGE",
    "runtime_precheck",
    `Booking calendar page returned 400 Bad Request: ${selectedPageInfo && selectedPageInfo.url || ""}`,
    buildBookingPageDiscoveryDiagnostics(runtime, discoveredPages, selectedPageInfo, pageState, failedStep)
  );
}

function buildBookingPageDiscoveryDiagnostics(runtime, discoveredPages, selectedPageInfo = null, pageState = {}, failedStep = "") {
  return {
    cdpEndpoint: runtime && runtime.cdpEndpoint || "",
    runtimePricePageUrl: runtime && runtime.pricePageUrl || "",
    discoveredPages: sanitizeDiscoveredPages(discoveredPages),
    selectedPageUrl: selectedPageInfo && selectedPageInfo.url || pageState.selectedPageUrl || "",
    selectedPageTitle: selectedPageInfo && selectedPageInfo.title || pageState.selectedPageTitle || "",
    hotelIdFromRuntime: extractHotelId(runtime && runtime.pricePageUrl),
    hasCalendarRoomRows: Boolean(pageState.hasCalendarRoomRows),
    hasBulkEditButtons: Boolean(pageState.hasBulkEditButtons),
    isBadRequestPage: Boolean(pageState.isBadRequestPage),
    bodyTextSample: pageState.bodyTextSample || "",
    failedStep
  };
}

function sanitizeDiscoveredPages(discoveredPages) {
  return (discoveredPages || []).map((item) => ({
    title: item.title || "",
    url: item.url || ""
  }));
}

async function safeTitle(page) {
  try {
    return page && typeof page.title === "function" ? await page.title() : "";
  } catch (_) {
    return "";
  }
}

async function cleanupBookingTask(taskState) {
  const state = taskState && taskState.booking;
  if (!state || !state.session) return;
  await cleanupBrowserSession(state.session);
  state.session = null;
}

async function cleanupBrowserSession(session) {
  if (!session) return;
  if (typeof session.cleanup === "function") {
    session.cleanup();
  }
  removeAllListenersSafe(session.page);
  removeAllListenersSafe(session.context);
  removeAllListenersSafe(session.browser);
  if (session.disconnectBrowser && session.browser) {
    await disconnectBrowserSession(session.browser);
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
    if (target && typeof target.removeAllListeners === "function") target.removeAllListeners();
  } catch (_) {}
}

function isBookingCalendarUrl(currentUrl, targetUrl) {
  const current = String(currentUrl || "").toLowerCase();
  const target = String(targetUrl || "").toLowerCase();
  if (current.includes("admin.booking.com") && (current.includes("calendar/index.html") || current.includes("manage/calendar") || current.includes("/calendar/"))) return true;
  return Boolean(target && stripVolatileUrlParams(current) === stripVolatileUrlParams(target));
}

function stripVolatileUrlParams(value) {
  try {
    const url = new URL(String(value || ""));
    url.searchParams.delete("ses");
    return url.toString().toLowerCase();
  } catch (_) {
    return String(value || "").replace(/([?&])ses=[^&]*/i, "$1").toLowerCase();
  }
}

function extractHotelId(value) {
  try {
    return new URL(String(value || "")).searchParams.get("hotel_id") || "";
  } catch (_) {
    const match = /[?&]hotel_id=([^&]+)/i.exec(String(value || ""));
    return match ? decodeURIComponent(match[1]) : "";
  }
}

function safePageUrl(page) {
  try {
    return page && typeof page.url === "function" ? page.url() : "";
  } catch (_) {
    return "";
  }
}

module.exports = {
  normalizeBookingRuntime,
  getTaskBrowserSession,
  cleanupBookingTask,
  isBookingCalendarUrl,
  safePageUrl,
  selectBookingCalendarPage,
  stripVolatileUrlParams,
  extractHotelId,
  isBookingBadRequestInfo,
  buildBookingPageDiscoveryDiagnostics,
  throwBookingBadRequestPage,
  collectBookingPageState
};
