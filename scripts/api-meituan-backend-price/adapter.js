/**
 * 美团商家后台房价管理 adapter
 * 后台数据，有真实库存，但 >= 999 视为"不限量"设为 null
 */
function adapt(rawData) {
  const records = [];

  if (rawData && rawData.data) {
    for (const goods of rawData.data) {
      const roomName = goods.goodsBaseInfo.goodsName;
      const goodsId = goods.goodsBaseInfo.goodsId;

      // Process price map
      if (goods.goodsPriceMap) {
        for (const date in goods.goodsPriceMap) {
          if (goods.goodsPriceMap.hasOwnProperty(date)) {
            const priceInfo = goods.goodsPriceMap[date][0]; // Assuming only one price entry per day
            if (priceInfo) {
              records.push({
                roomName,
                date,
                price: priceInfo.salePrice / 100, // Convert from fen to yuan
                originalPrice: priceInfo.basePrice / 100,
                currency: 'CNY',
                sourceType: 'backend',
                planName: goods.goodsBaseInfo.rpCustomName || roomName,
                goodsId: goodsId // Add goodsId for better identification if needed
              });
            }
          }
        }
      }

      // Process room status map for availableRooms
      if (goods.goodsStatusMap) {
        for (const date in goods.goodsStatusMap) {
          if (goods.goodsStatusMap.hasOwnProperty(date)) {
            const statusInfo = goods.goodsStatusMap[date];
            if (statusInfo) {
              // Find the existing record for this roomName and date, or create a new one
              let record = records.find(r => r.roomName === roomName && r.date === date);
              if (!record) {
                record = { roomName, date, sourceType: 'backend' };
                records.push(record);
              }

              const remainCount = statusInfo.remainCount;
              record.availableRooms = (remainCount != null && remainCount < 999) ? remainCount : null;
            }
          }
        }
      }
    }
  }

  return { platform: 'meituan-backend', data: records };
}

module.exports = { adapt };