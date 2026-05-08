"use strict";

const { normalizeFailure } = require("../shared/failure-normalizer");

function buildMeituanSuccess(segment, details = {}) {
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
      executionPlanMode: "meituan_v2_real_submit",
      submitFeedbackSource: submitResult.submitFeedbackSource || "",
      submitFeedbackText: submitResult.submitFeedbackText || "",
      businessResponseMatched: Boolean(submitResult.businessResponseMatched),
      pageRecoveryWarning: Boolean(submitResult.pageRecoveryWarning),
      ...(submitResult.diagnostics && typeof submitResult.diagnostics === "object" ? submitResult.diagnostics : {}),
      ...(details.diagnostics || {})
    }
  };
}

function buildMeituanFailure(segment, failureInput) {
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
      executionPlanMode: "meituan_v2_real_submit",
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

function throwMeituanError(code, stage, message, diagnostics = {}) {
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

function compactText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeName(value) {
  return compactText(value).replace(/\s+/g, "").toLowerCase();
}

function baseName(value) {
  return normalizeName(value)
    .replace(/<[^>]*>/g, "")
    .replace(/\uFF08[^\uFF09]*\uFF09/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .trim();
}

function scoreMatch(candidate, target) {
  if (!target.target) return 0;
  if (candidate.normalized === target.target) return 400;
  if (candidate.base && candidate.base === target.targetBase) return 300;
  if (candidate.normalized.includes(target.target)) return 200;
  if (candidate.base && candidate.base.includes(target.targetBase)) return 100;
  return 0;
}

module.exports = {
  buildMeituanSuccess,
  buildMeituanFailure,
  throwMeituanError,
  normalizeRuntimeTimeout,
  compactText,
  normalizeName,
  baseName,
  scoreMatch
};
