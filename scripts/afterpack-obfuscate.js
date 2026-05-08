const fs = require('fs');
const path = require('path');
const JavaScriptObfuscator = require('javascript-obfuscator');

// 标准混淆配置 — 用于非 Playwright 脚本
const OBFUSCATOR_OPTIONS = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.5,
  deadCodeInjection: false,
  debugProtection: false,
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false,
  selfDefending: false,
  stringArray: true,
  stringArrayThreshold: 0.75,
  stringArrayEncoding: ['base64'],
  splitStrings: true,
  splitStringsChunkLength: 10,
  transformObjectKeys: false,
  unicodeEscapeSequence: false,
  reservedStrings: ['mysql2', 'mysql2/promise']
};

// 轻量混淆配置 — 专用于 ai-web-crawler
// 爬虫代码大量使用 Playwright async/await + page.evaluate() 内联 JS，
// controlFlowFlattening 会破坏 async 控制流导致 CDP 超时/竞态，
// splitStrings 会拆碎 evaluate 内的 JS 代码和 CSS 选择器。
const CRAWLER_OBFUSCATOR_OPTIONS = {
  compact: true,
  controlFlowFlattening: false,   // 禁用！会破坏 async/await 控制流
  deadCodeInjection: false,
  debugProtection: false,
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false,
  selfDefending: false,
  stringArray: true,
  stringArrayThreshold: 0.5,
  stringArrayEncoding: [],         // 不编码，避免运行时解码开销
  splitStrings: false,             // 禁用！会拆碎 evaluate 内的 JS 和选择器
  transformObjectKeys: false,
  unicodeEscapeSequence: false,
};

function obfuscateFile(filePath, options) {
  try {
    const code = fs.readFileSync(filePath, 'utf-8');
    const result = JavaScriptObfuscator.obfuscate(code, options || OBFUSCATOR_OPTIONS);
    fs.writeFileSync(filePath, result.getObfuscatedCode());
    console.log(`[afterPack] Obfuscated: ${filePath}`);
  } catch (err) {
    console.warn(`[afterPack] Skip: ${filePath} — ${err.message}`);
  }
}

function obfuscateDirectory(dirPath, options) {
  if (!fs.existsSync(dirPath)) return;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true, recursive: true });
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.js')) {
      const fullPath = path.join(entry.parentPath || entry.path, entry.name);
      obfuscateFile(fullPath, options);
    }
  }
}

exports.default = async function(context) {
  // ⚠️ 代码混淆暂时全部禁用 — 先保证打包后功能正常，后续再考虑混淆
  console.log('[afterPack] Obfuscation SKIPPED (disabled for debugging)');
};
