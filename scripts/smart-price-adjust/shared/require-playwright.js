"use strict";

const path = require("path");

/**
 * 动态加载 Playwright 模块
 *
 * 搜索顺序：
 * 1. 正常 require（NODE_PATH 已由 index.js 注入 ai-web-crawler/node_modules）
 * 2. 相对路径 ai-web-crawler/node_modules/playwright
 * 3. 项目根目录 node_modules/playwright
 */
const PLAYWRIGHT_CANDIDATES = [
  {
    label: "playwright via Node module resolution",
    request: "playwright"
  },
  {
    label: "ai-web-crawler/node_modules/playwright",
    request: path.resolve(__dirname, "../../ai-web-crawler/node_modules/playwright")
  },
  {
    label: "project root node_modules/playwright",
    request: path.resolve(__dirname, "../../../node_modules/playwright")
  }
];

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
