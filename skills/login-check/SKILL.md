---
name: login-check
description: 检测各OTA平台登录状态。逐个打开后台标签页访问平台URL，检测页面是否为登录页，返回各平台登录状态。
script: scripts/login-check/index.js
type: tool
user-invocable: false
parameters:
  platforms:
    type: array
    description: "平台列表，每项包含 domain、url、name。不传则检测所有已配置平台。"
    required: false
    items:
      type: object
---

## 使用方法

系统内部调用，不由用户直接触发。

### 调用示例（检测所有平台）
```json
{}
```

### 调用示例（检测指定平台）
```json
{
  "platforms": [
    { "domain": "ebooking.ctrip.com", "url": "https://ebooking.ctrip.com/", "name": "携程后台" },
    { "domain": "admin.booking.com", "url": "https://admin.booking.com/", "name": "Booking后台" }
  ]
}
```

## 返回值
```json
{
  "success": true,
  "results": [
    { "domain": "ebooking.ctrip.com", "name": "携程后台", "isLoggedIn": true, "confidence": 0.1 },
    { "domain": "admin.booking.com", "name": "Booking后台", "isLoggedIn": false, "confidence": 0.85 }
  ],
  "summary": { "total": 2, "loggedIn": 1, "notLoggedIn": 1, "errors": 0 }
}
```

## 注意事项
- 检测通过后台标签页进行，不影响用户正在浏览的页面
- 每个平台检测约需 3-7 秒，全部平台约 30-50 秒
- 检测出错时默认为"已登录"（不会误报）
