/**
 * Google Auth Helper - 独立子进程 Google 登录方案
 *
 * 核心思路：Google 检测到 CDP 远程调试端口（--remote-debugging-port）就会拒绝登录。
 * 主进程必须开 CDP 端口给爬虫用，所以 Google 登录必须在一个不带 CDP 的独立进程中完成。
 *
 * 流程：
 * 1. 检测到 Google 登录 URL → 启动独立 Electron 子进程（不带 CDP 和反检测 flags）
 * 2. 子进程打开干净的 BrowserWindow，用户在里面完成 Google 登录
 * 3. 登录完成后，子进程导出所有 google.com 域的 cookie
 * 4. 通过 IPC（stdout JSON）把 cookie 传回主进程
 * 5. 主进程用 session.defaultSession.cookies.set() 写入
 * 6. 刷新原始页面，Google 发现已有登录态，直接授权回跳
 */

import { session, BrowserWindow } from 'electron';
import * as path from 'path';
import * as child_process from 'child_process';
import * as fs from 'fs';
import * as os from 'os';

// Cookie 传输格式
interface GoogleCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite?: 'unspecified' | 'no_restriction' | 'lax' | 'strict';
  expirationDate?: number;
}

interface AuthResult {
  success: boolean;
  cookies?: GoogleCookie[];
  error?: string;
}

export class GoogleAuthHelper {
  private childProcess: child_process.ChildProcess | null = null;
  private isAuthInProgress = false;

  /**
   * 在独立子进程中完成 Google 登录，然后同步 cookie 回主进程
   * @param originalUrl 触发 Google 登录的原始 URL（如 accounts.google.com/...）
   * @returns 是否登录成功
   */
  async performGoogleAuth(originalUrl: string): Promise<boolean> {
    if (this.isAuthInProgress) {
      console.log('[GoogleAuth] Auth already in progress, skipping');
      return false;
    }

    this.isAuthInProgress = true;
    console.log('[GoogleAuth] Starting Google auth in clean subprocess for:', originalUrl);

    try {
      // 1. 启动独立子进程完成登录
      const result = await this.launchCleanAuthProcess(originalUrl);

      if (!result.success || !result.cookies || result.cookies.length === 0) {
        console.error('[GoogleAuth] Auth failed:', result.error || 'No cookies returned');
        return false;
      }

      console.log(`[GoogleAuth] Auth successful, got ${result.cookies.length} cookies`);

      // 2. 将 cookie 写入主进程的 session
      await this.importCookies(result.cookies);

      console.log('[GoogleAuth] Cookies imported to main session');
      return true;
    } catch (error) {
      console.error('[GoogleAuth] Auth error:', error);
      return false;
    } finally {
      this.isAuthInProgress = false;
      this.childProcess = null;
    }
  }

  /**
   * 启动一个干净的 Electron 子进程来完成 Google 登录
   */
  private launchCleanAuthProcess(url: string): Promise<AuthResult> {
    return new Promise((resolve) => {
      const scriptPath = path.join(__dirname, 'google-auth-subprocess.js');

      // 检查子进程脚本是否存在
      if (!fs.existsSync(scriptPath)) {
        resolve({ success: false, error: 'Auth subprocess script not found: ' + scriptPath });
        return;
      }

      // 找到 Electron 可执行文件路径
      const electronPath = process.execPath;

      // 启动独立 Electron 进程 — 关键：不带任何 CDP 或反检测 flags
      this.childProcess = child_process.spawn(electronPath, [scriptPath, url], {
        env: {
          ...process.env,
          // 确保子进程不继承主进程的 Electron flags
          ELECTRON_RUN_AS_NODE: undefined as any,
          // 传递一些必要信息
          GOOGLE_AUTH_URL: url,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let resolved = false;

      this.childProcess.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      this.childProcess.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
        // 打印子进程的 stderr 用于调试
        const lines = data.toString().split('\n').filter((l: string) => l.trim());
        lines.forEach((line: string) => {
          console.log('[GoogleAuth:subprocess]', line);
        });
      });

      this.childProcess.on('close', (code: number | null) => {
        if (resolved) return;
        resolved = true;

        console.log(`[GoogleAuth] Subprocess exited with code: ${code}`);

        if (code !== 0) {
          resolve({ success: false, error: `Subprocess exited with code ${code}: ${stderr}` });
          return;
        }

        // 解析 stdout 中的 JSON 结果
        try {
          // 找到 JSON 输出（子进程会在最后输出 JSON）
          const jsonMatch = stdout.match(/\{[\s\S]*"success"[\s\S]*\}/);
          if (jsonMatch) {
            const result: AuthResult = JSON.parse(jsonMatch[0]);
            resolve(result);
          } else {
            resolve({ success: false, error: 'No JSON result in subprocess output' });
          }
        } catch (parseError) {
          resolve({ success: false, error: `Failed to parse subprocess output: ${parseError}` });
        }
      });

      // 超时处理：5 分钟后自动关闭（用户可能放弃登录）
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          this.killChildProcess();
          resolve({ success: false, error: 'Auth timeout (5 minutes)' });
        }
      }, 5 * 60 * 1000);
    });
  }

  /**
   * 将 cookie 写入主进程的 Electron session
   */
  private async importCookies(cookies: GoogleCookie[]): Promise<void> {
    const ses = session.defaultSession;

    for (const cookie of cookies) {
      try {
        const cookieDetails: Electron.CookiesSetDetails = {
          url: `https://${cookie.domain.replace(/^\./, '')}${cookie.path || '/'}`,
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain,
          path: cookie.path || '/',
          secure: cookie.secure,
          httpOnly: cookie.httpOnly,
          sameSite: cookie.sameSite || 'no_restriction',
        };

        // 设置过期时间（如果有）
        if (cookie.expirationDate && cookie.expirationDate > 0) {
          cookieDetails.expirationDate = cookie.expirationDate;
        }

        await ses.cookies.set(cookieDetails);
      } catch (error) {
        // 某些 cookie 可能因为格式问题写入失败，跳过继续
        console.warn(`[GoogleAuth] Failed to import cookie ${cookie.name}@${cookie.domain}:`, error);
      }
    }
  }

  /**
   * 终止子进程
   */
  private killChildProcess(): void {
    if (this.childProcess && !this.childProcess.killed) {
      try {
        this.childProcess.kill('SIGTERM');
      } catch {}
    }
  }

  /**
   * 清理资源
   */
  destroy(): void {
    this.killChildProcess();
  }
}
