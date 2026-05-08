/**
 * Google Auth via System Chrome
 *
 * 方案 B：启动用户系统上真正的 Chrome 浏览器完成 Google 登录。
 * Google 100% 信任自己的 Chrome，不会拒绝。
 *
 * 流程：
 * 1. 找到系统 Chrome.exe 路径
 * 2. 创建临时 user-data-dir（隔离的 profile）
 * 3. 启动 Chrome，带 --remote-debugging-port（随机端口）
 * 4. 用户在真 Chrome 里完成 Google 登录
 * 5. 通过 CDP WebSocket 提取所有 Google cookie
 * 6. 导入到 Electron session
 * 7. 关闭 Chrome，清理临时目录
 */

import { session, dialog } from 'electron';
import * as child_process from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as http from 'http';
import * as net from 'net';

// 文件日志（确保所有调试信息可见）
const LOG_FILE = path.join(os.tmpdir(), 'hotel-ai-google-auth-debug.log');
function debugLog(...args: any[]): void {
  const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
  const line = `[${new Date().toISOString()}] [ChromeAuth] ${msg}\n`;
  process.stdout.write(line);
  try { fs.appendFileSync(LOG_FILE, line); } catch {}
}

interface CdpCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: string;
  expires: number;
}

export class GoogleAuthChrome {
  private chromeProcess: child_process.ChildProcess | null = null;
  private isAuthInProgress = false;
  private tmpProfileDir: string | null = null;
  private debugPort: number = 0;

  /**
   * 使用系统 Chrome 完成 Google 登录，然后同步 cookie 到 Electron
   * 返回 { success, redirectUrl } — redirectUrl 是登录完成后的回调 URL
   */
  async performGoogleAuth(googleAuthUrl: string): Promise<{ success: boolean; redirectUrl?: string; userInfo?: { email: string; displayName: string } }> {
    if (this.isAuthInProgress) {
      debugLog(' Auth already in progress');
      return { success: false };
    }

    this.isAuthInProgress = true;

    try {
      debugLog(' === Starting Google Auth via System Chrome ===');
      debugLog(' Auth URL:', googleAuthUrl);

      // 1. 找到 Chrome 路径
      const chromePath = this.findChrome();
      if (!chromePath) {
        debugLog(' Chrome/Edge not found on system!');
        dialog.showMessageBox({
          type: 'warning',
          title: '无法完成 Google 登录',
          message: '未检测到 Chrome 或 Edge 浏览器',
          detail: '请先安装 Google Chrome 或 Microsoft Edge，然后重试。\n\n下载地址：https://www.google.com/chrome',
          buttons: ['确定'],
        }).catch(() => {});
        return { success: false };
      }
      debugLog(' Chrome path:', chromePath);

      // 2. 创建临时 profile
      this.tmpProfileDir = path.join(os.tmpdir(), 'hotel-ai-chrome-auth-' + Date.now());
      fs.mkdirSync(this.tmpProfileDir, { recursive: true });
      debugLog(' Temp profile:', this.tmpProfileDir);

      // 3. 找一个可用端口
      this.debugPort = await this.findFreePort();
      const debugPort = this.debugPort;
      debugLog(' Debug port:', debugPort);

      // 4. 启动 Chrome
      // 先清除临时目录中的 SingletonLock / SingletonCookie 等锁文件
      // 这些文件会导致 Chrome 认为已有实例在运行而立即退出
      const lockFiles = ['SingletonLock', 'SingletonSocket', 'SingletonCookie'];
      for (const f of lockFiles) {
        try { fs.unlinkSync(path.join(this.tmpProfileDir, f)); } catch {}
      }

      const args = [
        `--remote-debugging-port=${debugPort}`,
        `--user-data-dir=${this.tmpProfileDir}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-default-apps',
        '--disable-extensions',
        '--disable-sync',
        '--disable-background-networking',
        '--new-window',
        '--window-size=500,700',
        googleAuthUrl,
      ];

      this.chromeProcess = child_process.spawn(chromePath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,  // detached: Chrome 子进程独立运行
      });

      // 不跟踪 stdout/stderr（Chrome fork 后父进程会立即退出，这些管道无意义）
      this.chromeProcess.stdout?.resume();
      this.chromeProcess.stderr?.resume();

      // 🔥 关键：Chrome 在 Windows 上会 fork 子进程后父进程立即退出（code 0）
      // 这不代表浏览器关闭了！实际浏览器运行在子进程中。
      // 所以我们 unref() 父进程，不跟踪它的退出事件。
      this.chromeProcess.unref();

      debugLog('Chrome spawned, PID:', this.chromeProcess.pid);

      // 5. 等待 CDP 端口就绪
      await this.waitForCdpReady(debugPort, 15000);
      debugLog('CDP ready');

      // 6. 获取浏览器级别 WebSocket URL
      const browserWsUrl = await this.getBrowserWsUrl(debugPort);
      debugLog('Browser WS URL:', browserWsUrl);

      // 7. 轮询等待登录完成（通过 CDP 轮询，不依赖进程退出事件）
      const result = await this.waitForLoginAndGetCookies(
        debugPort, browserWsUrl
      );

      if (result && result.cookies.length > 0) {
        debugLog(`Got ${result.cookies.length} cookies, importing ALL to Electron...`);
        await this.importToElectron(result.cookies);
        debugLog(' Cookies imported to Electron session');
        return { success: true, redirectUrl: result.redirectUrl, userInfo: result.userInfo };
      } else {
        debugLog(' No cookies obtained');
        return { success: false };
      }
    } catch (error) {
      debugLog(' Error:', error);
      return { success: false };
    } finally {
      this.cleanup();
      this.isAuthInProgress = false;
    }
  }

  /**
   * 在系统上查找 Chrome/Edge 可执行文件
   */
  private findChrome(): string | null {
    const candidates: string[] = [];

    if (process.platform === 'win32') {
      candidates.push(
        path.join(process.env.PROGRAMFILES || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(process.env.PROGRAMFILES || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        path.join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      );
    } else if (process.platform === 'darwin') {
      candidates.push(
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        path.join(os.homedir(), 'Applications', 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome'),
        path.join(os.homedir(), 'Applications', 'Microsoft Edge.app', 'Contents', 'MacOS', 'Microsoft Edge'),
      );
    } else {
      // Linux
      candidates.push(
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium-browser',
        '/usr/bin/microsoft-edge',
      );
    }

    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
    return null;
  }

  private findFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const srv = net.createServer();
      srv.listen(0, '127.0.0.1', () => {
        const addr = srv.address() as net.AddressInfo;
        srv.close(() => resolve(addr.port));
      });
      srv.on('error', reject);
    });
  }

  private waitForCdpReady(port: number, timeoutMs: number): Promise<void> {
    const start = Date.now();
    return new Promise((resolve, reject) => {
      const check = () => {
        if (Date.now() - start > timeoutMs) {
          reject(new Error('CDP port not ready within timeout'));
          return;
        }
        this.cdpHttpGet(port, '/json/version')
          .then(() => resolve())
          .catch(() => setTimeout(check, 500));
      };
      check();
    });
  }

  /**
   * 获取浏览器级别的 WebSocket debugger URL
   */
  private async getBrowserWsUrl(port: number): Promise<string> {
    const data = await this.cdpHttpGet(port, '/json/version');
    const info = JSON.parse(data);
    return info.webSocketDebuggerUrl;
  }

  /**
   * 轮询检测登录完成，然后提取 cookies
   * 不依赖进程退出事件，改用 CDP 连通性判断 Chrome 是否还活着
   */
  private waitForLoginAndGetCookies(
    port: number,
    browserWsUrl: string
  ): Promise<{ cookies: CdpCookie[]; redirectUrl: string; userInfo?: { email: string; displayName: string } } | null> {
    return new Promise((resolve) => {
      let resolved = false;
      let pollCount = 0;
      let cdpFailCount = 0;

      const done = (result: { cookies: CdpCookie[]; redirectUrl: string; userInfo?: { email: string; displayName: string } } | null) => {
        if (resolved) return;
        resolved = true;
        resolve(result);
      };

      const poll = async () => {
        if (resolved) return;
        pollCount++;

        // 超时（5分钟）
        if (pollCount > 300) {
          debugLog('Polling timeout (5 min)');
          done(null);
          return;
        }

        try {
          const pagesRaw = await this.cdpHttpGet(port, '/json');
          const pages = JSON.parse(pagesRaw);
          cdpFailCount = 0; // CDP 连通，重置失败计数

          const mainPage = pages.find((p: any) => p.type === 'page' && p.url);
          if (!mainPage) {
            debugLog('No pages found, Chrome may have been closed');
            done(null);
            return;
          }

          const url = mainPage.url;
          if (pollCount % 3 === 1) {
            debugLog(`Poll #${pollCount} URL: ${url}`);
          }

          // 判断是否还在 Google 登录流程中（只检查 hostname，不匹配查询参数）
          let stillOnGoogleAuth = url.startsWith('chrome://');
          if (!stillOnGoogleAuth) {
            try {
              const hostname = new URL(url).hostname.toLowerCase();
              stillOnGoogleAuth =
                hostname.endsWith('accounts.google.com') ||
                hostname.endsWith('accounts.youtube.com') ||
                hostname.endsWith('consent.google.com') ||
                hostname.endsWith('gds.google.com');
            } catch {
              stillOnGoogleAuth = true; // URL 解析失败，继续等待
            }
          }

          if (!stillOnGoogleAuth && url.startsWith('http')) {
            // 登录完成！离开了 Google 登录页
            debugLog(' Login complete! Redirected to:', url);

            // 立即抓 Cookie（Chrome 可能很快自行退出，不能等太久）
            let cookies: CdpCookie[] = [];
            try {
              cookies = await this.getAllCookiesViaCdp(browserWsUrl);
              debugLog(` Got ${cookies.length} cookies immediately`);
            } catch (e) {
              debugLog(' Immediate cookie grab failed, waiting 1s and retrying...');
              await this.sleep(1000);
              try {
                cookies = await this.getAllCookiesViaCdp(browserWsUrl);
                debugLog(` Got ${cookies.length} cookies on retry`);
              } catch (e2) {
                debugLog(' Retry via browser WS failed, trying page WS...');
                try {
                  cookies = await this.getAllCookiesViaCdp(mainPage.webSocketDebuggerUrl);
                  debugLog(` Got ${cookies.length} cookies via page WS`);
                } catch (e3) {
                  debugLog(' All cookie extraction methods failed:', e3);
                }
              }
            }

            if (cookies.length > 0) {
              // 提取 Google 用户信息（非关键，失败不影响结果）
              let userInfo: { email: string; displayName: string } | undefined;
              try {
                userInfo = await this.extractGoogleUserInfo(browserWsUrl, mainPage.webSocketDebuggerUrl);
                debugLog(' Extracted user info:', JSON.stringify(userInfo));
              } catch (e) {
                debugLog(' Failed to extract user info (non-critical):', e);
              }
              done({ cookies, redirectUrl: url, userInfo });
            } else {
              done(null);
            }
            return;
          }
        } catch (e) {
          // CDP 请求失败 — Chrome 可能被用户关闭了
          cdpFailCount++;
          debugLog('CDP request failed, fail count:', cdpFailCount);
          if (cdpFailCount >= 3) {
            debugLog('CDP unreachable (Chrome closed by user)');
            done(null);
            return;
          }
        }

        setTimeout(poll, 1000);
      };

      // 2秒后开始轮询（等 Chrome 初始化）
      debugLog('Starting poll loop in 2s...');
      setTimeout(poll, 2000);
    });
  }

  /**
   * 通过 CDP WebSocket 获取所有 cookies
   * 使用浏览器级别的 WebSocket 连接，不需要 enable Network
   */
  private getAllCookiesViaCdp(wsUrl: string): Promise<CdpCookie[]> {
    return new Promise((resolve, reject) => {
      debugLog(' Connecting to CDP WebSocket:', wsUrl);

      const WebSocket = require('ws');
      const ws = new WebSocket(wsUrl);
      let resolved = false;
      let cmdId = 1;
      let triedMethods = 0;

      const finish = (result: CdpCookie[] | null, error?: Error) => {
        if (resolved) return;
        resolved = true;
        try { ws.close(); } catch {}
        if (error) reject(error);
        else resolve(result || []);
      };

      const tryNextMethod = () => {
        triedMethods++;
        if (triedMethods === 1) {
          // 方法1: Storage.getCookies (浏览器级别, 较新 Chrome)
          debugLog(' Trying Storage.getCookies...');
          cmdId++;
          ws.send(JSON.stringify({ id: cmdId, method: 'Storage.getCookies' }));
        } else if (triedMethods === 2) {
          // 方法2: Network.getAllCookies (需要 Network domain)
          debugLog(' Trying Network.getAllCookies...');
          cmdId++;
          ws.send(JSON.stringify({ id: cmdId, method: 'Network.getAllCookies' }));
        } else if (triedMethods === 3) {
          // 方法3: 先 enable Network, 再 getAllCookies
          debugLog(' Trying Network.enable + getAllCookies...');
          cmdId++;
          ws.send(JSON.stringify({ id: cmdId, method: 'Network.enable' }));
        } else {
          debugLog(' All CDP cookie methods exhausted');
          finish(null, new Error('All cookie extraction methods failed'));
        }
      };

      ws.on('open', () => {
        debugLog(' CDP WebSocket connected');
        tryNextMethod();
      });

      ws.on('message', (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString());

          if (msg.id === cmdId) {
            if (msg.error) {
              debugLog(` Method ${triedMethods} failed: ${JSON.stringify(msg.error)}`);
              // 如果是 Network.enable 刚成功，下一步调 getAllCookies
              tryNextMethod();
              return;
            }

            // Network.enable 返回的是空 result
            if (triedMethods === 3 && !msg.result?.cookies) {
              // enable 成功了，现在调 getAllCookies
              debugLog(' Network.enable succeeded, now getting cookies...');
              cmdId++;
              ws.send(JSON.stringify({ id: cmdId, method: 'Network.getAllCookies' }));
              return;
            }

            const allCookies: CdpCookie[] = msg.result?.cookies || [];
            debugLog(`Got ${allCookies.length} total cookies from CDP (method ${triedMethods})`);
            finish(allCookies);
          }
        } catch (e) {
          debugLog(' Failed to parse CDP message:', e);
        }
      });

      ws.on('error', (err: Error) => {
        debugLog(' WebSocket error:', err.message);
        finish(null, err);
      });

      ws.on('close', () => {
        finish(null, new Error('WebSocket closed before getting cookies'));
      });

      // 超时
      setTimeout(() => finish(null, new Error('CDP cookie extraction timeout')), 15000);
    });
  }

  /**
   * 通过 CDP 提取 Google 登录用户的 email 和显示名称
   * 策略: 在 Chrome 页面中 fetch ListAccounts API 获取当前登录账号信息
   */
  private extractGoogleUserInfo(
    browserWsUrl: string,
    pageWsUrl: string
  ): Promise<{ email: string; displayName: string } | undefined> {
    return new Promise((resolve) => {
      const WebSocket = require('ws');
      const ws = new WebSocket(pageWsUrl);
      let resolved = false;
      let cmdId = 1;

      const finish = (result?: { email: string; displayName: string }) => {
        if (resolved) return;
        resolved = true;
        try { ws.close(); } catch {}
        resolve(result);
      };

      ws.on('open', () => {
        // Use Runtime.evaluate to fetch Google ListAccounts API
        const script = `
          (async () => {
            try {
              const resp = await fetch('https://accounts.google.com/ListAccounts?gpsia=1&source=ChromiumBrowser', { credentials: 'include' });
              const text = await resp.text();
              return text;
            } catch(e) {
              return '';
            }
          })()
        `;
        ws.send(JSON.stringify({
          id: cmdId,
          method: 'Runtime.evaluate',
          params: { expression: script, awaitPromise: true, returnByValue: true }
        }));
      });

      ws.on('message', (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.id === cmdId) {
            const text = msg.result?.result?.value || '';
            if (text) {
              // ListAccounts response is a JS array: [["gaia.l.a.r",[["gaia.l.a",1,[...,"email@gmail.com",...],...,"Display Name",...]],...]]
              // Try to extract email and display name with regex
              const emailMatch = text.match(/[\w.+-]+@[\w.-]+\.\w{2,}/);
              if (emailMatch) {
                const email = emailMatch[0];
                // Try to find display name (usually appears before email in the array)
                let displayName = email.split('@')[0];
                // Look for a quoted string that looks like a name (non-email, non-url)
                const nameMatches = text.match(/"([^"]{2,40})"/g);
                if (nameMatches) {
                  for (const m of nameMatches) {
                    const name = m.slice(1, -1);
                    if (!name.includes('@') && !name.includes('/') && !name.includes('.') &&
                        name !== 'gaia.l.a' && name !== 'gaia.l.a.r' && !name.startsWith('gaia.')) {
                      displayName = name;
                      break;
                    }
                  }
                }
                finish({ email, displayName });
                return;
              }
            }
            // Fallback: try data-email attribute on myaccount page
            cmdId++;
            ws.send(JSON.stringify({
              id: cmdId,
              method: 'Runtime.evaluate',
              params: {
                expression: `document.querySelector('[data-email]')?.getAttribute('data-email') || ''`,
                returnByValue: true
              }
            }));
          } else if (msg.id === cmdId) {
            const email = msg.result?.result?.value || '';
            if (email && email.includes('@')) {
              finish({ email, displayName: email.split('@')[0] });
            } else {
              finish(undefined);
            }
          }
        } catch (e) {
          debugLog(' extractGoogleUserInfo parse error:', e);
        }
      });

      ws.on('error', () => finish(undefined));
      ws.on('close', () => finish(undefined));
      setTimeout(() => finish(undefined), 10000);
    });
  }

  private cdpHttpGet(port: number, urlPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const req = http.get(`http://127.0.0.1:${port}${urlPath}`, (res) => {
        let data = '';
        res.on('data', (d) => data += d);
        res.on('end', () => {
          if (res.statusCode === 200) resolve(data);
          else reject(new Error(`HTTP ${res.statusCode}`));
        });
      });
      req.on('error', reject);
      req.setTimeout(5000, () => { req.destroy(); reject(new Error('timeout')); });
    });
  }

  private async importToElectron(cookies: CdpCookie[]): Promise<void> {
    const ses = session.defaultSession;
    let imported = 0;

    for (const c of cookies) {
      try {
        const proto = c.secure ? 'https' : 'http';
        const dom = c.domain.startsWith('.') ? c.domain.substring(1) : c.domain;
        const url = `${proto}://${dom}${c.path || '/'}`;

        let sameSite: 'unspecified' | 'no_restriction' | 'lax' | 'strict' = 'unspecified';
        if (c.sameSite === 'None') sameSite = 'no_restriction';
        else if (c.sameSite === 'Lax') sameSite = 'lax';
        else if (c.sameSite === 'Strict') sameSite = 'strict';

        const details: Electron.CookiesSetDetails = {
          url,
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path || '/',
          secure: c.secure,
          httpOnly: c.httpOnly,
          sameSite,
        };

        if (c.expires > 0) {
          details.expirationDate = c.expires;
        }

        await ses.cookies.set(details);
        imported++;
      } catch {}
    }

    console.log(`[GoogleAuthChrome] Imported ${imported}/${cookies.length} cookies to Electron`);
    debugLog(`Imported ${imported}/${cookies.length} cookies to Electron`);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
  }

  private cleanup(): void {
    debugLog(' Cleanup starting...');

    if (this.debugPort > 0) {
      // 先尝试通过 CDP 关闭所有页面，触发 Chrome 优雅退出（跨平台通用）
      try {
        const closeReq = http.get(`http://127.0.0.1:${this.debugPort}/json`, (res) => {
          let data = '';
          res.on('data', (d) => data += d);
          res.on('end', () => {
            try {
              const pages = JSON.parse(data);
              for (const p of pages) {
                if (p.id) {
                  http.get(`http://127.0.0.1:${this.debugPort}/json/close/${p.id}`, () => {}).on('error', () => {});
                }
              }
            } catch {}
          });
        });
        closeReq.on('error', () => {});
        closeReq.setTimeout(2000, () => closeReq.destroy());
      } catch {}
    }

    if (process.platform === 'win32' && this.debugPort > 0) {
      // Windows：父进程已退出，通过端口找真正的 Chrome 进程树杀掉
      try {
        const output = child_process.execSync(
          `netstat -ano | findstr "LISTENING" | findstr ":${this.debugPort} "`,
          { encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }
        );
        const lines = output.trim().split('\n');
        const pids = new Set<string>();
        for (const line of lines) {
          const parts = line.trim().split(/\s+/);
          const pid = parts[parts.length - 1];
          if (pid && /^\d+$/.test(pid) && pid !== '0') {
            pids.add(pid);
          }
        }
        for (const pid of pids) {
          debugLog(' Killing Chrome process tree, PID:', pid);
          try {
            child_process.execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore', timeout: 5000 });
          } catch {}
        }
      } catch (e) {
        debugLog(' Port-based kill failed (Chrome may already be closed)');
      }
    } else if (process.platform === 'darwin' && this.debugPort > 0) {
      // macOS：通过端口找进程树杀掉（与 Windows 等效逻辑）
      try {
        const output = child_process.execSync(
          `lsof -ti :${this.debugPort}`,
          { encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }
        );
        const pids = output.trim().split('\n').filter(p => /^\d+$/.test(p.trim()));
        for (const pid of pids) {
          debugLog(' Killing Chrome process, PID:', pid.trim());
          try { process.kill(Number(pid.trim()), 'SIGTERM'); } catch {}
        }
      } catch (e) {
        // lsof 失败说明端口已释放，Chrome 已退出
        debugLog(' Port-based kill skipped (Chrome may already be closed)');
      }
      // fallback：确保 spawn 的进程也被清理
      if (this.chromeProcess && !this.chromeProcess.killed) {
        try { this.chromeProcess.kill('SIGTERM'); } catch {}
      }
    } else if (this.chromeProcess && !this.chromeProcess.killed) {
      // Linux 或其他平台
      try { this.chromeProcess.kill('SIGTERM'); } catch {}
    }

    this.chromeProcess = null;
    this.debugPort = 0;

    if (this.tmpProfileDir) {
      const dir = this.tmpProfileDir;
      this.tmpProfileDir = null;
      // 延迟清理，等 Chrome 进程完全退出
      setTimeout(() => {
        try {
          fs.rmSync(dir, { recursive: true, force: true });
          debugLog(' Cleaned up temp profile');
        } catch {}
      }, 5000);
    }
  }

  destroy(): void {
    this.cleanup();
  }
}
