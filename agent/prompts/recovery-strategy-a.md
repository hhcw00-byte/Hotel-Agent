## 你的任务：通过爬虫重新拦截 API 并生成/重写脚本

当前错误表明需要重新从网站拦截 API（脚本不存在、Cookie 过期、API 端点变更等）。

{{previousAttempt}}

## 爬虫环境
当前为静默后台模式，爬虫与用户浏览器完全解耦。
调用 ai-web-crawler 时**必须传 start_url**（平台首页URL），爬虫会创建独立隐藏窗口访问该 URL 并自动导航到目标页面。
start_url 应使用平台首页（如 https://www.trip.com/ ），由爬虫的 target 参数引导导航到具体页面。
不要拼酒店详情页URL（格式可能变化导致404），让爬虫通过搜索导航到达目标。
不需要传 tab_keyword。

## 执行步骤

1. 调用 ai-web-crawler：
   - operation: "fetch_data"
   - intercept_apis: true
   - target: 使用任务参数中的 crawlerTarget。如果没有，根据 skill 名称推断导航目标。
   - start_url: 优先使用任务参数中的 startUrl，否则使用平台首页。
2. 从返回的 apiCandidates 中找到正确的 API
3. **生成脚本前必须参照末尾的「脚本参考示例」**，严格参照对应平台的示例结构编写，不要凭空发明写法。
4. 用 file-operations 生成/重写脚本 + adapter + SKILL.md（遵循 APIRuntime 接口规范）：
   - scripts/{{skill}}/index.js — HTTP 获取脚本
   - scripts/{{skill}}/adapter.js — 数据适配器
   - skills/{{skill}}/SKILL.md — 技能定义文件（**必须生成，否则系统无法识别此 skill**）。SKILL.md 格式要求：YAML front-matter 包含 name/description/script/type/parameters，正文包含"使用方法"（含本店查询和竞品查询两种用法）、"返回值说明"（告知调用者用 data-store parseOnly 解析）、"API失效时的恢复"（含 start_url 和 target）。parameters 必须声明脚本中所有 params.xxx 字段（尤其是 hotelId：不传查本店，传竞品ID查竞品）。后台类 API 不支持 hotelId 则不声明。
5. **生成后必须立即执行验证**：调用 {{skill}}({ cookieDomain: "对应域名" })，确认 success:true 且数据非空
6. **验证成功后必须调用 data-store 入库**：调用 data-store({ source: "{{skill}}" })
7. **禁止仅生成脚本就结束，必须完成第5步和第6步**

## headers 透传铁律（决定请求能否通过风控，最常见失败原因）

生成脚本时，headers 对象**必须从选中的 `apiCandidates[i].requestHeaders` 完整复制**。不要自作主张筛选、不要只保留 "核心 4 个"。

**必须保留**（平台风控校验 key）：
- 携程/Trip.com：`phantom-token`、`rmstoken`、`ebk-cid`、`x-requested-with`、`origin`、`priority`、`accept-language`、`referer`
- 美团：`m-appkey`、`hotelpms-client-id`、`hotelpms-platform`、`locale`、`logintype`、`mtgsig`、`x-requested-with`（**注意：URL 中的 mtgsig 等签名参数必须完整保留，不要删除**）
- 通用：任意 `x-xxx`、`hotelpms-xxx`、`ebk-xxx`、`m-xxx` 前缀的自定义 header

**仅这些可删**：
- HTTP/2 伪 header（`:authority`、`:method`、`:path`、`:scheme`）
- 浏览器指纹（`sec-ch-ua*`、`sec-fetch-*`、`upgrade-insecure-requests`）
- 运行时处理项（`accept-encoding`、`host`、`content-length`）
- `cookie`（runtime 自动注入最新 cookie；硬编码会覆盖自动注入导致 cookie 过期后依然无法刷新）

**URL 同理**：从 `apiCandidates[i].url` 完整复制，包含所有 query 参数（如 `_fxpcqlniredt`）；仅删除 `x-traceID`（请求级 trace ID）。

这些 token/参数是 session 级别的，会过期。过期后脚本失败会触发新一轮 Recovery 重新拦截刷新，**不是现在要规避的问题**。丢 header 比"担心 token 过期"有害 100 倍。

## adapter 输出格式
```js
function adapt(rawData) {
  return { platform: 'xxx', data: [{ roomName, date?, price?, originalPrice?, cost?, currency?, breakfast?, available?, planName?, totalRooms?, availableRooms?, occupancyRate?, adr?, revpar?, sourceType? }] };
}
module.exports = { adapt };
```

**availableRooms 铁律**：公网 API（skill 名不含 backend/pms/realtime-status）必须将 `availableRooms` 设为 `null`。后台 API 可映射，但 >= 999 设为 null。代码模板：`availableRooms: (val != null && val < 999) ? val : null`

## 平台特殊规则
- **Booking.com**：通过 HTTP GET 获取 HTML 页面（非 JSON API）。禁止改为 GraphQL。
- **Trip.com**：域名、Locale、Currency、region 等字段必须与拦截到的真实请求一致（Trip 会根据地区重定向到不同子站如 `us.trip.com`），不要跨域名硬改。
- **携程 ebooking 后台（ctrip-backend）**：房价数据需要**两步 API 串行**调用（见末尾"示例4"完整示范）：
  1. POST `https://ebooking.ctrip.com/ebkovsroom/api/inventory/getRcProductList` — **空 body**（靠 cookie session 识别酒店），返回房型列表，从中提取 `productId`
  2. POST `https://ebooking.ctrip.com/ebkovsroom/api/inventory/getRoomInventoryInfo` — body 中 `roomTypeIds` 填第一步的 `productId` 数组，返回日历价格
  只调第二步或 `roomTypeIds` 为空，服务端返回 `{ code: 400, message: "Initial Parameter Error" }`。爬虫拦截时通常能同时捕获这两个 API，在 apiCandidates 里找 URL 含 `getRcProductList` 和 `getRoomInventoryInfo` 的两个候选即可。
- **美团后台（meituan-backend）**：两步 API 串行调用（queryListAndTag → queryPriceInventoryStatusInfo）。两个接口共用同一个 headers 对象，不要加 `m-traceid`。URL 中的 `mtgsig` 等签名参数必须完整保留。`poiId` 传字符串，`partnerId` 传数字。

## APIRuntime 接口规范

脚本通过 `const { APIRuntime } = require('../api-runtime')` 引入运行时。**禁止引入 axios 或其他 HTTP 库。**

**⚠️ 脚本执行模式（铁律）**：脚本通过 `node index.js '{参数JSON}'` 直接运行，不是被 require 后调用导出函数。必须在顶层立即执行，禁止使用 `module.exports = { run }`。参数从 `process.argv[2]` 获取。

```javascript
const { APIRuntime } = require('../api-runtime');
const runtime = new APIRuntime();
const params = JSON.parse(process.argv[2] || '{}');

const result = await runtime.fetch(url, {
  method: 'POST',
  headers: { ... },
  body: JSON.stringify(payload)  // body 必须是字符串
});
// result: { ok, status, data, headers }

runtime.output(data);              // 成功输出
runtime.outputError(code, message); // 错误输出
```

**关键约束：**
- `runtime.fetch()` 是唯一的 HTTP 方法，没有 `runtime.axios`、`runtime.request`、`runtime.post`
- `runtime.fetch()` 的 body 必须是字符串（`JSON.stringify()`）
- Cookie 自动注入，headers 中不要手动设置 Cookie

## 脚本修复铁律
- 日期必须动态计算，禁止硬编码固定日期
- isRSC 必须为 false
- Cookie 通过 runtime.getCookies() 获取，禁止硬编码
- **酒店标识参数（hotelId、hotelSlug、poiId、partnerId）禁止写默认值。** 必须用以下模式：
```javascript
// ✅ 正确写法：缺少参数直接报错
const poiId = params.poiId;
if (!poiId) return runtime.outputError('MISSING_PARAM', 'poiId is required');

// ❌ 错误写法：写了默认值，换酒店就坏
const poiId = params.poiId || '1432564683';
```
即使你在 apiCandidates 的请求 body 中看到了具体的 hotelId/poiId/partnerId 值，也**绝对不能**把它写成默认值。这些值由系统在调用脚本时通过 params 注入，脚本只负责读取。
- **美团后台参数类型**：`poiId` 必须是字符串（`String(params.poiId)`），`partnerId` 必须是数字（`Number(params.partnerId)`）。类型不对会导致美团 API 返回 403。

{{dataSample}}

{{scriptExamples}}
