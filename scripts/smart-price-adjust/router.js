"use strict";

const { executeCtripSegment } = require("./ctrip");
const { executeTripSegment } = require("./trip");
const { executeMeituanSegment } = require("./meituan");
const { executeBookingSegment } = require("./booking");

function getPlatformExecutor(platformCode) {
  const code = String(platformCode || "").trim().toLowerCase();
  if (code === "ctrip") return executeCtripSegment;
  if (code === "trip") return executeTripSegment;
  if (code === "meituan") return executeMeituanSegment;
  if (code === "booking") return executeBookingSegment;
  const error = new Error(`Unsupported platformCode: ${platformCode || ""}`);
  error.code = "UNSUPPORTED_PLATFORM";
  error.stage = "platform_routing";
  throw error;
}

module.exports = {
  getPlatformExecutor
};
