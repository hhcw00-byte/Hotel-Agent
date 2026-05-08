---
name: api-ctrip-backend-price
description: 携程 ebooking 后台实时房价API。当用户要求查看"携程后台实时房价"等实时数据时调用。返回酒店房型、价格等数据。仅支持查询本店数据。
script: scripts/api-ctrip-backend-price/index.js
type: tool
user-invocable: false
parameters:
  cookieDomain:
    type: string
    description: Cookie域名，用于自动注入浏览器Cookie
    required: true
  startDate:
    type: string
    description: 开始日期(YYYY-MM-DD)，默认今天
    required: false
  endDate:
    type: string
    description: 结束日期(YYYY-MM-DD)，默认14天后
    required: false
---

## 使用方法

### 查询本店价格
直接调用，只需传 cookieDomain，其他参数都有默认值：
{ "cookieDomain": "ebooking.ctrip.com" }

## 返回值说明
调用成功时返回 { success: true, data: {API原始响应} }。
原始数据结构复杂，不要直接阅读。请调用 data-store 解析：
- 入库场景：data-store({ source: "api-ctrip-backend-price" })
- 仅查看场景：data-store({ source: "api-ctrip-backend-price", parseOnly: true })
data-store 返回标准化的 { platform, data: [{ roomName, price, date, ... }] }。

## API失效时的恢复（仅在调用返回失败时才执行，正常调用时忽略此段）
start_url: https://ebooking.ctrip.com/
target: 房价管理或房量日历页面，查看房型房价数据
