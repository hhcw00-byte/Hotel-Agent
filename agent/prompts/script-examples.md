# API 脚本参考示例（经过验证的真实脚本）

Agent 生成新脚本时，必须参考以下示例的结构和模式。不要凭空发明写法。

**铁律：所有酒店标识（hotelId、hotelSlug、poiId、partnerId）必须通过 params 传入，禁止在脚本中硬编码默认值。缺少必要参数时返回 MISSING_PARAM 错误。**

---

## 示例1：携程公网房价（POST JSON，hotelId 必传）

### index.js
```javascript
const { APIRuntime } = require('../api-runtime');
const runtime = new APIRuntime();
const params = JSON.parse(process.argv[2] || '{}');

(async () => {
  try {
    const hotelId = params.hotelId;
    if (!hotelId) return runtime.outputError('MISSING_PARAM', 'hotelId is required');
    const checkIn = params.checkIn || new Date().toISOString().split('T')[0];
    const checkOut = params.checkOut || new Date(Date.now() + 86400000).toISOString().split('T')[0];
    const checkInNoDash = checkIn.replace(/-/g, '');
    const checkOutNoDash = checkOut.replace(/-/g, '');

    const url = 'https://m.ctrip.com/restapi/soa2/33278/getHotelRoomListInland?_fxpcqlniredt=09031124119000653723';
    const template = {
      "search": {
        "hotelId": hotelId, "roomId": 0,
        "checkIn": checkInNoDash, "checkOut": checkOutNoDash,
        "roomQuantity": 1, "adult": 2, "childInfoItems": [],
        "isRSC": false, "isSSR": false, "isIjtb": false, "priceType": 2,
        "hotelUniqueKey": "", "mustShowRoomList": [],
        "location": { "geo": { "cityID": 0 } },
        "filters": [{ "filterId": "31|" + hotelId, "type": "31", "value": String(hotelId), "title": "" }],
        "meta": { "fgt": -1, "roomkey": "", "minCurr": "", "minPrice": "", "roomToken": "" },
        "hasAidInUrl": false, "cancelPolicyType": 0, "fixSubhotel": 0,
        "extras": { "loginAB": "", "exposeBedInfos": "", "enableChildAgeGroup": "T", "needEntireSetRoomDesc": "", "closeOnlineRoomListOptimize": true }
      },
      "head": {
        "cid": "1774429134077.24e6dFbJOojG", "ctok": "", "cver": "0", "lang": "01", "sid": "", "syscode": "09",
        "auth": "", "xsid": "",
        "extension": [{ "name": "checkIn", "value": checkIn }, { "name": "checkOut", "value": checkOut }],
        "platform": "PC", "bu": "HBU", "group": "ctrip",
        "locale": "zh-CN", "region": "CN", "timezone": "8", "currency": "CNY",
        "pageId": "10650171194", "vid": "1774429134077.24e6dFbJOojG", "isSSR": false
      }
    };

    const response = await runtime.fetch(url, {
      method: 'POST',
      headers: { 'accept': 'application/json', 'content-type': 'application/json', 'referer': 'https://hotels.ctrip.com/', 'user-agent': 'Mozilla/5.0 ...' },
      body: JSON.stringify(template)
    });
    if (!response.ok) return runtime.outputError('HTTP_ERROR', `status: ${response.status}`);
    runtime.output(response.data);
  } catch (e) { runtime.outputError('EXCEPTION', e.message); }
})();
```

---

## 示例2：Trip.com 公网房价（hotelId 必传，域名/locale 从拦截结果复制）

### index.js
```javascript
const { APIRuntime } = require('../api-runtime');
const runtime = new APIRuntime();
const params = JSON.parse(process.argv[2] || '{}');

(async () => {
  try {
    const hotelId = params.hotelId;
    if (!hotelId) return runtime.outputError('MISSING_PARAM', 'hotelId is required');
    const checkIn = params.checkIn || new Date().toISOString().split('T')[0].replace(/-/g, '');
    const checkOut = params.checkOut || new Date(Date.now() + 86400000).toISOString().split('T')[0].replace(/-/g, '');
    const checkInDash = `${checkIn.slice(0,4)}-${checkIn.slice(4,6)}-${checkIn.slice(6,8)}`;
    const checkOutDash = `${checkOut.slice(0,4)}-${checkOut.slice(4,6)}-${checkOut.slice(6,8)}`;

    // URL 域名从拦截到的 apiCandidates[i].url 复制（可能是 us.trip.com、www.trip.com 等）
    const url = 'https://us.trip.com/restapi/soa2/33269/getHotelRoomListOversea?...';
    const payload = {
      "search": {
        "hotelId": parseInt(hotelId), "isRSC": false, "isSSR": false,
        "checkIn": checkIn, "checkOut": checkOut,
        "roomQuantity": 1, "adult": 2,
        "filters": [
          { "filterId": "17|1", "type": "17", "value": "1" },
          { "filterId": "31|" + hotelId, "type": "31", "value": String(hotelId) }
        ],
        // ... 其余字段从拦截结果复制
      },
      "head": {
        // Locale/Currency/region 从拦截结果复制，不要跨域名硬改
        "Locale": "en-US", "Currency": "USD", "platform": "PC", "bu": "IBU", "group": "trip",
        "extension": [{ "name": "checkIn", "value": checkInDash }, { "name": "checkOut", "value": checkOutDash }],
        // ...
      }
    };

    const response = await runtime.fetch(url, {
      method: 'POST',
      headers: { /* 从 apiCandidates[i].requestHeaders 完整复制 */ },
      body: JSON.stringify(payload)
    });
    if (!response.ok) return runtime.outputError('HTTP_ERROR', `status: ${response.status}`);
    runtime.output(response.data);
  } catch (e) { runtime.outputError('EXCEPTION', e.message); }
})();
```

---

## 示例3：美团后台房价（poiId + partnerId 必传，Cookie 认证）

### index.js
```javascript
const { APIRuntime } = require('../api-runtime');
const runtime = new APIRuntime();
const params = JSON.parse(process.argv[2] || '{}');

(async () => {
  try {
    const poiId = params.poiId ? String(params.poiId) : null;
    const partnerId = params.partnerId ? Number(params.partnerId) : null;
    if (!poiId || !partnerId) return runtime.outputError('MISSING_PARAM', 'poiId and partnerId are required');

    const checkIn = params.checkIn || new Date().toISOString().split('T')[0];
    const checkOut = params.checkOut || new Date(Date.now() + 5 * 86400000).toISOString().split('T')[0];

    const commonHeaders = {
      'accept': 'application/json', 'content-type': 'application/json',
      'locale': 'zh-CN', 'logintype': 'Epassport',
      'm-appkey': 'fe_com.sankuai.fetalos.web.hotelfeme',
      'referer': 'https://me.meituan.com/ebooking/merchant/product',
      'user-agent': 'Mozilla/5.0 ...',
      'x-requested-with': 'XMLHttpRequest'
    };

    // 步骤1：获取房型和商品列表
    // URL 从 apiCandidates[i].url 完整复制，包含 mtgsig 等签名参数（必须保留）
    const listResp = await runtime.fetch(
      'https://me.meituan.com/api/gw/v1/product/goods/queryListAndTag?yodaReady=h5&csecplatform=4&csecversion=4.2.0&mtgsig=...',
      { method: 'POST', headers: commonHeaders, body: JSON.stringify({ poiId, partnerId, filterType: 1, needDraftGoods: true, offsetGoodsId: 0 }) }
    );
    if (!listResp.ok) return runtime.outputError('QUERY_LIST_TAG_ERROR', `status: ${listResp.status}`);

    // 提取 goodsIds 和 roomIds，带 null 检查
    const goodsIds = [], roomIds = [];
    const relations = listResp.data?.data?.realRoomRelations || [];
    for (const rel of relations) {
      for (const lr of (rel.logicRoomRelations || [])) {
        if (lr.roomBaseInfo && lr.roomBaseInfo.roomId) roomIds.push(lr.roomBaseInfo.roomId);
        for (const g of (lr.goodsList || [])) { if (g.goodsId) goodsIds.push(g.goodsId); }
      }
    }
    if (!goodsIds.length || !roomIds.length) return runtime.outputError('NO_GOODS_ROOM_IDS', 'No goodsIds or roomIds');

    // 步骤2：查询价格库存
    const priceResp = await runtime.fetch(
      'https://me.meituan.com/api/gw/v1/product/goods/queryPriceInventoryStatusInfo?yodaReady=h5&csecplatform=4&csecversion=4.2.0&mtgsig=...',
      { method: 'POST', headers: commonHeaders, body: JSON.stringify({ startDate: checkIn, endDate: checkOut, poiId, partnerId, goodsIds, roomIds }) }
    );
    if (!priceResp.ok) return runtime.outputError('QUERY_PRICE_INVENTORY_ERROR', `status: ${priceResp.status}`);

    runtime.output(priceResp.data);
  } catch (e) { runtime.outputError('EXCEPTION', e.message); }
})();
```

**关键点**：
- poiId 和 partnerId 是美团商家后台的酒店唯一标识，从 params 传入，首次接入时由 recovery agent 从拦截到的 API 请求中提取并存入数据库
- **参数类型**：`poiId` 必须是字符串（`String()`），`partnerId` 必须是数字（`Number()`），类型不对会导致 403
- URL 从 `apiCandidates[i].url` 完整复制，**包含 `mtgsig` 等签名参数（必须保留，不要删除）**
- 两个接口共用同一个 `commonHeaders`，不要加 `m-traceid`
- 数据提取必须有 null 检查，直接 `.forEach` 在数据结构变化时会崩溃

---

## 示例4：美团 PMS 房态预测（Cookie 认证，无需酒店 ID）

### index.js
```javascript
const { APIRuntime } = require('../api-runtime');
const runtime = new APIRuntime();
const params = JSON.parse(process.argv[2] || '{}');

(async () => {
  try {
    const headers = {
      'accept': 'application/json, text/plain, */*',
      'content-type': 'application/json;charset=UTF-8',
      'hotelpms-client-id': '...', 'hotelpms-platform': 'pc',
      'm-appkey': 'fe_com.sankuai.hotelpms.fe.web',
      'referer': 'https://pms.meituan.com/'
    };

    // 步骤1：获取房型列表（Cookie 认证，自动返回当前酒店数据）
    const rtResp = await runtime.fetch(
      'https://pms.meituan.com/hotelpms/api/v1/inventory/Room/GetRoomTypesForcasting',
      { method: 'GET', headers }
    );
    if (!rtResp.ok) return runtime.outputError('RT_ERROR', `status: ${rtResp.status}`);

    const roomTypes = rtResp.data.data.map(rt => ({ id: rt.roomTypeId, roomTypeName: rt.roomTypeName, description: null }));

    // 步骤2：批量查询房态预测
    const today = new Date();
    const response = await runtime.fetch(
      'https://pms.meituan.com/hotelpms/api/v2/report/roomState/batchSearchBaseRoomForcasting',
      { method: 'POST', headers, body: JSON.stringify({
          roomTypes, beginHour: "18:00", channelKey: "Hotel",
          beginDate: today.toISOString().split('T')[0] + " 00:00:00",
          endDate: new Date(today.getTime() + 30 * 86400000).toISOString().split('T')[0] + " 00:00:00"
      }) }
    );
    if (!response.ok) return runtime.outputError('FORECAST_ERROR', `status: ${response.status}`);
    runtime.output({ roomTypes: rtResp.data.data, forecast: response.data.data });
  } catch (e) { runtime.outputError('EXCEPTION', e.message); }
})();
```

---

## 示例5：携程 ebooking 后台（两步 API，Cookie + 动态反爬 token）

### index.js
```javascript
const { APIRuntime } = require('../api-runtime');
const runtime = new APIRuntime();
const params = JSON.parse(process.argv[2] || '{}');

(async () => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const endDate = new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0];

    // headers 从 apiCandidates[i].requestHeaders 完整复制
    // phantom-token/rmstoken/ebk-cid 是动态 token，过期后 recovery 会重新拦截
    const headers = {
      'accept': 'application/json, text/plain, */*',
      'content-type': 'application/json;charset=UTF-8',
      'ebk-cid': '<从拦截结果复制>',
      'origin': 'https://ebooking.ctrip.com',
      'phantom-token': '<从拦截结果复制>',
      'referer': 'https://ebooking.ctrip.com/ebkovsroom/inventory/roompricemanagement?microJump=true',
      'rmstoken': '<从拦截结果复制>',
      'user-agent': 'Mozilla/5.0 ...', 'x-requested-with': 'XMLHttpRequest'
    };

    // 步骤1：拿房型列表（空 body，靠 Cookie session 识别酒店）
    const rtResp = await runtime.fetch(
      'https://ebooking.ctrip.com/ebkovsroom/api/inventory/getRcProductList',
      { method: 'POST', headers, body: '' }
    );
    if (!rtResp.ok) return runtime.outputError('RT_HTTP_ERROR', `status: ${rtResp.status}`);

    const productListData = rtResp.data?.data || [];
    const roomTypeIds = Array.isArray(productListData)
      ? productListData.map(p => p.productId || p.id).filter(v => v != null)
      : (productListData.products || []).map(p => p.productId || p.id).filter(v => v != null);

    // 步骤2：查日历价格库存
    const invResp = await runtime.fetch(
      'https://ebooking.ctrip.com/ebkovsroom/api/inventory/getRoomInventoryInfo',
      { method: 'POST', headers, body: JSON.stringify({
          startDate: params.startDate || today, endDate: params.endDate || endDate,
          roomTypeIds, ratePlanIds: [], isShowPromotion: true, isShowRestriction: true
      }) }
    );
    if (!invResp.ok) return runtime.outputError('INV_HTTP_ERROR', `status: ${invResp.status}`);
    runtime.output({ productList: rtResp.data, inventory: invResp.data });
  } catch (e) { runtime.outputError('EXCEPTION', e.message); }
})();
```

**关键点**：两步串行调用，漏第一步会返回 `Initial Parameter Error`。

---

## 示例6：Booking 公网房价（hotelSlug 必传，GET HTML 解析）

### index.js
```javascript
const { APIRuntime } = require('../api-runtime');
const runtime = new APIRuntime();
const params = JSON.parse(process.argv[2] || '{}');

(async () => {
  try {
    const hotelSlug = params.hotelSlug;
    if (!hotelSlug) return runtime.outputError('MISSING_PARAM', 'hotelSlug is required');
    const countryCode = params.countryCode || 'cn';
    const lang = params.lang || 'zh-cn';
    const checkIn = params.checkIn || new Date().toISOString().split('T')[0];
    const checkOut = params.checkOut || new Date(Date.now() + 86400000).toISOString().split('T')[0];

    const url = `https://www.booking.com/hotel/${countryCode}/${hotelSlug}.${lang}.html?checkin=${checkIn}&checkout=${checkOut}&group_adults=2&no_rooms=1`;
    const response = await runtime.fetch(url, {
      method: 'GET',
      headers: { 'accept': 'text/html', 'user-agent': 'Mozilla/5.0 ...' }
    });
    if (!response.ok) return runtime.outputError('HTTP_ERROR', `status: ${response.status}`);
    runtime.output(response.data);
  } catch (e) { runtime.outputError('EXCEPTION', e.message); }
})();
```

**关键点**：hotelSlug 是 Booking 的酒店 URL 标识（如 `grand-hotel-beijing`），从 hotel_config.booking_hotel_id 传入。

---

## 示例7：Booking 后台房价（hotelId 必传，GraphQL，自动提取 ses）

### index.js
```javascript
const { APIRuntime } = require('../api-runtime');
const runtime = new APIRuntime();
const params = JSON.parse(process.argv[2] || '{}');

(async () => {
  try {
    const hotelId = params.hotelId;
    if (!hotelId) return runtime.outputError('MISSING_PARAM', 'hotelId is required');
    let ses = params.ses || '';

    // 自动从后台 302 重定向中提取 ses token
    if (!ses) {
      const initUrl = `https://admin.booking.com/hotel/hoteladmin/extranet_ng/manage/calendar/index.html?hotel_id=${hotelId}&lang=zh`;
      const initResp = await runtime.fetch(initUrl, { method: 'GET', headers: { 'accept': 'text/html' }, maxRedirects: 0 });
      const location = initResp.headers?.location || '';
      const sesMatch = location.match(/[?&]ses=([a-f0-9]+)/);
      if (sesMatch) ses = sesMatch[1];
      if (!ses) return runtime.outputError('NO_SES', 'Could not extract ses');
    }

    const dates = [];
    for (let i = 0; i < 30; i++) dates.push(new Date(Date.now() + i * 86400000).toISOString().split('T')[0]);

    const url = `https://admin.booking.com/dml/graphql.json?hotel_id=${hotelId}&lang=zh&ses=${ses}&source=nav`;
    const response = await runtime.fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json', 'origin': 'https://admin.booking.com',
        'apollographql-client-name': 'b-partner-availability-extranet-mfe',
        // ... 其余 header 从拦截结果复制
      },
      body: JSON.stringify({
        operationName: 'roomInventoryQuery',
        variables: { input: { roomIds: [], hotelId: parseInt(hotelId), dates, rateIds: [],
          additional: { useInventorySvc: true, statusReason: true },
          options: { checkEmptyPrice: true, mlosStatusReason: true, checkDynamicRestrictions: true }
        } },
        query: '...' // GraphQL query 从拦截结果复制
      })
    });
    if (!response.ok) return runtime.outputError('HTTP_ERROR', `status: ${response.status}`);
    runtime.output(response.data);
  } catch (e) { runtime.outputError('EXCEPTION', e.message); }
})();
```

---

## 通用规则

1. **酒店标识禁止硬编码**：hotelId、hotelSlug、poiId、partnerId 全部从 `params` 读取，缺少时返回 `runtime.outputError('MISSING_PARAM', '...')`
2. **日期**：全部动态计算，禁止硬编码
3. **isRSC**：必须为 false
4. **availableRooms**：公网 → null；后台 → `(val < 999) ? val : null`
5. **Trip.com locale**：域名、Locale、Currency、region 以拦截到的真实请求为准
6. **adapter 字段路径**：基于 `data/api-results/` 下的真实 JSON 确认，不要猜测
7. **headers 透传**：从 `apiCandidates[i].requestHeaders` 完整复制。必须保留平台自定义 header（phantom-token、rmstoken、ebk-cid、m-appkey 等）。删除 cookie（runtime 自动注入）、HTTP/2 伪 header（:authority 等）、sec-ch-ua*、sec-fetch-*、accept-encoding、host、content-length
8. **携程后台两步 API**：先 getRcProductList（空 body）→ 再 getRoomInventoryInfo（填 roomTypeIds）
9. **美团后台两步 API**：先 queryListAndTag（传 poiId/partnerId）→ 再 queryPriceInventoryStatusInfo（传 goodsIds/roomIds）
10. **Cookie 不写在 headers 里**：runtime 通过 BROWSER_COOKIES 环境变量自动注入
11. **美团后台参数类型**：`poiId` 必须是字符串（`String(params.poiId)`），`partnerId` 必须是数字（`Number(params.partnerId)`）。类型不对会导致美团 API 返回 403。URL 中的 `mtgsig` 等签名参数必须完整保留，不要删除。
