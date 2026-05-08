"use strict";

const { selectors } = require("./selectors");
const { isVisible, throwBookingError } = require("./mapper");
const {
  collectBookingPageState,
  isBookingCalendarUrl,
  safePageUrl
} = require("./runtime");

async function ensureBookingCalendarPage(page, runtime) {
  try {
    if (!isBookingCalendarUrl(safePageUrl(page), runtime.pricePageUrl)) {
      await page.goto(runtime.pricePageUrl, {
        waitUntil: "domcontentloaded",
        timeout: runtime.timeoutMs
      });
    }
    await page.waitForLoadState("networkidle", { timeout: Math.min(runtime.timeoutMs, 8000) }).catch(() => {});
  } catch (error) {
    throwBookingError("PAGE_LOAD_TIMEOUT", "page_load", `Booking calendar page load failed: ${error && error.message ? error.message : String(error)}`);
  }

  let state = await collectBookingPageState(page);
  if (state.isBadRequestPage) {
    throwBookingError("BOOKING_BAD_REQUEST_PAGE", "page_load", `Booking calendar page returned 400 Bad Request: ${state.selectedPageUrl}`, {
      cdpEndpoint: runtime.cdpEndpoint || "",
      runtimePricePageUrl: runtime.pricePageUrl || "",
      ...state,
      failedStep: "page_ready_bad_request"
    });
  }

  const currentUrl = safePageUrl(page);
  if (/login|sign-in|signin|auth/i.test(currentUrl)) {
    throwBookingError("OTA_LOGIN_REQUIRED", "precheck_login", `Booking login required: ${currentUrl}`);
  }
  if (!isBookingCalendarUrl(currentUrl, runtime.pricePageUrl)) {
    throwBookingError("TARGET_PAGE_LEFT", "page_guard", `Booking calendar page was not reached: ${currentUrl}`);
  }

  await waitForPageReady(page, runtime.timeoutMs, runtime);
}

async function waitForPageReady(page, timeoutMs, runtime = {}) {
  const deadline = Date.now() + Math.min(timeoutMs || 30000, 10000);
  while (Date.now() < deadline) {
    if (await isCalendarRoomReady(page)) return;
    for (const selector of selectors.calendarReady) {
      if (await isVisible(page.locator(selector).first())) return;
    }
    await page.waitForTimeout(250);
  }
  throwBookingError("PAGE_NOT_READY", "page_load", "Booking calendar page was not ready.", {
    cdpEndpoint: runtime.cdpEndpoint || "",
    runtimePricePageUrl: runtime.pricePageUrl || "",
    ...(await collectBookingPageState(page)),
    failedStep: "calendar_ready_timeout"
  });
}

async function isCalendarRoomReady(page) {
  const selectorsToCheck = [
    ...(selectors.roomBlock || []),
    ...(selectors.roomNameRow || []),
    ".av-cal-list-room-name-row",
    ".av-cal-list-room__title",
    "button[data-test-id=\"general-modal-cta\"]"
  ];
  for (const selector of selectorsToCheck) {
    if (await isVisible(page.locator(selector).first())) return true;
  }
  return false;
}

module.exports = {
  ensureBookingCalendarPage,
  enterCalendarPage: ensureBookingCalendarPage
};
