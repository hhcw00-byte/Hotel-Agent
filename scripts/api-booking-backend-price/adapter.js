/**
 * Booking.com 后台房价 adapter
 * 数据路径：rooms[] → rates[] → dates[] → price[{occupancy, value}]
 * 同时提取房态：rooms[].dates[].roomsToSell / netBooked
 */

function adapt(rawData) {
  const rooms = rawData.rooms || [];
  if (!Array.isArray(rooms) || rooms.length === 0) {
    return { platform: 'booking-backend', data: [] };
  }

  const records = [];

  for (const room of rooms) {
    const roomName = room.name || '未知房型';

    // 房态数据：从 room.dates 提取 availableRooms
    for (const d of (room.dates || [])) {
      if (d.status === 'bookable' && d.roomsToSell != null) {
        const availableRooms = parseInt(d.roomsToSell);
        if (!isNaN(availableRooms) && availableRooms < 999) {
          records.push({
            roomName,
            date: d.date,
            price: null,
            originalPrice: null,
            currency: 'CNY',
            breakfast: null,
            available: d.status === 'bookable',
            availableRooms,
            totalRooms: null,
            sourceType: 'backend',
          });
        }
      }
    }

    // 价格数据：从 room.rates[].dates[].price 提取
    for (const rate of (room.rates || [])) {
      const rateName = rate.name || '';
      for (const d of (rate.dates || [])) {
        if (!d.price || d.price.length === 0) continue;
        // 取第一个 occupancy 的价格
        const priceEntry = d.price[0];
        const price = parseFloat(priceEntry.value);
        if (isNaN(price) || price <= 0) continue;

        records.push({
          roomName,
          planName: rateName,
          date: d.date,
          price,
          originalPrice: null,
          currency: 'CNY',
          breakfast: null,
          available: d.status === 'bookable' && !d.closed,
          availableRooms: null,
          sourceType: 'backend',
        });
      }
    }
  }

  return { platform: 'booking-backend', data: records };
}

module.exports = { adapt };
