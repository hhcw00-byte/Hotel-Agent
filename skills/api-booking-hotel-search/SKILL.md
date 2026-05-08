---
name: api-booking-hotel-search
description: Booking.com酒店搜索。通过酒店名查询Booking酒店的URL slug，用于后续房价采集。返回slug、destId、countryCode。
script: scripts/api-booking-hotel-search/index.js
type: tool
user-invocable: false
parameters:
  keyword:
    type: string
    description: 酒店名称关键词
    required: true
  cookieDomain:
    type: string
    description: Cookie域名，固定为www.booking.com
    required: true
---

## 使用方法
传入酒店名称关键词，返回该酒店在 Booking 上的 URL slug。

示例：
{ "cookieDomain": "www.booking.com", "keyword": "北京三里屯通盈中心洲际酒店" }

## 返回值
成功时返回：
```json
{
  "success": true,
  "data": {
    "slug": "intercontinental-beijing-sanlitun",
    "destId": "1693270",
    "countryCode": "cn",
    "hotelName": "北京三里屯通盈中心洲际酒店"
  }
}
```

## 特殊说明
- 需要有效的 www.booking.com Cookie（浏览器中需已访问过 Booking）
- 内部流程：GraphQL AutoComplete 搜索 → 搜索结果页 HTML 正则提取 slug
- 如果返回 WAF_BLOCKED，说明 Cookie 过期，需要在浏览器中刷新 booking.com

## API失效时的恢复
start_url: https://www.booking.com/
target: 在搜索框输入酒店名触发搜索建议
