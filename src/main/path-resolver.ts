import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Static base path (read-only in packaged mode).
 * Contains scripts code, database module, crawler, agent prompts.
 */
export function getBasePath(): string {
  return app.isPackaged ? process.resourcesPath : process.cwd();
}

/**
 * Writable base path for user data.
 * Packaged: %APPDATA%/Hotel AI Browser/  (app.getPath('userData'))
 * Dev: process.cwd() (same as getBasePath — no behavior change)
 */
export function getWritableBasePath(): string {
  return app.isPackaged ? app.getPath('userData') : process.cwd();
}

export function getAsarPath(): string {
  return app.isPackaged ? app.getAppPath() : process.cwd();
}

export function getSkillsDir(): string {
  if (app.isPackaged) {
    // In packaged mode, webpack copies skills into dist/skills/ inside the asar
    return path.join(getAsarPath(), 'dist', 'skills');
  }
  // In dev mode, use the source skills directory directly
  return path.join(process.cwd(), 'skills');
}

export function getScriptsDir(): string {
  return path.join(getBasePath(), 'scripts');
}

export function getDataDir(): string {
  return path.join(getWritableBasePath(), 'data');
}

export function getTasksDir(): string {
  return path.join(getWritableBasePath(), 'tasks');
}

export function getLLMConfigPath(): string {
  return path.join(getWritableBasePath(), 'llm-config.json');
}

export function getDBConfigPath(): string {
  return path.join(getWritableBasePath(), 'db-config.json');
}

export function getAgentDir(): string {
  if (app.isPackaged) {
    // In packaged mode, webpack copies agent into dist/agent/ inside the asar
    return path.join(getAsarPath(), 'dist', 'agent');
  }
  // In dev mode, use the source agent directory directly
  return path.join(process.cwd(), 'agent');
}

export function getDatabaseDir(): string {
  return path.join(getBasePath(), 'database', 'dist');
}

/**
 * 确保运行时需要的目录存在 + 首次启动迁移
 * 打包模式下，将 resources/ 中的种子文件复制到 userData/ (如果目标不存在)
 * 应在 app ready 后调用一次
 */
export function ensureRuntimeDirs(): void {
  const writableBase = getWritableBasePath();
  const staticBase = getBasePath();

  // 1. 确保 writable 目录结构存在
  const dirs = [
    path.join(writableBase, 'data', 'api-results'),
    path.join(writableBase, 'data', 'memory'),
    path.join(writableBase, 'tasks'),
  ];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  // 2. 首次启动迁移：从 resources 复制种子文件到 userData（仅打包模式）
  if (app.isPackaged) {
    // tasks/*.json
    const srcTasksDir = path.join(staticBase, 'tasks');
    const dstTasksDir = path.join(writableBase, 'tasks');
    if (fs.existsSync(srcTasksDir)) {
      try {
        const files = fs.readdirSync(srcTasksDir).filter(f => f.endsWith('.json'));
        for (const file of files) {
          const dst = path.join(dstTasksDir, file);
          if (!fs.existsSync(dst)) {
            fs.copyFileSync(path.join(srcTasksDir, file), dst);
          }
        }
      } catch {}
    }

    // llm-config / db-config: 加密迁移由 llm-config-loader.ts 和 config-manager.ts 自动处理
    // 不再复制明文文件到 userData
  }
}
