/**
 * IPC Handler - IPC通信处理器
 * 
 * 职责：
 * - 注册所有IPC通道处理器
 * - 路由渲染进程的请求到相应的管理器
 * - 验证和清理IPC消息
 * - 错误处理和响应
 */

import { ipcMain, IpcMainInvokeEvent, BrowserWindow, dialog } from 'electron';
import * as path from 'path';
import { IPC_CHANNELS } from '../shared/types';
import type { AppConfig, NavigationState, SkillDefinition, SkillExecutionContext, SkillResult, PiAgentConfig } from '../shared/types';
import { WindowManager } from './window-manager';
import { ConfigManager } from './config-manager';
import { PiAgentManager } from './pi-agent-manager';
import { SkillManager } from './skill-manager';
import { TabPromotionManager } from './tab-promotion-manager';
import { rebuildMenu } from './menu';
import { databaseManager } from '../../database/dist/database-manager';
import { getDataDir } from './path-resolver';
import { registerQualityHandlers } from './quality/quality-ipc';

/**
 * IPC处理器类
 */
export class IPCHandler {
  private windowManager: WindowManager;
  private configManager: ConfigManager | null = null;
  private piAgentManager: PiAgentManager | null = null;
  private skillManager: SkillManager | null = null;
  private tabPromotionManager: TabPromotionManager | null = null;
  private loginAlertService: any = null;
  private isRegistered = false;

  constructor(windowManager: WindowManager, configManager?: ConfigManager, piAgentManager?: PiAgentManager, skillManager?: SkillManager) {
    this.windowManager = windowManager;
    this.configManager = configManager || null;
    this.piAgentManager = piAgentManager || null;
    this.skillManager = skillManager || null;
  }

  /**
   * 设置ConfigManager
   */
  setConfigManager(configManager: ConfigManager): void {
    this.configManager = configManager;
  }

  /**
   * 设置PiAgentManager
   */
  setPiAgentManager(piAgentManager: PiAgentManager): void {
    this.piAgentManager = piAgentManager;
  }

  /**
   * 设置SkillManager
   */
  setSkillManager(skillManager: SkillManager): void {
    this.skillManager = skillManager;
  }

  setTabPromotionManager(tpm: TabPromotionManager): void {
    this.tabPromotionManager = tpm;
  }

  setLoginAlertService(service: any): void {
    this.loginAlertService = service;
  }

  /**
   * 注册所有IPC处理器
   */
  registerHandlers(): void {
    if (this.isRegistered) {
      console.warn('IPCHandler: Handlers already registered');
      return;
    }

    console.log('IPCHandler: Registering IPC handlers');

    // 注册WebView相关处理器
    this.registerWebViewHandlers();

    // 注册Pi Agent相关处理器（占位符，待实现）
    this.registerPiAgentHandlers();

    // 注册配置相关处理器（占位符，待实现）
    this.registerConfigHandlers();

    // 注册布局相关处理器
    this.registerLayoutHandlers();

    // 注册Skills相关处理器
    this.registerSkillsHandlers();

    // 注册标签页相关处理器
    this.registerTabHandlers();

    // 注册应用相关处理器
    this.registerAppHandlers();

    // 注册数据面板处理器
    this.registerDashboardHandlers();

    // 注册竞品管理处理器
    this.registerCompetitorHandlers();

    // 注册对话框和焦点管理处理器
    this.registerDialogAndFocusHandlers();
    this.registerLoginHandlers();
    this.registerLoginCheckHandlers();

    // 注册质检模块处理器
    this.registerQualityHandlers();
    
    this.isRegistered = true;
    console.log('IPCHandler: All handlers registered');
  }

  /**
   * 注册WebView相关的IPC处理器
   */
  private registerWebViewHandlers(): void {
    // 导航到URL
    ipcMain.handle(
      IPC_CHANNELS.WEBVIEW_NAVIGATE,
      async (event: IpcMainInvokeEvent, url: string) => {
        return this.handleWebViewNavigation(event, url);
      }
    );

    // 后退
    ipcMain.handle(
      IPC_CHANNELS.WEBVIEW_GO_BACK,
      async (event: IpcMainInvokeEvent) => {
        return this.handleWebViewGoBack(event);
      }
    );

    // 前进
    ipcMain.handle(
      IPC_CHANNELS.WEBVIEW_GO_FORWARD,
      async (event: IpcMainInvokeEvent) => {
        return this.handleWebViewGoForward(event);
      }
    );

    // 刷新
    ipcMain.handle(
      IPC_CHANNELS.WEBVIEW_RELOAD,
      async (event: IpcMainInvokeEvent) => {
        return this.handleWebViewReload(event);
      }
    );

    // 获取当前URL
    ipcMain.handle(
      IPC_CHANNELS.WEBVIEW_GET_URL,
      async (event: IpcMainInvokeEvent) => {
        return this.handleWebViewGetURL(event);
      }
    );

    console.log('IPCHandler: WebView handlers registered');
  }

  /**
   * 注册Pi Agent相关的IPC处理器（占位符）
   */
  private registerPiAgentHandlers(): void {
    // 发送消息
    ipcMain.handle(
      IPC_CHANNELS.PI_SEND_MESSAGE,
      async (event: IpcMainInvokeEvent, message: string) => {
        return this.handlePiSendMessage(event, message);
      }
    );

    // 流式发送消息
    ipcMain.handle(
      IPC_CHANNELS.PI_STREAM_MESSAGE,
      async (event: IpcMainInvokeEvent, message: string) => {
        try {
          if (!this.piAgentManager || !this.piAgentManager.isReady()) {
            throw new Error('Pi Agent not ready');
          }
          const response = await this.piAgentManager.streamMessage(message, (chunk: string) => {
            if (!event.sender.isDestroyed()) {
              event.sender.send(IPC_CHANNELS.PI_STREAM_CHUNK, chunk);
            }
          });
          if (!event.sender.isDestroyed()) {
            event.sender.send(IPC_CHANNELS.PI_STREAM_END);
          }
          return response;
        } catch (error) {
          if (!event.sender.isDestroyed()) {
            event.sender.send(IPC_CHANNELS.PI_STREAM_ERROR, (error as Error).message);
          }
          throw error;
        }
      }
    );

    // 清空历史
    ipcMain.handle(
      IPC_CHANNELS.PI_CLEAR_HISTORY,
      async (event: IpcMainInvokeEvent) => {
        return this.handlePiClearHistory(event);
      }
    );

    // 新建会话
    ipcMain.handle(IPC_CHANNELS.PI_NEW_SESSION, async (_event, sessionId: string, title?: string) => {
      if (!this.piAgentManager) throw new Error('PiAgentManager not initialized');
      await this.piAgentManager.newSession(sessionId, title);
      return { sessionId };
    });

    // 切换会话
    ipcMain.handle(IPC_CHANNELS.PI_SWITCH_SESSION, async (_event, sessionId: string) => {
      if (!this.piAgentManager) throw new Error('PiAgentManager not initialized');
      const messages = await this.piAgentManager.switchSession(sessionId);
      return { sessionId, messages };
    });

    // 会话列表
    ipcMain.handle(IPC_CHANNELS.SESSION_LIST, async () => {
      return databaseManager.getSessions();
    });

    // 删除会话
    ipcMain.handle(IPC_CHANNELS.SESSION_DELETE, async (_event, sessionId: string) => {
      await databaseManager.deleteSession(sessionId);
      return { success: true };
    });

    // 重命名会话
    ipcMain.handle(IPC_CHANNELS.SESSION_RENAME, async (_event, sessionId: string, title: string) => {
      await databaseManager.updateSessionTitle(sessionId, title);
      return { success: true };
    });

    // 从控制后台切换会话 → 通知主渲染进程加载历史
    ipcMain.handle(IPC_CHANNELS.SESSION_SWITCH, async (_event, sessionId: string) => {
      if (!this.piAgentManager) throw new Error('PiAgentManager not initialized');
      const messages = await this.piAgentManager.switchSession(sessionId);
      // 通知主窗口渲染进程
      const win = this.windowManager.getMainWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send(IPC_CHANNELS.SESSION_SWITCH, { sessionId, messages });
      }
      return { sessionId, messages };
    });

    console.log('IPCHandler: Pi Agent handlers registered (placeholder)');
  }

  /**
   * 注册配置相关的IPC处理器（占位符）
   */
  private registerConfigHandlers(): void {
    // 获取配置
    ipcMain.handle(
      IPC_CHANNELS.CONFIG_GET,
      async (event: IpcMainInvokeEvent) => {
        return this.handleConfigGet(event);
      }
    );

    // 设置配置
    ipcMain.handle(
      IPC_CHANNELS.CONFIG_SET,
      async (event: IpcMainInvokeEvent, config: Partial<AppConfig>) => {
        return this.handleConfigSet(event, config);
      }
    );

    // 验证API密钥
    ipcMain.handle(
      IPC_CHANNELS.CONFIG_VALIDATE_API_KEY,
      async (event: IpcMainInvokeEvent, apiKey: string) => {
        return this.handleConfigValidateApiKey(event, apiKey);
      }
    );

    // 设置语言
    ipcMain.handle(
      IPC_CHANNELS.CONFIG_SET_LANGUAGE,
      async (_event: IpcMainInvokeEvent, lang: string) => {
        if (lang !== 'zh' && lang !== 'en') {
          throw new Error(`Invalid language: ${lang}. Must be 'zh' or 'en'.`);
        }
        if (this.configManager) {
          await this.configManager.set('language', lang as 'zh' | 'en');
        }
        if (this.piAgentManager) {
          this.piAgentManager.setLanguage(lang as 'zh' | 'en');
        }
        // 重建菜单以应用新语言
        rebuildMenu(lang as 'zh' | 'en');
        // 更新 WindowManager 的语言（标签页默认标题等）
        this.windowManager.setLanguage(lang as 'zh' | 'en');
        console.log(`IPCHandler: Language set to ${lang}`);
      }
    );

    // 设置时区
    ipcMain.handle(
      IPC_CHANNELS.CONFIG_SET_TIMEZONE,
      async (_event: IpcMainInvokeEvent, tz: string) => {
        if (this.piAgentManager) {
          this.piAgentManager.setTimezone(tz);
        }
        console.log(`IPCHandler: Timezone set to ${tz}`);
      }
    );

    console.log('IPCHandler: Config handlers registered (placeholder)');
  }

  /**
   * 注册布局相关的IPC处理器
   */
  private registerLayoutHandlers(): void {
    // 更新WebContentsView边界
    ipcMain.handle(
      IPC_CHANNELS.LAYOUT_UPDATE_BOUNDS,
      async (event: IpcMainInvokeEvent, bounds: { x: number; y: number; width: number; height: number }) => {
        return this.handleLayoutUpdateBounds(event, bounds);
      }
    );

    console.log('IPCHandler: Layout handlers registered');
  }

  // ==================== WebView处理器实现 ====================

  /**
   * 处理WebView导航请求
   */
  private async handleWebViewNavigation(
    event: IpcMainInvokeEvent,
    url: string
  ): Promise<void> {
    console.log('IPCHandler: WebView navigate to:', url);

    try {
      // 验证URL
      if (!url || typeof url !== 'string') {
        throw new Error('Invalid URL');
      }

      // 使用WindowManager加载URL
      await this.windowManager.loadURL(url);

      // 发送导航状态更新
      this.sendNavigationStateUpdate(event.sender);
    } catch (error) {
      console.error('IPCHandler: Navigation error:', error);
      throw error;
    }
  }

  /**
   * 处理WebView后退请求
   */
  private async handleWebViewGoBack(event: IpcMainInvokeEvent): Promise<void> {
    console.log('IPCHandler: WebView go back');

    try {
      this.windowManager.goBack();
      this.sendNavigationStateUpdate(event.sender);
    } catch (error) {
      console.error('IPCHandler: Go back error:', error);
      throw error;
    }
  }

  /**
   * 处理WebView前进请求
   */
  private async handleWebViewGoForward(event: IpcMainInvokeEvent): Promise<void> {
    console.log('IPCHandler: WebView go forward');

    try {
      this.windowManager.goForward();
      this.sendNavigationStateUpdate(event.sender);
    } catch (error) {
      console.error('IPCHandler: Go forward error:', error);
      throw error;
    }
  }

  /**
   * 处理WebView刷新请求
   */
  private async handleWebViewReload(event: IpcMainInvokeEvent): Promise<void> {
    console.log('IPCHandler: WebView reload');

    try {
      this.windowManager.reload();
      this.sendNavigationStateUpdate(event.sender);
    } catch (error) {
      console.error('IPCHandler: Reload error:', error);
      throw error;
    }
  }

  /**
   * 处理获取当前URL请求
   */
  private async handleWebViewGetURL(event: IpcMainInvokeEvent): Promise<string> {
    console.log('IPCHandler: Get current URL');

    try {
      return this.windowManager.getCurrentURL();
    } catch (error) {
      console.error('IPCHandler: Get URL error:', error);
      throw error;
    }
  }

  /**
   * 发送导航状态更新到渲染进程
   */
  private sendNavigationStateUpdate(sender: Electron.WebContents): void {
    const state = this.windowManager.getNavigationState();
    sender.send(IPC_CHANNELS.WEBVIEW_UPDATE_STATE, state);
  }

  // ==================== Pi Agent处理器实现 ====================

  /**
   * 处理发送消息到Pi Agent
   */
  private async handlePiSendMessage(
    event: IpcMainInvokeEvent,
    message: string
  ): Promise<string> {
    console.log('IPCHandler: Pi Agent send message:', message);

    try {
      if (!this.piAgentManager) {
        throw new Error('PiAgentManager not initialized');
      }

      if (!this.piAgentManager.isReady()) {
        throw new Error('Pi Agent not ready');
      }

      // 发送消息并获取响应
      const response = await this.piAgentManager.sendMessage(message);
      
      // 发送响应到渲染进程
      event.sender.send(IPC_CHANNELS.PI_RESPONSE, response);
      
      return response;
    } catch (error) {
      console.error('IPCHandler: Pi Agent send message error:', error);
      throw error;
    }
  }

  /**
   * 处理清空Pi Agent历史
   */
  private async handlePiClearHistory(event: IpcMainInvokeEvent): Promise<void> {
    console.log('IPCHandler: Pi Agent clear history');

    try {
      if (!this.piAgentManager) {
        throw new Error('PiAgentManager not initialized');
      }

      this.piAgentManager.clearHistory();
    } catch (error) {
      console.error('IPCHandler: Pi Agent clear history error:', error);
      throw error;
    }
  }

  // ==================== 配置处理器实现（占位符） ====================

  /**
   * 处理获取配置
   */
  private async handleConfigGet(event: IpcMainInvokeEvent): Promise<AppConfig> {
    console.log('IPCHandler: Get config');

    try {
      if (!this.configManager) {
        throw new Error('ConfigManager not initialized');
      }

      return this.configManager.getConfig();
    } catch (error) {
      console.error('IPCHandler: Get config error:', error);
      throw error;
    }
  }

  /**
   * 处理设置配置
   */
  private async handleConfigSet(
    event: IpcMainInvokeEvent,
    config: Partial<AppConfig>
  ): Promise<void> {
    console.log('IPCHandler: Set config');

    try {
      if (!this.configManager) {
        throw new Error('ConfigManager not initialized');
      }

      // 验证配置
      if (!this.configManager.validate(config)) {
        throw new Error('Invalid configuration');
      }

      // 更新配置到磁盘
      await this.configManager.update(config);

      // 如果 piAgent 配置有变化，重新初始化 PiAgentManager
      if (config.piAgent && this.piAgentManager) {
        const fullConfig = this.configManager.getConfig();
        await this.piAgentManager.initialize(fullConfig.piAgent);
        console.log('IPCHandler: PiAgentManager re-initialized with new config');

        // 同步更新 SkillManager 的 LLM 环境变量
        if (this.skillManager && fullConfig.piAgent.apiKey) {
          this.skillManager.setLLMEnv(
            fullConfig.piAgent.apiKey,
            fullConfig.piAgent.baseURL || '',
            fullConfig.piAgent.model
          );
        }
      }
    } catch (error) {
      console.error('IPCHandler: Set config error:', error);
      throw error;
    }
  }

  /**
   * 处理验证API密钥
   */
  private async handleConfigValidateApiKey(
    event: IpcMainInvokeEvent,
    apiKey: string
  ): Promise<boolean> {
    console.log('IPCHandler: Validate API key');

    try {
      if (!this.configManager) {
        throw new Error('ConfigManager not initialized');
      }

      return await this.configManager.validateApiKey(apiKey);
    } catch (error) {
      console.error('IPCHandler: Validate API key error:', error);
      return false;
    }
  }

  // ==================== 布局处理器实现 ====================

  /**
   * 处理更新WebContentsView边界
   */
  private async handleLayoutUpdateBounds(
    event: IpcMainInvokeEvent,
    bounds: { x: number; y: number; width: number; height: number }
  ): Promise<void> {
    console.log('IPCHandler: Update WebContentsView bounds:', bounds);

    try {
      this.windowManager.updateWebContentsViewBounds(bounds);
    } catch (error) {
      console.error('IPCHandler: Update bounds error:', error);
      throw error;
    }
  }

  // ==================== Skills处理器注册 ====================

  /**
   * 注册Skills相关的IPC处理器
   */
  private registerSkillsHandlers(): void {
    // 获取所有技能
    ipcMain.handle(
      IPC_CHANNELS.SKILLS_GET_ALL,
      async (event: IpcMainInvokeEvent) => {
        return this.handleSkillsGetAll(event);
      }
    );

    // 获取单个技能
    ipcMain.handle(
      IPC_CHANNELS.SKILLS_GET,
      async (event: IpcMainInvokeEvent, skillName: string) => {
        return this.handleSkillsGet(event, skillName);
      }
    );

    // 执行技能
    ipcMain.handle(
      IPC_CHANNELS.SKILLS_EXECUTE,
      async (event: IpcMainInvokeEvent, context: SkillExecutionContext) => {
        return this.handleSkillsExecute(event, context);
      }
    );

    // 重载技能
    ipcMain.handle(
      IPC_CHANNELS.SKILLS_RELOAD,
      async (event: IpcMainInvokeEvent, skillName?: string) => {
        return this.handleSkillsReload(event, skillName);
      }
    );

    // 启用技能
    ipcMain.handle(
      IPC_CHANNELS.SKILLS_ENABLE,
      async (event: IpcMainInvokeEvent, skillName: string) => {
        return this.handleSkillsEnable(event, skillName);
      }
    );

    // 禁用技能
    ipcMain.handle(
      IPC_CHANNELS.SKILLS_DISABLE,
      async (event: IpcMainInvokeEvent, skillName: string) => {
        return this.handleSkillsDisable(event, skillName);
      }
    );

    console.log('IPCHandler: Skills handlers registered');
  }

  // ==================== Skills处理器实现 ====================

  /**
   * 处理获取所有技能
   */
  private async handleSkillsGetAll(event: IpcMainInvokeEvent): Promise<SkillDefinition[]> {
    console.log('IPCHandler: Get all skills');

    try {
      if (!this.skillManager) {
        throw new Error('SkillManager not initialized');
      }

      return this.skillManager.getAvailableSkills();
    } catch (error) {
      console.error('IPCHandler: Get all skills error:', error);
      throw error;
    }
  }

  /**
   * 处理获取单个技能
   */
  private async handleSkillsGet(
    event: IpcMainInvokeEvent,
    skillName: string
  ): Promise<SkillDefinition | null> {
    console.log('IPCHandler: Get skill:', skillName);

    try {
      if (!this.skillManager) {
        throw new Error('SkillManager not initialized');
      }

      return this.skillManager.getSkill(skillName);
    } catch (error) {
      console.error('IPCHandler: Get skill error:', error);
      throw error;
    }
  }

  /**
   * 处理执行技能
   */
  private async handleSkillsExecute(
    event: IpcMainInvokeEvent,
    context: SkillExecutionContext
  ): Promise<SkillResult> {
    console.log('IPCHandler: Execute skill:', context.skillName);

    try {
      if (!this.skillManager) {
        throw new Error('SkillManager not initialized');
      }

      return await this.skillManager.executeSkill(context.skillName, context.params);
    } catch (error) {
      console.error('IPCHandler: Execute skill error:', error);
      throw error;
    }
  }

  /**
   * 处理重载技能
   */
  private async handleSkillsReload(
    event: IpcMainInvokeEvent,
    skillName?: string
  ): Promise<void> {
    console.log('IPCHandler: Reload skill:', skillName || 'all');

    try {
      if (!this.skillManager) {
        throw new Error('SkillManager not initialized');
      }

      if (skillName) {
        await this.skillManager.reloadSkill(skillName);
      } else {
        await this.skillManager.reloadAllSkills();
      }
    } catch (error) {
      console.error('IPCHandler: Reload skill error:', error);
      throw error;
    }
  }

  /**
   * 处理启用技能
   */
  private async handleSkillsEnable(
    event: IpcMainInvokeEvent,
    skillName: string
  ): Promise<void> {
    console.log('IPCHandler: Enable skill:', skillName);

    try {
      if (!this.skillManager) {
        throw new Error('SkillManager not initialized');
      }

      // TODO: 实现启用/禁用逻辑（需要在SkillManager中添加）
      console.warn('IPCHandler: Enable skill not yet implemented');
    } catch (error) {
      console.error('IPCHandler: Enable skill error:', error);
      throw error;
    }
  }

  /**
   * 处理禁用技能
   */
  private async handleSkillsDisable(
    event: IpcMainInvokeEvent,
    skillName: string
  ): Promise<void> {
    console.log('IPCHandler: Disable skill:', skillName);

    try {
      if (!this.skillManager) {
        throw new Error('SkillManager not initialized');
      }

      // TODO: 实现启用/禁用逻辑（需要在SkillManager中添加）
      console.warn('IPCHandler: Disable skill not yet implemented');
    } catch (error) {
      console.error('IPCHandler: Disable skill error:', error);
      throw error;
    }
  }

  // ==================== 标签页处理器注册 ====================

  /**
   * 注册标签页相关的IPC处理器
   */
  private registerTabHandlers(): void {
    // 创建标签页
    ipcMain.handle(
      IPC_CHANNELS.TAB_CREATE,
      async (_event: IpcMainInvokeEvent, url?: string) => {
        const tabId = this.windowManager.createTab(url);
        return {
          tabId,
          tabs: this.windowManager.getTabList(),
          activeTabId: this.windowManager.getActiveTabId()
        };
      }
    );

    // 关闭标签页
    ipcMain.handle(
      IPC_CHANNELS.TAB_CLOSE,
      async (_event: IpcMainInvokeEvent, tabId: string) => {
        this.windowManager.closeTab(tabId);
        return {
          tabs: this.windowManager.getTabList(),
          activeTabId: this.windowManager.getActiveTabId()
        };
      }
    );

    // 切换标签页
    ipcMain.handle(
      IPC_CHANNELS.TAB_SWITCH,
      async (_event: IpcMainInvokeEvent, tabId: string) => {
        this.windowManager.switchTab(tabId);
        // 发送导航状态更新
        _event.sender.send(IPC_CHANNELS.WEBVIEW_UPDATE_STATE, this.windowManager.getNavigationState());
        return {
          tabs: this.windowManager.getTabList(),
          activeTabId: this.windowManager.getActiveTabId()
        };
      }
    );

    // 获取标签页列表
    ipcMain.handle(
      IPC_CHANNELS.TAB_LIST,
      async () => {
        return {
          tabs: this.windowManager.getTabList(),
          activeTabId: this.windowManager.getActiveTabId()
        };
      }
    );

    console.log('IPCHandler: Tab handlers registered');
  }

  // ==================== 应用处理器注册 ====================

  private registerAppHandlers(): void {
    ipcMain.handle(
      IPC_CHANNELS.APP_GET_PAGES_PATH,
      async () => {
        return path.join(__dirname, '../renderer/pages');
      }
    );

    console.log('IPCHandler: App handlers registered');
  }

  // ==================== 数据面板处理器注册 ====================

  private registerDashboardHandlers(): void {
    ipcMain.handle(IPC_CHANNELS.DASHBOARD_PUBLIC_PRICES, async (_event, startTime: string) => {
      return await databaseManager.getDashboardPublicPrices(startTime);
    });
    ipcMain.handle(IPC_CHANNELS.DASHBOARD_COMPETITOR_PRICES, async (_event, startTime: string) => {
      return await databaseManager.getDashboardCompetitorPrices(startTime);
    });
    ipcMain.handle(IPC_CHANNELS.DASHBOARD_BACKEND_PRICES, async (_event, startTime: string) => {
      return await databaseManager.getDashboardBackendPrices(startTime);
    });
    ipcMain.handle(IPC_CHANNELS.DASHBOARD_REALTIME_ROOM_STATUS, async (_event, startTime: string) => {
      return await databaseManager.getDashboardRealtimeRoomStatus(startTime);
    });
    ipcMain.handle(IPC_CHANNELS.DASHBOARD_FUTURE_ROOM_STATUS, async (_event, startTime: string) => {
      return await databaseManager.getDashboardFutureRoomStatus(startTime);
    });
    ipcMain.handle(IPC_CHANNELS.DASHBOARD_PRICE_SNAPSHOTS, async (_event, startTime: string) => {
      return await databaseManager.getDashboardPriceSnapshots(startTime);
    });
    ipcMain.handle(IPC_CHANNELS.DASHBOARD_ROOM_SNAPSHOTS, async (_event, startTime: string) => {
      return await databaseManager.getDashboardRoomSnapshots(startTime);
    });
    ipcMain.handle(IPC_CHANNELS.DASHBOARD_PRICE_CALENDAR, async (_event, startDate: string, endDate: string) => {
      return await databaseManager.getDashboardPriceCalendar(startDate, endDate);
    });
    ipcMain.handle(IPC_CHANNELS.DASHBOARD_ROOM_CALENDAR, async (_event, startDate: string, endDate: string) => {
      return await databaseManager.getDashboardRoomCalendar(startDate, endDate);
    });
    ipcMain.handle(IPC_CHANNELS.DASHBOARD_ROOM_MAPPING, async () => {
      return await databaseManager.getRoomTypeMappings();
    });
    console.log('IPCHandler: Dashboard handlers registered');
  }

  // ==================== 竞品管理处理器 ====================

  private registerCompetitorHandlers(): void {
    const { poiSearch, searchNearbyHotels, searchHotelByName } = require('./amap-service');

    // 获取本店配置
    ipcMain.handle(IPC_CHANNELS.HOTEL_CONFIG_GET, async () => {
      return await databaseManager.getHotelConfig();
    });

    // 保存本店配置
    ipcMain.handle(IPC_CHANNELS.HOTEL_CONFIG_SAVE, async (_event, data: any) => {
      await databaseManager.saveHotelConfig(data);
    });

    // 标准房型管理
    ipcMain.handle(IPC_CHANNELS.ROOM_TYPES_LIST, async () => {
      return await databaseManager.getCanonicalRoomTypes();
    });

    ipcMain.handle(IPC_CHANNELS.ROOM_TYPES_ADD, async (_event, name: string) => {
      await databaseManager.addCanonicalRoomType(name);
    });

    ipcMain.handle(IPC_CHANNELS.ROOM_TYPES_REMOVE, async (_event, name: string) => {
      await databaseManager.removeCanonicalRoomType(name);
    });

    // 房型映射管理（完整表格）
    ipcMain.handle(IPC_CHANNELS.ROOM_MAPPING_GET_ALL, async () => {
      return await databaseManager.getRoomTypeMappings();
    });

    ipcMain.handle(IPC_CHANNELS.ROOM_MAPPING_SAVE, async (_event, mappings: Array<{ canonicalName: string; platform: string; platformRoomName: string }>) => {
      // 先清除所有非 canonical 的映射，再批量写入
      await databaseManager.clearPlatformMappings();
      for (const m of mappings) {
        if (m.canonicalName && m.platform && m.platformRoomName) {
          await databaseManager.upsertRoomTypeMapping(m.canonicalName, m.platform, m.platformRoomName);
        }
      }
    });

    // 竞品列表
    ipcMain.handle(IPC_CHANNELS.COMPETITOR_LIST, async () => {
      try {
        const userId = databaseManager.getUserId();
        const result = await databaseManager.getCompetitorHotels();

        // 诊断日志写文件（console.log 被 ELECTRON_ENABLE_LOGGING=0 屏蔽）
        const fs = require('fs');
        const path = require('path');
        const diagPath = path.join(getDataDir(), 'competitor-list-diag.json');
        const diag: any = {
          timestamp: new Date().toISOString(),
          userId,
          returnedCount: result.length,
        };

        if (result.length === 0) {
          // 不带 userId 过滤查一次，看数据库里到底有没有数据
          try {
            const pool = (databaseManager as any).pool;
            if (pool) {
              const [allRows] = await pool.execute('SELECT id, user_id, name, enabled FROM competitors LIMIT 10');
              diag.allCompetitorsInDB = allRows;
            }
          } catch (diagErr: any) {
            diag.diagError = diagErr.message;
          }
        }

        try { fs.writeFileSync(diagPath, JSON.stringify(diag, null, 2)); } catch {}
        return result;
      } catch (e) {
        return [];
      }
    });

    // 添加竞品
    ipcMain.handle(IPC_CHANNELS.COMPETITOR_ADD, async (_event, data: any) => {
      return await databaseManager.addCompetitorHotel(data);
    });

    // 删除竞品
    ipcMain.handle(IPC_CHANNELS.COMPETITOR_REMOVE, async (_event, competitorId: number) => {
      await databaseManager.removeCompetitorHotel(competitorId);
    });

    // 搜索周边酒店（高德 REST API）
    ipcMain.handle(IPC_CHANNELS.COMPETITOR_SEARCH_NEARBY, async (_event, lat: number, lng: number, radius: number) => {
      return await searchNearbyHotels(lat, lng, radius);
    });

    // 按名称搜索酒店（高德 POI 关键词搜索）
    ipcMain.handle(IPC_CHANNELS.COMPETITOR_SEARCH_BY_NAME, async (_event, keyword: string) => {
      return await searchHotelByName(keyword);
    });

    // 解析酒店名称→经纬度（高德 POI + 地理编码）
    ipcMain.handle(IPC_CHANNELS.COMPETITOR_RESOLVE_LOCATION, async (_event, hotelName: string) => {
      return await poiSearch(hotelName);
    });

    // 解析竞品平台ID（确定性代码，不依赖 Agent 决策）
    ipcMain.handle(IPC_CHANNELS.COMPETITOR_RESOLVE_PLATFORM_IDS, async () => {
      if (!this.skillManager) {
        return { success: false, message: 'System not ready' };
      }

      // 同步等待解析完成，前端可以拿到最新结果
      try {
        await this.executeCompetitorResolver();
        return { success: true, message: 'Platform ID resolution completed' };
      } catch (err: any) {
        console.error('[CompetitorResolver] Fatal error:', err);
        return { success: false, message: err.message || 'Resolution failed' };
      }
    });

    console.log('IPCHandler: Competitor handlers registered');
  }

  /**
   * 确定性竞品平台 ID 解析：直接调用 skill 脚本 + 写入数据库
   * 不依赖 Agent 决策，成功一个存一个
   */
  private async executeCompetitorResolver(): Promise<void> {
    console.error('[CompetitorResolver] Starting...');
    try {
      // 0. 解析本店的 Booking slug（存入 hotel_config）
      try {
        const hotelConfig = await databaseManager.getHotelConfig();
        console.error(`[CompetitorResolver] Hotel config: name=${hotelConfig?.hotel_name}, ctrip_id=${hotelConfig?.ctrip_hotel_id}, booking_id=${hotelConfig?.booking_hotel_id}`);

        // 0a. 本店携程/Trip hotelId
        if (hotelConfig?.hotel_name && !hotelConfig?.ctrip_hotel_id) {
          console.error(`[CompetitorResolver] Resolving own hotel ctrip/trip ID: ${hotelConfig.hotel_name}`);
          const ctripResult = await this.skillManager!.executeSkill('api-ctrip-hotel-search', { keyword: hotelConfig.hotel_name });
          if (ctripResult.success && ctripResult.output?.data) {
            const searchResults = ctripResult.output.data?.Response?.searchResults
              || ctripResult.output.data?.searchResults || [];
            const hotelResult = searchResults.find((r: any) => r.type === 'Hotel');
            if (hotelResult) {
              const hotelId = String(hotelResult.id);
              await databaseManager.saveHotelConfig({ ctripHotelId: hotelId, tripHotelId: hotelId });
              console.error(`[CompetitorResolver] ✅ 本店 ctrip+trip ID: ${hotelId}`);
            }
          }
        }

        // 0b. 本店 Booking slug
        if (hotelConfig?.hotel_name && !hotelConfig?.booking_hotel_id) {
          console.error(`[CompetitorResolver] Resolving own hotel booking slug: ${hotelConfig.hotel_name}`);
          const ownResult = await this.skillManager!.executeSkill('api-booking-hotel-search', {
            keyword: hotelConfig.hotel_name,
            cookieDomain: 'www.booking.com',
            lang: this.configManager?.get('language') === 'en' ? 'en-gb' : 'zh-cn',
          });
          console.error(`[CompetitorResolver] Own booking result: success=${ownResult.success}, output=${JSON.stringify(ownResult.output)?.substring(0, 200)}`);
          if (ownResult.success && ownResult.output?.data?.slug) {
            await databaseManager.saveHotelConfig({ bookingHotelId: ownResult.output.data.slug });
            console.error(`[CompetitorResolver] ✅ 本店 booking slug: ${ownResult.output.data.slug}`);
          }
        }
      } catch (e: any) {
        console.error(`[CompetitorResolver] 本店平台ID解析失败: ${e.message}`);
      }

      // 1. 获取所有竞品
      const competitors = await databaseManager.getCompetitorHotels();
      console.error(`[CompetitorResolver] Competitors: ${competitors.length}`);
      if (competitors.length === 0) {
        console.error('[CompetitorResolver] No competitors found, done');
        return;
      }

      for (const comp of competitors) {
        const competitorId = comp.id;
        const name = comp.name;
        console.error(`[CompetitorResolver] Processing: ${name} (id=${competitorId})`);

        // 解析携程 hotelId（同时覆盖 trip）
        try {
          console.error(`[CompetitorResolver] Calling api-ctrip-hotel-search for: ${name}`);
          const ctripResult = await this.skillManager!.executeSkill('api-ctrip-hotel-search', { keyword: name });
          console.error(`[CompetitorResolver] Ctrip result: success=${ctripResult.success}, error=${ctripResult.error || 'none'}`);
          if (ctripResult.success && ctripResult.output?.data) {
            // 打印实际数据结构帮助调试
            const dataKeys = Object.keys(ctripResult.output.data || {});
            console.error(`[CompetitorResolver] Ctrip data keys: ${dataKeys.join(', ')}`);
            const searchResults = ctripResult.output.data?.Response?.searchResults
              || ctripResult.output.data?.searchResults
              || ctripResult.output.Response?.searchResults || [];
            console.error(`[CompetitorResolver] Ctrip searchResults: ${searchResults.length} items`);
            const hotelResult = searchResults.find((r: any) => r.type === 'Hotel');
            if (hotelResult) {
              const hotelId = String(hotelResult.id);
              const hotelName = hotelResult.word || name;
              await databaseManager.batchSetCompetitorPlatformIds([
                { competitorId, platform: 'ctrip', platformHotelId: hotelId, platformHotelName: hotelName },
                { competitorId, platform: 'trip', platformHotelId: hotelId, platformHotelName: hotelName },
              ]);
              console.error(`[CompetitorResolver] ✅ ctrip+trip: ${name} → ${hotelId}`);
            } else {
              console.error(`[CompetitorResolver] ⚠️ ctrip: ${name} → no hotel match in ${searchResults.length} results`);
              if (searchResults.length > 0) {
                console.error(`[CompetitorResolver] First result: ${JSON.stringify(searchResults[0])?.substring(0, 200)}`);
              }
            }
          } else {
            console.error(`[CompetitorResolver] ⚠️ ctrip: ${name} → skill failed or no data`);
          }
        } catch (e: any) {
          console.error(`[CompetitorResolver] ctrip error for ${name}: ${e.message}`);
        }

        // 解析 Booking slug
        try {
          console.error(`[CompetitorResolver] Calling api-booking-hotel-search for: ${name}`);
          const bookingResult = await this.skillManager!.executeSkill('api-booking-hotel-search', {
            keyword: name,
            cookieDomain: 'www.booking.com',
            lang: this.configManager?.get('language') === 'en' ? 'en-gb' : 'zh-cn',
          });
          console.error(`[CompetitorResolver] Booking result: success=${bookingResult.success}, error=${bookingResult.error || 'none'}`);
          if (bookingResult.success && bookingResult.output?.data?.slug) {
            const { slug, hotelName } = bookingResult.output.data;
            await databaseManager.setCompetitorPlatformId(competitorId, 'booking', slug, hotelName || name);
            console.error(`[CompetitorResolver] ✅ booking: ${name} → ${slug}`);
          } else {
            const errCode = bookingResult.output?.error?.code || bookingResult.error || 'UNKNOWN';
            console.error(`[CompetitorResolver] ⚠️ booking: ${name} → ${errCode}`);
            if (bookingResult.output) {
              console.error(`[CompetitorResolver] Booking output: ${JSON.stringify(bookingResult.output)?.substring(0, 300)}`);
            }
          }
        } catch (e: any) {
          console.error(`[CompetitorResolver] booking error for ${name}: ${e.message}`);
        }
      }

      console.error('[CompetitorResolver] Done');
    } catch (err: any) {
      console.error(`[CompetitorResolver] Fatal: ${err.message}\n${err.stack}`);
    }
  }

  // ==================== 清理 ====================

  /**
   * 注册对话框和焦点管理处理器
   */
  private registerDialogAndFocusHandlers(): void {
    // 确认对话框（替代渲染进程的 confirm()，避免 BrowserView 焦点抢占）
    ipcMain.handle(
      IPC_CHANNELS.DIALOG_CONFIRM,
      async (_event: IpcMainInvokeEvent, message: string, title?: string) => {
        const mainWindow = this.windowManager.getMainWindow();
        if (!mainWindow || mainWindow.isDestroyed()) {
          return false;
        }
        const result = await dialog.showMessageBox(mainWindow, {
          type: 'question',
          buttons: ['确定', '取消'],
          defaultId: 0,
          cancelId: 1,
          title: title || '确认',
          message
        });
        // 对话框关闭后，强制把焦点拉回主窗口的 webContents
        if (!mainWindow.isDestroyed()) {
          mainWindow.webContents.focus();
        }
        return result.response === 0;
      }
    );

    // 焦点恢复：让主窗口的 webContents 重新获得焦点
    ipcMain.handle(
      IPC_CHANNELS.FOCUS_MAIN_WEBCONTENTS,
      async (_event: IpcMainInvokeEvent) => {
        const mainWindow = this.windowManager.getMainWindow();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.focus();
        }
      }
    );

    console.log('IPCHandler: Dialog and focus handlers registered');
  }

  // ==================== 登录辅助处理器 ====================

  private registerLoginHandlers(): void {
    ipcMain.handle(
      IPC_CHANNELS.LOGIN_ACTION,
      async (_event: IpcMainInvokeEvent, payload: { id: string; action: 'go_to_login' | 'done' | 'skip' }) => {
        if (!this.tabPromotionManager) throw new Error('TabPromotionManager not initialized');

        const { id, action } = payload;
        console.log(`IPCHandler: Login action: ${action} for ${id}`);

        if (action === 'go_to_login') {
          // 用户点击"前往登录"：此时才提升 bgTab 并切换显示
          this.tabPromotionManager.promoteAndSwitch(id);
        } else if (action === 'done') {
          const requestId = this.tabPromotionManager.getRequestId(id);
          const info = this.tabPromotionManager.getPromotedTabInfo(id);
          if (info) {
            this.tabPromotionManager.demoteToBgTab(id);
            if (requestId) this.writeLoginResponse(requestId, 'completed');
          }
        } else if (action === 'skip') {
          const requestId = this.tabPromotionManager.getRequestId(id);
          this.tabPromotionManager.skipLogin(id);
          if (requestId) this.writeLoginResponse(requestId, 'skipped');
        }
      }
    );
    console.log('IPCHandler: Login handlers registered');
  }

  private writeLoginResponse(requestId: string, result: 'completed' | 'skipped'): void {
    try {
      const fs = require('fs');
      const os = require('os');
      const responseFile = path.join(os.tmpdir(), `hotel-ai-browser-ipc-${requestId}.response.json`);
      fs.writeFileSync(responseFile, JSON.stringify({ action: 'login_done', requestId, result, timestamp: Date.now() }));
      console.log(`IPCHandler: Login response written: ${result} for ${requestId}`);
    } catch (err) {
      console.error('IPCHandler: Failed to write login response:', err);
    }
  }

  // ==================== 登录检测处理器 ====================

  /** 构建需要检测的平台列表（携程公网需要从数据库读 hotelId） */
  private async getCheckPlatforms(): Promise<Array<{ domain: string; url: string; name: string; cookieDomain: string }>> {
    const platforms = [
      { domain: 'ebooking.ctrip.com', url: 'https://ebooking.ctrip.com/home/mainland?microJump=true', name: '携程后台', cookieDomain: 'ebooking.ctrip.com' },
      { domain: 'me.meituan.com', url: 'https://me.meituan.com/ebooking/merchant/ebIframe?iUrl=%2Febooking%2Fnew-workbench%2Findex.html%23%2F', name: '美团商家后台', cookieDomain: 'me.meituan.com' },
      { domain: 'admin.booking.com', url: 'https://admin.booking.com/hotel/hoteladmin/extranet_ng/manage/start.html?hotel_id=15994510&lang=zh', name: 'Booking后台', cookieDomain: 'admin.booking.com' },
      { domain: 'ebooking.trip.com', url: 'https://ebooking.trip.com/home/mainland?microJump=true', name: 'Trip后台', cookieDomain: 'ebooking.trip.com' },
    ];

    // PMS：从 hotel_config 读取用户配置的 PMS URL
    try {
      const hotelConfig = await databaseManager.getHotelConfig();
      if (hotelConfig?.pms_url) {
        const pmsUrl = hotelConfig.pms_url;
        let pmsDomain = '';
        try { pmsDomain = new URL(pmsUrl).hostname; } catch (_) {}
        if (pmsDomain) {
          platforms.push({
            domain: pmsDomain,
            url: pmsUrl,
            name: 'PMS系统',
            cookieDomain: pmsDomain,
          });
        }
      }
    } catch (_) {}

    return platforms;
    // 携程公网和 Trip 公网通过 API 检测，不在这里
  }

  private registerLoginCheckHandlers(): void {
    ipcMain.handle(IPC_CHANNELS.LOGIN_CHECK_RUN, async () => {
      if (!this.skillManager) {
        return { success: false, error: 'System not ready' };
      }

      try {
        const platforms = await this.getCheckPlatforms();
        const results: any[] = [];

        // 逐个平台调用 login-check skill（每次注入不同的 cookieDomain）
        for (const platform of platforms) {
          try {
            const result = await this.skillManager.executeSkill('login-check', {
              domain: platform.domain,
              url: platform.url,
              name: platform.name,
              cookieDomain: platform.cookieDomain,
            });
            if (result.success && result.output) {
              results.push(result.output);
            } else {
              results.push({ domain: platform.domain, name: platform.name, isLoggedIn: true, error: result.error });
            }
          } catch (e: any) {
            results.push({ domain: platform.domain, name: platform.name, isLoggedIn: true, error: e.message });
          }
        }

        // Trip 公网：用 API skill 检测（Trip 不重定向到登录页，只能通过 API 返回值判断）
        try {
          const cfg = await databaseManager.getHotelConfig();
          const tripHotelId = cfg?.trip_hotel_id;
          if (!tripHotelId) {
            results.push({ domain: 'trip.com', name: 'Trip.com公网', isLoggedIn: true, error: 'no trip_hotel_id configured' });
          } else {
            const tripResult = await this.skillManager.executeSkill('api-trip-public-price', { cookieDomain: 'trip.com', hotelId: tripHotelId });
            const tripData = tripResult.output?.data || tripResult.output;
            const hasError = tripData?.data?.htlSpiderActionErrorCode || tripData?.htlSpiderActionErrorCode;
            const tripLoggedIn = !hasError;
            results.push({
              domain: 'trip.com', url: 'https://www.trip.com/', name: 'Trip.com公网',
              isLoggedIn: tripLoggedIn, confidence: tripLoggedIn ? 1 : 0,
            });
          }
        } catch (e: any) {
          results.push({ domain: 'trip.com', name: 'Trip.com公网', isLoggedIn: true, error: e.message });
        }

        // 携程公网：用 API skill 检测（和 Trip 一样，JS 前端重定向检测不到）
        try {
          const cfg2 = await databaseManager.getHotelConfig();
          const ctripHotelId = cfg2?.ctrip_hotel_id;
          if (!ctripHotelId) {
            results.push({ domain: 'hotels.ctrip.com', name: '携程公网', isLoggedIn: true, error: 'no ctrip_hotel_id configured' });
          } else {
            const ctripResult = await this.skillManager.executeSkill('api-ctrip-public-price', { cookieDomain: 'hotels.ctrip.com', hotelId: ctripHotelId });
            const ctripData = ctripResult.output?.data || ctripResult.output;
            // 优先用 isLogin 字段
            if (ctripData?.data?.isLogin === true || ctripData?.isLogin === true) {
              results.push({ domain: 'hotels.ctrip.com', url: 'https://hotels.ctrip.com/', name: '携程公网', isLoggedIn: true, confidence: 1 });
            } else {
              const ctripHasError = ctripData?.data?.htlSpiderActionErrorCode || ctripData?.htlSpiderActionErrorCode;
              const ctripLoggedIn = !ctripHasError;
              results.push({
                domain: 'hotels.ctrip.com', url: 'https://hotels.ctrip.com/', name: '携程公网',
                isLoggedIn: ctripLoggedIn, confidence: ctripLoggedIn ? 1 : 0,
              });
            }
          }
        } catch (e: any) {
          results.push({ domain: 'hotels.ctrip.com', name: '携程公网', isLoggedIn: true, error: e.message });
        }

        // 弹窗提示未登录的平台
        const notLoggedIn = results.filter(r => !r.isLoggedIn).map(r => r.domain);
        if (notLoggedIn.length > 0 && this.loginAlertService) {
          this.loginAlertService.alertByDomains(notLoggedIn);
        }

        const summary = {
          total: results.length,
          loggedIn: results.filter(r => r.isLoggedIn && !r.error).length,
          notLoggedIn: results.filter(r => !r.isLoggedIn).length,
          errors: results.filter(r => r.error).length,
        };

        return { success: true, results, summary };
      } catch (err: any) {
        return { success: false, error: err.message || String(err) };
      }
    });

    console.log('IPCHandler: Login check handlers registered');
  }

  /**
   * 注册质检模块处理器（委托给 quality-ipc 模块）
   */
  private registerQualityHandlers(): void {
    try {
      registerQualityHandlers();
      console.log('IPCHandler: Quality handlers registered');
    } catch (error) {
      console.error('IPCHandler: Failed to register quality handlers:', error);
    }
  }

  /**
   * 移除所有IPC处理器
   */
  unregisterHandlers(): void {
    if (!this.isRegistered) {
      return;
    }

    console.log('IPCHandler: Unregistering IPC handlers');

    // 移除所有处理器
    Object.values(IPC_CHANNELS).forEach(channel => {
      ipcMain.removeHandler(channel);
    });

    this.isRegistered = false;
    console.log('IPCHandler: All handlers unregistered');
  }

  /**
   * 销毁IPC处理器
   */
  destroy(): void {
    this.unregisterHandlers();
  }
}
