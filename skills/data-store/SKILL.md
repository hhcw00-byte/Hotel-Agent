---
name: data-store
description: API 数据解析与入库工具。调用 adapter 将原始 API 响应解析为标准格式，可选入库。支持 parseOnly 模式（只解析不入库，适合对话场景快速获取结构化数据）。
script: scripts/data-store/index.js
type: tool
user-invocable: false
parameters:
  source:
    type: string
    description: 数据来源skill名称（如 api-ctrip-public-price）
    required: true
  parseOnly:
    type: boolean
    description: 设为 true 时只解析不入库，直接返回标准化数据。适合对话中需要快速查看解析后数据的场景。
    required: false
  hotelId:
    type: number
    description: 酒店ID（0=本店，>0=竞品ID）
    required: false
---
# 数据解析与存储

## 使用方法

### 解析+入库（心跳/采集场景）
调用 api-* 获取原始数据后，调用 data-store 一步完成解析+入库。
```json
{ "source": "api-ctrip-public-price" }
```

### 仅解析（对话场景）
API 原始数据量大且结构复杂，直接阅读容易出错。调用 data-store 的 parseOnly 模式可快速获取结构化数据。
```json
{ "source": "api-meituan-realtime-status", "parseOnly": true }
```

## 输出
```json
{
  "success": true,
  "platform": "ctrip-public",
  "savedCount": 5,
  "totalRecords": 5,
  "data": [{ "roomName": "...", "price": 100, "date": "2026-04-14", ... }]
}
```
