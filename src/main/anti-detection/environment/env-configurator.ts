// 环境配置器

// 使用 any 类型以兼容 Playwright 和 Electron
type Page = any;
type BrowserContext = any;

/**
 * 地理位置接口
 */
interface GeoLocation {
  latitude: number;
  longitude: number;
  accuracy: number;
}

/**
 * 时区与 getTimezoneOffset 偏移量映射（分钟，UTC 偏移取负）
 */
const TIMEZONE_OFFSET_MAP: Record<string, number> = {
  'Asia/Shanghai': -480,      // UTC+8
  'America/New_York': 300,    // UTC-5
  'America/Los_Angeles': 480, // UTC-8
  'Asia/Tokyo': -540,         // UTC+9
  'Europe/London': 0,         // UTC+0
  'Europe/Berlin': -60,       // UTC+1
  'Australia/Sydney': -660,   // UTC+11
};

/**
 * 环境配置器
 * 管理时区、语言、地理位置等环境信息
 */
export class EnvironmentConfigurator {
  /**
   * 时区映射表
   */
  private static readonly TIMEZONE_MAP: Record<string, string> = {
    'CN': 'Asia/Shanghai',
    'US': 'America/New_York',
    'JP': 'Asia/Tokyo',
    'UK': 'Europe/London',
  };

  /**
   * 配置页面环境
   * @param page Playwright 页面实例
   * @param config 配置选项
   */
  static async configureEnvironment(
    page: Page,
    config: {
      countryCode?: string;
      timezone?: string;
      locale?: string;
      geolocation?: GeoLocation;
    }
  ): Promise<void> {
    const {
      countryCode = 'CN',
      timezone = this.TIMEZONE_MAP[countryCode],
      locale = 'zh-CN',
      geolocation,
    } = config;

    try {
      // 设置地理位置
      if (geolocation) {
        await page.context().setGeolocation(geolocation);
      }

      // 计算时区偏移量
      const tzOffset = TIMEZONE_OFFSET_MAP[timezone] ?? -480;

      // 注入环境变量覆盖脚本
      await page.addInitScript(({ tz, loc, offset }: { tz: string; loc: string; offset: number }) => {
        // 1. 覆盖 Intl.DateTimeFormat.resolvedOptions（在 prototype 层面，不破坏 instanceof）
        const originalResolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
        Intl.DateTimeFormat.prototype.resolvedOptions = function() {
          const options = originalResolvedOptions.call(this);
          return {
            ...options,
            timeZone: tz,
          };
        };

        // 2. 覆盖 Date.prototype.getTimezoneOffset（与 Intl 时区保持一致）
        // 这是绝大多数检测脚本验证时区的首选方法
        Date.prototype.getTimezoneOffset = function() {
          return offset;
        };

        // 3. 覆盖语言设置（统一在此处管理，webdriver-remover 不再重复设置）
        Object.defineProperty(navigator, 'language', {
          get: () => loc,
          configurable: true,
        });

        Object.defineProperty(navigator, 'languages', {
          get: () => {
            // 根据 locale 生成合理的语言列表
            const langs = [loc];
            const base = loc.split('-')[0];
            if (base !== loc) langs.push(base);
            if (base !== 'en') {
              langs.push('en-US');
              langs.push('en');
            }
            return Object.freeze(langs);
          },
          configurable: true,
        });
      }, { tz: timezone, loc: locale, offset: tzOffset });

      console.log(`[Environment] Configured: timezone=${timezone}, locale=${locale}, offset=${tzOffset}`);
    } catch (error) {
      console.error('[Environment Configurator] Failed to configure environment:', error);
    }
  }

  /**
   * 设置视口大小（模拟真实设备）
   * @param page Playwright 页面实例
   */
  static async setRealisticViewport(page: Page): Promise<void> {
    const viewports = [
      { width: 1920, height: 1080 },
      { width: 1366, height: 768 },
      { width: 1536, height: 864 },
      { width: 1440, height: 900 },
    ];

    try {
      const viewport = viewports[Math.floor(Math.random() * viewports.length)];
      await page.setViewportSize(viewport);
      console.log(`[Environment] Viewport set to ${viewport.width}x${viewport.height}`);
    } catch (error) {
      console.error('[Environment Configurator] Failed to set viewport:', error);
    }
  }

  /**
   * 配置浏览器上下文的时区和语言
   * 注意：Playwright 的 timezoneId 和 locale 需要在 browser.newContext() 时传入才能生效
   * 此方法仅作为日志记录和文档说明，实际配置需在创建 context 时完成：
   *   browser.newContext({ timezoneId: 'Asia/Shanghai', locale: 'zh-CN' })
   * @param context Playwright 浏览器上下文
   * @param config 配置选项
   */
  static async configureBrowserContext(
    context: BrowserContext,
    config: {
      countryCode?: string;
      timezone?: string;
      locale?: string;
    }
  ): Promise<void> {
    const {
      countryCode = 'CN',
      timezone = this.TIMEZONE_MAP[countryCode],
      locale = 'zh-CN',
    } = config;

    try {
      // Playwright context 级别的 timezoneId/locale 只能在 newContext 时设置
      // 对于通过 CDP 连接的 Electron 浏览器，我们通过 page.addInitScript 在 JS 层注入
      // 这里记录预期配置，便于调试
      console.log(`[Environment] Browser context target: timezone=${timezone}, locale=${locale}`);
      console.log('[Environment] Note: JS-level timezone/locale override applied via page.addInitScript');
    } catch (error) {
      console.error('[Environment Configurator] Failed to configure browser context:', error);
    }
  }
}
