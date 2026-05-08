# smart-price-adjust v2 集成任务

## Task 1: 复制新版文件替换旧版
- [ ] 清空 `scripts/smart-price-adjust/` 目录（保留 `test-cdp.js`）
- [ ] 将 `smart-price-adjust/scripts/*` 所有文件和子目录复制到 `scripts/smart-price-adjust/`
- [ ] 验证文件完整性

## Task 2: 创建桥接入口 index.js
- [ ] 重写 `scripts/smart-price-adjust/index.js` 为 SkillExecutor 兼容的桥接入口
- [ ] 从 `process.argv[2]` 读取 JSON 参数
- [ ] 调用 `host-adapter.js` 的 `runSmartPriceAdjustForHost()`
- [ ] stdout 输出 JSON 结果
- [ ] 写诊断文件到 `DATA_DIR`

## Task 3: 创建 login-precheck-adapter.js
- [ ] 分析 `login-checker/scripts/index.js` 导出的接口
- [ ] 创建 `scripts/smart-price-adjust/login-precheck-adapter.js`
- [ ] 实现 `precheckOtaLoginBeforeAdjust(options)` — 遍历平台列表调用 login-checker
- [ ] 实现 `isOtaLoginPrecheckError(error)` — 判断登录检测错误
- [ ] 实现 `normalizeOtaCode(code)` — 标准化平台代码
- [ ] 修改新版核心 `index.js`（重命名为 `core-index.js` 或修改 require 路径）指向适配层

## Task 4: 适配各平台 runtime.js 为 Electron CDP 模式
- [ ] 修改 `platforms/ctrip/runtime.js` — 优先 CDP 连接 Electron
- [ ] 修改 `platforms/meituan/runtime.js` — 优先 CDP 连接 Electron
- [ ] 修改 `platforms/trip/runtime.js` — 优先 CDP 连接 Electron
- [ ] 修改 `platforms/booking/runtime.js` 或 `common.js` — 优先 CDP 连接 Electron
- [ ] 确保 Playwright 通过 CDP 连接后能正确操作页面

## Task 5: 更新 SKILL.md
- [ ] 用新版 formal schema 替换 `skills/smart-price-adjust/SKILL.md`
- [ ] 参数定义：platformCode (enum), startDate, endDate, roomList (array)
- [ ] 更新调用示例（单平台 + 批量）
- [ ] 更新返回值说明

## Task 6: 更新 SkillExecutor
- [ ] 在 `skill-executor.ts` 的 `executeScript` 中，对 `smart-price-adjust` skill 注入 `SMART_PRICE_CDP_PORT` 环境变量
- [ ] 确认 CDP 端口值来源（默认 9222，或从 Electron 配置读取）

## Task 7: 验证
- [ ] `node --check` 语法检查所有新文件
- [ ] 运行 `scripts/smart-price-adjust/smokes/run-all-smokes.js`
- [ ] 手动通过 Agent 对话触发一次携程调价验证
- [ ] 手动通过 Agent 对话触发一次美团调价验证
