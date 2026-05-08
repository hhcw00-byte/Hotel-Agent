"use strict";

const fs = require("fs");
const { runBookingV2 } = require("./executor");

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = normalizeMode(args.mode || "inspect");
  const inputPath = args.input;
  if (!inputPath) {
    throwCliError("INVALID_CLI_ARGS", "--input <json-file> is required.");
  }
  const input = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  const result = await runBookingV2(input, { mode });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.ok ? 0 : 2;
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--input") {
      parsed.input = argv[index + 1];
      index += 1;
    } else if (item === "--mode") {
      parsed.mode = argv[index + 1];
      index += 1;
    } else if (item === "--help" || item === "-h") {
      parsed.help = true;
    }
  }
  if (parsed.help) {
    process.stdout.write([
      "Usage:",
      "  node host-cli.js --mode inspect --input examples/inspect-formal-roomlist.example.json",
      "  node host-cli.js --mode live --input examples/live-formal-roomlist.example.json",
      "",
      "Warning: --mode live submits real Booking price changes."
    ].join("\n") + "\n");
    process.exit(0);
  }
  return parsed;
}

function normalizeMode(mode) {
  const value = String(mode || "").trim().toLowerCase();
  if (value === "inspect" || value === "live") return value;
  throwCliError("INVALID_CLI_ARGS", "--mode must be inspect or live.");
}

function throwCliError(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

main().catch((error) => {
  const code = error && error.code ? error.code : "SCRIPT_EXCEPTION";
  process.stdout.write(JSON.stringify({
    ok: false,
    success: false,
    platformCode: "booking",
    failure: {
      code,
      stage: code,
      message: error && error.message ? error.message : String(error)
    },
    failureReasonCode: code,
    failedStep: code
  }, null, 2) + "\n");
  process.exitCode = 1;
});
