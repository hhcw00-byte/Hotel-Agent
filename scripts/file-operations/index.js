/**
 * file-operations - 文件操作技能脚本
 * 
 * 为Agent提供受限的文件读写能力，仅允许操作scripts/和skills/目录。
 * 支持 writeFile、readFile、editFile、listDir 四种操作。
 * 
 * 安全约束：
 * - 路径必须以 scripts/ 或 skills/ 开头
 * - 路径不允许包含 .. 或 ~
 * - 单文件写入最大 100KB
 * - 写入失败(EACCES)时回退到 APP_USER_DATA_PATH
 */

const fs = require('fs');
const path = require('path');

// 最大写入内容大小：100KB
const MAX_CONTENT_SIZE = 102400;

/**
 * 路径安全校验
 * @param {string} filePath - 待校验的文件路径
 * @returns {{ valid: boolean, error?: string }}
 */
function validatePath(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    return { valid: false, error: '路径不允许' };
  }

  // 路径不允许包含 .. 或 ~
  if (filePath.includes('..') || filePath.includes('~')) {
    return { valid: false, error: '路径不允许' };
  }

  // 路径必须以 scripts/ 或 skills/ 开头
  if (!filePath.startsWith('scripts/') && !filePath.startsWith('skills/')) {
    return { valid: false, error: '路径不允许' };
  }

  return { valid: true };
}

/**
 * 输出结果到 stdout
 */
function output(result) {
  process.stdout.write(JSON.stringify(result));
}

/**
 * writeFile 操作 - 写入文件
 */
function writeFile(params) {
  const { filePath, content } = params;

  const validation = validatePath(filePath);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  if (!content && content !== '') {
    return { success: false, error: '缺少content参数' };
  }

  // 检查内容大小
  const contentSize = Buffer.byteLength(content, 'utf-8');
  if (contentSize > MAX_CONTENT_SIZE) {
    return { success: false, error: `文件内容超过100KB限制（当前${contentSize}字节）` };
  }

  const fullPath = path.resolve(filePath);

  try {
    // 自动创建目录
    const dir = path.dirname(fullPath);
    fs.mkdirSync(dir, { recursive: true });

    fs.writeFileSync(fullPath, content, 'utf-8');
    return { success: true };
  } catch (err) {
    // EACCES 权限错误时，尝试回退到 APP_USER_DATA_PATH
    if (err.code === 'EACCES') {
      const fallbackBase = process.env.APP_USER_DATA_PATH;
      if (fallbackBase) {
        try {
          const fallbackPath = path.join(fallbackBase, filePath);
          const fallbackDir = path.dirname(fallbackPath);
          fs.mkdirSync(fallbackDir, { recursive: true });
          fs.writeFileSync(fallbackPath, content, 'utf-8');
          return { success: true };
        } catch (fallbackErr) {
          return { success: false, error: fallbackErr.message };
        }
      }
    }
    return { success: false, error: err.message };
  }
}


/**
 * readFile 操作 - 读取文件
 */
function readFile(params) {
  const { filePath } = params;

  const validation = validatePath(filePath);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  const fullPath = path.resolve(filePath);

  try {
    const data = fs.readFileSync(fullPath, 'utf-8');
    return { success: true, data };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * editFile 操作 - 编辑文件（内容替换）
 */
function editFile(params) {
  const { filePath, oldContent, newContent } = params;

  const validation = validatePath(filePath);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  if (oldContent === undefined || oldContent === null) {
    return { success: false, error: '缺少oldContent参数' };
  }

  if (newContent === undefined || newContent === null) {
    return { success: false, error: '缺少newContent参数' };
  }

  const fullPath = path.resolve(filePath);

  try {
    let data = fs.readFileSync(fullPath, 'utf-8');

    if (!data.includes(oldContent)) {
      return { success: false, error: '未找到要替换的内容' };
    }

    data = data.replace(oldContent, newContent);
    fs.writeFileSync(fullPath, data, 'utf-8');
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * listDir 操作 - 列出目录内容
 */
function listDir(params) {
  const { dirPath } = params;

  const validation = validatePath(dirPath);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  const fullPath = path.resolve(dirPath);

  try {
    const entries = fs.readdirSync(fullPath, { withFileTypes: true });
    const listing = entries.map(entry => {
      return entry.isDirectory() ? entry.name + '/' : entry.name;
    }).join('\n');

    return { success: true, data: listing };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * 主入口
 */
function main() {
  let params;

  try {
    // 优先从命令行参数解析，其次从环境变量
    let rawParams = process.argv[2] || process.env.SKILL_PARAMS;
    if (!rawParams) {
      output({ success: false, error: '缺少参数' });
      return;
    }
    // Windows CMD 不支持单引号包裹 JSON，自动去除首尾单引号
    if (rawParams.startsWith("'") && rawParams.endsWith("'")) {
      rawParams = rawParams.slice(1, -1);
    }
    params = JSON.parse(rawParams);
  } catch (err) {
    output({ success: false, error: '参数解析失败: ' + err.message });
    return;
  }

  const { operation } = params;

  let result;
  switch (operation) {
    case 'writeFile':
      result = writeFile(params);
      break;
    case 'readFile':
      result = readFile(params);
      break;
    case 'editFile':
      result = editFile(params);
      break;
    case 'listDir':
      result = listDir(params);
      break;
    default:
      result = { success: false, error: `未知操作: ${operation}` };
  }

  output(result);
}

main();
