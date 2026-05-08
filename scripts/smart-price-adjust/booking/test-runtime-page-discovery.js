"use strict";

const assert = require("assert");
const {
  buildBookingPageDiscoveryDiagnostics,
  isBookingBadRequestInfo,
  selectBookingCalendarPage,
  stripVolatileUrlParams,
  throwBookingBadRequestPage
} = require("./runtime");

const runtime = {
  cdpEndpoint: "http://127.0.0.1:9555",
  pricePageUrl: "https://admin.booking.com/hotel/hoteladmin/extranet_ng/manage/calendar/index.html?hotel_id=16360740&lang=zh&source=nav&ses=runtime-session"
};

function page(title, url) {
  return { title, url, page: {}, context: {} };
}

function main() {
  testExactUrlSelected();
  testSesIgnoredSameHotelIdSelected();
  testBadRequestError();
  testCalendarPreferredOverOtherAdminPages();
  testNoCalendarDiagnostics();
  console.log("booking runtime page discovery smoke passed");
}

function testExactUrlSelected() {
  const selected = selectBookingCalendarPage([
    page("Home · Booking.com", "https://admin.booking.com/home"),
    page("日历 · Booking.com", runtime.pricePageUrl)
  ], runtime.pricePageUrl);
  assert.ok(selected);
  assert.strictEqual(selected.url, runtime.pricePageUrl);
}

function testSesIgnoredSameHotelIdSelected() {
  const currentUrl = "https://admin.booking.com/hotel/hoteladmin/extranet_ng/manage/calendar/index.html?hotel_id=16360740&lang=zh&source=nav&ses=current-session";
  const selected = selectBookingCalendarPage([
    page("日历 · Booking.com", currentUrl)
  ], runtime.pricePageUrl);
  assert.ok(selected);
  assert.strictEqual(selected.url, currentUrl);
  assert.strictEqual(stripVolatileUrlParams(selected.url), stripVolatileUrlParams(runtime.pricePageUrl));
}

function testBadRequestError() {
  const selected = page("400 Bad Request", runtime.pricePageUrl);
  assert.strictEqual(isBookingBadRequestInfo({ title: selected.title, url: selected.url, bodyText: "400 Bad Request" }), true);
  let error = null;
  try {
    throwBookingBadRequestPage(runtime, [selected], selected, {
      selectedPageUrl: selected.url,
      selectedPageTitle: selected.title,
      isBadRequestPage: true,
      bodyTextSample: "400 Bad Request"
    }, "selected_calendar_page_bad_request");
  } catch (caught) {
    error = caught;
  }
  assert.ok(error);
  assert.strictEqual(error.code, "BOOKING_BAD_REQUEST_PAGE");
  assert.strictEqual(error.diagnostics.failedStep, "selected_calendar_page_bad_request");
}

function testCalendarPreferredOverOtherAdminPages() {
  const calendarUrl = "https://admin.booking.com/hotel/hoteladmin/extranet_ng/manage/calendar/index.html?hotel_id=16360740&ses=abc";
  const selected = selectBookingCalendarPage([
    page("Reservations · Booking.com", "https://admin.booking.com/hotel/hoteladmin/extranet_ng/manage/reservations.html?hotel_id=16360740"),
    page("日历 · Booking.com", calendarUrl),
    page("Inbox · Booking.com", "https://admin.booking.com/hotel/hoteladmin/extranet_ng/inbox/index.html")
  ], runtime.pricePageUrl);
  assert.ok(selected);
  assert.strictEqual(selected.url, calendarUrl);
}

function testNoCalendarDiagnostics() {
  const discoveredPages = [
    page("Reservations · Booking.com", "https://admin.booking.com/hotel/hoteladmin/extranet_ng/manage/reservations.html?hotel_id=16360740"),
    page("Inbox · Booking.com", "https://admin.booking.com/hotel/hoteladmin/extranet_ng/inbox/index.html")
  ];
  const selected = selectBookingCalendarPage(discoveredPages, runtime.pricePageUrl);
  assert.strictEqual(selected, null);
  const diagnostics = buildBookingPageDiscoveryDiagnostics(runtime, discoveredPages, null, {}, "calendar_page_not_found");
  assert.strictEqual(diagnostics.failedStep, "calendar_page_not_found");
  assert.strictEqual(diagnostics.cdpEndpoint, runtime.cdpEndpoint);
  assert.strictEqual(diagnostics.discoveredPages.length, 2);
  assert.ok(!String(JSON.stringify(diagnostics)).includes("bgTab"));
}

main();
