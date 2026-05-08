function adapt(rawData) {
  const productList = rawData.productList?.data || [];
  const invData = rawData.inventory?.data || {};
  const priceList = invData.roomPriceResult?.roomPriceInfo || [];
  const statusList = invData.roomStatusResult || [];

  // 构建房型名称映射：roomTypeID → roomName
  const roomNameMap = {};
  productList.forEach(p => {
    const baseName = p.roomName || p.roomEnglishName || '未知房型';
    (p.roomInfos || []).forEach(r => {
      if (r.roomTypeID) roomNameMap[r.roomTypeID] = baseName;
    });
  });

  // 构建房态映射：roomTypeID+date → availableRooms
  const statusMap = {};
  statusList.forEach(s => {
    const key = `${s.roomTypeID}_${s.effectDate}`;
    const qty = s.canUsedQuantity;
    statusMap[key] = (qty != null && qty < 999) ? qty : null;
  });

  const records = [];
  priceList.forEach(p => {
    const roomName = roomNameMap[p.roomTypeID] || `Room-${p.roomTypeID}`;
    const statusKey = `${p.roomTypeID}_${p.effectDate}`;
    records.push({
      roomName: roomName,
      planName: '',
      date: p.effectDate,
      price: p.price || 0,
      originalPrice: p.originalPrice || null,
      cost: p.cost || null,
      currency: p.currency || 'CNY',
      breakfast: p.mealNum > 0 ? '含早' : '无早',
      available: true,
      availableRooms: statusMap[statusKey] ?? null,
      sourceType: 'backend'
    });
  });

  return { platform: 'ctrip-backend', data: records };
}
module.exports = { adapt };
