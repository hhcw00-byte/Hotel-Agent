"use strict";

/**
 * 登录预检模块
 *
 * 在调价执行前检测目标平台的登录状态。
 * 逻辑：
 * 1. 从调价参数中提取需要调价的平台列表
 * 2. 通过 login-checker 模块检测每个平台的登录态
 * 3. 任一平台未登录 → 全部终止，返回结构化错误
 * 4. 全部通过 → 返回 null，继续执行
 *
 * 检测方式：通过 CDP 连接 Electron，打开目标平台后台页面，
 * 检测 URL 是否跳转到登录页。
 */

const path = require("path");
const { log, fail } = require("./shared/logger");

// 各平台后台检测 URL
const PLATFORM_CHECK_URLS = Object.freeze({
  ctrip: "https://ebooking.ctrip.com/rateplan/batchPriceSetting?microJump=true",
  trip: "https://ebooking.trip.com/rateplan/batchPriceSetting",
  meituan: "https://me.meituan.com/ebooking/merchant/product/batch-price",
  booking: "https://admin.booking.com/hotel/hoteladmin/extranet_ng/manage/calendar/index.html"
});

/**
 * 执行登录预检
 * @param {object} params - 调价参数（单平台或批量）
 * @param {object} runtime - 运行时配置（含 cdpEndpoint）
 * @returns {null|object} null=通过，object=失败信息
 */
async function runLoginPrecheck(params, runtime = {}) {
  const platforms = extractPlatforms(params);
  if (platforms.length === 0) return null;

  log("login-precheck", `检测平台登录状态: ${platforms.join(", ")}`);

  let checker;
  try {
    checker = loadLoginChecker();
  } catch (error) {
    // login-checker 模块不可用时跳过预检（降级策略）
    log("login-precheck", `login-checker 模块加载失败，跳过预检: ${error.message}`);
    return null;
  }

  const cdpEndpoint = runtime.cdpEndpoint || "http://127.0.0.1:9222";
  const results = [];

  for (const platformCode of platforms) {
    const checkUrl = PLATFORM_CHECK_URLS[platformCode];
    if (!checkUrl) {
      log("login-precheck", `平台 ${platformCode} 无检测 URL，跳过`);
      continue;
    }

    try {
      const result = await checker.checkOtaLogin(platformCode, {
        targetUrl: checkUrl,
        cdpUrl: cdpEndpoint,
        timeoutMs: 30000,
        settleMs: 1500,
        closeAfterCheck: true
      });

      results.push({
        platformCode,
        loggedIn: Boolean(result && result.loggedIn),
        currentUrl: result && result.currentUrl || "",
        matchedRule: result && result.matchedRule || null
      });

      if (!result || !result.loggedIn) {
        log("login-precheck", `平台 ${platformCode} 未登录`);
      } else {
        log("login-precheck", `平台 ${platformCode} 已登录 ✓`);
      }
    } catch (error) {
      // 检测异常视为未登录
      log("login-precheck", `平台 ${platformCode} 登录检测异常: ${error.message}`);
      results.push({
        platformCode,
        loggedIn: false,
        currentUrl: "",
        error: error.message
      });
    }
  }

  // 判断结果：任一平台未登录 → 全部终止
  const failedPlatforms = results.filter((r) => !r.loggedIn);
  if (failedPlatforms.length === 0) {
    log("login-precheck", "所有平台登录检测通过");
    return null;
  }

  const failedNames = failedPlatforms.map((r) => platformDisplayName(r.platformCode));
  const message = `登录前置检测未通过：${failedNames.join("、")} 未登录，请先完成登录后重新发起调价。`;
  fail(message);

  return {
    code: "OTA_LOGIN_REQUIRED",
    stage: "precheck_login",
    message,
    retryable: true,
    diagnostics: {
      checkedPlatforms: platforms,
      failedPlatforms: failedPlatforms.map((r) => r.platformCode),
      results
    }
  };
}

/**
 * 从调价参数中提取需要检测的平台列表
 */
function extractPlatforms(params) {
  if (!params || typeof params !== "object") return [];

  // 批量模式：tasks 数组
  if (Array.isArray(params.tasks)) {
    const codes = params.tasks
      .map((t) => t && String(t.platformCode || "").trim().toLowerCase())
      .filter(Boolean);
    return Array.from(new Set(codes));
  }

  // 单平台模式
  const code = String(params.platformCode || "").trim().toLowerCase();
  if (code) return [code];

  return [];
}

function platformDisplayName(code) {
  const names = { ctrip: "携程", trip: "Trip", meituan: "美团", booking: "Booking" };
  return names[code] || code;
}

function loadLoginChecker() {
  // login-checker 位于项目根目录的 login-checker/scripts/
  const candidates = [
    path.resolve(__dirname, "../../login-checker/scripts"),
    path.resolve(__dirname, "../../../login-checker/scripts")
  ];
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch (_) {}
  }
  throw new Error("login-checker module not found");
}

module.exports = {
  runLoginPrecheck,
  extractPlatforms,
  PLATFORM_CHECK_URLS
};
