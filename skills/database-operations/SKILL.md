---
name: database-operations
description: 酒店历史数据查询工具。查询数据库中已采集的房价、房态、竞品数据。适用于趋势分析、历史对比、非实时查询场景。当用户没有明确要求"实时"数据时优先使用。
script: scripts/database-operations/dist/index.js
type: tool
user-invocable: false
parameters:
  operation:
    type: string
    description: "操作类型"
    required: true
    enum: [get_competitors, set_competitor_platform_id, batch_set_competitor_platform_ids, get_pricing_data]
  data:
    type: object
    description: "写入操作的数据对象"
    required: false
  query:
    type: object
    description: "查询操作的查询条件"
    required: false
---

# 数据库操作工具

## 数据表结构

```
price_snapshots     — 所有价格数据（本店+竞品，公网+后台）
room_snapshots      — 所有房态数据（实时+远期）
competitors         — 竞品列表（含位置信息）
competitor_platform_ids — 竞品在各平台的hotelId映射
hotel_config        — 本店配置（名称、地址、经纬度）
room_type_mapping   — 跨平台房型名映射
chat_messages       — 对话记录
```

## 操作说明

### get_competitors — 查询竞品列表

```json
{ "operation": "get_competitors" }
```

### set_competitor_platform_id — 设置竞品平台hotelId

```json
{
  "operation": "set_competitor_platform_id",
  "data": {
    "competitorId": 3,
    "platform": "ctrip",
    "platformHotelId": "894450",
    "platformHotelName": "汉庭酒店(北京长虹桥团结湖地铁站店)"
  }
}
```

### batch_set_competitor_platform_ids — 批量设置竞品平台hotelId

```json
{
  "operation": "batch_set_competitor_platform_ids",
  "data": {
    "records": [
      { "competitorId": 1, "platform": "ctrip", "platformHotelId": "123578036", "platformHotelName": "桔子水晶酒店" },
      { "competitorId": 1, "platform": "trip", "platformHotelId": "123578036", "platformHotelName": "桔子水晶酒店" }
    ]
  }
}
```

### get_pricing_data — 获取智能调价数据

一次性返回房态、本店价格、竞品价格三类数据，供智能调价策略使用。

```json
{
  "operation": "get_pricing_data",
  "query": {
    "startDate": "2026-04-07",
    "endDate": "2026-04-17"
  }
}
```

不传 query 默认取最近3天到未来7天。

返回：
```json
{
  "success": true,
  "data": {
    "roomSnapshots": [{ "platform", "room_name", "date", "total_rooms", "available_rooms", "occupancy_rate", "adr", "revpar", "snapshot_time" }],
    "ownPrices": [{ "platform", "room_name", "price", "original_price", "cost", "currency", "date", "plan_name", "breakfast", "available", "source_type", "snapshot_time" }],
    "competitorPrices": [{ "competitor_name", "platform", "room_name", "price", "original_price", "currency", "date", "breakfast", "available", "source_type", "snapshot_time", "hotel_id" }]
  }
}
```
