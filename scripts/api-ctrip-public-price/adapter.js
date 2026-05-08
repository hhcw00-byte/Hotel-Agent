/**
 * 携程公网房价 adapter
 * 数据路径：rawData.data.roomList → subRoomList → saleRoomMap[skey]
 * 售罄时 fallback 到 compensatedRooms.roomList
 * physicRoomMap[physicalRoomId] 获取房型中文名
 */
function adapt(rawData) {
  const container = rawData.data || rawData;
  const { roomList, compensatedRooms, physicRoomMap, saleRoomMap, searchBoxInfo } = container;
  if (!saleRoomMap) return { platform: 'ctrip', data: [] };

  const date = formatCheckIn(searchBoxInfo);
  const records = [];

  // 优先用 roomList，售罄时 fallback 到 compensatedRooms.roomList
  const groups = (roomList && roomList.length > 0)
    ? roomList
    : (compensatedRooms && compensatedRooms.roomList) || [];

  for (const group of groups) {
    for (const sub of (group.subRoomList || [])) {
      const sale = saleRoomMap[sub.skey || sub.key];
      if (!sale) continue;
      const room = (physicRoomMap || {})[sale.physicalRoomId] || {};

      records.push({
        roomName: room.name || sale.name || '未知房型',
        planName: (sale.mealInfo || {}).title || '',
        date,
        price: sale.priceInfo?.price ?? null,
        originalPrice: sale.priceInfo?.deletePricewithOutCurrency ?? null,
        currency: sale.priceInfo?.currency || 'CNY',
        breakfast: (sale.mealInfo?.mealFlag > 0) ? '含早' : '无早',
        available: sale.bookingStatusInfo?.isBooking ?? null,
        availableRooms: null, // 公网铁律：不映射 remainRoomQuantity
        sourceType: 'public',
      });
    }
  }
  return { platform: 'ctrip', data: records };
}

function formatCheckIn(info) {
  if (!info || !info.checkIn) return null;
  const ci = String(info.checkIn);
  return ci.length === 8 ? `${ci.slice(0,4)}-${ci.slice(4,6)}-${ci.slice(6,8)}` : ci;
}

module.exports = { adapt };
