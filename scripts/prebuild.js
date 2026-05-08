const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const JavaScriptObfuscator = require('javascript-obfuscator');

const root = path.resolve(__dirname, '..');

function run(cmd, cwd = root) {
  console.log(`[prebuild] ${cmd} (in ${cwd})`);
  execSync(cmd, { cwd, stdio: 'inherit' });
}

// 1. 编译爬虫子项目
run('npm run build', path.join(root, 'scripts/ai-web-crawler'));

// 2. 编译 database 模块（必须在 database-operations 之前，因为后者引用 database 的类型）
run('npx tsc', path.join(root, 'database'));

// 2.5 为 database 模块安装生产依赖（mysql2，供子进程 require）
const dbPkgPath = path.join(root, 'database', 'package.json');
if (!fs.existsSync(dbPkgPath)) {
  fs.writeFileSync(dbPkgPath, JSON.stringify({
    name: 'hotel-database',
    version: '1.0.0',
    dependencies: { 'mysql2': '^3.20.0' }
  }, null, 2));
}
run('npm install --production', path.join(root, 'database'));

// 3. 编译 database-operations（依赖 database/dist 的类型声明）
run('npx tsc', path.join(root, 'scripts/database-operations'));

// 4. 确保图标文件存在（需要 256x256 以上才能通过 electron-builder 校验）
const iconPath = path.join(root, 'assets', 'icon.ico');
if (!fs.existsSync(iconPath)) {
  console.log('[prebuild] icon.ico not found, generating via generate-icon.js...');
  run('node scripts/generate-icon.js', root);
}

// ========== 加密配置 ==========
const ENCRYPTION_KEY_SEED = 'hotel-ai-browser-config-v1';

function deriveKey(seed) {
  return crypto.createHash('sha256').update(seed).digest();
}

function encryptFile(inputPath, outputPath) {
  const key = deriveKey(ENCRYPTION_KEY_SEED);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = fs.readFileSync(inputPath, 'utf-8');
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  fs.writeFileSync(outputPath, Buffer.concat([iv, tag, encrypted]));
  console.log(`[prebuild] Encrypted: ${path.relative(root, inputPath)} → ${path.relative(root, outputPath)}`);
}

// 5. 加密配置文件
console.log('[prebuild] Encrypting config...');
encryptFile(
  path.join(root, 'scripts/ai-web-crawler/config.yaml'),
  path.join(root, 'scripts/ai-web-crawler/config.enc')
);

// 6. 确保 Agent 动态生成的 skill 脚本目录存在（打包时 extraResources 需要 from 目录存在）
const dynamicSkillDirs = [
  'scripts/api-ctrip-backend-price',
  'scripts/api-meituan-backend-price',
  'scripts/api-booking-public-price',
];
for (const dir of dynamicSkillDirs) {
  const fullPath = path.join(root, dir);
  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath, { recursive: true });
    // 写一个占位 README，说明这是 Agent 动态生成的目录
    fs.writeFileSync(path.join(fullPath, 'README.md'), '# Auto-generated\nThis skill script is dynamically created by the Agent recovery process.\n');
    console.log(`[prebuild] Created placeholder: ${dir}`);
  }
}

// 7. 确保 data/api-results 目录存在（运行时数据输出目录）
const apiResultsDir = path.join(root, 'data', 'api-results');
if (!fs.existsSync(apiResultsDir)) {
  fs.mkdirSync(apiResultsDir, { recursive: true });
  console.log('[prebuild] Created data/api-results/');
}

// 8. 确保 data/memory 目录存在
const memoryDir = path.join(root, 'data', 'memory');
if (!fs.existsSync(memoryDir)) {
  fs.mkdirSync(memoryDir, { recursive: true });
  console.log('[prebuild] Created data/memory/');
}

console.log('[prebuild] All sub-projects compiled successfully');
