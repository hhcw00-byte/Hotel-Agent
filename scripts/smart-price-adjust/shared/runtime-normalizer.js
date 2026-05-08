"use strict";

const { isPlainObject, pickString } = require("./input-normalizer");

const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_PRICE_PAGE_URLS = Object.freeze({
  ctrip: "https://ebooking.ctrip.com/rateplan/batchPriceSetting",
  trip: "https://ebooking.trip.com/rateplan/batchPriceSetting",
  meituan: "https://me.meituan.com/ebooking/merchant/product/batch-price",
  booking: "https://admin.booking.com/hotel/hoteladmin/extranet_ng/manage/calendar/index.html"
});

function normalizeRuntime(platformCode, runtimeInput = {}) {
  const runtime = isPlainObject(runtimeInput) ? runtimeInput : {};
  const userDataDir = pickString(runtime.userDataDir);
  const automationProfileDir = pickString(runtime.automationProfileDir, userDataDir);
  const cdpEndpoint = pickString(runtime.cdpEndpoint);
  const sessionId = pickString(runtime.sessionId);
  return {
    cwd: pickString(runtime.cwd, process.cwd()),
    browserChannel: pickString(runtime.browserChannel, "chrome"),
    userDataDir,
    automationProfileDir,
    pricePageUrl: pickString(runtime.pricePageUrl, DEFAULT_PRICE_PAGE_URLS[platformCode] || ""),
    timeoutMs: normalizeTimeout(runtime.timeoutMs),
    connectMode: normalizeConnectMode(runtime.connectMode, cdpEndpoint),
    cdpEndpoint,
    sessionId,
    nodeCommand: pickString(runtime.nodeCommand, process.execPath || "node"),
    envOverrides: isPlainObject(runtime.envOverrides) ? { ...runtime.envOverrides } : {}
  };
}

function normalizeTimeout(value) {
  const number = Number(value || DEFAULT_TIMEOUT_MS);
  if (!Number.isFinite(number) || number <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.min(Math.floor(number), DEFAULT_TIMEOUT_MS);
}

function normalizeConnectMode(connectMode, cdpEndpoint) {
  const raw = pickString(connectMode).toLowerCase();
  if (raw === "electron-bgtab") return "electron-bgtab";
  // 默认走 electron-bgtab（Electron 环境下唯一支持的模式）
  if (raw === "cdp" || cdpEndpoint) return "electron-bgtab";
  return "electron-bgtab";
}

module.exports = {
  normalizeRuntime
};
