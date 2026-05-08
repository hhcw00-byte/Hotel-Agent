# smart-price-adjust v2 集成需求

## 背景
当前项目有一个旧版一键调价 skill（`scripts/smart-price-adjust/`），仅支持携程平台。新版（`smart-price-adjust/`）支持携程、美团、Trip、Booking 四个平台，采用 formal roomList 输入协议，有完整的登录前置门禁、批量执行、失败码归一化等能力。需要将新版集成到当前项目的 skill 系统中，替换旧版。

## 核心需求

### FR-1: 替换旧版脚本
- 将 `smart-price-adjust/scripts/` 下的所有文件复制到 `scripts/smart-price-adjust/`，替换旧版
- 保留旧版的 `scripts/smart-price-adjust/test-cdp.js`（CDP 调试工具）

### FR-2: 修复 ota-login-checker 依赖路径
- 新版 `index.js` 中 `require("../../ota-login-checker/scripts")` 路径不对
- 项目中登录检测在 `login-checker/scripts/`，需要修改 require 路径为 `../login-checker/scripts`（因为脚本在 `scripts/smart-price-adjust/` 下，login-checker 在 `scripts/` 同级的 `login-checker/`）
- 或者：如果 login-checker 的接口不兼容新版期望的 `precheckOtaLoginBeforeAdjust` / `isOtaLoginPrecheckError` / `normalizeOtaCode`，需要写一个适配层

### FR-3: 浏览器模式适配为 Electron CDP
- 新版设计为连接独立 Chrome（`runtime.userDataDir` 持久化 profile）
- 需要改为连接 Electron 内嵌浏览器的 CDP 端口（默认 9222）
- 各平台的 `runtime.js` 需要适配：不启动新 Chrome，而是通过 `chromium.connectOverCDP('http://localhost:9222')` 连接 Electron
- Cookie 由 Electron session 管理，不需要 `userDataDir`
- `SkillExecutor` 已通过环境变量注入 CDP 端口（`process.env.SMART_PRICE_CDP_PORT` 或默认 9222）

### FR-4: 更新 SKILL.md
- 用新版的 `smart-price-adjust/SKILL.md` 替换 `skills/smart-price-adjust/SKILL.md`
- 调整 parameters 定义，使 Agent 能正确调用：
  - `platformCode`: string, required, enum [ctrip, meituan, trip, booking]
  - `startDate`: string, required (YYYY-MM-DD)
  - `endDate`: string, required (YYYY-MM-DD)
  - `roomList`: array, required（每项含 roomName + price）
- 去掉旧版的 `segments` 参数
- 保留 `script: scripts/smart-price-adjust/index.js`

### FR-5: SkillExecutor 适配
- `skill-executor.ts` 中对 `smart-price-adjust` skill 的 Cookie 注入需要支持多域名（根据 platformCode 动态选择 cookieDomain）
- 或者在脚本内部根据 platformCode 自行处理 Cookie

### FR-6: 登录前置门禁集成
- 新版在执行调价前会调用 `precheckOtaLoginBeforeAdjust` 检测目标平台登录状态
- 需要确保 `login-checker/scripts/` 导出了新版期望的接口
- 如果接口不兼容，需要在 `scripts/smart-price-adjust/` 下创建一个 `login-precheck-adapter.js` 适配层

## 非功能需求

### NFR-1: 不破坏现有 skill 系统
- 其他 skill（api-*、data-store、file-operations 等）不受影响
- Agent 的 tool-calling 机制不变

### NFR-2: 打包兼容
- `package.json` 的 `build.extraResources` 需要包含新版文件
- 确保打包后路径正确

## 约束
- 不引入新的 npm 依赖（Playwright 已在 ai-web-crawler 的 node_modules 中）
- 不修改 Electron 主进程架构
- 保持子进程执行模式（spawn + ELECTRON_RUN_AS_NODE）
