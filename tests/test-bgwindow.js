/**
 * bgWindow 集成测试
 *
 * 测试项：
 *   1. bgTab 创建（文件 IPC）
 *   2. CDP 截图不超时
 *   3. 标签栏显示爬虫标签（isCrawler=true）
 *   4. bgTab 关闭 + bgWindow 自动释放
 *   5. 主窗口不受影响
 *
 * 用法：先启动 Electron 应用，然后运行 node tests/test-bgwindow.js
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const CDP_PORT = 9222;
const TEMP_DIR = os.tmpdir();

// ─── 工具函数 ───

function cdpFetch(path) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${CDP_PORT}${path}`, (res) => {
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

function writeIpcRequest(action, params = {}) {
  const requestId = `test-${Date.now()}`;
  const file = path.join(TEMP_DIR, `hotel-ai-browser-ipc-${requestId}.json`);
  const payload = { action, requestId, ...params, timestamp: Date.now() };
  fs.writeFileSync(file, JSON.stringify(payload, null, 2));
  return requestId;
}

async function waitIpcResponse(requestId, timeoutMs = 10000) {
  const responseFile = path.join(TEMP_DIR, `hotel-ai-browser-ipc-${requestId}.response.json`);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(responseFile)) {
      const data = JSON.parse(fs.readFileSync(responseFile, 'utf-8'));
      try { fs.unlinkSync(responseFile); } catch {}
      return data;
    }
    await sleep(100);
  }
  throw new Error(`IPC response timeout after ${timeoutMs}ms for ${requestId}`);
}

// CDP WebSocket 简易客户端
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

// ─── 测试用例 ───

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ ${message}`);
    passed++;
  } else {
    console.log(`  ❌ ${message}`);
    failed++;
  }
}

async function run() {
  console.log('\n═══════════════════════════════════════');
  console.log('  bgWindow 集成测试');
  console.log('═══════════════════════════════════════\n');

  // ── 前置检查：CDP 可达 ──
  console.log('[0] 前置检查...');
  let version;
  try {
    version = await cdpFetch('/json/version');
    assert(!!version.Browser, `CDP 可达: ${version.Browser}`);
  } catch (e) {
    console.log(`  ❌ CDP 不可达 (port ${CDP_PORT})，请先启动 Electron 应用`);
    process.exit(1);
  }

  // 记录初始 targets 数量
  const initialTargets = await cdpFetch('/json/list');
  const initialCount = initialTargets.length;
  console.log(`  初始 targets: ${initialCount}`);

  // ── 测试 1：创建 bgTab ──
  console.log('\n[1] 创建 bgTab...');
  const testUrl = 'https://www.example.com/';
  const sessionId = 'test-session-' + Date.now();
  const requestId = writeIpcRequest('create_bg_tab', { url: testUrl, sessionId });

  let response;
  try {
    response = await waitIpcResponse(requestId, 10000);
    assert(!!response.tabId, `bgTab 创建成功: ${response.tabId}`);
    assert(response.tabId.startsWith('bg-tab-'), `tabId 格式正确: ${response.tabId}`);
  } catch (e) {
    console.log(`  ❌ bgTab 创建失败: ${e.message}`);
    process.exit(1);
  }

  const bgTabId = response.tabId;
  const bgWcId = response.wcId;

  // 等页面加载
  await sleep(3000);

  // ── 测试 2：CDP targets 增加 ──
  console.log('\n[2] 验证 CDP targets...');
  const afterTargets = await cdpFetch('/json/list');
  assert(afterTargets.length > initialCount, `targets 数量增加: ${initialCount} → ${afterTargets.length}`);

  // 找到 bgTab 的 target
  const bgTarget = afterTargets.find(t =>
    t.url.includes('example.com') ||
    (bgWcId && String(t.id) === String(bgWcId))
  );
  assert(!!bgTarget, `找到 bgTab 的 CDP target: ${bgTarget?.url || '(not found)'}`);

  // ── 测试 3：CDP 截图不超时 ──
  console.log('\n[3] CDP 截图测试...');
  if (bgTarget && bgTarget.webSocketDebuggerUrl) {
    try {
      const cdp = await cdpConnect(bgTarget.webSocketDebuggerUrl);

      // 启用 Page domain
      await cdp.send('Page.enable');

      // 截图计时
      const screenshotStart = Date.now();
      const result = await Promise.race([
        cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 50 }),
        sleep(15000).then(() => { throw new Error('Screenshot timeout 15s'); })
      ]);
      const screenshotTime = Date.now() - screenshotStart;

      assert(!!result.data, `截图成功 (${screenshotTime}ms)`);
      assert(screenshotTime < 5000, `截图耗时合理: ${screenshotTime}ms < 5000ms`);

      // 截图大小检查（非空白）
      const imgSize = Buffer.from(result.data, 'base64').length;
      assert(imgSize > 1000, `截图非空白: ${(imgSize / 1024).toFixed(1)}KB`);

      cdp.close();
    } catch (e) {
      assert(false, `CDP 截图失败: ${e.message}`);
    }
  } else {
    assert(false, '无法连接 bgTab CDP（未找到 webSocketDebuggerUrl）');
  }

  // ── 测试 4：主窗口标签栏包含爬虫标签 ──
  console.log('\n[4] 标签栏 isCrawler 标记...');
  // 通过渲染进程的 tab:list IPC 获取标签列表
  // 这里我们通过 CDP 连接到主窗口的渲染进程来调用
  const mainTarget = afterTargets.find(t =>
    t.url.includes('index.html') || t.type === 'page'
  );

  if (mainTarget && mainTarget.webSocketDebuggerUrl) {
    try {
      const cdp = await cdpConnect(mainTarget.webSocketDebuggerUrl);
      const evalResult = await cdp.send('Runtime.evaluate', {
        expression: `
          (async () => {
            if (window.electronAPI && window.electronAPI.tabs) {
              const data = await window.electronAPI.tabs.list();
              return JSON.stringify(data);
            }
            return JSON.stringify({ error: 'electronAPI not available' });
          })()
        `,
        awaitPromise: true,
        returnByValue: true
      });

      if (evalResult.result && evalResult.result.value) {
        const tabData = JSON.parse(evalResult.result.value);
        if (tabData.tabs) {
          const crawlerTabs = tabData.tabs.filter(t => t.isCrawler);
          const normalTabs = tabData.tabs.filter(t => !t.isCrawler);
          assert(crawlerTabs.length > 0, `标签列表包含爬虫标签: ${crawlerTabs.length} 个`);
          assert(normalTabs.length > 0, `普通标签仍存在: ${normalTabs.length} 个`);

          const ourTab = crawlerTabs.find(t => t.id === bgTabId);
          assert(!!ourTab, `找到我们创建的爬虫标签: ${bgTabId}`);
        } else {
          assert(false, `tab:list 返回异常: ${JSON.stringify(tabData)}`);
        }
      }
      cdp.close();
    } catch (e) {
      assert(false, `标签栏检查失败: ${e.message}`);
    }
  } else {
    console.log('  ⚠️ 跳过（未找到主窗口渲染进程）');
  }

  // ── 测试 5：主窗口正常（不受 bgTab 影响）──
  console.log('\n[5] 主窗口完整性...');
  if (mainTarget && mainTarget.webSocketDebuggerUrl) {
    try {
      const cdp = await cdpConnect(mainTarget.webSocketDebuggerUrl);

      // 检查主窗口 DOM 是否正常
      const evalResult = await cdp.send('Runtime.evaluate', {
        expression: `document.getElementById('tabList') ? 'ok' : 'missing'`,
        returnByValue: true
      });
      assert(evalResult.result.value === 'ok', '主窗口 DOM 正常（tabList 存在）');

      cdp.close();
    } catch (e) {
      assert(false, `主窗口检查失败: ${e.message}`);
    }
  }

  // ── 测试 6：关闭 bgTab ──
  console.log('\n[6] 关闭 bgTab...');
  const destroyRequestId = writeIpcRequest('destroy_bg_tabs_by_session', { sessionId });

  try {
    await waitIpcResponse(destroyRequestId, 10000);
    assert(true, `bgTab 销毁请求已处理`);
  } catch {
    // destroy 可能不写 response，等一会儿直接检查
    await sleep(2000);
    console.log('  ⚠️ 销毁无响应文件（可能正常），检查 targets...');
  }

  await sleep(1000);

  // 验证 targets 恢复
  const finalTargets = await cdpFetch('/json/list');
  const bgTargetGone = !finalTargets.find(t => t.url.includes('example.com'));
  assert(bgTargetGone, `bgTab CDP target 已销毁`);
  assert(finalTargets.length <= initialCount + 1, `targets 数量恢复: ${finalTargets.length} (初始 ${initialCount})`);

  // ── 测试 7：再次创建+关闭（验证 bgWindow 生命周期）──
  console.log('\n[7] bgWindow 生命周期（创建→关闭→再创建）...');
  const sessionId2 = 'test-lifecycle-' + Date.now();
  const reqId2 = writeIpcRequest('create_bg_tab', { url: 'https://www.example.com/', sessionId: sessionId2 });

  try {
    const resp2 = await waitIpcResponse(reqId2, 10000);
    assert(!!resp2.tabId, `第二次创建成功: ${resp2.tabId}`);

    // 立即销毁
    const destroyReqId2 = writeIpcRequest('destroy_bg_tabs_by_session', { sessionId: sessionId2 });
    await sleep(3000);

    const afterLifecycle = await cdpFetch('/json/list');
    const noExampleLeft = !afterLifecycle.find(t => t.url.includes('example.com'));
    assert(noExampleLeft, 'bgWindow 生命周期正常（二次创建+销毁）');
  } catch (e) {
    assert(false, `生命周期测试失败: ${e.message}`);
  }

  // ── 结果 ───
  console.log('\n═══════════════════════════════════════');
  console.log(`  结果: ${passed} passed, ${failed} failed`);
  console.log('═══════════════════════════════════════\n');

  process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => {
  console.error('测试异常:', e);
  process.exit(1);
});
