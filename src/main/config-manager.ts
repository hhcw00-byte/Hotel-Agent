/**
 * Config Manager - 配置管理器
 * 
 * 职责：
 * - 加载和保存应用程序配置
 * - 提供配置访问接口
 * - 验证配置有效性
 * - 管理默认配置
 */

import Store from 'electron-store';
import { app, safeStorage } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import type { AppConfig, PiAgentConfig, WindowConfig, WebViewConfig, LoggingConfig } from '../shared/types';
import { getSkillsDir, getScriptsDir, getDBConfigPath, getBasePath } from './path-resolver';
import {
  APP_VERSION,
  DEFAULT_PI_PROVIDER,
  DEFAULT_PI_MODEL,
  DEFAULT_TEMPERATURE,
  DEFAULT_MAX_TOKENS,
  DEFAULT_WINDOW_WIDTH,
  DEFAULT_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  MIN_WINDOW_HEIGHT,
  DEFAULT_SPLIT_RATIO,
  DEFAULT_HOME_URL,
  DEFAULT_LOG_LEVEL,
  DEFAULT_LOG_FILE,
  DEFAULT_MAX_LOG_SIZE,
  DEFAULT_MAX_LOG_FILES
} from '../shared/constants';
import { loadLLMConfig } from '../shared/llm-config-loader';

/**
 * 配置管理器类
 */
export class ConfigManager {
  private store: Store<AppConfig>;
  private config: AppConfig;

  constructor() {
    // 初始化electron-store
    this.store = new Store<AppConfig>({
      name: 'config',
      cwd: app.getPath('userData'),
      fileExtension: 'json',
      defaults: this.getDefaultConfig()
    });

    // 加载配置
    this.config = this.store.store;

    console.log('ConfigManager: Initialized');
    console.log('ConfigManager: Config path:', this.store.path);
  }

  /**
   * 加载配置
   */
  async load(): Promise<AppConfig> {
    console.log('ConfigManager: Loading configuration');

    try {
      // 从store加载配置
      this.config = this.store.store;

      // 迁移：确保 piAgent 配置与 llm-config.json 保持同步
      const llm = loadLLMConfig();
      if (llm.apiKey && this.config.piAgent?.apiKey !== llm.apiKey) {
        console.log('ConfigManager: Syncing piAgent config from llm-config.json');
        this.config.piAgent.provider = llm.provider as any;
        this.config.piAgent.baseURL = llm.baseURL;
        this.config.piAgent.apiKey = llm.apiKey;
        this.config.piAgent.model = llm.model;
        this.store.set('piAgent', this.config.piAgent);
      }

      // 验证配置
      if (!this.validate(this.config)) {
        console.warn('ConfigManager: Invalid configuration, using defaults');
        this.config = this.getDefaultConfig();
        await this.save(this.config);
      }

      // 强制刷新运行时路径（这些路径依赖 app.isPackaged / process.resourcesPath，
      // 不应该被 electron-store 缓存，否则旧版本缓存的错误路径会导致 skills 加载失败）
      if (this.config.skills) {
        this.config.skills.skillsDir = getSkillsDir();
        this.config.skills.scriptsDir = getScriptsDir();
        console.log('ConfigManager: Runtime paths refreshed', {
          skillsDir: this.config.skills.skillsDir,
          scriptsDir: this.config.skills.scriptsDir
        });
      }

      console.log('ConfigManager: Configuration loaded');
      return this.config;
    } catch (error) {
      console.error('ConfigManager: Failed to load configuration:', error);
      // 返回默认配置
      this.config = this.getDefaultConfig();
      return this.config;
    }
  }

  /**
   * 保存配置
   */
  async save(config: AppConfig): Promise<void> {
    console.log('ConfigManager: Saving configuration');

    try {
      // 验证配置
      if (!this.validate(config)) {
        throw new Error('Invalid configuration');
      }

      // 保存到store
      this.store.store = config;
      this.config = config;

      console.log('ConfigManager: Configuration saved');
    } catch (error) {
      console.error('ConfigManager: Failed to save configuration:', error);
      throw error;
    }
  }

  /**
   * 获取配置项
   */
  get<K extends keyof AppConfig>(key: K): AppConfig[K] {
    return this.config[key];
  }

  /**
   * 设置配置项
   */
  async set<K extends keyof AppConfig>(key: K, value: AppConfig[K]): Promise<void> {
    console.log(`ConfigManager: Setting ${key}`);

    try {
      // 更新配置
      this.config[key] = value;

      // 验证并保存
      await this.save(this.config);
    } catch (error) {
      console.error(`ConfigManager: Failed to set ${key}:`, error);
      throw error;
    }
  }

  /**
   * 更新部分配置
   */
  async update(partialConfig: Partial<AppConfig>): Promise<void> {
    console.log('ConfigManager: Updating configuration');

    try {
      // 合并配置
      const newConfig: AppConfig = {
        ...this.config,
        ...partialConfig
      };

      // 保存新配置
      await this.save(newConfig);
    } catch (error) {
      console.error('ConfigManager: Failed to update configuration:', error);
      throw error;
    }
  }

  /**
   * 验证配置有效性
   */
  validate(config: Partial<AppConfig>): boolean {
    console.log('ConfigManager: Validating configuration');

    try {
      // 验证版本
      if (config.version && typeof config.version !== 'string') {
        console.error('ConfigManager: Invalid version');
        return false;
      }

      // 验证Pi Agent配置
      if (config.piAgent) {
        if (!this.validatePiAgentConfig(config.piAgent)) {
          return false;
        }
      }

      // 验证窗口配置
      if (config.window) {
        if (!this.validateWindowConfig(config.window)) {
          return false;
        }
      }

      // 验证WebView配置
      if (config.webView) {
        if (!this.validateWebViewConfig(config.webView)) {
          return false;
        }
      }

      // 验证日志配置
      if (config.logging) {
        if (!this.validateLoggingConfig(config.logging)) {
          return false;
        }
      }

      console.log('ConfigManager: Configuration is valid');
      return true;
    } catch (error) {
      console.error('ConfigManager: Validation error:', error);
      return false;
    }
  }

  /**
   * 验证Pi Agent配置
   */
  private validatePiAgentConfig(config: Partial<PiAgentConfig>): boolean {
    // 验证provider
    if (config.provider) {
      const validProviders = ['anthropic', 'openai', 'google', 'azure', 'ollama'];
      if (!validProviders.includes(config.provider)) {
        console.error('ConfigManager: Invalid Pi Agent provider');
        return false;
      }
    }

    // 验证model
    if (config.model && typeof config.model !== 'string') {
      console.error('ConfigManager: Invalid Pi Agent model');
      return false;
    }

    // 验证apiKey — 必须是非空字符串
    if (config.apiKey !== undefined) {
      if (typeof config.apiKey !== 'string' || config.apiKey.trim().length === 0) {
        console.error('ConfigManager: Invalid or empty Pi Agent API key');
        return false;
      }
    }

    // 验证temperature
    if (config.temperature !== undefined) {
      if (typeof config.temperature !== 'number' || config.temperature < 0 || config.temperature > 2) {
        console.error('ConfigManager: Invalid Pi Agent temperature');
        return false;
      }
    }

    // 验证maxTokens
    if (config.maxTokens !== undefined) {
      if (typeof config.maxTokens !== 'number' || config.maxTokens < 1) {
        console.error('ConfigManager: Invalid Pi Agent maxTokens');
        return false;
      }
    }

    return true;
  }

  /**
   * 验证窗口配置
   */
  private validateWindowConfig(config: Partial<WindowConfig>): boolean {
    // 验证尺寸
    if (config.width !== undefined) {
      if (typeof config.width !== 'number' || config.width < MIN_WINDOW_WIDTH) {
        console.error('ConfigManager: Invalid window width');
        return false;
      }
    }

    if (config.height !== undefined) {
      if (typeof config.height !== 'number' || config.height < MIN_WINDOW_HEIGHT) {
        console.error('ConfigManager: Invalid window height');
        return false;
      }
    }

    // 验证splitRatio
    if (config.splitRatio !== undefined) {
      if (typeof config.splitRatio !== 'number' || config.splitRatio < 0 || config.splitRatio > 1) {
        console.error('ConfigManager: Invalid split ratio');
        return false;
      }
    }

    return true;
  }

  /**
   * 验证WebView配置
   */
  private validateWebViewConfig(config: Partial<WebViewConfig>): boolean {
    // 验证defaultURL
    if (config.defaultURL && typeof config.defaultURL !== 'string') {
      console.error('ConfigManager: Invalid default URL');
      return false;
    }

    // 验证布尔值
    if (config.enableJavaScript !== undefined && typeof config.enableJavaScript !== 'boolean') {
      console.error('ConfigManager: Invalid enableJavaScript');
      return false;
    }

    if (config.enablePlugins !== undefined && typeof config.enablePlugins !== 'boolean') {
      console.error('ConfigManager: Invalid enablePlugins');
      return false;
    }

    if (config.allowPopups !== undefined && typeof config.allowPopups !== 'boolean') {
      console.error('ConfigManager: Invalid allowPopups');
      return false;
    }

    return true;
  }

  /**
   * 验证日志配置
   */
  private validateLoggingConfig(config: Partial<LoggingConfig>): boolean {
    // 验证level
    if (config.level) {
      const validLevels = ['debug', 'info', 'warn', 'error'];
      if (!validLevels.includes(config.level)) {
        console.error('ConfigManager: Invalid log level');
        return false;
      }
    }

    // 验证filePath
    if (config.filePath && typeof config.filePath !== 'string') {
      console.error('ConfigManager: Invalid log file path');
      return false;
    }

    // 验证maxFileSize
    if (config.maxFileSize !== undefined) {
      if (typeof config.maxFileSize !== 'number' || config.maxFileSize < 1) {
        console.error('ConfigManager: Invalid max file size');
        return false;
      }
    }

    // 验证maxFiles
    if (config.maxFiles !== undefined) {
      if (typeof config.maxFiles !== 'number' || config.maxFiles < 1) {
        console.error('ConfigManager: Invalid max files');
        return false;
      }
    }

    return true;
  }

  /**
   * 验证API密钥
   */
  async validateApiKey(apiKey: string): Promise<boolean> {
    console.log('ConfigManager: Validating API key');

    // 基本验证
    if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
      console.error('ConfigManager: API key is empty');
      return false;
    }

    // TODO: 实现实际的API密钥验证（调用API测试）
    // 当前只做基本格式验证
    if (apiKey.length < 10) {
      console.error('ConfigManager: API key too short');
      return false;
    }

    console.log('ConfigManager: API key is valid');
    return true;
  }

  /**
   * 获取默认配置
   */
  getDefaultConfig(): AppConfig {
    const llm = loadLLMConfig();
    const dbConfig = this.loadDBConfig();
    return {
      version: APP_VERSION,
      piAgent: {
        provider: llm.provider as any,
        model: llm.model,
        apiKey: llm.apiKey,
        baseURL: llm.baseURL,
        temperature: llm.temperature,
        maxTokens: llm.maxTokens
      },
      window: {
        width: DEFAULT_WINDOW_WIDTH,
        height: DEFAULT_WINDOW_HEIGHT,
        minWidth: MIN_WINDOW_WIDTH,
        minHeight: MIN_WINDOW_HEIGHT,
        splitRatio: DEFAULT_SPLIT_RATIO,
        rememberPosition: false
      },
      webView: {
        defaultURL: DEFAULT_HOME_URL,
        enableJavaScript: true,
        enablePlugins: false,
        allowPopups: false
      },
      logging: {
        level: DEFAULT_LOG_LEVEL as 'info',
        filePath: path.join(app.getPath('userData'), DEFAULT_LOG_FILE),
        maxFileSize: DEFAULT_MAX_LOG_SIZE,
        maxFiles: DEFAULT_MAX_LOG_FILES
      },
      skills: {
        enabled: true,
        skillsDir: getSkillsDir(),
        scriptsDir: getScriptsDir(),
        defaultTimeout: 120000,
        maxConcurrent: 5,
        autoReload: false,
        disabledSkills: [],
        skillConfigs: {}
      },
      database: dbConfig,
      language: 'zh'
    };
  }

  /**
   * 从 db-config.json 加载数据库配置
   */
  private loadDBConfig(): { host: string; port: number; user: string; password: string } {
    const fallback = { host: '', port: 3306, user: '', password: '' };

    // 1. 尝试加密文件
    const encPath = getDBConfigPath().replace(/\.json$/, '.enc');
    if (fs.existsSync(encPath) && safeStorage.isEncryptionAvailable()) {
      try {
        const buf = fs.readFileSync(encPath);
        const json = safeStorage.decryptString(buf);
        const parsed = JSON.parse(json);
        return { host: parsed.host || '', port: parsed.port || 3306, user: parsed.user || '', password: parsed.password || '' };
      } catch (err) {
        console.warn('ConfigManager: Failed to decrypt db-config.enc', err);
      }
    }

    // 2. 尝试明文文件（自动迁移到加密）
    const jsonPaths = [
      getDBConfigPath(),
      path.join(process.cwd(), 'db-config.json'),
      // 打包模式：extraResources 放在 resourcesPath 下
      ...(app.isPackaged ? [path.join(process.resourcesPath, 'db-config.json')] : []),
    ];
    for (const jsonPath of jsonPaths) {
      if (!fs.existsSync(jsonPath)) continue;
      try {
        const content = fs.readFileSync(jsonPath, 'utf-8');
        const parsed = JSON.parse(content);
        const result = { host: parsed.host || '', port: parsed.port || 3306, user: parsed.user || '', password: parsed.password || '' };

        // 迁移：加密保存，删除明文
        if (safeStorage.isEncryptionAvailable()) {
          const encrypted = safeStorage.encryptString(JSON.stringify(result));
          fs.writeFileSync(encPath, encrypted);
          try { fs.unlinkSync(jsonPath); } catch {}
          console.log('ConfigManager: db-config migrated to encrypted store');
        }
        return result;
      } catch {}
    }

    console.warn('ConfigManager: No db-config found');
    return fallback;
  }

  /**
   * 获取 electron-store 实例
   */
  getStore(): Store<AppConfig> {
    return this.store;
  }

  /**
   * 重置为默认配置
   */
  async reset(): Promise<void> {
    console.log('ConfigManager: Resetting to default configuration');

    try {
      const defaultConfig = this.getDefaultConfig();
      await this.save(defaultConfig);
      console.log('ConfigManager: Configuration reset');
    } catch (error) {
      console.error('ConfigManager: Failed to reset configuration:', error);
      throw error;
    }
  }

  /**
   * 获取当前配置
   */
  getConfig(): AppConfig {
    return { ...this.config };
  }

  /**
   * 获取配置文件路径
   */
  getConfigPath(): string {
    return this.store.path;
  }

  /**
   * 检查是否是首次运行
   */
  isFirstRun(): boolean {
    // 如果API密钥为空，认为是首次运行
    return !this.config.piAgent.apiKey || this.config.piAgent.apiKey.trim().length === 0;
  }
}
