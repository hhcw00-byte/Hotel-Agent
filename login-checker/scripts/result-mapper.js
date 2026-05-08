"use strict";

const { FAILURE_REASON_CODES } = require("./failure-codes");

const LOGIN_STATUS = Object.freeze({
  LOGGED_IN: "logged_in",
  LOGGED_OUT: "logged_out",
  UNKNOWN: "unknown",
  ERROR: "error"
});

function mapLoginCheckResult(rawResult, fallback = {}) {
  const raw = rawResult && typeof rawResult === "object" ? rawResult : {};
  const platformCode = pickString(raw.platformCode, raw.ota, fallback.platformCode, fallback.ota, "");
  const mapped = mapRawState(raw);
  return {
    success: mapped.success,
    platformCode,
    loginStatus: mapped.loginStatus,
    failureReasonCode: mapped.failureReasonCode,
    message: pickString(raw.message, mapped.message),
    evidence: buildEvidence(raw, fallback),
    rawResult
  };
}

function buildInvalidInputResult(message, rawInput) {
  return {
    success: false,
    platformCode: pickString(rawInput && rawInput.platformCode, ""),
    loginStatus: LOGIN_STATUS.ERROR,
    failureReasonCode: FAILURE_REASON_CODES.INVALID_INPUT,
    message: pickString(message, "Invalid OTA login check input."),
    evidence: null,
    rawResult: null
  };
}

function buildUnsupportedPlatformResult(platformCode, rawInput) {
  return {
    success: false,
    platformCode: pickString(platformCode, rawInput && rawInput.platformCode, ""),
    loginStatus: LOGIN_STATUS.ERROR,
    failureReasonCode: FAILURE_REASON_CODES.UNSUPPORTED_PLATFORM,
    message: `Unsupported OTA platform: ${pickString(platformCode, rawInput && rawInput.platformCode, "")}`,
    evidence: null,
    rawResult: null
  };
}

function buildLoginCheckErrorResult(error, platformCode, rawInput) {
  return {
    success: false,
    platformCode: pickString(platformCode, rawInput && rawInput.platformCode, ""),
    loginStatus: LOGIN_STATUS.ERROR,
    failureReasonCode: FAILURE_REASON_CODES.LOGIN_CHECK_ERROR,
    message: error && error.message ? error.message : String(error || "OTA login check failed."),
    evidence: null,
    rawResult: null
  };
}

function mapRawState(raw) {
  if (raw.status === "checked" && raw.loggedIn === true) {
    return {
      success: true,
      loginStatus: LOGIN_STATUS.LOGGED_IN,
      failureReasonCode: FAILURE_REASON_CODES.LOGIN_CHECK_PASSED,
      message: "OTA login check passed."
    };
  }
  if (raw.status === "checked" && raw.loggedIn === false && (raw.needLogin === true || raw.matchedRule)) {
    return {
      success: false,
      loginStatus: LOGIN_STATUS.LOGGED_OUT,
      failureReasonCode: FAILURE_REASON_CODES.OTA_NOT_LOGGED_IN,
      message: "OTA platform is not logged in."
    };
  }
  if (raw.status === "error" && raw.errorCode === "LOGIN_CHECK_UNCONFIRMED") {
    return {
      success: false,
      loginStatus: LOGIN_STATUS.UNKNOWN,
      failureReasonCode: FAILURE_REASON_CODES.LOGIN_CHECK_UNKNOWN,
      message: "OTA login status is unknown."
    };
  }
  if (raw.status === "error") {
    return {
      success: false,
      loginStatus: LOGIN_STATUS.ERROR,
      failureReasonCode: FAILURE_REASON_CODES.LOGIN_CHECK_ERROR,
      message: "OTA login check failed."
    };
  }
  return {
    success: false,
    loginStatus: LOGIN_STATUS.UNKNOWN,
    failureReasonCode: FAILURE_REASON_CODES.LOGIN_CHECK_UNKNOWN,
    message: "OTA login status is unknown."
  };
}

function buildEvidence(raw, fallback = {}) {
  const evidence = raw.evidence && typeof raw.evidence === "object" ? raw.evidence : {};
  return {
    storeId: pickString(fallback.storeId, raw.storeId, ""),
    targetUrl: pickString(raw.targetUrl, fallback.pageUrl, ""),
    currentUrl: pickString(raw.currentUrl, evidence.currentUrl, ""),
    matchedRule: raw.matchedRule || null,
    matchedKeyword: raw.matchedKeyword || null,
    pageTitle: pickString(evidence.pageTitle, ""),
    decision: pickString(evidence.decision, ""),
    matchedLoginMarkers: Array.isArray(evidence.matchedLoginMarkers) ? evidence.matchedLoginMarkers : [],
    matchedBackendMarkers: Array.isArray(evidence.matchedBackendMarkers) ? evidence.matchedBackendMarkers : [],
    checkedAt: pickString(raw.checkedAt, "")
  };
}

function pickString() {
  for (let i = 0; i < arguments.length; i += 1) {
    const text = String(arguments[i] || "").trim();
    if (text) return text;
  }
  return "";
}

module.exports = {
  LOGIN_STATUS,
  buildInvalidInputResult,
  buildLoginCheckErrorResult,
  buildUnsupportedPlatformResult,
  mapLoginCheckResult
};
