"use strict";

const checker = require("./checker");
const mapper = require("./result-mapper");
const { FAILURE_REASON_CODES } = require("./failure-codes");

const SKILL_CODE = "ota-login-checker";

async function execute(input, options = {}) {
  if (!isPlainObject(input)) {
    return mapper.buildInvalidInputResult("Input must be a JSON object.", input);
  }

  const rawPlatformCode = pickString(input.platformCode);
  if (!rawPlatformCode) {
    return mapper.buildInvalidInputResult("platformCode is required.", input);
  }

  const platformCode = checker.normalizeOtaCode(rawPlatformCode);
  if (!checker.isSupportedOta(platformCode)) {
    return mapper.buildUnsupportedPlatformResult(platformCode, input);
  }

  try {
    const rawResult = await checker.checkOtaLogin(platformCode, buildCheckOptions(input, options));
    return mapper.mapLoginCheckResult(rawResult, {
      platformCode,
      storeId: input.storeId,
      pageUrl: input.pageUrl
    });
  } catch (error) {
    return mapper.buildLoginCheckErrorResult(error, platformCode, input);
  }
}

function buildCheckOptions(input, options = {}) {
  const runtime = {
    ...(isPlainObject(input.runtime) ? input.runtime : {}),
    ...(isPlainObject(options.runtime) ? options.runtime : {})
  };
  const checkOptions = {
    ...(isPlainObject(options.checkOptions) ? options.checkOptions : {}),
    ...(isPlainObject(options) ? options : {}),
    targetUrl: pickString(input.pageUrl, options.pageUrl),
    pageUrl: pickString(input.pageUrl, options.pageUrl),
    userDataDir: pickString(input.userDataDir, input.profileDir, options.userDataDir, options.profileDir),
    profileDir: pickString(input.profileDir, options.profileDir),
    storageStatePath: pickString(input.storageStatePath, options.storageStatePath),
    timeoutMs: pickNumber(input.timeoutMs, options.timeoutMs),
    runtime
  };

  if (input.headless !== undefined) {
    checkOptions.headless = normalizeBool(input.headless);
  } else if (options.headless !== undefined) {
    checkOptions.headless = normalizeBool(options.headless);
  }
  return checkOptions;
}

function normalizeBool(value) {
  if (typeof value === "boolean") return value;
  const text = String(value || "").trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(text)) return true;
  if (["0", "false", "no", "n", "off"].includes(text)) return false;
  return Boolean(value);
}

function pickNumber() {
  for (let i = 0; i < arguments.length; i += 1) {
    if (arguments[i] === undefined || arguments[i] === null || arguments[i] === "") continue;
    const n = Number(arguments[i]);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function pickString() {
  for (let i = 0; i < arguments.length; i += 1) {
    const text = String(arguments[i] || "").trim();
    if (text) return text;
  }
  return "";
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

const otaLoginCheckerSkill = {
  code: SKILL_CODE,
  name: "OTA Login Checker",
  description: "Reusable OTA login status checker for Ctrip, Meituan, Trip, Booking, and Feizhu.",
  execute
};

module.exports = {
  code: otaLoginCheckerSkill.code,
  name: otaLoginCheckerSkill.name,
  description: otaLoginCheckerSkill.description,
  execute,
  otaLoginCheckerSkill,
  FAILURE_REASON_CODES,
  ...checker,
  ...mapper
};
