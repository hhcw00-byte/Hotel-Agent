"use strict";

const fs = require("fs");
const path = require("path");
const {
  execute,
  buildInvalidInputResult
} = require("./index");

async function main() {
  try {
    const args = parseCliArgs(process.argv.slice(2));
    if (args.help) {
      printHelp();
      process.exitCode = 0;
      return;
    }

    const input = await loadInputFromCli(args, process.stdin);
    const result = await execute(input);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = result && result.success ? 0 : 2;
  } catch (error) {
    const result = buildInvalidInputResult(error && error.message ? error.message : String(error));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = 1;
  }
}

function parseCliArgs(argv) {
  const out = { help: false, inputPath: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] || "").trim();
    if (!arg) continue;
    if (arg === "--help" || arg === "-h") {
      out.help = true;
      continue;
    }
    if (arg === "--input") {
      const rawPath = String(argv[i + 1] || "").trim();
      if (!rawPath) throw new Error("Missing --input file path.");
      out.inputPath = path.isAbsolute(rawPath) ? rawPath : path.resolve(process.cwd(), rawPath);
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function printHelp() {
  const text = [
    "ota-login-checker host CLI",
    "",
    "Usage:",
    "  node skills/ota-login-checker/scripts/host-cli.js --input <json-file>",
    "  cat payload.json | node skills/ota-login-checker/scripts/host-cli.js",
    "  node skills/ota-login-checker/scripts/host-cli.js --help"
  ].join("\n");
  process.stdout.write(`${text}\n`);
}

async function loadInputFromCli(args, stdin) {
  if (args.inputPath) {
    return parseJsonLenient(fs.readFileSync(args.inputPath, "utf8"));
  }
  if (stdin && !stdin.isTTY) {
    const raw = await readStdin(stdin);
    if (String(raw || "").trim()) return parseJsonLenient(raw);
  }
  throw new Error("Missing input payload. Provide --input <json-file> or stdin JSON.");
}

function readStdin(stdin) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stdin.setEncoding("utf8");
    stdin.on("data", (chunk) => chunks.push(chunk));
    stdin.on("end", () => resolve(chunks.join("")));
    stdin.on("error", reject);
    stdin.resume();
  });
}

function parseJsonLenient(raw) {
  const text = String(raw || "").replace(/^\uFEFF/, "").trim();
  if (!text) throw new Error("Missing input payload.");
  return JSON.parse(text);
}

if (require.main === module) {
  main();
}

module.exports = {
  parseCliArgs,
  loadInputFromCli
};
