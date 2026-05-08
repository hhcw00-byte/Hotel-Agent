"use strict";

const path = require("path");

const PLAYWRIGHT_CANDIDATES = Object.freeze([
  {
    label: "playwright via Node module resolution",
    request: "playwright"
  },
  {
    label: "D:\\demo\\new-smart-price-adjust\\node_modules\\playwright",
    request: path.join("D:\\demo\\new-smart-price-adjust", "node_modules", "playwright")
  },
  {
    label: "D:\\demo\\new-smart-price-adjust\\scripts\\ai-web-crawler\\node_modules\\playwright",
    request: path.join("D:\\demo\\new-smart-price-adjust", "scripts", "ai-web-crawler", "node_modules", "playwright")
  },
  {
    label: "C:\\Users\\15251\\Desktop\\hotel-modules-ota-automation\\node_modules\\playwright",
    request: path.join("C:\\Users\\15251\\Desktop\\hotel-modules-ota-automation", "node_modules", "playwright")
  },
  {
    label: "C:\\Users\\15251\\Desktop\\hotel-modules-ota-automation\\scripts\\ai-web-crawler\\node_modules\\playwright",
    request: path.join("C:\\Users\\15251\\Desktop\\hotel-modules-ota-automation", "scripts", "ai-web-crawler", "node_modules", "playwright")
  }
]);

function requirePlaywright() {
  const attempts = [];
  for (const candidate of PLAYWRIGHT_CANDIDATES) {
    try {
      return require(candidate.request);
    } catch (error) {
      attempts.push({
        path: candidate.label,
        message: error && error.message ? error.message : String(error)
      });
    }
  }

  const error = new Error([
    "Cannot load Playwright. Tried:",
    ...attempts.map((item) => `- ${item.path}: ${item.message}`)
  ].join("\n"));
  error.code = "PLAYWRIGHT_MODULE_NOT_FOUND";
  error.stage = "runtime_precheck";
  error.attempts = attempts;
  throw error;
}

module.exports = {
  requirePlaywright,
  PLAYWRIGHT_CANDIDATES
};
