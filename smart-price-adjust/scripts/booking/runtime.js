"use strict";

const { requirePlaywright } = require("../shared/require-playwright");
const {
  normalizeRuntimeTimeout,
  throwBookingError
} = require("./mapper");

function normalizeBookingRuntime(runtime = {}) {
  return {
    connectMode: String(runtime.connectMode || "").trim().toLowerCase(),
    cdpEndpoint: String(runtime.cdpEndpoint || "").trim(),
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
  state.booking.session = await createCdpSession(runtime);
  return state.booking.session;
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
    throwBookingError("CDP_NO_CONTEXT", "runtime_precheck", "CDP connected but no browser context found.");
  }

  const context = contexts[0];
  const pages = context.pages().filter((page) => !page.isClosed());
  const matchedPage = pages.find((page) => isBookingCalendarUrl(safePageUrl(page), runtime.pricePageUrl));
  const page = matchedPage || pages.find((candidate) => /admin\.booking\.com/i.test(safePageUrl(candidate))) || await context.newPage();
  return {
    browser,
    context,
    page,
    disconnectBrowser: true,
    cdpPageReused: Boolean(matchedPage),
    selectedPageInitialUrl: safePageUrl(page)
  };
}

async function cleanupBookingTask(taskState) {
  const state = taskState && taskState.booking;
  if (!state || !state.session) return;
  await cleanupBrowserSession(state.session);
  state.session = null;
}

async function cleanupBrowserSession(session) {
  if (!session) return;
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
  if (current.includes("admin.booking.com") && current.includes("/calendar/")) return true;
  if (current.includes("admin.booking.com") && current.includes("manage/calendar")) return true;
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
  normalizeBookingRuntime,
  getTaskBrowserSession,
  cleanupBookingTask,
  isBookingCalendarUrl,
  safePageUrl
};
