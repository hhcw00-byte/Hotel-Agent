---
name: ota-login-checker
description: OTA 登录状态检测工具。用于检测携程、美团、Trip、Booking、飞猪等 OTA 后台浏览器会话是否已登录。适用于一键调价前置登录校验、平台账号状态诊断、后台自动化任务启动前检查。只检测登录态，不执行登录、不改价、不提交。
type: checker
tags: [OTA, 登录检测, 登录态校验, 浏览器会话, Playwright, 一键调价前置校验]
disable-model-invocation: false
---

# OTA 登录状态检测工具

## 核心定位

本 skill 是 OTA 后台登录态检测工具，只回答“当前平台后台会话是否已登录”。

它不负责执行任何 OTA 业务动作，不处理登录流程，不修改平台业务数据。

## 适用场景

- 一键调价前检查平台是否登录。
- 后台自动化任务启动前做登录预检。
- 平台账号状态诊断。
- 检查指定 `pageUrl` 是否能进入后台页面。
- 判断当前会话是否被重定向到登录页。

## 禁止事项

- 禁止自动登录。
- 禁止处理验证码、扫码、短信验证。
- 禁止执行调价。
- 禁止填写价格。
- 禁止选择日期。
- 禁止匹配房型。
- 禁止点击保存或提交。
- 禁止修改 `smart-price-adjust` 执行链路。
- 禁止修改 OTA 平台业务数据。

## 工作机制

1. 根据 `platformCode` 选择平台规则。
2. 打开 `pageUrl` 或平台默认检测地址。
3. 复用 `userDataDir`、`profileDir` 或 `storageStatePath` 中的登录态。
4. 检查 `currentUrl` 是否进入登录页。
5. 检查页面文本、后台 marker、URL 规则。
6. 返回结构化结果。

## 最小调用示例

```js
const { execute } = require("./skills/ota-login-checker/scripts");

const result = await execute({
  platformCode: "ctrip",
  pageUrl: "https://ebooking.ctrip.com/rateplan/batchPriceSetting?microJump=true",
  userDataDir: "C:\\hotel-ota-automation\\chrome-profile\\ctrip",
  headless: false,
  timeoutMs: 60000
});
```

## 输入契约

调用 `scripts/index.js` 中的 `execute(input, options)`。

| 字段 | 说明 |
| --- | --- |
| `platformCode` | OTA 平台编码，支持 `ctrip`、`meituan`、`trip`、`booking`、`feizhu`。 |
| `storeId` | 宿主系统门店标识，仅用于 evidence 回显。 |
| `pageUrl` | 检测用目标后台地址；未传时使用平台默认检测地址。 |
| `userDataDir` | 已登录 OTA 后台的 Chrome 持久化目录。 |
| `profileDir` | 已登录 OTA 后台的 Chrome 持久化目录，语义同 `userDataDir`。 |
| `storageStatePath` | Playwright storage state 文件路径，适合非持久化 context。 |
| `headless` | 是否无头运行浏览器。 |
| `timeoutMs` | 页面导航和检测超时时间，单位毫秒。 |

真实检测登录态时，应传入登录过 OTA 的 Chrome profile 目录。只传 `pageUrl` 不等于使用已登录浏览器。

## 输出契约

| 字段 | 说明 |
| --- | --- |
| `success` | 是否确认已登录。 |
| `platformCode` | 归一化后的平台编码。 |
| `loginStatus` | 登录态分类：`logged_in`、`logged_out`、`unknown`、`error`。 |
| `failureReasonCode` | 稳定结果码：`LOGIN_CHECK_PASSED`、`OTA_NOT_LOGGED_IN`、`LOGIN_CHECK_UNKNOWN`、`LOGIN_CHECK_ERROR`、`INVALID_INPUT`、`UNSUPPORTED_PLATFORM`。 |
| `message` | 简短可读状态说明。 |
| `evidence` | 检测证据，包括目标 URL、当前 URL、命中规则、页面 marker、检测时间等。 |
| `rawResult` | 底层 checker 原始结果，供诊断使用。 |

## 登录态判断标准

- `logged_in`：确认进入后台页面，未被重定向到登录页。
- `logged_out`：明确进入登录页、sign-in 页或命中登录 marker。
- `unknown`：页面状态不足以稳定判断。
- `error`：参数错误、平台不支持或执行异常。

## 与 smart-price-adjust 的关系

- 本 skill 独立位于 `skills/ota-login-checker`。
- 当前仅完成独立 skill 封装。
- `smart-price-adjust` 旧登录检测路径仍保持现状。
- `smart-price-adjust` 尚未切换到本 skill。
- 本 skill 不主动替换 `smart-price-adjust` 的旧调用链。
- 是否切换调用关系，应作为后续单独任务处理。
- 后续如需切换，必须单独做 adapter 和一键调价回归测试。
- 不允许在本任务中修改 `smart-price-adjust` 调用链。
- 当前封装目标是可复用登录检测能力，不是改造一键调价链路。

## 维护注意事项

- 所有代码、测试、示例必须放在 `scripts/` 下。
- 根目录只保留 `README.md` 和 `SKILL.md`。
- 新增平台时优先扩展平台规则和测试。
- `failureReasonCode` 必须保持稳定，避免影响宿主系统判断。
- 修改登录判断规则后必须补充测试。
- 不要在本 skill 中引入调价、提交、保存等业务动作。
