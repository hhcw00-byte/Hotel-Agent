---
name: smart-price-adjust
description: OTA平台一键调价工具V2。支持携程、美团、Trip、Booking四个平台真实改价/保存，兼容单段和多段(segments)输入，支持跨平台批量调价。执行前自动检测目标平台登录状态。
script: scripts/smart-price-adjust/index.js
type: tool
user-invocable: false
parameters:
  platformCode:
    type: string
    description: "OTA平台代码，单平台调价时必须传入：ctrip（携程）、meituan（美团）、trip（Trip.com）、booking（Booking）。跨平台批量调价(tasks模式)时每个task内部自带platformCode，此字段仍建议传入第一个平台代码。"
    required: true
    enum: [ctrip, meituan, trip, booking]
  startDate:
    type: string
    description: "调价开始日期，格式 YYYY-MM-DD（单段模式）"
    required: false
  endDate:
    type: string
    description: "调价结束日期，格式 YYYY-MM-DD（单段模式）"
    required: false
  roomList:
    type: array
    items:
      type: object
    description: "调价房型列表（单段模式）。JSON数组，每项包含 roomName（OTA后台完整房型名，string）和 price（目标价格，string）。示例：[{\"roomName\":\"豪华单人间\",\"price\":\"399\"}]"
    required: false
  segments:
    type: array
    items:
      type: object
    description: "多日期段调价（优先于startDate/endDate/roomList）。JSON数组，每项包含 startDate（string）、endDate（string）、roomList（array）。示例：[{\"startDate\":\"2026-05-12\",\"endDate\":\"2026-05-13\",\"roomList\":[{\"roomName\":\"豪华单人间\",\"price\":\"399\"}]}]"
    required: false
  tasks:
    type: array
    items:
      type: object
    description: "跨平台批量调价。JSON数组，每项是一个独立的单平台调价任务，包含 platformCode（string）及 startDate/endDate/roomList 或 segments。示例：[{\"platformCode\":\"ctrip\",\"startDate\":\"2026-05-01\",\"endDate\":\"2026-05-03\",\"roomList\":[{\"roomName\":\"豪华单人间\",\"price\":\"399\"}]}]"
    required: false
---

## 使用方法

当用户要求调价时直接调用，不需要预览确认。

### 调用模式

三种调用模式互斥，按优先级：`tasks` > `segments` > `startDate/endDate/roomList`

### 单平台单段调价
```json
{
  "platformCode": "ctrip",
  "startDate": "2026-05-01",
  "endDate": "2026-05-03",
  "roomList": [
    { "roomName": "豪华单人间", "price": "399" }
  ]
}
```

### 单平台多段调价（多日期段一次完成）
```json
{
  "platformCode": "ctrip",
  "segments": [
    {
      "startDate": "2026-05-12",
      "endDate": "2026-05-13",
      "roomList": [
        { "roomName": "精选单人间", "price": "374" },
        { "roomName": "豪华单人间", "price": "399" }
      ]
    },
    {
      "startDate": "2026-05-19",
      "endDate": "2026-05-20",
      "roomList": [
        { "roomName": "精选单人间", "price": "389" },
        { "roomName": "豪华单人间", "price": "429" }
      ]
    }
  ]
}
```

### 跨平台批量调价
```json
{
  "tasks": [
    {
      "platformCode": "ctrip",
      "startDate": "2026-05-01",
      "endDate": "2026-05-03",
      "roomList": [
        { "roomName": "豪华单人间", "price": "399" }
      ]
    },
    {
      "platformCode": "meituan",
      "startDate": "2026-05-01",
      "endDate": "2026-05-03",
      "roomList": [
        { "roomName": "精选单人间", "price": "374" }
      ]
    }
  ]
}
```

## 执行规则

- 单段输入会在内部转换为 `segments[0]`
- 多段按 `segments[]` 顺序串行执行
- 如果同时存在 `segments` 和顶层 `startDate/endDate/roomList`，以 `segments` 为准
- 任一段失败后停止后续真实执行，后续段返回 `SEGMENT_SKIPPED_AFTER_FAILURE`
- 批量模式下单个平台失败不影响后续平台

## 登录预检

执行前自动检测所有需要调价的平台登录状态：
- 只检测需要调价的平台（不检测不相关的平台）
- 任一平台未登录 → 全部调价任务终止
- 返回 `OTA_LOGIN_REQUIRED` 错误码

## 返回值说明

单平台成功：
```json
{
  "success": true,
  "data": {
    "ok": true,
    "platformCode": "ctrip",
    "summary": { "totalSegments": 2, "successSegments": 2, "failedSegments": 0, "skippedSegments": 0, "submittedSegments": 2, "stopped": false },
    "segmentResults": [...],
    "message": "携程改价成功，共2个日期段"
  }
}
```

批量成功：
```json
{
  "success": true,
  "data": {
    "ok": true,
    "summary": { "totalPlatforms": 2, "successPlatforms": 2, "failedPlatforms": 0 },
    "platformResults": [...],
    "message": "全部平台改价成功（携程、美团）"
  }
}
```

常见错误码：
- `OTA_LOGIN_REQUIRED`：目标平台未登录，需要先登录
- `ROOM_NOT_FOUND`：房型名不匹配，检查 roomName 是否与OTA后台一致
- `INVALID_INPUT`：参数格式错误
- `CDP_CONNECT_FAILED`：CDP 连接失败
- `SEGMENT_SKIPPED_AFTER_FAILURE`：前一段失败导致跳过

## 平台能力

| 平台 | 单段 | 多段 | 多房型 | 当前限制 |
| --- | --- | --- | --- | --- |
| ctrip | 支持 | 支持 | 支持 | 无 |
| trip | 支持 | 支持 | 支持 | 默认英文页面，兼容中文 |
| meituan | 支持 | 支持 | 支持 | 处理原生弹窗和页面活动弹窗 |
| booking | 支持 | 支持 | 每段仅1个room | 使用 Bulk edit 面板 |

## 注意事项
- 调价操作会真实修改 OTA 平台价格
- roomName 必须与 OTA 后台显示的完整房型名完全一致
- Booking 的 roomName 对应房价计划名称（如 Standard Rate）
- 执行前会自动检测目标平台登录状态，未登录会返回错误提示
