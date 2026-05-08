const { APIRuntime } = require('../api-runtime');
const runtime = new APIRuntime();
const params = JSON.parse(process.argv[2] || '{}');

(async () => {
  try {
    const hotelId = Number(params.hotelId);
    if (!hotelId) return runtime.outputError('MISSING_PARAM', 'hotelId is required'); // 本店携程 hotelId，从 recovery prompt 的"本店平台 ID"获取
    const checkIn = params.checkIn || new Date().toISOString().split('T')[0];
    const checkOut = params.checkOut || new Date(Date.now() + 86400000).toISOString().split('T')[0];
    const checkInNoDash = checkIn.replace(/-/g, '');
    const checkOutNoDash = checkOut.replace(/-/g, '');

    const url = 'https://m.ctrip.com/restapi/soa2/33278/getHotelRoomListInland?_fxpcqlniredt=09031124119000653723';

    // 完整粘贴拦截到的 requestBody，仅动态化 hotelId、日期、filters
    const template = {
      "search": {
        "isRSC": false,
        "isSSR": false,
        "hotelId": hotelId,
        "roomId": 0,
        "checkIn": checkInNoDash,
        "checkOut": checkOutNoDash,
        "roomQuantity": 1,
        "adult": 1,
        "childInfoItems": [],
        "isIjtb": false,
        "priceType": 2,
        "hotelUniqueKey": "",
        "mustShowRoomList": [],
        "location": { "geo": { "cityID": 0 } },
        "filters": [
          { "filterId": "31|" + hotelId, "type": "31", "value": String(hotelId), "title": "" }
        ],
        "meta": { "fgt": -1, "roomkey": "", "minCurr": "", "minPrice": "", "roomToken": "" },
        "hasAidInUrl": false,
        "cancelPolicyType": 0,
        "fixSubhotel": 0,
        "extras": { "loginAB": "", "exposeBedInfos": "", "enableChildAgeGroup": "T", "needEntireSetRoomDesc": "", "closeOnlineRoomListOptimize": true }
      },
      "head": {
        "cid": "1774429134077.24e6dFbJOojG",
        "ctok": "", "cver": "0", "lang": "01", "sid": "", "syscode": "09",
        "auth": "", "xsid": "",
        "extension": [
          { "name": "cityId", "value": "" },
          { "name": "checkIn", "value": checkIn },
          { "name": "checkOut", "value": checkOut }
        ],
        "platform": "PC", "bu": "HBU", "group": "ctrip",
        "aid": "", "ouid": "",
        "locale": "zh-CN", "region": "CN", "timezone": "8", "currency": "CNY",
        "pageId": "10650171194",
        "vid": "1774429134077.24e6dFbJOojG", "guid": "", "isSSR": false
      }
    };

    const response = await runtime.fetch(url, {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'content-type': 'application/json',
        'referer': 'https://hotels.ctrip.com/',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.291 Safari/537.36'
      },
      body: JSON.stringify(template)
    });

    if (!response.ok) return runtime.outputError('HTTP_ERROR', `status: ${response.status}`);
    runtime.output(response.data);
  } catch (e) { runtime.outputError('EXCEPTION', e.message); }
})();