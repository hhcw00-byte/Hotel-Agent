# smart-price-adjust v2 集成进度

## 已完成

### 1. 文件替换与桥接
- 旧版 `scripts/smart-price-adjust/` 已清空，新版文件从 `smart-price-adjust/scripts/` 复制过来
- 新版核心逻辑 `index.js` 改名为 `skill-core.js`
- 新建 `index.js` 桥接入口：从 `process.argv[2]` 读参数 → 调用 `host-adapter.js` → stdout 输出 JSON
- `host-adapter.js` 的 require 路径修正：`./index` → `./skill-core`
- Playwright 模块路径：`NODE_PATH` 加入 `ai-web-crawler/node_modules`

### 2. 登录检测
- `skill-core.js` 中 `require("../../ota-login-checker/scripts")` 改为 `require("../../login-checker/scripts")`（接口完全兼容）
- Electron 环境下跳过内置登录检测（`SMART_PRICE_SKIP_LOGIN_PRECHECK=1`），因为 login-checker 在 bgTab 里创建新页面会卡住
- 登录态由 Electron 浏览器管理，如果未登录，executor 本身会返回错误

### 3. CDP 环境变量
`index.js` 设置以下环境变量让所有平台走 CDP 模式：
```
PRESUBMIT_CDP_ENDPOINT=http://127.0.0.1:9222
PRESUBMIT_CONNECT_MODE=cdp
BOOKING_CDP_ENDPOINT=http://127.0.0.1:9222
BOOKING_CONNECT_MODE=cdp
SMART_PRICE_NODE_COMMAND=process.execPath（Electron 的 Node）
ELECTRON_RUN_AS_NODE=1
SMART_PRICE_SESSION_ID=price-adjust-{timestamp}
```

### 4. Electron bgTab 模式
- 在 ctrip 的 `verify-script.js` 中加入了 `createRuntimeFromElectronBgTab` 函数（从旧版复制）
- 判断条件：`input.cdpEndpoint && input.sessionId && !input.userDataDir`
- `buildInput` 中加了 `sessionId: valueOf(env.SMART_PRICE_SESSION_ID, "")`
- bgTab 创建流程：CDP 锁 → connectOverCDP → IPC 创建 bgTab → 查找 page → setViewportSize
- `run()` 的 finally 块：bgTab 模式下 disconnect browser + 调用 cleanup
- bgTab 模式下 `process.exit()` 强制退出（CDP 连接保持事件循环）

### 5. 超时问题
- `verify-script.js` 末尾：bgTab 模式下 `process.exit(result.finalStatus === "success" ? 0 : 2)`
- `index.js` 末尾：`process.exit(0)` / `process.exit(1)`

### 6. SKILL.md 更新
- 参数改为新版 formal schema：`platformCode`、`startDate`、`endDate`、`roomList`
- 支持 4 个平台：ctrip、meituan、trip、booking

### 7. Gemini schema 修复
- `skills/login-check/SKILL.md`：`platforms` 参数加了 `items: { type: object }`
- `skills/api-booking-backend-price/SKILL.md`：`roomIds` 参数加了 `items: { type: string }`

### 8. verify.js stderr 诊断
- ctrip `verify.js` 在 JSON 解析失败时打印 stderr 和 stdout tail，帮助诊断子进程崩溃

## 未解决的问题

### 日期选择器在 show:false bgTab 中不工作
**现象：**
- `show: true`（可见窗口）→ 调价成功，日期选择正常
- `show: false`（隐藏窗口）→ 开始日期 27 选中后，选结束日期 28 时把开始日期覆盖为 28，最终 28~28

**已验证的事实：**
1. `setViewportSize({ width: 1280, height: 800 })` 成功
2. `document.visibilityState` 覆盖为 `"visible"` 无效
3. `dispatchEvent(new MouseEvent("click"))` 能选中第一个日期（27），但选第二个日期（28）时第一个被覆盖
4. `element.click({ force: true })` 报 `Element is not visible`
5. CDP `Input.dispatchMouseEvent` 在 show:false 窗口里 hit-testing 失败，完全无效
6. `nativeInputValueSetter` 能正确设置 input 值（27~28），但组件内部状态没更新，价格表不刷新
7. `PointerEvent` 加入 dispatchEvent 序列无效

**已排除的原因：**
- 不是 `visibilityState` 的问题
- 不是 `force: true` 的问题
- 不是 CDP click 的问题
- 不是 `navigateToYearMonth` 的问题（月份导航正常工作）

**关键线索：**
- 旧版源码（`smart-price-adjust/platforms/ctrip/verify-script.js`）和新版的 `selectDateByIndex` 代码完全一样
- 旧版据说在开发环境和打包环境都能跑通
- 但当前环境下旧版的 dispatchEvent 逻辑也不工作（28~28）
- `show: true` 时一切正常

**当前状态：**
- bgTab 模式下不走 `stepFormalOneSubmit`（新版 formal 路径），走旧版的 `stepSubmitProbeValidateChain` 路径
- 但旧版路径的日期选择也失败

### 下一步方向
1. **直接用旧版 verify-script.js 测试**：把 `smart-price-adjust/platforms/ctrip/verify-script.js` 原封不动复制到 `scripts/smart-price-adjust/platforms/ctrip/verify-script.js`，确认旧版代码在当前环境下能否跑通
2. 如果旧版也不能跑通，说明问题在 Electron 环境（版本、配置等），需要对比开发环境和打包环境的差异
3. 如果旧版能跑通，说明我改的代码有遗漏，需要逐行 diff

## 文件清单

### 已修改的文件
| 文件 | 改动 |
|---|---|
| `scripts/smart-price-adjust/index.js` | 新建桥接入口 |
| `scripts/smart-price-adjust/skill-core.js` | 原新版 index.js 改名，修改 require 路径 |
| `scripts/smart-price-adjust/host-adapter.js` | require 路径修正 |
| `scripts/smart-price-adjust/platforms/ctrip/verify-script.js` | 加入 createRuntimeFromElectronBgTab + bgTab 路径选择 + process.exit |
| `scripts/smart-price-adjust/platforms/ctrip/verify.js` | 加 stderr 诊断日志 |
| `skills/smart-price-adjust/SKILL.md` | 更新为新版 formal schema |
| `skills/login-check/SKILL.md` | 加 items 字段 |
| `skills/api-booking-backend-price/SKILL.md` | 加 items 字段 |
| `src/main/pi-agent-manager.ts` | recovery 模式空 stop 重试逻辑 |

### 未修改的外部文件
- `src/main/skill-executor.ts` — 不需要改
- `src/main/window-manager.ts` — 不需要改（bgWindow show:false 保持不变）
- `login-checker/scripts/checker.js` — 不需要改
- 其他 skill、heartbeat、爬虫 — 不受影响

## 旧版源码位置
- `smart-price-adjust/` — 旧版完整源码（不在 scripts/ 子目录下）
- `smart-price-adjust/platforms/ctrip/verify-script.js` — 旧版 ctrip 执行脚本
- `release/win-unpacked/resources/scripts/smart-price-adjust/` — 打包后的旧版（和源码一致）
