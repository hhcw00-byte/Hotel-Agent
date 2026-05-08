/**
 * data-cleaner - 平台数据翻译器
 *
 * 用法：node index.js '{"source":"api-ctrip-public-price"}'
 *
 * 从 data/api-results/ 找到指定 source 的最新文件，
 * 通过对应平台的 Adapter 翻译为统一格式输出。
 *
 * 输出格式：{ platform, data: [{ roomName, price, ... }] }
 */

const fs = require('fs');
const path = require('path');

// 旧 adapter 映射（过渡期兼容，不再新增条目）
const LEGACY_MAP = {
  'api-ctrip-public-price':    './adapters/ctrip-public',
  'api-trip-public-price':     './adapters/trip-public',
  'api-ctrip-backend-price':   './adapters/ctrip-backend',
  'api-meituan-backend-price': './adapters/meituan-backend',
  'api-booking-public-price':  './adapters/booking-public',
};

/**
 * Co-located adapter 优先查找
 */
function findAdapter(source) {
  // 1. 优先：co-located adapter（scripts/api-xxx/adapter.js）
  const colocated = path.join(__dirname, '..', source, 'adapter.js');
  if (fs.existsSync(colocated)) return require(colocated);

  // 2. 降级：旧 LEGACY_MAP（过渡期兼容）
  const legacy = LEGACY_MAP[source];
  if (legacy) return require(legacy);

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

function main() {
  const params = JSON.parse(process.argv[2] || '{}');
  const source = params.source;

  if (!source) {
    process.stdout.write(JSON.stringify({
      success: false,
      error: { code: 'MISSING_PARAM', message: 'source parameter is required' }
    }));
    return;
  }

  const adapter = findAdapter(source);
  if (!adapter) {
    process.stdout.write(JSON.stringify({
      success: false,
      error: { code: 'UNKNOWN_SOURCE', message: `No adapter for source: ${source}` }
    }));
    return;
  }

  const filePath = findLatestFile(source);
  if (!filePath) {
    process.stdout.write(JSON.stringify({
      success: false,
      error: { code: 'NO_DATA', message: `No data files found for source: ${source} in data/api-results/` }
    }));
    return;
  }

  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    if (!raw.success || !raw.data) {
      process.stdout.write(JSON.stringify({
        success: false,
        error: { code: 'BAD_DATA', message: 'Source file contains error result (success=false or no data)' }
      }));
      return;
    }

    const { adapt } = adapter;
    const result = adapt(raw.data);

    process.stdout.write(JSON.stringify({ success: true, data: result }));
  } catch (error) {
    process.stdout.write(JSON.stringify({
      success: false,
      error: { code: 'ADAPT_ERROR', message: error.message }
    }));
  }
}

main();
