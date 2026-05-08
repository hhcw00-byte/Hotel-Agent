/**
 * 美团后台 Adapter
 *
 * 每个 goods 是一个售卖方案，goodsPriceMap 按日期存价格
 * ⚠️ 价格单位：分（/100 → 元）
 */
const { resolve } = require('../lib/resolve');

// ─── 字段映射表 ───
const GOODS_FIELDS = {
  roomName:     'goodsBaseInfo.goodsName',
  breakfastNum: 'goodsBaseInfo.breakFastNum',
  goodsStatus:  'goodsBaseInfo.goodsStatus',
};

// goodsPriceMap[date][0] 条目
const PRICE_FIELDS = {
  salePrice:   'salePrice',     // 分
  originPrice: 'originPrice',   // 分（0 = 无划线价）
  basePrice:   'basePrice',     // 分（成本）
};

// ─── 分 → 元 ───
function fen2yuan(val) {
  const n = Number(val);
  return n > 0 ? n / 100 : null;
}

// ─── Adapter 逻辑 ───
function adapt(rawData) {
  const goods = rawData.data || [];
  const records = [];

  for (const item of goods) {
    const roomName = resolve(item, GOODS_FIELDS.roomName) || '未知房型';
    const breakfastNum = resolve(item, GOODS_FIELDS.breakfastNum) || 0;

    // 取最早日期的价格
    const priceMap = item.goodsPriceMap || {};
    const statusMap = item.goodsStatusMap || {};
    const dates = Object.keys(priceMap).sort();

    if (dates.length === 0) {
      records.push({
        roomName,
        price: null,
        originalPrice: null,
        cost: null,
        currency: 'CNY',
        breakfast: breakfastNum > 0 ? `含${breakfastNum}份早` : '无早餐',
        available: null,
      });
      continue;
    }

    const date = dates[0];
    const priceEntry = (priceMap[date] || [])[0] || {};
    const statusEntry = statusMap[date] || {};

    records.push({
      roomName,
      price:         fen2yuan(resolve(priceEntry, PRICE_FIELDS.salePrice)),
      originalPrice: fen2yuan(resolve(priceEntry, PRICE_FIELDS.originPrice)),
      cost:          fen2yuan(resolve(priceEntry, PRICE_FIELDS.basePrice)),
      currency:      'CNY',
      breakfast:     breakfastNum > 0 ? `含${breakfastNum}份早` : '无早餐',
      available:     statusEntry.roomStatus === 1 && statusEntry.invSwitch === 1,
    });
  }

  return { platform: 'meituan-backend', data: records };
}

module.exports = { adapt };
