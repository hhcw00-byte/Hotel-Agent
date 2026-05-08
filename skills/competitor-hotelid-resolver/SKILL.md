---
name: competitor-hotelid-resolver
description: 竞品平台ID解析策略。通过各平台搜索建议API按酒店名精确查询hotelId，写入competitor_platform_ids表。
type: strategy
tags: [竞品, hotelId, 平台ID, 解析, 携程, trip]
disable-model-invocation: false
---

# 竞品平台 ID 解析（API-First 模式）

## 目标

用户已在管理后台添加了竞品酒店（存在 competitors 表，有名称和坐标），但缺少各平台的 hotelId。
本策略通过各平台的搜索建议 API 按酒店名精确查询 hotelId，存入 competitor_platform_ids 表。

## 已验证的 API 记录

> Agent 在发现正确/错误的 API 后，必须更新此区块，供下次执行时直接复用，避免重复试错。

### 携程（ctrip）
- 待发现。导航到携程酒店首页，在搜索框输入酒店名，拦截搜索建议 API。

### Trip.com
- 与携程共享 hotelId，无需单独解析。

### 美团（meituan）
- 待发现。导航到美团酒店首页，在搜索框输入酒店名，拦截搜索建议 API。

### Booking
- ✅ 已验证。使用 `api-booking-hotel-search` skill，传入酒店名 → 返回 slug。
- 流程：GraphQL AutoComplete 搜索 → 搜索结果页 HTML 正则提取 slug
- 需要 Cookie（www.booking.com）
- 存入 `competitor_platform_ids`：`platform='booking'`, `platform_hotel_id=slug`

## 前置条件

- competitors 表中已有竞品列表（name）

## 工作流程

### Step 1: 检查是否已有搜索脚本

**直接检查你的可用工具列表**（即本次对话中可调用的 tool），是否包含 `api-ctrip-hotel-search`。

- **工具列表中有 `api-ctrip-hotel-search`** → **跳过 Step 2 和 Step 3，直接执行 Step 4**。不需要用爬虫重新发现 API，脚本已经存在且可用。
- **工具列表中没有** → 检查上方"已验证的 API 记录"：
  - **目标平台有 ✅ 记录** → **跳过 Step 2，直接进入 Step 3 生成脚本**。已验证记录中包含了 API 端点名称和功能描述，足够你直接编写脚本，不需要爬虫重新发现。
  - **目标平台没有 ✅ 记录** → 进入 Step 2 用爬虫发现 API。

**⚠️ 绝对不要在已有 ✅ 验证记录的情况下去调用 ai-web-crawler，这是浪费且会失败（搜索建议 API 在页面 reload 后不会重新触发）。**

### Step 2: API 发现（首次执行）

调用 ai-web-crawler，导航到目标平台首页，在搜索框输入酒店名触发搜索建议 API：

**携程示例**：
```json
{
  "operation": "fetch_data",
  "start_url": "https://hotels.ctrip.com/",
  "target": "携程酒店首页搜索建议下拉列表",
  "extraction_goal": "拦截搜索建议API（输入时触发的自动补全接口），获取请求结构",
  "navigation_hint": "在搜索框中输入酒店名触发搜索建议下拉。页面可能有多个输入框，系统会自动逐个尝试找到触发搜索建议API的那个。不要点搜索按钮。",
  "intercept_apis": true,
  "background": true
}
```

**从 apiCandidates 中识别搜索建议 API 的通用规则**：
1. requestBody 中有 `keyword`/`query`/`searchText`/`q` 等文本输入字段
2. responsePreview 中有 `id`+`name`/`word`/`title` 的列表结构
3. responseSize 较小（通常 < 10KB，只返回名称+ID）
4. 该 API 在输入时触发（不是点搜索按钮后触发）

**排除规则**：
- 推荐 API（返回的酒店和输入关键词无关，或全是同品牌）
- 附近酒店 API（只返回固定数量如 20 家）
- 搜索列表 API（返回完整酒店卡片含价格图片，responseSize 很大）
- 埋点/配置/广告 API（collect、config、getAd 等）

**⚠️ 先查看上方"已验证的 API 记录"，如果目标平台已有记录，直接使用 ✅ 的 API，不要重新发现。**

### Step 3: 生成搜索脚本

使用 file-operations 生成脚本，严格遵循 api-first-instruction 规范。

**命名**：`api-{platform}-hotel-search`（如 `api-ctrip-hotel-search`）

**携程 gaHotelSearchEngine 脚本参考**（当从已验证记录直接生成时使用）：
- URL: `https://m.ctrip.com/restapi/soa2/21881/json/gaHotelSearchEngine`
- Method: POST
- Headers: 必须包含 `accept: application/json`、`content-type: application/json`、`origin: https://hotels.ctrip.com`、`referer: https://hotels.ctrip.com/`、`user-agent`（完整 Chrome UA）
- requestBody 关键字段：`keyword`（酒店名）、`cityId`（默认1）、`checkIn/checkOut`（YYYYMMDD 动态计算）、`searchType: "K"`、`platform: "online"`、`pageID: "102001"`
- requestBody 必须包含完整的 `head` 对象（含 `Version`、`userRegion`、`Locale`、`Currency`、`Frontend`、`Union`、`HotelExtension` 等子对象），即使值为空字符串也不能删
- 不需要 Cookie，这是公开接口
- 响应路径：`Response.searchResults[]`，每条有 `id`（hotelId）、`type`（"Hotel"）、`word`（酒店名）、`cityId`、`cityName`、`displayName`

**脚本要求**：
- **关键：`head` 对象中的所有字段必须保留，不要删除任何字段，即使值为空字符串。**
- **关键：headers 中必须包含 `user-agent`、`origin`、`referer`。** Node.js 默认不发 UA，缺少会导致返回空数据。
- 参数：params.keyword（酒店名，必填）、params.cityId（城市ID，可选）

**适配器要求**：
- 只取 `type === "Hotel"` 的结果（过滤掉品牌、城市等类型）
- 输出 `{ hotelId: item.id, name: item.word, cityId, cityName, displayName }`

生成三个文件（index.js + adapter.js + SKILL.md）后，调用 `reloadAllSkills` 热加载。

**⚠️ 生成脚本后，先用一个已知酒店名测试一次，确认能返回正确的 hotelId。如果返回空数据或不相关的结果，说明选错了 API，回到 Step 2 重新发现，并更新上方"已验证的 API 记录"标记该 API 为 ❌。**

### Step 4: 逐个查询竞品 hotelId

**⚠️ 调用失败时的修复流程（必须严格按序执行）**：
如果 `api-ctrip-hotel-search` 返回空数据（只有 ResponseStatus 没有实际酒店列表）或报错：
1. **先读脚本修复（策略A）**：用 `file-operations readFile` 读取 `scripts/api-ctrip-hotel-search/index.js`，检查以下常见问题：
   - content-type 与 body 格式不匹配（如 content-type 是 `application/json` 但 body 用了 `URLSearchParams`，或反过来）
   - 缺少必要的 headers（`user-agent`、`origin`、`referer`）
   - URL 拼写错误
   - requestBody 字段缺失或格式错误
   发现问题后用 `file-operations editFile` 修复，然后重新调用 `api-ctrip-hotel-search` 验证。
2. **策略A修复成功** → 继续执行下方的查询流程。
3. **策略A修复失败（修复后仍返回空数据）** → 才进入 Step 2 用爬虫重新发现 API。
4. **绝对不要跳过策略A直接调爬虫**，爬虫是最后手段。

查询流程：

1. 调用 `database-operations` 查询 competitors 表获取竞品列表
2. 对每个竞品，调用 `api-ctrip-hotel-search`，传入竞品酒店名作为 keyword
3. 从返回结果中筛选 `type: "Hotel"` 的条目
4. 做名称匹配：
   - **精确匹配**：去除空格和括号差异后完全一致
   - **核心词匹配**：提取品牌名+门店关键词（如"桔子水晶"+"三里屯"），两者都命中即匹配
   - 如果第一条结果的名称就高度匹配，直接采用
5. 匹配成功的，收集所有结果，用 `database-operations` 的 `batch_set_competitor_platform_ids` 一次性批量写入：
   ```json
   {
     "operation": "batch_set_competitor_platform_ids",
     "data": {
       "records": [
         { "competitorId": 1, "platform": "ctrip", "platformHotelId": "123578036", "platformHotelName": "北京三里屯太古里桔子水晶酒店" },
         { "competitorId": 1, "platform": "trip", "platformHotelId": "123578036", "platformHotelName": "北京三里屯太古里桔子水晶酒店" },
         { "competitorId": 2, "platform": "ctrip", "platformHotelId": "894450", "platformHotelName": "汉庭酒店(北京长虹桥团结湖地铁站店)" },
         { "competitorId": 2, "platform": "trip", "platformHotelId": "894450", "platformHotelName": "汉庭酒店(北京长虹桥团结湖地铁站店)" }
       ]
     }
   }
   ```
   - 每个竞品写入 ctrip + trip 两条（携程和 Trip.com 共享 hotelId）
   - `platformHotelName` 填搜索建议 API 返回的酒店名（`word` 字段），用于前端展示

### Step 5: 验证 + 更新 API 记录

1. 如果所有竞品都成功解析 → 在上方"已验证的 API 记录"中确认 ✅ 状态
2. 如果某个 API 返回空数据或不相关结果 → 标记为 ❌ 并记录原因，回到 Step 2 尝试其他 API
3. 使用 `file-operations` 更新本 SKILL.md 文件中的"已验证的 API 记录"区块

### Step 6: 输出解析报告

汇总解析结果，告知用户：
- 成功解析了多少个竞品的 hotelId
- 哪些竞品未能匹配（需要用户确认）
- 各竞品的携程 hotelId

### Step 7: 解析 Booking 平台 slug

**前置条件**：工具列表中有 `api-booking-hotel-search`

对每个竞品，调用 `api-booking-hotel-search`，传入竞品酒店名作为 keyword，cookieDomain 为 `www.booking.com`：

```json
{ "keyword": "北京三里屯通盈中心洲际酒店", "cookieDomain": "www.booking.com" }
```

返回值包含 `slug`、`destId`、`countryCode`、`hotelName`。

将结果写入数据库，使用 `database-operations` 的 `batch_set_competitor_platform_ids`：
```json
{
  "operation": "batch_set_competitor_platform_ids",
  "data": {
    "records": [
      { "competitorId": 1, "platform": "booking", "platformHotelId": "intercontinental-beijing-sanlitun", "platformHotelName": "北京三里屯通盈中心洲际酒店" }
    ]
  }
}
```

**注意**：
- Booking 的 `platformHotelId` 存的是 slug 字符串（不是数字 ID）
- 如果 `api-booking-hotel-search` 返回 `WAF_BLOCKED`，说明 Cookie 过期，跳过 Booking 解析并在报告中说明
- 如果返回 `NO_HOTEL_RESULTS` 或 `NO_MATCH`，说明该竞品在 Booking 上不存在或名称不同，跳过该竞品
- **成功一个存一个**：每解析成功一个竞品的 slug，立即调用 `database-operations` 写入，不要等全部完成再批量写
- **宁缺毋错**：如果返回的酒店名和搜索关键词明显不匹配（脚本会返回 `NO_MATCH` 错误），绝对不要存入错误数据

## 注意事项

- 本策略优先解析携程 hotelId（同时覆盖 Trip.com），其他平台后续迭代
- hotelId 解析是一次性操作，解析成功后存入数据库，后续采集直接使用
- 搜索建议 API 通常是公开接口，不需要 Cookie/登录态
- keyword 建议传酒店全名（如"北京三里屯太古里桔子水晶酒店"），匹配精度最高
- 如果全名匹配不到，可以尝试缩短关键词（如"桔子水晶 三里屯"）
- **Agent 每次发现新的 API（无论成功还是失败），都必须更新本文件的"已验证的 API 记录"区块，这是跨次执行的知识积累。**
