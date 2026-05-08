#!/usr/bin/env node

const { spawn, execFileSync } = require('child_process');
const net = require('net');
const path = require('path');

configureWindowsConsoleEncoding();

const rootDir = path.resolve(__dirname, '..');
const inspectorPort = Number(process.env.INSPECTOR_PORT || 9229);
const cdpPort = Number(process.env.CDP_PORT || 9222);
const childEnv = buildChildEnv();

// 使用 require.resolve 定位模块入口，跨平台且不依赖绝对路径
const tscBin = require.resolve('typescript/bin/tsc');
const webpackBin = require.resolve('webpack/bin/webpack.js');
const electronBin = require.resolve('electron/cli.js');

let webpackProcess = null;
let electronProcess = null;
let shuttingDown = false;

/**
 * 跨平台 spawn 封装
 * 统一使用 process.execPath (node) 来调用 JS 脚本，避免 Windows 上
 * shell: true 导致带空格路径被截断的问题，同时兼容 macOS/Linux。
 */
function spawnNode(args, options = {}) {
  return spawn(process.execPath, args, {
    cwd: rootDir,
    stdio: options.stdio || 'inherit',
    env: childEnv,
  });
}

function configureWindowsConsoleEncoding() {
  if (process.platform !== 'win32') return;

  try {
    execFileSync('cmd.exe', ['/d', '/s', '/c', 'chcp 65001 > nul'], { stdio: 'ignore' });
  } catch {}

  try { process.stdout.setDefaultEncoding('utf8'); } catch {}
  try { process.stderr.setDefaultEncoding('utf8'); } catch {}
}

function buildChildEnv() {
  const env = { ...process.env };

  env.LANG = env.LANG || 'zh_CN.UTF-8';
  env.LC_ALL = env.LC_ALL || 'zh_CN.UTF-8';
  env.PYTHONIOENCODING = env.PYTHONIOENCODING || 'utf-8';
  env.npm_config_unicode = 'true';

  // Electron must start as the GUI runtime in debug mode. This variable is only
  // for script subprocesses; inheriting it here makes Electron behave like Node.
  delete env.ELECTRON_RUN_AS_NODE;

  return env;
}

function ensurePortAvailable(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.once('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        reject(new Error(`Inspector port ${port} is already in use. Stop the existing debug session first.`));
      } else {
        reject(error);
      }
    });

    server.once('listening', () => {
      server.close(resolve);
    });

    server.listen(port, '127.0.0.1');
  });
}

function findRunningPackagedApp() {
  if (process.platform === 'darwin') {
    try {
      const output = execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' });
      return output
        .split('\n')
        .map((line) => line.trim())
        .find((line) => (
          line.includes('/Hotel-Agent.app/Contents/MacOS/Hotel-Agent') &&
          !line.includes('/Frameworks/') &&
          !line.startsWith(`${process.pid} `)
        )) || null;
    } catch {
      return null;
    }
  }

  return null;
}

function shutdown(exitCode = 0) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  if (electronProcess && !electronProcess.killed) {
    electronProcess.kill();
  }

  if (webpackProcess && !webpackProcess.killed) {
    webpackProcess.kill();
  }

  process.exit(exitCode);
}

function runDatabaseBuild() {
  return new Promise((resolve, reject) => {
    console.log('[debug] Building database...');
    const child = spawnNode([tscBin, '-p', 'database/tsconfig.json']);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Database build failed with exit code ${code}`));
      }
    });
    child.on('error', reject);
  });
}

function runWebpackBuild() {
  return new Promise((resolve, reject) => {
    console.log('[debug] Building with webpack (development)...');
    const child = spawnNode([webpackBin, '--mode', 'development']);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Webpack build failed with exit code ${code}`));
      }
    });
    child.on('error', reject);
  });
}

function startWebpackWatch() {
  console.log('[debug] Starting webpack watch...');
  webpackProcess = spawnNode([webpackBin, '--mode', 'development', '--watch']);

  webpackProcess.on('exit', (code) => {
    if (!shuttingDown) {
      console.error('[debug] Webpack watch exited unexpectedly');
      shutdown(code || 1);
    }
  });
}

function startElectron() {
  console.log(`[debug] Starting Electron with inspector on 127.0.0.1:${inspectorPort}...\n`);

  electronProcess = spawnNode([electronBin, '.', `--inspect=${inspectorPort}`]);

  electronProcess.on('exit', (code) => {
    if (!shuttingDown) {
      shutdown(code || 0);
    }
  });
}

async function main() {
  const runningPackagedApp = findRunningPackagedApp();
  if (runningPackagedApp) {
    console.error('[debug] Hotel-Agent.app is already running. Quit the packaged app before starting debug mode.');
    process.exit(1);
  }

  try {
    await ensurePortAvailable(inspectorPort);
    await ensurePortAvailable(cdpPort);
  } catch (error) {
    if (String(error.message || '').includes(String(cdpPort))) {
      console.error(`[debug] CDP port ${cdpPort} is already in use. Quit the existing Hotel-Agent app before starting debug mode.`);
    } else {
      console.error(`[debug] ${error.message}`);
    }
    process.exit(1);
  }

  try {
    await runDatabaseBuild();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }

  try {
    await runWebpackBuild();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }

  // 先启动 Electron，再启动 webpack watch 监听后续变更
  startElectron();
  startWebpackWatch();
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

main();
