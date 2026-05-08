const { APIRuntime } = require('../api-runtime');
const runtime = new APIRuntime();
const params = JSON.parse(process.argv[2] || '{}');

(async () => {
  try {
    const keyword = params.keyword;
    if (!keyword) return runtime.outputError('MISSING_PARAM', 'keyword is required');

    // 使用拦截到的 gaHotelSearchEngine 接口 (SOA2/21881)
    const url = 'https://m.ctrip.com/restapi/soa2/21881/json/gaHotelSearchEngine';
    
    // 构造请求体，保留所有 head 字段
    const requestBody = {
      "keyword": keyword,
      "cityId": params.cityId || 1,
      "searchType": "K",
      "platform": "online",
      "pageID": "102001",
      "head": {
        "cid": "1774429134077.24e6dFbJOojG",
        "ctok": "",
        "cver": "0",
        "lang": "01",
        "sid": "",
        "syscode": "09",
        "auth": "",
        "xsid": "",
        "extension": [
          { "name": "cityId", "value": String(params.cityId || 1) }
        ],
        "platform": "PC",
        "bu": "HBU",
        "group": "ctrip",
        "aid": "",
        "ouid": "",
        "locale": "zh-CN",
        "region": "CN",
        "timezone": "8",
        "currency": "CNY",
        "pageId": "102001"
      }
    };

    const response = await runtime.fetch(url, {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'content-type': 'application/json',
        'origin': 'https://hotels.ctrip.com',
        'referer': 'https://hotels.ctrip.com/',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.291 Safari/537.36'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) return runtime.outputError('HTTP_ERROR', `status: ${response.status}`);
    runtime.output(response.data);
  } catch (e) {
    runtime.outputError('EXCEPTION', e.message);
  }
})();
