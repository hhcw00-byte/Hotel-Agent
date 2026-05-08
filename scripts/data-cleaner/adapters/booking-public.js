/**
 * Booking.com Adapter
 *
 * 数据是 HTML 字符串，需从内联 JS 提取 b_rooms_available_and_soldout
 * 每个 room 有多个 blocks（售卖方案）
 */

// ─── 字段映射表 ───
// b_rooms_available_and_soldout[] 条目
const ROOM_FIELDS = {
  roomName:     'b_name',
  hasInventory: 'b_has_room_inventory',  // 1 = 有库存
};

// blocks[] 条目
const BLOCK_FIELDS = {
  price:     'b_raw_price',
  priceText: 'b_price',                  // "US$26"
  breakfast: 'b_mealplan_included_name',  // null = 无早
};

// ─── HTML 中提取 JSON ───
function extractFromHtml(html) {
  const marker = 'b_rooms_available_and_soldout';
  const idx = html.indexOf(marker);
  if (idx === -1) return null;

  const start = html.indexOf('[', idx);
  if (start === -1 || start - idx > 200) return null;

  let depth = 0;
  for (let i = start; i < html.length; i++) {
    if (html[i] === '[') depth++;
    else if (html[i] === ']') depth--;
    if (depth === 0) return JSON.parse(html.substring(start, i + 1));
  }
  return null;
}

function parseCurrency(priceStr) {
  if (!priceStr) return 'USD';
  if (priceStr.includes('US$') || priceStr.includes('USD')) return 'USD';
  if (priceStr.includes('¥') || priceStr.includes('CNY')) return 'CNY';
  if (priceStr.includes('€')) return 'EUR';
  if (priceStr.includes('£')) return 'GBP';
  return 'USD';
}

// ─── Adapter 逻辑 ───
function adapt(rawData) {
  const html = typeof rawData === 'string' ? rawData : JSON.stringify(rawData);
  const roomsData = extractFromHtml(html);

  if (!roomsData || !Array.isArray(roomsData)) {
    return { platform: 'booking-public', data: [], error: 'b_rooms_available_and_soldout not found' };
  }

  const records = [];

  for (const room of roomsData) {
    const roomName = (room[ROOM_FIELDS.roomName] || '未知房型').trim();
    const hasInventory = room[ROOM_FIELDS.hasInventory] === 1;

    for (const block of room.b_blocks || []) {
      records.push({
        roomName,
        price:     block[BLOCK_FIELDS.price] ?? null,
        currency:  parseCurrency(block[BLOCK_FIELDS.priceText]),
        breakfast: block[BLOCK_FIELDS.breakfast] || '无早餐',
        available: hasInventory,
      });
    }

    // 没有 blocks 也输出一条（售罄房型）
    if (!room.b_blocks || room.b_blocks.length === 0) {
      records.push({ roomName, price: null, currency: 'USD', breakfast: '未知', available: false });
    }
  }

  return { platform: 'booking-public', data: records };
}

module.exports = { adapt };
