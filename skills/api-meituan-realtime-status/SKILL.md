---
name: api-meituan-realtime-status
description: 美团PMS实时API。当用户要求查看"美团实时房态预测"等实时数据时调用。返回酒店房型、房态预测数据。
script: scripts/api-meituan-realtime-status/index.js
type: tool
user-invocable: false
parameters:
  cookieDomain:
    type: string
    description: Cookie域名，用于自动注入浏览器Cookie
    required: true
---

## 使用方法

### 查询本店房态预测
直接调用，只需传 cookieDomain：
{ "cookieDomain": "pms.meituan.com" }

## 返回值说明
调用成功时返回 { success: true, data: {API原始响应} }。
原始数据结构复杂，不要直接阅读。请调用 data-store 解析：
- 入库场景：data-store({ source: "api-meituan-realtime-status" })
- 仅查看场景：data-store({ source: "api-meituan-realtime-status", parseOnly: true })
data-store 返回标准化的 { platform, data: [{ roomName, date, totalRooms, availableRooms, occupancyRate, adr, revpar, sourceType }] }。

## API失效时的恢复（仅在调用返回失败时才执行，正常调用时忽略此段）
start_url: https://pms.meituan.com/#qk-workbench
target: 房态预测
