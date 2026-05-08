/**
 * 携程公网 Adapter
 *
 * 数据结构：roomList[] 是索引，通过 key/skey 关联 physicRoomMap 和 saleRoomMap
 * 一个物理房型可对应多个售卖方案，拍平为逐条记录输出
 */
const { resolve } = require('../lib/resolve');

// ─── 字段映射表 ───
// 物理房型（physicRoomMap 条目）
const ROOM_FIELDS = {
  roomName: 'name',
};

// 售卖方案（saleRoomMap 条目）
const SALE_FIELDS = {
  price:         'priceInfo.price',
  originalPrice: 'priceInfo.deletePricewithOutCurrency',
  currency:      'priceInfo.currency',
  breakfast:     'mealInfo.title',
  available:     'bookingStatusInfo.isBooking',
};

// ─── Adapter 逻辑 ───
function adapt(rawData) {
  const container = rawData.roomList?.data || rawData;
  const entries = [
    ...(container.roomList || []),
    ...(container.compensatedRooms?.roomList || []),
  ];
  const physicRoomMap = container.physicRoomMap || {};
  const saleRoomMap = container.saleRoomMap || {};

  const records = [];

  for (const room of entries) {
    const physical = physicRoomMap[room.key];
    const roomName = resolve(physical, ROOM_FIELDS.roomName) || `Room-${room.key}`;

    for (const sub of room.subRoomList || []) {
      const sale = saleRoomMap[sub.skey];
      if (!sale) continue;

      records.push({
        roomName,
        price:         resolve(sale, SALE_FIELDS.price) ?? null,
        originalPrice: resolve(sale, SALE_FIELDS.originalPrice) ?? null,
        currency:      resolve(sale, SALE_FIELDS.currency) || 'CNY',
        breakfast:     resolve(sale, SALE_FIELDS.breakfast) || '未知',
        available:     resolve(sale, SALE_FIELDS.available) ?? null,
      });
    }
  }

  return { platform: 'ctrip-public', data: records };
}

module.exports = { adapt };
