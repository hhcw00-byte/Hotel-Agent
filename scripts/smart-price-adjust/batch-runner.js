"use strict";

/**
 * 跨平台批量调价编排
 *
 * 接收 tasks 数组，串行执行每个平台的调价任务。
 * 单个平台失败不影响后续平台。
 */

const { runSmartPriceAdjustV2 } = require("./core");
const { normalizeFailure } = require("./shared/failure-normalizer");
const { log, progress, fail, success } = require("./shared/logger");

/**
 * @param {object} input - { tasks: [...], runtime: {...} }
 * @param {object} options
 * @returns {object} 批量执行结果
 */
async function runBatch(input, options = {}) {
  const tasks = Array.isArray(input.tasks) ? input.tasks : [];
  const sharedRuntime = input.runtime || {};

  if (tasks.length === 0) {
    return buildBatchFailure("INVALID_INPUT", "input_normalize", "tasks must be a non-empty array.");
  }

  const platformResults = [];
  let successCount = 0;
  let failedCount = 0;

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    const platformCode = task && String(task.platformCode || "").trim().toLowerCase();
    const label = `[${i + 1}/${tasks.length}] ${platformDisplayName(platformCode)}`;

    progress(`${label}：开始`);

    try {
      // 合并 runtime：task 级别覆盖全局
      const taskInput = {
        ...task,
        runtime: {
          ...sharedRuntime,
          ...(task.runtime || {})
        }
      };

      const result = await runSmartPriceAdjustV2(taskInput, options);
      platformResults.push(result);

      if (result && result.ok) {
        successCount++;
        progress(`${label}：成功`);
      } else {
        failedCount++;
        const reason = result && result.failureReason ? result.failureReason : "unknown";
        fail(`${label}：失败 - ${reason}`);
      }
    } catch (error) {
      failedCount++;
      const failure = normalizeFailure(error);
      fail(`${label}：异常 - ${failure.message}`);
      platformResults.push({
        ok: false,
        success: false,
        platformCode: platformCode || "",
        summary: { totalSegments: 0, successSegments: 0, failedSegments: 0, skippedSegments: 0, submittedSegments: 0, stopped: true },
        segmentResults: [],
        failure,
        failureReasonCode: failure.code,
        failureReason: failure.message,
        failedStep: failure.stage,
        message: `${platformDisplayName(platformCode)}改价失败：${failure.message}`,
        diagnostics: { version: "v2", executionModel: "batch" }
      });
    }
  }

  const ok = failedCount === 0 && successCount > 0;
  const message = buildBatchMessage(platformResults, successCount, failedCount);

  if (ok) success(message);
  else if (successCount > 0) log("batch", message);
  else fail(message);

  return {
    ok,
    success: ok,
    summary: {
      totalPlatforms: tasks.length,
      successPlatforms: successCount,
      failedPlatforms: failedCount
    },
    platformResults,
    message,
    diagnostics: {
      version: "v2",
      executionModel: "batch_sequential"
    }
  };
}

function buildBatchMessage(results, successCount, failedCount) {
  const successNames = results
    .filter((r) => r && r.ok)
    .map((r) => platformDisplayName(r.platformCode));
  const failedNames = results
    .filter((r) => r && !r.ok)
    .map((r) => platformDisplayName(r.platformCode));

  if (failedCount === 0) {
    return `全部平台改价成功（${successNames.join("、")}）`;
  }
  if (successCount === 0) {
    return `全部平台改价失败（${failedNames.join("、")}）`;
  }
  return `部分平台改价成功：成功 ${successNames.join("、")}，失败 ${failedNames.join("、")}`;
}

function buildBatchFailure(code, stage, message) {
  return {
    ok: false,
    success: false,
    summary: { totalPlatforms: 0, successPlatforms: 0, failedPlatforms: 0 },
    platformResults: [],
    failure: { code, stage, message },
    failureReasonCode: code,
    failureReason: message,
    failedStep: stage,
    message,
    diagnostics: { version: "v2", executionModel: "batch_sequential" }
  };
}

function platformDisplayName(code) {
  const names = { ctrip: "携程", trip: "Trip", meituan: "美团", booking: "Booking" };
  return names[String(code || "").toLowerCase()] || String(code || "");
}

module.exports = {
  runBatch
};
