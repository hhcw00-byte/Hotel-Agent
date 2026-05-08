// 额外指纹保护脚本
// 覆盖 WebRTC / AudioContext / 硬件信息 / CDP 产物 / navigator.platform

// 使用 any 类型以兼容 Playwright 和 Electron
type Page = any;

/**
 * 生成额外保护脚本
 * @param platform 运行平台
 */
function generateExtraProtectionsScript(platform: string, chromeVersion?: string): string {
  const platformValue = platform === 'win32' ? 'Win32' :
                        platform === 'darwin' ? 'MacIntel' :
                        'Linux x86_64';
  const platformName = platform === 'win32' ? 'Windows' :
                       platform === 'darwin' ? 'macOS' :
                       'Linux';
  const chromeMajor = (chromeVersion || process.versions.chrome || '120.0.0.0').split('.')[0];
  const chromeFull = chromeVersion || process.versions.chrome || '120.0.0.0';

  return `
  (function() {
    // === 1. WebRTC IP 泄露防护 ===
    // 阻止 RTCPeerConnection 泄露真实内网/公网 IP
    // 检测脚本通过 WebRTC STUN 请求获取真实 IP，然后与 HTTP 请求的 IP 地址做对比
    if (typeof RTCPeerConnection !== 'undefined') {
      const OriginalRTCPeerConnection = RTCPeerConnection;

      window.RTCPeerConnection = function(config, constraints) {
        // 过滤掉 STUN/TURN 服务器，阻止 IP 泄露
        if (config && config.iceServers) {
          config.iceServers = config.iceServers.filter(function(server) {
            var urls = Array.isArray(server.urls) ? server.urls : [server.urls || server.url];
            // 只保留 TURN 服务器（需要认证，不会泄露 IP），过滤掉公共 STUN
            return urls.every(function(url) {
              return url && !url.toString().startsWith('stun:');
            });
          });
        }
        return new OriginalRTCPeerConnection(config, constraints);
      };

      window.RTCPeerConnection.prototype = OriginalRTCPeerConnection.prototype;

      // 保持 toString 一致，避免被检测到覆盖
      Object.defineProperty(window.RTCPeerConnection, 'name', {
        value: 'RTCPeerConnection',
        writable: false
      });
    }

    // 同样处理老版本前缀 API
    if (typeof webkitRTCPeerConnection !== 'undefined') {
      window.webkitRTCPeerConnection = window.RTCPeerConnection;
    }

    // === 2. AudioContext 指纹防护 ===
    // AudioContext 是仅次于 Canvas 的第二大指纹采集方式
    // 检测脚本通过 OscillatorNode + DynamicsCompressorNode 生成音频信号并采集样本
    if (typeof AudioContext !== 'undefined' || typeof webkitAudioContext !== 'undefined') {
      const OrigAudioContext = window.AudioContext || window.webkitAudioContext;

      if (OrigAudioContext) {
        // 覆盖 getFloatFrequencyData — 注入微小噪声
        const origGetFloatFrequencyData = AnalyserNode.prototype.getFloatFrequencyData;
        AnalyserNode.prototype.getFloatFrequencyData = function(array) {
          origGetFloatFrequencyData.call(this, array);
          // 注入极微小的确定性噪声（不影响音频播放，但改变指纹）
          for (var i = 0; i < array.length; i++) {
            // 使用 index 作为确定性种子
            array[i] = array[i] + ((i % 3 === 0) ? 0.001 : (i % 3 === 1) ? -0.001 : 0.0005);
          }
        };

        // 覆盖 getByteFrequencyData
        const origGetByteFrequencyData = AnalyserNode.prototype.getByteFrequencyData;
        AnalyserNode.prototype.getByteFrequencyData = function(array) {
          origGetByteFrequencyData.call(this, array);
          for (var i = 0; i < array.length; i++) {
            if (i % 5 === 0 && array[i] > 0 && array[i] < 255) {
              array[i] = array[i] + 1;
            }
          }
        };

        // 覆盖 OfflineAudioContext.startRendering 结果中的 channel data
        if (typeof OfflineAudioContext !== 'undefined') {
          const origStartRendering = OfflineAudioContext.prototype.startRendering;
          OfflineAudioContext.prototype.startRendering = function() {
            return origStartRendering.call(this).then(function(buffer) {
              // 对每个 channel 注入微小噪声
              for (var ch = 0; ch < buffer.numberOfChannels; ch++) {
                var data = buffer.getChannelData(ch);
                for (var i = 0; i < data.length; i += 100) {
                  data[i] = data[i] + 0.0000001;
                }
              }
              return buffer;
            });
          };
        }
      }
    }

    // === 3. 硬件信息伪装 ===
    // 设置合理的 hardwareConcurrency（CPU 核心数）
    // 多数真实用户是 4/8 核，暴露 16/32 核或 1 核都容易被标记
    Object.defineProperty(navigator, 'hardwareConcurrency', {
      get: function() { return 8; },
      configurable: true
    });

    // deviceMemory（设备内存 GB）— Chrome 特有属性
    Object.defineProperty(navigator, 'deviceMemory', {
      get: function() { return 8; },
      configurable: true
    });

    // === 4. navigator.platform 与 User-Agent 同步 ===
    Object.defineProperty(navigator, 'platform', {
      get: function() { return '${platformValue}'; },
      configurable: true
    });

    // === 5. CDP 运行时产物清理 ===
    // Playwright/Puppeteer 通过 CDP Runtime.evaluate 注入的全局变量
    // 某些检测脚本专门扫描这些标记
    (function cleanupCDPArtifacts() {
      // 定时清理（因为 CDP 可能在后续注入新的标记）
      var cdpMarkers = [
        '__playwright_evaluation_script__',
        '__puppeteer_evaluation_script__',
        '__cdp_evaluation_script__',
        '__webdriver_script_fn',
        '__driver_unwrapped',
        '__webdriver_unwrapped',
        'cdc_adoQpoasnfa76pfcZLmcfl_Array',
        'cdc_adoQpoasnfa76pfcZLmcfl_Promise',
        'cdc_adoQpoasnfa76pfcZLmcfl_Symbol'
      ];

      function cleanup() {
        cdpMarkers.forEach(function(marker) {
          try { delete window[marker]; } catch(e) {}
        });

        // 清理 document 上以 cdc_ 开头的属性（ChromeDriver 特征）
        try {
          var docKeys = Object.getOwnPropertyNames(document);
          docKeys.forEach(function(key) {
            if (key.startsWith('cdc_') || key.startsWith('$cdc_')) {
              try { delete document[key]; } catch(e) {}
            }
          });
        } catch(e) {}
      }

      // 立即执行 + 定时执行
      cleanup();
      setInterval(cleanup, 2000);
    })();

    // === 6. Screen 属性完善 ===
    // 确保 screen 对象属性与 viewport 一致性合理
    if (screen.width === 0 || screen.height === 0) {
      Object.defineProperty(screen, 'width', { get: function() { return 1920; } });
      Object.defineProperty(screen, 'height', { get: function() { return 1080; } });
      Object.defineProperty(screen, 'availWidth', { get: function() { return 1920; } });
      Object.defineProperty(screen, 'availHeight', { get: function() { return 1040; } });
      Object.defineProperty(screen, 'colorDepth', { get: function() { return 24; } });
      Object.defineProperty(screen, 'pixelDepth', { get: function() { return 24; } });
    }

    // === 7. Notification API 补全 ===
    // 有些环境下 Notification 未定义，会导致其他保护脚本报错
    if (typeof Notification === 'undefined') {
      window.Notification = {
        permission: 'default',
        requestPermission: function() { return Promise.resolve('default'); }
      };
    }

    // === 9. Hairline feature 检测防护 ===
    // 检测脚本用 devicePixelRatio + 1px border 测量亚像素渲染能力
    // 自动化环境的 devicePixelRatio 通常是整数 1，真实高分屏是 1.25/1.5/2
    // 同时检测 Element.getBoundingClientRect 返回值是否有小数（亚像素精度）
    (function() {
      // 伪造合理的 devicePixelRatio（Windows 125% 缩放 = 1.25）
      Object.defineProperty(window, 'devicePixelRatio', {
        get: function() { return 1.25; },
        configurable: true
      });

      // 确保 getBoundingClientRect 返回带小数的值（亚像素精度）
      // 自动化环境里这个值通常是整数，暴露机器人特征
      // 使用基于元素位置的确定性微偏移，避免固定值被检测
      const origGetBoundingClientRect = Element.prototype.getBoundingClientRect;
      Element.prototype.getBoundingClientRect = function() {
        const rect = origGetBoundingClientRect.call(this);
        // 用 rect 自身坐标做简单哈希，产生 0.05~0.15 范围的确定性偏移
        var h = ((rect.x * 73 + rect.y * 37 + rect.width * 17) & 0xffff) / 65536;
        var offset = 0.05 + h * 0.1;
        return new DOMRect(
          rect.x      + offset,
          rect.y      + offset,
          rect.width,
          rect.height
        );
      };
    })();

    // === 10. iframe content window 检测防护 ===
    // 检测脚本在 iframe 里读 window.chrome / navigator.webdriver 等对象
    // 如果跨域 iframe 的值与主页面不一致，即暴露自动化环境
    // 策略：拦截 HTMLIFrameElement.contentWindow，在 iframe 加载完成后注入相同覆盖
    (function() {
      // 覆盖 iframe 的 contentDocument 访问，强制注入保护脚本
      const origContentWindow = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow');
      if (origContentWindow && origContentWindow.get) {
        Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
          get: function() {
            const win = origContentWindow.get.call(this);
            if (!win) return win;
            try {
              // 同源 iframe：直接注入 webdriver 覆盖
              if (win.navigator && win.navigator.webdriver !== false) {
                Object.defineProperty(win.navigator, 'webdriver', {
                  get: () => false,
                  configurable: true
                });
              }
              // 确保 chrome 对象存在
              if (!win.chrome) {
                win.chrome = { runtime: {} };
              }
            } catch(e) {
              // 跨域 iframe 访问会抛 SecurityError，忽略即可
              // 跨域 iframe 无法通过 JS 注入，但检测脚本也无法从主页面读取跨域 iframe 内部
            }
            return win;
          },
          configurable: true
        });
      }
    })();

    // === 11. Media Codecs 检测防护 ===
    // Electron 环境的编解码器支持列表与真实 Chrome 有差异
    // 检测脚本调用 HTMLVideoElement.canPlayType() / HTMLAudioElement.canPlayType()
    // 对比返回值（'probably' / 'maybe' / ''）来判断是否是真实浏览器
    (function() {
      const videoProto = HTMLVideoElement.prototype;
      const audioProto = HTMLAudioElement.prototype;
      const origVideoCanPlay = videoProto.canPlayType;
      const origAudioCanPlay = audioProto.canPlayType;

      // 真实 Chrome 131 on Windows 的 canPlayType 返回值映射
      var videoCodecMap = {
        'video/mp4':                              'maybe',
        'video/mp4; codecs="avc1.42E01E"':        'probably',
        'video/mp4; codecs="avc1.42E01E, mp4a.40.2"': 'probably',
        'video/webm':                             'probably',
        'video/webm; codecs="vp8"':               'probably',
        'video/webm; codecs="vp8, vorbis"':       'probably',
        'video/webm; codecs="vp9"':               'probably',
        'video/webm; codecs="vp9, opus"':         'probably',
        'video/ogg':                              'maybe',
        'video/ogg; codecs="theora"':             'probably',
        'application/x-mpegURL':                  'maybe',
      };

      var audioCodecMap = {
        'audio/mp4':                              'maybe',
        'audio/mp4; codecs="mp4a.40.2"':          'probably',
        'audio/mpeg':                             'probably',
        'audio/ogg':                              'probably',
        'audio/ogg; codecs="vorbis"':             'probably',
        'audio/ogg; codecs="opus"':               'probably',
        'audio/webm':                             'probably',
        'audio/webm; codecs="opus"':              'probably',
        'audio/wav':                              'probably',
        'audio/wav; codecs="1"':                  'probably',
        'audio/flac':                             'probably',
        'audio/aac':                              'probably',
      };

      videoProto.canPlayType = function(type) {
        // 先查映射表，命中则返回我们预设的标准值
        const normalized = type ? type.trim().toLowerCase() : '';
        if (videoCodecMap[normalized] !== undefined) {
          return videoCodecMap[normalized];
        }
        // 未命中则走原始逻辑
        return origVideoCanPlay.call(this, type);
      };

      audioProto.canPlayType = function(type) {
        const normalized = type ? type.trim().toLowerCase() : '';
        if (audioCodecMap[normalized] !== undefined) {
          return audioCodecMap[normalized];
        }
        return origAudioCanPlay.call(this, type);
      };
    })();

    // === 12. Electron 特征清理（针对飞猪百夏 SDK） ===
    // 百夏会扫描 Electron / Node.js 特有的全局对象和属性
    (function() {
      // 清理 Electron 注入的全局对象
      var electronMarkers = [
        '__electron_preload',
        '__electronLog',
        'electronAPI',
        '__electronRequire'
      ];
      electronMarkers.forEach(function(m) {
        try { if (window[m]) delete window[m]; } catch(e) {}
      });

      // 清理 process / require / module 等 Node.js 痕迹（contextIsolation 下通常不存在，但以防万一）
      var nodeMarkers = ['process', 'require', 'module', 'exports', '__filename', '__dirname', 'Buffer', 'global'];
      nodeMarkers.forEach(function(m) {
        try {
          if (window[m] && m !== 'undefined') {
            Object.defineProperty(window, m, { get: function() { return undefined; }, configurable: true });
          }
        } catch(e) {}
      });

      // 确保 navigator.userAgent 不包含 Electron 字样
      var ua = navigator.userAgent;
      if (ua.indexOf('Electron') !== -1) {
        Object.defineProperty(navigator, 'userAgent', {
          get: function() { return ua.replace(/\\s*Electron\\/[\\d.]+\\s*/g, ' '); },
          configurable: true
        });
      }

      // 确保 navigator.appVersion 也干净
      var av = navigator.appVersion;
      if (av && av.indexOf('Electron') !== -1) {
        Object.defineProperty(navigator, 'appVersion', {
          get: function() { return av.replace(/\\s*Electron\\/[\\d.]+\\s*/g, ' '); },
          configurable: true
        });
      }
    })();

    // === 13. 飞猪微前端沙箱兼容 ===
    // 飞猪 qiankun 微前端用 Proxy 拦截 window 访问，
    // 确保被 Proxy 包装后的 window 上也能正确读到我们覆盖的属性
    (function() {
      // 确保 window.chrome 不可被 Proxy 的 has trap 误判为不存在
      if (window.chrome) {
        try {
          Object.defineProperty(window, 'chrome', {
            value: window.chrome,
            writable: false,
            enumerable: true,
            configurable: true
          });
        } catch(e) {}
      }

      // 确保 Permissions API 在沙箱环境下正常工作
      if (navigator.permissions && navigator.permissions.query) {
        var origPermQuery = navigator.permissions.query.bind(navigator.permissions);
        Object.defineProperty(navigator.permissions, 'query', {
          value: function(desc) {
            // 百夏会查询 notifications / midi / camera 等权限
            if (desc && desc.name === 'notifications') {
              return Promise.resolve({ state: 'prompt', onchange: null });
            }
            try {
              return origPermQuery(desc);
            } catch(e) {
              return Promise.resolve({ state: 'prompt', onchange: null });
            }
          },
          writable: true,
          configurable: true
        });
      }
    })();

    // === 14. CDP 远程调试端口探测防护 ===
    // AWS WAF / PerimeterX 的 challenge.js 会尝试 fetch('http://localhost:9222/json')
    // 或 'http://127.0.0.1:9222/json/version' 来检测是否有 CDP 调试端口开着
    // 拦截 fetch 和 XMLHttpRequest，对 localhost 调试端口的请求直接返回网络错误
    (function() {
      var debugPorts = [9222, 9229, 9333, 5858];
      var debugPattern = new RegExp('(localhost|127\\.0\\.0\\.1|\\[::1\\]):(' + debugPorts.join('|') + ')');

      // 拦截 fetch
      var origFetch = window.fetch;
      window.fetch = function(input, init) {
        var url = (typeof input === 'string') ? input : (input && input.url ? input.url : '');
        if (debugPattern.test(url)) {
          return Promise.reject(new TypeError('Failed to fetch'));
        }
        return origFetch.apply(this, arguments);
      };

      // 拦截 XMLHttpRequest.open
      var origXHROpen = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function(method, url) {
        if (typeof url === 'string' && debugPattern.test(url)) {
          // 重定向到一个不存在的地址，让请求自然失败
          arguments[1] = 'about:blank';
        }
        return origXHROpen.apply(this, arguments);
      };

      // 拦截 WebSocket（某些检测脚本用 WebSocket 连接 CDP）
      var OrigWebSocket = window.WebSocket;
      window.WebSocket = function(url, protocols) {
        if (typeof url === 'string' && debugPattern.test(url)) {
          throw new DOMException("Failed to construct 'WebSocket': The URL 'about:blank' is invalid.", 'SyntaxError');
        }
        return new OrigWebSocket(url, protocols);
      };
      window.WebSocket.prototype = OrigWebSocket.prototype;
      window.WebSocket.CONNECTING = OrigWebSocket.CONNECTING;
      window.WebSocket.OPEN = OrigWebSocket.OPEN;
      window.WebSocket.CLOSING = OrigWebSocket.CLOSING;
      window.WebSocket.CLOSED = OrigWebSocket.CLOSED;
    })();

    // Playwright addInitScript 会带有特殊的 sourceURL 注释
    // 覆盖 Error.prepareStackTrace 以清理堆栈中的 pptr/playwright 路径
    var origPrepareStackTrace = Error.prepareStackTrace;
    Error.prepareStackTrace = function(err, stack) {
      if (origPrepareStackTrace) {
        var result = origPrepareStackTrace(err, stack);
        if (typeof result === 'string') {
          return result
            .replace(/pptr:.*?(?=\\n|$)/g, '<anonymous>')
            .replace(/__playwright.*?(?=\\n|$)/g, '<anonymous>');
        }
        return result;
      }
      return err.stack;
    };

    // === 15. navigator.userAgentData (Client Hints API) 伪装 ===
    // 真实 Chrome 120+ 必有此 API，Electron 的 brands 里只有 "Chromium" 没有 "Google Chrome"
    // Booking.com 的 PerimeterX/HUMAN 反机器人会检测 brands 列表
    (function() {
      var chromeMajor = '${chromeMajor}';
      var chromeFull = '${chromeFull}';
      var platformName = '${platformName}';

      var fakeBrands = [
        { brand: 'Google Chrome', version: chromeMajor },
        { brand: 'Chromium', version: chromeMajor },
        { brand: 'Not_A Brand', version: '24' }
      ];

      var fakeUAData = {
        brands: fakeBrands,
        mobile: false,
        platform: platformName,
        getHighEntropyValues: function(hints) {
          return Promise.resolve({
            brands: fakeBrands,
            mobile: false,
            platform: platformName,
            platformVersion: platformName === 'Windows' ? '15.0.0' : '14.0.0',
            architecture: 'x86',
            bitness: '64',
            model: '',
            uaFullVersion: chromeFull,
            fullVersionList: [
              { brand: 'Google Chrome', version: chromeFull },
              { brand: 'Chromium', version: chromeFull },
              { brand: 'Not_A Brand', version: '24.0.0.0' }
            ],
            wow64: false
          });
        },
        toJSON: function() {
          return { brands: fakeBrands, mobile: false, platform: platformName };
        }
      };

      Object.defineProperty(navigator, 'userAgentData', {
        get: function() { return fakeUAData; },
        configurable: true
      });
    })();
  })();
  `;
}

/**
 * 应用额外保护措施
 * @param page Playwright 页面实例或支持 addInitScript 的对象
 * @param platform 运行平台
 */
export async function applyExtraProtections(
  page: Page,
  platform: string = process.platform,
  chromeVersion?: string
): Promise<void> {
  try {
    const script = generateExtraProtectionsScript(platform, chromeVersion);
    await page.addInitScript(script);
    console.log('[ExtraProtections] ✓ WebRTC / AudioContext / Hardware / CDP cleanup / UserAgentData applied');
  } catch (error) {
    console.error('[ExtraProtections] Failed to inject script:', error);
  }
}

/**
 * 导出脚本字符串（供 Electron webContents 直接 executeJavaScript 使用）
 */
export function getExtraProtectionsScript(platform: string = process.platform, chromeVersion?: string): string {
  return generateExtraProtectionsScript(platform, chromeVersion);
}
