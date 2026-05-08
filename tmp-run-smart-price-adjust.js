const fs = require("fs");
const path = require("path");

const payloadPath = process.argv[2];
if (!payloadPath) {
  console.error("Usage: node tmp-run-smart-price-adjust.js <payload-json-file>");
  process.exit(1);
}

const absolutePayloadPath = path.resolve(payloadPath);
let payloadText = fs.readFileSync(absolutePayloadPath, "utf8");
payloadText = payloadText.replace(/^\uFEFF/, "");

const payload = JSON.parse(payloadText);

process.argv = [
  process.argv[0],
  path.resolve("scripts/smart-price-adjust/index.js"),
  JSON.stringify(payload)
];

require("./scripts/smart-price-adjust/index.js");
