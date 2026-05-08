# smart-price-adjust v2 技术设计

## 架构概览

```
Agent tool-calling
  → SkillExecutor.spawn("scripts/smart-price-adjust/index.js", params)
    → host-adapter.js（输入归一化）
    → index.js（登录门禁 + 平台路由）
      → login-precheck-adapter.js → login-checker/scripts/（登录检测）
      → router.js → platforms/{ctrip,meituan,trip,booking}/
        → executor.js → runtime.js（CDP 连接 Electron）→ verify-script.js（Playwright 自动化）
    → result-mapper.js（输出归一化）
  → stdout JSON → SkillExecutor 解析
```

## 关键设计决策

### D-1: 入口桥接
新版的 `host-adapter.js` 已经是一个完整的入口适配层。但当前项目的 SkillExecutor 通过 `process.argv[2]` 传参，而新版的 `host-adapter.js` 期望被 `require` 后调用。

**方案**：保留旧版的桥接模式——`index.js` 作为 SkillExecutor 的入口，从 `process.argv[2]` 读取参数，调用 `host-adapter.js` 的 `runSmartPriceAdjustForHost()`，通过 stdout 输出结果。

### D-2: CDP 模式适配
新版各平台的 `runtime.js` 使用 `chromium.launch()` 或 `chromium.launchPersistentContext()` 启动独立 Chrome。

**方案**：修改各平台的 `runtime.js`，增加 CDP 连接模式：
- 检测环境变量 `SMART_PRICE_CDP_PORT`（由 SkillExecutor 注入）
- 如果存在，使用 `chromium.connectOverCDP('http://localhost:' + port)` 连接 Electron
- 如果不存在，fallback 到独立 Chrome 模式（保留兼容性）

### D-3: 登录门禁适配
新版 `index.js` 依赖 `../../ota-login-checker/scripts` 的三个导出：
- `precheckOtaLoginBeforeAdjust(options)` — 批量检测多平台登录状态
- `isOtaLoginPrecheckError(error)` — 判断是否为登录检测错误
- `normalizeOtaCode(code)` — 标准化平台代码

项目中的 `login-checker/scripts/index.js` 导出的是 `execute(input, options)`，接口不同。

**方案**：在 `scripts/smart-price-adjust/` 下创建 `login-precheck-adapter.js`，适配两套接口：
```javascript
// login-precheck-adapter.js
const loginChecker = require('../../login-checker/scripts');

async function precheckOtaLoginBeforeAdjust(options) {
  // 遍历 options.platforms，逐个调用 loginChecker.execute()
  // 任一平台未登录则抛出 OtaLoginPrecheckError
}

function isOtaLoginPrecheckError(error) {
  return error && error._isOtaLoginPrecheckError === true;
}

function normalizeOtaCode(code) {
  return loginChecker.normalizeOtaCode ? loginChecker.normalizeOtaCode(code) : String(code).toLowerCase();
}
```

然后修改 `index.js` 的 require 路径指向这个适配层。

### D-4: Cookie 注入
当前 SkillExecutor 只对 `api-*` 和 `login-check` 类型的 skill 注入 Cookie。`smart-price-adjust` 不匹配这个前缀。

**方案**：在 `skill-executor.ts` 中扩展 Cookie 注入条件，增加 `smart-price-adjust`：
```typescript
if ((context.skillName.startsWith('api-') || context.skillName === 'login-check' || context.skillName === 'smart-price-adjust') && this.cookieService) {
```

但 smart-price-adjust 需要多个域名的 Cookie（根据 platformCode 不同）。更好的方案是：**在脚本内部根据 platformCode 从环境变量获取 Cookie**，或者让 Playwright 通过 CDP 连接后自动继承 Electron 的 Cookie（CDP 模式下 Cookie 是共享的）。

**最终方案**：CDP 模式下 Playwright 连接到 Electron 后，自动继承 Electron session 的所有 Cookie，不需要额外注入。

### D-5: 文件布局
```
scripts/smart-price-adjust/
├── index.js                    ← 桥接入口（从 argv[2] 读参数，调用 host-adapter）
├── host-adapter.js             ← 新版 host 适配层
├── host-cli.js                 ← CLI 入口（保留，用于手动测试）
├── router.js                   ← 平台路由
├── result-mapper.js            ← 结果归一化
├── login-precheck-adapter.js   ← 新增：适配 login-checker 接口
├── shared/                     ← 共享工具
│   ├── formal-input.js
│   ├── batch-normalizer.js
│   ├── failure-codes.js
│   ├── failure-normalizer.js
│   ├── result-normalizer.js
│   ├── segment-orchestrator.js
│   ├── constants.js
│   ├── logger.js
│   ├── platform-result.js
│   ├── utils.js
│   └── validate.js
├── platforms/
│   ├── ctrip/                  ← 携程执行链路
│   ├── meituan/                ← 美团执行链路
│   ├── trip/                   ← Trip 执行链路
│   ├── booking/                ← Booking 执行链路
│   └── feizhu/                 ← 飞猪执行链路
├── examples/                   ← 测试用例
├── smokes/                     ← 回归测试
└── tools/                      ← 工具脚本
```

## 实施步骤

### Task 1: 复制新版文件到 scripts/smart-price-adjust/
- 备份旧版（可选）
- 将 `smart-price-adjust/scripts/*` 复制到 `scripts/smart-price-adjust/`
- 保留旧版的 `test-cdp.js`

### Task 2: 创建桥接入口 index.js
- 从 `process.argv[2]` 读取 JSON 参数
- 调用 `host-adapter.js` 的 `runSmartPriceAdjustForHost()`
- 通过 stdout 输出 JSON 结果
- 写诊断文件到 `DATA_DIR`

### Task 3: 创建 login-precheck-adapter.js
- 适配 `login-checker/scripts/` 的接口到新版期望的 `precheckOtaLoginBeforeAdjust` 接口
- 修改 `index.js`（新版的核心逻辑文件，非桥接入口）的 require 路径

### Task 4: 适配各平台 runtime.js 为 CDP 模式
- 修改 ctrip/meituan/trip/booking 的 runtime.js
- 优先使用 `SMART_PRICE_CDP_PORT` 环境变量连接 Electron CDP
- Fallback 到独立 Chrome 模式

### Task 5: 更新 SKILL.md
- 用新版 formal schema 更新参数定义
- 更新调用示例

### Task 6: 更新 SkillExecutor
- 对 smart-price-adjust 注入 `SMART_PRICE_CDP_PORT` 环境变量

### Task 7: 验证
- 运行 `node --check` 语法检查
- 运行 smoke tests
- 手动触发一次调价验证
