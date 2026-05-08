# Design Document: smart-price-adjust Electron Mode

## Overview

将 smart-price-adjust 技能的浏览器启动方式从独立 Chrome 窗口（Playwright `launchPersistentContext`）改造为通过 CDP 连接 Electron 内置 BrowserView（bgTab），与 ai-web-crawler 的后台模式保持一致。

改造后，调价脚本将复用 Electron session 的 Cookie（无需独立 Chrome profile），在隐藏的 bgTab 中执行（用户无感），并与爬虫共享 CDP 锁机制实现互斥访问。改造范围严格限制在 smart-price-adjust 目录内的 3 个文件，不触碰项目其他模块。

## 核心设计决策

1. verify-script.js 已有 `createRuntimeFromCdp` 函数（CDP fallback），但它只做纯 CDP 连接，不处理 bgTab 创建和锁机制。新增 `createRuntimeFromElectronBgTab` 函数封装完整流程。
2. 调价只通过用户对话触发，不走心跳系统，不需要考虑和心跳任务的调度互斥。
3. bgTab 创建时传入 `pricePageUrl`（让页面提前加载），verify-script 的 `stepEnterPricePage` 会再 goto 一次（幂等，已在同一 URL 则秒过）。
4. 所有修改限制在 `scripts/smart-price-adjust/` 目录内，不修改 WindowManager、HeartbeatManager 等已有模块。

## 修改范围（仅 3 个文件）

| 文件 | 修改内容 | 影响 |
|------|----------|------|
| `scripts/smart-price-adjust/index.js` | 加入模式选择 + 环境变量注入 | 仅影响调价 skill 自身 |
| `scripts/smart-price-adjust/platforms/ctrip/script-adapter.js` | `precheckRuntime` 跳过 Electron 模式的 profileDir 检查 | 仅影响调价 precheck |
| `scripts/smart-price-adjust/platforms/ctrip/verify-script.js` | `buildInput` 加 sessionId + `createRuntime` 加路由 + 新增函数 | 仅影响调价运行时 |

## Architecture

```
SkillExecutor spawn
  → index.js (bridge): 模式选择 + 环境变量注入
    → host-adapter → core → router → script-adapter
      → verify-script.js
        → createRuntime() 路由:
          ├── Electron 模式: createRuntimeFromElectronBgTab()
          │     → 获取 CDP 锁
          │     → IPC 文件请求 Electron 创建 bgTab
          │     → chromium.connectOverCDP
          │     → 查找 bgTab Page
          │     → 返回 Page 对象
          ├── Chrome 模式: launchPersistentContext (现有逻辑不变)
          └── Non-persistent 模式: chromium.launch (现有逻辑不变)
```

## 修改点 1: index.js Bridge

在现有 runtime 注入逻辑之后，加入模式选择：

```javascript
// ── 模式选择（在 params.runtime = runtime 之后）──
const browserMode = process.env.SMART_PRICE_BROWSER_MODE || "auto";
const cdpPort = parseInt(process.env.SMART_PRICE_CDP_PORT || "9222", 10);

if (browserMode === "electron" || (browserMode === "auto" && await probeCdpPort(cdpPort))) {
  runtime.envOverrides.PRESUBMIT_CDP_ENDPOINT = `http://127.0.0.1:${cdpPort}`;
  runtime.envOverrides.PRESUBMIT_SESSION_ID = `price-adjust-${Date.now()}`;
  runtime.automationProfileDir = "";
  delete runtime.envOverrides.PRESUBMIT_AUTOMATION_PROFILE_DIR;
} 
// else: 保持现有 Chrome 模式（automationProfileDir 从环境变量读取）

async function probeCdpPort(port) {
  const net = require("net");
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(2000);
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", () => { socket.destroy(); resolve(false); });
    socket.once("timeout", () => { socket.destroy(); resolve(false); });
    socket.connect(port, "127.0.0.1");
  });
}
```

## 修改点 2: script-adapter.js precheckRuntime

在 `automationProfileDir` 检查前加入 Electron 模式跳过：

```javascript
if (shouldExecute(task)) {
  // Electron 模式下不需要 automationProfileDir
  const isElectronMode = !!env.PRESUBMIT_CDP_ENDPOINT;
  if (!isElectronMode && !runtime.automationProfileDir) {
    errors.push({ ... });
  } else if (!isElectronMode && !fs.existsSync(runtime.automationProfileDir)) {
    errors.push({ ... });
  }
}
```

## 修改点 3: verify-script.js

### 3a. buildInput 加 sessionId（1 行）

```javascript
// 在 buildInput 返回对象中加入：
sessionId: valueOf(env.PRESUBMIT_SESSION_ID, ""),
```

### 3b. createRuntime 加路由（函数开头 3 行）

```javascript
async function createRuntime(config, input, result) {
  // Electron bgTab 模式（最高优先级）
  if (input.cdpEndpoint && input.sessionId && !input.userDataDir) {
    result.browserLaunchAttempted = true;
    result.browserLaunchMode = "electron_bg_tab";
    return createRuntimeFromElectronBgTab(input, result);
  }
  // ... 现有逻辑完全不变 ...
}
```

### 3c. 新增 createRuntimeFromElectronBgTab

复用爬虫 `BrowserController.connectBackground()` 的模式：CDP 锁 → IPC 创建 bgTab → connectOverCDP → 查找 Page。

核心逻辑约 80 行，包含：
- CDP 锁获取（与爬虫共享 `hotel-ai-browser-cdp.lock`，stale 检测逻辑一致）
- IPC 文件请求 bgTab 创建（与爬虫协议一致）
- CDP 连接 + Page 查找（page 事件 + domain fallback）
- process.once('exit') 清理（释放锁 + 销毁 bgTab）

返回值与现有 `createRuntime` 完全兼容：
```javascript
{
  browser,        // CDP Browser 对象
  context,        // 第一个 context
  page,           // bgTab 的 Page 对象
  resolvedUserDataDir: "",
  resolvedProfileDirectory: "",
  browserChannel: "electron",
  contextPageCount: number,
  selectedPageInitialUrl: string,
  crashRestoreDetected: false,
  startupInterferenceDetected: false
}
```

## CDP 锁机制

与爬虫完全共享同一个锁文件 `os.tmpdir()/hotel-ai-browser-cdp.lock`：
- 获取方式：`fs.writeFileSync(lockFile, pid, { flag: 'wx' })`（原子创建）
- Stale 检测：PID 存活性 + 2 分钟 mtime 阈值
- keepAlive：每 30 秒 touch 一次
- 超时：5 分钟（调价可能执行较长时间）
- 释放：process.once('exit') 回调

由于调价只通过对话触发，不走心跳，实际冲突概率很低（只有用户对话触发调价时恰好心跳在跑 recovery 才会等待）。

## IPC 文件协议

复用现有协议，不需要修改 WindowManager：

```javascript
// 请求文件：os.tmpdir()/hotel-ai-browser-ipc-{requestId}.json
{ action: "create_bg_tab", requestId, url, sessionId, timestamp }

// 响应文件：os.tmpdir()/hotel-ai-browser-ipc-{requestId}.response.json
{ tabId, wcId, url, timestamp }

// 清理文件：os.tmpdir()/hotel-ai-browser-ipc-{requestId}.json
{ action: "destroy_bg_tabs_by_session", sessionId, requestId, timestamp }
```

## 错误处理

| 场景 | 处理 |
|------|------|
| CDP 端口不可达 | auto 模式静默降级到 Chrome 模式；electron 模式抛错 |
| CDP 锁超时（5 分钟） | 抛错，调价失败 |
| Electron 未响应 bgTab（8 秒） | 抛错，cleanup 释放锁 |
| bgTab Page 未找到 | 抛错，cleanup 释放锁 + 销毁 bgTab |
| 进程 SIGKILL | 锁残留，下次获取时 stale 检测自动清除 |

## 兼容性保证

1. `SMART_PRICE_BROWSER_MODE=chrome` 或 CDP 不可达时，行为与改造前完全一致
2. 现有 `createRuntime` 的两条路径（persistent + non-persistent）代码零修改
3. `createRuntimeFromElectronBgTab` 返回值结构与现有完全一致，下游 2000+ 行业务逻辑无需任何修改
4. WindowManager 的 IPC file watcher 已支持 `create_bg_tab` 和 `destroy_bg_tabs_by_session`，无需修改
5. SKILL.md 的参数定义不变，Agent 调用方式不变
