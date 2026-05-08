/**
 * 美团 PMS 房态预测 adapter
 * 后台数据，有真实库存，但 >= 999 视为"不限量"设为 null
 */
function adapt(rawData) {
  const forecastList = rawData.forecast || rawData.data || [];
  const records = [];

  for (const fc of forecastList) {
    if (fc.isAggregation === true) continue; // 跳过汇总行
    const roomName = fc.roomTypeName || '未知房型';
    const totalRooms = parseInt(fc.totalCount) || 0;

    for (const d of (fc.details || [])) {
      const avail = parseInt(d.availableCount) || 0;
      records.push({
        roomName,
        date: d.date ? d.date.substring(0, 10) : null,
        totalRooms,
        availableRooms: (avail < 999) ? avail : null, // >= 999 = 不限量
        occupancyRate: d.sellRate ?? null,
        adr: d.adr ?? null,
        revpar: d.revPar ?? null,
        sourceType: 'backend',
      });
    }
  }
  return { platform: 'meituan-pms', data: records };
}

module.exports = { adapt };
