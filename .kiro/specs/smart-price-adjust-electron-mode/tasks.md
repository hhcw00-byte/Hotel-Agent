# Implementation Tasks: smart-price-adjust Electron Mode

- [x] 1. index.js 加入模式选择和 CDP 端口探测
  - [x] 1.1 在 runtime 注入逻辑之后加入 `SMART_PRICE_BROWSER_MODE` 环境变量解析和 CDP 端口探测 `[US-1, US-2]`
  - [x] 1.2 新增 `probeCdpPort(port)` TCP 探测函数 `[US-2: AC-2.2]`
  - [x] 1.3 Electron 模式下注入 `PRESUBMIT_CDP_ENDPOINT` + `PRESUBMIT_SESSION_ID`，清空 `automationProfileDir` `[US-1: AC-1.1]`

- [x] 2. script-adapter.js precheckRuntime 兼容 Electron 模式
  - [x] 2.1 在 `precheckRuntime` 中检测 `PRESUBMIT_CDP_ENDPOINT` 存在时跳过 `automationProfileDir` 检查 `[US-1: AC-1.3, US-2: AC-2.3]`

- [x] 3. verify-script.js buildInput 加 sessionId
  - [x] 3.1 在 `buildInput` 返回对象中加入 `sessionId: valueOf(env.PRESUBMIT_SESSION_ID, "")` `[US-4: AC-4.3]`

- [x] 4. verify-script.js createRuntime 加路由分支
  - [x] 4.1 在 `createRuntime` 函数开头加入 Electron 模式路由条件 `(cdpEndpoint && sessionId && !userDataDir)` `[US-1: AC-1.1, US-2: AC-2.3]`

- [x] 5. verify-script.js 新增 createRuntimeFromElectronBgTab 函数
  - [x] 5.1 实现 CDP 锁获取（与爬虫共享锁文件，stale 检测，5 分钟超时） `[US-3: AC-3.1, AC-3.2, AC-3.3, AC-3.4]`
  - [x] 5.2 实现 IPC 文件请求 bgTab 创建 + 轮询等待响应 `[US-4: AC-4.1]`
  - [x] 5.3 实现 CDP 连接 + page 事件 / domain fallback 查找 bgTab Page `[US-1: AC-1.2]`
  - [x] 5.4 实现 process.once('exit') cleanup 回调（释放锁 + 销毁 bgTab） `[US-4: AC-4.2]`
  - [x] 5.5 返回与现有 createRuntime 兼容的 RuntimeResult 结构 `[US-5: AC-5.1, AC-5.2]`

- [ ] 6. 端到端验证
  - [ ] 6.1 启动 Electron 应用，通过 Agent 对话触发 inspect_only 模式调价，确认 bgTab 模式生效 `[US-1]`
  - [ ] 6.2 确认执行完成后 bgTab 被销毁、CDP 锁被释放 `[US-4]`
  - [ ] 6.3 确认 `SMART_PRICE_BROWSER_MODE=chrome` 时行为与改造前一致 `[US-2]`
