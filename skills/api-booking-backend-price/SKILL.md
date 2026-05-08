---
name: api-booking-backend-price
description: Booking.com商家后台房价房态API。获取本店在Booking后台的房型价格和可售房量数据。需要登录admin.booking.com。
script: scripts/api-booking-backend-price/index.js
type: tool
user-invocable: false
parameters:
  cookieDomain:
    type: string
    description: Cookie域名，固定为admin.booking.com
    required: true
  hotelId:
    type: number
    description: Booking后台酒店ID（从后台URL中获取）
    required: true
  roomIds:
    type: array
    description: 房型ID列表，为空则查询所有房型
    required: false
    items:
      type: string
---

## 使用方法

### 查询本店后台房价
{ "cookieDomain": "admin.booking.com", "hotelId": 15994510 }

## 返回值
成功时返回 { success: true, data: { rooms: [...], hotelId, dates } }
调用 data-store 解析入库：data-store({ source: "api-booking-backend-price" })

## 特殊说明
- 需要在浏览器中登录 admin.booking.com 后台（Cookie 有效即可，不需要保持页面打开）
- hotelId 从后台页面 URL 中获取（hotel_id 参数）
- ses token 自动从 302 重定向中获取，无需手动配置
- 返回未来 30 天的房价和房态数据
- 只能查询本店数据，不能查竞品

## API失效时的恢复
start_url: https://admin.booking.com/
target: 登录后台，进入日历/房价管理页面
