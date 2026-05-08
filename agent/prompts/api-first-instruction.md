以上是拦截到的候选数据API。请按以下步骤执行：

**第1步：判断目标数据在哪个候选中**
回顾用户的原始请求，从候选中选择包含目标数据的API：
- 价格/房价相关 → 找URL含 price/inventory/pricing/rate 的，或 contentType 含 extracted-json 的HTML页面
- **携程系（ctrip/trip）酒店房价 API**：URL 包含 `RoomList`（如 `getHotelRoomListInland`、`getHotelRoomListOversea`），responseSize 通常 > 200KB（是所有候选中最大的之一）。不要选 `fetchBrowseRecords`（浏览记录）、`fetchRecommendList`（推荐）、`getHotelKeywords`（关键词）等非房价 API。
- 订单相关 → 找URL含 order/booking 的
- 房态/房型相关 → 找URL含 room/status/goods 的
- 评价相关 → 找URL含 review/comment/score 的
- 核心判断依据：URL路径关键词 + responsePreview/responseSchema中的数据字段名
- 如果有多个相关API，选responseSize更大的那个（数据更完整）
- 不要选择明显无关的API（如菜单menus、权限auth、配置config、cookielaw等）
- **酒店名查hotelId（搜索建议/自动补全API）**：当目标是"通过酒店名查平台hotelId"时，要找的是搜索建议/自动补全API，不是搜索列表API或推荐API。识别方法：
  - requestBody 中有 `keyword`/`query`/`searchText`/`q` 等文本输入字段
  - responsePreview 中有 `id`+`name`/`word`/`title` 的列表结构（每条是一个酒店）
  - responseSize 较小（通常 < 10KB，因为只返回名称+ID，不含价格/图片等详情）
  - 该API在搜索框输入时触发（不是点搜索按钮后触发）
  - **排除**：推荐API（返回的酒店和输入关键词无关，或全是同品牌）、附近酒店API（只返回固定数量如20家）、搜索列表API（返回完整酒店卡片含价格图片，responseSize很大）
  - 携程：尚无已验证记录，需从 apiCandidates 中自行识别

**HTML页面候选（contentType含extracted-json）**：
某些网站（如Booking.com）的数据是服务端渲染在HTML中的，没有独立的JSON API。
识别方法：URL以.html结尾，或contentType为text/html+extracted-json。
查看responseSchema里是否包含目标数据的迹象（jsonLd、inlineData、inlineJsHints、tables、priceElements等）。
如果同时存在JSON API和HTML候选，且JSON API的responseSchema包含所需数据，优先选JSON API；否则选HTML候选。

**多API关联场景**：某些网站的数据分散在多个API中（例如房型名称在API-A，房价在API-B，通过roomId关联）。
如果发现用户需要的数据需要组合多个API才能完整获取，在脚本中请求所有相关API并将原始响应一起保存。
如果同一URL被调用了多次（requestBody不同），它们可能返回不同数据集，都需要保留。

**第2步：生成脚本 scripts/api-{platform}-{dataType}/index.js**
**⚠️ 生成前必须参照示例**：recovery prompt 末尾的「脚本参考示例」段落包含经过验证的各平台脚本。严格参照对应平台的示例结构编写，不要凭空发明写法。如果 prompt 中没有示例，用 file-operations readFile 读取 `agent/prompts/script-examples.md`。

脚本的唯一职责是：**正确请求到数据，将原始响应完整保存**。不做数据解析、字段提取或格式转换。

**⚠️ 脚本执行模式（铁律）**：脚本通过 `node index.js '{参数JSON}'` 直接运行，不是被 require 后调用导出函数。必须在顶层立即执行，禁止使用 `module.exports`。参数从 `process.argv[2]` 获取。

**强制脚本骨架（必须严格遵循此结构）**：
```javascript
const { APIRuntime } = require('../api-runtime');
const runtime = new APIRuntime();
const params = JSON.parse(process.argv[2] || '{}');

(async () => {
  // ... 你的请求逻辑
  const response = await runtime.fetch(url, { method, headers, body });
  if (!response.ok) {
    return runtime.outputError('HTTP_ERROR', `status: ${response.status}`);
  }
  runtime.output(response.data);
})();
```

**禁止的写法**：
- ❌ `async function run(params) { ... }  module.exports = { run };` — 脚本不会执行
- ❌ `new APIRuntime('skillName')` — 构造函数不接受参数
- ❌ `import axios from 'axios'` — 禁止使用 axios，只用 runtime.fetch()
- ❌ `runtime.params` / `runtime.axios` — 不存在这些属性

**通用参考模板**：
以下是不同类型 API 脚本的参考写法。根据拦截到的 API 实际结构选择对应模式，不是所有字段都会出现，按实际情况使用。

**模式A：携程系酒店详情页 API（ctrip/trip，含 search + head 结构）**
```javascript
const { APIRuntime } = require('../api-runtime');
const runtime = new APIRuntime();
const params = JSON.parse(process.argv[2] || '{}');

(async () => {
  try {
    const hotelId = params.hotelId || 本店默认ID;
    const checkIn = params.checkIn || new Date().toISOString().split('T')[0];
    const checkOut = params.checkOut || new Date(Date.now() + 86400000).toISOString().split('T')[0];
    const checkInNoDash = checkIn.replace(/-/g, '');
    const checkOutNoDash = checkOut.replace(/-/g, '');

    // URL：保留 _fxpcqlniredt，删除 x-traceID
    const url = '从拦截结果复制，删掉 &x-traceID=xxx 部分';

    // requestBody：完整粘贴拦截到的 JSON，仅动态化以下字段
    const template = JSON.parse('完整粘贴拦截到的requestBody');
    template.search.hotelId = hotelId;
    template.search.checkIn = checkInNoDash;
    template.search.checkOut = checkOutNoDash;
    // filters：将引用 hotelId/酒店名的条目改为动态拼接
    template.search.filters = template.search.filters.map(f => {
      if (f.type === '31' || f.type === '30') {
        return { filterId: '31|' + hotelId, type: '31', value: String(hotelId), title: '' };
      }
      return f;
    });
    // head.extension 中的日期动态化
    if (template.head && template.head.extension) {
      template.head.extension.forEach(e => {
        if (e.name === 'checkIn') e.value = checkIn;
        if (e.name === 'checkOut') e.value = checkOut;
      });
    }
    // 其他所有字段保持原样

    const response = await runtime.fetch(url, {
      method: 'POST',
      headers: {
        // ⚠️ 以下只是示例 4 个 header。实际必须从 apiCandidates[i].requestHeaders 完整复制（见本文档"requestHeaders 处理"铁律）
        'accept': 'application/json',
        'content-type': 'application/json',
        'referer': 'https://对应平台域名/',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      body: JSON.stringify(template)
    });

    if (!response.ok) return runtime.outputError('HTTP_ERROR', `status: ${response.status}`);
    runtime.output(response.data);
  } catch (e) { runtime.outputError('EXCEPTION', e.message); }
})();
```

**模式B：后台管理系统 API（美团PMS等，多步请求、特殊headers）**
```javascript
const { APIRuntime } = require('../api-runtime');
const runtime = new APIRuntime();
const params = JSON.parse(process.argv[2] || '{}');

(async () => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const endDate = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];

    // 后台 API 通常有特殊 headers（必须从 apiCandidates[i].requestHeaders 完整复制，不要筛选）
    // 见本文档"requestHeaders 处理"铁律
    const headers = {
      'content-type': 'application/json;charset=UTF-8',
      // 以下仅示例。实际要把 apiCandidates[i].requestHeaders 里每个 header 都复制过来（除本文档列出的可删除项）
      'hotelpms-platform': 'pc',
      'm-appkey': 'fe_com.sankuai.hotelpms.fe.web'
    };

    // 步骤1：获取基础数据（如房型列表），用于构造后续请求
    const step1Resp = await runtime.fetch('步骤1的URL', {
      method: 'POST', headers,
      body: JSON.stringify(从拦截结果复制的requestBody)
    });
    if (!step1Resp.ok) return runtime.outputError('STEP1_ERROR', `status: ${step1Resp.status}`);

    // 从步骤1结果中提取后续请求需要的参数
    const extractedData = step1Resp.data.xxx;

    // 步骤2：用提取的参数请求目标数据
    const step2Resp = await runtime.fetch('步骤2的URL', {
      method: 'POST', headers,
      body: JSON.stringify({ ...从拦截结果复制, 动态字段: extractedData, beginDate: today, endDate: endDate })
    });
    if (!step2Resp.ok) return runtime.outputError('STEP2_ERROR', `status: ${step2Resp.status}`);

    runtime.output(step2Resp.data);
  } catch (e) { runtime.outputError('EXCEPTION', e.message); }
})();
```

**模式C：简单查询 API（搜索建议、关键词查询等）**
```javascript
const { APIRuntime } = require('../api-runtime');
const runtime = new APIRuntime();
const params = JSON.parse(process.argv[2] || '{}');

(async () => {
  try {
    if (!params.keyword) return runtime.outputError('MISSING_PARAM', 'keyword is required');

    const response = await runtime.fetch('从拦截结果复制的URL', {
      method: 'POST',
      headers: {
        'content-type': '从拦截结果复制（application/json 或 application/x-www-form-urlencoded）',
        'referer': 'https://对应平台域名/',
        'user-agent': 'Mozilla/5.0 ...'
      },
      body: '根据 content-type 选择 JSON.stringify(obj) 或 new URLSearchParams(obj).toString()'
    });

    if (!response.ok) return runtime.outputError('HTTP_ERROR', `status: ${response.status}`);
    runtime.output(response.data);
  } catch (e) { runtime.outputError('EXCEPTION', e.message); }
})();
```

**注意**：以上模板仅供参考，不是所有 API 都包含 search/head/filters/extension 等结构。根据拦截到的 apiCandidate 的实际 requestBody 结构来决定哪些字段存在、哪些需要动态化。核心原则：**完整保留拦截到的 requestBody，只动态化日期、hotelId、filters 中的 hotelId 引用。**

具体规则：
- require('../api-runtime') 获取 APIRuntime
- **requestBody 处理流程（严格遵守）**：
  1. 将候选的 requestBody **完整粘贴**为一个 const 对象（保留所有字段，包括看起来无用的空字符串、空数组、布尔值等）
  2. **仅替换**需要动态化的字段（日期、hotelId 等），其他字段**一个都不要删、不要改、不要重新组织**
  3. 特别注意 `head` 对象中的 `aid`、`sid`、`ouid`、`guid`、`isSSR`、`extension` 等字段，即使值为空字符串或 false 也必须保留，**即使值看起来像 session/tracking ID 也必须原样保留**（这些值是服务端校验必需的，不是动态值）
  4. 如果 requestBody 中有你不理解的字段（如 `hotelIdFilter`、`marketInfo`、`extraFilter`），**原样保留**，不要删除
  5. **推荐做法**：先将整个 requestBody JSON 字符串赋值给一个变量，然后用 `JSON.parse()` 解析为对象，再只修改需要动态化的字段。这样可以确保不会遗漏任何字段：
  ```javascript
  // 从拦截到的 requestBody 完整复制（一个字符都不要改）
  const template = JSON.parse('这里粘贴完整的requestBody字符串');
  // 仅修改动态字段
  template.date.dateInfo.checkInDate = checkInDate;
  template.date.dateInfo.checkOutDate = checkOutDate;
  template.head.extension[1].value = checkInDash;  // 按索引修改
  // 其他所有字段保持原样
  ```
  6. **需要动态化的字段（白名单，仅这些字段可以改）**：
     - 日期相关：checkIn、checkOut、checkInDate、checkOutDate、beginDate、endDate
     - 酒店ID：hotelId（从 params.hotelId 读取，**默认值必须设为本店在该平台的 hotelId，不要用爬虫导航时搜索到的酒店 ID**。本店 hotelId 来源：recovery prompt 中的"本店平台 ID"段落，或 database-operations 查询 hotel_config 表的 ctrip_hotel_id / meituan_hotel_id / booking_hotel_id 字段）
     - 分页：pageIndex、pageSize
     - **filters 数组中引用了 hotelId 或酒店名的条目**：将硬编码的酒店名/ID 替换为 `hotelId` 变量。例如 `"filterId": "31|129175148"` 改为 `"filterId": "31|" + hotelId`，`"filterId": "30|北京某某酒店"` 改为 `"filterId": "31|" + hotelId`（统一用 type 31 + hotelId）
  7. **URL 处理**：从候选原样复制，但删除 `x-traceID` 参数（traceID 是请求级别的，硬编码会导致日志追踪混乱）。保留 `_fxpcqlniredt` 等其他参数。
  8. **requestHeaders 处理（铁律 — 直接决定请求能否通过风控）**：
     从 `apiCandidates[i].requestHeaders` **完整复制**所有 header 到脚本的 headers 对象中。**不要筛选，不要自作主张删除任何 header**。尤其是以下平台自定义/反爬 header 必须保留，它们是服务端风控校验的关键：
     - 携程/Trip.com（ctrip/trip）：`phantom-token`、`rmstoken`、`ebk-cid`、`x-requested-with`、`origin`、`priority`、`accept-language`
     - 美团（meituan）：`m-appkey`、`hotelpms-client-id`、`hotelpms-platform`、`locale`、`logintype`、`mtgsig`、`x-requested-with`
     - 其他平台出现的任意 `x-xxx`、`hotelpms-xxx`、`ebk-xxx`、`m-xxx` 前缀 header 全部保留
     这些 token 确实是 session 级别会过期的，但**脚本必须完整带上才能当下跑通**；过期后会由 Recovery 链路重新拦截并重写脚本，不是你现在要担心的问题。丢 header 比硬编码 session token 危害大 100 倍。

     **可以删除的 header（仅这些）**：
     - HTTP/2 伪 header：`:authority`、`:method`、`:path`、`:scheme`（fetch 会自动填，硬写会报错）
     - 浏览器 UA 指纹：`sec-ch-ua`、`sec-ch-ua-mobile`、`sec-ch-ua-platform`、`sec-fetch-dest`、`sec-fetch-mode`、`sec-fetch-site`、`upgrade-insecure-requests`
     - 运行时自动处理：`accept-encoding`、`host`、`content-length`
     - Cookie：`cookie`/`Cookie` 必须删（runtime 会自动注入最新 cookie，硬编码 cookie 会过期且覆盖自动注入）
- Cookie 用 runtime.getCookies()
- 用 runtime.output(response.data) 直接输出原始响应，不做任何加工
- 如果请求失败（!response.ok），用 runtime.outputError() 报错，**同时输出 response.data 的内容**以便调试
- **禁止硬编码任何数据值**（价格、房型名等），所有数据必须来自实际HTTP响应
- **多API时**：依次请求，将所有原始响应打包在一个对象中输出，如 runtime.output({ api1: resp1.data, api2: resp2.data })

**第3步：生成数据适配器 scripts/api-{platform}-{dataType}/adapter.js**
适配器负责将 API 原始响应转换为标准格式，供 data-store 入库使用。基于你在第1步分析的 responseSchema/responsePreview，编写映射逻辑。

输出格式：
```js
function adapt(rawData) {
  // ... 映射逻辑
  return { platform: 'xxx', data: [{ roomName, date?, price?, originalPrice?, cost?, currency?, breakfast?, available?, planName?, totalRooms?, availableRooms?, occupancyRate?, adr?, revpar?, sourceType? }] };
}
module.exports = { adapt };
```

规则：
- 如果原始数据包含多日价格（如 priceMap[date]），必须遍历所有日期，每天输出一条记录
- price 单位统一为元（如美团分→元需 /100）
- date 格式 YYYY-MM-DD
- currency 默认 'CNY'，国际站用 'USD'
- sourceType 设为 'public' 或 'backend'（根据数据来源）
- 禁止硬编码任何数据值
- record 中 price != null 的会写入 price_snapshots，availableRooms != null 的会写入 room_snapshots

**availableRooms 映射铁律（违反会污染房态数据）**：
- **公网 API（sourceType='public'）**：`availableRooms` 必须设为 `null`。公网 API 不暴露真实库存，携程/Trip.com 的 `remainRoomQuantity=9999` 表示"充足"而非真实房间数，美团公网同理。将这些假值写入 room_snapshots 会严重污染房态数据。
- **后台/PMS API（sourceType='backend'）**：只有后台系统（如美团PMS、携程ebooking）才有真实的房间库存数据，此时才应该映射 `availableRooms`。但即使是后台 API，`availableRooms >= 999` 的值也表示"不限量"（美团 `limitRemain=999/9999`、携程 `remainRoomQuantity=9999`），必须设为 `null`。
- 简单判断：skill 名含 `backend` 或 `realtime-status` 或 `pms` → sourceType='backend'，可以映射 availableRooms（但 >= 999 设为 null）；否则 → sourceType='public'，availableRooms 必须为 null。
- **代码模板**：`availableRooms: (val != null && val < 999) ? val : null`

**第4步：生成 skills/api-{platform}-{dataType}/SKILL.md**
文件必须以 YAML front-matter 开头（用 `---` 包裹），否则系统无法识别为可执行 skill。

**⚠️ SKILL.md 是其他 Agent（对话 Agent、心跳系统）调用此 skill 的唯一参考文档。写得不清楚会导致调用者传错参数、不知道怎么用返回值、误触发爬虫。必须按以下模板完整生成，不要省略任何段落。**

格式模板：
```
---
name: api-{platform}-{dataType}
description: {平台名}{数据类型}实时API。当用户要求查看"{平台}实时{数据类型}"等实时数据时调用。返回酒店房型、价格等数据。支持通过 hotelId 参数查询竞品酒店。
script: scripts/api-{platform}-{dataType}/index.js
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
{ "cookieDomain": "{对应域名}" }

### 查询竞品价格
传入竞品在该平台的 hotelId（从 database-operations get_competitors 获取 competitor_platform_ids）：
{ "cookieDomain": "{对应域名}", "hotelId": 竞品平台hotelId }

## 返回值说明
调用成功时返回 { success: true, data: {API原始响应} }。
原始数据结构复杂，不要直接阅读。请调用 data-store 解析：
- 入库场景：data-store({ source: "api-{platform}-{dataType}" })
- 仅查看场景：data-store({ source: "api-{platform}-{dataType}", parseOnly: true })
data-store 返回标准化的 { platform, data: [{ roomName, price, date, ... }] }。

## API失效时的恢复（仅在调用返回失败时才执行，正常调用时忽略此段）
start_url: {平台首页URL}
target: {导航目标描述}
```

**SKILL.md 编写铁律：**
- parameters 必须声明脚本中通过 `params.xxx` 实际读取的**所有**字段（cookieDomain、hotelId、checkIn、checkOut、startDate、endDate 等），不要遗漏
- 如果脚本中有 `params.hotelId`（几乎所有价格类脚本都有），parameters 中**必须声明 hotelId** 并说明"不传查本店，传竞品ID查竞品"
- description 必须包含"支持通过 hotelId 参数查询竞品酒店"（让调用者知道这个能力存在）
- "返回值说明"段落必须告知调用者"原始数据复杂，用 data-store parseOnly 解析"
- "API失效时的恢复"段落必须标注"仅在调用返回失败时才执行"，防止正常调用时误触发爬虫
- 后台类 API（skill 名含 backend/pms/realtime-status）通常不支持 hotelId 参数（后台只能查自己酒店），此时 parameters 中不声明 hotelId，使用方法中说明"仅支持查询本店数据"

禁止调用data-persistence，禁止再次调用ai-web-crawler。

**第5步：执行验证 + 自动修正（必须执行，不可跳过）**
生成三个文件后，必须立即验证脚本能正确获取数据。禁止仅生成脚本就结束。

1. 调用 `reloadAllSkills` 热加载新 skill（file-operations 写入 skills/ 目录时会自动触发）
2. 调用刚生成的 api-* skill（传入 cookieDomain），检查返回结果：
   - **success:true 且 data 非空** → 验证通过，继续第 3 步
   - **success:true 但 data 只有 ResponseStatus 没有实际数据** → 脚本请求成功但服务端返回空壳，进入修正流程
   - **success:false 或脚本报错** → 进入修正流程
3. 调用 data-store({ source: "skill名" }) 入库
   - 如果 savedCount > 0 → 完成
   - 如果 savedCount=0 但 totalRecords>0 → adapter 字段映射有误，进入修正流程

**修正流程（最多重试 2 次）**：
1. 用 file-operations readFile 读取刚生成的 scripts/{skill}/index.js
2. 对照以下检查清单逐项排查：
   - hotelId 默认值是否为本店 ID（不是爬虫导航时搜索的酒店 ID）
   - filters 中是否硬编码了酒店名或非本店 ID（应改为 `"31|" + hotelId`）
   - URL 是否包含 x-traceID（应删除）
   - headers 是否**漏复制了**拦截到的平台自定义 header（phantom-token/rmstoken/ebk-cid/m-appkey/mtgsig 等必须从 apiCandidates[i].requestHeaders 完整复制；只删本文档"可以删除的 header"列出的项）
   - content-type 是否与 body 格式匹配（JSON body 对应 application/json，URLSearchParams 对应 application/x-www-form-urlencoded）
   - isRSC 是否为 false
   - 日期是否动态计算（不是硬编码）
3. 用 file-operations editFile 修复发现的问题
4. 重新执行 api-* skill 验证
5. 如果 adapter 映射有误：读取 data/api-results/ 下该 skill 的最新 JSON 文件，对照实际数据结构修复 adapter.js 的字段路径，重新调用 data-store 验证