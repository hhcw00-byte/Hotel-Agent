/**
 * sample-extractor.js — 从原始 API JSON 中提取"完整但精简"的数据样本
 *
 * 目的：给 LLM 看完整的数据结构 + 真实样本值，让它能写出准确的 adapter。
 *
 * 策略（零硬编码，纯结构驱动）：
 * - 对象：保留所有 key，递归处理 value
 * - 数组：浅层取 2 个样本，深层取 1 个 + 数组总长度
 * - Map 类对象（key 是动态 ID 的）：取 1 个完整样本 + 总 entry 数
 * - 字符串：超过 200 字符截断并标注原始长度
 * - 深层大对象（depth≥3 且 >2KB）：逐字段按大小决定——
 *     小字段（序列化后 <512B）完整保留
 *     大字段（≥512B）只保留类型+大小摘要
 *   这样 LLM 能看到所有字段名 + 小字段的真实值，大字段知道类型和规模
 * - 结构差异检测：被省略的数组元素/map entry 如果有额外 key，会标注出来
 */

const fs = require('fs');

/** 单个字段值序列化后超过此阈值就摘要化（仅在深层大对象内生效） */
const FIELD_SIZE_THRESHOLD = 512;

/**
 * 判断一个对象是否是"动态 key map"（如 physicRoomMap、saleRoomMap、goodsPriceMap）
 * 特征：key 是数字ID 或日期字符串，value 都是对象且结构相似
 */
function isDynamicKeyMap(obj) {
  const keys = Object.keys(obj);
  if (keys.length < 2) return false;
  const dynamicKeyPattern = /^(\d+|[\d-]{8,}|[a-f0-9-]{8,})$/i;
  const dynamicCount = keys.filter(k => dynamicKeyPattern.test(k)).length;
  if (dynamicCount < keys.length * 0.5) return false;
  const objValues = keys.filter(k => typeof obj[k] === 'object' && obj[k] !== null && !Array.isArray(obj[k]));
  return objValues.length >= keys.length * 0.7;
}

/**
 * 对一个值生成类型摘要（不展开内容）
 */
function typeSummary(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return `[string:${v.length}chars]`;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v;
  if (Array.isArray(v)) return `[Array:${v.length}]`;
  if (typeof v === 'object') return `{Object:${Object.keys(v).length}keys}`;
  return typeof v;
}

/**
 * 核心：递归提取样本
 */
function extractSample(data, currentPath = '', depth = 0) {
  if (data === null || data === undefined) return data;
  if (typeof data === 'boolean' || typeof data === 'number') return data;

  if (typeof data === 'string') {
    if (data.length > 500 && (data.includes('<html') || data.includes('<!DOCTYPE'))) {
      return `[HTML:${data.length}chars] ${data.substring(0, 500)}...`;
    }
    if (data.length > 200) {
      return `[string:${data.length}chars] ${data.substring(0, 200)}...`;
    }
    return data;
  }

  // 数组
  if (Array.isArray(data)) {
    if (data.length === 0) return [];

    const maxSamples = depth <= 2 ? 2 : 1;
    const samples = data.slice(0, maxSamples).map((item, i) =>
      extractSample(item, `${currentPath}[${i}]`, depth + 1)
    );

    if (data.length > maxSamples) {
      const extraKeys = new Set();
      const sampleKeys = new Set();
      if (typeof data[0] === 'object' && data[0] !== null) {
        for (const s of data.slice(0, maxSamples)) {
          if (typeof s === 'object' && s !== null) {
            Object.keys(s).forEach(k => sampleKeys.add(k));
          }
        }
        for (const item of data.slice(maxSamples, maxSamples + 10)) {
          if (typeof item === 'object' && item !== null) {
            Object.keys(item).forEach(k => {
              if (!sampleKeys.has(k)) extraKeys.add(k);
            });
          }
        }
      }
      const meta = { _arrayTotal: data.length, _samplesShown: maxSamples };
      if (extraKeys.size > 0) {
        meta._extraKeysInOtherElements = [...extraKeys];
      }
      samples.push(meta);
    }
    return samples;
  }

  // 对象
  if (typeof data === 'object') {
    // 动态 key map
    if (isDynamicKeyMap(data)) {
      const keys = Object.keys(data);
      const result = {};
      const sampleKeys = keys.slice(0, 1);

      for (const k of sampleKeys) {
        result[k] = extractSample(data[k], `${currentPath}.${k}`, depth + 1);
      }

      result._mapMeta = {
        _totalEntries: keys.length,
        _samplesShown: 1,
        _sampleKeys: sampleKeys,
        _allKeys: keys,
      };

      if (keys.length > 1) {
        const shownKeySet = new Set();
        if (typeof data[sampleKeys[0]] === 'object' && data[sampleKeys[0]] !== null) {
          Object.keys(data[sampleKeys[0]]).forEach(kk => shownKeySet.add(kk));
        }
        const extraKeys = new Set();
        for (const k of keys.slice(1, 6)) {
          if (typeof data[k] === 'object' && data[k] !== null) {
            Object.keys(data[k]).forEach(kk => {
              if (!shownKeySet.has(kk)) extraKeys.add(kk);
            });
          }
        }
        if (extraKeys.size > 0) {
          result._mapMeta._extraKeysInOtherEntries = [...extraKeys];
        }
      }
      return result;
    }

    // 深层大对象：逐字段按大小决定保留还是摘要
    if (depth >= 3) {
      const serialized = JSON.stringify(data);
      if (serialized.length > 2048) {
        const result = {};
        for (const k of Object.keys(data)) {
          const fieldSize = JSON.stringify(data[k]).length;
          if (fieldSize < FIELD_SIZE_THRESHOLD) {
            // 小字段：完整保留（含递归）
            result[k] = extractSample(data[k], `${currentPath}.${k}`, depth + 1);
          } else {
            // 大字段：只保留类型摘要
            result[k] = typeSummary(data[k]);
          }
        }
        result._trimmed = true;
        return result;
      }
    }

    // 普通对象：保留所有 key，递归
    const result = {};
    for (const k of Object.keys(data)) {
      result[k] = extractSample(data[k], `${currentPath}.${k}`, depth + 1);
    }
    return result;
  }

  return data;
}

/**
 * 主入口：提取样本 + 统计信息
 */
function extractDataSample(rawJson) {
  const sample = extractSample(rawJson, '', 0);
  const fullSize = JSON.stringify(rawJson).length;
  const sampleSize = JSON.stringify(sample).length;

  return {
    sample,
    stats: {
      originalSizeKB: Math.round(fullSize / 1024 * 10) / 10,
      sampleSizeKB: Math.round(sampleSize / 1024 * 10) / 10,
      compressionRatio: Math.round(sampleSize / fullSize * 100) + '%',
    }
  };
}

// CLI 模式
if (require.main === module) {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: node sample-extractor.js <json-file-path>');
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const result = extractDataSample(raw.data || raw);
  console.log(JSON.stringify(result, null, 2));
}

module.exports = { extractDataSample, extractSample };
