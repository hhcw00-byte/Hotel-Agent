// WebDriver 标记移除脚本

// 使用 any 类型以兼容 Playwright 和 Electron
type Page = any;

/**
 * WebDriver 移除脚本
 * 在页面加载前注入，移除自动化标记
 */
export const WEBDRIVER_REMOVER_SCRIPT = `
  // 1. navigator.webdriver 返回 false（真实 Chrome 非自动化时为 false，不是 undefined）
  Object.defineProperty(navigator, 'webdriver', {
    get: () => false,
    configurable: true
  });

  // 确保原型链上也干净
  if (Object.getPrototypeOf(navigator).hasOwnProperty('webdriver')) {
    Object.defineProperty(Object.getPrototypeOf(navigator), 'webdriver', {
      get: () => false,
      configurable: true
    });
  }

  // 2. 覆盖 Chrome Runtime（模拟真实 Chrome 对象结构）
  if (!window.chrome) {
    window.chrome = {};
  }
  if (!window.chrome.runtime) {
    window.chrome.runtime = {
      connect: function() {},
      sendMessage: function() {}
    };
  }
  if (!window.chrome.loadTimes) {
    window.chrome.loadTimes = function() {
      return {
        commitLoadTime: Date.now() / 1000,
        connectionInfo: 'http/1.1',
        finishDocumentLoadTime: Date.now() / 1000,
        finishLoadTime: Date.now() / 1000,
        firstPaintAfterLoadTime: 0,
        firstPaintTime: Date.now() / 1000,
        navigationType: 'Other',
        npnNegotiatedProtocol: 'unknown',
        requestTime: Date.now() / 1000,
        startLoadTime: Date.now() / 1000,
        wasAlternateProtocolAvailable: false,
        wasFetchedViaSpdy: false,
        wasNpnNegotiated: false
      };
    };
  }
  if (!window.chrome.csi) {
    window.chrome.csi = function() {
      return {
        onloadT: Date.now(),
        pageT: Math.random() * 1000 + 100,
        startE: Date.now(),
        tran: 15
      };
    };
  }

  // 3. 覆盖 permissions（避免 notifications 权限查询异常）
  const originalQuery = window.navigator.permissions.query.bind(window.navigator.permissions);
  window.navigator.permissions.query = (parameters) => (
    parameters.name === 'notifications' ?
      Promise.resolve({ state: Notification.permission }) :
      originalQuery(parameters)
  );

  // 4. 构造真实的 plugins 对象
  // 真实 Chrome 有 PDF Viewer 等插件，每个 plugin 有 name/description/filename/length
  (function() {
    const fakePlugins = [
      {
        name: 'PDF Viewer',
        description: 'Portable Document Format',
        filename: 'internal-pdf-viewer',
        mimeTypes: [
          { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format' }
        ]
      },
      {
        name: 'Chrome PDF Viewer',
        description: 'Portable Document Format',
        filename: 'internal-pdf-viewer',
        mimeTypes: [
          { type: 'application/x-google-chrome-pdf', suffixes: 'pdf', description: '' }
        ]
      },
      {
        name: 'Chromium PDF Viewer',
        description: 'Portable Document Format',
        filename: 'internal-pdf-viewer',
        mimeTypes: [
          { type: 'application/x-nacl', suffixes: '', description: 'Native Client Executable' }
        ]
      },
      {
        name: 'Microsoft Edge PDF Viewer',
        description: 'Portable Document Format',
        filename: 'internal-pdf-viewer',
        mimeTypes: []
      },
      {
        name: 'WebKit built-in PDF',
        description: 'Portable Document Format',
        filename: 'internal-pdf-viewer',
        mimeTypes: []
      }
    ];

    // 构建符合 Plugin 接口的对象
    function makePlugin(info) {
      const plugin = {};
      plugin.name = info.name;
      plugin.description = info.description;
      plugin.filename = info.filename;
      plugin.length = info.mimeTypes.length;
      for (let i = 0; i < info.mimeTypes.length; i++) {
        plugin[i] = info.mimeTypes[i];
      }
      plugin[Symbol.iterator] = function*() {
        for (let i = 0; i < info.mimeTypes.length; i++) {
          yield info.mimeTypes[i];
        }
      };
      return plugin;
    }

    const pluginArray = fakePlugins.map(makePlugin);

    // 让 pluginArray 表现得像 PluginArray
    pluginArray.item = function(index) { return this[index] || null; };
    pluginArray.namedItem = function(name) {
      return this.find(function(p) { return p.name === name; }) || null;
    };
    pluginArray.refresh = function() {};

    // 在 getter 外部一次性设置 toStringTag，避免重复 defineProperty 导致 TypeError
    Object.defineProperty(pluginArray, Symbol.toStringTag, { value: 'PluginArray', configurable: true });

    Object.defineProperty(navigator, 'plugins', {
      get: () => pluginArray,
      configurable: true
    });
  })();

  // 5. 清除其他自动化痕迹
  // 移除 Selenium / PhantomJS / Nightmare 等标记
  delete window.__selenium_unwrapped;
  delete window.__selenium_evaluate;
  delete window.__fxdriver_evaluate;
  delete window.__driver_evaluate;
  delete window.__webdriver_evaluate;
  delete window.__lastWatirAlert;
  delete window.__lastWatirConfirm;
  delete window.__lastWatirPrompt;
  delete window._phantom;
  delete window.callPhantom;
  delete window._WEBDRIVER_ELEM_CACHE;
  delete window.domAutomation;
  delete window.domAutomationController;

  // 6. 覆盖 navigator.connection（真实 Chrome 有此属性）
  if (!navigator.connection) {
    Object.defineProperty(navigator, 'connection', {
      get: () => ({
        effectiveType: '4g',
        rtt: 50,
        downlink: 10,
        saveData: false
      }),
      configurable: true
    });
  }
`;

/**
 * 移除 WebDriver 标记
 * @param page Playwright 页面实例
 */
export async function removeWebDriverMarkers(page: Page): Promise<void> {
  try {
    await page.addInitScript(WEBDRIVER_REMOVER_SCRIPT);
  } catch (error) {
    console.error('[WebDriver Remover] Failed to inject script:', error);
  }
}
