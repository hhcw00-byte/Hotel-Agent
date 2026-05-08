---
name: api-booking-public-price
description: Booking.com公网房价实时抓取。当用户要求查看"Booking实时房价"等实时数据时调用。通过抓取酒店HTML页面提取嵌入的房型房价JSON数据。
script: scripts/api-booking-public-price/index.js
type: tool
user-invocable: false
parameters:
  cookieDomain:
    type: string
    description: Cookie域名，用于自动注入浏览器Cookie
    required: true
  hotelSlug:
    type: string
    description: Booking.com酒店URL中的slug（如"zhu-xiao-ding-san-li-tun-jiu-dian"），默认本店
    required: false
  countryCode:
    type: string
    description: 国家代码（如"cn"），默认cn
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
{ "cookieDomain": "www.booking.com" }

### 查询指定酒店
传入酒店的 URL slug：
{ "cookieDomain": "www.booking.com", "hotelSlug": "hotel-slug-name" }

## 返回值说明
调用成功时返回 { success: true, data: { rooms: [...], checkIn, checkOut } }。
原始数据来自页面嵌入的 b_rooms_available_and_soldout JSON。请调用 data-store 解析：
- 入库场景：data-store({ source: "api-booking-public-price" })
- 仅查看场景：data-store({ source: "api-booking-public-price", parseOnly: true })
data-store 返回标准化的 { platform, data: [{ roomName, price, date, ... }] }。

## 特殊说明
- Booking.com 没有公开的 JSON API，此技能通过抓取 HTML 页面并解析嵌入的 JSON 数据获取房价
- 如果返回 WAF_BLOCKED 错误，说明被 Booking 反爬拦截，需要刷新浏览器Cookie
- 如果返回 PARSE_FAILED 错误，说明页面结构可能发生变化，需要 Recovery 重新适配

## API失效时的恢复（仅在调用返回失败时才执行，正常调用时忽略此段）
start_url: https://www.booking.com/
target: 搜索住小叮三里屯酒店，进入酒店详情页查看房价
