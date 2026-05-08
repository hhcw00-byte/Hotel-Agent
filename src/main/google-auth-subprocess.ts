/**
 * Google Auth Subprocess - 独立 Electron 进程，完整伪装为 Chrome
 *
 * 这个脚本作为独立的 Electron 进程运行，不带 --remote-debugging-port。
 * 通过伪造 Client Hints（HTTP 头 + JS API）让 Google 认为这是真正的 Chrome。
 *
 * 启动方式：electron google-auth-subprocess.js <google-auth-url>
 */

import { app, BrowserWindow, session } from 'electron';

// 获取要打开的 URL
const targetUrl = process.argv[process.argv.length - 1] || 'https://accounts.google.com';

// 不要开启任何 CDP 端口 — 这是整个方案的关键
// 也不要加 --disable-web-security 等可疑 flags

// Chrome 版本信息（基于当前 Electron 内置的 Chromium）
const CHROME_MAJOR = process.versions.chrome?.split('.')[0] || '120';
const CHROME_FULL = process.versions.chrome || '120.0.0.0';

/**
 * 构造 Sec-CH-UA 头的品牌列表
 * 真正的 Chrome 格式：
 *   "Google Chrome";v="120", "Chromium";v="120", "Not_A Brand";v="24"
 * Electron 默认只有 Chromium，缺少 "Google Chrome"
 */
function buildSecChUa(): string {
  return `"Google Chrome";v="${CHROME_MAJOR}", "Chromium";v="${CHROME_MAJOR}", "Not_A Brand";v="24"`;
}

function buildSecChUaFullVersionList(): string {
  return `"Google Chrome";v="${CHROME_FULL}", "Chromium";v="${CHROME_FULL}", "Not_A Brand";v="24.0.0.0"`;
}

app.whenReady().then(async () => {
  const ses = session.defaultSession;

  // ============================================================
  // 🔥 核心伪装 1：拦截 HTTP 头，注入 Chrome 品牌的 Client Hints
  // ============================================================
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = { ...details.requestHeaders };

    // 替换 User-Agent（去掉 Electron 标识）
    const cleanUA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_FULL} Safari/537.36`;
    headers['User-Agent'] = cleanUA;

    // 注入/替换 Client Hints 头
    headers['Sec-CH-UA'] = buildSecChUa();
    headers['Sec-CH-UA-Mobile'] = '?0';
    headers['Sec-CH-UA-Platform'] = '"Windows"';
    headers['Sec-CH-UA-Platform-Version'] = '"15.0.0"';
    headers['Sec-CH-UA-Full-Version-List'] = buildSecChUaFullVersionList();
    headers['Sec-CH-UA-Arch'] = '"x86"';
    headers['Sec-CH-UA-Bitness'] = '"64"';
    headers['Sec-CH-UA-Model'] = '""';
    headers['Sec-CH-UA-WoW64'] = '?0';

    callback({ requestHeaders: headers });
  });

  // ============================================================
  // 🔥 核心伪装 2：JS 层覆盖 navigator.userAgentData
  // ============================================================
  const uaDataScript = `
    // 覆盖 navigator.userAgentData，让 JS 检测也看到 "Google Chrome"
    if (navigator.userAgentData) {
      const originalUAData = navigator.userAgentData;
      const fakeBrands = [
        { brand: "Google Chrome", version: "${CHROME_MAJOR}" },
        { brand: "Chromium", version: "${CHROME_MAJOR}" },
        { brand: "Not_A Brand", version: "24" }
      ];

      const fakeUAData = {
        brands: fakeBrands,
        mobile: false,
        platform: "Windows",
        getHighEntropyValues: function(hints) {
          return Promise.resolve({
            brands: fakeBrands,
            mobile: false,
            platform: "Windows",
            platformVersion: "15.0.0",
            architecture: "x86",
            bitness: "64",
            model: "",
            uaFullVersion: "${CHROME_FULL}",
            fullVersionList: [
              { brand: "Google Chrome", version: "${CHROME_FULL}" },
              { brand: "Chromium", version: "${CHROME_FULL}" },
              { brand: "Not_A Brand", version: "24.0.0.0" }
            ],
            wow64: false
          });
        },
        toJSON: function() {
          return { brands: fakeBrands, mobile: false, platform: "Windows" };
        }
      };

      Object.defineProperty(navigator, 'userAgentData', {
        get: function() { return fakeUAData; },
        configurable: false
      });
    }

    // 覆盖 navigator.userAgent（去掉 Electron 标识）
    Object.defineProperty(navigator, 'userAgent', {
      get: function() {
        return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_FULL} Safari/537.36";
      },
      configurable: false
    });

    // 覆盖 navigator.appVersion
    Object.defineProperty(navigator, 'appVersion', {
      get: function() {
        return "5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_FULL} Safari/537.36";
      },
      configurable: false
    });

    // 确保 window.chrome 对象存在且像真正的 Chrome
    if (!window.chrome) {
      window.chrome = {};
    }
    if (!window.chrome.runtime) {
      window.chrome.runtime = {
        connect: function() {},
        sendMessage: function() {},
        id: undefined
      };
    }
    if (!window.chrome.loadTimes) {
      window.chrome.loadTimes = function() {
        return {
          commitLoadTime: Date.now() / 1000,
          connectionInfo: "h2",
          finishDocumentLoadTime: Date.now() / 1000,
          finishLoadTime: Date.now() / 1000,
          firstPaintAfterLoadTime: 0,
          firstPaintTime: Date.now() / 1000,
          navigationType: "Other",
          npnNegotiatedProtocol: "h2",
          requestTime: Date.now() / 1000 - 0.16,
          startLoadTime: Date.now() / 1000,
          wasAlternateProtocolAvailable: false,
          wasFetchedViaSpdy: true,
          wasNpnNegotiated: true
        };
      };
    }
    if (!window.chrome.csi) {
      window.chrome.csi = function() {
        return {
          onloadT: Date.now(),
          startE: Date.now(),
          pageT: 3000 + Math.random() * 1000,
          tran: 15
        };
      };
    }

    // 确保 navigator.webdriver 为 false
    Object.defineProperty(navigator, 'webdriver', {
      get: function() { return false; },
      configurable: false
    });

    // 确保 navigator.plugins 不为空（Electron 默认没有插件）
    if (navigator.plugins.length === 0) {
      Object.defineProperty(navigator, 'plugins', {
        get: function() {
          return [
            { name: "PDF Viewer", filename: "internal-pdf-viewer", description: "Portable Document Format" },
            { name: "Chrome PDF Plugin", filename: "internal-pdf-viewer", description: "Portable Document Format" },
            { name: "Chromium PDF Plugin", filename: "internal-pdf-viewer", description: "Portable Document Format" },
            { name: "Microsoft Edge PDF Plugin", filename: "internal-pdf-viewer", description: "Portable Document Format" },
            { name: "WebKit built-in PDF", filename: "internal-pdf-viewer", description: "Portable Document Format" }
          ];
        },
        configurable: false
      });
    }

    // 确保 navigator.languages 正常
    Object.defineProperty(navigator, 'languages', {
      get: function() { return ["zh-CN", "zh", "en-US", "en"]; },
      configurable: false
    });
  `;

  // ============================================================
  // 创建窗口
  // ============================================================
  const win = new BrowserWindow({
    width: 500,
    height: 700,
    title: 'Google 账号登录',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
    center: true,
    minimizable: false,
    maximizable: false,
    resizable: true,
  });

  // 设置干净的 Chrome User-Agent
  const cleanUA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_FULL} Safari/537.36`;
  win.webContents.setUserAgent(cleanUA);

  // 🔥 在每个页面（包括 iframe）加载前注入伪装脚本
  // 这样 Google 的检测脚本无论在主页面还是 iframe 里运行，都会看到一致的 Chrome 指纹
  win.webContents.on('did-start-navigation', () => {
    win.webContents.executeJavaScript(uaDataScript).catch(() => {});
  });

  // dom-ready 时再注入一次，确保覆盖
  win.webContents.on('dom-ready', () => {
    win.webContents.executeJavaScript(uaDataScript).catch(() => {});
  });

  // ============================================================
  // 监听导航变化，检测登录完成
  // ============================================================
  let loginDetected = false;

  win.webContents.on('did-navigate', async (_event, url) => {
    logToStderr('Navigated to: ' + url);

    if (loginDetected) return;

    if (isLoginComplete(url)) {
      loginDetected = true;
      logToStderr('Login appears complete, waiting for cookies to settle...');
      await sleep(2000);
      await exportCookiesAndExit();
    }
  });

  win.webContents.on('did-navigate-in-page', async (_event, url) => {
    if (loginDetected) return;

    if (isLoginComplete(url)) {
      loginDetected = true;
      logToStderr('Login complete (in-page navigation)');
      await sleep(2000);
      await exportCookiesAndExit();
    }
  });

  // 用户关闭窗口 = 取消登录
  win.on('closed', () => {
    if (!loginDetected) {
      outputResult({ success: false, error: 'User closed the login window' });
      app.quit();
    }
  });

  // 加载 Google 登录页面
  try {
    await win.loadURL(targetUrl);
    logToStderr('Loaded: ' + targetUrl);
  } catch (error) {
    outputResult({ success: false, error: 'Failed to load URL: ' + String(error) });
    app.quit();
  }
});

/**
 * 判断当前 URL 是否表示登录已完成
 */
function isLoginComplete(url: string): boolean {
  const lower = url.toLowerCase();

  if (lower.includes('myaccount.google.com')) return true;
  if (lower.includes('google.com/webhp')) return true;
  if (lower.includes('google.com/?')) return true;

  // OAuth 回调
  if (lower.includes('oauth2/callback') || lower.includes('oauth/callback')) return true;

  // 已经不在 accounts.google.com 了（排除一些中间页面）
  if (!lower.includes('accounts.google.com') &&
      !lower.includes('accounts.youtube.com') &&
      !lower.includes('gds.google.com') &&
      !lower.includes('consent.google.com') &&
      lower.startsWith('https://')) {
    return true;
  }

  return false;
}

/**
 * 导出所有 Google 相关的 cookie 并退出
 */
async function exportCookiesAndExit(): Promise<void> {
  try {
    const ses = session.defaultSession;

    const googleDomains = [
      '.google.com',
      '.accounts.google.com',
      '.youtube.com',
      '.googleapis.com',
      '.google.com.hk',
      '.google.co.jp',
    ];

    const allCookies: any[] = [];

    for (const domain of googleDomains) {
      try {
        const cookies = await ses.cookies.get({ domain });
        for (const c of cookies) {
          allCookies.push({
            name: c.name,
            value: c.value,
            domain: c.domain,
            path: c.path,
            secure: c.secure,
            httpOnly: c.httpOnly,
            sameSite: c.sameSite,
            expirationDate: c.expirationDate,
          });
        }
      } catch {}
    }

    // 去重
    const seen = new Set<string>();
    const uniqueCookies = allCookies.filter(c => {
      const key = `${c.name}|${c.domain}|${c.path}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    logToStderr(`Exporting ${uniqueCookies.length} unique cookies`);

    outputResult({
      success: true,
      cookies: uniqueCookies,
    });
  } catch (error) {
    outputResult({ success: false, error: 'Failed to export cookies: ' + String(error) });
  }

  setTimeout(() => app.quit(), 500);
}

function outputResult(result: any): void {
  process.stdout.write(JSON.stringify(result));
}

function logToStderr(msg: string): void {
  process.stderr.write(`[GoogleAuthSubprocess] ${msg}\n`);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

process.on('uncaughtException', (error) => {
  logToStderr('Uncaught exception: ' + String(error));
  outputResult({ success: false, error: 'Uncaught exception: ' + String(error) });
  setTimeout(() => process.exit(1), 100);
});
