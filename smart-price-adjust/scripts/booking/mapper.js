"use strict";

const { normalizeFailure } = require("../shared/failure-normalizer");

function buildBookingSuccess(segment, details = {}) {
  const roomResults = Array.isArray(details.roomResults) ? details.roomResults : [];
  const saveResult = details.saveResult || {};
  return {
    ok: true,
    success: true,
    submitted: true,
    summary: {
      totalRooms: Array.isArray(segment.roomList) ? segment.roomList.length : 0,
      successRooms: roomResults.filter((room) => room.ok || room.success).length,
      failedRooms: 0,
      submitted: true,
      submitClicked: true,
      submitResultType: saveResult.submitResultType || "save_success"
    },
    roomResults,
    diagnostics: {
      executionPlanMode: "booking_v2_cdp_live_save",
      submitFeedbackSource: saveResult.submitFeedbackSource || "",
      submitFeedbackText: saveResult.submitFeedbackText || "",
      pageRecoveryWarning: Boolean(saveResult.pageRecoveryWarning),
      ...(saveResult.diagnostics && typeof saveResult.diagnostics === "object" ? saveResult.diagnostics : {}),
      ...(details.diagnostics || {})
    }
  };
}

function buildBookingFailure(segment, failureInput) {
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
      executionPlanMode: "booking_v2_cdp_live_save",
      ...(failureInput && failureInput.diagnostics && typeof failureInput.diagnostics === "object" ? failureInput.diagnostics : {})
    }
  };
}

function buildBookingRoomSuccess(room, details = {}) {
  return {
    roomName: String(room && room.roomName || ""),
    price: String(room && room.price || ""),
    ok: true,
    success: true,
    matchedRatePlan: details.matchedRatePlan || String(room && room.roomName || ""),
    inputId: details.inputId || ""
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

function throwBookingError(code, stage, message, diagnostics = {}) {
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

function priceMatches(actual, expected) {
  return normalizePrice(actual) === normalizePrice(expected);
}

async function safeText(locator) {
  return locator.textContent({ timeout: 1000 }).catch(() => "");
}

async function isVisible(locator) {
  return locator.isVisible({ timeout: 1000 }).catch(() => false);
}

module.exports = {
  buildBookingSuccess,
  buildBookingFailure,
  buildBookingRoomSuccess,
  throwBookingError,
  normalizeRuntimeTimeout,
  normalizeText,
  compactText,
  normalizePrice,
  priceMatches,
  safeText,
  isVisible
};
