"use strict";

/**
 * smart-price-adjust 桥接入口（SkillExecutor 兼容）
 *
 * 从 process.argv[2] 读取 Agent 传的 JSON 参数，
 * 执行登录预检 → 调价 → stdout 输出 JSON 结果。
 */

const path = require("path");
const fs = require("fs");

// ── 环境准备 ──

// Playwright 装在 ai-web-crawler/node_modules 里，需要加到模块搜索路径
const crawlerNodeModules = path.resolve(__dirname, "..", "ai-web-crawler", "node_modules");
if (!process.env.NODE_PATH || !process.env.NODE_PATH.includes(crawlerNodeModules)) {
  process.env.NODE_PATH = crawlerNodeModules + (process.env.NODE_PATH ? path.delimiter + process.env.NODE_PATH : "");
  require("module").Module._initPaths();
}

// Electron 子进程需要 ELECTRON_RUN_AS_NODE=1 才能当普通 Node.js 用
if (!process.env.ELECTRON_RUN_AS_NODE) {
  process.env.ELECTRON_RUN_AS_NODE = "1";
}

function output(obj) {
  return new Promise((resolve, reject) => {
    process.stdout.write(JSON.stringify(obj) + "\n", (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

(async () => {
  try {
    const rawParams = process.argv[2] || "{}";
    let params;
    try {
      params = JSON.parse(rawParams);
    } catch (e) {
      await output({ success: false, error: { code: "INVALID_PARAMS", message: "Failed to parse JSON params: " + e.message } });
      process.exitCode = 1;
      return;
    }

    // ── 注入 Electron bgTab 运行时配置 ──
    const sessionId = `price-adjust-${Date.now()}`;
    const defaultRuntime = {
      connectMode: "electron-bgtab",
      cdpEndpoint: "http://127.0.0.1:9222",
      sessionId,
      nodeCommand: process.execPath
    };

    // 合并 runtime（用户传入的优先级更高）
    params.runtime = { ...defaultRuntime, ...(params.runtime || {}) };

    // 批量模式下，给每个 task 也注入 runtime
    if (Array.isArray(params.tasks)) {
      for (const task of params.tasks) {
        if (task && typeof task === "object") {
          task.runtime = { ...defaultRuntime, ...(params.runtime || {}), ...(task.runtime || {}) };
        }
      }
    }

    // ── 登录预检 ──
    // 登录检测由主进程的 check_platform_logins 工具负责（共享 Electron session）。
    // 子进程无法访问 Electron session cookies，因此不在此处做登录预检。

    // ── 执行调价 ──
    let result;
    if (Array.isArray(params.tasks)) {
      const { runBatch } = require("./batch-runner");
      result = await runBatch(params);
    } else {
      const { runSmartPriceAdjustV2 } = require("./core");
      result = await runSmartPriceAdjustV2(params);
    }

    // ── 写诊断文件 ──
    try {
      const dataDir = process.env.DATA_DIR || path.resolve(__dirname, "..", "..", "data");
      const diagPath = path.join(dataDir, `smart-price-adjust-diag-${Date.now()}.json`);
      fs.mkdirSync(path.dirname(diagPath), { recursive: true });
      fs.writeFileSync(diagPath, JSON.stringify({ timestamp: new Date().toISOString(), params, result }, null, 2));
      process.stderr.write(`[smart-price-adjust] Diag saved: ${diagPath}\n`);
    } catch (e) {
      process.stderr.write(`[smart-price-adjust] Diag write failed: ${e.message}\n`);
    }

    const succeeded = Boolean(result && (result.ok === true || result.success === true));
    await output({ success: succeeded, data: result });
    // 强制退出：CDP 连接可能导致 Node.js 事件循环不退出
    process.exit(0);
  } catch (e) {
    await output({ success: false, error: { code: "SCRIPT_EXCEPTION", message: e.message } }).catch(() => {});
    process.exit(1);
  }
})();
