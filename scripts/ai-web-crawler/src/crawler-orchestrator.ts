/**
 * Crawler Orchestrator
 * Main orchestrator that coordinates all components
 */

import { BrowserController } from './browser-controller';
import { VisionNavigator } from './vision-navigator';
import { SmartClickHandler } from './smart-click-handler';
import { PageAnalyzer } from './page-analyzer';
import { DataExtractor } from './data-extractor';
import { DOMExtractor } from './dom-extractor';
import { NetworkMonitor } from './network-monitor';
import { ScreenshotManager } from './screenshot-manager';
import {
  CrawlerParams,
  CrawlerResult,
  NavigationStep,
  NavigationAnalysis,
  ProgressCallback,
  ExtractedData,
  NavigationContext,
  DOMContent
} from './types';
import { AppConfig } from './config-types';
import { LoginDetector } from './login-detector';

export class CrawlerOrchestrator {
  private config: AppConfig;
  private browserController: BrowserController;
  private visionNavigator: VisionNavigator;
  private clickHandler: SmartClickHandler | null = null;
  private pageAnalyzer: PageAnalyzer | null = null;
  private dataExtractor: DataExtractor;
  private domExtractor: DOMExtractor | null = null;
  private networkMonitor: NetworkMonitor | null = null;
  private screenshotManager: ScreenshotManager;
  private loginDetector: LoginDetector;
  private currentParams: CrawlerParams | null = null;

  constructor(config: AppConfig) {
    this.config = config;

    this.browserController = new BrowserController(
      config.browser.default_port,
      config.browser.timeout
    );

    this.visionNavigator = new VisionNavigator(config.llm);
    this.dataExtractor = new DataExtractor(config.llm);
    this.loginDetector = new LoginDetector();

    this.screenshotManager = new ScreenshotManager(
      './screenshots',
      config.crawler.screenshot_quality,
      config.crawler.screenshot_max_size
    );

    this.browserController.setScreenshotManager(this.screenshotManager);
  }

  /**
   * Main entry point
   */
  async run(params: CrawlerParams, progressCallback?: ProgressCallback): Promise<CrawlerResult> {
    const startTime = Date.now();
    this.currentParams = params;
    const navigationPath: NavigationStep[] = [];
    const screenshots: string[] = [];

    try {
      // ── Connection mode ──────────────────────────────────────────────────────
      // background=true → create a hidden BrowserView, no Electron tab switch
      // background=false → visible mode (debugging only)
      if (params.background && params.startUrl) {
        console.error(`[CRAWLER-DEBUG] >>> ENTERING BACKGROUND MODE: startUrl=${params.startUrl}, sessionId=${params.sessionId}`);
        console.log(`[CrawlerOrchestrator] [bg] Background mode: startUrl=${params.startUrl}`);
        // Pass sessionId to BrowserController for concurrent isolation
        if (params.sessionId) {
          this.browserController.setSessionId(params.sessionId);
        }
        await this.browserController.connectBackground(params.startUrl, params.browserPort);
      } else if (params.background && !params.startUrl) {
        // background=true but no startUrl — create hidden tab with about:blank
        // NEVER connect to user's visible page in background mode
        console.error(`[CRAWLER-DEBUG] >>> ENTERING BACKGROUND MODE (no startUrl, using about:blank)`);
        if (params.sessionId) {
          this.browserController.setSessionId(params.sessionId);
        }
        await this.browserController.connectBackground('about:blank', params.browserPort);
      } else {
        console.error(`[CRAWLER-DEBUG] >>> ENTERING VISIBLE MODE (debug): background=${params.background}, startUrl=${params.startUrl}`);
        if (params.operation === 'fetch_data' && params.tabKeyword) {
          console.log(`[CrawlerOrchestrator] Requesting Electron to switch to tab: ${params.tabKeyword}`);
          await this.requestElectronTabSwitch(params.tabKeyword);
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        await this.connectBrowser(params.browserPort, progressCallback);
      }

      // ── 登录检测（后台模式）──────────────────────────────────────────────
      if (params.background && params.operation === 'fetch_data') {
        const page = this.browserController.getPage();
        if (page) {
          // 等页面充分加载：先等 domcontentloaded，再等 networkidle（最多 8s）
          // 后台系统常有 JS 重定向到登录页，domcontentloaded 时重定向可能还没完成
          try { await page.waitForLoadState('domcontentloaded', { timeout: 5000 }); } catch {}
          const urlBeforeWait = page.url();
          try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch {}
          const urlAfterWait = page.url();

          // 如果 URL 发生了变化（重定向），额外等待让新页面渲染
          if (urlAfterWait !== urlBeforeWait) {
            console.error(`[LoginDetector] URL changed during load: ${urlBeforeWait.substring(0, 60)} → ${urlAfterWait.substring(0, 60)}`);
            try { await page.waitForLoadState('domcontentloaded', { timeout: 5000 }); } catch {}
            await this.browserController.wait(1000);
          } else {
            await this.browserController.wait(500);
          }

          const loginResult = await this.handleLoginIfNeeded(
            page, this.browserController.getBgTabId(), params.sessionId
          );
          if (loginResult === 'skipped') {
            return {
              success: false, navigationPath: [], screenshots: [],
              stats: { totalSteps: 0, duration: Date.now() - startTime, confidence: 0.0 },
              error: { code: '4001', message: '用户跳过登录，任务终止' },
            };
          }
          if (loginResult === 'timeout') {
            return {
              success: false, navigationPath: [], screenshots: [],
              stats: { totalSteps: 0, duration: Date.now() - startTime, confidence: 0.0 },
              error: { code: '4002', message: '登录等待超时，任务终止' },
            };
          }
        }
      }

      // Handle list_tabs
      if (params.operation === 'list_tabs') {
        // In background mode, list_tabs is meaningless — return error
        if (params.background) {
          return {
            success: false,
            navigationPath: [],
            screenshots: [],
            stats: { totalSteps: 0, duration: Date.now() - startTime, confidence: 0.0 },
            error: {
              code: '1003',
              message: '当前为静默后台模式，不支持 list_tabs。请直接使用 operation="fetch_data" 配合 target 和 extraction_goal 执行爬取。',
            },
          };
        }
        const tabs = await this.browserController.listTabs();
        return {
          success: true,
          data: {
            data: { tabs },
            confidence: 1.0,
            strategy: 'dom_only' as const,
          },
          navigationPath: [],
          screenshots: [],
          stats: {
            totalSteps: 0,
            duration: Date.now() - startTime,
            confidence: 1.0,
          },
        };
      }

      // Handle switch_tab
      if (params.operation === 'switch_tab') {
        // In background mode, switch_tab is meaningless — return error
        if (params.background) {
          return {
            success: false,
            navigationPath: [],
            screenshots: [],
            stats: { totalSteps: 0, duration: Date.now() - startTime, confidence: 0.0 },
            error: {
              code: '1004',
              message: '当前为静默后台模式，不支持 switch_tab。请直接使用 operation="fetch_data" 配合 target 和 extraction_goal 执行爬取。',
            },
          };
        }
        if (!params.tabKeyword) {
          return {
            success: false,
            navigationPath: [],
            screenshots: [],
            stats: {
              totalSteps: 0,
              duration: Date.now() - startTime,
              confidence: 0.0,
            },
            error: {
              code: '1001',
              message: 'switch_tab 操作需要提供 tabKeyword 参数',
            },
          };
        }

        await this.switchTab(params.tabKeyword, progressCallback);
        
        // 获取切换后的标签页信息
        const tabs = await this.browserController.listTabs();
        const currentUrl = await this.browserController.getCurrentUrl();
        
        return {
          success: true,
          data: {
            data: { 
              message: `已切换到标签页: ${params.tabKeyword}`,
              currentUrl,
              tabs 
            },
            confidence: 1.0,
            strategy: 'dom_only' as const,
          },
          navigationPath: [],
          screenshots: [],
          stats: {
            totalSteps: 0,
            duration: Date.now() - startTime,
            confidence: 1.0,
          },
        };
      }

      // Handle extract_current: skip navigation, extract current active page directly
      if (params.operation === 'extract_current') {
        console.error(`[extract_current] Starting, checking page...`);
        const page = this.browserController.getPage();
        console.error(`[extract_current] getPage() returned: ${page ? page.url() : 'null'}`);
        if (!page) {
          // 列出所有可用页面帮助诊断
          const allPages = this.browserController.getBrowser()?.contexts().flatMap(c => c.pages()) || [];
          console.error(`[extract_current] Available pages: ${allPages.map(p => { try { return p.url(); } catch { return '(error)'; } }).join(', ')}`);
          return {
            success: false, navigationPath: [], screenshots: [],
            stats: { totalSteps: 0, duration: Date.now() - startTime, confidence: 0.0 },
            error: { code: '1005', message: `extract_current: 未找到可用的前台页面。请确保左侧浏览器已打开目标页面。` },
          };
        }
        await this.initializePageComponents();
        const data = await this.extractData(
          params.extractionGoal || 'Extract all relevant content from the current page',
          progressCallback
        );
        // 前台模式：提取完后滚回顶部，避免影响用户浏览
        try {
          await page.evaluate(() => {
            window.scrollTo({ top: 0, behavior: 'instant' });
            document.querySelectorAll('*').forEach(el => {
              if (el.scrollTop > 0) el.scrollTo({ top: 0, behavior: 'instant' });
            });
          });
        } catch (_) {}
        return {
          success: true,
          data,
          navigationPath: [],
          screenshots: [],
          stats: {
            totalSteps: 0,
            duration: Date.now() - startTime,
            confidence: data.confidence,
          },
        };
      }

      // Switch tab if keyword provided (for fetch_data operation)
      // Skip this block in background mode — connectBackground already set the page.
      if (!params.background && params.tabKeyword) {
        // 只更新page引用，不再通知Electron（已经在上面通知过了）
        console.log('[CrawlerOrchestrator] Updating page reference after tab switch');
        const success = await this.browserController.switchTab(params.tabKeyword, true); // skipElectronNotify=true
        if (!success) {
          throw new Error(`Tab not found: ${params.tabKeyword}`);
        }
        console.log('[CrawlerOrchestrator] Reinitializing page components after tab switch');
      } else if (!params.background) {
        // 检查是否有多个标签页
        const tabs = await this.browserController.listTabs();
        const currentUrl = await this.browserController.getCurrentUrl();

        if (tabs.length > 1) {
          // 多标签页场景：返回错误，要求Agent指定tab_keyword
          console.error(`[CrawlerOrchestrator] ❌ Multiple tabs detected but no tab_keyword provided`);
          console.error(`[CrawlerOrchestrator] Available tabs:`, tabs.map(t => `${t.title} (${t.url})`));

          return {
            success: false,
            navigationPath: [],
            screenshots: [],
            stats: {
              totalSteps: 0,
              duration: Date.now() - startTime,
              confidence: 0.0,
            },
            error: {
              code: '1002',
              message: `检测到 ${tabs.length} 个标签页，但未提供 tab_keyword 参数。请在调用时指定 tab_keyword 以明确要操作的标签页。\n\n可用标签页：\n${tabs.map((t, i) => `${i + 1}. "${t.title}" - ${t.url}`).join('\n')}`,
            },
          };
        }

        // 单标签页场景：继续在当前页面操作
        console.log(`[CrawlerOrchestrator] Single tab detected, operating on current page: ${currentUrl}`);
      }

      // Initialize page-specific components
      await this.initializePageComponents();

      // API拦截模式：监控启动后强制刷新页面，确保重新触发所有API请求
      // 解决"页面已在目标位置，API早已发完，监控什么都捕获不到"的问题
      if (params.interceptApis) {
        const page = this.browserController.getPage();
        if (page) {
          console.error('[API-INTERCEPT] Force-reloading page to re-trigger API requests...');
          try {
            // 使用 'load' 而非 'networkidle'：'load' 事件在主资源加载完成后触发（通常 <5s），
            // 绝大多数业务 API 在此之前已经发出。'networkidle' 在有 websocket/轮询的 OTA
            // 网站上几乎必定触发 30s 超时，白白浪费时间。
            await page.reload({ waitUntil: 'load', timeout: 15000 });
          } catch {
            console.error('[API-INTERCEPT] Page reload timeout (non-fatal, continuing)');
          }
          // 额外等待确保延迟加载的API也被捕获（从2s优化到3s，load 事件比 networkidle 更早触发）
          await this.browserController.wait(3000);
          console.error(`[API-INTERCEPT] After reload: captured ${this.networkMonitor?.getCapturedCount() || 0} requests`);
        }
      }

      // Reset navigator session for this task
      this.visionNavigator.resetNavigation();

      // Navigate to target
      if (params.target) {
        const navResult = await this.navigateToTarget(
          params.target,
          params.navigationHint,
          params.extractionGoal,
          params.maxSteps || this.config.crawler.max_navigation_steps,
          navigationPath,
          screenshots,
          progressCallback
        );

        if (!navResult) {
          return {
            success: false,
            navigationPath,
            screenshots,
            stats: {
              totalSteps: navigationPath.length,
              duration: Date.now() - startTime,
              confidence: 0.0,
            },
            error: {
              code: '2001',
              message: `导航失败：已达到最大步数，仍未到达目标页面 "${params.target}"`,
            },
          };
        }
      }

      // API拦截模式：导航到目标页后再次 reload，重新触发目标页的 API 请求
      // 初始 reload 发生在起始页（如首页），此时目标页的房价 API 尚未出现
      // 导航过程中新标签页的 API 可能在 NetworkMonitor 启动前就已发完，必须重刷一次
      // 但搜索建议等输入触发的 API 只在导航过程中出现，reload 后不会再触发，必须保留
      if (params.interceptApis && params.target) {
        const page = this.browserController.getPage();
        if (page) {
          console.error('[API-INTERCEPT] Target reached, reloading to re-trigger target page APIs...');
          // 保留导航过程中捕获的请求（搜索建议等输入触发的 API 只在此阶段出现）
          const navigationCaptured = this.networkMonitor?.getCapturedData() || [];
          console.error(`[API-INTERCEPT] Preserving ${navigationCaptured.length} requests captured during navigation`);
          this.networkMonitor?.clearCapturedData();
          try {
            await page.reload({ waitUntil: 'load', timeout: 15000 });
          } catch {
            console.error('[API-INTERCEPT] Target page reload timeout (non-fatal, continuing)');
          }
          await this.browserController.wait(3000);
          // 合并：导航过程中的请求 + reload 后的请求（去重）
          const reloadCaptured = this.networkMonitor?.getCapturedData() || [];
          console.error(`[API-INTERCEPT] After target reload: captured ${reloadCaptured.length} new requests`);
          // 将导航过程中的请求加回来（URL 去重，reload 的优先）
          const reloadUrls = new Set(reloadCaptured.map(r => r.url));
          const merged = [...reloadCaptured];
          for (const req of navigationCaptured) {
            if (!reloadUrls.has(req.url)) {
              merged.push(req);
            }
          }
          // 替换 capturedData
          this.networkMonitor?.clearCapturedData();
          this.networkMonitor?.restoreCapturedData(merged);
          console.error(`[API-INTERCEPT] Merged total: ${merged.length} requests (${navigationCaptured.length} from navigation + ${reloadCaptured.length} from reload, deduplicated)`);

          // 搜索建议 API 探测：如果目标是拦截搜索建议类 API，逐个尝试所有文本输入框
          const hint = (params.navigationHint || '') + (params.extractionGoal || '') + (params.target || '');
          const isSearchProbe = /搜索建议|搜索框|search.*suggest|hotel.*search|输入.*酒店名|关键词.*搜索/i.test(hint);
          if (isSearchProbe) {
            console.error('[API-INTERCEPT] Search suggestion probe: trying all text input fields...');
            try {
              const inputFields = await this.clickHandler!.extractInputFields();
              const textFields = inputFields.filter((f: any) => f.type === 'text' || f.type === 'search');
              const probeKeyword = '汉庭酒店';

              for (let i = 0; i < textFields.length; i++) {
                const field = textFields[i];
                const beforeCount = this.networkMonitor?.getCapturedCount() || 0;
                console.error(`[API-INTERCEPT] Probe input[${i}]: "${field.placeholder}" ...`);

                try {
                  // 清空输入框再输入
                  await this.clickHandler!.inputByPlaceholder(field.placeholder, '');
                  await this.browserController.wait(300);
                  await this.clickHandler!.inputByPlaceholder(field.placeholder, probeKeyword);
                  await this.browserController.wait(1500); // 等搜索建议 API 返回

                  const afterCount = this.networkMonitor?.getCapturedCount() || 0;
                  const newRequests = afterCount - beforeCount;
                  console.error(`[API-INTERCEPT] Probe input[${i}] "${field.placeholder}": ${newRequests} new requests captured`);

                  if (newRequests > 0) {
                    console.error(`[API-INTERCEPT] ✅ Found search API trigger in input: "${field.placeholder}"`);
                    break; // 找到了，不用继续尝试其他输入框
                  }
                } catch (inputErr) {
                  console.error(`[API-INTERCEPT] Probe input[${i}] failed: ${inputErr instanceof Error ? inputErr.message : inputErr}`);
                }
              }
            } catch (probeErr) {
              console.error(`[API-INTERCEPT] Search probe failed: ${probeErr instanceof Error ? probeErr.message : probeErr}`);
            }
          }
        }
      }

      // Expand page content — skip in interceptApis mode
      // API 拦截模式下数据来自网络请求而非 DOM，expand 会点击页面元素导致跳转，
      // 破坏已拦截的搜索建议 API 数据（如点击"搜索"按钮触发页面跳转）
      if (!params.interceptApis) {
        await this.expandPage(
          params.maxExpandSteps || this.config.crawler.max_expand_steps,
          progressCallback
        );
      } else {
        console.error('[expand] SKIPPED: interceptApis mode — expand would disrupt captured API data');
      }

      // Collect API candidates if intercept_apis mode is enabled
      const apiCandidates = params.interceptApis && this.networkMonitor
        ? this.networkMonitor.getAPICandidates()
        : undefined;

      // Debug: log API interception results
      if (params.interceptApis && this.networkMonitor) {
        const allCaptured = this.networkMonitor.getCapturedData();
        const candidates = apiCandidates || [];
        console.error(`[API-INTERCEPT] Total captured requests: ${allCaptured.length}, Filtered candidates: ${candidates.length}`);
        if (candidates.length > 0) {
          candidates.forEach((c, i) => {
            console.error(`[API-INTERCEPT] Candidate ${i}: ${c.method} ${c.url.substring(0, 100)} (${c.responseSize}B, ${c.statusCode})`);
          });
        } else {
          // Log first 10 captured requests to understand what was filtered out
          allCaptured.slice(0, 10).forEach((r, i) => {
            console.error(`[API-INTERCEPT] Captured ${i}: ${r.method} ${r.url.substring(0, 100)} (ct=${r.contentType}, size=${r.responseSize}, status=${r.statusCode})`);
          });
        }
      }

      // In interceptApis mode, skip extractData (Phase 8) — data comes from API scripts, not DOM extraction
      let data: any;
      if (params.interceptApis) {
        console.error('[Phase 8] SKIPPED: interceptApis mode — data extraction handled by API scripts');
        data = { data: null, confidence: 0, strategy: 'skipped-api-first' };
      } else {
        // Extract data (standard crawler mode)
        data = await this.extractData(
          params.extractionGoal || params.target || 'Extract all relevant data',
          progressCallback
        );
      }

      return {
        success: true,
        data,
        navigationPath,
        screenshots,
        stats: {
          totalSteps: navigationPath.length,
          duration: Date.now() - startTime,
          confidence: data.confidence,
        },
        ...(apiCandidates ? { apiCandidates } : {}),
      };

    } catch (error) {
      return {
        success: false,
        navigationPath,
        screenshots,
        stats: {
          totalSteps: navigationPath.length,
          duration: Date.now() - startTime,
          confidence: 0.0,
        },
        error: {
          code: '5001',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  /**
   * Connect to browser
   */
  private async connectBrowser(port?: number, progressCallback?: ProgressCallback): Promise<void> {
    progressCallback?.({ phase: 'connecting', message: 'Connecting to browser...' });
    await this.browserController.connect(port);
  }

  /**
   * Request Electron to switch tab by keyword (via file IPC)
   */
  private async requestElectronTabSwitch(keyword: string): Promise<void> {
    try {
      const fs = require('fs');
      const path = require('path');
      const os = require('os');
      
      console.log(`[CrawlerOrchestrator] Requesting Electron to switch to tab: ${keyword}`);
      
      // Write switch request to temporary file (unique requestId for concurrency)
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
      console.log(`[CrawlerOrchestrator] Tab switch request written to: ${requestFile}`);
      
      // 等待Electron处理（减少到2秒超时）
      const maxWait = 2000;
      const startTime = Date.now();
      
      while (fs.existsSync(requestFile) && (Date.now() - startTime) < maxWait) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      if (fs.existsSync(requestFile)) {
        console.warn(`[CrawlerOrchestrator] Electron did not process tab switch request in time`);
        // Clean up the file
        try {
          fs.unlinkSync(requestFile);
        } catch (e) {
          // Ignore cleanup errors
        }
      } else {
        console.log(`[CrawlerOrchestrator] Electron processed tab switch request`);
      }
      
    } catch (error) {
      console.warn(`[CrawlerOrchestrator] Failed to request Electron tab switch:`, error);
    }
  }

  /**
   * Switch to tab
   */
  private async switchTab(keyword: string, progressCallback?: ProgressCallback): Promise<void> {
    progressCallback?.({ phase: 'connecting', message: `Switching to tab: ${keyword}` });
    const success = await this.browserController.switchTab(keyword);
    if (!success) {
      throw new Error(`Tab not found: ${keyword}`);
    }
  }

  /**
   * Initialize page-specific components
   */
  private async initializePageComponents(): Promise<void> {
    const page = this.browserController.getPage();
    if (!page) throw new Error('No active page');

    // 保留旧 NetworkMonitor 的捕获数据（标签页切换时不丢失之前的 API 拦截结果）
    const previousCaptured = this.networkMonitor?.getCapturedData() || [];

    this.clickHandler = new SmartClickHandler(page, this.currentParams?.background === true);
    this.domExtractor = new DOMExtractor(page, this.config.extraction.max_dom_size);
    this.networkMonitor = new NetworkMonitor(page);

    this.pageAnalyzer = new PageAnalyzer(
      this.visionNavigator,
      this.clickHandler,
      this.browserController
    );

    await this.networkMonitor.startMonitoring();

    // 恢复之前捕获的数据
    if (previousCaptured.length > 0) {
      this.networkMonitor.restoreCapturedData(previousCaptured);
      console.error(`[API-INTERCEPT] Restored ${previousCaptured.length} previously captured requests after page component re-init`);
    }
  }

  /**
   * Navigate to target page — multi-turn conversation with step feedback
   */
  private async navigateToTarget(
    target: string,
    hint: string | undefined,
    extractionGoal: string | undefined,
    maxSteps: number,
    navigationPath: NavigationStep[],
    screenshots: string[],
    progressCallback?: ProgressCallback
  ): Promise<boolean> {
    const context: NavigationContext = {
      target,
      hint,
      history: [],
      currentUrl: await this.browserController.getCurrentUrl(),
    };

    // 🔥 Pre-navigation check: Are we already at the target page?
    // This prevents redundant navigation when LLM calls fetch_data multiple times
    console.error(`[nav] Pre-navigation check: Are we already at target "${target}"?`);
    
    // Wait for page to stabilize
    await this.browserController.wait(500);
    
    // Take screenshot for pre-check
    const preCheckScreenshot = await this.browserController.screenshot(undefined, false);
    const preCheckScreenshotUrl = await this.screenshotManager.save(preCheckScreenshot, {
      step: 0,
      label: 'pre-check',
      timestamp: Date.now(),
      size: preCheckScreenshot.length,
      compressed: false,
    });
    screenshots.push(preCheckScreenshotUrl);
    
    // Extract DOM hints for pre-check
    let preCheckDomHints: string | undefined;
    try {
      const navElements = await this.clickHandler!.extractNavigationElements();
      const inputFields = await this.clickHandler!.extractInputFields();
      
      const hints: string[] = [];
      
      if (navElements.length > 0) {
        const navMenus = navElements.filter(el => el.type === 'nav-menu');
        const contentTabs = navElements.filter(el => el.type === 'content-tab');
        const floatingIcons = navElements.filter(el => el.type === 'floating-icon');

        if (navMenus.length > 0) {
          hints.push('**左侧菜单：**');
          navMenus.slice(0, 16).forEach(el => {
            hints.push(`- [${el.position}] "${el.text}" (nav-menu)`);
          });
        }

        if (contentTabs.length > 0) {
          hints.push('**内容区标签页：**');
          contentTabs.slice(0, 12).forEach(el => {
            hints.push(`- [${el.position}] "${el.text}" (content-tab)`);
          });
        }

        if (floatingIcons.length > 0) {
          hints.push('**悬浮图标：**');
          floatingIcons.slice(0, 8).forEach(el => {
            const semanticTag = el.semantic ? ` ← ${el.semantic}` : '';
            hints.push(`- [${el.position}] selector="${el.selector}" (floating-icon, 文字:${el.text})${semanticTag}`);
          });
        }
      }
      
      if (inputFields.length > 0) {
        hints.push('\n**可输入元素：**');
        inputFields.forEach(field => {
          hints.push(`- [${field.position}] "${field.placeholder}" (${field.type}输入框)`);
        });
      }
      
      if (hints.length > 0) {
        preCheckDomHints = hints.join('\n');
      }
    } catch (error) {
      console.error(`[nav] Failed to extract navigation elements for pre-check:`, error);
    }
    
    // Ask LLM: Are we already at the target page?
    const preCheckAnalysis = await this.visionNavigator.analyzePage(preCheckScreenshot, context, preCheckDomHints);
    
    console.error(`[nav] Pre-check result: reached=${preCheckAnalysis.reached} confidence=${preCheckAnalysis.confidence}`);
    
    // If already at target with high confidence, skip navigation
    if (preCheckAnalysis.reached && preCheckAnalysis.confidence > 0.6) {
      console.error(`[nav] ✅ Already at target page, skipping navigation`);
      navigationPath.push({
        step: 0,
        screenshot: preCheckScreenshotUrl,
        analysis: preCheckAnalysis,
        action: { type: 'reached', result: 'success' },
        urlBefore: context.currentUrl,
        urlAfter: context.currentUrl,
        timestamp: Date.now(),
      });
      return true;
    }
    
    console.error(`[nav] Not at target yet, starting navigation...`);

    for (let step = 1; step <= maxSteps; step++) {
      // 减少SPA渲染等待时间到500ms
      await this.browserController.wait(500);

      // ── Screenshot with hard timeout protection ──
      // CDP screenshot can hang on unresponsive background BrowserViews
      let screenshot: Buffer;
      try {
        screenshot = await Promise.race([
          this.browserController.screenshot(undefined, false),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Screenshot hard timeout (20s)')), 20000)
          ),
        ]);
      } catch (screenshotErr) {
        console.error(`[nav] ⚠️ Screenshot failed at step ${step}: ${(screenshotErr as Error).message}. Skipping step.`);
        this.visionNavigator.addStepFeedback(`步骤${step}截图失败`, false, context.currentUrl, '截图超时或失败，跳过该步骤');
        continue;
      }
      const screenshotUrl = await this.screenshotManager.save(screenshot, {
        step,
        label: 'navigation',
        timestamp: Date.now(),
        size: screenshot.length,
        compressed: false,
      });
      screenshots.push(screenshotUrl);

      // Compress screenshot for progress callback (< 200KB base64)
      let screenshotBase64: string | undefined;
      try {
        const compressed = await ScreenshotManager.compressForLLM(screenshot);
        screenshotBase64 = compressed.toString('base64');
      } catch {
        // Compression failed, send progress without screenshot
      }

      progressCallback?.({
        phase: 'navigating',
        step,
        totalSteps: maxSteps,
        message: `Navigation step ${step}/${maxSteps}`,
        screenshot: screenshotBase64,
        data: { url: context.currentUrl },
      });

      // Extract navigation elements (DOM hints) to help AI identify clickable menu items
      let domHints: string | undefined;
      try {
        const navElements = await this.clickHandler!.extractNavigationElements();
        const inputFields = await this.clickHandler!.extractInputFields();
        
        const hints: string[] = [];
        
        if (navElements.length > 0) {
          const navMenus = navElements.filter(el => el.type === 'nav-menu');
          const contentTabs = navElements.filter(el => el.type === 'content-tab');
          const floatingIcons = navElements.filter(el => el.type === 'floating-icon');

          if (navMenus.length > 0) {
            hints.push('**左侧菜单：**');
            navMenus.slice(0, 16).forEach(el => {
              hints.push(`- [${el.position}] "${el.text}" (nav-menu)`);
            });
          }

          if (contentTabs.length > 0) {
            hints.push('**内容区标签页：**');
            contentTabs.slice(0, 12).forEach(el => {
              hints.push(`- [${el.position}] "${el.text}" (content-tab)`);
            });
          }

          if (floatingIcons.length > 0) {
            hints.push('**悬浮图标：**');
            floatingIcons.slice(0, 8).forEach(el => {
              const semanticTag = el.semantic ? ` ← ${el.semantic}` : '';
              hints.push(`- [${el.position}] selector="${el.selector}" (floating-icon, 文字:${el.text})${semanticTag}`);
            });
          }
        }
        
        if (inputFields.length > 0) {
          hints.push('\n**可输入元素：**');
          inputFields.forEach(field => {
            hints.push(`- [${field.position}] "${field.placeholder}" (${field.type}输入框)`);
          });
        }
        
        if (hints.length > 0) {
          domHints = hints.join('\n');
          console.error(`[nav] Extracted ${navElements.length} navigation elements and ${inputFields.length} input fields for DOM hints`);
        }
      } catch (error) {
        console.error(`[nav] Failed to extract navigation elements:`, error);
      }

      // Analyze page (multi-turn: navigator maintains full conversation history)
      // Hard timeout: LLM calls can hang if the API is unresponsive or network issues
      let analysis: NavigationAnalysis;
      try {
        analysis = await Promise.race([
          this.visionNavigator.analyzePage(screenshot, context, domHints),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('analyzePage hard timeout (60s)')), 60000)
          ),
        ]);
      } catch (analysisErr) {
        console.error(`[nav] ⚠️ Page analysis failed at step ${step}: ${(analysisErr as Error).message}. Skipping step.`);
        this.visionNavigator.addStepFeedback(`步骤${step}分析超时`, false, context.currentUrl, 'LLM分析超时，跳过该步骤');
        continue;
      }

      console.error(`[nav] step=${step} reached=${analysis.reached} confidence=${analysis.confidence} action=${analysis.nextAction?.type} element="${analysis.nextAction?.elementText}" reason=${analysis.reasoning}`);

      // 🔥 导航过程中的登录检测：仅在 URL 变化时检查（避免菜单展开等无关操作的开销）
      if (this.currentParams?.background) {
        const currentUrl = await this.browserController.getCurrentUrl();
        if (currentUrl !== context.currentUrl) {
          const page = this.browserController.getPage();
          if (page) {
            const loginCheck = await this.loginDetector.detectLogin(page);
            if (loginCheck.isLoginPage) {
              console.error(`[nav] 🔐 导航过程中检测到登录页: ${loginCheck.siteInfo.domain} (step=${step})`);
              const loginResult = await this.handleLoginIfNeeded(
                page, this.browserController.getBgTabId(), this.currentParams.sessionId
              );
              if (loginResult === 'skipped' || loginResult === 'timeout') {
                return false;
              }
              if (loginResult === 'completed') {
                try { await page.waitForLoadState('domcontentloaded', { timeout: 10000 }); } catch {}
                await this.initializePageComponents();
                continue;
              }
            }
          }
        }
      }

      // Check if reached
      if (analysis.reached && analysis.confidence > 0.6) {
        navigationPath.push({
          step,
          screenshot: screenshotUrl,
          analysis,
          action: { type: 'reached', result: 'success' },
          urlBefore: context.currentUrl,
          urlAfter: context.currentUrl,
          timestamp: Date.now(),
        });
        return true;
      }

      // No valid next action
      if (!analysis.nextAction || analysis.nextAction.type === 'not_found') {
        this.visionNavigator.addStepFeedback(
          '未找到目标入口，自动向下滚动查看更多',
          true,
          context.currentUrl
        );
        await this.browserController.scroll('down');
        await this.browserController.wait(500); // 减少滚动等待时间
        continue;
      }

      const urlBefore = await this.browserController.getCurrentUrl();
      let actionResult: 'success' | 'failed' | 'error' = 'failed';
      let feedbackExtra = '';

      try {
        if (analysis.nextAction.type === 'click' && analysis.nextAction.elementText) {
          const elementText = analysis.nextAction.elementText;

          // Capture URL before click
          const urlBefore = await this.browserController.getCurrentUrl();
          // 记录点击前的标签页快照，用于检测新标签页
          const tabUrlsBefore = this.browserController.getPageUrls();
          console.error(`[nav] 点击前标签页数量: ${tabUrlsBefore.size}`);

          // Capture DOM state before click
          // 🔥 改进：捕获完整的导航菜单状态，包括隐藏的子菜单
          const domBefore = await this.browserController.getPage()?.evaluate(() => {
            // 捕获侧边栏/导航菜单的完整文本
            const navElements = document.querySelectorAll('nav, aside, [class*="sidebar"], [class*="menu"], [role="navigation"]');
            const navTexts = Array.from(navElements).map(el => (el as HTMLElement).innerText).join('|||');
            
            // 🔥 关键：捕获所有可见的菜单项（包括子菜单）
            const visibleMenuItems: string[] = [];
            const allMenuItems = document.querySelectorAll('nav li, aside li, [class*="menu"] li, [class*="sidebar"] li');
            allMenuItems.forEach(item => {
              const style = window.getComputedStyle(item);
              if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
                const text = (item as HTMLElement).innerText?.trim();
                if (text && text.length > 0 && text.length < 100) {
                  visibleMenuItems.push(text);
                }
              }
            });
            
            const mainText = document.body.innerText.substring(0, 1000);
            return { navTexts, mainText, visibleMenuItems: visibleMenuItems.join('|||') };
          });
          // URL was already captured above for duplicate check
          
          // Detect if elementText is a selector (icon element)
          // Selectors typically start with "icon-" or match kebab-case pattern
          const isSelector = elementText.startsWith('icon-') || 
                           elementText.startsWith('selector=') ||
                           elementText.match(/^[a-z]+-[a-z-]+$/) ||
                           elementText.includes('icon') && elementText.includes('-');
          
          let clickResult;
          if (isSelector) {
            // Clean selector (remove "selector=" prefix if present, remove quotes)
            const cleanSelector = elementText
              .replace(/^selector=/, '')
              .replace(/^["'](.*)["']$/, '$1');
            
            console.error(`[nav] Detected selector format, using clickBySelector: "${cleanSelector}"`);
            clickResult = await this.clickHandler!.clickBySelector(cleanSelector);
          } else {
            // Use text click for regular elements
            clickResult = await this.clickHandler!.clickByText(elementText);
          }
          // ── Coordinate fallback ──────────────────────────────────────
          // If DOM-based click failed (element not found or not clickable),
          // ask Gemini to locate the element visually and click by coordinate.
          let usedCoordFallback = false;
          if (!clickResult.success) {
            console.error(`[nav] DOM click failed for "${elementText}", trying coordinate fallback via Gemini...`);
            try {
              // Wait for dynamic content to settle before taking the screenshot —
              // the target element may not be rendered yet (e.g. sub-tabs that
              // appear after a parent menu item is clicked).
              await this.browserController.waitForDynamicContent(2000);

              // Must use viewport screenshot (fullPage=false) so coordinates
              // map 1-to-1 with page.mouse.click(x, y)
              const viewportShot = await this.browserController.screenshot({ format: 'jpeg', quality: 80 }, false);
              const coord = await this.visionNavigator.askForCoordinate(viewportShot, elementText);
              if (coord) {
                const coordResult = await this.clickHandler!.clickByCoordinate(coord.x, coord.y);
                if (coordResult.success) {
                  clickResult = coordResult;
                  actionResult = 'success';
                  usedCoordFallback = true;
                  console.error(`[nav] Coordinate fallback succeeded at (${coord.x}, ${coord.y})`);
                } else {
                  actionResult = 'failed';
                }
              } else {
                actionResult = 'failed';
              }
            } catch (fbErr) {
              console.error(`[nav] Coordinate fallback error:`, fbErr);
              actionResult = 'failed';
            }
          } else {
            actionResult = 'success';
          }
          // ────────────────────────────────────────────────────────────

          // After a successful click, check for page changes in parallel
          // 🔥 性能优化：并行检测 iframe/新标签页/DOM变化，任一检测到变化立即继续
          // 后台模式缩短超时：SPA导航无需等新tab/frame的完整超时
          let switchedToNewTab = false;
          if (clickResult.success || usedCoordFallback) {
            // 并行启动所有检测，用 Promise.allSettled 等待
            const frameCountBefore = this.browserController.getPage()?.frames().length ?? 0;
            const detectTimeout = this.currentParams?.background ? 600 : 1500;

            const [frameResult, newTabResult] = await Promise.allSettled([
              // 检测新 iframe
              this.browserController.waitForNewFrame(undefined, detectTimeout),
              // 检测新标签页
              this.browserController.switchToNewTab(tabUrlsBefore, detectTimeout),
            ]);

            // 处理新 iframe
            const frameCountAfter = this.browserController.getPage()?.frames().length ?? 0;
            if (frameCountAfter > frameCountBefore) {
              console.error(`[nav] New frame(s) detected after click (${frameCountBefore} → ${frameCountAfter})`);
              await this.browserController.waitForDynamicContent(2000);
            } else {
              // 检测跨域 iframe（快速检测，不阻塞）
              try {
                const iframeInfo = await this.browserController.detectCrossOriginIframe();
                if (iframeInfo) {
                  console.error(`[nav] Cross-origin iframe detected: ${iframeInfo.iframeSrc.substring(0, 80)}`);
                  this.clickHandler?.setCrossOriginIframe(iframeInfo);
                  feedbackExtra = `⚠️ 检测到跨域 iframe 内容区域，已建立 CDP 通道可以读取其 DOM。请查看新截图确认是否到达目标。`;
                }
              } catch (iframeErr) {
                console.error(`[nav] Cross-origin iframe detection error:`, iframeErr);
              }
            }

            // 处理新标签页
            if (newTabResult.status === 'fulfilled' && newTabResult.value) {
              switchedToNewTab = true;
              console.error(`[nav] ✅ 检测到新标签页，已自动切换并重新初始化页面组件`);
              await this.initializePageComponents();
            }
          }

          // 减少SPA重新渲染等待时间到500ms（从800ms优化）
          await this.browserController.wait(500);

          let urlAfter = await this.browserController.getCurrentUrl();
          let urlChanged = urlAfter !== urlBefore || switchedToNewTab;
          
          // Capture DOM state after click
          const domAfter = await this.browserController.getPage()?.evaluate(() => {
            const navElements = document.querySelectorAll('nav, aside, [class*="sidebar"], [class*="menu"], [role="navigation"]');
            const navTexts = Array.from(navElements).map(el => (el as HTMLElement).innerText).join('|||');
            
            // 🔥 关键：捕获所有可见的菜单项（包括子菜单）
            const visibleMenuItems: string[] = [];
            const allMenuItems = document.querySelectorAll('nav li, aside li, [class*="menu"] li, [class*="sidebar"] li');
            allMenuItems.forEach(item => {
              const style = window.getComputedStyle(item);
              if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
                const text = (item as HTMLElement).innerText?.trim();
                if (text && text.length > 0 && text.length < 100) {
                  visibleMenuItems.push(text);
                }
              }
            });
            
            const mainText = document.body.innerText.substring(0, 1000);
            return { navTexts, mainText, visibleMenuItems: visibleMenuItems.join('|||') };
          });
          
          const domChanged = (domBefore?.navTexts !== domAfter?.navTexts) || (domBefore?.mainText !== domAfter?.mainText);
          const navMenuChanged = domBefore?.visibleMenuItems !== domAfter?.visibleMenuItems;
          
          // Check if menu expanded (DOM changed)
          if (navMenuChanged && domBefore && domAfter) {
            const beforeItems = domBefore.visibleMenuItems.split('|||').filter(x => x);
            const afterItems = domAfter.visibleMenuItems.split('|||').filter(x => x);
            const newItems = afterItems.filter(item => !beforeItems.includes(item));
            console.error(`[nav] 🎯 Menu expanded! New visible items: ${newItems.slice(0, 5).join(', ')}`);
          }
          
          // Check if menu expanded (DOM changed)
          // If menu expanded, don't try other matching elements (avoid closing the menu)
          // If click succeeded but URL didn't change, try other matching elements
          // BUT: Skip this if menu was expanded (navMenuChanged = true)
          // Also skip if the element text is a list-item link (e.g. "查看详情") — clicking
          // multiple nth matches would open several different hotel pages in sequence.
          // 🔥 新增：如果已经切换到新标签页，也跳过nth匹配
          // 🔥 新增：如果点击的是日期相关元素（入住日期、离店日期），也跳过nth匹配
          const isListItemLink = !isSelector && (
            elementText.includes('查看详情') ||
            elementText.includes('查看') ||
            elementText.includes('详情') ||
            elementText.includes('预订') ||
            elementText.includes('立即预订')
          );
          const isDateField = !isSelector && (
            elementText.includes('入住日期') ||
            elementText.includes('离店日期') ||
            elementText.includes('入住') ||
            elementText.includes('离店') ||
            elementText.includes('日期') ||
            elementText.includes('check-in') ||
            elementText.includes('check-out') ||
            elementText.toLowerCase().includes('date')
          );
          if (clickResult.success && !urlChanged && !navMenuChanged && !isListItemLink && !isDateField && !usedCoordFallback && !switchedToNewTab && elementText) {
            console.error(`[nav] Click succeeded but URL unchanged, trying other matches of "${elementText}"`);

            for (let nth = 1; nth < 5; nth++) {
              console.error(`[nav] Trying ${nth+1}th match...`);
              const nthResult = await this.clickHandler!.clickNthByText(elementText, nth);

              if (nthResult.success) {
                await this.browserController.wait(500);
                const nthUrl = await this.browserController.getCurrentUrl();

                if (nthUrl !== urlBefore) {
                  console.error(`[nav] ${nth+1}th match succeeded! URL changed to: ${nthUrl}`);
                  urlAfter = nthUrl;
                  urlChanged = true;
                  break;
                }
              }
            }
          } else if (isListItemLink && clickResult.success && !urlChanged && !switchedToNewTab) {
            console.error(`[nav] List-item link "${elementText}" clicked but URL unchanged — likely opened in new tab, skipping nth retries`);
          } else if (isDateField && clickResult.success) {
            console.error(`[nav] ✅ Date field "${elementText}" clicked, calendar should be open now, skipping nth match attempts`);
          } else if (navMenuChanged) {
            console.error(`[nav] ✅ Menu expanded detected, skipping nth match attempts to preserve menu state`);
          } else if (switchedToNewTab) {
            console.error(`[nav] ✅ Switched to new tab, skipping nth match attempts`);
          }

          // Build detailed feedback based on what changed
          if (!clickResult.success) {
            feedbackExtra = '元素未找到或不可点击，请尝试其他操作';
          } else if (switchedToNewTab) {
            feedbackExtra = `✅ 已点击"${elementText}"，自动切换到新标签页: ${urlAfter}\n请查看新截图确认是否到达目标页面。`;
          } else if (isDateField) {
            feedbackExtra = `✅ 已点击"${elementText}"，日历应该已弹出。请在下一步使用 select_date 操作选择具体日期。`;
          } else if (isListItemLink && !urlChanged) {
            feedbackExtra = `✅ 已点击"${elementText}"，链接可能在新标签页打开。请判断当前页面是否已是目标页面，如果是请返回 reached=true。`;
          } else if (usedCoordFallback) {
            feedbackExtra = `✅ 已通过视觉坐标点击了"${elementText}"，URL未变化属正常（Tab切换/SPA内部导航），请观察截图确认页面内容是否已切换到目标。`;
          } else if (urlChanged) {
            feedbackExtra = '✅ 页面已跳转到新URL，导航成功';
          } else if (navMenuChanged) {
            // 🔥 新增：专门处理菜单展开的情况
            if (domBefore && domAfter) {
              const beforeItems = domBefore.visibleMenuItems.split('|||').filter(x => x);
              const afterItems = domAfter.visibleMenuItems.split('|||').filter(x => x);
              const newItems = afterItems.filter(item => !beforeItems.includes(item));
              const newItemsPreview = newItems.slice(0, 5).join('、');
              
              feedbackExtra = `⚠️ 检测到导航菜单展开！新出现了 ${newItems.length} 个子菜单项：${newItemsPreview}${newItems.length > 5 ? '...' : ''}\n\n` +
                            '**重要提示：**\n' +
                            '1. 父菜单"' + elementText + '"已成功展开，请不要再点击它\n' +
                            '2. 请仔细查看新截图中的导航菜单区域（通常在左侧）\n' +
                            '3. 从新出现的子菜单项中选择目标项进行点击\n' +
                            '4. 子菜单项通常有缩进或不同的样式，位于父菜单下方';
            } else {
              feedbackExtra = '⚠️ 检测到导航菜单变化，请查看新截图中的菜单区域。';
            }
          } else if (domChanged) {
            // DOM changed but URL didn't - likely SPA navigation
            feedbackExtra = '⚠️ URL未变化，但页面主内容已更新（可能是SPA内部切换）。请查看截图确认是否到达目标页面。';
          } else {
            // Nothing changed - likely clicked wrong element or parent menu without submenu
            feedbackExtra = '❌ 点击后页面无任何变化（URL和内容都未改变）。这可能不是正确的目标元素，请尝试其他操作。';
          }

          this.visionNavigator.addStepFeedback(
            `点击了"${elementText}"`,
            clickResult.success,
            urlAfter,
            feedbackExtra
          );
          context.currentUrl = urlAfter;

        } else if (analysis.nextAction.type === 'input' && analysis.nextAction.inputPlaceholder && analysis.nextAction.inputText) {
          const placeholder = analysis.nextAction.inputPlaceholder;
          const inputText = analysis.nextAction.inputText;
          
          console.error(`[nav] Attempting to input "${inputText}" into field: "${placeholder}"`);
          
          const inputResult = await this.clickHandler!.inputByPlaceholder(placeholder, inputText);
          actionResult = inputResult.success ? 'success' : 'failed';
          
          // Wait for any auto-complete or page updates
          await this.browserController.wait(this.config.crawler.wait_after_action || 800);
          
          const urlAfter = await this.browserController.getCurrentUrl();
          
          if (!inputResult.success) {
            feedbackExtra = `输入框未找到。请确认页面上是否有占位符为"${placeholder}"的输入框，或尝试其他操作。`;
          } else {
            feedbackExtra = `✅ 成功在"${placeholder}"输入框中输入了"${inputText}"。如果有搜索按钮或提交按钮，请点击它以触发搜索。`;
          }
          
          this.visionNavigator.addStepFeedback(
            `在"${placeholder}"输入框中输入了"${inputText}"`,
            inputResult.success,
            urlAfter,
            feedbackExtra
          );
          context.currentUrl = urlAfter;

        } else if (analysis.nextAction.type === 'click_near' && analysis.nextAction.nearText && analysis.nextAction.nearAction) {
          const nearText = analysis.nextAction.nearText;
          const nearAction = analysis.nextAction.nearAction;

          console.error(`[nav] click_near: looking for "${nearAction}" near "${nearText}"`);

          // 记录点击前的标签页快照，用于检测新标签页
          const tabUrlsBefore = this.browserController.getPageUrls();

          // 用 Promise.race 加超时保护：click 可能打开新标签页导致 evaluate 上下文丢失
          let clicked: boolean | undefined = false;
          try {
            clicked = await Promise.race([
              this.browserController.getPage()?.evaluate(
                ({ anchor, btnText }: { anchor: string; btnText: string }) => {
                  const lowerAnchor = anchor.toLowerCase();
                  const lowerBtn = btnText.toLowerCase();

                  const allEls = Array.from(document.querySelectorAll('*')) as HTMLElement[];
                  let anchorEl: HTMLElement | null = null;
                  let bestLen = Infinity;

                  for (const el of allEls) {
                    if (el.children.length > 5) continue;
                    const t = (el.innerText || '').trim().toLowerCase();
                    if (t.includes(lowerAnchor) && t.length < bestLen) {
                      bestLen = t.length;
                      anchorEl = el;
                    }
                  }

                  if (!anchorEl) return false;

                  let container: HTMLElement | null = anchorEl;
                  for (let d = 0; d < 10 && container; d++) {
                    const btn = Array.from(container.querySelectorAll('a, button, [role="button"]'))
                      .find(b => (b as HTMLElement).innerText?.trim().toLowerCase().includes(lowerBtn)) as HTMLElement | null;
                    if (btn) {
                      btn.click();
                      return true;
                    }
                    container = container.parentElement as HTMLElement | null;
                  }
                  return false;
                },
                { anchor: nearText, btnText: nearAction }
              ),
              new Promise<boolean>(resolve => setTimeout(() => {
                console.error(`[nav] click_near evaluate timed out (likely new tab opened)`);
                resolve(true); // 超时视为点击成功（触发了导航）
              }, 8000))
            ]);
          } catch (evalErr) {
            // evaluate 抛异常说明页面导航了 = 点击生效了
            console.error(`[nav] click_near evaluate error (page likely navigated):`, evalErr);
            clicked = true;
          }

          actionResult = clicked ? 'success' : 'failed';
          await this.browserController.wait(this.config.crawler.wait_after_action || 800);

          // 检测是否打开了新标签页，如果是则自动切换
          let switchedToNewTab = false;
          if (clicked) {
            switchedToNewTab = await this.browserController.switchToNewTab(tabUrlsBefore, 3000);
            if (switchedToNewTab) {
              console.error(`[nav] 新标签页已打开，重新初始化页面组件`);
              await this.initializePageComponents();
            }
          }

          const urlAfterNear = await this.browserController.getCurrentUrl();
          this.visionNavigator.addStepFeedback(
            `在"${nearText}"附近点击了"${nearAction}"`,
            !!clicked,
            urlAfterNear,
            clicked
              ? switchedToNewTab
                ? `✅ 已点击"${nearText}"的"${nearAction}"，已自动切换到新标签页: ${urlAfterNear}`
                : `✅ 已点击"${nearText}"的"${nearAction}"，页面URL: ${urlAfterNear}`
              : `❌ 未找到"${nearText}"附近的"${nearAction}"按钮`
          );
          context.currentUrl = urlAfterNear;

        } else if (analysis.nextAction.type === 'scroll') {
          const dir = analysis.nextAction.direction || 'down';
          await this.browserController.scroll(dir as 'up' | 'down' | 'bottom');
          actionResult = 'success';
          await this.browserController.wait(500); // 减少滚动等待时间
          this.visionNavigator.addStepFeedback(
            `向${dir}滚动`,
            true,
            context.currentUrl
          );

        } else if (analysis.nextAction.type === 'select_date' && analysis.nextAction.dateText) {
          const dateText = analysis.nextAction.dateText;
          const fieldType = analysis.nextAction.dateFieldType || 'checkin';

          console.error(`[nav] Selecting date "${dateText}" for ${fieldType}`);

          // Click the calendar cell by precise date matching
          const result = await this.browserController.getPage()?.evaluate((text: string) => {
            const logs: string[] = [];

            // ── Strategy 1: Full date format "YYYY-MM-DD" → use td[title] precise match ──
            const fullDateMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
            if (fullDateMatch) {
              logs.push(`Strategy 1: Full date "${text}", using td[title] selector`);

              // Ant Design / most calendar libs: <td title="2026-03-18">
              const td = document.querySelector(`td[title="${text}"]`) as HTMLElement | null;
              if (td) {
                const cls = td.className || '';
                const rect = td.getBoundingClientRect();
                const rectStr = `(${Math.round(rect.x)},${Math.round(rect.y)},${Math.round(rect.width)}x${Math.round(rect.height)})`;

                if (rect.width <= 0 || rect.height <= 0) {
                  logs.push(`td[title="${text}"] found but invisible ${rectStr}`);
                } else if (cls.includes('disabled')) {
                  logs.push(`td[title="${text}"] found but disabled, class="${cls}"`);
                } else {
                  // Click the inner element (ant-picker-cell-inner) if exists, otherwise click td
                  const inner = td.querySelector('.ant-picker-cell-inner, [class*="cell-inner"], [class*="date-inner"]') as HTMLElement | null;
                  const target = inner || td;
                  logs.push(`✅ Clicking td[title="${text}"] ${rectStr}, class="${cls}"`);
                  target.click();
                  return { success: true, logs, matches: [] };
                }
              } else {
                logs.push(`td[title="${text}"] not found in DOM`);
              }

              // Fallback: try data-date or aria-label attributes
              const byDataDate = document.querySelector(`[data-date="${text}"], [aria-label*="${text}"]`) as HTMLElement | null;
              if (byDataDate) {
                const rect = byDataDate.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                  logs.push(`✅ Clicking [data-date="${text}"] fallback`);
                  byDataDate.click();
                  return { success: true, logs, matches: [] };
                }
              }

              logs.push(`Strategy 1 failed, falling through to Strategy 2`);
            }

            // ── Strategy 2: Fallback for pure number "18" or "18日" (backward compat) ──
            // Only match <td> elements inside calendar containers to avoid clicking random elements
            const dayNum = fullDateMatch ? fullDateMatch[3].replace(/^0/, '') : text.replace(/[日号]/, '');
            logs.push(`Strategy 2: Searching for day number "${dayNum}" in calendar <td> cells`);

            // Narrow scope: only look inside calendar/picker containers
            const calendarContainers = document.querySelectorAll(
              '.ant-picker-dropdown, .ant-picker-panel, [class*="calendar"], [class*="datepicker"], [class*="date-picker"], [role="grid"]'
            );

            if (calendarContainers.length === 0) {
              // No calendar container found, try all <td> as last resort
              logs.push(`No calendar container found, trying all visible <td>`);
            }

            const scope = calendarContainers.length > 0
              ? Array.from(calendarContainers).flatMap(c => Array.from(c.querySelectorAll('td')))
              : Array.from(document.querySelectorAll('td'));

            const matches: Array<{text: string, rect: string, cls: string, reason?: string}> = [];

            for (const el of scope) {
              const t = (el as HTMLElement).innerText?.trim();
              // Match: exact number, or "18日", "18号"
              if (t !== dayNum && t !== `${dayNum}日` && t !== `${dayNum}号`) continue;

              const rect = (el as HTMLElement).getBoundingClientRect();
              const rectStr = `(${Math.round(rect.x)},${Math.round(rect.y)},${Math.round(rect.width)}x${Math.round(rect.height)})`;
              const cls = (el as HTMLElement).className || '';

              if (rect.width <= 0 || rect.height <= 0) {
                matches.push({text: t, rect: rectStr, cls, reason: 'invisible'});
                continue;
              }

              if (cls.includes('disabled') || cls.includes('past') || cls.includes('gray') || cls.includes('unavailable')) {
                matches.push({text: t, rect: rectStr, cls, reason: 'disabled'});
                continue;
              }

              // Prefer "in-view" cells (belong to the displayed month, not overflow)
              if (!cls.includes('in-view') && !cls.includes('in_view') && !cls.includes('current')) {
                // Check if there's a better in-view candidate later
                matches.push({text: t, rect: rectStr, cls, reason: 'not-in-view'});
                continue;
              }

              logs.push(`✅ Clicking calendar td: text="${t}", rect=${rectStr}, class="${cls}"`);
              const inner = (el as HTMLElement).querySelector('.ant-picker-cell-inner, [class*="cell-inner"]') as HTMLElement | null;
              (inner || el as HTMLElement).click();
              return { success: true, logs, matches };
            }

            // If no in-view cell found, try the first non-disabled match
            const fallbackMatch = matches.find(m => !m.reason || m.reason === 'not-in-view');
            if (fallbackMatch) {
              // Re-find and click it
              for (const el of scope) {
                const t = (el as HTMLElement).innerText?.trim();
                if (t !== dayNum && t !== `${dayNum}日` && t !== `${dayNum}号`) continue;
                const rect = (el as HTMLElement).getBoundingClientRect();
                if (rect.width <= 0 || rect.height <= 0) continue;
                const cls = (el as HTMLElement).className || '';
                if (cls.includes('disabled') || cls.includes('past') || cls.includes('gray') || cls.includes('unavailable')) continue;
                logs.push(`✅ Clicking fallback td (not-in-view): text="${t}", class="${cls}"`);
                const inner = (el as HTMLElement).querySelector('.ant-picker-cell-inner, [class*="cell-inner"]') as HTMLElement | null;
                (inner || el as HTMLElement).click();
                return { success: true, logs, matches };
              }
            }

            logs.push(`❌ No valid date cell found for "${text}"`);
            return { success: false, logs, matches };
          }, dateText);

          // 输出调试日志
          if (result) {
            console.error(`[date-select] ${result.logs.join('\n[date-select] ')}`);
            if (result.matches.length > 0) {
              console.error(`[date-select] Found ${result.matches.length} candidates:`);
              result.matches.forEach((m, i) => {
                console.error(`[date-select]   [${i}] text="${m.text}" rect=${m.rect} class="${m.cls}" ${m.reason ? `(${m.reason})` : ''}`);
              });
            }
          }

          const clicked = result?.success || false;
          actionResult = clicked ? 'success' : 'failed';
          await this.browserController.wait(this.config.crawler.wait_after_action || 800);
          const urlAfter = await this.browserController.getCurrentUrl();
          this.visionNavigator.addStepFeedback(
            `在日历中点击了日期 "${dateText}"（${fieldType}）`,
            !!clicked,
            urlAfter,
            clicked ? `✅ 日期 ${dateText} 已选中` : `❌ 未找到日期 ${dateText} 的日历格子，请检查日历是否已弹出`
          );
          context.currentUrl = urlAfter;

        } else if (analysis.nextAction.type === 'wait') {
          await this.browserController.wait(analysis.nextAction.waitTime || 1000); // 减少默认等待时间
          actionResult = 'success';
          this.visionNavigator.addStepFeedback('等待页面加载', true, context.currentUrl);
        }
      } catch (error) {
        actionResult = 'error';
        feedbackExtra = `执行出错: ${error instanceof Error ? error.message : String(error)}`;
        this.visionNavigator.addStepFeedback(
          `操作 ${analysis.nextAction.type}`,
          false,
          context.currentUrl,
          feedbackExtra
        );
      }

      const urlAfter = await this.browserController.getCurrentUrl();

      // Record step
      const navStep: NavigationStep = {
        step,
        screenshot: screenshotUrl,
        analysis,
        action: {
          type: analysis.nextAction.type,
          target: analysis.nextAction.elementText,
          result: actionResult,
        },
        urlBefore,
        urlAfter,
        timestamp: Date.now(),
      };

      navigationPath.push(navStep);
      context.history.push(navStep);
      context.currentUrl = urlAfter;
    }

    return false;
  }

  /**
   * Expand page content
   */
  private async expandPage(maxSteps: number, progressCallback?: ProgressCallback): Promise<void> {
    progressCallback?.({ phase: 'expanding', message: 'Checking for expandable content...' });

    // 🔥 Strategy 1: DOM detection first (fast, accurate, free)
    // expandContent() will re-detect internally in a loop, so just kick it off.
    console.error('[expand] Step 1: Trying DOM detection for expandable elements...');
    const domElements = await this.pageAnalyzer!.detectAccordions();

    if (domElements.length > 0) {
      console.error(`[expand] ✅ DOM detected ${domElements.length} expandable elements:`,
        domElements.map(e => e.text).join(', '));
      // Pass no initialElements — expandContent will loop and re-detect on its own
      await this.pageAnalyzer!.expandContent([], maxSteps);
    } else {

      console.error('[expand] DOM detection found nothing, trying vision-based detection...');

      // 🔥 Strategy 2: Vision-based detection (fallback, uses LLM)
      console.error('[expand] Step 2: Using vision-based completeness check...');
      const screenshot = await this.browserController.screenshot(undefined, false);
      const check = await this.pageAnalyzer!.checkCompleteness(screenshot);

      if (!check.isComplete && check.expandableElements.length > 0) {
        console.error(`[expand] ✅ Vision detected ${check.expandableElements.length} expandable elements:`,
          check.expandableElements.map(e => e.text).join(', '));
        // Pass vision-detected elements as seeds; expandContent will also loop for more
        await this.pageAnalyzer!.expandContent(check.expandableElements, maxSteps);
      } else {
        console.error('[expand] Page content is complete, no expansion needed');
      }
    }

    // 🔥 展开结束后滚动回顶部，确保提取阶段从页面顶部开始
    console.error('[expand] 滚动回顶部...');
    const page = this.browserController.getPage();
    if (page) {
      // 滚动 window 和所有内部滚动容器回顶部
      await page.evaluate(() => {
        window.scrollTo({ top: 0, behavior: 'instant' });
        // 找到所有可滚动容器并重置到顶部
        const allEls = document.querySelectorAll('*');
        for (const el of allEls) {
          if (el === document.documentElement || el === document.body) continue;
          const style = getComputedStyle(el);
          if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && el.scrollTop > 0) {
            el.scrollTo({ top: 0, behavior: 'instant' });
          }
        }
      });
      await this.browserController.wait(500);
    }
    console.error('[expand] 已滚动回顶部');
  }


  /**
   * 在页面 DOM 中找到面积最大的可滚动容器（overflow auto/scroll），
   * 返回其在视口中的中心坐标。
   * 找不到时回退到视口中心。
   */
  private async findMainScrollableCenter(): Promise<{ x: number; y: number }> {
    const page = this.browserController.getPage();
    const viewport = page?.viewportSize();
    const vw = viewport?.width ?? 1280;
    const vh = viewport?.height ?? 800;
    const fallback = { x: vw / 2, y: vh / 2 };

    if (!page) return fallback;

    const result = await page.evaluate(() => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      // 🔥 优先检查大iframe（美团等后台）
      const iframes = Array.from(document.querySelectorAll('iframe'));
      const bigIframe = iframes.find(f => {
        const r = f.getBoundingClientRect();
        return r.width > vw * 0.5 && r.height > vh * 0.7;
      });
      
      if (bigIframe) {
        const r = bigIframe.getBoundingClientRect();
        return {
          x: (Math.max(r.left, 0) + Math.min(r.right, vw)) / 2,
          y: (Math.max(r.top, 0) + Math.min(r.bottom, vh)) / 2,
        };
      }

      // 候选条件：
      // 1. overflow-y 为 auto 或 scroll
      // 2. 实际可滚动（scrollHeight > clientHeight）或面积足够大
      // 3. 在视口内可见（getBoundingClientRect 与视口有交集）
      // 4. 排除 document.documentElement 和 document.body（留作兜底）
      const candidates = Array.from(document.querySelectorAll('*')).filter(el => {
        if (el === document.documentElement || el === document.body) return false;
        const style = getComputedStyle(el);
        const overflowY = style.overflowY;
        if (overflowY !== 'auto' && overflowY !== 'scroll') return false;
        const rect = el.getBoundingClientRect();
        // 必须与视口有交集
        if (rect.right <= 0 || rect.bottom <= 0 || rect.left >= vw || rect.top >= vh) return false;
        // 可见面积必须大于视口的 10%
        const visibleW = Math.min(rect.right, vw) - Math.max(rect.left, 0);
        const visibleH = Math.min(rect.bottom, vh) - Math.max(rect.top, 0);
        return visibleW * visibleH > vw * vh * 0.1;
      });

      if (candidates.length === 0) return null;

      // 优先选实际可滚动的容器（scrollHeight > clientHeight），
      // 避免选到有 overflow:auto 但不可滚动的外层容器
      const scrollable = candidates.filter(el => el.scrollHeight > el.clientHeight + 1);
      const pool = scrollable.length > 0 ? scrollable : candidates;

      // 取视口内可见面积最大的候选
      const best = pool.reduce((a, b) => {
        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();
        const areaA = (Math.min(ra.right, vw) - Math.max(ra.left, 0)) *
                      (Math.min(ra.bottom, vh) - Math.max(ra.top, 0));
        const areaB = (Math.min(rb.right, vw) - Math.max(rb.left, 0)) *
                      (Math.min(rb.bottom, vh) - Math.max(rb.top, 0));
        return areaA >= areaB ? a : b;
      });

      const r = best.getBoundingClientRect();
      return {
        x: (Math.max(r.left, 0) + Math.min(r.right, vw)) / 2,
        y: (Math.max(r.top, 0) + Math.min(r.bottom, vh)) / 2,
      };
    });

    if (result) {
      console.error(`[scroll-load] 主滚动容器中心：(${result.x.toFixed(0)}, ${result.y.toFixed(0)})`);
      
      // 输出iframe调试信息
      try {
        const iframeDebug = await page.evaluate(() => {
          const iframes = Array.from(document.querySelectorAll('iframe'));
          return iframes.map(f => {
            const r = f.getBoundingClientRect();
            return {
              width: Math.round(r.width),
              height: Math.round(r.height),
              left: Math.round(r.left),
              top: Math.round(r.top),
              widthRatio: (r.width / window.innerWidth).toFixed(2),
              heightRatio: (r.height / window.innerHeight).toFixed(2)
            };
          });
        });
        if (iframeDebug.length > 0) {
          console.error(`[scroll-center] Found ${iframeDebug.length} iframe(s):`);
          iframeDebug.forEach((info, i) => {
            console.error(`[scroll-center]   [${i}] ${info.width}x${info.height} at (${info.left},${info.top}) ratio: ${info.widthRatio}x${info.heightRatio}`);
          });
        }
      } catch (e) {}
      
      return result;
    }

    // 兜底：视口中心
    console.error('[scroll-load] 未找到可滚动容器，回退到视口中心');
    return fallback;
  }

  /**
   * 将鼠标移到主内容区中央，避免滚轮事件作用在侧边菜单等非主区域。
   * 通过 DOM 动态查找面积最大的可滚动容器，不依赖硬编码坐标。
   */
  private async moveMouseToMainContent(): Promise<void> {
    const page = this.browserController.getPage();
    if (!page) return;

    const { x, y } = await this.findMainScrollableCenter();

    // 加小随机偏移，避免每次落在完全相同的像素点
    const jitterX = (Math.random() - 0.5) * 40;
    const jitterY = (Math.random() - 0.5) * 40;

    await page.mouse.move(x + jitterX, y + jitterY, { steps: 5 });
  }

  /**
   * 用 mouse.wheel 模拟真实鼠标滚轮事件（isTrusted=true），
   * 将一次大步长拆成多个小 tick，并加入 easing 曲线和随机抖动，
   * 使滚动行为接近人类。
   * 调用前会先将鼠标定位到主内容区，避免滚动作用到侧边菜单。
   */
  private async humanWheelScroll(deltaY: number): Promise<void> {
    const page = this.browserController.getPage();
    if (!page) return;

    // 每次滚动前先把鼠标移到主内容区中央
    await this.moveMouseToMainContent();

    // 每个 tick 的基础像素量（鼠标滚轮一格约 100px）
    const TICK_PX = 100;
    const ticks = Math.ceil(Math.abs(deltaY) / TICK_PX);
    const direction = deltaY > 0 ? 1 : -1;

    for (let t = 0; t < ticks; t++) {
      // easeInOutSine：前后慢、中间快，模拟真实滚轮手感
      const progress = t / ticks;
      const eased = 0.5 - Math.cos(Math.PI * progress) / 2;
      const nextProgress = (t + 1) / ticks;
      const nextEased = 0.5 - Math.cos(Math.PI * nextProgress) / 2;
      const tickDelta = (nextEased - eased) * Math.abs(deltaY);

      // 随机抖动 ±15%，避免完全均匀
      const jitter = 1 + (Math.random() - 0.5) * 0.3;
      await page.mouse.wheel(0, direction * tickDelta * jitter);

      // tick 间隔：16~32ms（模拟 60fps 下人手速度）
      await this.browserController.wait(16 + Math.floor(Math.random() * 16));
    }
  }

  /**
   * 滚动回顶部（不截图、不提取DOM）
   */
  private async scrollBackToTop(cdpSession: any, iframeContextId: number | null): Promise<void> {
    const page = this.browserController.getPage();
    if (!page) return;

    // 如果有iframe CDP连接，在iframe内滚动
    if (cdpSession && iframeContextId) {
      try {
        await cdpSession.send('Runtime.evaluate', {
          expression: 'window.scrollTo({ top: 0, behavior: "smooth" })',
          contextId: iframeContextId
        });
        await this.browserController.wait(800);
        return;
      } catch (e) {
        console.error(`[scroll-back] CDP iframe scroll error:`, e);
      }
    }

    // 否则滚动主文档
    await page.evaluate(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    await this.browserController.wait(800);
  }

  /**
   * Progressively scroll the page to trigger lazy-loaded content.
   * Uses mouse.wheel (isTrusted=true) + easing + randomization to mimic human scrolling.
   * After each scroll step, captures a viewport screenshot and DOM snapshot so that
   * content rendered mid-scroll (and potentially recycled by virtual lists) is preserved.
   *
   * Returns accumulated screenshots (viewport, one per step) and merged DOM content.
   */
  private async scrollToLoadAll(): Promise<{ screenshots: Buffer[]; domContent: DOMContent }> {
    const page = this.browserController.getPage();

    const accScreenshots: Buffer[] = [];
    const accDom: DOMContent = { text: [], tables: [], dataAttributes: [], semanticAttributes: [], selectOptions: [] };

    // 用唯一文本 Set 追踪真正新增的内容，用于判断是否还有新数据
    // accDom 仍然保留所有文本（含重复短文本），供 LLM 提取用
    const seenTexts = new Set<string>();

    const mergeDom = (fresh: DOMContent) => {
      accDom.text.push(...fresh.text);
      accDom.tables.push(...fresh.tables);
      accDom.dataAttributes.push(...fresh.dataAttributes);
      accDom.semanticAttributes.push(...fresh.semanticAttributes);
      accDom.selectOptions.push(...fresh.selectOptions);
      // 同步更新唯一文本集合，用于停止条件判断
      fresh.text.forEach(t => seenTexts.add(t));
    };

    if (!page) return { screenshots: accScreenshots, domContent: accDom };

    // 🔥 强制所有滚动容器回到顶部，确保从头开始采集
    await page.evaluate(() => {
      window.scrollTo({ top: 0, behavior: 'instant' });
      for (const el of document.querySelectorAll('*')) {
        if (el === document.documentElement || el === document.body) continue;
        const style = getComputedStyle(el);
        if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && el.scrollTop > 0) {
          el.scrollTo({ top: 0, behavior: 'instant' });
        }
      }
    });
    await this.browserController.wait(300);

    // ✅ 修复 Bug1：先采集初始状态（第0屏），再开始滚动
    // 原逻辑截图在滚动之后才拍，导致页面顶部内容从未被截图覆盖
    const initialShot = await this.browserController.screenshot(undefined, false);
    accScreenshots.push(initialShot);
    const initialShotUrl = await this.screenshotManager.save(initialShot, {
      step: 0, label: 'scroll-initial', size: initialShot.length, timestamp: Date.now(), compressed: false,
    });
    console.error(`[scroll-load] 初始截图已保存：${initialShotUrl}`);
    const initialDom = await this.domExtractor!.extractContent();
    mergeDom(initialDom);

    const HARD_MAX_ROUNDS = 30; // 绝对上限，防止无限循环
    const MIN_STEP_PX = 250; // 最小步长估算
    const MAX_CONTENT_STABLE_ROUNDS = 5; // 内容连续不变的最大轮数

    let lastHeight = 0;
    let lastUniqueSize = seenTexts.size; // ✅ 用唯一文本数量判断是否有新内容，而非累积总量
    let stableRounds = 0; // 连续无法滚动的轮数
    let contentStableRounds = 0; // 内容连续不变的轮数（即使滚动成功）
    let maxRounds = HARD_MAX_ROUNDS; // 首轮后根据容器高度动态调整
    let cdpSession: any = null; // CDP session for iframe scrolling
    let iframeFrameId: string | null = null; // iframe frameId for CDP scrolling
    let iframeContextId: number | null = null; // iframe execution context ID

    for (let i = 0; i < maxRounds; i++) {
      // 1. 获取滚动位置
      let scrollInfo: any = null;
      
      // 🔥 如果已经建立了iframe CDP连接，直接使用它获取滚动信息
      if (iframeContextId && cdpSession) {
        try {
          const { result } = await cdpSession.send('Runtime.evaluate', {
            expression: `({
              scrollTop: window.pageYOffset || document.documentElement.scrollTop,
              scrollHeight: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
              clientHeight: window.innerHeight,
              source: 'iframe-cdp'
            })`,
            contextId: iframeContextId,
            returnByValue: true
          });
          scrollInfo = result.value;
        } catch (e) {
          console.error(`[scroll-detect] CDP iframe info error:`, e);
          iframeContextId = null; // 重置，下次重新检测
        }
      }
      
      // 如果没有CDP连接，按原逻辑检测
      if (!scrollInfo) {
        // 🔥 优先检查大iframe（跨域iframe需要用frame API）
        const frames = page.frames();
        console.error(`[scroll-detect] Total frames: ${frames.length}`);
        
        for (const frame of frames) {
          if (frame === page.mainFrame()) continue;
          
          try {
            const url = frame.url();
            console.error(`[scroll-detect] Checking frame: ${url}`);
            
            const frameElement = await frame.frameElement();
            if (!frameElement) {
              console.error(`[scroll-detect] Frame has no element`);
              continue;
            }
            
            const rect = await frameElement.boundingBox();
            if (!rect) {
              console.error(`[scroll-detect] Frame has no boundingBox`);
              continue;
            }
          
          const vw = page.viewportSize()?.width || 1280;
          const vh = page.viewportSize()?.height || 800;
          
          console.error(`[scroll-detect] Frame rect: ${rect.width}x${rect.height}, threshold: ${vw * 0.5}x${vh * 0.7}`);
          
          // 主内容iframe：宽度>50%且高度>70%
          if (rect.width < vw * 0.5 || rect.height < vh * 0.7) {
            console.error(`[scroll-detect] Frame too small, skipping`);
            continue;
          }
          
          console.error(`[scroll-detect] Found large iframe, getting scrollHeight...`);
          
          scrollInfo = await frame.evaluate(() => {
            const vh = window.innerHeight;
            const body = document.documentElement || document.body;
            return {
              scrollHeight: body.scrollHeight,
              scrollTop: body.scrollTop,
              clientHeight: vh,
              source: 'iframe',
            };
          });
          
          console.error(`[scroll-detect] iframe scrollHeight: ${scrollInfo.scrollHeight}`);
          if (scrollInfo) break;
        } catch (e) {
          console.error(`[scroll-detect] Frame check error:`, e);
        }
      }
      
      // 没有找到iframe，检测主文档
      if (!scrollInfo) {
        console.error(`[scroll-detect] No iframe found, using main document`);
        scrollInfo = await page.evaluate(() => {
          const vw = window.innerWidth;
          const vh = window.innerHeight;
          
          // 主文档滚动容器检测
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
        
        const scrollable = candidates.filter(el => el.scrollHeight > el.clientHeight + 1);
        const largeScrollable = scrollable.filter(el => (el.scrollHeight - el.clientHeight) > 200);
        
        // 🔥 如果找到大容器，使用它；否则回退到window/documentElement
        if (largeScrollable.length > 0) {
          const best = largeScrollable.sort((a, b) => 
            (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight)
          )[0];
          console.log('[scroll-detect] Found large container:', best.className || best.tagName, 'scrollable:', best.scrollHeight - best.clientHeight);
          return {
            scrollHeight: best.scrollHeight,
            scrollTop: best.scrollTop,
            clientHeight: best.clientHeight,
            source: 'container',
          };
        }
        
        // 🔥 回退：使用documentElement（整个页面滚动）
        const docScrollable = Math.max(
          document.documentElement.scrollHeight - document.documentElement.clientHeight,
          document.body.scrollHeight - window.innerHeight
        );
        
        console.log('[scroll-detect] Using documentElement, scrollable:', docScrollable);
        return {
          scrollHeight: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
          scrollTop: window.pageYOffset || document.documentElement.scrollTop,
          clientHeight: window.innerHeight,
          source: 'window',
        };
        });
      }
      } // 闭合 if (!scrollInfo)
      
      if (i === 0) {
        console.error(`[scroll-load] 高度检测来源: ${scrollInfo.source}，容器高度 ${scrollInfo.scrollHeight}px`);
        // 根据容器实际高度动态计算需要的滚动轮数
        const scrollRange = scrollInfo.scrollHeight - scrollInfo.clientHeight;
        const estimatedRounds = Math.ceil(scrollRange / MIN_STEP_PX) + 3; // +3 留缓冲
        maxRounds = Math.min(Math.max(estimatedRounds, 3), HARD_MAX_ROUNDS);
        console.error(`[scroll-load] 滚动范围 ${scrollRange}px，预估需要 ${estimatedRounds} 轮，maxRounds=${maxRounds}`);
      }

      const currentHeight = scrollInfo.scrollHeight;
      const currentScroll = scrollInfo.scrollTop;
      const viewportHeight = scrollInfo.clientHeight;

      // 记录高度/文本是否变化，但不在此处递增 stableRounds
      // stableRounds 统一在滚动结果判定后处理
      const uniqueSizeChanged = seenTexts.size !== lastUniqueSize;
      const heightChanged = currentHeight !== lastHeight;
      const contentStable = !heightChanged && !uniqueSizeChanged;

      if (!contentStable) {
        lastHeight = currentHeight;
        lastUniqueSize = seenTexts.size;
      }

      // 已到底部检测：scrollTop + clientHeight >= scrollHeight - 100
      const isNearBottom = (currentScroll + viewportHeight) >= (currentHeight - 100);
      if (isNearBottom && contentStable) {
        // 到底部且没有新内容加载，直接停止（无需等 stableRounds）
        console.error(`[scroll-load] 已滚动到底部且内容稳定（${currentScroll + viewportHeight}/${currentHeight}），停止滚动`);
        // 最后再截一张图确保底部内容被捕获
        const shot = await this.browserController.screenshot(undefined, false);
        accScreenshots.push(shot);
        const shotUrl = await this.screenshotManager.save(shot, {
          step: i + 1, label: 'scroll-bottom', size: shot.length, timestamp: Date.now(), compressed: false,
        });
        console.error(`[scroll-load] 底部截图已保存：${shotUrl}`);
        const dom = await this.domExtractor!.extractContent();
        mergeDom(dom);
        break;
      } else if (isNearBottom) {
        console.error(`[scroll-load] 已到底部（${currentScroll + viewportHeight}/${currentHeight}），但内容仍在变化，继续等待`);
      }

      const scrollTopBefore = currentScroll;

      // 3. 随机步长：150~300px，模拟正常浏览节奏
      const stepPx = 300 + Math.floor(Math.random() * 50);

      // 4. 用 mouse.wheel 模拟真实滚轮事件（isTrusted=true）
      await this.humanWheelScroll(stepPx);

      // 5. 等待动态内容渲染（networkidle + MutationObserver）
      await this.browserController.waitForDynamicContent(2000);

      // 6. 随机停顿 100~200ms，模拟人类阅读/浏览节奏
      const pauseMs = 100 + Math.floor(Math.random() * 100);
      await this.browserController.wait(pauseMs);

      // 7. 额外阅读停顿已移除，保持固定节奏
      // if (Math.random() < 0.2) {
      //   const readMs = 300 + Math.floor(Math.random() * 200);
      //   console.error(`[scroll-load] 模拟阅读停顿 ${readMs}ms`);
      //   await this.browserController.wait(readMs);
      // }

      // 8. 采集当前视口截图 + DOM 快照，防止虚拟列表回收已渲染内容
      const shot = await this.browserController.screenshot(undefined, false); // 视口截图
      accScreenshots.push(shot);
      const shotUrl = await this.screenshotManager.save(shot, {
        step: i + 1, label: 'scroll-step', size: shot.length, timestamp: Date.now(), compressed: false,
      });
      console.error(`[scroll-load] 截图已保存：${shotUrl}`);
      const dom = await this.domExtractor!.extractContent();
      mergeDom(dom);

      // 检查 wheel 后 scrollTop 是否实际移动了
      const scrollTopAfter = await page.evaluate(() => {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const candidates = Array.from(document.querySelectorAll('*')).filter(el => {
          if (el === document.documentElement || el === document.body) return false;
          const style = getComputedStyle(el);
          const oy = style.overflowY;
          if (oy !== 'auto' && oy !== 'scroll') return false;
          const rect = el.getBoundingClientRect();
          if (rect.right <= 0 || rect.bottom <= 0 || rect.left >= vw || rect.top >= vh) return false;
          return true;
        });
        const scrollable = candidates.filter(el => el.scrollHeight > el.clientHeight + 1);
        const pool = scrollable.length > 0 ? scrollable : candidates;
        const best = pool.sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
        return best ? best.scrollTop : (window.pageYOffset || document.documentElement.scrollTop);
      });
      let didScroll = Math.abs(scrollTopAfter - scrollTopBefore) > 1;

      // wheel 事件未能滚动时，回退到 JS programmatic scroll
      // 常见原因：sticky/fixed 元素拦截了 wheel 事件
      if (!didScroll) {
        console.error(`[scroll-load] ⚠️ wheel 未生效，尝试 JS programmatic scroll fallback`);
        
        // 🔥 先检测是否有大iframe（跨域iframe无法通过contentDocument访问）
        const hasLargeIframe = await page.evaluate(() => {
          const vw = window.innerWidth;
          const vh = window.innerHeight;
          const iframes = Array.from(document.querySelectorAll('iframe'));
          return iframes.some(f => {
            const r = f.getBoundingClientRect();
            return r.width > vw * 0.5 && r.height > vh * 0.7;
          });
        });
        
        if (hasLargeIframe) {
          // 🔥 有大iframe：使用CDP直接滚动
          console.error(`[scroll-load] 检测到大iframe，使用CDP直接滚动`);
          
          try {
            // 如果还没有CDP session，创建一个
            if (!cdpSession) {
              cdpSession = await page.context().newCDPSession(page);
            }
            
            // 获取所有frame的tree
            const { frameTree } = await cdpSession.send('Page.getFrameTree');
            console.error(`[scroll-load] CDP检测到 ${frameTree.childFrames?.length || 0} 个子frame`);
            
            let scrolled = false;
            
            // 遍历所有子frame
            if (frameTree.childFrames && frameTree.childFrames.length > 0) {
              for (const childFrame of frameTree.childFrames) {
                try {
                  const frameId = childFrame.frame.id;
                  
                  // 如果还没有execution context，创建一个
                  if (!iframeContextId || iframeFrameId !== frameId) {
                    const { executionContextId } = await cdpSession.send('Page.createIsolatedWorld', {
                      frameId,
                      worldName: 'scroll-world'
                    });
                    iframeContextId = executionContextId;
                    iframeFrameId = frameId;
                  }
                  
                  // 在iframe内执行滚动
                  const { result } = await cdpSession.send('Runtime.evaluate', {
                    expression: `
                      (function(scrollAmount) {
                        window.scrollBy({ top: scrollAmount, behavior: 'smooth' });
                        return {
                          scrollTop: window.pageYOffset || document.documentElement.scrollTop,
                          scrollHeight: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
                          clientHeight: window.innerHeight
                        };
                      })(${stepPx})
                    `,
                    contextId: iframeContextId,
                    returnByValue: true
                  });
                  
                  if (result.value) {
                    await this.browserController.wait(500);
                    const scrollTopFinal = result.value.scrollTop;
                    didScroll = Math.abs(scrollTopFinal - scrollTopBefore) > 1;
                    
                    if (didScroll) {
                      console.error(`[scroll-load] ✓ CDP iframe scroll 成功（${scrollTopBefore.toFixed(0)} → ${scrollTopFinal.toFixed(0)}）`);
                      if (i === 0) {
                        const realScrollRange = result.value.scrollHeight - result.value.clientHeight;
                        const estimatedRounds = Math.ceil(realScrollRange / 250) + 3;
                        maxRounds = Math.min(Math.max(estimatedRounds, 3), 30);
                        console.error(`[scroll-load] 🔥 iframe真实高度: ${result.value.scrollHeight}px，更新maxRounds=${maxRounds}`);
                      }
                      scrolled = true;
                      break;
                    }
                  }
                } catch (frameErr) {
                  console.error(`[scroll-load] CDP frame scroll error:`, frameErr);
                }
              }
            }
            
            if (!scrolled) {
              console.error(`[scroll-load] ✗ CDP iframe scroll 失败`);
            }
          } catch (cdpErr) {
            console.error(`[scroll-load] CDP session error:`, cdpErr);
          }
        } else {
          // 🔥 无大iframe：使用原有的主文档滚动逻辑
          const scrollTopAfterJs = await page.evaluate((scrollAmount) => {
            const vw = window.innerWidth;
            const vh = window.innerHeight;
            
            const candidates = Array.from(document.querySelectorAll('*')).filter(el => {
              if (el === document.documentElement || el === document.body) return false;
              const style = getComputedStyle(el);
              const oy = style.overflowY;
              if (oy !== 'auto' && oy !== 'scroll') return false;
              const rect = el.getBoundingClientRect();
              if (rect.right <= 0 || rect.bottom <= 0 || rect.left >= vw || rect.top >= vh) return false;
              return true;
            });
            const scrollable = candidates.filter(el => el.scrollHeight > el.clientHeight + 1);
            const pool = scrollable.length > 0 ? scrollable : candidates;
            const best = pool.sort((a, b) => b.scrollHeight - a.scrollHeight)[0];

            if (best) {
              best.scrollBy({ top: scrollAmount, behavior: 'smooth' });
              return { scrollTop: best.scrollTop, scrollHeight: best.scrollHeight, clientHeight: best.clientHeight };
            } else {
              window.scrollBy({ top: scrollAmount, behavior: 'smooth' });
              return { 
                scrollTop: window.pageYOffset || document.documentElement.scrollTop,
                scrollHeight: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
                clientHeight: window.innerHeight
              };
            }
          }, stepPx);

          await this.browserController.wait(500);
          const scrollTopFinal = scrollTopAfterJs.scrollTop;
          didScroll = Math.abs(scrollTopFinal - scrollTopBefore) > 1;
          
          if (didScroll) {
            console.error(`[scroll-load] ✓ JS scroll 成功（${scrollTopBefore.toFixed(0)} → ${scrollTopFinal.toFixed(0)}）`);
            if (i === 0 && scrollTopAfterJs.scrollHeight > scrollInfo.scrollHeight) {
              const realScrollRange = scrollTopAfterJs.scrollHeight - scrollTopAfterJs.clientHeight;
              const estimatedRounds = Math.ceil(realScrollRange / 250) + 3;
              maxRounds = Math.min(Math.max(estimatedRounds, 3), 30);
              console.error(`[scroll-load] 🔥 检测到真实高度: ${scrollTopAfterJs.scrollHeight}px，更新maxRounds=${maxRounds}`);
            }
          } else {
            console.error(`[scroll-load] ✗ JS scroll 也未生效（${scrollTopBefore.toFixed(0)} → ${scrollTopFinal.toFixed(0)}）`);
          }
        }
      }

      // 统一 stableRounds 判定：
      // - 滚动成功 → 重置 stableRounds（还有更多视口内容待截图）
      // - 滚动失败 → 递增 stableRounds，连续3轮滚不动就停
      if (didScroll) {
        stableRounds = 0;
      } else {
        stableRounds++;
        console.error(`[scroll-load] ⚠️ wheel+JS 均未滚动，stableRounds=${stableRounds}`);
        if (stableRounds >= 3) {
          console.error(`[scroll-load] 连续 ${stableRounds} 轮无实际滚动，停止`);
          break;
        }
      }

      // 内容稳定性检查：只有在接近底部时才允许因内容稳定而停止
      // 未到底部时继续滚动，确保截取所有视口内容
      if (contentStable) {
        contentStableRounds++;
        if (contentStableRounds >= MAX_CONTENT_STABLE_ROUNDS && isNearBottom) {
          console.error(`[scroll-load] 内容连续 ${contentStableRounds} 轮无变化且已接近底部（高度=${currentHeight}px, 唯一文本=${seenTexts.size}），停止`);
          break;
        }
      } else {
        contentStableRounds = 0;
      }

      console.error(`[scroll-load] 第${i + 1}轮：高度 ${currentHeight}px → wheel ${stepPx}px，停顿 ${pauseMs}ms，唯一文本 ${seenTexts.size} 条 / 累积 ${accDom.text.length} 行`);
    }

    // 最终：滚动结束，无需全页截图，视口截图已在每步采集完毕
    console.error(`[scroll-load] 完成：共 ${accScreenshots.length} 张截图，${seenTexts.size} 条唯一文本 / ${accDom.text.length} 行累积`);
    
    // 🔥 滚动回顶部，方便下一轮导航
    console.error(`[scroll-load] 开始滚动回顶部...`);
    await this.scrollBackToTop(cdpSession, iframeContextId);
    console.error(`[scroll-load] 已滚动回顶部`);
    
    // 清理CDP session
    if (cdpSession) {
      try {
        await cdpSession.detach();
      } catch (e) {
        // Ignore cleanup errors
      }
    }
    
    return { screenshots: accScreenshots, domContent: accDom };
  }

  /**
   * Extract data from page
   */
  private async extractData(goal: string, progressCallback?: ProgressCallback): Promise<ExtractedData> {
    progressCallback?.({ phase: 'extracting', message: 'Extracting data...' });

    // Scroll to load all content, collecting per-step screenshots + DOM snapshots
    const { screenshots, domContent } = await this.scrollToLoadAll();

    // Get network data
    const networkData = this.networkMonitor!.getCapturedData().map(r => r.response);

    // Extract data — pass all viewport screenshots so LLM sees the full page
    const data = await this.dataExtractor.extract({
      goal,
      screenshots,
      domContent,
      networkData,
    });

    // 🎉 Log extraction success with detailed information
    if (data && data.data !== null) {
      console.error('\n' + '='.repeat(80));
      console.error('🎉 数据提取成功！');
      console.error('='.repeat(80));
      console.error(`📊 提取策略: ${this.getStrategyName(data.strategy)}`);
      console.error(`🎯 置信度: ${(data.confidence * 100).toFixed(1)}%`);
      console.error(`📦 数据量: ${this.getDataSize(data.data)}`);
      console.error(`📝 数据摘要: ${this.getDataSummary(data.data)}`);
      console.error(`📂 输出路径: ${process.cwd()}`);
      console.error('='.repeat(80) + '\n');
    }

    return data;
  }

  /**
   * Get human-readable strategy name
   */
  private getStrategyName(strategy: string): string {
    const names: Record<string, string> = {
      'dom_screenshot': 'DOM + 截图融合（最准确）',
      'dom_only': 'DOM 提取（中等准确度）',
      'network_json': '网络 API 数据（快速）',
      'screenshot_only': '纯截图分析（兜底）',
    };
    return names[strategy] || strategy;
  }

  /**
   * Get data size description
   */
  private getDataSize(data: any): string {
    if (data === null || data === undefined) return '0 项';
    if (Array.isArray(data)) return `${data.length} 项`;
    if (typeof data === 'object') {
      const keys = Object.keys(data);
      if (keys.length === 0) return '空对象';
      // Check if it's a wrapper object with array inside
      const arrayKeys = keys.filter(k => Array.isArray(data[k]));
      if (arrayKeys.length > 0) {
        const totalItems = arrayKeys.reduce((sum, k) => sum + data[k].length, 0);
        return `${totalItems} 项（${arrayKeys.length} 个数组）`;
      }
      return `${keys.length} 个字段`;
    }
    return '1 项';
  }

  /**
   * Get data summary (first few items or keys)
   */
  private getDataSummary(data: any): string {
    if (data === null || data === undefined) return '无数据';
    
    if (Array.isArray(data)) {
      if (data.length === 0) return '空数组';
      const preview = data.slice(0, 3).map(item => {
        if (typeof item === 'object' && item !== null) {
          const keys = Object.keys(item);
          return `{${keys.slice(0, 3).join(', ')}${keys.length > 3 ? '...' : ''}}`;
        }
        return String(item).substring(0, 30);
      });
      return preview.join(', ') + (data.length > 3 ? '...' : '');
    }
    
    if (typeof data === 'object') {
      const keys = Object.keys(data);
      if (keys.length === 0) return '空对象';
      
      // Check if it's a wrapper with arrays
      const arrayKeys = keys.filter(k => Array.isArray(data[k]));
      if (arrayKeys.length > 0) {
        return arrayKeys.map(k => `${k}: ${data[k].length} 项`).join(', ');
      }
      
      return `包含字段: ${keys.slice(0, 5).join(', ')}${keys.length > 5 ? '...' : ''}`;
    }
    
    return String(data).substring(0, 100);
  }

  /**
   * 检测登录页面并等待用户完成登录
   */
  private async handleLoginIfNeeded(
    page: any, bgTabId: string | null, sessionId: string | null | undefined,
    timeoutMs: number = 5 * 60 * 1000
  ): Promise<'completed' | 'skipped' | 'not_needed' | 'timeout'> {
    const detection = await this.loginDetector.detectLogin(page);
    if (!detection.isLoginPage) return 'not_needed';

    console.error(`[Crawler] 🔐 检测到登录页: ${detection.siteInfo.domain} (confidence: ${detection.confidence})`);
    if (!bgTabId) { console.error('[Crawler] No bgTabId, cannot request login'); return 'not_needed'; }

    const fs = require('fs');
    const path = require('path');
    const os = require('os');
    const requestId = `login-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const requestFile = path.join(os.tmpdir(), `hotel-ai-browser-ipc-${requestId}.json`);
    const responseFile = path.join(os.tmpdir(), `hotel-ai-browser-ipc-${requestId}.response.json`);

    fs.writeFileSync(requestFile, JSON.stringify({
      action: 'login_required', requestId, bgTabId,
      sessionId: sessionId || null, siteInfo: detection.siteInfo, timestamp: Date.now(),
    }));
    console.error(`[Crawler] 已发送登录请求，等待用户完成... (${requestId})`);

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (fs.existsSync(responseFile)) {
        try {
          const resp = JSON.parse(fs.readFileSync(responseFile, 'utf-8'));
          try { fs.unlinkSync(responseFile); } catch {}
          console.error(`[Crawler] 登录响应: ${resp.result}`);
          return resp.result === 'completed' ? 'completed' : 'skipped';
        } catch {}
      }
      await new Promise(r => setTimeout(r, 500));
    }

    try { fs.unlinkSync(requestFile); } catch {}
    try { fs.unlinkSync(responseFile); } catch {}
    console.error('[Crawler] 登录等待超时');
    return 'timeout';
  }

  /**
   * Cleanup
   * Note: We keep the browser connection alive for reuse.
   * Connection will only be closed when the application shuts down.
   * In background mode, the hidden page is closed after the task.
   */
  async cleanup(background: boolean = true): Promise<void> {
    if (this.networkMonitor) {
      await this.networkMonitor.stopMonitoring();
    }
    if (background) {
      // Close the hidden background page so it doesn't accumulate
      await this.browserController.closeBackgroundPage();
    }
    // 关闭所有 CDP 连接，避免泄漏影响下次爬虫运行
    await BrowserController.closeAllConnections();
  }
}
