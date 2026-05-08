"use strict";

const { selectors } = require("./selectors");
const { isVisible, throwBookingError } = require("./mapper");
const { isBookingCalendarUrl, safePageUrl } = require("./runtime");

async function enterCalendarPage(page, runtime) {
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

  const currentUrl = safePageUrl(page);
  if (/login|sign-in|signin|auth/i.test(currentUrl)) {
    throwBookingError("OTA_LOGIN_REQUIRED", "precheck_login", `Booking login required: ${currentUrl}`);
  }
  if (!isBookingCalendarUrl(currentUrl, runtime.pricePageUrl)) {
    throwBookingError("TARGET_PAGE_LEFT", "page_guard", `Booking calendar page was not reached: ${currentUrl}`);
  }

  await waitForPageReady(page, runtime.timeoutMs);
}

async function waitForPageReady(page, timeoutMs) {
  const deadline = Date.now() + Math.min(timeoutMs || 30000, 10000);
  while (Date.now() < deadline) {
    for (const selector of selectors.calendarReady) {
      if (await isVisible(page.locator(selector).first())) return;
    }
    await page.waitForTimeout(250);
  }
  throwBookingError("PAGE_NOT_READY", "page_load", "Booking calendar page was not ready.");
}

module.exports = {
  enterCalendarPage
};
