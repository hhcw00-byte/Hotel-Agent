"use strict";

const {
  FAILURE_STAGE_BY_CODE,
  DEFAULT_MESSAGE_BY_CODE
} = require("./failure-codes");

const CODE_ALIASES = Object.freeze({
  EXECUTOR_UNHANDLED_EXCEPTION: "SCRIPT_EXCEPTION",
  EXECUTOR_VERIFY_FLOW_FAILED: "SCRIPT_EXCEPTION",
  VERIFY_RESULT_JSON_PARSE_FAILED: "SCRIPT_EXCEPTION",
  INPUT_RUNTIME_CONFIG_MISSING: "INPUT_RUNTIME_PATH_NOT_FOUND",
  RUNTIME_USER_DATA_DIR_NOT_FOUND: "INPUT_RUNTIME_PATH_NOT_FOUND",
  CDP_TARGET_PAGE_NOT_FOUND: "CDP_CONNECT_FAILED",
  SUBMIT_NOT_ENABLED: "SUBMIT_DISABLED",
  SUBMIT_CONFIRM_REQUIRED: "BLOCKING_MODAL_FOUND",
  SUBMIT_RISK_CONTROL: "SUBMIT_FAILED",
  SUBMIT_SYSTEM_ERROR: "SUBMIT_FAILED",
  LOGIN_REQUIRED: "OTA_LOGIN_REQUIRED",
  LOGIN_REDIRECTED: "OTA_LOGIN_REQUIRED",
  ROOM_MATCH_NOT_CONFIRMED: "ROOM_NOT_FOUND",
  ROOM_TYPE_NOT_MATCHED: "ROOM_NOT_FOUND",
  PRICE_READBACK_NOT_CONFIRMED: "PRICE_ECHO_NOT_MATCHED",
  SUBMIT_RESULT_UNKNOWN: "POST_SUBMIT_VERIFY_FAILED",
  unknown_error: "UNKNOWN_ERROR"
});

function normalizeFailure(rawFailure = {}) {
  const raw = rawFailure && typeof rawFailure === "object" ? rawFailure : { message: String(rawFailure || "") };
  const rawCode = stringValue(
    raw.code,
    raw.failureReasonCode,
    raw.failureCode,
    raw.failure && raw.failure.code,
    "UNKNOWN_ERROR"
  );
  const code = normalizeFailureCode(rawCode, raw.message || raw.failureMessage || "");
  return {
    code,
    stage: stringValue(raw.stage, raw.failedStep, raw.failure && raw.failure.stage, FAILURE_STAGE_BY_CODE[code], "system"),
    message: stringValue(raw.message, raw.failureMessage, raw.failureReason, raw.failure && raw.failure.message, DEFAULT_MESSAGE_BY_CODE[code], DEFAULT_MESSAGE_BY_CODE.UNKNOWN_ERROR)
  };
}

function normalizeFailureCode(rawCode, message = "") {
  const direct = stringValue(rawCode, "UNKNOWN_ERROR");
  if (CODE_ALIASES[direct]) return CODE_ALIASES[direct];
  const upper = direct.toUpperCase();
  if (CODE_ALIASES[upper]) return CODE_ALIASES[upper];
  if (FAILURE_STAGE_BY_CODE[upper]) return upper;
  const text = `${direct} ${message || ""}`;
  if (/profile.*(lock|use)|singletonlock/i.test(text)) return "BROWSER_PROFILE_LOCKED";
  if (/timeout/i.test(text)) return "TIMEOUT";
  if (/login/i.test(text)) return "OTA_LOGIN_REQUIRED";
  return upper || "UNKNOWN_ERROR";
}

function stringValue(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return "";
}

module.exports = {
  normalizeFailure,
  normalizeFailureCode
};
