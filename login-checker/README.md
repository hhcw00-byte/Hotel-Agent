# OTA 登录状态检测 Skill

## 一、功能简介

本 skill 用于检测 OTA 后台浏览器会话是否已登录，支持 `ctrip`、`meituan`、`trip`、`booking`、`feizhu`。

它只做登录态检测，不执行登录、不改价、不保存、不提交。适合作为一键调价前置登录校验、平台账号状态诊断、后台自动化任务启动前检查使用。

## 二、目录结构

```text
skills/ota-login-checker/
├── scripts/
├── SKILL.md
└── README.md
```

- 所有代码、测试、示例、CLI 入口都必须放在 `scripts/` 下。
- 根目录只保留 `README.md` 和 `SKILL.md`。

## 三、能力边界

支持：

- 打开指定 OTA 后台页面。
- 判断当前会话是否跳转登录页。
- 根据 URL、页面文本、后台页面 marker 判断登录状态。
- 返回结构化检测结果。
- 支持 `pageUrl` 自定义检测地址。
- 支持 `userDataDir`、`profileDir`、`storageStatePath` 复用登录态。

不支持：

- 不负责输入账号密码。
- 不负责扫码、验证码、短信验证或二次认证。
- 不负责自动登录。
- 不负责一键调价。
- 不负责价格填写、日期选择、房型匹配、提交保存。
- 不负责验证改价结果。

## 四、输入参数说明

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `platformCode` | 是 | OTA 平台编码，支持 `ctrip`、`meituan`、`trip`、`booking`、`feizhu`。 |
| `storeId` | 否 | 宿主系统门店标识，仅用于结果 evidence 回显。 |
| `pageUrl` | 否 | 检测用目标后台地址，可以自定义；未传时使用平台默认检测地址。 |
| `userDataDir` | 否 | 登录态所在的 Chrome 持久化目录。真实检测已登录状态时通常需要传入。 |
| `profileDir` | 否 | 登录态所在的 Chrome 持久化目录，语义同 `userDataDir`。 |
| `storageStatePath` | 否 | Playwright storage state 文件路径，适合非持久化 context。 |
| `headless` | 否 | 是否无头运行浏览器。 |
| `timeoutMs` | 否 | 页面导航和检测超时时间，单位毫秒。 |

重点说明：

- `pageUrl` 是检测用目标后台地址，可以按平台、门店或业务场景自定义。
- `userDataDir` / `profileDir` 是登录态所在的 Chrome 持久化目录。真实检测已登录状态时必须传入已登录过 OTA 后台的目录，否则通常会显示未登录。
- `storageStatePath` 适合非持久化 Playwright context。
- `userDataDir` 优先级高于 `profileDir`。

## 五、输出字段说明

| 字段 | 说明 |
| --- | --- |
| `success` | 是否确认已登录。只有确认进入后台页面时才为 `true`。 |
| `platformCode` | 归一化后的平台编码。 |
| `loginStatus` | 登录态分类。 |
| `failureReasonCode` | 稳定失败码或通过码。 |
| `message` | 简短可读状态说明。 |
| `evidence` | 检测证据，包括目标 URL、当前 URL、命中规则、页面 marker、检测时间等。 |
| `rawResult` | 底层 checker 原始结果，供诊断使用。 |

`loginStatus` 取值：

- `logged_in`：确认已登录。
- `logged_out`：确认未登录。
- `unknown`：页面状态不足以稳定判断。
- `error`：参数错误、平台不支持或检测异常。

`failureReasonCode` 取值：

- `LOGIN_CHECK_PASSED`
- `OTA_NOT_LOGGED_IN`
- `LOGIN_CHECK_UNKNOWN`
- `LOGIN_CHECK_ERROR`
- `INVALID_INPUT`
- `UNSUPPORTED_PLATFORM`

## 六、调用方式

JS 调用：

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

CLI 调用：

```powershell
node skills/ota-login-checker/scripts/host-cli.js --input skills/ota-login-checker/scripts/examples/check-login.example.json
```

## 七、标准输入示例

最小输入：

```json
{
  "platformCode": "ctrip"
}
```

推荐真实检测输入：

```json
{
  "platformCode": "ctrip",
  "pageUrl": "https://ebooking.ctrip.com/rateplan/batchPriceSetting?microJump=true",
  "userDataDir": "C:\\hotel-ota-automation\\chrome-profile\\ctrip",
  "headless": false,
  "timeoutMs": 60000
}
```

## 八、标准输出示例

已登录成功：

```json
{
  "success": true,
  "platformCode": "ctrip",
  "loginStatus": "logged_in",
  "failureReasonCode": "LOGIN_CHECK_PASSED",
  "message": "Ctrip logged in.",
  "evidence": {},
  "rawResult": {}
}
```

未登录：

```json
{
  "success": false,
  "platformCode": "ctrip",
  "loginStatus": "logged_out",
  "failureReasonCode": "OTA_NOT_LOGGED_IN",
  "message": "Ctrip not logged in. Please log in before running OTA automation.",
  "evidence": {},
  "rawResult": {}
}
```

缺少 `platformCode`：

```json
{
  "success": false,
  "platformCode": "",
  "loginStatus": "error",
  "failureReasonCode": "INVALID_INPUT",
  "message": "platformCode is required.",
  "evidence": null,
  "rawResult": null
}
```

不支持平台：

```json
{
  "success": false,
  "platformCode": "unknown_platform",
  "loginStatus": "error",
  "failureReasonCode": "UNSUPPORTED_PLATFORM",
  "message": "Unsupported OTA platform: unknown_platform",
  "evidence": null,
  "rawResult": null
}
```

## 九、五个平台检测示例

携程：

```json
{
  "platformCode": "ctrip",
  "pageUrl": "https://ebooking.ctrip.com/rateplan/batchPriceSetting?microJump=true",
  "userDataDir": "C:\\hotel-ota-automation\\chrome-profile\\ctrip",
  "headless": false,
  "timeoutMs": 60000
}
```

```powershell
node skills/ota-login-checker/scripts/host-cli.js --input skills/ota-login-checker/scripts/examples/check-ctrip-profile.temp.json
```

美团：

```json
{
  "platformCode": "meituan",
  "pageUrl": "https://me.meituan.com/ebooking/merchant/product/batch-price",
  "userDataDir": "C:\\hotel-ota-automation\\chrome-profile\\meituan",
  "headless": false,
  "timeoutMs": 60000
}
```

```powershell
node skills/ota-login-checker/scripts/host-cli.js --input skills/ota-login-checker/scripts/examples/check-meituan-profile.temp.json
```

Trip：

```json
{
  "platformCode": "trip",
  "pageUrl": "https://ebooking.trip.com/home/mainland?microJump=true",
  "userDataDir": "C:\\hotel-ota-automation\\chrome-profile\\trip",
  "headless": false,
  "timeoutMs": 60000
}
```

```powershell
node skills/ota-login-checker/scripts/host-cli.js --input skills/ota-login-checker/scripts/examples/check-trip-profile.temp.json
```

Booking：

```json
{
  "platformCode": "booking",
  "pageUrl": "https://admin.booking.com/hotel/hoteladmin/extranet_ng/manage/calendar/index.html",
  "userDataDir": "C:\\hotel-ota-automation\\chrome-profile\\booking",
  "headless": false,
  "timeoutMs": 60000
}
```

```powershell
node skills/ota-login-checker/scripts/host-cli.js --input skills/ota-login-checker/scripts/examples/check-booking-profile.temp.json
```

飞猪：

```json
{
  "platformCode": "feizhu",
  "pageUrl": "https://hotel.fliggy.com/ebooking/hotelBaseInfoUv.htm#/ebk-rp/batchRoomStatusUpdate?type=price",
  "userDataDir": "C:\\hotel-ota-automation\\chrome-profile\\feizhu",
  "headless": false,
  "timeoutMs": 60000
}
```

```powershell
node skills/ota-login-checker/scripts/host-cli.js --input skills/ota-login-checker/scripts/examples/check-feizhu-profile.temp.json
```

## 十、本地验证命令

```powershell
node --check skills/ota-login-checker/scripts/index.js
node --check skills/ota-login-checker/scripts/checker.js
node --check skills/ota-login-checker/scripts/result-mapper.js
node --check skills/ota-login-checker/scripts/failure-codes.js
node --check skills/ota-login-checker/scripts/host-cli.js
node skills/ota-login-checker/scripts/tests/checker.test.js
node skills/ota-login-checker/scripts/host-cli.js --help
```

## 十一、CMD / PowerShell 注意事项

- 示例命令默认以项目根目录为执行目录。
- CMD 可使用 `cd /d C:\path\to\hotel-modules-ota-automation` 切换盘符和目录。
- PowerShell 不支持 `cd /d`，应使用 `cd "C:\path\to\hotel-modules-ota-automation"` 或 `Set-Location "C:\path\to\hotel-modules-ota-automation"`。

## 十二、当前接入状态

- 本 skill 已独立封装在 `skills/ota-login-checker`。
- 当前 `smart-price-adjust` 仍使用旧路径 `skills/smart-price-adjust/ota-login-checker`。
- 本次文档不表示一键调价已切换到新 skill。
- 切换接入需要后续单独任务和回归测试。

## 十三、常见问题

### 1. 为什么检测结果都显示未登录？

通常是没有传 `userDataDir` / `profileDir`，导致使用临时浏览器上下文。真实检测已登录状态时，应传入已经登录过 OTA 后台的 Chrome profile 目录。

### 2. 检测地址能否自行设置？

可以，通过 `pageUrl` 指定。

### 3. 它会不会影响 smart-price-adjust？

不会。当前 skill 独立存在，不切换 `smart-price-adjust` 旧路径。

### 4. 它会不会真实改价？

不会。它只检测登录态，不填写价格、不选择日期、不保存、不提交。
