---
name: api-meituan-backend-price
description: 美团商家后台房价管理实时API。当用户要求查看"美团商家后台房价管理数据"等实时数据时调用。返回酒店房型、价格、库存等数据。仅支持查询本店数据。
script: scripts/api-meituan-backend-price/index.js
type: tool
user-invocable: false
parameters:
  cookieDomain:
    type: string
    description: Cookie域名，用于自动注入浏览器Cookie
    required: true
  checkIn:
    type: string
    description: 入住日期(YYYY-MM-DD)，默认今天
    required: false
  checkOut:
    type: string
    description: 离店日期(YYYY-MM-DD)，默认今天 + 5天
    required: false
---

## 使用方法

### 查询本店价格（最常用）
直接调用，只需传 cookieDomain，其他参数都有默认值：
{ "cookieDomain": "me.meituan.com" }

## 返回值说明
调用成功时返回 { success: true, data: {API原始响应} }。
原始数据结构复杂，不要直接阅读。请调用 data-store 解析：
- 入库场景：data-store({ source: "api-meituan-backend-price" })
- 仅查看场景：data-store({ source: "api-meituan-backend-price", parseOnly: true })
data-store 返回标准化的 { platform, data: [{ roomName, price, date, ... }] }。

## API失效时的恢复（仅在调用返回失败时才执行，正常调用时忽略此段）
start_url: https://me.meituan.com/
target: 商家后台房价管理页面，查看房型房价库存数据