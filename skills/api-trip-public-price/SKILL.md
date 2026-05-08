---
name: api-trip-public-price
description: Trip.com 公网房价实时API。当用户要求查看"Trip.com 实时房价"等实时数据时调用。返回酒店房型、价格等数据。支持通过 hotelId 参数查询竞品酒店。
script: scripts/api-trip-public-price/index.js
type: tool
user-invocable: false
parameters:
  cookieDomain:
    type: string
    description: Cookie域名，用于自动注入浏览器Cookie
    required: true
  hotelId:
    type: number
    description: 酒店ID。不传或传0时查询本店（脚本内有默认值），传竞品的平台hotelId可查询竞品价格。竞品hotelId通过 database-operations 的 get_competitors 获取。
    required: false
  checkIn:
    type: string
    description: 入住日期(YYYY-MM-DD)，默认今天
    required: false
  checkOut:
    type: string
    description: 离店日期(YYYY-MM-DD)，默认明天
    required: false
---

## 使用方法

### 查询本店价格（最常用）
直接调用，只需传 cookieDomain，其他参数都有默认值：
{ "cookieDomain": "trip.com" }

### 查询竞品价格
传入竞品在该平台的 hotelId（从 database-operations get_competitors 获取 competitor_platform_ids）：
{ "cookieDomain": "trip.com", "hotelId": 竞品平台hotelId }

## 返回值说明
调用成功时返回 { success: true, data: {API原始响应} }。
原始数据结构复杂，不要直接阅读。请调用 data-store 解析：
- 入库场景：data-store({ source: "api-trip-public-price" })
- 仅查看场景：data-store({ source: "api-trip-public-price", parseOnly: true })
data-store 返回标准化的 { platform, data: [{ roomName, price, date, ... }] }。

## API失效时的恢复（仅在调用返回失败时才执行，正常调用时忽略此段）
start_url: https://www.trip.com/
target: 搜索住小叮三里屯酒店，进入酒店详情页查看房价