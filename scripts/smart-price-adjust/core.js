"use strict";

const { normalizeInput } = require("./shared/input-normalizer");
const { normalizeRuntime } = require("./shared/runtime-normalizer");
const { getPlatformExecutor } = require("./router");
const { runSegments } = require("./shared/segment-runner");
const {
  buildRunEnvelope,
  buildFailureEnvelope
} = require("./shared/result-envelope");
const { normalizeFailure } = require("./shared/failure-normalizer");
const { success, fail } = require("./shared/logger");

async function runSmartPriceAdjustV2(input, options = {}) {
  let normalized = null;
  try {
    normalized = normalizeInput(input);
    normalized.runtime = normalizeRuntime(normalized.platformCode, normalized.runtime);
    const executor = getPlatformExecutor(normalized.platformCode);
    const segmentResults = await runSegments(normalized, executor, options);
    const envelope = buildRunEnvelope(normalized, segmentResults);
    logFinalMessage(envelope);
    return envelope;
  } catch (error) {
    const failure = normalizeFailure(error);
    const envelope = buildFailureEnvelope(normalized || input || {}, failure);
    logFinalMessage(envelope);
    return envelope;
  }
}

function logFinalMessage(envelope) {
  const message = envelope && envelope.message ? envelope.message : "";
  if (!message) return;
  if (envelope && envelope.ok) success(message);
  else fail(message);
}

module.exports = {
  runSmartPriceAdjustV2
};
