const { resolve } = require('../lib/resolve');

/**
 * Trip.com Price Calendar Adapter
 */
const FIELDS = {
  price: 'minPrice',
  date: 'date'
};

function adapt(rawData) {
  const items = resolve(rawData, 'data.priceCalendarInfos') || [];
  if (!Array.isArray(items)) {
    return { platform: 'trip-public', data: [] };
  }

  const records = items.map(item => ({
    roomName: '最低价房型',
    price: parseFloat(resolve(item, FIELDS.price)) || null,
    originalPrice: null,
    currency: 'USD',
    totalRooms: null,
    availableRooms: null,
    date: resolve(item, FIELDS.date) || null
  }));

  return { platform: 'trip-public', data: records };
}

module.exports = { adapt };
