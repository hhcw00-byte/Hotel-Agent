#!/usr/bin/env node
/**
 * AI-Driven Web Crawler - Main Entry Point
 */

// 🔥 Boot diagnostics — must be first import so it runs before all other requires
import './boot-diag';

import { ConfigLoader } from './config-loader';
import { CrawlerOrchestrator } from './crawler-orchestrator';
import { BrowserController } from './browser-controller';
import { CrawlerParams, ProgressEvent } from './types';
import { formatError } from './error-codes';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  try {
    // 环境诊断日志 — 帮助排查打包后在其他电脑上的问题
    console.error(`[CRAWLER-ENV] Node: ${process.version}, Platform: ${process.platform}-${process.arch}`);
    console.error(`[CRAWLER-ENV] execPath: ${process.execPath}`);
    console.error(`[CRAWLER-ENV] __dirname: ${__dirname}`);
    console.error(`[CRAWLER-ENV] cwd: ${process.cwd()}`);

    // CDP 端口可达性诊断 — 在连接前先用原生 http 测试
    const cdpPort = parseInt(process.env.BROWSER_PORT || '9222', 10);
    try {
      const http = require('http');
      const cdpCheck = await new Promise<string>((resolve, reject) => {
        const req = http.get(`http://127.0.0.1:${cdpPort}/json/version`, (res: any) => {
          let data = '';
          res.on('data', (chunk: string) => { data += chunk; });
          res.on('end', () => resolve(data));
        });
        req.on('error', (err: Error) => reject(err));
        req.setTimeout(3000, () => { req.destroy(); reject(new Error('timeout')); });
      });
      console.error(`[CRAWLER-ENV] CDP port ${cdpPort} reachable: ${cdpCheck.substring(0, 150)}`);
    } catch (cdpErr: any) {
      console.error(`[CRAWLER-ENV] CDP port ${cdpPort} NOT reachable: ${cdpErr.message}`);
    }
    // Parse command line arguments
    const params = parseArgs();

    // DEBUG: 确认爬虫子进程收到的 background 和 startUrl
    console.error(`[CRAWLER-DEBUG] params: background=${params.background}, startUrl=${params.startUrl}, operation=${params.operation}, sessionId=${params.sessionId}`);

    // Load configuration
    const configLoader = new ConfigLoader();
    const config = configLoader.load();

    // Create orchestrator
    const orchestrator = new CrawlerOrchestrator(config);

    // Progress callback
    const progressCallback = (event: ProgressEvent) => {
      const output: any = { type: 'progress', ...(event as any) };
      console.log(JSON.stringify(output));
    };

    // Run crawler
    const result = await orchestrator.run(params, progressCallback);

    // Output result
    console.log(JSON.stringify(result, null, 2));

    // Cleanup
    await orchestrator.cleanup(params.background === true);

    // Exit with appropriate code
    process.exit(result.success ? 0 : 1);

  } catch (error) {
    // 异常路径也要关闭 CDP 连接，避免泄漏
    try { await BrowserController.closeAllConnections(); } catch {}

    // 写 IPC 文件通知 Electron 销毁 bgTab（与 closeBackgroundPage 相同格式）
    try {
      const sessionId = parseArgs().sessionId;
      if (sessionId) {
        const requestId = `crash-cleanup-${Date.now()}`;
        const ipcFile = path.join(os.tmpdir(), `hotel-ai-browser-ipc-${requestId}.json`);
        fs.writeFileSync(ipcFile, JSON.stringify({
          action: 'destroy_bg_tabs_by_session',
          sessionId,
          requestId,
          timestamp: Date.now()
        }));
      }
    } catch {}

    const errorResult = {
      success: false,
      error: formatError('5001', {
        message: error instanceof Error ? error.message : String(error),
      }),
    };

    console.error(JSON.stringify(errorResult, null, 2));
    process.exit(1);
  }
}

function parseArgs(): CrawlerParams {
  // Try to parse JSON from stdin first (for skill execution)
  if (process.argv.length === 3 && !process.argv[2].startsWith('--')) {
    try {
      const jsonInput = JSON.parse(process.argv[2]);

      // 兼容 LLM 可能传来的各种嵌套格式
      // 例如 {params: {url, prompt}, operation} 或标准的 {target, extraction_goal, operation}
      const flat = jsonInput.params || jsonInput.parameters || jsonInput;

      return {
        operation: jsonInput.operation || flat.operation || 'fetch_data',
        browserPort: jsonInput.browser_port || flat.browser_port,
        tabKeyword: jsonInput.tab_keyword || flat.tab_keyword,
        // 标准字段优先，再兼容 url/prompt 字段
        target: jsonInput.target || flat.target || flat.url,
        extractionGoal: jsonInput.extraction_goal || flat.extraction_goal || flat.prompt || flat.goal,
        navigationHint: jsonInput.navigation_hint || flat.navigation_hint || flat.hint,
        maxSteps: jsonInput.max_steps || flat.max_steps,
        maxExpandSteps: jsonInput.max_expand_steps || flat.max_expand_steps,
        startUrl: jsonInput.start_url || flat.start_url,
        background: jsonInput.background ?? flat.background ?? true,
        sessionId: jsonInput.sessionId || flat.sessionId,
        interceptApis: jsonInput.intercept_apis ?? jsonInput.interceptApis ?? flat.intercept_apis ?? flat.interceptApis,
      };
    } catch (error) {
      // Not JSON, continue with CLI parsing
    }
  }

  // Parse CLI arguments
  const args = process.argv.slice(2);
  const params: CrawlerParams = {
    operation: 'fetch_data',
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    switch (arg) {
      case '--operation':
        params.operation = next as 'fetch_data' | 'list_tabs';
        i++;
        break;
      case '--browser-port':
      case '--port':
        params.browserPort = parseInt(next, 10);
        i++;
        break;
      case '--tab-keyword':
      case '--tab':
        params.tabKeyword = next;
        i++;
        break;
      case '--target':
        params.target = next;
        i++;
        break;
      case '--extraction-goal':
      case '--goal':
        params.extractionGoal = next;
        i++;
        break;
      case '--navigation-hint':
      case '--hint':
        params.navigationHint = next;
        i++;
        break;
      case '--max-steps':
        params.maxSteps = parseInt(next, 10);
        i++;
        break;
      case '--max-expand-steps':
      case '--max-expand':
        params.maxExpandSteps = parseInt(next, 10);
        i++;
        break;
      case '--intercept-apis':
        params.interceptApis = true;
        break;
      case '--help':
        printHelp();
        process.exit(0);
    }
  }

  return params;
}

function printHelp() {
  console.log(`
AI-Driven Web Crawler

Usage:
  node dist/index.js [options]
  node dist/index.js '<json>'

Options:
  --operation <type>           Operation type: fetch_data | list_tabs (default: fetch_data)
  --browser-port <number>      Browser debugging port (default: 9222)
  --tab-keyword <keyword>      Tab keyword to switch to
  --target <text>              Target page description
  --extraction-goal <text>     Data extraction goal
  --navigation-hint <text>     Navigation hint
  --max-steps <number>         Max navigation steps (default: 5)
  --max-expand-steps <number>  Max expand steps (default: 3)
  --intercept-apis             Enable API interception mode (capture HTTP API candidates)
  --help                       Show this help message

JSON Input (for skill execution):
  node dist/index.js '{"operation":"fetch_data","target":"reviews","extraction_goal":"Extract all reviews"}'

Examples:
  # List all open tabs
  node dist/index.js --operation list_tabs

  # Navigate and extract data
  node dist/index.js --target "hotel reviews" --extraction-goal "Extract all reviews with ratings"

  # With custom port and hint
  node dist/index.js --browser-port 9223 --target "product page" --navigation-hint "Click on Products menu"
`);
}

// Run main function
main();
