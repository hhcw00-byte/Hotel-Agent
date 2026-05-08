/**
 * 快速检查 room_type_mapping 表状态
 */
const { databaseManager } = require('../../database/dist/database-manager');

async function main() {
  try {
    // 从环境变量注入配置
    if (process.env.DB_HOST && process.env.DB_USER_ID) {
      databaseManager.setConfig(
        { host: process.env.DB_HOST, port: parseInt(process.env.DB_PORT || '3306'), user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '' },
        parseInt(process.env.DB_USER_ID)
      );
    } else {
      // 硬编码 fallback（仅开发调试用）
      databaseManager.setConfig(
        { host: '54.146.51.115', port: 3306, user: 'root', password: 'zxcv!@#' },
        2
      );
    }
    await databaseManager.initialize();

    // 1. 查 canonical room types（用户配置的标准名）
    const canonical = await databaseManager.getCanonicalRoomTypes();
    console.log('=== Canonical Room Types (user-defined) ===');
    console.log(canonical.length ? canonical.join('\n') : '(empty - no canonical room types configured)');

    // 2. 查所有映射
    const mappings = await databaseManager.getRoomTypeMappings();
    console.log('\n=== All Room Type Mappings ===');
    if (mappings.length === 0) {
      console.log('(empty - no mappings exist)');
    } else {
      for (const m of mappings) {
        console.log(`  [${m.platform}] "${m.platform_room_name}" → "${m.canonical_name}"`);
      }
    }

    // 3. 查未映射的房型名
    const platforms = ['ctrip-public', 'trip-public', 'meituan-backend', 'ctrip-backend'];
    for (const p of platforms) {
      const unmapped = await databaseManager.getUnmappedRoomNames(p);
      if (unmapped.length > 0) {
        console.log(`\n=== Unmapped in ${p} (${unmapped.length}) ===`);
        for (const n of unmapped) console.log('  ' + n);
      }
    }

    await databaseManager.close();
  } catch (e) {
    console.error('Error:', e.message);
    try { await databaseManager.close(); } catch (_) {}
  }
}

main();
