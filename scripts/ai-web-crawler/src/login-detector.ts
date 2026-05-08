/**
 * Login Detector
 * 检测页面是否为登录页面，支持 DOM 特征检测和可选的 LLM 截图二次确认
 */

import { Page } from 'playwright-core';
import { ScreenshotManager } from './screenshot-manager';

export interface LoginDetectionResult {
  isLoginPage: boolean;
  confidence: number;
  detectionMethod: 'dom' | 'dom+llm';
  siteInfo: { url: string; domain: string; title: string };
  indicators: {
    hasPasswordInput: boolean;
    hasCaptcha: boolean;
    hasLoginButton: boolean;
    hasLoginForm: boolean;
    loginFormSelector?: string;
  };
}

export interface LoginDetectorConfig {
  enableLLMConfirmation: boolean;
  domConfidenceThreshold: number;
  llmConfidenceThreshold: number;
}

const DEFAULT_CONFIG: LoginDetectorConfig = {
  enableLLMConfirmation: false,
  domConfidenceThreshold: 0.7,
  llmConfidenceThreshold: 0.8,
};

export class LoginDetector {
  private config: LoginDetectorConfig;

  constructor(config?: Partial<LoginDetectorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** 检测当前页面是否为登录页（只读，不修改 DOM） */
  async detectLogin(page: Page, screenshotManager?: ScreenshotManager): Promise<LoginDetectionResult> {
    const siteInfo = await this.getSiteInfo(page);

    // 排除本地页面：Electron 渲染进程的 file:// 页面不可能是登录页
    if (siteInfo.url.startsWith('file://')) {
      return {
        isLoginPage: false, confidence: 0, detectionMethod: 'dom', siteInfo,
        indicators: { hasPasswordInput: false, hasCaptcha: false, hasLoginButton: false, hasLoginForm: false },
      };
    }

    // URL 快速检测：检查主页面 URL 和所有 iframe URL
    let urlBonus = 0;
    const urlLower = siteInfo.url.toLowerCase();
    if (urlLower.includes('/login') || urlLower.includes('/signin') || urlLower.includes('/sign-in') || urlLower.includes('/oauth-login') || urlLower.includes('/sso')) {
      urlBonus = 0.15;
    }
    // 通用登录子域名前缀检测（account.、passport.、login.、auth.、sso.）
    if (urlBonus === 0) {
      try {
        const hostname = new URL(siteInfo.url).hostname.toLowerCase();
        const loginSubdomains = ['account.', 'passport.', 'login.', 'auth.', 'sso.', 'signin.', 'id.'];
        if (loginSubdomains.some(prefix => hostname.startsWith(prefix))) {
          urlBonus = 0.15;
        }
      } catch {}
    }
    // 也检查 iframe URL（美团等网站主页面 URL 不含 login，但 iframe URL 含）
    if (urlBonus === 0) {
      try {
        for (const frame of page.frames()) {
          const fUrl = frame.url().toLowerCase();
          if (fUrl.includes('/login') || fUrl.includes('/signin') || fUrl.includes('/sign-in') || fUrl.includes('/oauth-login') || fUrl.includes('/sso') || fUrl.includes('passport') || fUrl.includes('epassport')) {
            urlBonus = 0.15;
            break;
          }
        }
      } catch {}
    }

    const domResult = await this.detectByDOM(page);
    const combinedConfidence = Math.min(domResult.confidence + urlBonus, 1.0);

    console.error(`[LoginDetector] DOM detection: confidence=${domResult.confidence}, urlBonus=${urlBonus}, combined=${combinedConfidence}, indicators=${JSON.stringify(domResult.indicators)}, url=${siteInfo.url.substring(0, 80)}`);

    let finalConfidence = combinedConfidence;
    let detectionMethod: 'dom' | 'dom+llm' = 'dom';

    // 灰色区间 [0.4, 0.7) 且启用 LLM 确认时，进行二次确认
    if (
      this.config.enableLLMConfirmation &&
      combinedConfidence >= 0.4 &&
      combinedConfidence < this.config.domConfidenceThreshold &&
      screenshotManager
    ) {
      try {
        const screenshot = await page.screenshot({ type: 'jpeg', quality: 70, fullPage: false, timeout: 8000 });
        const llmConfidence = await this.confirmByLLM(Buffer.from(screenshot));
        finalConfidence = Math.max(domResult.confidence, llmConfidence);
        detectionMethod = 'dom+llm';
      } catch (err) {
        console.error('[LoginDetector] LLM confirmation failed:', err);
      }
    }

    return {
      isLoginPage: finalConfidence >= this.config.domConfidenceThreshold,
      confidence: finalConfidence,
      detectionMethod,
      siteInfo,
      indicators: domResult.indicators,
    };
  }

  /** 检测登录是否已完成 */
  async isLoginComplete(page: Page): Promise<boolean> {
    const domResult = await this.detectByDOM(page);
    return domResult.confidence < 0.4;
  }

  private async detectByDOM(page: Page): Promise<{
    confidence: number;
    indicators: LoginDetectionResult['indicators'];
  }> {
    // 检测逻辑（在单个 frame 上下文中执行）
    const detectInFrame = async (frame: any): Promise<{ score: number; indicators: LoginDetectionResult['indicators'] }> => {
      try {
        return await frame.evaluate(() => {
          let score = 0;
          const indicators = {
            hasPasswordInput: false, hasCaptcha: false,
            hasLoginButton: false, hasLoginForm: false,
            loginFormSelector: undefined as string | undefined,
          };

          // 1. 密码输入框 (0.4)
          if (document.querySelectorAll('input[type="password"], input[autocomplete="current-password"]').length > 0) {
            indicators.hasPasswordInput = true;
            score += 0.4;
          }

          // 1b. 用户名/手机号输入框（无密码框时）(0.25)
          // 验证码登录场景：没有密码框，但有手机号/用户名输入框
          // 条件更严格：页面输入框 ≤ 3 个，避免搜索页、预订页等误判
          if (!indicators.hasPasswordInput) {
            const usernameInputs = document.querySelectorAll(
              'input[type="tel"], input[autocomplete="username"], input[autocomplete="tel"], ' +
              'input[name*="phone"], input[name*="mobile"], input[name*="account"], ' +
              'input[placeholder*="手机"], input[placeholder*="账号"], input[placeholder*="用户名"], ' +
              'input[placeholder*="phone"], input[placeholder*="email"], input[placeholder*="邮箱"]'
            );
            const allInputs = document.querySelectorAll('input:not([type="hidden"])');
            if (usernameInputs.length > 0 && allInputs.length <= 3) {
              score += 0.25;
            }
          }

          // 2. 验证码元素 (0.2)
          const captchaSelectors = [
            '[class*="captcha"]', '[id*="captcha"]', '[class*="verify"]', '[id*="verify"]',
            '[class*="slider"]', '[id*="slider"]', 'iframe[src*="captcha"]', 'iframe[src*="recaptcha"]',
            '[class*="geetest"]', '[id*="geetest"]', '[class*="yunpian"]',
          ];
          for (const sel of captchaSelectors) {
            if (document.querySelector(sel)) { indicators.hasCaptcha = true; score += 0.2; break; }
          }

          // 3. 登录按钮 (0.25)
          // 只匹配明确的登录相关文本
          // "提交"/"submit"/"next"/"继续"/"下一步" 在非登录页太常见，不纳入
          // "获取验证码"/"发送验证码" 是强登录信号，保留
          const loginKw = ['登录', '登入', 'login', 'sign in', 'log in', '立即登录', '确认登录', '获取验证码', '发送验证码'];
          const btns = document.querySelectorAll('button, input[type="submit"], a[role="button"], [class*="login-btn"], [class*="submit"]');
          for (const btn of btns) {
            const t = (btn as HTMLElement).innerText?.toLowerCase().trim();
            if (t && loginKw.some(kw => t.includes(kw))) { indicators.hasLoginButton = true; score += 0.25; break; }
          }

          // 4. 登录表单 (0.15)
          for (const form of document.querySelectorAll('form')) {
            const action = form.getAttribute('action') || '';
            if (form.querySelector('input[type="password"]') || action.toLowerCase().includes('login') || action.toLowerCase().includes('signin')) {
              indicators.hasLoginForm = true;
              indicators.loginFormSelector = form.id ? `#${form.id}` : undefined;
              score += 0.15;
              break;
            }
          }

          return { score: Math.min(score, 1.0), indicators };
        });
      } catch {
        return { score: 0, indicators: { hasPasswordInput: false, hasCaptcha: false, hasLoginButton: false, hasLoginForm: false } };
      }
    };

    // 先检测主框架
    let best = await detectInFrame(page);

    // 如果主框架没检测到，遍历所有 iframe（包括跨域 iframe）
    if (best.score < this.config.domConfidenceThreshold) {
      try {
        const frames = page.frames();
        console.error(`[LoginDetector] Scanning ${frames.length} frames for login indicators`);
        for (const frame of frames) {
          if (frame === page.mainFrame()) continue;
          const frameUrl = frame.url();
          if (!frameUrl || frameUrl === 'about:blank' || frameUrl.startsWith('chrome://')) continue;

          const frameResult = await detectInFrame(frame);
          console.error(`[LoginDetector] iframe ${frameUrl.substring(0, 60)}: score=${frameResult.score}`);
          if (frameResult.score > best.score) {
            best = frameResult;
          }
          if (best.score >= this.config.domConfidenceThreshold) break;
        }
      } catch (err) {
        console.error('[LoginDetector] Error scanning iframes:', err);
      }
    }

    // 如果 iframe 扫描也没检测到，尝试在主框架中检测是否存在包含登录关键词的 iframe
    if (best.score < this.config.domConfidenceThreshold) {
      try {
        const iframeLoginScore = await page.evaluate(() => {
          let score = 0;
          const iframes = document.querySelectorAll('iframe');
          for (const iframe of iframes) {
            const src = (iframe.getAttribute('src') || '').toLowerCase();
            if (src.includes('login') || src.includes('passport') || src.includes('oauth') || src.includes('signin') || src.includes('sso')) {
              score = 0.55; // iframe src 包含登录关键词，给较高分
              break;
            }
          }
          return score;
        });
        if (iframeLoginScore > best.score) {
          console.error(`[LoginDetector] Detected login iframe via src attribute: score=${iframeLoginScore}`);
          best = { score: iframeLoginScore, indicators: { ...best.indicators, hasLoginForm: true } };
        }
      } catch {}
    }

    return { confidence: best.score, indicators: best.indicators };
  }

  /** LLM 截图分析（预留接口） */
  private async confirmByLLM(_screenshot: Buffer): Promise<number> {
    return 0;
  }

  private async getSiteInfo(page: Page): Promise<LoginDetectionResult['siteInfo']> {
    const url = page.url();
    let domain = '';
    try { domain = new URL(url).hostname; } catch {}
    let title = '';
    try { title = await page.title(); } catch {}
    return { url, domain, title };
  }
}
