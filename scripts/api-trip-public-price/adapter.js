/**
 * Trip.com 公网 adapter
 * 结构与携程相同：roomList → subRoomList → saleRoomMap/physicRoomMap
 */
function adapt(rawData) {
  const container = rawData.roomList?.data || rawData.data || rawData;
  const entries = [
    ...(container.roomList || []),
    ...(container.compensatedRooms?.roomList || []),
  ];
  const physicRoomMap = container.physicRoomMap || {};
  const saleRoomMap = container.saleRoomMap || {};

  const searchBox = container.searchBoxInfo || rawData.searchBoxInfo;
  let date = null;
  if (searchBox?.checkIn) {
    const ci = String(searchBox.checkIn);
    if (ci.length === 8) date = `${ci.slice(0,4)}-${ci.slice(4,6)}-${ci.slice(6,8)}`;
  }

  const records = [];
  for (const room of entries) {
    const physical = physicRoomMap[room.key];
    const roomName = physical?.name || `Room-${room.key}`;

    for (const sub of (room.subRoomList || [])) {
      const sale = saleRoomMap[sub.skey];
      if (!sale) continue;

      records.push({
        roomName,
        date,
        price: sale.priceInfo?.price ?? null,
        originalPrice: sale.priceInfo?.deletePricewithOutCurrency ?? null,
        currency: sale.priceInfo?.currency || 'CNY',
        breakfast: sale.mealInfo?.title || '未知',
        available: sale.bookingStatusInfo?.isBooking ?? null,
        availableRooms: null, // 公网铁律
        sourceType: 'public',
      });
    }
  }
  return { platform: 'trip-public', data: records };
}

module.exports = { adapt };