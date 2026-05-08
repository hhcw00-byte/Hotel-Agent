/**
 * Window Manager - 窗口管理器
 *
 * 职责：
 * - 创建和管理BrowserWindow
 * - 创建和管理多个BrowserView标签页
 * - 处理窗口大小调整和布局更新
 * - 管理BrowserView的边界和位置
 */

import { BrowserWindow, BrowserView, Rectangle, WebPreferences, session } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  DEFAULT_WINDOW_WIDTH,
  DEFAULT_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  MIN_WINDOW_HEIGHT
} from '../shared/constants';
import { WEBDRIVER_REMOVER_SCRIPT } from './anti-detection/scripts/webdriver-remover';
import { generateCanvasProtectorScript } from './anti-detection/scripts/canvas-protector';
import { getExtraProtectionsScript } from './anti-detection/scripts/extra-protections';
import { NetworkProtector } from './anti-detection/network/network-protector';
import { GoogleCookieSync } from './google-cookie-sync';
import { GoogleAuthHelper } from './google-auth-helper';
import { GoogleAuthChrome } from './google-auth-chrome';

/**
 * 窗口配置接口
 */
export interface WindowConfig {
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
  webPreferences: WebPreferences;
}

/**
 * 标签页信息
 */
export interface TabInfo {
  id: string;
  title: string;
  url: string;
  isLoading: boolean;
  isCrawler?: boolean;
}

/**
 * 窗口管理器类
 */
export class WindowManager {
  private mainWindow: BrowserWindow | null = null;
  private isInitialized = false;

  // 多标签页管理
  private tabs: Map<string, BrowserView> = new Map();
  private activeTabId: string | null = null;
  private tabCounter = 0;
  private currentBounds: Rectangle | null = null;
  private authSuccessTime = 0; // Google 登录成功的时间戳
  // 有效期 7 天：在此期间 Google Cookie 有效，放行 OAuth 请求让 Electron 直接处理
  // 过期后重新拦截、弹出 Chrome 重新登录
  private static readonly AUTH_VALID_MS = 7 * 24 * 60 * 60 * 1000;

  /** 标记 Google 登录刚刚成功（持久化时间戳） */
  setGoogleLoginDone(): void {
    this.authSuccessTime = Date.now();
    try {
      const Store = require('electron-store');
      const store = new Store({ name: 'auth' });
      store.set('googleAuthSuccessTime', this.authSuccessTime);
    } catch {}
  }

  /** 从 electron-store 恢复上次成功时间 */
  restoreGoogleLoginDone(): void {
    try {
      const Store = require('electron-store');
      const store = new Store({ name: 'auth' });
      const saved = (store.get('googleAuthSuccessTime') as number) || 0;
      // 仅在有效期内恢复，过期则清除
      if (saved > 0 && (Date.now() - saved) < WindowManager.AUTH_VALID_MS) {
        this.authSuccessTime = saved;
      } else if (saved > 0) {
        // 过期了，清理
        store.delete('googleAuthSuccessTime');
        this.authSuccessTime = 0;
      }
      // 兼容旧版：如果有旧的 googleLoginDone 标志，清理掉
      if (store.get('googleLoginDone')) {
        store.delete('googleLoginDone');
      }
    } catch {}
  }

  /** 检查 Google 登录状态是否在有效期内 */
  private isGoogleAuthValid(): boolean {
    return this.authSuccessTime > 0 && (Date.now() - this.authSuccessTime) < WindowManager.AUTH_VALID_MS;
  }

  /** validateGoogleCookies — 不再需要，保留空方法避免调用方报错 */
  async validateGoogleCookies(): Promise<void> {}

  /** 重置登录状态（登出时调用） */
  resetGoogleLoginDone(): void {
    this.authSuccessTime = 0;
    try {
      const Store = require('electron-store');
      const store = new Store({ name: 'auth' });
      store.delete('googleAuthSuccessTime');
    } catch {}
  }

  // 🔥 爬虫运行状态标志：当爬虫运行时，window.open 改为当前页面导航
  private crawlerActive = false;

  // 后台隐藏标签页（爬虫用）
  // Map<tabId, { view, sessionId }> — sessionId 用于并发隔离，按 session 销毁
  private bgTabs: Map<string, { view: BrowserView; sessionId: string | null }> = new Map();
  // 后台爬虫窗口（独立隐藏 BrowserWindow，承载所有 bgTab 的 BrowserView）
  // show:false + beginFrameSubscription → Chromium 保持满帧渲染，CDP 截图不超时
  private bgWindow: BrowserWindow | null = null;

  // 调价专用窗口（show:true，独立于爬虫 bgWindow）
  // 携程/美团等平台的日期选择器在 show:false 窗口中 dispatchEvent 不正常工作
  // 调价任务通过 sessionId 前缀 price-adjust- 路由到此窗口
  private priceAdjustWindow: BrowserWindow | null = null;

  // 标签页更新回调（通知渲染进程）
  private onTabUpdate?: (tabs: TabInfo[], activeTabId: string | null) => void;

  // 文件监听器（用于爬虫IPC）
  private fileWatcher: NodeJS.Timeout | null = null;
  private processedRequests: Set<string> = new Set(); // 防止重复处理同一请求
  
  // 标签页锁定（防止外部事件干扰爬虫连接）
  private tabSwitchLocked: boolean = false;

  // preload 脚本路径（用于内部页面标签页）
  private preloadPath: string | null = null;

  // 当前语言（用于标签页默认标题等）
  private currentLanguage: 'zh' | 'en' = 'zh';

  // 标签页提升管理器（登录辅助功能）
  private tabPromotionManager: any = null;

  // Google Cookie 同步器（从系统 Chrome/Edge 同步 Google 登录态）
  private googleCookieSync: GoogleCookieSync = new GoogleCookieSync();
  private googleAuthHelper: GoogleAuthHelper = new GoogleAuthHelper();
  private googleAuthChrome: GoogleAuthChrome = new GoogleAuthChrome();
  private cookieSyncAttempted: boolean = false;

  /**
   * 设置语言
   */
  setLanguage(lang: 'zh' | 'en'): void {
    this.currentLanguage = lang;
    this.notifyTabUpdate();
  }

  /** 设置标签页提升管理器 */
  setTabPromotionManager(manager: any): void {
    this.tabPromotionManager = manager;
  }

  /**
   * 创建主窗口
   */
  createMainWindow(config: WindowConfig): BrowserWindow {
    console.log('WindowManager: Creating main window');

    // 保存 preload 路径，供内部页面标签页使用
    if (config.webPreferences?.preload) {
      this.preloadPath = config.webPreferences.preload;
    }

    this.mainWindow = new BrowserWindow({
      width: config.width,
      height: config.height,
      minWidth: config.minWidth,
      minHeight: config.minHeight,
      title: 'Hotel-Agent',
      show: false,
      backgroundColor: '#ffffff',
      webPreferences: config.webPreferences
    });

    // 🔥 全局 session 级别拦截：捕获所有到 accounts.google.com 的主框架导航
    // 这是最可靠的拦截层，无论导航来自 will-navigate、302 重定向、iframe、还是 window.open，
    // 网络请求都必须经过这里
    this.setupGoogleAuthInterception();

    // 🔥 session 级别 Client Hints 注入：清理 UA 中的 Electron 标识，注入 Sec-CH-UA 系列头
    // 解决 Booking.com 等使用 PerimeterX/HUMAN 反机器人的平台检测 Electron 的问题
    NetworkProtector.setupSessionClientHints(session.defaultSession);

    this.mainWindow.on('closed', () => {
      console.log('WindowManager: Main window closed');
      this.cleanup();
    });

    this.isInitialized = true;
    
    // 启动文件监听器（用于爬虫IPC）
    this.startFileWatcher();
    
    console.log('WindowManager: Main window created');

    return this.mainWindow;
  }

  /**
   * 设置标签页更新回调
   */
  setOnTabUpdate(callback: (tabs: TabInfo[], activeTabId: string | null) => void): void {
    this.onTabUpdate = callback;
  }

  /**
   * 创建新标签页
   * @param url 可选的初始URL
   * @param switchToTab 是否立即切换到新标签页（默认true）
   */
  createTab(url?: string, switchToTab: boolean = true): string {
    if (!this.mainWindow) {
      throw new Error('Main window must be created before creating tabs');
    }

    const tabId = `tab-${++this.tabCounter}`;
    console.log('WindowManager: Creating tab:', tabId);

    // 判断是否为内部页面（本地文件路径，非 http/https），内部页面需要注入 preload
    const isInternalPage = url ? (!url.startsWith('http://') && !url.startsWith('https://')) : false;

    const webPreferences: any = {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webSecurity: false,
      allowRunningInsecureContent: true,
      experimentalFeatures: true
    };

    if (isInternalPage && this.preloadPath) {
      webPreferences.preload = this.preloadPath;
      console.log('WindowManager: Internal page detected, injecting preload for tab:', tabId);
    }

    const view = new BrowserView({ webPreferences });

    view.setBackgroundColor('#ffffff');
    const userAgent = NetworkProtector.getRealisticUserAgent();
    view.webContents.setUserAgent(userAgent);

    // 注入反检测脚本：在每个页面加载前执行，覆盖 webdriver / canvas / WebRTC 等指纹
    this.injectAntiDetectionScripts(view);

    // 🔥 拦截新窗口打开，改为在新标签页中打开
    view.webContents.setWindowOpenHandler((details) => {
      console.log('WindowManager: Intercepting window.open:', details.url);

      // Google 登录拦截已由 session 级别的 setupGoogleAuthInterception() 处理
      // 这里不再需要 isGoogleAuthURL 检查
      let newTabId: string;
      // 创建新标签页并加载URL，立即切换过去（像 Chrome 一样）
      newTabId = this.createTab(details.url, true);
      console.log('WindowManager: Opened URL in new tab and switched:', newTabId);

      // 🔥 通知 crawler 有新标签页被创建（通过临时文件）
      try {
        const tempDir = os.tmpdir();
        const notifyFile = path.join(tempDir, 'hotel-ai-browser-new-tab.json');
        const notification = {
          action: 'new_tab_created',
          tabId: newTabId,
          url: details.url,
          timestamp: Date.now()
        };
        fs.writeFileSync(notifyFile, JSON.stringify(notification, null, 2));
        console.log('WindowManager: Notified crawler about new tab:', notifyFile);
      } catch (error) {
        console.error('WindowManager: Failed to notify crawler about new tab:', error);
      }

      // 返回 { action: 'deny' } 阻止打开新窗口
      return { action: 'deny' };
    });

    // 监听页面标题变化
    view.webContents.on('page-title-updated', () => {
      this.notifyTabUpdate();
    });

    // 监听导航完成
    view.webContents.on('did-finish-load', () => {
      this.notifyTabUpdate();
    });

    // 🔥 拦截导航到 Google 登录页面：阻止在当前标签页加载，改为走子进程登录
    // Google 登录拦截已由 session 级别的 setupGoogleAuthInterception() 处理
    view.webContents.on('will-navigate', (_event, _navigationUrl) => {
      // no-op: session interceptor handles Google auth
    });

    // Google 登录拦截已由 session 级别的 setupGoogleAuthInterception() 处理
    // did-navigate 不再需要 Google auth 处理
    view.webContents.on('did-navigate', (_event, _url) => {
      // no-op: session interceptor handles Google auth
    });

    // 🔥 诊断日志：记录所有导航，帮助排查 Google 登录流程
    view.webContents.on('did-start-navigation', (_event, url, isInPlace, isMainFrame) => {
      if (isMainFrame && (url.includes('google.com') || url.includes('accounts.'))) {
        console.log(`[GoogleAuth:diag] did-start-navigation: mainFrame=${isMainFrame} url=${url}`);
      }
    });

    // 监听导航开始
    view.webContents.on('did-start-loading', () => {
      this.notifyTabUpdate();
    });

    // 监听导航结束
    view.webContents.on('did-stop-loading', () => {
      this.notifyTabUpdate();
    });

    // 页面加载失败通知渲染进程
    view.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame || errorCode === -3) return; // -3 = ERR_ABORTED（用户取消，忽略）
      console.error(`[Tab ${tabId}] Load failed: ${errorCode} ${errorDescription} ${validatedURL}`);
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('webview:load-error', { errorCode, errorDescription, url: validatedURL });
      }
    });

    // 渲染进程崩溃自动恢复
    view.webContents.on('render-process-gone', (_event, details) => {
      console.error(`[Tab ${tabId}] Renderer crashed: reason=${details.reason}, exitCode=${details.exitCode}`);
      const lastUrl = view.webContents.getURL();
      if (lastUrl && details.reason === 'crashed') {
        console.log(`[Tab ${tabId}] Auto-reloading: ${lastUrl}`);
        setTimeout(() => {
          try {
            view.webContents.loadURL(lastUrl).catch(() => {});
          } catch {}
        }, 500);
      }
    });

    this.tabs.set(tabId, view);

    // 根据参数决定是否切换到新标签页
    if (switchToTab) {
      this.switchTab(tabId);
    }

    // 如果提供了URL则导航
    if (url) {
      // 本地文件路径需要用 loadFile 加载，否则 loadURL 可能失败
      if (isInternalPage && !url.startsWith('file://')) {
        view.webContents.loadFile(url).catch((error: any) => {
          console.error('WindowManager: Failed to load file in new tab:', error);
        });
      } else {
        view.webContents.loadURL(url).catch((error: any) => {
          if (error.errno !== -3 && error.code !== 'ERR_ABORTED') {
            console.error('WindowManager: Failed to load URL in new tab:', error);
          }
        });
      }
    }

    console.log('WindowManager: Tab created:', tabId);
    return tabId;
  }

  /**
   * 判断 URL 是否为 Google 登录/OAuth 相关页面
   */
  private isGoogleAuthURL(url: string): boolean {
    if (!url) return false;
    const lower = url.toLowerCase();
    return (
      lower.includes('accounts.google.com') ||
      lower.includes('accounts.youtube.com') ||
      lower.includes('myaccount.google.com/signinoptions') ||
      lower.includes('googleapis.com/identitytoolkit')
    );
  }

  /**
   * 🔥 全局 session 级别的 Google 登录拦截
   *
   * 无论 Google 登录是通过什么方式触发的（用户点击链接、window.open、302 重定向、iframe），
   * 网络请求都必须经过 session.webRequest。这里在网络层拦截所有到 accounts.google.com 的
   * 主框架（顶层页面）导航请求，阻止它在 Electron 主进程中加载（会被 Google 检测到 CDP），
   * 转而启动干净的子进程完成登录。
   */
  private setupGoogleAuthInterception(): void {
    const ses = session.defaultSession;
    let subprocessLaunched = false;
    const logFile = path.join(os.tmpdir(), 'hotel-ai-google-auth-debug.log');

    // 文件日志（绕开 console.log 可能的缓冲问题）
    const debugLog = (msg: string) => {
      const line = `[${new Date().toISOString()}] ${msg}\n`;
      console.log('[GoogleAuth]', msg);
      try { fs.appendFileSync(logFile, line); } catch {};
    };

    debugLog(`Interceptor installed, log file: ${logFile}`);

    ses.webRequest.onBeforeRequest(
      { urls: [
        '*://accounts.google.com/*',
        '*://accounts.youtube.com/*',
      ]},
      (details, callback) => {
        if (details.resourceType === 'mainFrame') {
          debugLog(`INTERCEPTED mainFrame: ${details.url}`);

          if (!subprocessLaunched) {
            subprocessLaunched = true;
            debugLog('Launching system Chrome auth...');

            this.googleAuthChrome.performGoogleAuth(details.url)
              .then((result) => {
                debugLog(`Chrome auth result: ${JSON.stringify({ success: result.success, hasRedirectUrl: !!result.redirectUrl })}`);
                if (result.success && result.redirectUrl) {
                  this.setGoogleLoginDone(); // 设置冷却期
                  const activeView = this.getActiveView();
                  if (activeView) {
                    debugLog('Navigating to callback URL: ' + result.redirectUrl);
                    activeView.webContents.loadURL(result.redirectUrl);
                  }
                } else if (result.success) {
                  this.setGoogleLoginDone();
                  const activeView = this.getActiveView();
                  if (activeView) {
                    debugLog('No redirect URL, reloading active tab');
                    activeView.webContents.reload();
                  }
                }
              })
              .catch((err) => {
                debugLog(`Chrome auth ERROR: ${err}`);
              })
              .finally(() => {
                subprocessLaunched = false;
              });
          } else {
            debugLog('Chrome auth already in progress, skipping');
          }

          callback({ cancel: true });
        } else {
          callback({});
        }
      }
    );
  }

  /**
   * 供 IPC handler 调用：启动系统 Chrome 完成 Google 登录，返回用户信息
   */
  async performGoogleLogin(): Promise<{ success: boolean; redirectUrl?: string; userInfo?: { email: string; displayName: string } }> {
    const result = await this.googleAuthChrome.performGoogleAuth('https://accounts.google.com/');
    if (result.success) {
      // 登录成功：设置冷却期，让后续 Google OAuth 回调在冷却期内直接通过
      this.setGoogleLoginDone();
    }
    return result;
  }

  /**
   * 尝试从系统 Chrome/Edge 同步 Google Cookie
   * 如果同步成功，刷新当前页面（Google 会发现已登录，直接授权回跳）
   * 如果同步失败，降级到独立子进程完成 Google 登录
   */
  private async tryGoogleCookieSync(url: string): Promise<void> {
    // 每次会话只尝试一次同步（避免重复弹窗或重复操作）
    if (this.cookieSyncAttempted) {
      console.log('[GoogleAuth] Cookie sync already attempted, falling back to subprocess auth');
      this.launchSubprocessAuth(url);
      return;
    }

    this.cookieSyncAttempted = true;
    console.log('[GoogleAuth] Attempting Google cookie sync from system browser...');

    try {
      const count = await this.googleCookieSync.sync();

      if (count > 0) {
        console.log(`[GoogleAuth] Cookie sync successful (${count} cookies), reloading page`);
        // 同步成功，刷新当前活跃标签页
        const activeView = this.getActiveView();
        if (activeView) {
          activeView.webContents.reload();
        }
      } else {
        console.log('[GoogleAuth] Cookie sync returned 0 cookies, falling back to subprocess auth');
        this.launchSubprocessAuth(url);
      }
    } catch (error) {
      console.error('[GoogleAuth] Cookie sync failed:', error);
      this.launchSubprocessAuth(url);
    }
  }

  /**
   * 启动系统 Chrome 完成 Google 登录
   *
   * 使用用户系统上真正的 Chrome 浏览器，Google 100% 信任。
   * 登录成功后通过 CDP 提取 cookie，导入 Electron session，然后刷新页面。
   */
  private async launchSubprocessAuth(url: string): Promise<void> {
    console.log('[GoogleAuth] Launching system Chrome for Google auth:', url);

    try {
      const result = await this.googleAuthChrome.performGoogleAuth(url);

      if (result.success) {
        console.log('[GoogleAuth] Chrome auth successful, reloading active tab');
        const activeView = this.getActiveView();
        if (activeView) {
          if (result.redirectUrl) {
            activeView.webContents.loadURL(result.redirectUrl);
          } else {
            activeView.webContents.reload();
          }
        }
      } else {
        console.log('[GoogleAuth] Chrome auth failed or cancelled');
      }
    } catch (error) {
      console.error('[GoogleAuth] Chrome auth error:', error);
    }
  }

  /**
   * 创建"干净"标签页（专门用于 Google OAuth 等对自动化检测严格的登录页面）
   *
   * 与普通标签页的区别：
   * - 不注入任何反检测脚本（避免 JS 层面被检测到覆盖痕迹）
   * - 不 attach CDP debugger
   * - 开启 webSecurity（正常同源策略）
   * - 拦截对 CDP 调试端口（127.0.0.1:9222）的探测请求
   * - 使用干净的 Chrome User-Agent（不带 Electron 标识）
   *
   * Cookie/Session 与普通标签页共享（同一个默认 partition），
   * 所以登录成功后其他标签页自动获得登录态。
   */
  createCleanTab(url?: string, switchToTab: boolean = true): string {
    if (!this.mainWindow) {
      throw new Error('Main window must be created before creating tabs');
    }

    const tabId = `tab-${++this.tabCounter}`;
    console.log('WindowManager: Creating CLEAN tab (no anti-detection):', tabId);

    const webPreferences: any = {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,       // 开启沙箱，更接近真实 Chrome
      webSecurity: true,   // 开启同源策略
      allowRunningInsecureContent: false,
      experimentalFeatures: false
    };

    const view = new BrowserView({ webPreferences });
    view.setBackgroundColor('#ffffff');

    // 设置干净的 Chrome User-Agent（不带 Electron 标识）
    const chromeVersion = process.versions.chrome || '120.0.0.0';
    const platform = process.platform === 'win32' ? 'Windows NT 10.0; Win64; x64' :
                     process.platform === 'darwin' ? 'Macintosh; Intel Mac OS X 10_15_7' :
                     'X11; Linux x86_64';
    const cleanUA = `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
    view.webContents.setUserAgent(cleanUA);

    // 🔥 关键：拦截对 CDP 调试端口的探测请求
    // Google 的检测脚本可能通过 fetch/XHR 探测 127.0.0.1:9222 来判断是否被自动化控制
    const ses = view.webContents.session;
    ses.webRequest.onBeforeRequest(
      { urls: ['*://127.0.0.1:9222/*', '*://localhost:9222/*', '*://[::1]:9222/*'] },
      (details, callback) => {
        console.log('[CleanTab] Blocked CDP probe request:', details.url);
        callback({ cancel: true });
      }
    );

    // 🔥 不注入任何反检测脚本，不 attach debugger
    // 这样 Google 的检测脚本看到的是一个完全原生的 Chromium 环境

    // 拦截新窗口打开（与普通标签页一致）
    view.webContents.setWindowOpenHandler((details) => {
      console.log('WindowManager: [CleanTab] Intercepting window.open:', details.url);

      // Google 登录拦截已由 session interceptor 处理，新窗口直接在新标签打开
      this.createTab(details.url, true);

      return { action: 'deny' };
    });

    // 监听导航：如果用户从 Google 登录页面导航到非 Google 页面（登录完成），
    // 不需要特殊处理，cookie 已经在 session 中了
    view.webContents.on('page-title-updated', () => {
      this.notifyTabUpdate();
    });

    view.webContents.on('did-finish-load', () => {
      this.notifyTabUpdate();
    });

    view.webContents.on('did-start-loading', () => {
      this.notifyTabUpdate();
    });

    view.webContents.on('did-stop-loading', () => {
      this.notifyTabUpdate();
    });

    view.webContents.on('render-process-gone', (_event, details) => {
      console.error(`[CleanTab ${tabId}] Renderer crashed: reason=${details.reason}, exitCode=${details.exitCode}`);
      const lastUrl = view.webContents.getURL();
      if (lastUrl && details.reason === 'crashed') {
        setTimeout(() => {
          try { view.webContents.loadURL(lastUrl).catch(() => {}); } catch {}
        }, 500);
      }
    });

    this.tabs.set(tabId, view);

    if (switchToTab) {
      this.switchTab(tabId);
    }

    if (url) {
      view.webContents.loadURL(url).catch((error: any) => {
        if (error.errno !== -3 && error.code !== 'ERR_ABORTED') {
          console.error('WindowManager: Failed to load URL in clean tab:', error);
        }
      });
    }

    console.log('WindowManager: Clean tab created:', tabId);
    return tabId;
  }

  /**
   * 获取或创建后台爬虫窗口（独立隐藏 BrowserWindow）
   * 所有 bgTab 的 BrowserView 都挂在此窗口上，与 mainWindow 完全隔离
   */
  private getOrCreateBgWindow(): BrowserWindow {
    if (this.bgWindow && !this.bgWindow.isDestroyed()) {
      return this.bgWindow;
    }

    this.bgWindow = new BrowserWindow({
      show: false,
      width: 1280,
      height: 800,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      }
    });

    console.log('WindowManager: Background window created');
    return this.bgWindow;
  }

  /** 当没有 bgTab 时关闭 bgWindow 释放资源 */
  private maybeCloseBgWindow(): void {
    if (this.bgTabs.size === 0 && this.bgWindow && !this.bgWindow.isDestroyed()) {
      this.bgWindow.close();
      this.bgWindow = null;
      console.log('WindowManager: Background window closed (no bg tabs)');
    }
  }

  /**
   * 获取或创建调价专用窗口（show:true）
   * 携程/美团等平台的日期选择器在 show:false 窗口中不正常工作，
   * 调价任务需要 show:true 的窗口才能让 Chromium 做完整的事件处理。
   */
  private getOrCreatePriceAdjustWindow(): BrowserWindow {
    if (this.priceAdjustWindow && !this.priceAdjustWindow.isDestroyed()) {
      return this.priceAdjustWindow;
    }

    this.priceAdjustWindow = new BrowserWindow({
      show: true,
      width: 1280,
      height: 800,
      skipTaskbar: true,
      title: 'Price Adjust',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      }
    });

    console.log('WindowManager: Price adjust window created (show:true)');
    return this.priceAdjustWindow;
  }

  /** 当没有调价 bgTab 时关闭调价窗口 */
  private maybeClosePriceAdjustWindow(): void {
    // 检查 bgTabs 中是否还有 price-adjust- 前缀的 session
    let hasPriceAdjustTabs = false;
    for (const [, entry] of this.bgTabs) {
      if (entry.sessionId && entry.sessionId.startsWith('price-adjust-')) {
        hasPriceAdjustTabs = true;
        break;
      }
    }
    if (!hasPriceAdjustTabs && this.priceAdjustWindow && !this.priceAdjustWindow.isDestroyed()) {
      this.priceAdjustWindow.destroy();
      this.priceAdjustWindow = null;
      console.log('WindowManager: Price adjust window closed (no price-adjust tabs)');
    }
  }

  /**
   * 创建后台隐藏标签页（爬虫专用，不显示给用户）
   * 返回 { tabId, targetId } — targetId 是 CDP target ID，爬虫用它连接
   * @param url 初始 URL
   * @param sessionId 可选的 session ID，用于并发隔离
   */
  createBgTab(url: string, sessionId?: string): { tabId: string; targetId: string } {
    if (!this.mainWindow) {
      throw new Error('Main window must be created before creating bg tabs');
    }

    // 路由：price-adjust- 前缀的 session 走 show:true 的调价窗口，其他走 show:false 的爬虫窗口
    const isPriceAdjust = sessionId && sessionId.startsWith('price-adjust-');
    const bgWin = isPriceAdjust ? this.getOrCreatePriceAdjustWindow() : this.getOrCreateBgWindow();
    const tabId = `bg-tab-${++this.tabCounter}`;
    console.log('WindowManager: Creating background tab:', tabId);

    const view = new BrowserView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
        webSecurity: false,
        allowRunningInsecureContent: true,
        experimentalFeatures: true,
        backgroundThrottling: false
      }
    });

    view.setBackgroundColor('#ffffff');
    const userAgent = NetworkProtector.getRealisticUserAgent();
    view.webContents.setUserAgent(userAgent);

    // 注入反检测脚本（和普通标签页一致）
    this.injectAntiDetectionScripts(view);

    // 关键：拦截 bg tab 的 localStorage 写入，防止触发可见 tab 的 storage 事件
    // bg tab 可以读取 localStorage（获取认证 token），但写入走 shadow store
    view.webContents.on('dom-ready', () => {
      view.webContents.executeJavaScript(`
        (function() {
          if (window.__bgLocalStoragePatched) return;
          window.__bgLocalStoragePatched = true;
          var shadow = {};
          var origGet = localStorage.getItem.bind(localStorage);
          var origSet = localStorage.setItem.bind(localStorage);
          var origRemove = localStorage.removeItem.bind(localStorage);
          localStorage.getItem = function(k) {
            return (k in shadow) ? shadow[k] : origGet(k);
          };
          localStorage.setItem = function(k, v) {
            shadow[k] = String(v);
          };
          localStorage.removeItem = function(k) {
            delete shadow[k];
          };
        })();
      `).catch(() => {});
    });

    // 挂到对应窗口：调价走 priceAdjustWindow(show:true)，爬虫走 bgWindow(show:false)
    bgWin.addBrowserView(view);
    const bgBounds = bgWin.getContentBounds();
    view.setBounds({ x: 0, y: 0, width: bgBounds.width, height: bgBounds.height });

    // 增加 capturer count：show:false + capturer count > 0 = Chromium 保持满帧渲染
    // 调价窗口 show:true 不需要，但设置了也无害
    view.webContents.setBackgroundThrottling(false);
    try {
      view.webContents.beginFrameSubscription(true, () => {});
    } catch {}

    this.bgTabs.set(tabId, { view, sessionId: sessionId || null });
    this.notifyTabUpdate();

    // 🔥 拦截 bg tab 中的 window.open（target="_blank" 链接等）
    // 创建新 BrowserView 挂到 bgWindow，写通知文件让爬虫检测到新页面
    view.webContents.setWindowOpenHandler((details) => {
      console.log('WindowManager: [bg] Intercepting window.open in bg tab:', details.url);

      const newTabId = `bg-tab-${++this.tabCounter}`;
      const newView = new BrowserView({
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: false,
          webSecurity: false,
          allowRunningInsecureContent: true,
          experimentalFeatures: true,
          backgroundThrottling: false
        }
      });
      newView.setBackgroundColor('#ffffff');
      const newUserAgent = NetworkProtector.getRealisticUserAgent();
      newView.webContents.setUserAgent(newUserAgent);
      this.injectAntiDetectionScripts(newView);

      // 子标签页挂到与父标签页相同的窗口
      const bgW = isPriceAdjust ? this.getOrCreatePriceAdjustWindow() : this.getOrCreateBgWindow();
      bgW.addBrowserView(newView);
      const bounds = bgW.getContentBounds();
      newView.setBounds({ x: 0, y: 0, width: bounds.width, height: bounds.height });

      // 增加 capturer count
      newView.webContents.setBackgroundThrottling(false);
      try {
        newView.webContents.beginFrameSubscription(true, () => {});
      } catch {}

      this.bgTabs.set(newTabId, { view: newView, sessionId: sessionId || null });

      // 导航到目标 URL
      newView.webContents.loadURL(details.url).catch(() => {});

      // 写通知文件，让爬虫的 switchToNewTab() 能通过轮询检测到新页面
      // 使用 session-scoped 文件名避免并发冲突
      try {
        const notifyFileName = sessionId
          ? `hotel-ai-browser-new-tab-${sessionId}.json`
          : 'hotel-ai-browser-new-tab.json';
        const notifyFile = path.join(os.tmpdir(), notifyFileName);
        const notification = {
          action: 'new_tab_created',
          tabId: newTabId,
          url: details.url,
          timestamp: Date.now()
        };
        fs.writeFileSync(notifyFile, JSON.stringify(notification, null, 2));
        console.log('WindowManager: [bg] Notified crawler about new bg tab:', newTabId);
      } catch (error) {
        console.error('WindowManager: [bg] Failed to notify crawler about new bg tab:', error);
      }

      return { action: 'deny' };
    });

    // 绑定标签页事件（让爬虫标签页标题实时更新）
    view.webContents.on('page-title-updated', () => this.notifyTabUpdate());
    view.webContents.on('did-finish-load', () => this.notifyTabUpdate());

    // 导航到目标 URL
    view.webContents.loadURL(url).catch((error: any) => {
      if (error.errno !== -3 && error.code !== 'ERR_ABORTED') {
        console.error('WindowManager: Failed to load URL in bg tab:', error);
      }
    });

    // 获取 CDP targetId
    const targetId = (view.webContents as any).getProcessId
      ? String((view.webContents as any).mainFrame?.routingId ?? '')
      : '';

    // 用 debugger API 拿真实 targetId
    const wc = view.webContents as any;
    const realTargetId: string = wc._targetId || wc.debugger?._targetId || '';

    console.log('WindowManager: Background tab created:', tabId, 'targetId:', realTargetId || '(pending)');
    return { tabId, targetId: realTargetId };
  }

  /**
   * 销毁后台隐藏标签页
   */
  destroyBgTab(tabId: string): void {
    const entry = this.bgTabs.get(tabId);
    if (!entry) {
      console.warn('WindowManager: BgTab not found:', tabId);
      return;
    }
    const isPriceAdjust = entry.sessionId && entry.sessionId.startsWith('price-adjust-');
    try {
      // Remove from the correct parent window
      if (isPriceAdjust) {
        if (this.priceAdjustWindow && !this.priceAdjustWindow.isDestroyed()) {
          this.priceAdjustWindow.removeBrowserView(entry.view);
        }
      } else {
        if (this.bgWindow && !this.bgWindow.isDestroyed()) {
          this.bgWindow.removeBrowserView(entry.view);
        }
      }
      (entry.view.webContents as any).destroy();
    } catch (e) {
      console.warn('WindowManager: Error destroying bg tab:', e);
    }
    this.bgTabs.delete(tabId);
    this.notifyTabUpdate();
    // 关闭不再需要的窗口
    if (isPriceAdjust) {
      this.maybeClosePriceAdjustWindow();
    } else {
      this.maybeCloseBgWindow();
    }
    console.log('WindowManager: Background tab destroyed:', tabId);
  }

  /**
   * 销毁所有后台隐藏标签页（爬虫任务结束时调用，清理所有 bg tab 包括子标签页）
   */
  destroyAllBgTabs(): void {
    const count = this.bgTabs.size;
    if (count === 0) return;

    console.log(`WindowManager: Destroying all ${count} background tab(s)`);
    for (const [tabId, entry] of this.bgTabs) {
      try {
        const isPriceAdjust = entry.sessionId && entry.sessionId.startsWith('price-adjust-');
        if (isPriceAdjust) {
          if (this.priceAdjustWindow && !this.priceAdjustWindow.isDestroyed()) {
            this.priceAdjustWindow.removeBrowserView(entry.view);
          }
        } else {
          if (this.bgWindow && !this.bgWindow.isDestroyed()) {
            this.bgWindow.removeBrowserView(entry.view);
          }
        }
        (entry.view.webContents as any).destroy();
      } catch (e) {
        console.warn('WindowManager: Error destroying bg tab:', tabId, e);
      }
    }
    this.bgTabs.clear();
    this.notifyTabUpdate();
    this.maybeCloseBgWindow();
    this.maybeClosePriceAdjustWindow();
    console.log('WindowManager: All background tabs destroyed');
  }

  /**
   * 按 sessionId 销毁后台隐藏标签页（并发安全：只销毁属于指定 session 的 bg tab）
   */
  destroyBgTabsBySession(sessionId: string): void {
    const toDestroy: string[] = [];
    for (const [tabId, entry] of this.bgTabs) {
      // 前缀匹配：支持用 "recovery-api-ctrip-public" 清理
      // "recovery-api-ctrip-public-1776663660017" 等带时间戳的 session
      if (entry.sessionId === sessionId || entry.sessionId?.startsWith(sessionId)) {
        toDestroy.push(tabId);
      }
    }

    if (toDestroy.length === 0) {
      console.log(`WindowManager: No bg tabs found for session: ${sessionId}`);
      return;
    }

    const isPriceAdjustSession = sessionId.startsWith('price-adjust-');
    console.log(`WindowManager: Destroying ${toDestroy.length} bg tab(s) for session: ${sessionId}`);
    for (const tabId of toDestroy) {
      const entry = this.bgTabs.get(tabId);
      if (entry) {
        try {
          const isPriceAdjust = entry.sessionId && entry.sessionId.startsWith('price-adjust-');
          if (isPriceAdjust) {
            if (this.priceAdjustWindow && !this.priceAdjustWindow.isDestroyed()) {
              this.priceAdjustWindow.removeBrowserView(entry.view);
            }
          } else {
            if (this.bgWindow && !this.bgWindow.isDestroyed()) {
              this.bgWindow.removeBrowserView(entry.view);
            }
          }
          (entry.view.webContents as any).destroy();
        } catch (e) {
          console.warn('WindowManager: Error destroying bg tab:', tabId, e);
        }
        this.bgTabs.delete(tabId);
      }
    }
    this.notifyTabUpdate();
    if (isPriceAdjustSession) {
      this.maybeClosePriceAdjustWindow();
    } else {
      this.maybeCloseBgWindow();
    }
    console.log(`WindowManager: Session ${sessionId} bg tabs destroyed`);
  }

  /**
   * 向 BrowserView 注入所有反检测脚本
   * 使用 CDP Page.addScriptToEvaluateOnNewDocument 一次性注册。
   * 注册完成后立即 detach debugger，避免 debugger 持续监控导致
   * 微前端应用创建/销毁执行上下文时产生竞态崩溃。
   */
  private injectAntiDetectionScripts(view: BrowserView): void {
    const platform = process.platform;

    // 拼接所有保护脚本为一段代码
    const combinedScript = [
      WEBDRIVER_REMOVER_SCRIPT,
      generateCanvasProtectorScript(0.001, platform),
      getExtraProtectionsScript(platform),
    ].join('\n;\n');

    // Booking 域名跳过反检测脚本：AWS WAF 的 challenge.js 会检测 native API 被覆盖的痕迹
    // 反检测脚本覆盖 navigator.webdriver / canvas / permissions 等 API 后，
    // 这些覆盖的 toString() 不再返回 "[native code]"，反而暴露了自动化环境
    // Booking 不需要这些覆盖（它不检测 webdriver），但 AWS WAF 会检测覆盖本身
    const safeScript = `(function(){
      var h = location.hostname || '';
      if (h.indexOf('booking.com') !== -1) return;
      ${combinedScript}
    })();`;

    // 标记是否已通过 CDP 注册过
    let cdpInjected = false;

    // 首次主框架导航时通过 CDP 注册脚本，注册后立即 detach
    view.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
      if (!isMainFrame) return;
      if (cdpInjected) return;

      const debugger_ = view.webContents.debugger;
      if (!debugger_.isAttached()) {
        try {
          debugger_.attach('1.3');
        } catch {
          return; // 无法 attach，走 dom-ready 降级
        }
      }

      if (debugger_.isAttached()) {
        debugger_.sendCommand('Page.addScriptToEvaluateOnNewDocument', {
          source: safeScript,
          worldName: 'main',
          includeCommandLineAPI: false,
          runImmediately: false,
        }).then(() => {
          cdpInjected = true;
          console.log('[AntiDetection] CDP script registered, detaching debugger');
          try { debugger_.detach(); } catch {}
        }).catch((err: any) => {
          console.warn('[AntiDetection] CDP inject failed:', err?.message);
          try { debugger_.detach(); } catch {}
        });
      }
    });

    // 降级保障：dom-ready 时执行（CDP 不可用或首次导航还没注册成功时）
    view.webContents.on('dom-ready', () => {
      view.webContents.executeJavaScript(safeScript).catch(() => {});
    });

    // Booking 专项：清除被污染的 AWS WAF token cookie
    // AWS WAF 的 aws-waf-token 一旦被标记为可疑，会导致无限 challenge 循环
    // 在导航到 booking.com 时清除这些 token，让 WAF 重新评估
    let lastBookingCleanTime = 0;
    const cleanBookingWafCookies = (url: string) => {
      if (!url.includes('booking.com')) return;
      // 同一秒内不重复清理（避免重定向循环中反复触发）
      const now = Date.now();
      if (now - lastBookingCleanTime < 1000) return;
      lastBookingCleanTime = now;

      const ses = view.webContents.session;
      ses.cookies.get({}).then(cookies => {
        const wafCookies = cookies.filter(c =>
          ((c.domain || '').includes('booking.com') || (c.domain || '').includes('awswaf.com')) &&
          c.name.includes('aws-waf-token')
        );
        for (const c of wafCookies) {
          const dom = (c.domain || '').replace(/^\./, '') || 'booking.com';
          const cookieUrl = `${c.secure ? 'https' : 'http'}://${dom}${c.path}`;
          ses.cookies.remove(cookieUrl, c.name).catch(() => {});
        }
        if (wafCookies.length > 0) {
          console.log(`[AntiDetection] Cleared ${wafCookies.length} AWS WAF cookie(s) for booking.com`);
        }
      }).catch(() => {});
    };
    view.webContents.on('will-navigate', (_event, url) => cleanBookingWafCookies(url));
    view.webContents.on('did-start-navigation', (_event2, url2) => cleanBookingWafCookies(url2));
  }

  /**
   * 关闭标签页
   */
  public closeTab(tabId: string): void {
    // 如果是爬虫后台标签页，直接销毁
    if (this.bgTabs.has(tabId)) {
      this.destroyBgTab(tabId);
      this.notifyTabUpdate();
      return;
    }

    const view = this.tabs.get(tabId);
    if (!view) {
      console.warn('WindowManager: Tab not found:', tabId);
      return;
    }

    console.log('WindowManager: Closing tab:', tabId);

    // 如果是已提升的登录标签页，自动触发跳过
    if (this.tabPromotionManager && this.tabPromotionManager.isPromotedTab(tabId)) {
      const info = this.tabPromotionManager.getPromotedTabInfo(tabId);
      if (info) {
        console.log('WindowManager: Closing promoted login tab, triggering skip:', tabId);
        try {
          const responseFile = path.join(os.tmpdir(), `hotel-ai-browser-ipc-${info.requestId}.response.json`);
          fs.writeFileSync(responseFile, JSON.stringify({
            action: 'login_done', requestId: info.requestId, result: 'skipped', timestamp: Date.now(),
          }));
        } catch {}
        this.tabPromotionManager.dismissAndCleanup(tabId);
      }
    }

    // 如果关闭的是活跃标签页，需要切换到其他标签页
    if (this.activeTabId === tabId) {
      const tabIds = Array.from(this.tabs.keys());
      const currentIndex = tabIds.indexOf(tabId);

      // 从窗口移除当前视图
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.removeBrowserView(view);
      }

      this.activeTabId = null;

      // 切换到相邻标签页
      if (tabIds.length > 1) {
        const nextIndex = currentIndex > 0 ? currentIndex - 1 : 1;
        const nextTabId = tabIds[nextIndex];
        if (nextTabId !== tabId) {
          this.switchTab(nextTabId);
        }
      }
    } else {
      // 非活跃标签页直接从窗口移除
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.removeBrowserView(view);
      }
    }

    // 销毁 webContents
    (view.webContents as any).destroy?.();
    this.tabs.delete(tabId);

    this.notifyTabUpdate();
    console.log('WindowManager: Tab closed:', tabId);
  }

  /**
   * 切换标签页
   */
  switchTab(tabId: string): void {
    // 如果标签页被锁定，忽略切换请求（除非是来自爬虫的请求）
    if (this.tabSwitchLocked) {
      console.log('WindowManager: Tab switch ignored (locked)');
      return;
    }

    // 爬虫后台标签页不可切换（防止用户干扰爬取）
    if (this.bgTabs.has(tabId)) {
      console.log('WindowManager: Tab switch ignored (crawler bg tab)');
      return;
    }

    const view = this.tabs.get(tabId);
    if (!view) {
      console.warn('WindowManager: Tab not found:', tabId);
      return;
    }

    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      return;
    }

    // 移除当前活跃视图
    if (this.activeTabId && this.activeTabId !== tabId) {
      const oldView = this.tabs.get(this.activeTabId);
      if (oldView) {
        this.mainWindow.removeBrowserView(oldView);
      }
    }

    // 设置新的活跃视图
    this.mainWindow.setBrowserView(view);
    this.activeTabId = tabId;

    // 应用当前 bounds
    if (this.currentBounds) {
      view.setBounds({
        x: Math.floor(this.currentBounds.x),
        y: Math.floor(this.currentBounds.y),
        width: Math.floor(this.currentBounds.width),
        height: Math.floor(this.currentBounds.height)
      });
    }

    this.notifyTabUpdate();
    console.log('WindowManager: Switched to tab:', tabId);

    // 🔥 通知爬虫标签页已切换（让爬虫清空 page 引用）
    this.notifyCrawlerTabSwitch(tabId);
  }

  /**
   * 通过URL或keyword切换标签页（用于爬虫IPC）
   * 这个方法会忽略锁定状态，因为是爬虫主动请求的切换
   */
  switchTabByUrlOrKeyword(urlOrKeyword: string): boolean {
    console.log('WindowManager: Switching to tab by URL or keyword:', urlOrKeyword);
    
    const keyword = urlOrKeyword.toLowerCase();
    
    // 查找匹配的标签页
    for (const [tabId, view] of this.tabs) {
      const url = view.webContents.getURL();
      const title = view.webContents.getTitle();
      
      // 匹配URL或标题
      if (url.toLowerCase().includes(keyword) || 
          title.toLowerCase().includes(keyword) ||
          url === urlOrKeyword) {
        console.log('WindowManager: Found matching tab:', tabId, url);
        
        // 临时解锁以允许切换
        const wasLocked = this.tabSwitchLocked;
        this.tabSwitchLocked = false;
        this.switchTab(tabId);
        this.tabSwitchLocked = wasLocked;
        
        return true;
      }
    }
    
    console.warn('WindowManager: No tab found matching:', urlOrKeyword);
    return false;
  }

  /**
   * 锁定标签页切换（防止外部事件干扰）
   */
  lockTabSwitch(): void {
    console.log('WindowManager: Tab switch locked');
    this.tabSwitchLocked = true;
  }

  /**
   * 解锁标签页切换
   */
  unlockTabSwitch(): void {
    console.log('WindowManager: Tab switch unlocked');
    this.tabSwitchLocked = false;
  }

  /**
   * 启动文件监听器（用于爬虫IPC）
   */
  private startFileWatcher(): void {
    const fs = require('fs');
    const path = require('path');
    const os = require('os');

    const tempDir = os.tmpdir();

    console.log('WindowManager: Starting file watcher for crawler IPC (pattern: hotel-ai-browser-ipc-*.json)');

    // 清理可能存在的旧IPC文件
    try {
      const oldFiles = fs.readdirSync(tempDir)
        .filter((f: string) => f.startsWith('hotel-ai-browser-ipc-') && f.endsWith('.json'));
      for (const f of oldFiles) {
        try {
          fs.unlinkSync(path.join(tempDir, f));
        } catch (_) {}
      }
      if (oldFiles.length > 0) {
        console.log(`WindowManager: Cleaned up ${oldFiles.length} old IPC file(s)`);
      }
    } catch (error) {
      console.error('WindowManager: Failed to clean up old IPC files:', error);
    }

    let isProcessing = false; // 防止并发处理

    // 每100ms检查一次文件
    this.fileWatcher = setInterval(() => {
      // 如果正在处理，跳过本次检查
      if (isProcessing) {
        return;
      }

      try {
        // Scan for all IPC request files (exclude .response.json)
        const files = fs.readdirSync(tempDir)
          .filter((f: string) => f.startsWith('hotel-ai-browser-ipc-') && f.endsWith('.json') && !f.endsWith('.response.json'));

        for (const fileName of files) {
          const requestFile = path.join(tempDir, fileName);

          try {
            const content = fs.readFileSync(requestFile, 'utf8');
            const request = JSON.parse(content);

            // Extract requestId from filename or request body
            const requestId = request.requestId || fileName.replace('hotel-ai-browser-ipc-', '').replace('.json', '');

            // 防止重复处理同一请求
            if (this.processedRequests.has(requestId)) {
              // 删除重复的文件
              try { fs.unlinkSync(requestFile); } catch (_) {}
              continue;
            }

            console.log('WindowManager: Received IPC request:', request);
            isProcessing = true;

            if (request.action === 'switch_tab') {
              // 支持url或keyword参数
              const target = request.url || request.keyword;
              if (target) {
                // 锁定标签页切换，防止外部事件干扰
                this.lockTabSwitch();

                const success = this.switchTabByUrlOrKeyword(target);
                if (success) {
                  console.log('WindowManager: Tab switch successful');
                  this.processedRequests.add(requestId);

                  // 10秒后自动解锁（给爬虫足够的时间连接和操作）
                  setTimeout(() => {
                    this.unlockTabSwitch();
                  }, 10000);
                } else {
                  console.warn('WindowManager: Tab switch failed - no matching tab found');
                  // 切换失败，立即解锁
                  this.unlockTabSwitch();
                }
              }
            } else if (request.action === 'create_bg_tab') {
              const url = request.url || 'about:blank';
              const bgSessionId = request.sessionId || null;
              try {
                const { tabId } = this.createBgTab(url, bgSessionId);
                const entry = this.bgTabs.get(tabId)!;
                const wc = entry.view.webContents as any;

                // 🔥 优化：不等 did-finish-load，BrowserView 创建后立即回复
                // 页面加载等待交给爬虫端的 waitForLoadState 统一处理，避免双重等待
                const writeResponse = () => {
                  const responseFile = path.join(tempDir, `hotel-ai-browser-ipc-${requestId}.response.json`);
                  fs.writeFileSync(responseFile, JSON.stringify({
                    tabId,
                    wcId: wc.id,
                    url: entry.view.webContents.getURL(),
                    timestamp: request.timestamp
                  }));
                  console.log('WindowManager: BgTab response written, tabId:', tabId, 'wcId:', wc.id, 'url:', entry.view.webContents.getURL());
                };

                // 立即回复（给 Chromium 200ms 初始化渲染进程）
                setTimeout(() => writeResponse(), 200);
              } catch (e) {
                console.error('WindowManager: Failed to create bg tab:', e);
              }
              this.processedRequests.add(requestId);
            } else if (request.action === 'destroy_bg_tab') {
              // 销毁后台隐藏标签页
              if (request.tabId) {
                this.destroyBgTab(request.tabId);
              }
              this.processedRequests.add(requestId);
            } else if (request.action === 'destroy_all_bg_tabs') {
              // 销毁所有后台隐藏标签页（爬虫任务结束时调用）
              this.destroyAllBgTabs();
              this.processedRequests.add(requestId);
            } else if (request.action === 'destroy_bg_tabs_by_session') {
              // 按 sessionId 销毁后台隐藏标签页（并发安全）
              if (request.sessionId) {
                this.destroyBgTabsBySession(request.sessionId);
              }
              this.processedRequests.add(requestId);
            } else if (request.action === 'login_required') {
              // 爬虫检测到登录页面 → 只显示横幅通知，不提升 bgTab
              // bgTab 保持在 bgWindow 中，避免触发弹窗
              try {
                if (this.tabPromotionManager) {
                  this.tabPromotionManager.notifyLoginRequired(
                    request.bgTabId, requestId,
                    request.siteInfo || { url: '', domain: '', title: '' }
                  );
                } else {
                  // TabPromotionManager 未初始化，写 skipped 响应
                  const responseFile = path.join(tempDir, `hotel-ai-browser-ipc-${requestId}.response.json`);
                  fs.writeFileSync(responseFile, JSON.stringify({ action: 'login_done', requestId, result: 'skipped', timestamp: Date.now() }));
                }
              } catch (e) {
                console.error('WindowManager: Failed to handle login_required:', e);
                const responseFile = path.join(tempDir, `hotel-ai-browser-ipc-${requestId}.response.json`);
                fs.writeFileSync(responseFile, JSON.stringify({ action: 'login_done', requestId, result: 'skipped', timestamp: Date.now() }));
              }
              this.processedRequests.add(requestId);
            }

            // 删除请求文件表示已处理（ACK）
            try {
              fs.unlinkSync(requestFile);
              console.log('WindowManager: IPC request processed and file deleted:', fileName);
            } catch (e) {
              console.error('WindowManager: Failed to delete request file:', e);
            }

            isProcessing = false;
          } catch (fileError) {
            // 单个文件解析失败，跳过继续处理下一个
            if ((fileError as any).code !== 'ENOENT') {
              console.error('WindowManager: Error processing IPC file:', fileName, fileError);
            }
            isProcessing = false;
          }
        }

        // 防止processedRequests无限增长，超过100条时清理旧的
        if (this.processedRequests.size > 100) {
          const arr = Array.from(this.processedRequests);
          this.processedRequests = new Set(arr.slice(-50));
        }
      } catch (error) {
        isProcessing = false;
        if ((error as any).code !== 'ENOENT') {
          console.error('WindowManager: Error in file watcher:', error);
        }
      }
    }, 100);
  }

  /**
   * 停止文件监听器
   */
  private stopFileWatcher(): void {
    if (this.fileWatcher) {
      clearInterval(this.fileWatcher);
      this.fileWatcher = null;
      console.log('WindowManager: File watcher stopped');
    }
  }

  /**
   * 通知爬虫标签页已切换（让爬虫清空 page 引用）
   */
  private notifyCrawlerTabSwitch(tabId: string): void {
    try {
      const view = this.tabs.get(tabId);
      if (!view) return;

      const url = view.webContents.getURL();
      const tempDir = os.tmpdir();
      const notifyFile = path.join(tempDir, 'hotel-ai-browser-tab-switched.json');

      const notification = {
        action: 'tab_switched',
        tabId,
        url,
        timestamp: Date.now()
      };

      fs.writeFileSync(notifyFile, JSON.stringify(notification, null, 2));
      console.log('WindowManager: Notified crawler of tab switch:', tabId, url);
    } catch (error) {
      console.error('WindowManager: Failed to notify crawler of tab switch:', error);
    }
  }

  /**
   * 获取所有标签页信息
   */
  getTabList(): TabInfo[] {
    const list: TabInfo[] = [];
    for (const [id, view] of this.tabs) {
      list.push({
        id,
        title: view.webContents.getTitle() || (this.currentLanguage === 'en' ? 'New Tab' : '新标签页'),
        url: view.webContents.getURL() || '',
        isLoading: view.webContents.isLoading()
      });
    }
    // 追加后台爬虫标签页（带 isCrawler 标记）
    for (const [id, entry] of this.bgTabs) {
      try {
        list.push({
          id,
          title: entry.view.webContents.getTitle() || (this.currentLanguage === 'en' ? 'Crawler' : '爬虫'),
          url: entry.view.webContents.getURL() || '',
          isLoading: entry.view.webContents.isLoading(),
          isCrawler: true
        });
      } catch {}
    }
    return list;
  }

  /**
   * 获取活跃标签页ID
   */
  getActiveTabId(): string | null {
    return this.activeTabId;
  }

  /**
   * 通知渲染进程标签页更新
   */
  private tabUpdateTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * 通知渲染进程标签页更新（防抖 100ms，避免标题快速变化导致闪烁）
   */
  private notifyTabUpdate(): void {
    if (this.tabUpdateTimer) clearTimeout(this.tabUpdateTimer);
    this.tabUpdateTimer = setTimeout(() => {
      this.tabUpdateTimer = null;
      if (this.onTabUpdate) {
        this.onTabUpdate(this.getTabList(), this.activeTabId);
      }
    }, 100);
  }

  /**
   * 获取活跃标签页的 BrowserView
   */
  private getActiveView(): BrowserView | null {
    if (!this.activeTabId) return null;
    return this.tabs.get(this.activeTabId) || null;
  }

  /**
   * 创建BrowserView用于显示网页（兼容旧调用，创建第一个标签页）
   */
  createWebContentsView(): BrowserView {
    if (!this.mainWindow) {
      throw new Error('Main window must be created before BrowserView');
    }

    console.log('WindowManager: Creating initial tab via createWebContentsView');
    const tabId = this.createTab();
    return this.tabs.get(tabId)!;
  }

  /**
   * 将BrowserView附加到主窗口（兼容旧调用）
   */
  attachWebContentsView(window: BrowserWindow, view: BrowserView): void {
    console.log('WindowManager: Attaching BrowserView to window');

    try {
      window.setBrowserView(view);

      const bounds = window.getContentBounds();
      // top-bar(74px) + bookmark-bar(28px) = 102px
      const controlBarHeight = 102;
      const splitRatio = 0.8;

      const initialBounds = {
        x: 0,
        y: controlBarHeight,
        width: Math.floor(bounds.width * splitRatio),
        height: bounds.height - controlBarHeight
      };

      view.setBounds(initialBounds);
      this.currentBounds = initialBounds;

      console.log('WindowManager: BrowserView attached');
    } catch (error) {
      console.error('WindowManager: Failed to attach BrowserView:', error);
      throw error;
    }
  }

  /**
   * 更新BrowserView的边界（应用到活跃标签页）
   */
  updateWebContentsViewBounds(bounds: Rectangle): void {
    this.currentBounds = {
      x: Math.floor(bounds.x),
      y: Math.floor(bounds.y),
      width: Math.floor(bounds.width),
      height: Math.floor(bounds.height)
    };

    const view = this.getActiveView();
    if (!view) {
      return;
    }

    try {
      view.setBounds(this.currentBounds);
    } catch (error) {
      console.error('WindowManager: Failed to update bounds:', error);
    }

  }

  /**
   * 隐藏所有 BrowserView（登出或弹窗时调用，避免遮挡 HTML 层）
   */
  hideBrowserViews(): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
    // 移除活跃标签页的 BrowserView
    const activeView = this.getActiveView();
    if (activeView) {
      try {
        this.mainWindow.removeBrowserView(activeView);
      } catch (e) {
        // 忽略
      }
    }
    console.log('WindowManager: BrowserViews hidden');
  }

  /**
   * 恢复活跃标签页的 BrowserView（登录成功后调用）
   */
  showBrowserViews(): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
    const activeView = this.getActiveView();
    if (activeView) {
      try {
        this.mainWindow.setBrowserView(activeView);
        if (this.currentBounds) {
          activeView.setBounds(this.currentBounds);
        }
      } catch (e) {
        // 忽略
      }
    }
    console.log('WindowManager: BrowserViews restored');
  }

  /**
   * 向所有前台标签页广播 IPC 事件（用于用户切换时通知 BrowserView 页面刷新数据）
   */
  broadcastToTabs(channel: string, ...args: any[]): void {
    for (const [, view] of this.tabs) {
      try {
        if (!view.webContents.isDestroyed()) {
          view.webContents.send(channel, ...args);
        }
      } catch (e) {
        // 忽略已销毁的 webContents
      }
    }
  }

  /**
   * 加载URL到活跃标签页
   */
  async loadURL(url: string): Promise<void> {
    // Google 登录拦截已由 session 级别的 setupGoogleAuthInterception() 处理

    const view = this.getActiveView();
    if (!view) {
      throw new Error('No active tab');
    }

    console.log('WindowManager: Loading URL:', url);

    try {
      await view.webContents.loadURL(url);
      console.log('WindowManager: URL loaded successfully');
    } catch (error: any) {
      if (error.errno === -3 || error.code === 'ERR_ABORTED') {
        console.log('WindowManager: Navigation aborted (likely redirect), ignoring error');
        return;
      }

      console.error('WindowManager: Failed to load URL:', error);
      throw error;
    }
  }

  /**
   * 导航控制 - 后退
   */
  goBack(): void {
    const view = this.getActiveView();
    if (!view) return;

    if (view.webContents.canGoBack()) {
      view.webContents.goBack();
    }
  }

  /**
   * 导航控制 - 前进
   */
  goForward(): void {
    const view = this.getActiveView();
    if (!view) return;

    if (view.webContents.canGoForward()) {
      view.webContents.goForward();
    }
  }

  /**
   * 导航控制 - 刷新
   */
  reload(): void {
    const view = this.getActiveView();
    if (!view) return;

    view.webContents.reload();
  }

  /**
   * 获取当前URL
   */
  getCurrentURL(): string {
    const view = this.getActiveView();
    if (!view) return '';

    return view.webContents.getURL();
  }

  /**
   * 获取导航状态
   */
  getNavigationState(): {
    canGoBack: boolean;
    canGoForward: boolean;
    isLoading: boolean;
    url: string;
  } {
    const view = this.getActiveView();
    if (!view) {
      return {
        canGoBack: false,
        canGoForward: false,
        isLoading: false,
        url: ''
      };
    }

    const webContents = view.webContents;
    return {
      canGoBack: webContents.canGoBack(),
      canGoForward: webContents.canGoForward(),
      isLoading: webContents.isLoading(),
      url: webContents.getURL()
    };
  }

  /**
   * 显示主窗口
   */
  show(): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.show();
    }
  }

  /**
   * 隐藏主窗口
   */
  hide(): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.hide();
    }
  }

  /**
   * 获取主窗口实例
   */
  getMainWindow(): BrowserWindow | null {
    return this.mainWindow;
  }

  /**
   * 获取BrowserView实例（返回活跃标签页）
   */
  getWebContentsView(): BrowserView | null {
    return this.getActiveView();
  }

  /**
   * 检查是否已初始化
   */
  isReady(): boolean {
    return this.isInitialized && this.mainWindow !== null;
  }

  /**
   * 清理资源
   */
  cleanup(): void {
    console.log('WindowManager: Cleaning up resources');

    // 停止文件监听器
    this.stopFileWatcher();

    // 清理所有标签页
    for (const [id, view] of this.tabs) {
      try {
        (view.webContents as any).destroy?.();
      } catch (error) {
        console.error('WindowManager: Error cleaning up tab:', id, error);
      }
    }
    this.tabs.clear();
    this.activeTabId = null;

    // 清理后台爬虫窗口
    this.destroyAllBgTabs();
    if (this.bgWindow && !this.bgWindow.isDestroyed()) {
      try { this.bgWindow.close(); } catch {}
      this.bgWindow = null;
    }

    // 清理调价专用窗口
    if (this.priceAdjustWindow && !this.priceAdjustWindow.isDestroyed()) {
      try { this.priceAdjustWindow.destroy(); } catch {}
      this.priceAdjustWindow = null;
    }

    this.mainWindow = null;
    this.isInitialized = false;

    console.log('WindowManager: Cleanup completed');
  }

  /**
   * 销毁窗口管理器
   */
  destroy(): void {
    console.log('WindowManager: Destroying');

    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.close();
    }

    this.cleanup();
  }

  // ==================== 标签页提升/降级 API ====================

  /** 获取 bg tab 的 sessionId（在提升前调用） */
  getBgTabSessionId(bgTabId: string): string | null {
    return this.bgTabs.get(bgTabId)?.sessionId ?? null;
  }

  /** 将 bg tab 提升为可见前端标签页（同一 BrowserView 实例），不切换 activeTabId */
  promoteBgTabToFront(bgTabId: string): string {
    const entry = this.bgTabs.get(bgTabId);
    if (!entry) throw new Error(`BgTab not found: ${bgTabId}`);

    const { view } = entry;
    this.bgTabs.delete(bgTabId);

    // 从 bgWindow 移到 mainWindow
    if (this.bgWindow && !this.bgWindow.isDestroyed()) {
      try { this.bgWindow.removeBrowserView(view); } catch {}
    }
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.addBrowserView(view);
      // 提升时不显示：设置零尺寸，避免遮挡当前活跃标签页。
      // 用户点击"前往登录"后 switchTab 会设置正确的 bounds。
      view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    }

    // 停止 frame subscription（不再需要强制渲染）
    try { view.webContents.endFrameSubscription(); } catch {}

    const promotedTabId = `tab-login-${++this.tabCounter}`;
    this.tabs.set(promotedTabId, view);

    // 拦截 window.open：提升后的标签页使用普通标签页的逻辑（在新标签页中打开）
    // 如果不设置，BrowserView 中的 window.open 会创建独立的 Electron 窗口（弹窗）
    view.webContents.setWindowOpenHandler((details) => {
      console.log('WindowManager: [promoted] Intercepting window.open:', details.url);
      this.createTab(details.url, true);
      return { action: 'deny' };
    });

    // 绑定标签页事件
    view.webContents.on('page-title-updated', () => this.notifyTabUpdate());
    view.webContents.on('did-finish-load', () => this.notifyTabUpdate());
    view.webContents.on('did-start-loading', () => this.notifyTabUpdate());
    view.webContents.on('did-stop-loading', () => this.notifyTabUpdate());

    this.notifyTabUpdate();
    this.maybeCloseBgWindow();
    console.log(`WindowManager: Promoted bg tab ${bgTabId} → ${promotedTabId}`);
    return promotedTabId;
  }

  /** 将前端标签页降级回 bg tab（同一 BrowserView 实例） */
  demoteTabToBg(promotedTabId: string, originalBgTabId: string, sessionId: string | null): string {
    const view = this.tabs.get(promotedTabId);
    if (!view) throw new Error(`Tab not found: ${promotedTabId}`);

    // 如果是当前活跃标签页，先切换到其他标签页
    if (this.activeTabId === promotedTabId) {
      const otherTabIds = Array.from(this.tabs.keys()).filter(id => id !== promotedTabId);
      if (otherTabIds.length > 0) this.switchTab(otherTabIds[0]);
    }

    this.tabs.delete(promotedTabId);

    // 从 mainWindow 移到 bgWindow
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      try { this.mainWindow.removeBrowserView(view); } catch {}
    }
    const bgWin = this.getOrCreateBgWindow();
    bgWin.addBrowserView(view);
    const bounds = bgWin.getContentBounds();
    view.setBounds({ x: 0, y: 0, width: bounds.width, height: bounds.height });

    // 增加 capturer count，保持完整渲染优先级
    view.webContents.setBackgroundThrottling(false);
    try {
      view.webContents.beginFrameSubscription(true, () => {});
    } catch {}

    this.bgTabs.set(originalBgTabId, { view, sessionId });
    this.notifyTabUpdate();
    console.log(`WindowManager: Demoted ${promotedTabId} → ${originalBgTabId}`);
    return originalBgTabId;
  }
}

/**
 * 创建默认窗口配置
 */
export function createDefaultWindowConfig(preloadPath: string): WindowConfig {
  return {
    width: DEFAULT_WINDOW_WIDTH,
    height: DEFAULT_WINDOW_HEIGHT,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      preload: preloadPath
    }
  };
}
