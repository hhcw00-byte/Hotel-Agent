/**
 * Hotel AI Browser - 主进程入口点
 * 
 * 职责：
 * - 应用程序初始化和生命周期管理
 * - 创建主窗口
 * - 协调各个管理器组件
 * - 处理应用程序退出
 */

import { app, BrowserWindow, dialog } from 'electron';

// 开启 CDP 远程调试端口，让爬虫能通过 Playwright connectOverCDP 连接并切换标签页
app.commandLine.appendSwitch('remote-debugging-port', '9222');
app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1');

// 反检测：进程级别启动参数，必须在 app ready 之前设置
// appendSwitch 对同名 key 是追加模式，disable-blink-features 可以多次调用
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');
// disable-features / enable-features 只认最后一个，直接传完整列表
app.commandLine.appendSwitch('disable-features', 'IsolateOrigins,site-per-process,VizDisplayCompositor,RendererCodeIntegrity,BackgroundTabThrottling,IntensiveWakeUpThrottling,CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('enable-features', 'NetworkService,NetworkServiceInProcess');

// 禁用后台标签页节流：确保隐藏的 bg tab 获得与前台标签页相同的渲染和 JS 执行优先级
// 这对静默爬虫的虚拟滚动表格（vxe-table）、懒加载、动态渲染至关重要
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
import * as path from 'path';
import {
  DEFAULT_WINDOW_WIDTH,
  DEFAULT_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  MIN_WINDOW_HEIGHT
} from '../shared/constants';
import { WindowManager, createDefaultWindowConfig } from './window-manager';
import { IPCHandler } from './ipc-handler';
import { ConfigManager } from './config-manager';
import { Logger, initializeLogger, destroyLogger } from './logger';
import { PiAgentManager } from './pi-agent-manager';
import { SkillManager } from './skill-manager';
import { CookieService } from './cookie-service';
import { LoginAlertService } from './login-status-checker';
import { setApplicationMenu } from './menu';
import { databaseManager } from '../../database/dist/database-manager';
import { HeartbeatManager } from './heartbeat/heartbeat-manager';
import { initializeMemoryIPC, cleanupMemoryIPC } from './memory/ipc';
import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../shared/types';
import { getBasePath, getTasksDir, ensureRuntimeDirs } from './path-resolver';
import { DeviceManager } from './device-manager';
import { VersionChecker } from './version-checker';
import { TabPromotionManager } from './tab-promotion-manager';
import { AuthManager } from './auth-manager';
import { GoogleCookieSync } from './google-cookie-sync';
import type { DeviceInfo } from '../shared/types';

let hotelAppInstance: HotelAIBrowserApp | null = null;

/**
 * Electron应用配置接口
 */
interface ElectronAppConfig {
  windowWidth: number;
  windowHeight: number;
  minWidth: number;
  minHeight: number;
  devTools: boolean;
}

/**
 * Hotel AI Browser应用程序主类
 */
class HotelAIBrowserApp {
  private mainWindow: BrowserWindow | null = null;
  private windowManager: WindowManager;
  private ipcHandler: IPCHandler | null = null;
  private configManager: ConfigManager | null = null;
  private piAgentManager: PiAgentManager | null = null;
  private skillManager: SkillManager | null = null;
  private heartbeatManager: HeartbeatManager | null = null;
  private tabPromotionManager: TabPromotionManager | null = null;
  private authManager: AuthManager | null = null;
  private logger: Logger | null = null;
  private deviceInfo: DeviceInfo | null = null;
  private config: ElectronAppConfig;
  private isQuitting = false;
  private isStartupComplete = false;

  constructor() {
    this.windowManager = new WindowManager();
    // 恢复 Google 登录状态（持久化标志），让拦截器知道不需要阻断 Google OAuth
    this.windowManager.restoreGoogleLoginDone();
    this.config = {
      windowWidth: DEFAULT_WINDOW_WIDTH,
      windowHeight: DEFAULT_WINDOW_HEIGHT,
      minWidth: MIN_WINDOW_WIDTH,
      minHeight: MIN_WINDOW_HEIGHT,
      devTools: !app.isPackaged // 开发模式下启用DevTools
    };
  }

  /**
   * 初始化应用程序
   */
  async initialize(): Promise<void> {
    console.log('Initializing Hotel AI Browser...');
    
    // 注册应用程序事件处理器
    this.registerAppHandlers();
    
    // 等待Electron准备就绪
    await app.whenReady();

    console.log('Electron is ready');

    // 确保运行时目录存在（打包后 extraResources 不含空目录）
    ensureRuntimeDirs();

    // session 已就绪，验证 Google Cookie 是否仍有效（过期则重置 googleLoginDone 标志）
    await this.windowManager.validateGoogleCookies();

    // 验证 CDP 远程调试端口是否成功绑定（异步，不阻塞启动）
    const cdpCheck = new Promise<void>((resolve) => {
      try {
        const http = require('http');
        const req = http.get('http://127.0.0.1:9222/json/version', (res: any) => {
          let data = '';
          res.on('data', (chunk: string) => { data += chunk; });
          res.on('end', () => { console.log('CDP port 9222 is active:', data.substring(0, 200)); resolve(); });
        });
        req.on('error', (err: Error) => { console.error('CDP port 9222 is NOT active:', err.message); resolve(); });
        req.setTimeout(1000, () => { req.destroy(); resolve(); });
      } catch { resolve(); }
    });
    
    // 初始化ConfigManager
    this.configManager = new ConfigManager();
    await this.configManager.load();
    
    // 初始化Logger
    const loggingConfig = this.configManager.get('logging');
    this.logger = initializeLogger({
      level: loggingConfig.level,
      filePath: loggingConfig.filePath,
      maxFileSize: loggingConfig.maxFileSize,
      maxFiles: loggingConfig.maxFiles,
      enableConsole: true
    });
    
    this.logger.info('app', 'Application initializing');

    // 获取或创建设备ID
    const deviceManager = new DeviceManager(this.configManager.getStore());
    this.deviceInfo = deviceManager.getOrCreateDeviceId();
    this.logger.info('app', 'Device ID generated', {
      deviceIdShort: this.deviceInfo.deviceIdShort
    });

    // 初始化 AuthManager（连接 system 库，建表）
    const dbConfig = this.configManager.get('database');
    this.authManager = new AuthManager(dbConfig);
    try {
      await this.authManager.initialize();
      this.logger.info('app', 'AuthManager initialized');
    } catch (error) {
      this.logger.error('app', 'Failed to initialize AuthManager', {
        error: error instanceof Error ? error.message : String(error)
      });
      // AuthManager 初始化失败仍继续，登录页面会显示错误
    }

    // 尝试自动登录
    const autoLoginResult = await this.authManager.tryAutoLogin();
    this.logger.info('app', 'Auto login result', { success: autoLoginResult.success });

    // 注册认证相关 IPC handler（需要在创建窗口之前注册）
    this.registerAuthHandlers();

    // 注册设备ID IPC handler
    ipcMain.handle(IPC_CHANNELS.APP_GET_DEVICE_ID, async () => {
      return this.deviceInfo?.deviceIdShort || '';
    });

    if (autoLoginResult.success) {
      // 自动登录成功 → 执行完整业务初始化，然后创建窗口（含 BrowserView）
      await this.initializeBusiness();
      await this.createMainWindow();
      this.setupBrowserView();

      // Google Cookie 同步（异步，不阻塞）
      try {
        const cookieSync = new GoogleCookieSync();
        cookieSync.sync().catch(() => {});
      } catch {}
      
      // 等 CDP 检查完成（最多 1s）
      await cdpCheck;
    } else {
      // 需要手动登录 → 创建窗口仅显示登录页面，不创建 BrowserView，不初始化业务组件
      await this.createMainWindow();
      this.logger.info('app', 'Showing login page, business components not initialized');
    }

    // 初始化 TabPromotionManager（需要 mainWindow）
    if (this.mainWindow) {
      this.tabPromotionManager = new TabPromotionManager(this.windowManager, this.mainWindow);
      this.windowManager.setTabPromotionManager(this.tabPromotionManager);
      if (this.ipcHandler) {
        this.ipcHandler.setTabPromotionManager(this.tabPromotionManager);
      }
      this.logger.info('app', 'TabPromotionManager initialized');
    }
    
    // 检查是否首次运行
    if (this.configManager.isFirstRun()) {
      this.logger.info('app', 'First run detected - API configuration required');
      // TODO: 显示配置向导
    }
    
    this.logger.info('app', 'Application initialized successfully');
    this.isStartupComplete = true;
  }

  /**
   * 业务初始化：VersionChecker → DatabaseManager → SkillManager → HeartbeatManager 等
   * 在自动登录成功或手动登录成功后调用
   */
  private async initializeBusiness(): Promise<void> {
    if (!this.configManager || !this.deviceInfo) {
      throw new Error('ConfigManager or DeviceInfo not available for business initialization');
    }

    const dbConfig = this.configManager.get('database');

    // 版本校验
    const versionChecker = new VersionChecker(dbConfig);
    try {
      const versionResult = await versionChecker.checkVersion(this.deviceInfo);
      if (!versionResult.passed) {
        this.logger?.error('app', 'Version check failed', {
          current: versionResult.currentVersion,
          required: versionResult.requiredVersion
        });
        dialog.showErrorBox(
          '版本不符',
          versionResult.message || `当前版本 ${versionResult.currentVersion} 不符合要求版本 ${versionResult.requiredVersion}，请更新后使用`
        );
        app.quit();
        return;
      }
      this.logger?.info('app', 'Version check passed', {
        version: versionResult.currentVersion
      });
    } catch (error) {
      this.logger?.error('app', 'Version check error', {
        error: error instanceof Error ? error.message : String(error)
      });
      dialog.showErrorBox(
        '无法连接云端服务器',
        `版本校验失败：${error instanceof Error ? error.message : String(error)}\n请检查网络连接后重试。`
      );
      app.quit();
      return;
    }

    // 初始化数据库（带重试，防止网络瞬断）
    try {
      const currentUser = this.authManager!.getCurrentUser();
      if (!currentUser) throw new Error('用户未登录');
      databaseManager.setConfig(dbConfig, currentUser.id);

      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await databaseManager.initialize();
          this.logger?.info('app', 'Database initialized', {
            dbPath: databaseManager.getDbPath(),
            attempt,
          });
          break;
        } catch (dbErr) {
          this.logger?.warn('app', `Database init attempt ${attempt}/3 failed`, {
            error: dbErr instanceof Error ? dbErr.message : String(dbErr)
          });
          if (attempt === 3) throw dbErr;
          await new Promise(r => setTimeout(r, 1000));
        }
      }
    } catch (error) {
      this.logger?.error('app', 'Failed to initialize database', {
        error: error instanceof Error ? error.message : String(error)
      });
    }

    // 初始化 Memory IPC（记忆系统，供控制后台调用）
    try {
      await initializeMemoryIPC();
      this.logger?.info('app', 'Memory IPC handlers registered');
    } catch (error) {
      this.logger?.error('app', 'Failed to initialize Memory IPC', {
        error: error instanceof Error ? error.message : String(error)
      });
    }

    // 初始化Pi Agent Manager
    const piAgentConfig = this.configManager.get('piAgent');
    this.piAgentManager = new PiAgentManager(piAgentConfig, this.logger!);
    
    try {
      await this.piAgentManager.initialize();
      this.logger?.info('app', 'Pi Agent Manager initialized');
    } catch (error) {
      this.logger?.error('app', 'Failed to initialize Pi Agent Manager', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
    
    // 初始化Skill Manager
    const skillsConfig = this.configManager.get('skills');
    this.skillManager = new SkillManager(
      skillsConfig.skillsDir,
      skillsConfig.scriptsDir,
      skillsConfig.defaultTimeout,
      this.logger!
    );
    
    let loginAlertService: any = null;
    try {
      await this.skillManager.initialize();
      this.logger?.info('app', 'Skill Manager initialized', {
        skillsLoaded: this.skillManager.getAvailableSkills().length
      });

      // 注入 CookieService 给 SkillManager，用于 API 脚本的 Cookie 注入
      const cookieService = new CookieService();
      this.skillManager.setCookieService(cookieService);
      this.logger?.info('app', 'CookieService injected into SkillManager');

      // 创建 LoginAlertService（纯弹窗能力，不做检测）
      loginAlertService = new LoginAlertService();
      if (this.piAgentManager) {
        this.piAgentManager.setLoginAlertService(loginAlertService);
      }
      
      // 将SkillManager传递给PiAgentManager
      if (this.piAgentManager) {
        this.piAgentManager.setSkillManager(this.skillManager);
        this.logger?.info('app', 'SkillManager attached to PiAgentManager');
      }

      // 注入 LLM 环境变量给爬虫子进程
      if (piAgentConfig.apiKey) {
        this.skillManager.setLLMEnv(
          piAgentConfig.apiKey,
          piAgentConfig.baseURL || '',
          piAgentConfig.model
        );
      }

      // 注入数据库环境变量给子进程
      if (this.deviceInfo) {
        const currentUser = this.authManager!.getCurrentUser();
        if (currentUser) {
          this.skillManager.setDbEnv(
            dbConfig.host,
            String(dbConfig.port),
            dbConfig.user,
            dbConfig.password,
            String(currentUser.id)
          );
        }
      }

      // 初始化心跳管理器
      this.heartbeatManager = new HeartbeatManager(
        piAgentConfig,             // 用于创建临时 Agent
        this.skillManager,         // 共享 SkillManager
        path.join(getTasksDir(), 'schedule.json'),
        this.logger!,
        getBasePath()              // resourcesBasePath: scripts/agent 等只读资源
      );

      try {
        await this.heartbeatManager.start();
        this.logger?.info('app', 'Heartbeat manager started', {
          tasksCount: this.heartbeatManager.getTaskCount()
        });
      } catch (error) {
        this.logger?.error('app', 'Failed to start heartbeat manager', {
          error: error instanceof Error ? error.message : String(error)
        });
      }

      // 注入 LoginAlertService 给 HeartbeatManager
      this.heartbeatManager.setLoginAlertService(loginAlertService);
      this.logger?.info('app', 'LoginAlertService injected');

      // 注册心跳任务 IPC（供控制后台直接管理任务开关）
      ipcMain.handle(IPC_CHANNELS.HEARTBEAT_GET_TASKS, async () => {
        return this.heartbeatManager ? this.heartbeatManager.getTasks() : [];
      });
      ipcMain.handle(IPC_CHANNELS.HEARTBEAT_UPDATE_TASK, async (_event, taskId, updates) => {
        if (!this.heartbeatManager) throw new Error('HeartbeatManager not available');
        this.heartbeatManager.updateTask(taskId, updates);
        return { success: true };
      });

      ipcMain.handle(IPC_CHANNELS.HEARTBEAT_GET_EXECUTING, async () => {
        return this.heartbeatManager ? this.heartbeatManager.getExecutingTaskIds() : [];
      });

      ipcMain.handle(IPC_CHANNELS.HEARTBEAT_EXECUTE_TASK, async (_event, taskId: string) => {
        if (!this.heartbeatManager) throw new Error('HeartbeatManager not ready');
        await this.heartbeatManager.executeTaskManually(taskId);
        return { success: true };
      });
    } catch (error) {
      this.logger?.error('app', 'Failed to initialize Skill Manager', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
    
    // 初始化IPC处理器
    this.ipcHandler = new IPCHandler(
      this.windowManager,
      this.configManager,
      this.piAgentManager,
      this.skillManager
    );
    this.ipcHandler.registerHandlers();
    if (loginAlertService) {
      this.ipcHandler.setLoginAlertService(loginAlertService);
    }

    // 将 mainWindow 注入需要它的管理器（如果窗口已创建）
    if (this.mainWindow) {
      if (this.piAgentManager) {
        this.piAgentManager.setMainWindow(this.mainWindow);
      }
      if (this.heartbeatManager) {
        this.heartbeatManager.setMainWindow(this.mainWindow);
      }
    }

    this.logger?.info('app', 'Business components initialized successfully');
  }

  /**
   * 注册认证相关 IPC handler
   */
  private registerAuthHandlers(): void {
    // auth:register → 注册新用户
    ipcMain.handle(
      IPC_CHANNELS.AUTH_REGISTER,
      async (_event, username: string, password: string, displayName: string) => {
        if (!this.authManager) throw new Error('AuthManager not initialized');
        return this.authManager.register(username, password, displayName);
      }
    );

    // auth:login → 用户登录
    ipcMain.handle(
      IPC_CHANNELS.AUTH_LOGIN,
      async (_event, username: string, password: string, rememberPassword: boolean) => {
        if (!this.authManager) throw new Error('AuthManager not initialized');
        
        // 快速登录：密码为空时尝试从保存的凭证中解密密码
        let actualPassword = password;
        if (!password && rememberPassword) {
          const decrypted = this.authManager.getDecryptedPassword(username);
          if (decrypted) {
            actualPassword = decrypted;
          } else {
            return { success: false, error: '未找到保存的密码，请手动输入' };
          }
        }
        
        const result = await this.authManager.login(username, actualPassword, rememberPassword);
        if (result.success && result.user) {
          // 登录成功后执行业务初始化和 BrowserView 创建（如果尚未初始化）
          if (!this.ipcHandler) {
            try {
              await this.initializeBusiness();
              this.setupBrowserView();
              this.logger?.info('app', 'Business initialized after manual login');
            } catch (error) {
              this.logger?.error('app', 'Failed to initialize business after login', {
                error: error instanceof Error ? error.message : String(error)
              });
            }
          } else {
            // 业务已初始化（登出后重新登录），更新数据库 userId 以隔离会话数据
            const dbConfig = this.configManager!.get('database');
            databaseManager.setConfig(dbConfig, result.user.id);
            // 恢复 BrowserView 显示
            this.windowManager.showBrowserViews();
          }
          // 通知渲染进程切换到主页面
          if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send(IPC_CHANNELS.AUTH_ON_STATE_CHANGE, result.user);
          }
          // 通知所有 BrowserView 标签页（如 hotel-admin）刷新数据
          this.windowManager.broadcastToTabs(IPC_CHANNELS.AUTH_ON_STATE_CHANGE, result.user);
        }
        return result;
      }
    );

    // auth:logout → 用户登出
    ipcMain.handle(
      IPC_CHANNELS.AUTH_LOGOUT,
      async () => {
        if (!this.authManager) throw new Error('AuthManager not initialized');
        await this.authManager.logout();
        // 清除 Google 登录标志和 Google cookie（防止残留给下一个用户）
        this.windowManager.resetGoogleLoginDone();
        try {
          const { session } = require('electron');
          const ses = session.defaultSession;
          const googleDomains = ['.google.com', '.youtube.com', '.googleapis.com', 'accounts.google.com'];
          for (const domain of googleDomains) {
            const cookies = await ses.cookies.get({ domain });
            for (const c of cookies) {
              const url = `${c.secure ? 'https' : 'http'}://${c.domain.replace(/^\./, '')}${c.path}`;
              await ses.cookies.remove(url, c.name).catch(() => {});
            }
          }
        } catch {}
        this.windowManager.resetGoogleLoginDone();
        // 重置 PiAgentManager 会话状态（清空内存中的对话历史）
        if (this.piAgentManager) {
          this.piAgentManager.resetForLogout();
        }
        // 隐藏 BrowserView，避免遮挡登录页面
        this.windowManager.hideBrowserViews();
        // 登出后通知渲染进程
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send(IPC_CHANNELS.AUTH_ON_STATE_CHANGE, null);
        }
        // 通知所有 BrowserView 标签页（如 hotel-admin）清空数据
        this.windowManager.broadcastToTabs(IPC_CHANNELS.AUTH_ON_STATE_CHANGE, null);
      }
    );

    // auth:get-current-user → 获取当前用户
    ipcMain.handle(
      IPC_CHANNELS.AUTH_GET_CURRENT_USER,
      async () => {
        if (!this.authManager) return null;
        return this.authManager.getCurrentUser();
      }
    );

    // auth:get-saved-credentials → 获取已保存凭证列表
    ipcMain.handle(
      IPC_CHANNELS.AUTH_GET_SAVED_CREDENTIALS,
      async () => {
        if (!this.authManager) return [];
        return this.authManager.getSavedCredentials();
      }
    );

    // auth:remove-saved-credential → 移除已保存凭证
    ipcMain.handle(
      IPC_CHANNELS.AUTH_REMOVE_SAVED_CREDENTIAL,
      async (_event, username: string) => {
        if (!this.authManager) throw new Error('AuthManager not initialized');
        this.authManager.removeSavedCredential(username);
      }
    );

    // auth:google-login → Google 登录
    ipcMain.handle(
      IPC_CHANNELS.AUTH_GOOGLE_LOGIN,
      async () => {
        if (!this.authManager) throw new Error('AuthManager not initialized');

        // 1. 启动系统 Chrome 完成 Google 登录
        const result = await this.windowManager.performGoogleLogin();
        if (!result.success) {
          return { success: false, error: 'Google 登录已取消或失败' };
        }

        // 2. 提取用户信息（多重降级策略）
        let email = result.userInfo?.email || '';
        let displayName = result.userInfo?.displayName || '';

        // 降级：从 Electron session cookie 中提取邮箱
        if (!email) {
          try {
            const { session } = require('electron');
            const cookies = await session.defaultSession.cookies.get({ domain: '.google.com', name: 'SAPISID' });
            // 尝试从 LSID cookie 的 accounts.google.com 获取
            const gaCookies = await session.defaultSession.cookies.get({ domain: 'accounts.google.com' });
            // 尝试找包含邮箱的 cookie
            for (const c of gaCookies) {
              if (c.value && c.value.includes('@')) {
                email = c.value;
                break;
              }
            }
          } catch {}
        }

        // 最终降级：用时间戳生成唯一用户名（cookie 已导入，登录态有效）
        if (!email) {
          email = `google_user_${Date.now()}@placeholder.local`;
          displayName = displayName || 'Google User';
          this.logger?.warn('app', 'Could not extract Google email, using placeholder');
        }

        // 3. 通过 AuthManager 登录/注册
        const loginResult = await this.authManager.loginWithGoogle(
          email,
          displayName || email
        );
        if (!loginResult.success || !loginResult.user) {
          return loginResult;
        }

        // 3. 执行业务初始化（如果尚未初始化）
        if (!this.ipcHandler) {
          try {
            await this.initializeBusiness();
            this.setupBrowserView();
            this.logger?.info('app', 'Business initialized after Google login');
          } catch (error) {
            this.logger?.error('app', 'Failed to initialize business after Google login', {
              error: error instanceof Error ? error.message : String(error)
            });
          }
        } else {
          this.windowManager.showBrowserViews();
        }

        // 3.5 同步系统 Chrome/Edge 的 Google Cookie（补充 performGoogleAuth 导入的 cookie）
        try {
          const cookieSync = new GoogleCookieSync();
          const syncCount = await cookieSync.sync();
          this.logger?.info('app', 'Google cookie sync after Google login', { count: syncCount });
        } catch (syncErr) {
          this.logger?.warn('app', 'Google cookie sync failed (non-critical)', {
            error: syncErr instanceof Error ? syncErr.message : String(syncErr)
          });
        }

        // 4. 通知渲染进程
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send(IPC_CHANNELS.AUTH_ON_STATE_CHANGE, loginResult.user);
        }

        return { success: true, user: loginResult.user };
      }
    );

    console.log('Auth IPC handlers registered');
  }

  /**
   * 注册应用程序级别的事件处理器
   */
  private registerAppHandlers(): void {
    // 当所有窗口关闭时
    app.on('window-all-closed', () => {
      console.log('All windows closed');
      // 在Windows和Linux上，关闭所有窗口时退出应用
      // macOS上通常保持应用运行直到用户明确退出
      if (process.platform !== 'darwin') {
        this.shutdown();
      }
    });

    // 当应用被激活时（macOS特有）
    app.on('activate', async () => {
      console.log('App activated');
      if (!this.isStartupComplete) {
        console.log('App activation ignored during startup');
        return;
      }
      // 在macOS上，点击dock图标时重新创建窗口
      if (BrowserWindow.getAllWindows().length === 0) {
        await this.createMainWindow();
      } else if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        if (this.mainWindow.isMinimized()) this.mainWindow.restore();
        this.mainWindow.show();
        this.mainWindow.focus();
      }
    });

    // 应用即将退出
    app.on('before-quit', () => {
      console.log('App is quitting');
      this.isQuitting = true;
    });

    // 处理未捕获的异常
    process.on('uncaughtException', (error) => {
      console.error('Uncaught exception:', error);
      if (this.logger) {
        this.logger.exception('process', error, { type: 'uncaughtException' });
      }
    });

    // 处理未处理的Promise拒绝
    process.on('unhandledRejection', (reason, promise) => {
      console.error('Unhandled rejection at:', promise, 'reason:', reason);
      if (this.logger) {
        this.logger.error('process', 'Unhandled promise rejection', {
          reason: String(reason),
          type: 'unhandledRejection'
        });
      }
    });
  }

  /**
   * 创建主窗口
   */
  /**
     * 创建主窗口（不含 BrowserView，BrowserView 在登录成功后通过 setupBrowserView 创建）
     */
    async createMainWindow(): Promise<void> {
      console.log('Creating main window...');

      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        console.log('Main window already exists, focusing existing window');
        if (this.mainWindow.isMinimized()) this.mainWindow.restore();
        this.mainWindow.show();
        this.mainWindow.focus();
        return;
      }

      // 创建窗口配置
      const preloadPath = path.join(__dirname, '../preload/index.js');
      const windowConfig = createDefaultWindowConfig(preloadPath);
      windowConfig.width = this.config.windowWidth;
      windowConfig.height = this.config.windowHeight;
      windowConfig.minWidth = this.config.minWidth;
      windowConfig.minHeight = this.config.minHeight;

      // 使用WindowManager创建窗口
      this.mainWindow = this.windowManager.createMainWindow(windowConfig);

      this.mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        console.log('Main window intercepted window.open:', url);
        if (this.windowManager) {
          this.windowManager.createTab(url);
        }
        return { action: 'deny' };
      });

      // 设置标签页更新回调，通知渲染进程
      const mainWindowRef = this.mainWindow;
      this.windowManager.setOnTabUpdate((tabs, activeTabId) => {
        if (mainWindowRef && !mainWindowRef.isDestroyed()) {
          mainWindowRef.webContents.send('tab:update', { tabs, activeTabId });
        }
      });

      // 加载渲染进程HTML
      const htmlPath = path.join(__dirname, '../renderer/index.html');
      console.log('Loading HTML from:', htmlPath);

      try {
        await this.mainWindow.loadFile(htmlPath);
        console.log('HTML loaded successfully');

        // 立即显示窗口并最大化
        console.log('Showing window...');
        this.windowManager.show();
        this.mainWindow.maximize();

        // 设置应用程序菜单（根据配置语言）
        const lang = this.configManager!.get('language') || 'zh';
        setApplicationMenu(this.mainWindow, lang);
        this.windowManager.setLanguage(lang);
      } catch (error) {
        console.error('Failed to load HTML:', error);
        throw error;
      }

      // 当页面准备好显示时（备用）
      this.mainWindow.once('ready-to-show', () => {
        console.log('Window ready-to-show event fired');
        if (!this.mainWindow?.isVisible()) {
          this.windowManager.show();
        }
      });

      // 窗口关闭事件
      this.mainWindow.on('closed', () => {
        console.log('Main window closed');
        this.mainWindow = null;
      });

      this.mainWindow.on('close', () => {
        if (!this.isQuitting) {
          console.log('Window close requested');
        }
      });

      console.log('Main window created successfully');
    }

    /**
     * 创建并附加 BrowserView 到主窗口（仅在登录成功后调用）
     */
    private setupBrowserView(): void {
        if (!this.mainWindow) return;

        // 如果已经有 BrowserView，跳过
        if (this.windowManager.getWebContentsView()) {
          console.log('BrowserView already exists, skipping setup');
          return;
        }

        console.log('Creating BrowserView...');
        const browserView = this.windowManager.createWebContentsView();

        console.log('Attaching BrowserView to window...');
        this.windowManager.attachWebContentsView(this.mainWindow, browserView);
        console.log('BrowserView attached successfully');

        // 将 mainWindow 注入需要它的管理器
        if (this.piAgentManager) {
          this.piAgentManager.setMainWindow(this.mainWindow);
        }
        if (this.heartbeatManager) {
          this.heartbeatManager.setMainWindow(this.mainWindow);
        }

        // 延迟多次触发 resize，确保渲染进程 DOM 重排完成后 SplitLayoutManager 发送正确 bounds
        const win = this.mainWindow;
        for (const delay of [100, 300, 600]) {
          setTimeout(() => {
            if (win && !win.isDestroyed()) {
              win.webContents.executeJavaScript('window.dispatchEvent(new Event("resize"))').catch(() => {});
            }
          }, delay);
        }
      }

  /**
   * 关闭应用程序
   */
  async shutdown(): Promise<void> {
    console.log('Shutting down application...');
    
    if (this.logger) {
      this.logger.info('app', 'Application shutting down');
    }
    
    try {
      // 清理IPC处理器
      if (this.ipcHandler) {
        this.ipcHandler.destroy();
        this.ipcHandler = null;
      }

      // 清理ConfigManager
      this.configManager = null;

      // 清理Pi Agent Manager
      if (this.piAgentManager) {
        this.piAgentManager.destroy();
        this.piAgentManager = null;
      }

      // 清理Skill Manager
      if (this.skillManager) {
        // SkillManager没有destroy方法，只需清空引用
        this.skillManager = null;
      }

      // 清理 Memory IPC
      cleanupMemoryIPC();

      // 停止心跳管理器
      if (this.heartbeatManager) {
        await this.heartbeatManager.stop();
        this.heartbeatManager = null;
        if (this.logger) {
          this.logger.info('app', 'Heartbeat manager stopped');
        }
      }

      // 关闭 AuthManager 数据库连接池
      if (this.authManager) {
        try {
          await this.authManager.destroy();
          if (this.logger) {
            this.logger.info('app', 'AuthManager destroyed');
          }
        } catch (error) {
          if (this.logger) {
            this.logger.error('app', 'Failed to destroy AuthManager', {
              error: error instanceof Error ? error.message : String(error)
            });
          }
        }
        this.authManager = null;
      }

      // 关闭数据库连接
      try {
        await databaseManager.close();
        if (this.logger) {
          this.logger.info('app', 'Database connection closed');
        }
      } catch (error) {
        if (this.logger) {
          this.logger.error('app', 'Failed to close database', {
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      // 清理WindowManager
      if (this.windowManager) {
        this.windowManager.destroy();
      }

      // 清理主窗口引用
      this.mainWindow = null;
      
      if (this.logger) {
        this.logger.info('app', 'Cleanup completed');
      }
      
      // 销毁Logger
      destroyLogger();
      this.logger = null;
      
      console.log('Cleanup completed');
      
      // 退出应用
      app.quit();
    } catch (error) {
      console.error('Error during shutdown:', error);
      if (this.logger) {
        this.logger.exception('app', error as Error, { phase: 'shutdown' });
      }
      // 强制退出
      app.exit(1);
    }
  }

  /**
   * 获取主窗口实例
   */
  getMainWindow(): BrowserWindow | null {
    return this.mainWindow;
  }
}

// ==================== 应用程序启动 ====================

/**
 * 主函数 - 应用程序入口
 */
async function main() {
  try {
    // 强制 stdout/stderr 使用 UTF-8，解决 Windows 控制台中文乱码
    if (process.stdout.isTTY) {
      process.stdout.setEncoding('utf8');
    }
    if (process.stderr.isTTY) {
      process.stderr.setEncoding('utf8');
    }

    console.log('Starting Hotel AI Browser...');
    console.log('Platform:', process.platform);
    console.log('Electron version:', process.versions.electron);
    console.log('Node version:', process.versions.node);
    console.log('Chrome version:', process.versions.chrome);

    const singleInstanceLock = app.requestSingleInstanceLock();
    if (!singleInstanceLock) {
      console.log('Another Hotel-Agent instance is already running. Exiting this instance.');
      app.quit();
      return;
    }

    app.on('second-instance', () => {
      const existingWindow = hotelAppInstance?.getMainWindow();
      if (!existingWindow || existingWindow.isDestroyed()) return;
      if (existingWindow.isMinimized()) existingWindow.restore();
      existingWindow.show();
      existingWindow.focus();
    });
    
    // 添加命令行参数以处理SSL和安全问题
    app.commandLine.appendSwitch('ignore-certificate-errors');
    app.commandLine.appendSwitch('allow-insecure-localhost');
    app.commandLine.appendSwitch('disable-web-security');
    // 针对飞猪微前端沙箱环境的反检测
    app.commandLine.appendSwitch('disable-dev-shm-usage');
    app.commandLine.appendSwitch('no-sandbox');
    app.commandLine.appendSwitch('disable-setuid-sandbox');
    // 开放 CDP 调试端口，让爬虫子进程能通过 Playwright 连接到左侧浏览器
    // （remote-debugging-port 已在文件顶部设置，此处只补充 allow-origins）
    app.commandLine.appendSwitch('remote-allow-origins', '*');
    
    // 创建应用实例
    const hotelApp = new HotelAIBrowserApp();
    hotelAppInstance = hotelApp;
    
    // 初始化应用
    await hotelApp.initialize();
    
    console.log('Application started successfully');
    console.log('AI Web Crawler can now connect to port 9222');
  } catch (error) {
    console.error('Failed to start application:', error);
    process.exit(1);
  }
}

// 启动应用
main();
