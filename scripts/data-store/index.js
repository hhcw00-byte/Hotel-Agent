/**
 * data-store — 翻译原始数据 + 存入 price_snapshots / room_snapshots
 *
 * 用法：node index.js '{"source":"api-ctrip-public-price"}'
 *
 * 直接 require adapter 模块（不 spawn 子进程），避免 Electron 下 node PATH 问题
 *
 * 双表写入逻辑：
 * - record 有有效 price → 写入 price_snapshots
 * - record 有有效 availableRooms → 写入 room_snapshots
 * - 一条 record 可以同时写入两张表
 */

const fs = require('fs');
const path = require('path');
const { databaseManager } = require('../../database/dist/database-manager');

// 旧 adapter 映射（过渡期兼容，不再新增条目）
const LEGACY_MAP = {
  'api-ctrip-public-price':    '../data-cleaner/adapters/ctrip-public',
  'api-trip-public-price':     '../data-cleaner/adapters/trip-public',
  'api-ctrip-backend-price':   '../data-cleaner/adapters/ctrip-backend',
  'api-meituan-backend-price': '../data-cleaner/adapters/meituan-backend',
  'api-booking-public-price':  '../data-cleaner/adapters/booking-public',
};

/**
 * Co-located adapter 查找（不再降级到 LEGACY_MAP）
 * 如果 co-located adapter 不存在，返回 null → data-store 报错 → 触发 recovery 重新生成
 */
function findAdapter(source) {
  const colocated = path.join(__dirname, '..', source, 'adapter.js');
  if (fs.existsSync(colocated)) return require(colocated);
  return null;
}

function findLatestFile(source) {
  const dir = process.env.DATA_DIR
    ? path.join(process.env.DATA_DIR, 'api-results')
    : path.join(process.cwd(), 'data', 'api-results');
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir)
    .filter(f => f.startsWith(source + '-') && f.endsWith('.json'))
    .sort()
    .reverse();
  return files.length > 0 ? path.join(dir, files[0]) : null;
}

function output(obj) {
  process.stdout.write(JSON.stringify(obj));
}

async function main() {
  const params = JSON.parse(process.argv[2] || '{}');
  const source = params.source;

  if (!source) {
    output({ success: false, error: 'source parameter is required' });
    return;
  }

  const adapter = findAdapter(source);
  if (!adapter) {
    output({ success: false, error: `No adapter for: ${source}` });
    return;
  }

  const filePath = findLatestFile(source);
  if (!filePath) {
    output({ success: false, error: `No data files for: ${source}` });
    return;
  }

  try {
    // 1. 读原始数据
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    if (!raw.success || !raw.data) {
      output({ success: false, error: 'Source file has no valid data' });
      return;
    }

    // 2. adapter 翻译
    const { platform, data: records } = adapter.adapt(raw.data);

    if (!records || records.length === 0) {
      output({ success: false, error: 'Adapter returned empty data' });
      return;
    }

    // parseOnly 模式：只解析不入库，直接返回标准化数据
    if (params.parseOnly) {
      output({
        success: true,
        platform,
        totalRecords: records.length,
        data: records,
      });
      return;
    }

    // 3. 入库（双表写入）— 带重试，防止数据库连接瞬断
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await databaseManager.initialize();
        break;
      } catch (dbErr) {
        if (attempt === 3) throw dbErr;
        // 等 2 秒后重试
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    // hotelId 透传：0=本店（默认），>0=竞品 competitors.id
    const hotelId = parseInt(params.hotelId) || 0;

    // 3a. 价格记录 → price_snapshots（传递新字段）
    const priceRecords = records.filter(r => r.price != null);
    const { savedCount } = priceRecords.length > 0
      ? await databaseManager.insertPriceSnapshots(platform, priceRecords, hotelId)
      : { savedCount: 0 };

    // 3b. 房态记录 → room_snapshots（传递新字段）
    // 防御性过滤：各平台用大数字表示"不限量"（携程 9999、美团 999），不是真实库存
    // adapter 应该已经处理，但作为兜底，过滤掉 >= 999 的异常值
    const roomRecords = records.filter(r => r.availableRooms != null && r.availableRooms < 999);
    const { savedCount: roomSavedCount } = roomRecords.length > 0
      ? await databaseManager.insertRoomSnapshots(platform, roomRecords, hotelId)
      : { savedCount: 0 };

    await databaseManager.close();

    // 4. 返回清洗结果 + 存储计数
    output({
      success: true,
      platform,
      savedCount,
      roomSavedCount,
      totalRecords: records.length,
      data: records,
    });
  } catch (e) {
    try { await databaseManager.close(); } catch (_) {}
    output({ success: false, error: e.message });
  }
}

main();
