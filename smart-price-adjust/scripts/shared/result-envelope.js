"use strict";

const { normalizeFailure } = require("./failure-normalizer");

function buildRunEnvelope(input, segmentResults) {
  const results = Array.isArray(segmentResults) ? segmentResults : [];
  const totalSegments = results.length;
  const successSegments = results.filter((item) => item.ok).length;
  const skippedSegments = results.filter((item) => item.skipped).length;
  const failedSegments = Math.max(0, totalSegments - successSegments - skippedSegments);
  const submittedSegments = results.filter((item) => item.submitted).length;
  const ok = totalSegments > 0 && successSegments === totalSegments;
  const failure = ok ? null : firstFailure(results);

  const envelope = {
    ok,
    success: ok,
    platformCode: input.platformCode || "",
    summary: {
      totalSegments,
      successSegments,
      failedSegments,
      skippedSegments,
      submittedSegments,
      stopped: Boolean(!ok && failure)
    },
    segmentResults: results,
    failure,
    message: buildEnvelopeMessage(input.platformCode || "", {
      totalSegments,
      successSegments,
      failedSegments,
      skippedSegments
    }, failure, ok),
    diagnostics: {
      version: "v2",
      executionModel: "sequential_stop_on_first_failure"
    }
  };

  if (!ok && failure) {
    envelope.failureReasonCode = failure.code;
    envelope.failureReason = failure.message;
    envelope.failedStep = failure.stage;
  }
  return envelope;
}

function buildFailureEnvelope(input, failureInput) {
  const failure = normalizeFailure(failureInput);
  const platformCode = input && input.platformCode ? String(input.platformCode).toLowerCase() : "";
  return {
    ok: false,
    success: false,
    platformCode,
    summary: {
      totalSegments: 0,
      successSegments: 0,
      failedSegments: 0,
      skippedSegments: 0,
      submittedSegments: 0,
      stopped: true
    },
    segmentResults: [],
    failure,
    failureReasonCode: failure.code,
    failureReason: failure.message,
    failedStep: failure.stage,
    message: buildEnvelopeMessage(platformCode, {
      totalSegments: 0,
      successSegments: 0,
      failedSegments: 1,
      skippedSegments: 0
    }, failure, false),
    diagnostics: {
      version: "v2",
      executionModel: "sequential_stop_on_first_failure"
    }
  };
}

function buildSegmentResult(platformCode, segment, rawResult = {}) {
  const safe = rawResult && typeof rawResult === "object" ? rawResult : {};
  const ok = Boolean(safe.ok || safe.success);
  const failure = ok ? null : normalizeFailure(safe.failure || safe);
  const submitted = Boolean(
    safe.submitted
    || (safe.summary && safe.summary.submitted)
    || (safe.summary && safe.summary.submitClicked)
  );

  return {
    segmentIndex: segment.segmentIndex,
    platformCode,
    startDate: segment.startDate,
    endDate: segment.endDate,
    ok,
    success: ok,
    submitted,
    skipped: false,
    roomResults: normalizeRoomResults(safe.roomResults, segment.roomList, ok, failure),
    failure,
    diagnostics: normalizeDiagnostics(safe),
    rawSummary: safe.summary && typeof safe.summary === "object" ? safe.summary : {}
  };
}

function buildSkippedSegmentResult(platformCode, segment, upstreamFailure) {
  const failure = normalizeFailure({
    code: "SEGMENT_SKIPPED_AFTER_FAILURE",
    stage: "segment_orchestration",
    message: "Segment skipped because an earlier segment failed.",
    cause: upstreamFailure
  });
  return {
    segmentIndex: segment.segmentIndex,
    platformCode,
    startDate: segment.startDate,
    endDate: segment.endDate,
    ok: false,
    success: false,
    submitted: false,
    skipped: true,
    roomResults: normalizeRoomResults([], segment.roomList, false, failure),
    failure,
    diagnostics: {
      upstreamFailure: upstreamFailure || null
    },
    rawSummary: {}
  };
}

function buildNotImplementedResult(platformCode) {
  return {
    ok: false,
    success: false,
    failure: normalizeFailure({
      code: "PLATFORM_NOT_IMPLEMENTED",
      stage: "platform_capability_check",
      message: `${platformCode} V2 executor is not implemented in phase 1.`
    }),
    summary: {
      submitted: false
    },
    roomResults: []
  };
}

function normalizeRoomResults(rawRooms, inputRooms, parentOk, fallbackFailure) {
  if (Array.isArray(rawRooms) && rawRooms.length > 0) {
    return rawRooms.map((room, index) => normalizeRoomResult(room, inputRooms && inputRooms[index], parentOk, fallbackFailure));
  }
  const rooms = Array.isArray(inputRooms) ? inputRooms : [];
  return rooms.map((room) => ({
    roomName: String(room.roomName || ""),
    price: String(room.price || ""),
    ok: Boolean(parentOk),
    failureCode: parentOk ? null : (fallbackFailure && fallbackFailure.code) || "UNKNOWN_ERROR",
    message: parentOk ? null : (fallbackFailure && fallbackFailure.message) || ""
  }));
}

function normalizeRoomResult(rawRoom, inputRoom, parentOk, fallbackFailure) {
  const raw = rawRoom && typeof rawRoom === "object" ? rawRoom : {};
  const ok = Boolean(raw.ok || raw.success);
  return {
    roomName: stringValue(raw.roomName, inputRoom && inputRoom.roomName),
    price: stringValue(raw.price, raw.inputPrice, inputRoom && inputRoom.price),
    ok,
    failureCode: ok ? null : stringValue(raw.failureCode, raw.failureReasonCode, fallbackFailure && fallbackFailure.code, parentOk ? "" : "UNKNOWN_ERROR"),
    message: ok ? null : stringValue(raw.message, raw.failureMessage, fallbackFailure && fallbackFailure.message)
  };
}

function normalizeDiagnostics(raw) {
  const diagnostics = raw && raw.diagnostics && typeof raw.diagnostics === "object" ? raw.diagnostics : {};
  return {
    ...diagnostics,
    invokeStatus: stringValue(raw && raw.invokeStatus),
    businessStatus: stringValue(raw && raw.businessStatus),
    executionPlanMode: stringValue(raw && raw.executionPlanMode)
  };
}

function firstFailure(results) {
  const failed = results.find((item) => item && !item.ok && item.failure);
  return failed ? failed.failure : normalizeFailure({ code: "UNKNOWN_ERROR" });
}

function buildEnvelopeMessage(platformCode, summary, failure, ok) {
  const name = platformName(platformCode);
  const totalSegments = Number(summary && summary.totalSegments || 0);
  const successSegments = Number(summary && summary.successSegments || 0);
  const failedSegments = Number(summary && summary.failedSegments || 0);
  if (ok) {
    return totalSegments > 1 ? `${name}改价成功，共${totalSegments}个日期段` : `${name}改价成功`;
  }
  if (successSegments > 0 && failedSegments > 0) {
    return `${name}改价部分成功，成功${successSegments}段，失败${failedSegments}段`;
  }
  const failedStep = stringValue(failure && failure.stage, "unknown");
  const failureReason = stringValue(failure && failure.message, "unknown");
  return `${name}改价失败，失败步骤：${failedStep}，原因：${failureReason}`;
}

function platformName(platformCode) {
  const code = String(platformCode || "").toLowerCase();
  if (code === "ctrip") return "携程";
  if (code === "trip") return "Trip";
  if (code === "meituan") return "美团";
  if (code === "booking") return "Booking";
  return String(platformCode || "");
}

function stringValue(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return "";
}

module.exports = {
  buildRunEnvelope,
  buildFailureEnvelope,
  buildSegmentResult,
  buildSkippedSegmentResult,
  buildNotImplementedResult
};
