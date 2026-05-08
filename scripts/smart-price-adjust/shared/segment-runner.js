"use strict";

const {
  buildSkippedSegmentResult,
  buildSegmentResult
} = require("./result-envelope");
const { normalizeFailure } = require("./failure-normalizer");
const { log, progress, fail } = require("./logger");

async function runSegments(input, executor, options = {}) {
  const segmentResults = [];
  const taskState = {};
  let stopFailure = null;

  try {
    for (const segment of input.segments) {
      const label = `${platformProgressName(input.platformCode)} 第 ${segment.segmentIndex + 1}/${input.segments.length} 段`;
      if (stopFailure) {
        progress(`${label}：跳过，上一段失败`);
        segmentResults.push(buildSkippedSegmentResult(input.platformCode, segment, stopFailure));
        continue;
      }

      try {
        progress(`${label}：开始`);
        const rawResult = await executor({
          platformCode: input.platformCode,
          segment,
          runtime: input.runtime,
          normalizedInput: input,
          taskState,
          progress: (message) => progress(`${label}：${message}`)
        }, options);
        const segmentResult = buildSegmentResult(input.platformCode, segment, normalizeExecutorResult(rawResult));
        segmentResults.push(segmentResult);
        if (!segmentResult.ok) {
          stopFailure = segmentResult.failure || normalizeFailure({ code: "UNKNOWN_ERROR" });
          fail(`${label}：${stopFailure.stage} - ${stopFailure.message}`);
        } else {
          progress(`${label}：完成`);
        }
      } catch (error) {
        const failure = normalizeFailure(error);
        const failed = buildSegmentResult(input.platformCode, segment, { ok: false, success: false, failure });
        segmentResults.push(failed);
        stopFailure = failure;
        fail(`${label}：${failure.stage} - ${failure.message}`);
      }
    }
  } finally {
    if (executor && typeof executor.cleanupTask === "function") {
      await executor.cleanupTask(taskState, input, options).catch((error) => {
        log("cleanup", `platform=${input.platformCode} cleanup failed: ${error && error.message ? error.message : String(error)}`);
      });
    }
  }

  return segmentResults;
}

function normalizeExecutorResult(rawResult) {
  if (rawResult && typeof rawResult === "object") return rawResult;
  return {
    ok: false,
    success: false,
    submitted: false,
    failure: {
      code: "SYSTEM_ERROR",
      stage: "system",
      message: "Platform executor returned no result."
    },
    diagnostics: {
      executorResultType: rawResult === null ? "null" : typeof rawResult
    }
  };
}

function platformProgressName(platformCode) {
  const code = String(platformCode || "").toLowerCase();
  if (code === "ctrip") return "Ctrip";
  if (code === "trip") return "Trip";
  if (code === "meituan") return "Meituan";
  if (code === "booking") return "Booking";
  return String(platformCode || "");
}

module.exports = {
  runSegments
};
