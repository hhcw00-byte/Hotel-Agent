/**
 * Browser Manager
 * 负责自动启动和管理调试模式的浏览器
 * 参考: hotel-ai-agent/scripts/web_scraper/browser_manager.py
 */

import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { Logger } from './logger';

export interface BrowserManagerConfig {
  port: number;
  userDataDir?: string;
  headless?: boolean;
  startUrl?: string;
}

export class BrowserManager {
  private port: number;
  private userDataDir: string;
  private headless: boolean;
  private startUrl: string;
  private process: ChildProcess | null = null;
  private logger: Logger | null = null;

  constructor(config: BrowserManagerConfig, logger?: Logger) {
    this.port = config.port;
    this.headless = config.headless || false;
    this.startUrl = config.startUrl || 'about:blank';
    this.logger = logger || null;

    // 设置用户数据目录
    if (config.userDataDir) {
      this.userDataDir = config.userDataDir;
    } else {
      // 使用临时目录
      const tempDir = path.join(os.homedir(), '.hotel-ai-browser', 'browser_data');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
      this.userDataDir = tempDir;
    }

    this.log('info', `浏览器管理器初始化 - 端口: ${this.port}, 数据目录: ${this.userDataDir}`);
  }

  /**
   * 日志记录辅助方法
   */
  private log(level: 'info' | 'warn' | 'error', message: string, meta?: any): void {
    if (this.logger) {
      this.logger[level]('browser-manager', message, meta);
    } else {
      console.log(`[BrowserManager] [${level.toUpperCase()}] ${message}`, meta || '');
    }
  }

  /**
   * 查找 Chrome 浏览器路径
   */
  private findChromePath(): string | null {
    const platform = process.platform;
    let possiblePaths: string[] = [];

    if (platform === 'win32') {
      // Windows 常见路径
      possiblePaths = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
        path.join(process.env.PROGRAMFILES || '', 'Google\\Chrome\\Application\\chrome.exe'),
        path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google\\Chrome\\Application\\chrome.exe'),
      ];
    } else if (platform === 'darwin') {
      // macOS
      possiblePaths = [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        path.join(os.homedir(), 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
      ];
    } else {
      // Linux
      possiblePaths = [
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
      ];
    }

    for (const chromePath of possiblePaths) {
      if (fs.existsSync(chromePath)) {
        this.log('info', `找到 Chrome: ${chromePath}`);
        return chromePath;
      }
    }

    return null;
  }

  /**
   * 查找 Edge 浏览器路径
   */
  private findEdgePath(): string | null {
    const platform = process.platform;
    let possiblePaths: string[] = [];

    if (platform === 'win32') {
      possiblePaths = [
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        path.join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft\\Edge\\Application\\msedge.exe'),
        path.join(process.env.PROGRAMFILES || '', 'Microsoft\\Edge\\Application\\msedge.exe'),
      ];
    } else if (platform === 'darwin') {
      possiblePaths = [
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      ];
    } else {
      possiblePaths = [
        '/usr/bin/microsoft-edge',
        '/usr/bin/microsoft-edge-stable',
      ];
    }

    for (const edgePath of possiblePaths) {
      if (fs.existsSync(edgePath)) {
        this.log('info', `找到 Edge: ${edgePath}`);
        return edgePath;
      }
    }

    return null;
  }

  /**
   * 启动浏览器
   */
  async start(): Promise<boolean> {
    if (this.isRunning()) {
      this.log('info', '浏览器已在运行');
      return true;
    }

    // 查找浏览器
    let browserPath = this.findChromePath();
    if (!browserPath) {
      browserPath = this.findEdgePath();
    }

    if (!browserPath) {
      this.log('error', '未找到 Chrome 或 Edge 浏览器');
      return false;
    }

    // 构建启动参数
    const args = [
      `--remote-debugging-port=${this.port}`,
      `--user-data-dir=${this.userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      // 禁用日志输出，减少终端刷屏
      '--log-level=3', // 只显示fatal错误
      '--disable-logging',
      '--silent-debugger-extension-api',
      this.startUrl,
    ];

    if (this.headless) {
      args.push('--headless');
    }

    try {
      this.log('info', `启动浏览器: ${browserPath} ${args.join(' ')}`);

      // 启动浏览器进程
      this.process = spawn(browserPath, args, {
        detached: false,
        stdio: 'ignore',
      });

      // 等待浏览器启动
      await new Promise(resolve => setTimeout(resolve, 2000));

      if (this.process && !this.process.killed) {
        this.log('info', `浏览器启动成功 - PID: ${this.process.pid}, 端口: ${this.port}`);
        
        // 监听进程退出
        this.process.on('exit', (code, signal) => {
          this.log('warn', `浏览器进程退出 - Code: ${code}, Signal: ${signal}`);
          this.process = null;
        });

        this.process.on('error', (error) => {
          this.log('error', `浏览器进程错误: ${error.message}`);
        });

        return true;
      } else {
        this.log('error', '浏览器启动失败');
        return false;
      }
    } catch (error) {
      this.log('error', `启动浏览器失败: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  /**
   * 检查浏览器是否在运行
   */
  isRunning(): boolean {
    return this.process !== null && !this.process.killed;
  }

  /**
   * 停止浏览器
   */
  stop(): void {
    if (!this.process) {
      return;
    }

    try {
      this.log('info', `停止浏览器 - PID: ${this.process.pid}`);
      
      // 终止进程
      this.process.kill('SIGTERM');

      // 等待进程结束
      setTimeout(() => {
        if (this.process && !this.process.killed) {
          this.log('warn', '浏览器未响应，强制终止');
          this.process.kill('SIGKILL');
        }
      }, 5000);

      this.log('info', '浏览器已停止');
    } catch (error) {
      this.log('error', `停止浏览器失败: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.process = null;
    }
  }

  /**
   * 重启浏览器
   */
  async restart(): Promise<boolean> {
    this.log('info', '重启浏览器');
    this.stop();
    await new Promise(resolve => setTimeout(resolve, 1000));
    return this.start();
  }

  /**
   * 获取调试端口
   */
  getPort(): number {
    return this.port;
  }

  /**
   * 获取用户数据目录
   */
  getUserDataDir(): string {
    return this.userDataDir;
  }
}

// 全局浏览器管理器实例
let globalBrowserManager: BrowserManager | null = null;

/**
 * 获取全局浏览器管理器实例
 */
export function getBrowserManager(config?: BrowserManagerConfig, logger?: Logger): BrowserManager {
  if (!globalBrowserManager && config) {
    globalBrowserManager = new BrowserManager(config, logger);
  }
  
  if (!globalBrowserManager) {
    throw new Error('BrowserManager not initialized. Please provide config on first call.');
  }
  
  return globalBrowserManager;
}

/**
 * 启动浏览器（便捷函数）
 */
export async function startBrowser(config: BrowserManagerConfig, logger?: Logger): Promise<boolean> {
  const manager = getBrowserManager(config, logger);
  return manager.start();
}

/**
 * 停止浏览器（便捷函数）
 */
export function stopBrowser(): void {
  if (globalBrowserManager) {
    globalBrowserManager.stop();
    globalBrowserManager = null;
  }
}

/**
 * 检查浏览器是否运行（便捷函数）
 */
export function isBrowserRunning(): boolean {
  return globalBrowserManager ? globalBrowserManager.isRunning() : false;
}
