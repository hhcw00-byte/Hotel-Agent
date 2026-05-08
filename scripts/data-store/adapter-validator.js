/**
 * adapter-validator.js — 验证 adapter 输出的完整性和准确性
 *
 * 用法：
 *   const { validateAdapter } = require('./adapter-validator');
 *   const result = validateAdapter(source);
 *   // result: { valid, records, warnings, errors, stats }
 *
 * 验证逻辑（零硬编码，纯数据驱动）：
 * 1. 加载 adapter + 最新数据文件
 * 2. 执行 adapter.adapt(rawData) 得到 records
 * 3. 检查 records 数量是否 > 0
 * 4. 检查每条 record 的关键字段（roomName 非空、price 合理范围）
 * 5. 检查是否有完全重复的记录
 * 6. 返回验证结果 + 详细诊断信息
 */

const fs = require('fs');
const path = require('path');

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

function loadAdapter(source) {
  const colocated = path.join(__dirname, '..', source, 'adapter.js');
  if (fs.existsSync(colocated)) return require(colocated);
  return null;
}

function validateAdapter(source) {
  const errors = [];
  const warnings = [];

  const adapter = loadAdapter(source);
  if (!adapter) {
    return { valid: false, records: [], errors: [`No adapter found for: ${source}`], warnings, stats: {} };
  }

  const filePath = findLatestFile(source);
  if (!filePath) {
    return { valid: false, records: [], errors: [`No data file found for: ${source}`], warnings, stats: {} };
  }

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (e) {
    return { valid: false, records: [], errors: [`Failed to parse data file: ${e.message}`], warnings, stats: {} };
  }

  if (!raw.success || !raw.data) {
    return { valid: false, records: [], errors: ['Data file has no valid data (success=false or no data)'], warnings, stats: {} };
  }

  let adapterResult;
  try {
    adapterResult = adapter.adapt(raw.data);
  } catch (e) {
    return { valid: false, records: [], errors: [`Adapter threw error: ${e.message}`], warnings, stats: {} };
  }

  const { platform, data: records } = adapterResult;
  if (!records || !Array.isArray(records)) {
    return { valid: false, records: [], errors: ['Adapter returned non-array data'], warnings, stats: {} };
  }

  const stats = {
    platform,
    recordCount: records.length,
    dataFile: path.basename(filePath),
  };

  if (records.length === 0) {
    errors.push('Adapter produced 0 records');
  }

  // 逐条质量检查
  let emptyRoomName = 0;
  let nullPrice = 0;
  let suspiciousPrice = 0;

  for (const r of records) {
    if (!r.roomName || r.roomName === '未知房型') emptyRoomName++;
    if (r.price == null && r.availableRooms == null) nullPrice++;
    if (r.price != null && (r.price <= 0 || r.price > 100000)) suspiciousPrice++;
  }

  stats.emptyRoomName = emptyRoomName;
  stats.noUsableData = nullPrice;
  stats.suspiciousPrice = suspiciousPrice;

  if (emptyRoomName > records.length * 0.3) {
    warnings.push(`${emptyRoomName}/${records.length} records have empty/unknown roomName`);
  }
  if (nullPrice === records.length && records.length > 0) {
    errors.push('All records have both null price and null availableRooms — adapter is not extracting any usable data');
  }
  if (suspiciousPrice > records.length * 0.3) {
    warnings.push(`${suspiciousPrice}/${records.length} records have suspicious price (<=0 or >100000)`);
  }

  // 重复检测
  const seen = new Set();
  let duplicates = 0;
  for (const r of records) {
    const key = `${r.roomName}|${r.date}|${r.price}|${r.planName || ''}`;
    if (seen.has(key)) duplicates++;
    seen.add(key);
  }
  if (duplicates > 0) {
    warnings.push(`${duplicates} duplicate records detected`);
  }
  stats.duplicates = duplicates;

  const valid = errors.length === 0;
  return { valid, records, errors, warnings, stats };
}

// CLI 模式
if (require.main === module) {
  const source = process.argv[2];
  if (!source) {
    console.error('Usage: node adapter-validator.js <source-skill-name>');
    process.exit(1);
  }
  const result = validateAdapter(source);
  console.log(JSON.stringify({
    valid: result.valid,
    errors: result.errors,
    warnings: result.warnings,
    stats: result.stats,
  }, null, 2));
}

module.exports = { validateAdapter };
