/**
 * Agent 数据爬取自修复 E2E 测试
 *
 * 全链路测试：
 *   HeartbeatManager.executeTask() → API skill 执行 → 失败 →
 *   executeAgentRecovery() → PiAgentManager LLM tool-calling loop →
 *   load_skill → 诊断 → ai-web-crawler(intercept_apis) → apiCandidates →
 *   LLM 选择 API → file-operations 重写脚本 → 重新执行 → data-store 入库
 *
 * 用法：先启动 Electron 应用（CDP port 9222），然后运行:
 *   node tests/test-agent-self-repair.js [--track=a|b]
 *
 *   --track=a  Agent 直接消息触发（默认）
 *   --track=b  心跳 executeTask 触发
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

// ─── 数据验证辅助 ───

/**
 * 检测数据是否为空壳（如 Trip.com 的 { data: {}, ResponseStatus: {...} }）
 */
function isEmptyDataShell(data) {
  if (!data) return true;
  // 非空字符串是有效数据（如 Booking 返回的 HTML 页面）
  if (typeof data === 'string') return data.length === 0;
  if (typeof data !== 'object') return true;
  const keys = Object.keys(data);
  if (keys.length === 0) return true;
  // 只有 ResponseStatus 没有实际数据
  if (keys.length === 1 && keys[0] === 'ResponseStatus') return true;
  // 嵌套空壳：{ data: {}, ResponseStatus: {...} }
  if (keys.includes('data') && keys.includes('ResponseStatus')) {
    const inner = data.data;
    if (!inner) return true;
    if (Array.isArray(inner) && inner.length === 0) return true;
    if (typeof inner === 'object' && !Array.isArray(inner) && Object.keys(inner).length === 0) return true;
  }
  return false;
}

// ─── 配置 ───

const CDP_PORT = 9222;
const TEMP_DIR = os.tmpdir();
const OVERALL_TIMEOUT_MS = 10 * 60 * 1000;  // 10 分钟
const CDP_EVAL_TIMEOUT_MS = 600 * 1000;       // 10 分钟
const POLL_INTERVAL_MS = 5000;                 // 5 秒轮询

// 解析命令行参数
const args = process.argv.slice(2);
const trackArg = args.find(a => a.startsWith('--track='));
const TRACK = trackArg ? trackArg.split('=')[1].toLowerCase() : 'a';
const taskArg = args.find(a => a.startsWith('--task='));

// 任务配置映射
const TASK_CONFIGS = {
  'api-trip-public':    { taskId: 'api-trip-public',    skill: 'api-trip-public-price' },
  'api-ctrip-public':   { taskId: 'api-ctrip-public',   skill: 'api-ctrip-public-price' },
  'api-booking-public': { taskId: 'api-booking-public', skill: 'api-booking-public-price' },
  'api-ctrip-backend':  { taskId: 'api-ctrip-backend',  skill: 'api-ctrip-backend-price' },
  'api-meituan-backend':{ taskId: 'api-meituan-backend', skill: 'api-meituan-backend-price' },
  'api-meituan-room-status': { taskId: 'api-meituan-room-status', skill: 'api-meituan-realtime-status' },
};

const selectedTask = taskArg ? taskArg.split('=')[1] : 'api-trip-public';
const taskConfig = TASK_CONFIGS[selectedTask];
if (!taskConfig) {
  console.log(`❌ 未知任务: ${selectedTask}`);
  console.log(`可选任务: ${Object.keys(TASK_CONFIGS).join(', ')}`);
  process.exit(1);
}

const TASK_ID = taskConfig.taskId;
const SKILL_NAME = taskConfig.skill;
const SCRIPT_PATH = path.resolve(__dirname, '..', 'scripts', SKILL_NAME, 'index.js');
const SKILL_MD_PATH = path.resolve(__dirname, '..', 'skills', SKILL_NAME, 'SKILL.md');
const BASELINE_SCRIPT_PATH = path.resolve(__dirname, '..', 'release', 'win-unpacked', 'resources', 'scripts', SKILL_NAME, 'index.js');

// ─── 工具函数 ───

function cdpFetch(urlPath) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${CDP_PORT}${urlPath}`, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(data); }
      });
    }).on('error', reject);
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function fileMD5(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return crypto.createHash('md5').update(content).digest('hex');
  } catch {
    return null;
  }
}

function timestamp() {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false });
}

// CDP WebSocket 客户端（复用 test-bgwindow 模式）
function cdpConnect(wsUrl) {
  const WebSocket = require('ws');
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();

    ws.on('open', () => {
      const send = (method, params = {}) => {
        return new Promise((res, rej) => {
          const msgId = ++id;
          pending.set(msgId, { resolve: res, reject: rej });
          ws.send(JSON.stringify({ id: msgId, method, params }));
        });
      };
      resolve({ send, close: () => ws.close() });
    });

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message));
        else p.resolve(msg.result);
      }
    });

    ws.on('error', reject);
  });
}

// 通过 CDP 在渲染进程执行表达式并返回结果
async function cdpEval(cdp, expression, timeout = CDP_EVAL_TIMEOUT_MS) {
  const result = await Promise.race([
    cdp.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    }),
    sleep(timeout).then(() => { throw new Error(`CDP evaluate timeout after ${timeout}ms`); })
  ]);

  if (result.exceptionDetails) {
    const errMsg = result.exceptionDetails.exception?.description
      || result.exceptionDetails.text
      || 'Unknown CDP error';
    throw new Error(`CDP evaluate error: ${errMsg}`);
  }

  return result.result?.value;
}

// ─── 测试框架 ───

let passed = 0;
let warned = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ ${message}`);
    passed++;
  } else {
    console.log(`  ❌ ${message}`);
    failed++;
  }
  return condition;
}

function warn(message) {
  console.log(`  ⚠️  ${message}`);
  warned++;
}

// ─── 主测试流程 ───

async function run() {
  const startTime = Date.now();

  console.log('\n═══════════════════════════════════════════════════');
  console.log('  Agent 自修复全链路 E2E 测试');
  console.log(`  Track: ${TRACK === 'b' ? 'B (heartbeat executeTask)' : 'A (Agent sendMessage)'}`);
  console.log('═══════════════════════════════════════════════════\n');

  // ══════════════════════════════════════════════════
  // Phase 0: 前置检查
  // ══════════════════════════════════════════════════
  console.log('[Phase 0] 前置检查...');

  // 0.1 CDP 可达
  let version;
  try {
    version = await cdpFetch('/json/version');
    assert(!!version.Browser, `CDP 可达: ${version.Browser}`);
  } catch (e) {
    console.log(`  ❌ CDP 不可达 (port ${CDP_PORT})，请先启动 Electron 应用`);
    process.exit(1);
  }

  // 0.2 找到主窗口渲染进程（file:// 协议加载的 index.html）
  const targets = await cdpFetch('/json/list');
  const mainTarget = targets.find(t =>
    t.type === 'page' && t.url.startsWith('file://') && t.url.includes('index.html')
  );

  if (!mainTarget || !mainTarget.webSocketDebuggerUrl) {
    console.log('  ❌ 未找到主窗口渲染进程 CDP target');
    process.exit(1);
  }
  assert(true, `主窗口 target: ${mainTarget.url.substring(0, 80)}`);

  // 0.3 连接 CDP
  const cdp = await cdpConnect(mainTarget.webSocketDebuggerUrl);
  assert(true, 'CDP WebSocket 已连接');

  // 0.4 验证 electronAPI 可用
  const apiCheck = await cdpEval(cdp, `
    JSON.stringify({
      piAgent: typeof window.electronAPI?.piAgent?.sendMessage === 'function',
      heartbeat: typeof window.electronAPI?.heartbeat?.getTasks === 'function',
      executeTask: typeof window.electronAPI?.heartbeat?.executeTask === 'function'
    })
  `, 5000);

  const apis = JSON.parse(apiCheck);
  assert(apis.piAgent, 'electronAPI.piAgent.sendMessage 可用');
  assert(apis.heartbeat, 'electronAPI.heartbeat.getTasks 可用');
  assert(apis.executeTask, 'electronAPI.heartbeat.executeTask 可用');

  // 记录初始 CDP targets
  const initialTargetCount = targets.length;
  console.log(`  初始 CDP targets: ${initialTargetCount}`);

  // 0.5 基线恢复：从 release/ 还原脚本，确保每次运行初始状态一致
  //     --keep-script 时跳过恢复，保留当前脚本状态（用于注入 bug 后测试）
  const keepScript = args.includes('--keep-script');
  if (keepScript) {
    console.log('  ℹ️  --keep-script: 跳过基线恢复，使用当前脚本');
  } else if (fs.existsSync(BASELINE_SCRIPT_PATH)) {
    fs.copyFileSync(BASELINE_SCRIPT_PATH, SCRIPT_PATH);
    console.log('  脚本已从 release/ 恢复到基线版本');
  } else {
    warn('基线脚本不存在: ' + BASELINE_SCRIPT_PATH);
  }

  // ══════════════════════════════════════════════════
  // Phase 1: API Skill 状态快照
  // ══════════════════════════════════════════════════
  console.log('\n[Phase 1] API Skill 状态快照...');

  // 1.1 获取心跳任务列表
  const tasksJson = await cdpEval(cdp, `
    (async () => {
      const tasks = await window.electronAPI.heartbeat.getTasks();
      return JSON.stringify(tasks);
    })()
  `, 10000);

  const tasks = JSON.parse(tasksJson);
  const tripTask = tasks.find(t => t.id === TASK_ID);
  assert(!!tripTask, `找到任务 "${TASK_ID}": skill=${tripTask?.skill}`);

  if (tripTask) {
    console.log(`  任务状态: enabled=${tripTask.enabled}, lastRun=${tripTask.lastRun || 'never'}`);
  }

  // 1.2 脚本文件 MD5 基线
  const baselineMD5 = fileMD5(SCRIPT_PATH);
  if (baselineMD5) {
    console.log(`  脚本 MD5 基线: ${baselineMD5}`);
    console.log(`  脚本路径: ${SCRIPT_PATH}`);
  } else {
    warn(`脚本文件不存在: ${SCRIPT_PATH}`);
  }

  // 1.3 SKILL.MD 基线
  const baselineSkillMD5 = fileMD5(SKILL_MD_PATH);
  if (baselineSkillMD5) {
    console.log(`  SKILL.md MD5 基线: ${baselineSkillMD5}`);
  }

  // 1.4 当前执行中的任务
  const executingJson = await cdpEval(cdp, `
    (async () => {
      const ids = await window.electronAPI.heartbeat.getExecutingTasks();
      return JSON.stringify(ids);
    })()
  `, 5000);

  const executingBefore = JSON.parse(executingJson);
  console.log(`  当前执行中任务: ${executingBefore.length > 0 ? executingBefore.join(', ') : '无'}`);

  // ══════════════════════════════════════════════════
  // Phase 2: 触发全链路自修复
  // ══════════════════════════════════════════════════
  console.log(`\n[Phase 2] 触发自修复 (Track ${TRACK.toUpperCase()})...`);

  // 等待上一轮可能还在执行的 heartbeat 任务完成（避免竞态）
  for (let waitRound = 0; waitRound < 60; waitRound++) {
    try {
      const execJson = await cdpEval(cdp, `
        (async () => JSON.stringify(await window.electronAPI.heartbeat.getExecutingTasks()))()
      `, 5000);
      const executing = JSON.parse(execJson);
      if (executing.length === 0) break;
      if (waitRound === 0) console.log(`  等待上一轮任务完成: ${executing.join(', ')}`);
      await sleep(2000);
    } catch { break; }
  }

  // Track A 需要清空历史对话，避免 LLM 被之前的成功记录误导而直接输出文字回复
  if (TRACK === 'a') {
    try {
      await cdpEval(cdp, `window.electronAPI.piAgent.clearHistory()`, 5000);
      console.log('  已清空 Agent 对话历史');
    } catch (e) {
      warn(`清空对话历史失败: ${e.message}`);
    }
  }

  // 启动进度监控（并行）
  let monitorRunning = true;
  let monitorLogs = [];
  const monitorPromise = (async () => {
    let pollCount = 0;
    while (monitorRunning) {
      await sleep(POLL_INTERVAL_MS);
      if (!monitorRunning) break;
      pollCount++;

      try {
        // 检查执行中任务
        const execJson = await cdpEval(cdp, `
          (async () => {
            const ids = await window.electronAPI.heartbeat.getExecutingTasks();
            return JSON.stringify(ids);
          })()
        `, 5000);
        const executing = JSON.parse(execJson);

        // 检查 CDP targets（bgTab 指标）
        const currentTargets = await cdpFetch('/json/list');
        const newTargetCount = currentTargets.length - initialTargetCount;

        // 检查 IPC 文件（bgTab 创建信号）
        let ipcFiles = [];
        try {
          const tmpFiles = fs.readdirSync(TEMP_DIR);
          ipcFiles = tmpFiles.filter(f => f.startsWith('hotel-ai-browser'));
        } catch {}

        const logLine = `[${timestamp()}] poll #${pollCount}: executing=[${executing.join(',')}], targets=+${newTargetCount}, ipc_files=${ipcFiles.length}`;
        monitorLogs.push(logLine);
        console.log(`  📊 ${logLine}`);
      } catch (e) {
        // 轮询失败不中断（CDP eval 可能因主线程忙超时）
        const logLine = `[${timestamp()}] poll #${pollCount}: error=${e.message}`;
        monitorLogs.push(logLine);
      }
    }
  })();

  // 触发执行
  let agentResponse = null;
  let triggerError = null;

  console.log(`  ⏳ [${timestamp()}] 开始触发，最长等待 ${OVERALL_TIMEOUT_MS / 60000} 分钟...`);

  try {
    if (TRACK === 'b') {
      // Track B: 心跳触发
      const resultJson = await cdpEval(cdp, `
        (async () => {
          try {
            const result = await window.electronAPI.heartbeat.executeTask('${TASK_ID}');
            return JSON.stringify({ success: true, result });
          } catch (e) {
            return JSON.stringify({ success: false, error: e.message || String(e) });
          }
        })()
      `, CDP_EVAL_TIMEOUT_MS);
      agentResponse = JSON.parse(resultJson);
    } else {
      // Track A: Agent 直接消息
      const resultJson = await cdpEval(cdp, `
        (async () => {
          try {
            const response = await window.electronAPI.piAgent.sendMessage(
              '请立即执行 trip.com 公网房价采集任务，使用 api-trip-public-price skill。如果API调用失败，请自动诊断并修复API脚本，然后重新执行。注意：调用 ai-web-crawler 时必须传 background: true 使用静默后台模式，禁止使用显示爬虫。修复完成后必须调用 data-store 入库。'
            );
            return JSON.stringify({ success: true, response });
          } catch (e) {
            return JSON.stringify({ success: false, error: e.message || String(e) });
          }
        })()
      `, CDP_EVAL_TIMEOUT_MS);
      agentResponse = JSON.parse(resultJson);
    }
  } catch (e) {
    triggerError = e;
  }

  // Track B 是 fire-and-forget，需要等待实际执行完成
  if (TRACK === 'b' && agentResponse?.success) {
    console.log(`  ⏳ Track B: executeTask 已入队，等待后台执行完成...`);
    const waitStart = Date.now();
    const MAX_WAIT = OVERALL_TIMEOUT_MS - (Date.now() - startTime) - 30000; // 留 30s 给验证
    for (let waitRound = 0; waitRound < 300; waitRound++) {
      await sleep(POLL_INTERVAL_MS);
      try {
        const execJson = await cdpEval(cdp, `
          (async () => JSON.stringify(await window.electronAPI.heartbeat.getExecutingTasks()))()
        `, 5000);
        const executing = JSON.parse(execJson);

        // 同步监控日志
        const currentTargets = await cdpFetch('/json/list');
        const newTargetCount = currentTargets.length - initialTargetCount;
        let ipcFiles = [];
        try {
          const tmpFiles = fs.readdirSync(TEMP_DIR);
          ipcFiles = tmpFiles.filter(f => f.startsWith('hotel-ai-browser'));
        } catch {}
        const logLine = `[${timestamp()}] wait #${waitRound + 1}: executing=[${executing.join(',')}], targets=+${newTargetCount}, ipc_files=${ipcFiles.length}`;
        monitorLogs.push(logLine);
        console.log(`  📊 ${logLine}`);

        if (executing.length === 0) {
          console.log(`  ✅ 后台执行完成 (等待 ${((Date.now() - waitStart) / 1000).toFixed(1)}s)`);
          break;
        }

        if (Date.now() - waitStart > MAX_WAIT) {
          console.log(`  ⚠️  等待超时，继续验证当前结果`);
          break;
        }
      } catch (e) {
        // CDP eval 失败不中断
      }
    }
  }

  // 停止监控
  monitorRunning = false;
  await monitorPromise;

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n  ⏱️  执行耗时: ${elapsed}s`);

  // ══════════════════════════════════════════════════
  // Phase 3: 进度监控总结
  // ══════════════════════════════════════════════════
  console.log('\n[Phase 3] 进度监控总结...');
  console.log(`  总轮询次数: ${monitorLogs.length}`);

  // 检查是否曾有任务在执行
  const hadExecuting = monitorLogs.some(l => l.includes('executing=[') && !l.includes('executing=[]'));
  if (hadExecuting) {
    console.log('  ✅ 检测到任务执行活动');
  } else {
    warn('未检测到任务执行活动（可能执行太快或轮询间隔太大）');
  }

  // 检查是否有 bgTab 创建（targets 增加）
  const hadNewTargets = monitorLogs.some(l => {
    const match = l.match(/targets=\+(\d+)/);
    return match && parseInt(match[1]) > 0;
  });
  if (hadNewTargets) {
    console.log('  ✅ 检测到新 CDP targets（bgTab 可能已创建）');
  } else {
    console.log('  ℹ️  未检测到新 CDP targets（可能 API 直接成功，无需爬虫）');
  }

  // ══════════════════════════════════════════════════
  // Phase 4: 结果验证
  // ══════════════════════════════════════════════════
  console.log('\n[Phase 4] 结果验证...');

  // 4.1 触发是否成功
  if (triggerError) {
    assert(false, `触发执行失败: ${triggerError.message}`);
  } else {
    assert(!!agentResponse, 'Agent 返回了响应');

    if (agentResponse) {
      console.log(`  响应摘要: success=${agentResponse.success}`);

      if (agentResponse.success) {
        // Track A 返回 response 字段（LLM 文字），Track B 返回 result 字段
        const responseText = TRACK === 'a'
          ? (agentResponse.response || '')
          : JSON.stringify(agentResponse.result || '');

        console.log(`  响应长度: ${responseText.length} 字符`);
        if (responseText.length > 200) {
          console.log(`  响应前 200 字: ${responseText.substring(0, 200)}...`);
        } else {
          console.log(`  响应内容: ${responseText}`);
        }

        // 检查是否包含失败关键词
        const failKeywords = ['完全失败', '无法执行', '系统错误', 'fatal error', 'crash'];
        const hasFailKeyword = failKeywords.some(kw => responseText.toLowerCase().includes(kw.toLowerCase()));

        if (hasFailKeyword) {
          warn(`响应包含失败关键词`);
        } else {
          assert(true, '响应不含致命失败关键词');
        }
      } else {
        warn(`Agent 报告失败: ${agentResponse.error || '未知错误'}`);
      }
    }
  }

  // 4.2 脚本文件变化检查
  const afterMD5 = fileMD5(SCRIPT_PATH);
  if (baselineMD5 && afterMD5) {
    if (afterMD5 !== baselineMD5) {
      assert(true, `脚本已被修改: MD5 ${baselineMD5.substring(0, 8)}... → ${afterMD5.substring(0, 8)}...`);
    } else {
      console.log('  ℹ️  脚本未被修改（可能 API 直接成功，无需修复）');
    }
  }

  // 4.3 检查 SKILL.md 变化
  const afterSkillMD5 = fileMD5(SKILL_MD_PATH);
  if (baselineSkillMD5 && afterSkillMD5 && afterSkillMD5 !== baselineSkillMD5) {
    console.log(`  ℹ️  SKILL.md 已被更新`);
  }

  // 4.4 检查是否有新的 api-trip-* 目录
  const scriptsDir = path.resolve(__dirname, '..', 'scripts');
  try {
    const dirs = fs.readdirSync(scriptsDir).filter(d => {
      return d.startsWith('api-trip-') && fs.statSync(path.join(scriptsDir, d)).isDirectory();
    });
    console.log(`  api-trip-* 目录: ${dirs.join(', ')}`);
  } catch {}

  // 4.5 检查是否产生了新的数据文件
  const dataDir = path.resolve(__dirname, '..', 'data', 'api-results');
  try {
    const dataFiles = fs.readdirSync(dataDir)
      .filter(f => f.startsWith(SKILL_NAME) && f.endsWith('.json'))
      .filter(f => {
        const stat = fs.statSync(path.join(dataDir, f));
        return stat.mtimeMs >= startTime;
      });

    if (dataFiles.length > 0) {
      assert(true, `产生了 ${dataFiles.length} 个新数据文件`);
      // 读最新文件检查内容
      dataFiles.sort().reverse();
      const content = JSON.parse(fs.readFileSync(path.join(dataDir, dataFiles[0]), 'utf-8'));
      if (content.success === true && content.data && !isEmptyDataShell(content.data)) {
        assert(true, `数据文件包含有效数据`);
      } else {
        assert(false, `数据文件存在但内容为空或 success=false`);
      }
    } else {
      assert(false, `未产生新数据文件（Agent 未执行脚本或脚本无输出）`);
    }
  } catch (e) {
    warn(`数据文件检查失败: ${e.message}`);
  }

  // ══════════════════════════════════════════════════
  // Phase 5: 清理验证
  // ══════════════════════════════════════════════════
  console.log('\n[Phase 5] 清理验证...');

  // 5.1 等一小段时间让 bgTab 清理
  await sleep(2000);

  // 5.2 检查 CDP targets 恢复
  const finalTargets = await cdpFetch('/json/list');
  const targetDiff = finalTargets.length - initialTargetCount;
  if (targetDiff <= 0) {
    assert(true, `CDP targets 已恢复: ${finalTargets.length} (初始 ${initialTargetCount})`);
  } else {
    warn(`CDP targets 未完全恢复: +${targetDiff} (${finalTargets.length} vs 初始 ${initialTargetCount})`);
  }

  // 5.3 检查残留 IPC 文件
  try {
    const tmpFiles = fs.readdirSync(TEMP_DIR);
    const residualIpc = tmpFiles.filter(f => f.startsWith('hotel-ai-browser'));
    if (residualIpc.length === 0) {
      assert(true, '无残留 IPC 文件');
    } else {
      warn(`残留 IPC 文件: ${residualIpc.length} 个 (${residualIpc.slice(0, 3).join(', ')})`);
    }
  } catch {}

  // 5.4 执行中任务清空
  try {
    const execAfterJson = await cdpEval(cdp, `
      (async () => {
        const ids = await window.electronAPI.heartbeat.getExecutingTasks();
        return JSON.stringify(ids);
      })()
    `, 5000);
    const executingAfter = JSON.parse(execAfterJson);
    if (executingAfter.length === 0) {
      assert(true, '无执行中任务残留');
    } else {
      warn(`仍有执行中任务: ${executingAfter.join(', ')}`);
    }
  } catch (e) {
    warn(`无法检查执行中任务: ${e.message}`);
  }

  // 5.5 恢复脚本至基线（为下次运行准备）—— 可通过 --keep-script 跳过
  if (!keepScript && fs.existsSync(BASELINE_SCRIPT_PATH)) {
    fs.copyFileSync(BASELINE_SCRIPT_PATH, SCRIPT_PATH);
    console.log('  脚本已恢复至基线（为下次运行准备）');
  } else if (keepScript) {
    console.log('  ℹ️  --keep-script: 保留 Agent 修改后的脚本');
  }

  // 关闭 CDP 连接
  cdp.close();

  // ─── 结果汇总 ───
  const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('\n═══════════════════════════════════════════════════');
  console.log(`  结果: ${passed} passed, ${warned} warned, ${failed} failed`);
  console.log(`  总耗时: ${totalElapsed}s`);

  // 最终判定
  if (failed === 0 && warned === 0) {
    console.log('  判定: ✅ PASS');
  } else if (failed === 0) {
    console.log('  判定: ⚠️  WARN (Agent 有动作但部分检查未通过)');
  } else {
    console.log('  判定: ❌ FAIL');
  }
  console.log('═══════════════════════════════════════════════════\n');

  process.exit(failed > 0 ? 1 : 0);
}

// 全局超时保护
const globalTimer = setTimeout(() => {
  console.log(`\n  ❌ 全局超时 (${OVERALL_TIMEOUT_MS / 60000} 分钟)`);
  process.exit(2);
}, OVERALL_TIMEOUT_MS);

run().catch(e => {
  console.error('\n测试异常:', e);
  process.exit(1);
}).finally(() => {
  clearTimeout(globalTimer);
});
