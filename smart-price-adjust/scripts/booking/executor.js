"use strict";

const { enterCalendarPage } = require("./page-ready");
const { openBulkEdit, detectReusableBulkEditPanel } = require("./bulk-edit");
const { selectDateRange } = require("./date-select");
const { fillPrice } = require("./price-fill");
const { saveChanges } = require("./save");
const { waitSaveSuccess } = require("./verify-result");
const {
  normalizeBookingRuntime,
  getTaskBrowserSession,
  cleanupBookingTask
} = require("./runtime");
const {
  buildBookingFailure,
  buildBookingSuccess,
  throwBookingError
} = require("./mapper");

async function executeBookingSegment(context) {
  const segment = context.segment;
  const report = typeof context.progress === "function" ? context.progress : () => {};

  try {
    enforceBookingScope(context.normalizedInput, segment);
    const runtime = normalizeBookingRuntime(context.runtime || {});
    const session = await getTaskBrowserSession(context.taskState, runtime);
    const page = session.page;
    page.setDefaultTimeout(runtime.timeoutMs);

    let panel = await detectReusableBulkEditPanel(page);
    if (panel) {
      report("\u590d\u7528 Bulk edit \u9762\u677f");
    } else {
      report("\u9875\u9762\u51c6\u5907");
      await enterCalendarPage(page, runtime);
      panel = await detectReusableBulkEditPanel(page);
      if (panel) {
        report("\u590d\u7528 Bulk edit \u9762\u677f");
      } else {
        report("\u6253\u5f00 Bulk edit");
        panel = await openBulkEdit(page, runtime.timeoutMs);
      }
    }
    report(`\u9009\u62e9\u65e5\u671f ${segment.startDate} ~ ${segment.endDate}`);
    await selectDateRange(page, panel, {
      startDate: segment.startDate,
      endDate: segment.endDate
    });
    report("\u586b\u5199\u4ef7\u683c");
    const roomResults = await fillPrice(page, panel, segment.roomList[0]);
    report("\u63d0\u4ea4\u4fdd\u5b58");
    const saveState = await saveChanges(page, panel, {
      timeoutMs: runtime.submitFeedbackTimeoutMs,
      currentSegmentIndex: segment.segmentIndex,
      targetStartDate: segment.startDate,
      targetEndDate: segment.endDate,
      targetPrice: segment.roomList[0] && segment.roomList[0].price
    });
    const saveResult = await waitSaveSuccess(page, panel, saveState);
    report("\u63d0\u4ea4\u6210\u529f");

    return buildBookingSuccess(segment, {
      roomResults,
      saveResult,
      diagnostics: {
        connectMode: runtime.connectMode,
        pricePageUrl: runtime.pricePageUrl,
        selectedPageInitialUrl: session.selectedPageInitialUrl || "",
        cdpPageReused: Boolean(session.cdpPageReused)
      }
    });
  } catch (error) {
    return buildBookingFailure(segment, error);
  }
}

function enforceBookingScope(input, segment) {
  const roomCount = Array.isArray(segment && segment.roomList) ? segment.roomList.length : 0;
  if (roomCount > 1) {
    throwBookingError(
      "BOOKING_MULTI_ROOM_UNSUPPORTED",
      "platform_capability_check",
      "Booking V2 first version only supports one room.",
      { roomCount }
    );
  }
}

module.exports = {
  executeBookingSegment
};

executeBookingSegment.cleanupTask = cleanupBookingTask;
