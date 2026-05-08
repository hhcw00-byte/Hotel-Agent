---
name: smart-price-adjust-v2
description: OTA 一键调价 V2 真实执行 skill。支持 Ctrip、Trip、Meituan、Booking 四个平台真实改价/保存，兼容单段输入和 segments 多段输入，统一串行执行并返回结构化结果。
type: skill
tags:
  - ota
  - price-adjust
  - hotel
  - execution
  - v2
argument-hint: [price-adjust-payload-json]
disable-model-invocation: true
---

# smart-price-adjust-v2

## 一、Skill 定位

本 Skill 接收已确认的 OTA 调价任务，连接目标 OTA 后台页面，执行房型、日期、价格填写与真实提交/保存，并返回结构化执行结果。

## 二、入口链路

执行链路：

```text
host-cli -> index -> router -> segment-runner -> platform executor
```

正式入口：

在 smart-price-adjust-v2 目录内执行：

```powershell
node .\scripts\host-cli.js --input .\payload.json
```

在项目根目录执行：

```powershell
node .\smart-price-adjust-v2\scripts\host-cli.js --input .\payload.json
```

## 三、封装边界

`smart-price-adjust-v2` 可作为独立 Skill 文件夹封装。四个平台真实改价执行代码均位于 `scripts` 目录下；运行时依赖 Node、Playwright、Chrome/CDP/profile，不依赖旧版 smart-price-adjust 业务代码。

## 四、输入结构

单段兼容结构：

```json
{
  "platformCode": "ctrip",
  "startDate": "2026-05-12",
  "endDate": "2026-05-13",
  "roomList": [
    {
      "roomName": "标准大床房",
      "price": "399"
    }
  ],
  "runtime": {
    "browserChannel": "chrome",
    "connectMode": "cdp",
    "cdpEndpoint": "http://127.0.0.1:9222",
    "userDataDir": "C:/hotel-ota-automation/chrome-profile/ctrip",
    "pricePageUrl": "https://ebooking.ctrip.com/rateplan/batchPriceSetting?microJump=true",
    "timeoutMs": 30000
  }
}
```

多段推荐结构：

```json
{
  "platformCode": "ctrip",
  "segments": [
    {
      "startDate": "2026-05-12",
      "endDate": "2026-05-13",
      "roomList": [
        {
          "roomName": "标准大床房",
          "price": "399"
        }
      ]
    },
    {
      "startDate": "2026-05-19",
      "endDate": "2026-05-20",
      "roomList": [
        {
          "roomName": "标准大床房",
          "price": "429"
        }
      ]
    }
  ],
  "runtime": {
    "browserChannel": "chrome",
    "connectMode": "cdp",
    "cdpEndpoint": "http://127.0.0.1:9222",
    "userDataDir": "C:/hotel-ota-automation/chrome-profile/ctrip",
    "pricePageUrl": "https://ebooking.ctrip.com/rateplan/batchPriceSetting?microJump=true",
    "timeoutMs": 30000
  }
}
```

字段说明：

- `platformCode`：支持 `ctrip` / `trip` / `meituan` / `booking`。
- `startDate` / `endDate`：日期格式为 `YYYY-MM-DD`。
- `roomList`：当前日期段要修改的房型与价格。
- `roomName`：OTA 后台展示名称；Booking 中对应房价计划名，例如 `Standard Rate`。
- `price`：目标价格。
- `segments`：多段数组，存在时优先使用。
- `runtime`：浏览器/CDP/页面运行配置。

`runtime` 可由主项目统一注入；调用方也可以在 payload 中显式传入。真实执行时必须能连接到目标平台已登录的 Chrome/CDP 会话。

执行规则：

- 单段输入会在 `input-normalizer` 内部转换为 `segments[0]`。
- 多段按 `segments[]` 顺序串行执行。
- 如果同时存在 `segments` 和顶层 `startDate/endDate/roomList`，以 `segments` 为准。
- 单段和多段只走同一套 `segment-runner`。
- 任一段失败后停止后续真实执行。
- 后续未执行段返回 `SEGMENT_SKIPPED_AFTER_FAILURE`。

## 五、runtime

支持字段：

- `browserChannel`
- `connectMode`
- `cdpEndpoint`
- `userDataDir`
- `pricePageUrl`
- `timeoutMs`

平台 `pricePageUrl` 示例：

- Ctrip：`https://ebooking.ctrip.com/rateplan/batchPriceSetting?microJump=true`
- Trip：`https://ebooking.trip.com/rateplan/batchPriceSetting`
- Meituan：`https://me.meituan.com/ebooking/merchant/product/batch-price`
- Booking：Booking calendar URL，实际使用当前酒店后台 calendar 页面 URL。

`timeoutMs` 规则：

- 默认 `30000`
- 最大 `30000`
- 超过 `30000` 自动压到 `30000`
- 非法值使用 `30000`

## 六、平台能力表

| 平台 | 单段 | 多段 | 多房型 | 当前限制 |
| --- | --- | --- | --- | --- |
| ctrip | 支持 | 支持 | 支持 | 无特殊限制 |
| trip | 支持 | 支持 | 支持 | 默认英文页面，兼容中文 |
| meituan | 支持 | 支持 | 支持 | 处理原生弹窗和页面活动弹窗 |
| booking | 支持 | 支持 | 每个 segment 仅支持 1 个 room | 仅 CDP live，复用 Bulk edit 面板 |

## 七、平台能力说明

### Ctrip / 携程

- 支持真实提交改价。
- 支持单段和多段日期调价。
- 支持同一日期段内多个房型同时改价。
- 多段任务按 `segments[]` 顺序逐段执行，每段独立提交。
- 房型通过 OTA 后台展示名称匹配，例如 `精选单人间`、`特惠单人间`。

### Trip

- 支持真实提交改价。
- 支持单段和多段日期调价。
- 支持同一日期段内多个房型同时改价。
- 默认适配英文页面，同时兼容中文页面。
- 房型通过 Trip 后台展示名称匹配，例如 `Selected Single Room`、`Bed In Deluxe Hotel Room`。

### Meituan / 美团

- 支持真实提交改价。
- 支持单段和多段日期调价。
- 支持同一日期段内多个房型同时改价。
- 房型通过美团后台展示名称匹配，例如 `精选单人间`、`特惠单人间`。
- 执行过程中会处理影响改价流程的弹窗干扰：
  - 浏览器原生弹窗默认 `dismiss`；
  - 页面活动弹窗仅点击取消、关闭、稍后类按钮；
  - 不点击确认、立即处理、去处理等可能改变业务流程的按钮。

### Booking

- 支持真实保存价格。
- 支持单段和多段日期调价。
- 当前每个 `segment` 仅支持一个 `roomList` 项。
- `roomName` 当前对应 Booking 房价计划名称，例如 `Standard Rate`。
- 使用 CDP 连接已打开的 Booking Chrome 页面。
- 多段任务复用当前 Bulk edit 面板，按段依次修改日期、价格并保存。
- 成功判断基于 Booking 页面保存成功提示，例如：
  - `Your changes were saved successfully`
  - `Your changes were successfully saved`
  - `已成功保存修改`

## 八、返回结构

最终返回 JSON 包含：

- `ok`
- `success`
- `message`
- `platformCode`
- `summary`
- `segmentResults`
- `failureReasonCode`
- `failureReason`
- `failedStep`
- `diagnostics`

`summary` 包含：

- `totalSegments`
- `successSegments`
- `failedSegments`
- `skippedSegments`
- `submittedSegments`
- `stopped`

## 九、message 规则

- 单段成功：`携程改价成功` / `Trip改价成功` / `美团改价成功` / `Booking改价成功`
- 多段成功：`{平台名}改价成功，共N个日期段`，例如 `携程改价成功，共2个日期段`。
- 失败：`平台改价失败，失败步骤：xxx，原因：xxx`

## 十、执行边界

- Booking 单个 `segment` 多房型不支持，返回 `BOOKING_MULTI_ROOM_UNSUPPORTED`。
- 不支持并发执行 `segments`，所有 `segments` 固定串行执行，失败即停。
- 所有平台输出都包含 `segmentResults`。

## 十一、最小验证命令

```powershell
Get-ChildItem .\scripts -Recurse -Filter *.js | ForEach-Object { node --check $_.FullName }
```
