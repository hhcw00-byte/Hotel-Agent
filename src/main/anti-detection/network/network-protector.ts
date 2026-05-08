// 网络指纹保护器

// 使用 any 类型以兼容 Playwright 和 Electron
type Page = any;
type BrowserContext = any;

/**
 * 网络保护器
 * 确保 TLS/HTTP/2 指纹正常，统一管理 User-Agent 和 HTTP Headers
 */
export class NetworkProtector {
  /**
   * 配置浏览器启动参数
   * @returns 启动参数数组
   */
  static getBrowserLaunchArgs(): string[] {
    return [
      '--disable-blink-features=AutomationControlled',
      // Chromium 只认最后一个 --disable-features，所以必须合并到一条
      '--disable-features=IsolateOrigins,site-per-process,VizDisplayCompositor,RendererCodeIntegrity',
      '--disable-web-security',
      '--disable-dev-shm-usage',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
      // TLS/HTTP2 相关
      '--enable-features=NetworkService,NetworkServiceInProcess',
    ];
  }

  /**
   * 获取真实的 User-Agent
   * 动态使用当前 Electron 内置的 Chrome 版本号，避免版本过旧
   * @returns User-Agent 字符串
   */
  static getRealisticUserAgent(): string {
    // 优先使用 Electron 内置的 Chrome 版本号
    const chromeVersion = process.versions.chrome || '131.0.0.0';
    const platform = process.platform === 'win32' ? 'Windows NT 10.0; Win64; x64' :
                     process.platform === 'darwin' ? 'Macintosh; Intel Mac OS X 10_15_7' :
                     'X11; Linux x86_64';

    return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
  }

  /**
   * 统一设置 User-Agent 和额外 HTTP Headers（合并为一次调用，避免覆盖）
   * @param page Playwright 页面实例
   * @param customUserAgent 自定义 User-Agent（可选）
   */
  static async setHeadersAndUserAgent(page: Page, customUserAgent?: string): Promise<void> {
    try {
      const ua = customUserAgent || this.getRealisticUserAgent();

      // Playwright 的 setExtraHTTPHeaders 是替换模式（非合并）
      // 因此必须在一次调用中设置所有 headers
      // 注意：不设置 Sec-Fetch-* headers，这些由浏览器根据请求类型自动管理
      // 手动设置固定值反而会暴露自动化特征
      await page.setExtraHTTPHeaders({
        'User-Agent': ua,
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
      });
    } catch (error) {
      console.error('[Network Protector] Failed to set headers:', error);
    }
  }

  /**
   * 注入 navigator.userAgent 覆盖脚本
   * 在 JS 层面也将 Electron 的 UA 替换为纯 Chrome UA
   * @param page Playwright 页面实例
   * @param customUserAgent 自定义 User-Agent（可选）
   */
  static async injectUserAgentOverride(page: Page, customUserAgent?: string): Promise<void> {
    const ua = customUserAgent || this.getRealisticUserAgent();
    // 转义特殊字符，防止注入到 JS 字符串字面量时语法错误
    const safeUA = ua.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const safeAppVersion = ua.replace('Mozilla/', '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    try {
      await page.addInitScript(`
        Object.defineProperty(navigator, 'userAgent', {
          get: () => '${safeUA}',
          configurable: true
        });
        Object.defineProperty(navigator, 'appVersion', {
          get: () => '${safeAppVersion}',
          configurable: true
        });
      `);
    } catch (error) {
      console.error('[Network Protector] Failed to inject UA override:', error);
    }
  }

  /**
   * 配置浏览器上下文
   * @param context Playwright 浏览器上下文
   */
  static async configureBrowserContext(context: BrowserContext): Promise<void> {
    try {
      // 设置默认的导航超时
      context.setDefaultNavigationTimeout(30000);

      // 设置默认的超时
      context.setDefaultTimeout(30000);
    } catch (error) {
      console.error('[Network Protector] Failed to configure browser context:', error);
    }
  }

  /**
   * 构建 Sec-CH-UA 品牌头
   * 真实 Chrome 格式："Google Chrome";v="120", "Chromium";v="120", "Not_A Brand";v="24"
   * Electron 默认只有 Chromium，缺少 "Google Chrome" — 这是 Booking 等高级反机器人的核心检测点
   */
  static buildSecChUa(): string {
    const major = (process.versions.chrome || '120.0.0.0').split('.')[0];
    return `"Google Chrome";v="${major}", "Chromium";v="${major}", "Not_A Brand";v="24"`;
  }

  static buildSecChUaFullVersionList(): string {
    const full = process.versions.chrome || '120.0.0.0';
    return `"Google Chrome";v="${full}", "Chromium";v="${full}", "Not_A Brand";v="24.0.0.0"`;
  }

  /**
   * 在 Electron session 级别拦截所有 HTTP 请求，注入 Chrome Client Hints 头
   * 这是 HTTP 层面的伪装，与 JS 层面的 navigator.userAgentData 配合使用
   * @param ses Electron session 实例
   */
  static setupSessionClientHints(ses: any): void {
    const ua = this.getRealisticUserAgent();
    const secChUa = this.buildSecChUa();
    const secChUaFull = this.buildSecChUaFullVersionList();
    const platformName = process.platform === 'win32' ? '"Windows"' :
                         process.platform === 'darwin' ? '"macOS"' :
                         '"Linux"';

    ses.webRequest.onBeforeSendHeaders((details: any, callback: any) => {
      const headers = { ...details.requestHeaders };

      // 清理 UA 中的 Electron 标识（Electron 默认 UA 包含 "Electron/28.x.x"）
      if (headers['User-Agent'] && headers['User-Agent'].includes('Electron')) {
        headers['User-Agent'] = ua;
      }

      // 注入 Client Hints 头（只在缺失或包含 Electron 时注入，避免覆盖已有的正确值）
      if (!headers['Sec-CH-UA'] || headers['Sec-CH-UA'].includes('Electron')) {
        headers['Sec-CH-UA'] = secChUa;
      }
      if (!headers['Sec-CH-UA-Mobile']) {
        headers['Sec-CH-UA-Mobile'] = '?0';
      }
      if (!headers['Sec-CH-UA-Platform']) {
        headers['Sec-CH-UA-Platform'] = platformName;
      }
      if (!headers['Sec-CH-UA-Full-Version-List']) {
        headers['Sec-CH-UA-Full-Version-List'] = secChUaFull;
      }

      callback({ requestHeaders: headers });
    });

    console.log('[Network Protector] Session-level Client Hints interception enabled');
  }
}
