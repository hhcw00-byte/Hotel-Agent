"use strict";

const fs = require("fs");
const path = require("path");
const { runSmartPriceAdjustV2 } = require("./index");

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      printHelp();
      process.exitCode = 0;
      return;
    }

    const input = await loadInput(args);
    const result = await runSmartPriceAdjustV2(input);
    const output = ensureCliOutputFields(result);
    await writeStdout(`${JSON.stringify(output, null, 2)}\n`);
    exitSoon(output && output.ok ? 0 : 2);
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    const output = ensureCliOutputFields(buildSystemErrorOutput(message));
    await writeStdout(`${JSON.stringify(output, null, 2)}\n`).catch(() => {});
    await writeStderr(`[smart-price-adjust-v2] ${message}\n`).catch(() => {});
    exitSoon(1);
  }
}

function parseArgs(argv) {
  const out = { help: false, inputPath: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || "").trim();
    if (!arg) continue;
    if (arg === "--help" || arg === "-h") {
      out.help = true;
      continue;
    }
    if (arg === "--input") {
      const rawPath = String(argv[index + 1] || "").trim();
      if (!rawPath) throw new Error("Missing --input file path.");
      out.inputPath = path.isAbsolute(rawPath) ? rawPath : path.resolve(process.cwd(), rawPath);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

async function loadInput(args) {
  if (args.inputPath) {
    return parseJson(fs.readFileSync(args.inputPath, "utf8"));
  }
  if (!process.stdin.isTTY) {
    const raw = await readStdin();
    if (String(raw || "").trim()) return parseJson(raw);
  }
  throw new Error("Missing input payload. Provide --input <json-file> or stdin JSON.");
}

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => resolve(chunks.join("")));
    process.stdin.on("error", reject);
    process.stdin.resume();
  });
}

function parseJson(raw) {
  const text = String(raw || "").replace(/^\uFEFF/, "").trim();
  if (!text) throw new Error("Input JSON is empty.");
  return JSON.parse(text);
}

function printHelp() {
  process.stdout.write([
    "smart-price-adjust V2 host CLI",
    "",
    "Usage:",
    "  node V2/scripts/host-cli.js --input <json-file>",
    "  cat payload.json | node V2/scripts/host-cli.js",
    "  node V2/scripts/host-cli.js --help"
  ].join("\n") + "\n");
}

function writeStdout(text) {
  return new Promise((resolve) => process.stdout.write(text, resolve));
}

function writeStderr(text) {
  return new Promise((resolve) => process.stderr.write(text, resolve));
}

function ensureCliOutputFields(result) {
  const out = result && typeof result === "object" ? result : buildSystemErrorOutput("runSmartPriceAdjustV2 returned no result.");
  if (!Object.prototype.hasOwnProperty.call(out, "failureReasonCode")) out.failureReasonCode = null;
  if (!Object.prototype.hasOwnProperty.call(out, "failureReason")) out.failureReason = null;
  if (!Object.prototype.hasOwnProperty.call(out, "failedStep")) out.failedStep = null;
  if (!Object.prototype.hasOwnProperty.call(out, "segmentResults")) out.segmentResults = [];
  if (!Object.prototype.hasOwnProperty.call(out, "summary")) out.summary = {};
  if (!Object.prototype.hasOwnProperty.call(out, "message")) out.message = "";
  return out;
}

function buildSystemErrorOutput(message) {
  const failure = {
    code: "SYSTEM_ERROR",
    stage: "system",
    message: String(message || "System error.")
  };
  return {
    ok: false,
    success: false,
    platformCode: "",
    summary: {
      totalSegments: 0,
      successSegments: 0,
      failedSegments: 0,
      skippedSegments: 0,
      submittedSegments: 0,
      stopped: true
    },
    segmentResults: [],
    failure,
    failureReasonCode: failure.code,
    failureReason: failure.message,
    failedStep: failure.stage,
    message: failure.message,
    diagnostics: {
      version: "v2",
      executionModel: "sequential_stop_on_first_failure"
    }
  };
}

function exitSoon(code) {
  process.exitCode = code;
  setTimeout(() => process.exit(code), 180);
}

main();
