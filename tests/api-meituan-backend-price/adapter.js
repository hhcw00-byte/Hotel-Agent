function adapt(rawData) {
  const platform = 'meituan';
  const data = [];

  if (rawData && rawData.data) {
    rawData.data.forEach(item => {
      const goodsBaseInfo = item.goodsBaseInfo;
      const goodsPriceMap = item.goodsPriceMap;
      const goodsStatusMap = item.goodsStatusMap;

      if (goodsBaseInfo && goodsPriceMap && goodsStatusMap) {
        const roomName = goodsBaseInfo.goodsName;
        const originalPrice = goodsBaseInfo.salePrice; // 假设salePrice是原始价格

        for (const dateStr in goodsPriceMap) {
          if (goodsPriceMap.hasOwnProperty(dateStr)) {
            const prices = goodsPriceMap[dateStr];
            const status = goodsStatusMap[dateStr];
            
            if (prices && prices.length > 0 && status) {
              const priceInfo = prices[0]; // 取第一个价格信息
              const price = priceInfo.price / 100; // 美团价格通常是分，转为元
              const currency = 'CNY';
              const availableRooms = (status.limitRemain != null && status.limitRemain < 999) ? status.limitRemain : null;
              const breakfast = goodsBaseInfo.breakFastNum > 0; // 假设breakFastNum > 0表示含早
              const planName = goodsBaseInfo.rpCustomName || goodsBaseInfo.goodsName;

              data.push({
                roomName,
                date: dateStr,
                price,
                originalPrice,
                currency,
                availableRooms,
                breakfast,
                planName,
                sourceType: 'backend'
              });
            }
          }
        }
      }
    });
  }

  return { platform, data };
}

module.exports = { adapt };