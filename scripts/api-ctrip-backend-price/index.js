const { APIRuntime } = require('../api-runtime');
const runtime = new APIRuntime();
const params = JSON.parse(process.argv[2] || '{}');

(async () => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const endDate = new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0];

    // 只保留必要 header，认证靠 Cookie 自动注入
    const headers = {
      'accept': 'application/json, text/plain, */*',
      'content-type': 'application/json;charset=UTF-8',
      'origin': 'https://ebooking.ctrip.com',
      'referer': 'https://ebooking.ctrip.com/ebkovsroom/inventory/roompricemanagement?microJump=true',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
      'x-requested-with': 'XMLHttpRequest'
    };

    // 步骤1：拿房型列表
    const rtResp = await runtime.fetch(
      'https://ebooking.ctrip.com/ebkovsroom/api/inventory/getRcProductList',
      { method: 'POST', headers, body: '' }
    );
    if (!rtResp.ok) return runtime.outputError('RT_HTTP_ERROR', `status: ${rtResp.status}`);

    // 步骤2：从 productList 构建 hotelRoomInfoDtoList
    const productListData = rtResp.data?.data || [];
    const hotelRoomInfoDtoList = [];
    productListData.forEach(p => {
      (p.roomInfos || []).forEach(r => {
        hotelRoomInfoDtoList.push({
          hotelID: r.hotelID,
          roomTypeID: r.roomTypeID,
          roomName: r.roomName || r.roomRCName || '',
          payType: r.payType || 'PP',
          roomClass: r.roomClass || r.roomTypeID,
          currency: r.currency || 'RMB'
        });
      });
    });

    if (hotelRoomInfoDtoList.length === 0) {
      return runtime.outputError('NO_ROOMS', 'No rooms found in productList');
    }

    // 步骤3：查价格库存
    const invBody = {
      startDate: params.startDate || today,
      endDate: params.endDate || endDate,
      showRoomPrice: true,
      showRoomInventory: true,
      showLadderPolicy: true,
      isPreTaxPrice: false,
      hotelRoomInfoDtoList: hotelRoomInfoDtoList,
      saleChannel: 0
    };

    const invResp = await runtime.fetch(
      'https://ebooking.ctrip.com/ebkovsroom/api/inventory/getRoomInventoryInfo',
      { method: 'POST', headers, body: JSON.stringify(invBody) }
    );
    if (!invResp.ok) return runtime.outputError('INV_HTTP_ERROR', `status: ${invResp.status}`);

    runtime.output({ productList: rtResp.data, inventory: invResp.data });
  } catch (e) { runtime.outputError('EXCEPTION', e.message); }
})();
