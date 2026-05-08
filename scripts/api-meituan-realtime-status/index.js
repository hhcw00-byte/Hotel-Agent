const { APIRuntime } = require('../api-runtime');
const runtime = new APIRuntime();
const params = JSON.parse(process.argv[2] || '{}');

(async () => {
  try {
    const today = new Date();
    const headers = {
      'accept': 'application/json, text/plain, */*',
      'content-type': 'application/json;charset=UTF-8',
      'hotelpms-client-id': '19d2003a1d5c8-0798ecaf75a39c-60355750-1fa400-19d2003a1d6c8',
      'hotelpms-platform': 'pc',
      'm-appkey': 'fe_com.sankuai.hotelpms.fe.web',
      'referer': 'https://pms.meituan.com/',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.291 Safari/537.36'
    };

    // 步骤1：获取房型列表
    const rtResp = await runtime.fetch(
      'https://pms.meituan.com/hotelpms/api/v1/inventory/Room/GetRoomTypesForcasting',
      { method: 'GET', headers }
    );
    if (!rtResp.ok) return runtime.outputError('RT_ERROR', `status: ${rtResp.status}`);

    const roomTypes = rtResp.data.data.map(rt => ({
      id: rt.roomTypeId, roomTypeName: rt.roomTypeName, description: null
    }));

    // 步骤2：批量查询房态预测
    const response = await runtime.fetch(
      'https://pms.meituan.com/hotelpms/api/v2/report/roomState/batchSearchBaseRoomForcasting',
      {
        method: 'POST', headers,
        body: JSON.stringify({
          roomTypes,
          beginHour: "18:00",
          channelKey: "Hotel",
          beginDate: today.toISOString().split('T')[0] + " 00:00:00",
          endDate: new Date(today.getTime() + 30 * 86400000).toISOString().split('T')[0] + " 00:00:00"
        })
      }
    );
    if (!response.ok) return runtime.outputError('FORECAST_ERROR', `status: ${response.status}`);

    runtime.output({ roomTypes: rtResp.data.data, forecast: response.data.data });
  } catch (e) { runtime.outputError('EXCEPTION', e.message); }
})();
