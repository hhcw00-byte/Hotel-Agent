import { app } from 'electron';
import * as path from 'path';

function loadDatabaseManager() {
  const databaseManagerPath = app.isPackaged
    ? path.join(process.resourcesPath, 'database/dist/database-manager.js')
    : path.join(__dirname, '../../database/dist/database-manager.js');

  console.log('[database-loader] Loading from:', databaseManagerPath);
  console.log('[database-loader] app.isPackaged:', app.isPackaged);
  console.log('[database-loader] process.resourcesPath:', process.resourcesPath);

  // 添加 database/node_modules 到模块搜索路径
  const databaseNodeModules = app.isPackaged
    ? path.join(process.resourcesPath, 'database/node_modules')
    : path.join(__dirname, '../../database/node_modules');

  // 修改全局模块搜索路径
  const Module = require('module');
  const originalResolveFilename = Module._resolveFilename;
  Module._resolveFilename = function(request: string, parent: any, isMain: boolean) {
    if (request === 'mysql2' || request === 'mysql2/promise') {
      const mysql2Path = path.join(databaseNodeModules, request);
      return mysql2Path;
    }
    return originalResolveFilename.call(this, request, parent, isMain);
  };

  const { databaseManager } = require(databaseManagerPath);
  return databaseManager;
}

let databaseManagerInstance: any = null;

export function getDatabaseManager() {
  if (!databaseManagerInstance) {
    databaseManagerInstance = loadDatabaseManager();
  }
  return databaseManagerInstance;
}

// 导出 databaseManager（延迟加载）
export const databaseManager = new Proxy({} as any, {
  get(target, prop) {
    return getDatabaseManager()[prop];
  }
});
