/**
 * Booking.com 公网房价 adapter
 * 数据路径：rawData.rooms[] → room.b_blocks[] → 每个 block 一条记录
 * 没有 blocks 的房型输出一条 sold-out 记录
 */

const CURRENCY_MAP = {
  'US$': 'USD',
  'USD': 'USD',
  '$': 'USD',
  '¥': 'CNY',
  'CN¥': 'CNY',
  'CNY': 'CNY',
  '€': 'EUR',
  'EUR': 'EUR',
  '£': 'GBP',
  'GBP': 'GBP',
  'A$': 'AUD',
  'AUD': 'AUD',
  'CA$': 'CAD',
  'CAD': 'CAD',
  'HK$': 'HKD',
  'HKD': 'HKD',
  'JP¥': 'JPY',
  'JPY': 'JPY',
  '₩': 'KRW',
  'KRW': 'KRW',
  'THB': 'THB',
  '฿': 'THB',
};

/**
 * Parse currency symbol from b_price string like "US$26", "¥180", "€45"
 * @param {string} priceStr
 * @returns {string}
 */
function parseCurrency(priceStr) {
  if (!priceStr || typeof priceStr !== 'string') return 'USD';
  // Extract non-digit, non-space, non-comma, non-dot prefix
  const match = priceStr.match(/^([^\d\s,.]+)/);
  if (match) {
    const symbol = match[1].trim();
    if (CURRENCY_MAP[symbol]) return CURRENCY_MAP[symbol];
  }
  // Try known symbols anywhere in string
  for (const [sym, code] of Object.entries(CURRENCY_MAP)) {
    if (priceStr.includes(sym)) return code;
  }
  return 'USD';
}

function adapt(rawData) {
  const rooms = rawData.rooms || rawData;
  if (!Array.isArray(rooms)) return { platform: 'booking-public', data: [] };

  const checkIn = rawData.checkIn || null;
  const records = [];

  for (const room of rooms) {
    const roomName = room.b_name || '未知房型';
    const blocks = room.b_blocks || [];

    if (blocks.length === 0) {
      // Sold-out room: no available blocks
      records.push({
        roomName,
        date: checkIn,
        price: null,
        originalPrice: null,
        currency: 'USD',
        breakfast: '无早餐',
        available: false,
        availableRooms: null,
        planName: null,
        sourceType: 'public',
      });
      continue;
    }

    for (const block of blocks) {
      const price = block.b_raw_price ?? null;
      const originalPrice = block.b_strikethrough_price_raw ?? null;
      const currency = parseCurrency(block.b_price);
      const mealPlan = block.b_mealplan_included_name || null;
      const breakfast = mealPlan || '无早餐';
      const available = room.b_has_room_inventory === 1;

      records.push({
        roomName,
        planName: mealPlan,
        date: checkIn,
        price,
        originalPrice,
        currency,
        breakfast,
        available,
        availableRooms: null, // 公网铁律：不映射可售房量
        sourceType: 'public',
      });
    }
  }

  return { platform: 'booking-public', data: records };
}

module.exports = { adapt };
