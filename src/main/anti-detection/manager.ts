// 反检测管理器 - 主控制器

// 使用 any 类型以兼容 Playwright 和 Electron
type Browser = any;
type Page = any;
type BrowserContext = any;

import { removeWebDriverMarkers } from './scripts/webdriver-remover';
import { protectCanvasFingerprint } from './scripts/canvas-protector';
import { applyExtraProtections } from './scripts/extra-protections';
import { MouseSimulator } from './behavior/mouse-simulator';
import { NetworkProtector } from './network/network-protector';
import { EnvironmentConfigurator } from './environment/env-configurator';
import { AntiDetectionConfig } from './types';

/**
 * 反检测管理器
 * 统一管理所有反检测策略的初始化和配置
 */
export class AntiDetectionManager {
  private config: AntiDetectionConfig;
  private mouseSimulator: MouseSimulator;

  constructor(config?: Partial<AntiDetectionConfig>) {
    this.config = this.mergeWithDefaults(config);
    this.mouseSimulator = new MouseSimulator();
  }

  /**
   * 合并默认配置
   * @param config 用户提供的配置
   * @returns 完整的配置对象
   */
  private mergeWithDefaults(
    config?: Partial<AntiDetectionConfig>
  ): AntiDetectionConfig {
    return {
      fingerprint: {
        removeWebDriver: true,
        canvasNoiseLevel: 0.001,
        webglProtection: true,
        ...config?.fingerprint,
      },
      behavior: {
        humanLikeMouse: true,
        speedVariation: 0.3,
        pauseProbability: 0.1,
        ...config?.behavior,
      },
      network: {
        stealthPlugin: true,
        ...config?.network,
      },
      environment: {
        countryCode: 'CN',
        timezone: 'Asia/Shanghai',
        locale: 'zh-CN',
        ...config?.environment,
      },
    };
  }

  /**
   * 初始化浏览器级别的保护
   * @param browser Playwright 浏览器实例
   */
  async initializeBrowser(browser: Browser): Promise<void> {
    console.log('[AntiDetection] Initializing browser protections...');

    // 网络保护已在浏览器启动时通过参数应用
    if (this.config.network.stealthPlugin) {
      console.log('[AntiDetection] Stealth mode enabled');
    }
  }

  /**
   * 初始化浏览器上下文
   * @param context Playwright 浏览器上下文
   */
  async initializeBrowserContext(context: BrowserContext): Promise<void> {
    console.log('[AntiDetection] Initializing browser context protections...');

    try {
      // 配置网络保护
      await NetworkProtector.configureBrowserContext(context);

      // 配置环境
      await EnvironmentConfigurator.configureBrowserContext(context, {
        countryCode: this.config.environment.countryCode,
        timezone: this.config.environment.timezone,
        locale: this.config.environment.locale,
      });

      console.log('[AntiDetection] Browser context protections applied');
    } catch (error) {
      console.error('[AntiDetection] Failed to initialize browser context:', error);
    }
  }

  /**
   * 为页面应用所有保护措施
   * @param page Playwright 页面实例
   */
  async applyProtections(page: Page): Promise<void> {
    console.log('[AntiDetection] Applying page protections...');

    try {
      // 1. 指纹保护
      if (this.config.fingerprint.removeWebDriver) {
        await removeWebDriverMarkers(page);
        console.log('[AntiDetection] ✓ WebDriver markers removed');
      }

      if (this.config.fingerprint.canvasNoiseLevel > 0) {
        await protectCanvasFingerprint(
          page,
          this.config.fingerprint.canvasNoiseLevel
        );
        console.log('[AntiDetection] ✓ Canvas fingerprint protected');
      }

      // 2. 网络保护：合并 User-Agent 和 Headers 为一次调用，避免覆盖
      await NetworkProtector.setHeadersAndUserAgent(
        page,
        this.config.network.customUserAgent
      );
      // JS 层面也覆盖 navigator.userAgent（去除 Electron 标记）
      await NetworkProtector.injectUserAgentOverride(
        page,
        this.config.network.customUserAgent
      );
      console.log('[AntiDetection] ✓ Network headers & UA configured');

      // 3. 额外保护（WebRTC / AudioContext / 硬件信息 / CDP 产物清理）
      await applyExtraProtections(page);
      console.log('[AntiDetection] ✓ Extra protections applied');

      // 4. 环境配置
      await EnvironmentConfigurator.configureEnvironment(page, {
        countryCode: this.config.environment.countryCode,
        timezone: this.config.environment.timezone,
        locale: this.config.environment.locale,
        geolocation: this.config.environment.geolocation,
      });
      await EnvironmentConfigurator.setRealisticViewport(page);
      console.log('[AntiDetection] ✓ Environment configured');

      console.log('[AntiDetection] All protections applied successfully');
    } catch (error) {
      console.error('[AntiDetection] Failed to apply protections:', error);
      throw error;
    }
  }

  /**
   * 获取鼠标模拟器实例
   * @returns 鼠标模拟器
   */
  getMouseSimulator(): MouseSimulator {
    return this.mouseSimulator;
  }

  /**
   * 更新配置
   * @param config 新的配置
   */
  updateConfig(config: Partial<AntiDetectionConfig>): void {
    this.config = this.mergeWithDefaults(config);
    console.log('[AntiDetection] Configuration updated');
  }

  /**
   * 获取当前配置
   * @returns 当前配置的副本
   */
  getConfig(): AntiDetectionConfig {
    return { ...this.config };
  }

  /**
   * 获取浏览器启动参数
   * @returns 启动参数数组
   */
  static getBrowserLaunchArgs(): string[] {
    return NetworkProtector.getBrowserLaunchArgs();
  }
}
