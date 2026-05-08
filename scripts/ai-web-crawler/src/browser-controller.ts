/**
 * Browser Controller
 * Manages browser connection, tab operations, and basic page actions
 */

import { chromium, Browser, Page, CDPSession } from 'playwright-core';
import { TabInfo, ScreenshotOptions } from './types';
import { ScreenshotManager } from './screenshot-manager';
// 注意：反检测系统暂时注释，等待正确配置后启用
// import { AntiDetectionManager } from '../../../src/main/anti-detection';
import { HumanMouse } from './human-mouse';

export class BrowserController {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private cdpSession: CDPSession | null = null;
  private port: number;
  private timeout: number;
  private screenshotManager: ScreenshotManager | null = null;
  private humanMouse: HumanMouse = new HumanMouse();
  /** tabId returned by Electron when creating a hidden bg tab */
  private bgTabId: string | null = null;
  /** When true, suppress all Electron tab-switch notifications and bringToFront calls */
  private backgroundMode: boolean = true;
  /** Session ID for concurrent crawling isolation — used in IPC file names and bg tab tracking */
  private sessionId: string | null = null;

  // Connection pool - shared across instances
  private static connectionPool: Map<number, Browser> = new Map();
  private static connectionRefCount: Map<number, number> = new Map();

  constructor(port: number = 9222, timeout: number = 30000) { // 减少默认超时到30秒
    this.port = port;
    this.timeout = timeout;
    
    // 初始化反检测管理器 - 暂时注释
    // this.antiDetection = new AntiDetectionManager({
    //   environment: {
    //     countryCode: 'CN',
    //     locale: 'zh-CN',
    //   },
    // });
  }

  /**
   * Set screenshot manager
   */
  setScreenshotManager(manager: ScreenshotManager): void {
    this.screenshotManager = manager;
  }

  /**
   * Set session ID for concurrent crawling isolation.
   * When set, all IPC notification files will include the sessionId in their filename.
   */
  setSessionId(sessionId: string): void {
    this.sessionId = sessionId;
  }

  /**
   * Get current session ID
   */
  getSessionId(): string | null {
    return this.sessionId;
  }

  /** Get the bg tab ID (set by connectBackground) */
  getBgTabId(): string | null {
    return this.bgTabId;
  }

  /**
   * Get the notification file path for new tab events.
   * When sessionId is set, uses session-scoped filename to avoid conflicts.
   */
  private getNewTabNotifyPath(): string {
    const path = require('path');
    const os = require('os');
    const tempDir = os.tmpdir();
    if (this.sessionId) {
      return path.join(tempDir, `hotel-ai-browser-new-tab-${this.sessionId}.json`);
    }
    return path.join(tempDir, 'hotel-ai-browser-new-tab.json');
  }

  /**
   * Get the notification file path for tab switch events.
   * When sessionId is set, uses session-scoped filename to avoid conflicts.
   */
  private getTabSwitchedNotifyPath(): string {
    const path = require('path');
    const os = require('os');
    const tempDir = os.tmpdir();
    if (this.sessionId) {
      return path.join(tempDir, `hotel-ai-browser-tab-switched-${this.sessionId}.json`);
    }
    return path.join(tempDir, 'hotel-ai-browser-tab-switched.json');
  }

  /**
   * Apply anti-detection protections to a page
   * @param page - Playwright page instance
   */
  private async applyAntiDetectionProtections(page: Page): Promise<void> {
    // 暂时注释，等待正确配置后启用
    // try {
    //   await this.antiDetection.applyProtections(page);
    // } catch (error) {
    //   console.error('[BrowserController] Failed to apply anti-detection protections:', error);
    //   // Continue execution even if protections fail
    // }
  }

  /**
   * Click element with human-like mouse movement
   * @param selector - CSS selector
   */
  async clickElementHumanLike(selector: string): Promise<void> {
    const page = this.getPage();
    if (!page) {
      throw new Error('No active page');
    }

    try {
      const element = await page.$(selector);
      if (!element) {
        throw new Error(`Element not found: ${selector}`);
      }

      const box = await element.boundingBox();
      if (!box) {
        throw new Error(`Element has no bounding box: ${selector}`);
      }

      await this.humanMouse.click(page, box);
    } catch (error) {
      console.error('[BrowserController] Failed to click element:', error);
      throw error;
    }
  }

  /**
   * Connect to browser via CDP
   * Uses connection pooling to reuse existing connections
   * Implements retry logic for better reliability
   */
  async connect(port?: number, maxRetries: number = 3): Promise<void> {
    if (port) {
      this.port = port;
    }

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`[BrowserController] Connection attempt ${attempt}/${maxRetries} to port ${this.port}`);
        
        // Check if we already have a connection in the pool
        const pooledBrowser = BrowserController.connectionPool.get(this.port);
        
        if (pooledBrowser && pooledBrowser.isConnected()) {
          console.log(`[BrowserController] ✅ Reusing existing connection to port ${this.port}`);
          this.browser = pooledBrowser;
          
          // Increment reference count
          const refCount = BrowserController.connectionRefCount.get(this.port) || 0;
          BrowserController.connectionRefCount.set(this.port, refCount + 1);
          console.log(`[BrowserController] Reference count: ${refCount + 1}`);
        } else {
          // Remove stale connection from pool if exists
          if (pooledBrowser) {
            console.log(`[BrowserController] Removing stale connection from pool`);
            BrowserController.connectionPool.delete(this.port);
            BrowserController.connectionRefCount.delete(this.port);
          }
          
          // Create new connection with timeout
          console.log(`[BrowserController] 🔌 Creating new connection to port ${this.port}...`);
          
          // 并发场景下多个爬虫子进程同时连接 CDP，需要足够的超时时间
          const connectTimeout = 15000;
          const connectPromise = chromium.connectOverCDP(`http://localhost:${this.port}`, {
            timeout: connectTimeout
          });
          
          this.browser = await connectPromise;
          console.log(`[BrowserController] ✅ Connection established successfully`);
          
          // Store in pool
          BrowserController.connectionPool.set(this.port, this.browser);
          BrowserController.connectionRefCount.set(this.port, 1);
          console.log(`[BrowserController] Connection stored in pool`);
        }

        // 🔥 关键优化：延迟加载 page，避免连接时遍历所有 contexts 导致超时
        // page 将在第一次调用 getPage() 时才获取，并自动过滤不稳定的标签页
        this.page = null;

        console.log(`[BrowserController] ✅ Connected to browser successfully (lazy page loading)`);
        return; // Success, exit retry loop
        
      } catch (error) {
        lastError = error as Error;
        console.error(`[BrowserController] ❌ Connection attempt ${attempt}/${maxRetries} failed:`, error);
        
        // Clean up failed connection from pool
        BrowserController.connectionPool.delete(this.port);
        BrowserController.connectionRefCount.delete(this.port);
        
        // If not the last attempt, wait before retrying
        if (attempt < maxRetries) {
          const waitTime = attempt * 1000 + Math.floor(Math.random() * 1000); // 1-2s, 2-3s, 3-4s + 随机抖动
          console.log(`[BrowserController] Waiting ${waitTime}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }
    }

    // All retries failed
    const errorMessage = `Failed to connect to browser on port ${this.port} after ${maxRetries} attempts: ${lastError?.message}`;
    console.error(`[BrowserController] ❌ ${errorMessage}`);
    throw new Error(errorMessage);
  }

  /**
   * List all open tabs (filter out unstable tabs)
   * 🔥 关键优化：过滤掉不稳定的标签页（空白页、崩溃页等）
   */
  async listTabs(): Promise<TabInfo[]> {
    if (!this.browser) {
      throw new Error('Browser not connected');
    }

    const tabs: TabInfo[] = [];
    
    try {
      const contexts = this.browser.contexts();
      console.log(`[BrowserController] Listing tabs from ${contexts.length} contexts`);

      for (const context of contexts) {
        try {
          const pages = context.pages();
          
          for (const page of pages) {
            try {
              const url = page.url();
              
              // 🔥 关键过滤：跳过不稳定的页面
              // 1. 跳过空白页（新建标签页）
              if (url === 'about:blank' || url === '') {
                console.log(`[BrowserController] Skipping blank tab in list`);
                continue;
              }
              
              // 2. 跳过 Electron 内部页面
              if (url.startsWith('file://') || url.startsWith('devtools://')) {
                console.log(`[BrowserController] Skipping internal tab in list`);
                continue;
              }
              
              // 3. 跳过崩溃页面
              if (url.startsWith('chrome://') || url.startsWith('chrome-error://')) {
                console.log(`[BrowserController] Skipping crash tab in list`);
                continue;
              }
              
              // 4. 尝试获取 title，如果失败说明页面不稳定
              let title = '未命名';
              try {
                title = await page.title();
              } catch (error) {
                console.log(`[BrowserController] Cannot get title for ${url}, skipping`);
                continue;
              }
              
              // 页面稳定，添加到列表
              tabs.push({
                id: url,
                title,
                url,
                active: page === this.page,
              });
              
            } catch (error) {
              console.error(`[BrowserController] Error processing page:`, error);
              continue;
            }
          }
        } catch (error) {
          console.error(`[BrowserController] Error processing context:`, error);
          continue;
        }
      }

      console.log(`[BrowserController] Found ${tabs.length} stable tabs`);
      return tabs;
      
    } catch (error) {
      console.error(`[BrowserController] Error listing tabs:`, error);
      return [];
    }
  }

  /**
   * Switch to tab by keyword (matches title or URL)
   * 🔥 关键优化：确保切换到的标签页是稳定的
   */
  async switchTab(keyword: string, skipElectronNotify: boolean = false): Promise<boolean> {
    if (!this.browser) {
      throw new Error('Browser not connected');
    }

    console.log(`[BrowserController] Switching to tab with keyword: ${keyword}`);
    const keywordLower = keyword.toLowerCase();
    
    try {
      const contexts = this.browser.contexts();

      let targetPage: Page | null = null;

      // Find the target page
      for (const context of contexts) {
        try {
          const pages = context.pages();
          
          for (const page of pages) {
            try {
              const url = page.url();
              
              // 🔥 关键过滤：跳过不稳定的页面
              if (url === 'about:blank' || url === '' || 
                  url.startsWith('file://') || url.startsWith('devtools://') ||
                  url.startsWith('chrome://') || url.startsWith('chrome-error://')) {
                continue;
              }
              
              // 尝试获取 title，如果失败说明页面不稳定
              let title = '';
              try {
                title = await page.title();
              } catch (error) {
                console.log(`[BrowserController] Cannot get title for ${url}, skipping`);
                continue;
              }

              // 匹配关键词
              if (title.toLowerCase().includes(keywordLower) || 
                  url.toLowerCase().includes(keywordLower)) {
                targetPage = page;
                console.log(`[BrowserController] Found target page: ${title} (${url})`);
                break;
              }
            } catch (error) {
              console.error(`[BrowserController] Error checking page:`, error);
              continue;
            }
          }
          if (targetPage) break;
        } catch (error) {
          console.error(`[BrowserController] Error processing context:`, error);
          continue;
        }
      }

      if (!targetPage) {
        console.log(`[BrowserController] CDP 找不到目标标签页: ${keyword}`);

        // In background mode, never fall back to Electron IPC
        if (this.backgroundMode) {
          console.log(`[BrowserController] Background mode: skipping Electron IPC fallback`);
          return false;
        }

        // 🔥 CDP 找不到时，通过 Electron IPC 请求切换
        if (!skipElectronNotify) {
          console.log(`[BrowserController] 通过 Electron IPC 请求切换标签页...`);
          const fs = require('fs');
          const path = require('path');
          const os = require('os');
          const tempDir = os.tmpdir();
          const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          const requestFile = path.join(tempDir, `hotel-ai-browser-ipc-${requestId}.json`);

          const request = {
            action: 'switch_tab',
            requestId,
            keyword: keyword,
            timestamp: Date.now()
          };

          fs.writeFileSync(requestFile, JSON.stringify(request, null, 2));
          console.log(`[BrowserController] IPC 请求已写入: ${requestFile}`);

          // 等待 Electron 处理（最多2秒）
          const maxWait = 2000;
          const startTime = Date.now();

          while (fs.existsSync(requestFile) && (Date.now() - startTime) < maxWait) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }

          if (fs.existsSync(requestFile)) {
            console.warn(`[BrowserController] Electron 未及时处理切换请求`);
            try { fs.unlinkSync(requestFile); } catch {}
            return false;
          }

          console.log(`[BrowserController] ✅ Electron 已处理切换请求，等待 CDP 同步...`);
          await new Promise(resolve => setTimeout(resolve, 1000));

          // 重新尝试在 CDP 中找到目标页面
          for (const context of contexts) {
            for (const page of context.pages()) {
              try {
                const url = page.url();
                const title = await page.title();
                if (title.toLowerCase().includes(keywordLower) || url.toLowerCase().includes(keywordLower)) {
                  targetPage = page;
                  console.log(`[BrowserController] CDP 同步后找到目标页面: ${title}`);
                  break;
                }
              } catch {}
            }
            if (targetPage) break;
          }

          if (!targetPage) {
            console.warn(`[BrowserController] CDP 仍然找不到目标页面，但 Electron 已切换`);
            // 将 page 设为 null，后续 getPage() 会重新获取当前活动页面
            this.page = null;
            console.log(`[BrowserController] ✅ 标签页切换完成（通过 Electron IPC）`);
            return true; // 返回 true 因为 Electron 已经切换了
          }
        } else {
          return false;
        }
      }

      // 如果 targetPage 为 null，说明上面的逻辑有问题
      if (!targetPage) {
        console.error(`[BrowserController] 内部错误：targetPage 为 null`);
        return false;
      }

      const targetUrl = targetPage.url();

      // 只在需要时通知Electron切换BrowserView
      if (!skipElectronNotify && !this.backgroundMode && targetPage) {
        console.log(`[BrowserController] Notifying Electron to switch to: ${targetUrl}`);
        await this.notifyElectronTabSwitch(targetUrl);

        // 等待Electron完成切换（优化到50ms）
        console.log(`[BrowserController] Waiting for Electron to complete tab switch...`);
        await new Promise(resolve => setTimeout(resolve, 50));
      } else {
        console.log(`[BrowserController] Skipping Electron notification (already notified or no target)`);
      }

      // Update the page reference
      this.page = targetPage;
      
      // Try to bring to front (may not work in Electron, but doesn't hurt)
      // Skip in background mode to avoid disturbing the main window
      if (!this.backgroundMode) {
        try {
          await targetPage.bringToFront();
        } catch (error) {
          console.log(`[BrowserController] bringToFront failed (expected in Electron):`, error);
        }
      }

      // Verify we're on the right page
      const currentUrl = await this.page.url();
      const currentTitle = await this.page.title();
      console.log(`[BrowserController] ✅ Switched to: ${currentTitle} (${currentUrl})`);

      return true;
      
    } catch (error) {
      console.error(`[BrowserController] Error switching tab:`, error);
      return false;
    }
  }

  /**
   * 检测点击后是否打开了新标签页，如果是则自动切换过去。
   * 调用前记录当前 page URLs 快照，点击后对比。
   * @returns 是否发生了标签页切换
   */
  getPageUrls(): Set<string> {
    const urls = new Set<string>();
    if (!this.browser) return urls;
    for (const ctx of this.browser.contexts()) {
      for (const p of ctx.pages()) {
        try {
          urls.add(p.url());
        } catch { /* ignore */ }
      }
    }
    return urls;
  }

  /**
   * 检测并切换到新标签页
   *
   * 🔥 CDP 重连策略（2026-03-17）：
   * CDP 协议存在异步同步延迟，导致新标签页的 Page 对象可能延迟出现。
   * 解决方案：收到 Electron 通知后，断开并重新连接 CDP，强制刷新页面列表。
   *
   * @param urlsBefore 点击前的 URL 快照（用于识别新标签页）
   * @param timeoutMs 超时时间
   * @returns 是否成功切换到新标签页
   */

  /**
   * 检查 Electron 是否通知了标签页切换（主动切换，非点击链接）
   * 如果检测到切换通知，清空 this.page 引用，强制重新获取
   * In background mode, ignore all Electron tab switch notifications.
   */
  private checkElectronTabSwitch(): void {
    // Background mode: never react to Electron tab switch events
    if (this.backgroundMode) return;

    try {
      const fs = require('fs');
      const notifyFile = this.getTabSwitchedNotifyPath();

      if (fs.existsSync(notifyFile)) {
        const notification = JSON.parse(fs.readFileSync(notifyFile, 'utf-8'));
        console.log(`[BrowserController] 📢 收到 Electron 标签页切换通知: ${notification.url}`);
        fs.unlinkSync(notifyFile); // 立即删除，避免重复处理

        // 清空 page 引用，强制下次 getPage() 重新获取
        console.log(`[BrowserController] 清空 page 引用，将在下次调用时重新获取当前活动页面`);
        this.page = null;
      }
    } catch (error) {
      // 静默失败，不影响正常流程
    }
  }

  async switchToNewTab(urlsBefore: Set<string>, timeoutMs = 5000): Promise<boolean> {
    if (!this.browser) return false;

    const startTime = Date.now();
    const deadline = startTime + timeoutMs;
    let checkCount = 0;

    console.error(`[BrowserController] 开始检测新标签页（已有${urlsBefore.size}个标签页）`);

    // 🔥 新策略：优先检查 Electron 的新标签页通知文件
    const fs = require('fs');
    const path = require('path');
    const os = require('os');
    const tempDir = os.tmpdir();
    const notifyFile = this.getNewTabNotifyPath();

    // ── Background mode: use context.on('page') event (fast path, no CDP reconnect) ──
    if (this.backgroundMode) {
      // Set up page event listener — Playwright fires this when a new CDP target appears
      let resolveNewPage: (page: Page) => void;
      const newPagePromise = new Promise<Page>((resolve) => { resolveNewPage = resolve; });
      const pageHandlers: Array<{ ctx: any; handler: (page: Page) => void }> = [];

      for (const ctx of this.browser.contexts()) {
        const handler = (page: Page) => {
          console.error(`[BrowserController] [bg] 🎯 switchToNewTab: context.on('page') fired: ${page.url()}`);
          resolveNewPage(page);
        };
        ctx.on('page', handler);
        pageHandlers.push({ ctx, handler });
      }

      // Wait for either: page event fires, notification file appears, or timeout
      const bgPage = await Promise.race([
        newPagePromise,
        // Also poll for notification file as a secondary signal
        (async () => {
          while (Date.now() < deadline) {
            if (fs.existsSync(notifyFile)) {
              try { fs.unlinkSync(notifyFile); } catch {}
              // Notification received but page event hasn't fired yet — wait a bit more
              await new Promise(r => setTimeout(r, 200));
            }
            await new Promise(r => setTimeout(r, 50));
          }
          return null as Page | null;
        })(),
      ]);

      // Clean up listeners
      for (const { ctx, handler } of pageHandlers) {
        ctx.off('page', handler);
      }

      if (bgPage) {
        // 🔥 关键修复：切换到新标签页前，通知 Electron 销毁旧标签页
        // 避免导航过程中 BrowserView 不断累积占用内存
        const oldBgTabId = this.bgTabId;
        if (oldBgTabId) {
          try {
            const destroyFile = path.join(tempDir, `hotel-ai-browser-ipc-destroy-old-${Date.now()}.json`);
            fs.writeFileSync(destroyFile, JSON.stringify({
              action: 'destroy_bg_tab',
              tabId: oldBgTabId,
              requestId: `switch-cleanup-${Date.now()}`,
              timestamp: Date.now()
            }));
            console.error(`[BrowserController] [bg] 🗑️ Requested destroy of old bg tab: ${oldBgTabId}`);
          } catch {}
        }

        // 从通知文件读取新 tabId 并更新
        try {
          const sessionNotifyFile = this.sessionId
            ? path.join(tempDir, `hotel-ai-browser-new-tab-${this.sessionId}.json`)
            : path.join(tempDir, 'hotel-ai-browser-new-tab.json');
          if (fs.existsSync(sessionNotifyFile)) {
            const notification = JSON.parse(fs.readFileSync(sessionNotifyFile, 'utf-8'));
            if (notification.tabId) {
              this.bgTabId = notification.tabId;
              console.error(`[BrowserController] [bg] Updated bgTabId: ${oldBgTabId} → ${notification.tabId}`);
            }
            fs.unlinkSync(sessionNotifyFile);
          }
        } catch {}

        this.page = bgPage;
        // Wait for the new page to load
        try {
          await bgPage.waitForLoadState('domcontentloaded', { timeout: 5000 });
        } catch {}
        console.error(`[BrowserController] [bg] ✅ switchToNewTab via page event: ${bgPage.url().substring(0, 80)} (${Date.now() - startTime}ms)`);
        // Clean up notification file if still present
        try { if (fs.existsSync(notifyFile)) fs.unlinkSync(notifyFile); } catch {}
        return true;
      }

      // Fallback: check all pages for new URLs
      // 注意：fallback 路径不销毁旧 bgTab，因为找到的 page 可能就是旧 bgTab
      // 上的同一个页面（只是 URL 变了）。销毁它会导致 page 引用失效。
      // bgTab 清理交给 session 结束时的统一清理。
      for (const ctx of this.browser.contexts()) {
        for (const p of ctx.pages()) {
          try {
            const url = p.url();
            if (url && url !== 'about:blank' && !urlsBefore.has(url) &&
                !url.startsWith('chrome://') && !url.startsWith('file://') && !url.startsWith('devtools://')) {
              this.page = p;
              console.error(`[BrowserController] [bg] ✅ switchToNewTab via fallback scan: ${url.substring(0, 80)}`);
              return true;
            }
          } catch {}
        }
      }

      console.error(`[BrowserController] [bg] ❌ switchToNewTab timed out (${Date.now() - startTime}ms)`);
      try { if (fs.existsSync(notifyFile)) fs.unlinkSync(notifyFile); } catch {}
      return false;
    }

    // ── Visible mode: original logic with CDP reconnect ──

    // 轮询等待新标签页出现
    while (Date.now() < deadline) {
      checkCount++;

      // 🔥 优先检查 Electron 通知文件
      try {
        if (fs.existsSync(notifyFile)) {
          const notification = JSON.parse(fs.readFileSync(notifyFile, 'utf-8'));
          console.error(`[BrowserController] 📢 收到 Electron 新标签页通知: ${notification.url}`);
          fs.unlinkSync(notifyFile); // 立即删除，避免重复处理

          // 🔥 关键修复（2026-03-17）：CDP 重连策略
          // 问题：CDP 异步同步延迟导致新标签页的 Page 对象延迟出现
          // 解决：断开并重新连接 CDP，强制 Playwright 重新枚举所有页面
          console.error(`[BrowserController] 🔄 新标签页已创建，重新连接 CDP 以刷新页面列表...`);

          const currentPort = this.port;

          // 先等待一小段时间，让 Electron 完成标签页切换和页面初始化
          await new Promise(resolve => setTimeout(resolve, 800));

          // 🔥 清空连接池，强制重新连接
          console.error(`[BrowserController] 清空连接池，准备重连到端口 ${currentPort}...`);
          BrowserController.connectionPool.delete(currentPort);
          BrowserController.connectionRefCount.delete(currentPort);

          // 重新连接 CDP
          try {
            await this.connect(currentPort, 1);
            console.error(`[BrowserController] ✅ CDP 重连成功`);
          } catch (err) {
            console.error(`[BrowserController] ❌ CDP 重连失败:`, err);
            // 重连失败，fallback 到 page = null
            this.page = null;
            return true;
          }

          // 等待 CDP 完成页面枚举
          await new Promise(resolve => setTimeout(resolve, 500));

          // 🔥 调试：列出重连后 CDP 可见的所有页面
          console.error(`[BrowserController] [调试] 重连后 CDP 可见的页面:`);
          for (const ctx of this.browser!.contexts()) {
            for (const p of ctx.pages()) {
              try {
                const url = p.url();
                console.error(`[BrowserController] [调试]   - ${url.substring(0, 80)}`);
              } catch (err) {
                console.error(`[BrowserController] [调试]   - (无法获取URL)`);
              }
            }
          }

          // 查找新标签页（不在 urlsBefore 中的页面）
          let foundNewTab = false;
          for (const ctx of this.browser!.contexts()) {
            for (const p of ctx.pages()) {
              try {
                const url = p.url();
                // 检查是否是新标签页
                if (
                  url && url !== 'about:blank' && url !== '' &&
                  !url.startsWith('chrome://') && !url.startsWith('chrome-error://') &&
                  !url.startsWith('devtools://') && !url.startsWith('file://') &&
                  !urlsBefore.has(url)
                ) {
                  console.error(`[BrowserController] 🎯 找到新标签页: ${url.substring(0, 80)}`);
                  this.page = p;
                  if (!this.backgroundMode) {
                    try { await p.bringToFront(); } catch { /* ok */ }
                  }
                  foundNewTab = true;
                  break;
                }
              } catch { /* ignore */ }
            }
            if (foundNewTab) break;
          }

          if (!foundNewTab) {
            // 如果还是找不到，将 page 设为 null，让 getPage() 自动获取
            console.error(`[BrowserController] ⚠️ 重连后仍未找到新标签页，将 page 设为 null`);
            this.page = null;
          }

          console.error(`[BrowserController] ✅ 标签页切换完成`);
          return true;
        }
      } catch (err) {
        console.error(`[BrowserController] 检查通知文件时出错:`, err);
      }

      // 🔥 兜底方案：检查是否有新 URL（不在 urlsBefore 中）
      for (const ctx of this.browser.contexts()) {
        for (const p of ctx.pages()) {
          try {
            const url = p.url();
            if (
              url && url !== 'about:blank' && url !== '' &&
              !url.startsWith('chrome://') && !url.startsWith('chrome-error://') &&
              !url.startsWith('devtools://') && !url.startsWith('file://') &&
              !urlsBefore.has(url)
            ) {
              const elapsed = Date.now() - startTime;
              console.error(`[BrowserController] ✅ 通过轮询检测到新标签页（耗时${elapsed}ms，检测${checkCount}次）: ${url.substring(0, 80)}`);
              this.page = p;
              if (!this.backgroundMode) {
                try { await p.bringToFront(); } catch { /* ok */ }
                await this.notifyElectronTabSwitch(url);
              }
              return true;
            }
          } catch { /* page may be closing */ }
        }
      }

      // 使用更快的轮询间隔（50ms）
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    const elapsed = Date.now() - startTime;
    console.error(`[BrowserController] ❌ 未检测到新标签页（耗时${elapsed}ms，检测${checkCount}次）`);
    // 清理可能残留的通知文件
    try { if (fs.existsSync(notifyFile)) fs.unlinkSync(notifyFile); } catch { /* ignore */ }
    return false;
  }

  /**
   * 通知Electron切换标签页（通过文件系统IPC）
   * In background mode, this is a no-op.
   */
  private async notifyElectronTabSwitch(targetUrl: string): Promise<void> {
    // Never notify Electron in background mode
    if (this.backgroundMode) {
      console.log(`[BrowserController] [bg] Skipping Electron tab switch notification`);
      return;
    }

    const fs = require('fs');
    const path = require('path');
    const os = require('os');
    
    try {
      // 写入切换请求到临时文件（每次生成唯一requestId避免并发冲突）
      const tempDir = os.tmpdir();
      const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const requestFile = path.join(tempDir, `hotel-ai-browser-ipc-${requestId}.json`);

      const request = {
        action: 'switch_tab',
        requestId,
        url: targetUrl,
        timestamp: Date.now()
      };
      
      console.log(`[BrowserController] Writing tab switch request to: ${requestFile}`);
      fs.writeFileSync(requestFile, JSON.stringify(request, null, 2));
      
      // 等待Electron处理（删除文件表示已处理）- 优化到300ms超时
      const maxWait = 300;
      const startTime = Date.now();
      
      while (fs.existsSync(requestFile) && (Date.now() - startTime) < maxWait) {
        await new Promise(resolve => setTimeout(resolve, 10)); // 优化轮询间隔到10ms
      }
      
      if (fs.existsSync(requestFile)) {
        console.warn(`[BrowserController] Electron did not process tab switch request within ${maxWait}ms`);
        // 清理文件
        try {
          fs.unlinkSync(requestFile);
        } catch (e) {
          // Ignore
        }
      } else {
        const elapsed = Date.now() - startTime;
        console.log(`[BrowserController] Electron processed tab switch request in ${elapsed}ms`);
      }
    } catch (error) {
      console.error(`[BrowserController] Failed to notify Electron:`, error);
      // 不抛出错误，继续执行
    }
  }

  /**
   * Capture screenshot
   * @param options - screenshot options
   * @param fullPage - true for full page (default), false for viewport only
   */
  async screenshot(options?: ScreenshotOptions, fullPage: boolean = true): Promise<Buffer> {
    if (!this.page) {
      throw new Error('No active page');
    }

    if (this.screenshotManager) {
      return await this.screenshotManager.capture(this.page, { ...options, fullPage });
    }

    // Fallback to direct capture with timeout
    // 🔥 关键修复：禁用字体等待，避免超时
    const screenshot = await this.page.screenshot({
      type: options?.format || 'jpeg',
      quality: options?.quality || 80,
      fullPage,
      timeout: 10000, // 减少超时到10秒
      animations: 'disabled', // 禁用动画，加快截图
    });
    
    return Buffer.from(screenshot);
  }

  /**
   * Scroll page
   */
  async scroll(direction: 'up' | 'down' | 'bottom'): Promise<void> {
    if (!this.page) {
      throw new Error('No active page');
    }

    switch (direction) {
      case 'up':
        await this.page.evaluate(() => window.scrollBy(0, -window.innerHeight));
        break;
      case 'down':
        await this.page.evaluate(() => window.scrollBy(0, window.innerHeight));
        break;
      case 'bottom':
        await this.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        break;
    }

    // Wait for scroll to complete
    await this.page.waitForTimeout(500);
  }

  /**
   * 用 mouse.wheel 模拟真实鼠标滚轮事件滚动指定像素量。
   * 与 window.scrollBy 不同，wheel 事件可以触发内部 overflow 容器的滚动。
   * 自动找到面积最大的可滚动容器中心作为鼠标落点（与提取阶段逻辑一致）。
   *
   * @param deltaY  正数向下滚，负数向上滚（像素）
   */
  async wheelScrollByDelta(deltaY: number): Promise<void> {
    if (!this.page) return;

    // 找面积最大的可滚动容器中心（与 findMainScrollableCenter 逻辑一致）
    const viewport = this.page.viewportSize();
    const vw = viewport?.width ?? 1280;
    const vh = viewport?.height ?? 800;

    const center = await this.page.evaluate(({ vw, vh }: { vw: number; vh: number }) => {
      const candidates = Array.from(document.querySelectorAll('*')).filter(el => {
        if (el === document.documentElement || el === document.body) return false;
        const style = getComputedStyle(el);
        const oy = style.overflowY;
        if (oy !== 'auto' && oy !== 'scroll') return false;
        const rect = el.getBoundingClientRect();
        if (rect.right <= 0 || rect.bottom <= 0 || rect.left >= vw || rect.top >= vh) return false;
        const visibleW = Math.min(rect.right, vw) - Math.max(rect.left, 0);
        const visibleH = Math.min(rect.bottom, vh) - Math.max(rect.top, 0);
        return visibleW * visibleH > vw * vh * 0.1;
      });
      if (candidates.length === 0) return null;
      const best = candidates.reduce((a, b) => {
        const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
        const areaA = (Math.min(ra.right, vw) - Math.max(ra.left, 0)) * (Math.min(ra.bottom, vh) - Math.max(ra.top, 0));
        const areaB = (Math.min(rb.right, vw) - Math.max(rb.left, 0)) * (Math.min(rb.bottom, vh) - Math.max(rb.top, 0));
        return areaA >= areaB ? a : b;
      });
      const r = best.getBoundingClientRect();
      return {
        x: (Math.max(r.left, 0) + Math.min(r.right, vw)) / 2,
        y: (Math.max(r.top, 0) + Math.min(r.bottom, vh)) / 2,
      };
    }, { vw, vh });

    const cx = center?.x ?? vw / 2;
    const cy = center?.y ?? vh / 2;

    // 移动鼠标到容器中心
    await this.page.mouse.move(cx, cy, { steps: 3 });

    // 拆成多个小 tick，模拟真实滚轮节奏
    const TICK_PX = 100;
    const ticks = Math.ceil(Math.abs(deltaY) / TICK_PX);
    const direction = deltaY > 0 ? 1 : -1;

    for (let t = 0; t < ticks; t++) {
      const progress = t / ticks;
      const eased = 0.5 - Math.cos(Math.PI * progress) / 2;
      const nextEased = 0.5 - Math.cos(Math.PI * (t + 1) / ticks) / 2;
      const tickDelta = (nextEased - eased) * Math.abs(deltaY);
      await this.page.mouse.wheel(0, direction * tickDelta);
      await this.page.waitForTimeout(16 + Math.floor(Math.random() * 16));
    }

    // 等待滚动渲染完成
    await this.page.waitForTimeout(300);
  }
  async waitForLoad(timeout?: number): Promise<void> {
    if (!this.page) {
      throw new Error('No active page');
    }

    await this.page.waitForLoadState('domcontentloaded', {
      timeout: timeout || this.timeout
    });
  }

  /**
   * Wait for dynamic content to settle after a click.
   * Strategy:
   *   1. Try networkidle (max 4s) — catches XHR/fetch-driven renders
   *   2. Then wait for DOM mutations to stop (MutationObserver, max 2s stable 300ms)
   * Never throws — always resolves, worst case after timeout.
   */
  async waitForDynamicContent(maxWaitMs = 4000): Promise<void> {
    if (!this.page) return;

    // Step 1: network idle (SPA data fetches)
    try {
      await this.page.waitForLoadState('networkidle', { timeout: maxWaitMs });
    } catch {
      // networkidle timeout is normal for pages with long-polling / websockets
    }

    // Step 2: wait for DOM to stop mutating
    try {
      await this.page.evaluate(({ stableMs, timeoutMs }: { stableMs: number; timeoutMs: number }) => {
        return new Promise<void>((resolve) => {
          let timer: ReturnType<typeof setTimeout>;
          const reset = () => {
            clearTimeout(timer);
            timer = setTimeout(() => { observer.disconnect(); resolve(); }, stableMs);
          };
          const observer = new MutationObserver(reset);
          observer.observe(document.body, { childList: true, subtree: true, attributes: true });
          // Kick off the first timer immediately
          reset();
          // Hard timeout
          setTimeout(() => { observer.disconnect(); resolve(); }, timeoutMs);
        });
      }, { stableMs: 300, timeoutMs: 2000 });
    } catch {
      // page.evaluate can fail if page navigates mid-wait — that's fine
    }
  }

  /**
   * Wait for a new child frame to be attached to the page after a navigation/click.
   * Playwright only registers iframes in its frame tree when the <iframe> element is
   * actually injected into the DOM — this is separate from network idle or DOM mutation
   * stability. Call this after clicking elements that are known to inject iframes (e.g.
   * SPA routes that render an <iframe> container).
   *
   * @param urlPattern  Optional substring/regex to match the expected frame URL.
   *                    If omitted, resolves on the first new frame attached.
   * @param timeoutMs   Max wait time. Resolves (not rejects) on timeout so callers
   *                    don't need try/catch.
   * @returns The attached Frame, or null on timeout.
   */
  async waitForNewFrame(urlPattern?: string | RegExp, timeoutMs = 5000): Promise<any | null> {
    if (!this.page) return null;
    const framesBefore = new Set(this.page.frames().map((f: any) => f.url()));
    try {
      const frame = await this.page.waitForEvent('frameattached', {
        predicate: (f: any) => {
          const url = f.url();
          // Skip frames we already knew about (e.g. about:blank placeholders)
          if (framesBefore.has(url) && url !== 'about:blank') return false;
          if (!urlPattern) return true;
          if (typeof urlPattern === 'string') return url.includes(urlPattern);
          return urlPattern.test(url);
        },
        timeout: timeoutMs,
      });
      console.error(`[frame-wait] New frame attached: ${frame.url().substring(0, 80)}`);
      return frame;
    } catch {
      console.error(`[frame-wait] No new frame attached within ${timeoutMs}ms`);
      return null;
    }
  }

  /**
   * Get current URL
   */
  async getCurrentUrl(): Promise<string> {
    if (!this.page) {
      throw new Error('No active page');
    }

    return this.page.url();
  }

  /**
   * Get current page (lazy initialization - synchronous version)
   * 🔥 关键优化：延迟获取 page，避免连接时遍历所有 contexts 导致超时
   * 同时过滤掉不稳定的标签页（空白页、崩溃页等）
   * 
   * 注意：这是同步方法，title 检查会在后台异步进行
   */
  getPage(): Page | null {
    // 🔥 检查 Electron 是否通知了标签页切换
    this.checkElectronTabSwitch();

    // 如果已经有 page，直接返回
    if (this.page) {
      return this.page;
    }

    // 如果没有 browser 连接，返回 null
    if (!this.browser) {
      return null;
    }

    // 延迟获取 page（同步版本，不检查 title）
    try {
      console.log('[BrowserController] Lazy loading page...');
      const contexts = this.browser.contexts();
      console.log(`[BrowserController] Found ${contexts.length} browser contexts`);

      if (contexts.length === 0) {
        console.error('[BrowserController] No browser contexts found');
        return null;
      }

      // 遍历所有 contexts，找到第一个稳定的 http/https 页面
      for (const context of contexts) {
        const pages = context.pages();
        
        for (const page of pages) {
          try {
            const url = page.url();
            
            // 🔥 关键过滤：跳过不稳定的页面
            // 1. 跳过空白页（新建标签页）
            if (url === 'about:blank' || url === '') {
              console.log(`[BrowserController] Skipping blank page: ${url}`);
              continue;
            }
            
            // 2. 跳过 Electron 内部页面
            if (url.startsWith('file://') || url.startsWith('devtools://')) {
              console.log(`[BrowserController] Skipping internal page: ${url}`);
              continue;
            }
            
            // 3. 跳过崩溃页面（chrome://crash）
            if (url.startsWith('chrome://') || url.startsWith('chrome-error://')) {
              console.log(`[BrowserController] Skipping crash page: ${url}`);
              continue;
            }
            
            // 找到稳定的页面，设置并返回
            console.log(`[BrowserController] Found stable page: ${url}`);
            this.page = page;
            this.page.setDefaultTimeout(this.timeout);
            this.page.setDefaultNavigationTimeout(this.timeout);
            
            // 异步应用反检测保护（暂时注释）
            // this.applyAntiDetectionProtections(this.page).catch(error => {
            //   console.error('[BrowserController] Failed to apply protections:', error);
            // });
            
            return this.page;
            
          } catch (error) {
            console.error(`[BrowserController] Error checking page:`, error);
            continue;
          }
        }
      }

      // 如果没有找到稳定的页面，返回 null
      console.error('[BrowserController] No stable page found');
      return null;
      
    } catch (error) {
      console.error('[BrowserController] Error getting page:', error);
      return null;
    }
  }

  /**
   * Get browser instance
   */
  getBrowser(): Browser | null {
    return this.browser;
  }

  /**
   * Check if connected
   * 🔥 关键优化：只检查 browser 连接，page 会延迟加载
   */
  isConnected(): boolean {
    return this.browser !== null && this.browser.isConnected();
  }

  /**
   * Disconnect from browser
   * With connection pooling, we keep the connection alive for reuse.
   * The connection will only be closed when the application shuts down.
   */
  async disconnect(): Promise<void> {
    console.log('[BrowserController] Disconnecting from browser...');

    try {
      if (this.cdpSession) {
        await this.cdpSession.detach();
        this.cdpSession = null;
      }

      if (this.browser) {
        // Decrement reference count
        const refCount = BrowserController.connectionRefCount.get(this.port) || 0;
        if (refCount > 1) {
          BrowserController.connectionRefCount.set(this.port, refCount - 1);
          console.log(`[BrowserController] Connection kept alive (refCount: ${refCount - 1})`);
        } else {
          // Last reference - but still keep connection alive for next call
          // Connection will only be closed when explicitly calling closeAllConnections()
          console.log('[BrowserController] Last reference, but keeping connection alive for reuse');
        }

        this.browser = null;
      }

      this.page = null;
      console.log('[BrowserController] Disconnected successfully');
    } catch (error) {
      console.error('[BrowserController] Error during disconnect:', error);
      // Ensure cleanup even on error
      this.browser = null;
      this.page = null;
      this.cdpSession = null;
    }
  }

  /**
   * Pre-connect to browser at application startup
   * This establishes the connection pool early to avoid timeout issues during first use
   */
  static async preConnect(port: number = 9222, timeout: number = 30000): Promise<boolean> {
    console.log(`[BrowserController] Pre-connecting to browser on port ${port}...`);
    
    try {
      const controller = new BrowserController(port, timeout);
      await controller.connect(port, 3); // 3 retries
      
      console.log(`[BrowserController] ✅ Pre-connection established successfully`);
      
      // Don't disconnect - keep the connection in the pool
      // Just clear the instance reference
      controller.browser = null;
      controller.page = null;
      
      return true;
    } catch (error) {
      console.error(`[BrowserController] ❌ Pre-connection failed:`, error);
      return false;
    }
  }

  /**
   * Close all pooled connections (call this when application shuts down)
   */
  static async closeAllConnections(): Promise<void> {
    console.log('[BrowserController] Closing all pooled connections...');

    for (const [port, browser] of BrowserController.connectionPool.entries()) {
      try {
        if (browser && browser.isConnected()) {
          await browser.close();
          console.log(`[BrowserController] Closed connection to port ${port}`);
        }
      } catch (error) {
        console.error(`[BrowserController] Error closing connection to port ${port}:`, error);
      }
    }

    BrowserController.connectionPool.clear();
    BrowserController.connectionRefCount.clear();
    console.log('[BrowserController] All connections closed');
  }

  async connectBackground(startUrl: string, port?: number): Promise<void> {
    if (port) {
      this.port = port;
    }

    const fs = require('fs');
    const path = require('path');
    const os = require('os');
    const tempDir = os.tmpdir();

    // ── CDP connection requires exclusive access ──
    // Playwright's connectOverCDP cannot handle concurrent connections to the same Electron browser.
    // Use an atomic file lock (exclusive create) to ensure only one crawler connects at a time.
    // Other crawlers wait until the lock is released, then connect sequentially.
    console.log(`[BrowserController] [bg] Acquiring CDP lock...`);
    const lockFile = path.join(tempDir, 'hotel-ai-browser-cdp.lock');
    const lockTimeout = 15 * 60 * 1000; // 15 minutes max wait
    const lockStart = Date.now();
    let lockAcquired = false;

    while (Date.now() - lockStart < lockTimeout) {
      try {
        // Atomic: create file exclusively — fails if file already exists
        fs.writeFileSync(lockFile, String(process.pid), { flag: 'wx' });
        lockAcquired = true;
        console.log(`[BrowserController] [bg] CDP lock acquired (pid=${process.pid})`);
        break;
      } catch (e: any) {
        if (e.code === 'EEXIST') {
          // Lock held by another process — check if stale
          let isStale = false;
          let staleReason = '';
          try {
            const lockContent = fs.readFileSync(lockFile, 'utf-8').trim();
            const lockPid = parseInt(lockContent, 10);
            const stat = fs.statSync(lockFile);
            const ageSeconds = Math.round((Date.now() - stat.mtimeMs) / 1000);

            // Check 1: PID 存活性检查（最可靠）
            // 如果锁文件里记录的进程已经不存在了，锁一定是残留的
            if (!isNaN(lockPid) && lockPid > 0) {
              try {
                process.kill(lockPid, 0); // signal 0 = 仅检查进程是否存在，不发送信号
              } catch (killErr: any) {
                if (killErr.code === 'ESRCH') {
                  // 进程不存在
                  isStale = true;
                  staleReason = `owner pid ${lockPid} no longer exists (age=${ageSeconds}s)`;
                }
                // EPERM = 进程存在但无权限发信号，说明进程还活着
              }
            }

            // Check 2: mtime 兜底（keepAlive 每 30s 更新，2 分钟没更新基本确认死了）
            if (!isStale && ageSeconds > 120) {
              isStale = true;
              staleReason = `mtime stale (age=${ageSeconds}s, threshold=120s)`;
            }
          } catch (_) {}

          if (isStale) {
            console.warn(`[BrowserController] [bg] Stale lock detected: ${staleReason}, breaking`);
            try { fs.unlinkSync(lockFile); } catch (_) {}
            continue;
          }

          // Wait and retry
          await new Promise(r => setTimeout(r, 1000 + Math.floor(Math.random() * 1000)));
          continue;
        }
        throw e;
      }
    }

    if (!lockAcquired) {
      console.warn(`[BrowserController] [bg] Lock timeout after ${lockTimeout / 1000}s, proceeding anyway`);
    }

    // Touch lock file periodically to prevent stale detection
    const lockKeepAlive = setInterval(() => {
      try { fs.writeFileSync(lockFile, String(process.pid)); } catch (_) {}
    }, 30000);

    const releaseLock = () => {
      clearInterval(lockKeepAlive);
      try { fs.unlinkSync(lockFile); } catch (_) {}
      console.log(`[BrowserController] [bg] CDP lock released (pid=${process.pid})`);
    };
    process.once('exit', releaseLock);

    try {
      // Step 1: Connect to CDP (no other crawler is using CDP right now)
      // 🔥 Background 模式必须创建新连接，不能复用连接池中的旧连接。
      // 旧连接的 contexts/pages 列表是过时的，看不到 Electron 新创建的 BrowserView。
      console.log(`[BrowserController] [bg] Step 1: Connecting to CDP (fresh connection)...`);
      BrowserController.connectionPool.delete(this.port);
      BrowserController.connectionRefCount.delete(this.port);
      await this.connect(this.port);
      console.log(`[BrowserController] [bg] Step 1: CDP connected`);

      // Step 2: Set up page listener + create bg tab
      // 先记录当前已有的所有页面 URL，用于 Step 3 fallback 时排除已有页面
      const existingPageUrls = new Set<string>();
      for (const ctx of this.browser!.contexts()) {
        for (const p of ctx.pages()) {
          try { existingPageUrls.add(p.url()); } catch {}
        }
      }

      let resolveNewPage: (page: Page) => void;
      const newPagePromise = new Promise<Page>((resolve) => { resolveNewPage = resolve; });
      const pageHandlers: Array<{ ctx: any; handler: (page: Page) => void }> = [];

      for (const ctx of this.browser!.contexts()) {
        const handler = (page: Page) => {
          console.log(`[BrowserController] [bg] Step 2: 🎯 page event: ${page.url()}`);
          resolveNewPage(page);
        };
        ctx.on('page', handler);
        pageHandlers.push({ ctx, handler });
      }

      const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const requestFile = path.join(tempDir, `hotel-ai-browser-ipc-${requestId}.json`);
      const responseFile = path.join(tempDir, `hotel-ai-browser-ipc-${requestId}.response.json`);
      try { fs.unlinkSync(responseFile); } catch (_) {}

      fs.writeFileSync(requestFile, JSON.stringify({
        action: 'create_bg_tab', requestId, url: startUrl,
        sessionId: this.sessionId, timestamp: Date.now()
      }));
      console.log(`[BrowserController] [bg] Step 2: Requested bg tab for: ${startUrl}`);

      const maxWait = 8000;
      const start = Date.now();
      let response: { tabId: string; wcId: number } | null = null;
      while (Date.now() - start < maxWait) {
        await new Promise(r => setTimeout(r, 50));
        if (fs.existsSync(responseFile)) {
          try {
            response = JSON.parse(fs.readFileSync(responseFile, 'utf8'));
            fs.unlinkSync(responseFile);
            break;
          } catch (_) {}
        }
      }

      if (!response) {
        for (const { ctx, handler } of pageHandlers) { ctx.off('page', handler); }
        throw new Error('[BrowserController] [bg] Electron did not respond to create_bg_tab in time');
      }

      this.bgTabId = response.tabId;
      this.backgroundMode = true;
      console.log(`[BrowserController] [bg] Step 2: bg tab created, tabId=${response.tabId}`);

      // Step 3: Find our page
      const bgPage = await Promise.race([
        newPagePromise,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000))
      ]);
      for (const { ctx, handler } of pageHandlers) { ctx.off('page', handler); }

      if (bgPage) {
        this.page = bgPage;
        console.log(`[BrowserController] [bg] Step 3: ✅ Got page via event: ${this.page.url()}`);
      } else {
        console.warn(`[BrowserController] [bg] Step 3: page event timed out, searching by domain...`);
        const targetDomain = startUrl.replace(/^https?:\/\//, '').split('/')[0];

        for (let attempt = 0; attempt < 5; attempt++) {
          const allPages = this.browser!.contexts().flatMap(c => c.pages());
          const match = allPages.find(p => {
            try {
              const u = p.url();
              // 只在 bgTab 创建后新出现的页面中查找，排除已有页面（如 file:///...index.html）
              return !existingPageUrls.has(u) && u.includes(targetDomain);
            } catch { return false; }
          });
          if (match) { this.page = match; break; }
          await new Promise(r => setTimeout(r, 500));
        }

        if (!this.page) {
          // 兜底：取新出现的页面中最后一个（排除已有页面）
          const allPages = this.browser!.contexts().flatMap(c => c.pages())
            .filter(p => {
              const u = p.url();
              return u && u !== 'about:blank' && !existingPageUrls.has(u);
            });
          if (allPages.length > 0) this.page = allPages[allPages.length - 1];
        }
      }

      if (!this.page) {
        throw new Error(`[BrowserController] [bg] Could not find background page for "${startUrl}"`);
      }

      // Step 4: Disconnect from shared CDP — release it for the next crawler
      // We keep our Page reference which stays valid even after browser.close()
      // because Playwright Page objects maintain their own CDP session.
      // Actually, we can't disconnect — Page needs the browser connection.
      // Instead, just release the lock. The next crawler's connectOverCDP will
      // create a NEW independent connection, which works fine as long as
      // we're not in the middle of connectOverCDP ourselves.

    } finally {
      // 不在这里释放锁。Playwright connectOverCDP 不支持并发：
      // 即使本爬虫已拿到 Page，另一个爬虫的 connectOverCDP 仍会因 CDP 通道繁忙而超时。
      // 锁在 process exit 时由 releaseLock 回调释放。
      // 如果进程被 SIGKILL，stale 检测（PID 存活性检查）会在几秒内清除残留锁。
    }

    // ── Outside lock: configure page (parallel-safe) ──
    try { await this.page!.waitForLoadState('domcontentloaded', { timeout: 5000 }); } catch (_) {}
    this.page!.setDefaultTimeout(this.timeout);
    this.page!.setDefaultNavigationTimeout(this.timeout);
    try { await this.page!.setViewportSize({ width: 1280, height: 800 }); } catch (_) {}

    console.log(`[BrowserController] [bg] ✅ Background page ready at: ${this.page!.url()}`);
  }

  /**
   * Close the background page and notify Electron to destroy hidden BrowserViews for this session.
   * When sessionId is set, only destroys bg tabs belonging to this session (concurrent-safe).
   * When sessionId is not set, falls back to destroying ALL bg tabs (legacy behavior).
   */
  async closeBackgroundPage(): Promise<void> {
    // Release CDP lock
    try {
      const fs = require('fs');
      const path = require('path');
      const os = require('os');
      const lockFile = path.join(os.tmpdir(), 'hotel-ai-browser-cdp.lock');
      fs.unlinkSync(lockFile);
      console.log(`[BrowserController] [bg] CDP lock released on close (pid=${process.pid})`);
    } catch (_) {}

    // Notify Electron to destroy background BrowserViews
    try {
      const fs = require('fs');
      const path = require('path');
      const os = require('os');
      const requestFile = path.join(os.tmpdir(), `hotel-ai-browser-ipc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);

      if (this.sessionId) {
        // Concurrent-safe: destroy only bg tabs belonging to this session
        fs.writeFileSync(requestFile, JSON.stringify({
          action: 'destroy_bg_tabs_by_session',
          sessionId: this.sessionId,
          requestId: path.basename(requestFile).replace('hotel-ai-browser-ipc-', '').replace('.json', ''),
          timestamp: Date.now(),
        }));
        console.log(`[BrowserController] [bg] Requested Electron to destroy bg tabs for session: ${this.sessionId}`);
      } else {
        // Legacy: destroy all bg tabs
        fs.writeFileSync(requestFile, JSON.stringify({
          action: 'destroy_all_bg_tabs',
          requestId: path.basename(requestFile).replace('hotel-ai-browser-ipc-', '').replace('.json', ''),
          timestamp: Date.now(),
        }));
        console.log(`[BrowserController] [bg] Requested Electron to destroy all bg tabs`);
      }
    } catch (e) {
      console.warn('[BrowserController] [bg] Failed to notify Electron to destroy bg tabs:', e);
    }
    this.bgTabId = null;
    this.page = null;
    this.backgroundMode = false;
  }

  /**
   * Wait for specified time
   */
  async wait(ms: number): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Detect cross-origin iframes that Playwright cannot penetrate via CDP,
   * and use CDP Runtime.evaluate to interact with the iframe's execution context.
   *
   * When site-isolation is disabled (IsolateOrigins,site-per-process off),
   * cross-origin iframes share the same renderer process as the parent page,
   * so they do NOT get their own CDP target. Playwright's frame tree also
   * cannot see them. But CDP Runtime can enumerate all execution contexts
   * including those belonging to cross-origin iframes.
   *
   * Detection criteria (all must be true, no hardcoded domains):
   *   1. DOM contains an <iframe> with an absolute http(s) src
   *   2. The iframe is large enough to be a main content area (> 200x200)
   *   3. The iframe's origin differs from the current page's origin
   *   4. Playwright's frame tree does NOT contain a frame at that URL
   *
   * Returns { iframeSrc, cdpSession, contextId } so callers can use
   * cdpSession.send('Runtime.evaluate', { contextId, expression }) to
   * interact with the iframe's DOM.
   */
  async detectCrossOriginIframe(): Promise<{
    iframeSrc: string;
    cdpSession: CDPSession;
    contextId: number;
    iframeBounds: { x: number; y: number; w: number; h: number };
  } | null> {
    if (!this.page) return null;

    const currentOrigin = new URL(this.page.url()).origin;
    const knownFrameUrls = new Set(this.page.frames().map((f: any) => f.url()));

    // Query DOM for candidate iframes
    const candidates: Array<{ src: string; w: number; h: number; x: number; y: number }> = await this.page.evaluate(() => {
      return Array.from(document.querySelectorAll('iframe'))
        .map(f => {
          const src = f.src || f.getAttribute('src') || '';
          const r = f.getBoundingClientRect();
          return { src, w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y) };
        })
        .filter(c => c.src.startsWith('http'));
    });

    for (const { src, w, h, x, y } of candidates) {
      if (w < 200 || h < 200) continue;

      let iframeOrigin: string;
      try {
        iframeOrigin = new URL(src).origin;
      } catch {
        continue;
      }

      if (iframeOrigin === currentOrigin) continue;

      const alreadyRegistered = Array.from(knownFrameUrls).some(u => u.startsWith(iframeOrigin));
      if (alreadyRegistered) continue;

      console.error(`[cross-origin-iframe] Detected unregistered cross-origin iframe (${w}x${h}): ${src.substring(0, 100)}`);

      // Use CDP to find the iframe's execution context
      try {
        const cdpSession = await this.page.context().newCDPSession(this.page);

        // Enable Runtime to get execution contexts
        await cdpSession.send('Runtime.enable');

        // Small delay for contexts to be reported
        await new Promise(r => setTimeout(r, 300));

        // Query all execution contexts
        const result: any = await cdpSession.send('Runtime.evaluate', {
          expression: 'true',
          returnByValue: true,
        });

        // Use Page.getFrameTree to find all frames including cross-origin ones
        let frameTree: any;
        try {
          frameTree = await cdpSession.send('Page.getFrameTree');
        } catch {
          console.error(`[cross-origin-iframe] Page.getFrameTree failed`);
        }

        // Collect all frame IDs from the frame tree
        const frameIds: Array<{ id: string; url: string }> = [];
        const collectFrameIds = (node: any) => {
          if (node.frame) {
            frameIds.push({ id: node.frame.id, url: node.frame.url || '' });
          }
          if (node.childFrames) {
            for (const child of node.childFrames) {
              collectFrameIds(child);
            }
          }
        };
        if (frameTree) collectFrameIds(frameTree.frameTree);

        console.error(`[cross-origin-iframe] Frame tree has ${frameIds.length} frames: ${frameIds.map(f => f.url.substring(0, 60)).join(' ; ')}`);

        // Find the frame whose URL matches the iframe origin
        const targetFrame = frameIds.find(f => f.url.startsWith(iframeOrigin));

        if (!targetFrame) {
          console.error(`[cross-origin-iframe] No frame in tree matches origin ${iframeOrigin}`);
          await cdpSession.detach();
          continue;
        }

        // Create an isolated world in the iframe's frame to execute JS
        let contextId: number;
        try {
          const worldResult: any = await cdpSession.send('Page.createIsolatedWorld', {
            frameId: targetFrame.id,
            worldName: 'crawler-iframe-access',
            grantUniveralAccess: true,
          });
          contextId = worldResult.executionContextId;
          console.error(`[cross-origin-iframe] ✅ Created isolated world in iframe frame, contextId=${contextId}`);
        } catch (worldErr) {
          console.error(`[cross-origin-iframe] createIsolatedWorld failed:`, worldErr);
          await cdpSession.detach();
          continue;
        }

        return {
          iframeSrc: src,
          cdpSession,
          contextId,
          iframeBounds: { x, y, w, h },
        };
      } catch (cdpErr) {
        console.error(`[cross-origin-iframe] CDP session failed:`, cdpErr);
      }
    }

    return null;
  }
}
