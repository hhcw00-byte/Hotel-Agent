"use strict";

const { normalizeFailure } = require("../shared/failure-normalizer");

function buildCtripSuccess(segment, details = {}) {
  const roomResults = Array.isArray(details.roomResults) ? details.roomResults : [];
  const submitResult = details.submitResult || {};
  return {
    ok: true,
    success: true,
    submitted: true,
    summary: {
      totalRooms: segment.roomList.length,
      successRooms: roomResults.filter((room) => room.success || room.ok).length,
      failedRooms: 0,
      submitted: true,
      submitClicked: true,
      submitResultType: submitResult.submitResultType || "submit_success"
    },
    roomResults,
    diagnostics: {
      executionPlanMode: "ctrip_v2_real_submit",
      submitFeedbackSource: submitResult.submitFeedbackSource || "",
      submitFeedbackConfidence: submitResult.submitFeedbackConfidence || "",
      submitFeedbackText: submitResult.submitFeedbackText || "",
      ...(submitResult.diagnostics && typeof submitResult.diagnostics === "object" ? submitResult.diagnostics : {}),
      ...(details.diagnostics || {})
    }
  };
}

function buildCtripFailure(segment, failureInput) {
  const failure = normalizeFailure(failureInput);
  return {
    ok: false,
    success: false,
    submitted: false,
    failure,
    summary: {
      totalRooms: Array.isArray(segment && segment.roomList) ? segment.roomList.length : 0,
      successRooms: 0,
      failedRooms: Array.isArray(segment && segment.roomList) ? segment.roomList.length : 0,
      submitted: false
    },
    roomResults: buildFailedRoomResults(segment, failure),
    diagnostics: {
      executionPlanMode: "ctrip_v2_real_submit",
      ...(failureInput && failureInput.diagnostics && typeof failureInput.diagnostics === "object" ? failureInput.diagnostics : {})
    }
  };
}

function buildFailedRoomResults(segment, failure) {
  const rooms = Array.isArray(segment && segment.roomList) ? segment.roomList : [];
  return rooms.map((room) => ({
    roomName: String(room && room.roomName || ""),
    price: String(room && room.price || ""),
    ok: false,
    success: false,
    failureCode: failure.code,
    failureReasonCode: failure.code,
    message: failure.message
  }));
}

function throwCtripError(code, stage, message, diagnostics = {}) {
  const error = new Error(message || code);
  error.code = code;
  error.stage = stage;
  error.diagnostics = diagnostics;
  throw error;
}

function normalizeRuntimeTimeout(value, fallback, maxValue) {
  const number = Number(value || fallback || 0);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  const normalized = Math.floor(number);
  return Number.isFinite(maxValue) && maxValue > 0 ? Math.min(normalized, Math.floor(maxValue)) : normalized;
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function compactText(value) {
  return normalizeText(value).replace(/\s+/g, "").toLowerCase();
}

function normalizePrice(value) {
  const text = String(value === undefined || value === null ? "" : value).trim().replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(text)) return "";
  const number = Number(text);
  if (!Number.isFinite(number)) return "";
  return String(number);
}

module.exports = {
  buildCtripSuccess,
  buildCtripFailure,
  throwCtripError,
  normalizeRuntimeTimeout,
  normalizeText,
  compactText,
  normalizePrice
};
