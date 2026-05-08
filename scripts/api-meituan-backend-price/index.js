const { APIRuntime } = require('../api-runtime');
const runtime = new APIRuntime();
const params = JSON.parse(process.argv[2] || '{}');

(async () => {
  try {
    const today = new Date();
    const checkIn = params.checkIn || today.toISOString().split('T')[0];
    const checkOutDate = new Date(today.getTime() + 5 * 24 * 60 * 60 * 1000);
    const checkOut = params.checkOut || checkOutDate.toISOString().split('T')[0];
    const poiId = params.poiId;
    if (!poiId) return runtime.outputError('MISSING_PARAM', 'poiId is required');
    const partnerId = params.partnerId;
    if (!partnerId) return runtime.outputError('MISSING_PARAM', 'partnerId is required');

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

    // Step 1: Get goodsIds and roomIds
    const queryListAndTagBody = {
      "poiId": poiId,
      "partnerId": partnerId,
      "filterType": 1,
      "needDraftGoods": true,
      "offsetGoodsId": 0
    };
    const queryListAndTagResp = await runtime.fetch(
      'https://me.meituan.com/api/gw/v1/product/goods/queryListAndTag?yodaReady=h5&csecplatform=4&csecversion=4.2.0',
      { method: 'POST', headers: commonHeaders, body: JSON.stringify(queryListAndTagBody) }
    );
    if (!queryListAndTagResp.ok) {
      return runtime.outputError('QUERY_LIST_TAG_ERROR', `status: ${queryListAndTagResp.status}, data: ${JSON.stringify(queryListAndTagResp.data)}`);
    }

    const goodsIds = [];
    const roomIds = [];
    if (queryListAndTagResp.data && queryListAndTagResp.data.data && queryListAndTagResp.data.data.realRoomRelations) {
      queryListAndTagResp.data.data.realRoomRelations.forEach(relation => {
        if (relation.logicRoomRelations) {
          relation.logicRoomRelations.forEach(logicRoom => {
            if (logicRoom.roomBaseInfo && logicRoom.roomBaseInfo.roomId) {
              roomIds.push(logicRoom.roomBaseInfo.roomId);
            }
            if (logicRoom.goodsList) {
              logicRoom.goodsList.forEach(goods => {
                if (goods.goodsId) {
                  goodsIds.push(goods.goodsId);
                }
              });
            }
          });
        }
      });
    }

    if (goodsIds.length === 0 || roomIds.length === 0) {
      return runtime.outputError('NO_GOODS_ROOM_IDS', 'Could not extract goodsIds or roomIds from queryListAndTag API.');
    }

    // Step 2: Query Price Inventory Status Info
    const queryPriceInventoryStatusInfoBody = {
      "startDate": checkIn,
      "endDate": checkOut,
      "poiId": poiId,
      "partnerId": partnerId,
      "goodsIds": goodsIds,
      "roomIds": roomIds
    };

    const queryPriceInventoryStatusInfoResp = await runtime.fetch(
      'https://me.meituan.com/api/gw/v1/product/goods/queryPriceInventoryStatusInfo?yodaReady=h5&csecplatform=4&csecversion=4.2.0',
      { method: 'POST', headers: commonHeaders, body: JSON.stringify(queryPriceInventoryStatusInfoBody) }
    );

    if (!queryPriceInventoryStatusInfoResp.ok) {
      return runtime.outputError('QUERY_PRICE_INVENTORY_ERROR', `status: ${queryPriceInventoryStatusInfoResp.status}, data: ${JSON.stringify(queryPriceInventoryStatusInfoResp.data)}`);
    }

    runtime.output(queryPriceInventoryStatusInfoResp.data);

  } catch (e) {
    runtime.outputError('EXCEPTION', e.message);
  }
})();