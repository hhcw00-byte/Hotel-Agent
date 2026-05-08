"use strict";

const { ensureBookingCalendarPage } = require("./page-ready");
const { closeAnyBulkEditPanel, openBulkEditForRoom } = require("./bulk-edit");
const { selectDateRange } = require("./date-select");
const { fillPrice } = require("./price-fill");
const { saveChanges, afterSaveRecover } = require("./save");
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

    const room = segment.roomList[0];
    const requestedRoomName = String(room && room.roomName || "").trim();
    const requestedRatePlanName = String(room && (room.ratePlanName || room.ratePlan) || "").trim();

    report("\u9875\u9762\u51c6\u5907");
    await ensureBookingCalendarPage(page, runtime);

    report("\u5173\u95ed\u6b8b\u7559\u9762\u677f");
    await closeAnyBulkEditPanel(page);

    report("\u5b9a\u4f4d\u623f\u578b");
    report("\u6253\u5f00 Bulk edit");
    const bulkEdit = await openBulkEditForRoom(page, requestedRoomName, {
      timeoutMs: runtime.timeoutMs,
      segmentIndex: segment.segmentIndex
    });
    const panel = bulkEdit.panel;

    report("\u9009\u62e9\u65e5\u671f");
    const dateState = await selectDateRange(page, panel, {
      startDate: segment.startDate,
      endDate: segment.endDate,
      segmentIndex: segment.segmentIndex
    });

    report("\u586b\u5199\u4ef7\u683c");
    const roomResults = await fillPrice(page, panel, room, {
      segmentIndex: segment.segmentIndex
    });
    const selectedRatePlanName = roomResults[0] && roomResults[0].matchedRatePlan || "";

    report("\u63d0\u4ea4\u4fdd\u5b58");
    report("\u7b49\u5f85\u6210\u529f\u53cd\u9988");
    const saveResult = await saveChanges(page, panel, {
      timeoutMs: runtime.submitFeedbackTimeoutMs,
      segmentIndex: segment.segmentIndex,
      requestedRoomName,
      matchedRoomName: bulkEdit.matchedRoomName,
      selectedRoomBlockTestId: bulkEdit.diagnostics && bulkEdit.diagnostics.selectedRoomBlockTestId,
      requestedRatePlanName,
      selectedRatePlanName,
      expectedStartDate: segment.startDate,
      expectedEndDate: segment.endDate,
      expectedPrice: room && room.price
    });

    if (saveResult.alreadyApplied) {
      report("\u5df2\u751f\u6548\uff0c\u65e0\u9700\u63d0\u4ea4");
    } else {
      report("\u63d0\u4ea4\u6210\u529f");
    }
    const recover = await afterSaveRecover(page);
    report("\u5b8c\u6210");

    return buildBookingSuccess(segment, {
      roomResults,
      saveResult,
      diagnostics: {
        connectMode: runtime.connectMode,
        pricePageUrl: runtime.pricePageUrl,
        selectedPageInitialUrl: session.selectedPageInitialUrl || "",
        cdpPageReused: Boolean(session.cdpPageReused),
        requestedRoomName,
        requestedRatePlanName,
        matchedRoomName: bulkEdit.matchedRoomName,
        selectedRoomBlockTestId: bulkEdit.diagnostics && bulkEdit.diagnostics.selectedRoomBlockTestId || "",
        selectedRatePlanName,
        expectedStartDate: segment.startDate,
        expectedEndDate: segment.endDate,
        actualDateReadback: dateState.actualDateReadback,
        expectedPrice: String(room && room.price || ""),
        actualPriceValue: saveResult.diagnostics && saveResult.diagnostics.actualPriceValue || "",
        priceEchoMatched: Boolean(saveResult.diagnostics && saveResult.diagnostics.priceEchoMatched),
        saveButtonDisabled: Boolean(saveResult.diagnostics && saveResult.diagnostics.saveButtonDisabled),
        saveButtonText: saveResult.submitButtonText || saveResult.diagnostics && saveResult.diagnostics.saveButtonText || "",
        afterSaveRecover: recover,
        ...(bulkEdit.diagnostics || {}),
        ...(saveResult.diagnostics || {})
      }
    });
  } catch (error) {
    return buildBookingFailure(segment, error);
  }
}

function enforceBookingScope(input, segment) {
  const roomCount = Array.isArray(segment && segment.roomList) ? segment.roomList.length : 0;
  if (roomCount !== 1) {
    throwBookingError(
      "BOOKING_MULTI_ROOM_UNSUPPORTED",
      "platform_capability_check",
      "Booking current flow supports exactly one room per segment.",
      { roomCount, failedStep: "booking_room_scope_check" }
    );
  }
}

module.exports = {
  executeBookingSegment
};

executeBookingSegment.cleanupTask = cleanupBookingTask;
