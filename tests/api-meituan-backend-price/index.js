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
      'accept': 'application/json',
      'content-type': 'application/json',
      'locale': 'zh-CN',
      'logintype': 'Epassport',
      'm-appkey': 'fe_com.sankuai.fetalos.web.hotelfeme',
      'referer': 'https://me.meituan.com/ebooking/merchant/product',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.291 Safari/537.36',
      'x-requested-with': 'XMLHttpRequest'
    };

    // 步骤1：获取房型和商品列表
    const listResp = await runtime.fetch(
      'https://me.meituan.com/api/gw/v1/product/goods/queryListAndTag?yodaReady=h5&csecplatform=4&csecversion=4.2.0&mtgsig=%7B%22a1%22%3A%221.2%22%2C%22a2%22%3A1777456189003%2C%22a3%22%3A%228816114646xy5278z17091411032v49z80w7996zx6697958v72vzzz2%22%2C%22a5%22%3A%22kN30R%2BPQcbpehWO4388swZ48Q84wTUxcy4VyVheawe6fu4xXEHmHsmtpV03FeTxHo3cMOXQUMwnmt%2BgN6E2NfpBm%2FaCRqOI%2BC02KqNM9j5eY3XcHy%2FB3sVnZtadd%22%2C%22a6%22%3A%22hs1.6jbwObfZzuMo5xgLloWQgUBx2YTIj3GslYhWrkThHLVPCbN1vw7MS4OS8zLTOn4SZlCil8IIARRRVJuwBw3QfCMLjI0wJDxlDb7mIFaWBQfV6612yFIC5veGtvN%2FvGLXxoPV%2B3jxcVmMawG0aDl3EYneJrcUuXzzpUfwFuLWU024%3D%22%2C%22a8%22%3A%22f61d99079ff277622d167a43b7a8d917%22%2C%22a9%22%3A%224.2.0%2C7%2C250%22%2C%22a10%22%3A%223f%22%2C%22x0%22%3A4%2C%22d1%22%3A%22e082db95da1d9fa78c2700623a9f4428%22%7D',
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
      'https://me.meituan.com/api/gw/v1/product/goods/queryPriceInventoryStatusInfo?yodaReady=h5&csecplatform=4&csecversion=4.2.0&mtgsig=%7B%22a1%22%3A%221.2%22%2C%22a2%22%3A1777456200797%2C%22a3%22%3A%228816114646xy5278z17091411032v49z80w7996zx6697958v72vzzz2%22%2C%22a5%22%3A%22Go8dtj%2BHMaivaztIRX%2FWaULTF1LgEwJxN1orEtI2RdXJJO85wtjpymqD2qyULtOU1Tz3Wd1B03GAv95knSYecCk8mgHEFHhCSavFzAcIG6Inu9diIhsjUZ%2FXvbWT%22%2C%22a6%22%3A%22hs1.6LIXGZHXKpM5fAuxql%2B6HCjPn2A96oLPJTMIWnqIQIzVoCHRH5Vhoq83KJ1gB7GPg%2F%2FICs2Tw3XY14TC6Ylr0m0lAHG3FXNCHHQez093uoeEFwTYm0C1XUf8SYLPSduCk2je8fP4oHgREgZImFN8ndY%2FjcWrNKYUFWaJXWSz92zo%3D%22%2C%22a8%22%3A%22b2d11677751c52f61f07f386a05c24f1%22%2C%22a9%22%3A%224.2.0%2C7%2C250%22%2C%22a10%22%3A%223f%22%2C%22x0%22%3A4%2C%22d1%22%3A%2206ec93f9b86aa2b196960000be863109%22%7D',
      { method: 'POST', headers: commonHeaders, body: JSON.stringify({ startDate: checkIn, endDate: checkOut, poiId, partnerId, goodsIds, roomIds }) }
    );
    if (!priceResp.ok) return runtime.outputError('QUERY_PRICE_INVENTORY_ERROR', `status: ${priceResp.status}`);

    runtime.output(priceResp.data);
  } catch (e) { runtime.outputError('EXCEPTION', e.message); }
})();
