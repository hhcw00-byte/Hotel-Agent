/**
 * 携程后台 Adapter
 *
 * 两张表关联：products.data[]（房型元数据）+ inventory.roomPriceInfo[]（每日价格）
 * 通过 roomTypeID 关联，取第一个日期的价格
 */
const { resolve } = require('../lib/resolve');

// ─── 字段映射表 ───
// 房型方案（products.data[].roomInfos[] 条目）
const PLAN_FIELDS = {
  roomTypeID:  'roomTypeID',
  roomName:    'roomRCName',       // 含早餐标记的完整名
  hasBreakfast:'hasBreakfast',
  singleBreakfast: 'singleBreakfast',
  isOpen:      'isOpen',           // "T" = 开放
  bookable:    'bookable',         // "T" = 可订
};

// 价格（inventory.roomPriceResult.roomPriceInfo[] 条目）
const PRICE_FIELDS = {
  price:         'price',
  originalPrice: 'originalPrice',
  cost:          'cost',
  mealNum:       'mealNum',
};

// ─── Adapter 逻辑 ───
function adapt(rawData) {
  const products = rawData.products?.data || [];
  const priceInfoList = rawData.inventory?.data?.roomPriceResult?.roomPriceInfo || [];

  // roomTypeID → 第一条价格记录
  const priceMap = {};
  for (const pi of priceInfoList) {
    if (!priceMap[pi.roomTypeID]) priceMap[pi.roomTypeID] = pi;
  }

  const records = [];

  for (const product of products) {
    const baseRoomName = product.roomName || '未知房型';

    for (const info of product.roomInfos || []) {
      const rtID = resolve(info, PLAN_FIELDS.roomTypeID);
      const pi = priceMap[rtID];

      // 早餐
      let breakfast = '无早餐';
      if (info.hasBreakfast) {
        breakfast = info.singleBreakfast ? `含${info.singleBreakfast}份早` : '含早餐';
      }
      if (pi && resolve(pi, PRICE_FIELDS.mealNum) > 0) {
        breakfast = `含${pi.mealNum}份早`;
      }

      // 可订
      const available = info.isOpen === 'T' && info.bookable === 'T';

      records.push({
        roomName:      baseRoomName,
        planName:      resolve(info, PLAN_FIELDS.roomName) || baseRoomName,
        price:         pi ? resolve(pi, PRICE_FIELDS.price) : null,
        originalPrice: pi ? resolve(pi, PRICE_FIELDS.originalPrice) : null,
        cost:          pi ? resolve(pi, PRICE_FIELDS.cost) : null,
        currency:      'CNY',
        breakfast,
        available,
      });
    }
  }

  return { platform: 'ctrip-backend', data: records };
}

module.exports = { adapt };
