/**
 * LoginPage - 登录/注册页面组件
 *
 * 职责：
 * - 提供登录和注册表单 UI
 * - 快速切换用户列表
 * - 登录成功后切换到主页面
 * - 注册成功后切换到登录表单并提示
 */

import type { SavedCredential, LoginResult, RegisterResult, AuthenticatedUser } from '../../shared/types';

type Lang = 'zh' | 'en';
const _t: Record<string, Record<Lang, string>> = {
  quickLogin: { zh: '快速登录', en: 'Quick Login' },
  username: { zh: '用户名', en: 'Username' },
  password: { zh: '密码', en: 'Password' },
  usernamePh: { zh: '请输入用户名', en: 'Enter username' },
  passwordPh: { zh: '请输入密码', en: 'Enter password' },
  rememberPwd: { zh: '记住密码', en: 'Remember password' },
  login: { zh: '登录', en: 'Login' },
  noAccount: { zh: '没有账号？', en: "Don't have an account? " },
  register: { zh: '注册', en: 'Register' },
  or: { zh: '或', en: 'or' },
  googleLogin: { zh: '使用 Google 账号登录', en: 'Sign in with Google' },
  regUsername: { zh: '用户名', en: 'Username' },
  regUsernamePh: { zh: '2-32位，字母数字下划线', en: '2-32 chars, letters/numbers/_' },
  regPassword: { zh: '密码', en: 'Password' },
  regPasswordPh: { zh: '6-64位密码', en: '6-64 characters' },
  regConfirm: { zh: '确认密码', en: 'Confirm Password' },
  regConfirmPh: { zh: '再次输入密码', en: 'Re-enter password' },
  displayName: { zh: '显示名称', en: 'Display Name' },
  displayNamePh: { zh: '您的显示名称', en: 'Your display name' },
  hasAccount: { zh: '已有账号？', en: 'Already have an account? ' },
  loggingIn: { zh: '登录中...', en: 'Logging in...' },
  registering: { zh: '注册中...', en: 'Registering...' },
  openingChrome: { zh: '正在打开 Chrome 登录...', en: 'Opening Chrome...' },
  enterUsername: { zh: '请输入用户名', en: 'Please enter username' },
  enterPassword: { zh: '请输入密码', en: 'Please enter password' },
  confirmPassword: { zh: '请确认密码', en: 'Please confirm password' },
  passwordMismatch: { zh: '两次密码不一致', en: 'Passwords do not match' },
  enterDisplayName: { zh: '请输入显示名称', en: 'Please enter display name' },
  loginFailed: { zh: '登录失败', en: 'Login failed' },
  registerFailed: { zh: '注册失败', en: 'Registration failed' },
  registerSuccess: { zh: '注册成功，请登录', en: 'Registered successfully, please login' },
  googleLoginFailed: { zh: 'Google 登录失败', en: 'Google login failed' },
  autoLoginFailed: { zh: '自动登录失败', en: 'Auto login failed' },
  savedPwd: { zh: '已记住密码', en: 'Password saved' },
  removeAccount: { zh: '删除此账号记录', en: 'Remove this account' },
};
function getLang(): Lang { return (typeof localStorage !== 'undefined' && localStorage.getItem('app-language') === 'en') ? 'en' : 'zh'; }
function lt(key: string): string { const e = _t[key]; return e ? (e[getLang()] || e.zh) : key; }

export class LoginPage {
  private container: HTMLElement;
  private currentForm: 'login' | 'register' = 'login';
  private boundKeydownHandler: ((e: KeyboardEvent) => void) | null = null;

  /** 登录成功回调，供外部（app.ts）绑定业务初始化逻辑 */
  public onLoginSuccess: ((user: AuthenticatedUser) => void) | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  /** 渲染登录页面到容器 */
  async render(): Promise<void> {
    this.container.innerHTML = '';
    this.container.appendChild(this.createLoginPageDOM());
    this.bindEvents();
    await this.loadSavedCredentials();
  }

  /** 清理事件监听 */
  destroy(): void {
    if (this.boundKeydownHandler) {
      document.removeEventListener('keydown', this.boundKeydownHandler);
      this.boundKeydownHandler = null;
    }
    this.container.innerHTML = '';
    this.onLoginSuccess = null;
  }

  // ==================== DOM 构建 ====================

  private createLoginPageDOM(): HTMLElement {
    const page = document.createElement('div');
    page.className = 'login-page';
    page.id = 'loginPage';

    page.innerHTML = `
      <div class="login-card">
        <div class="login-lang-toggle">
          <button type="button" id="loginLangBtn" class="lang-toggle-btn">${getLang() === 'zh' ? 'EN' : '中文'}</button>
        </div>
        <div class="login-header">
          <div class="login-logo">🏨</div>
          <h1 class="login-title">Hotel-Agent</h1>
        </div>

        <div class="login-error" id="loginError" style="display:none;"></div>
        <div class="login-success" id="loginSuccess" style="display:none;"></div>

        <div class="quick-switch" id="quickSwitch" style="display:none;">
          <div class="quick-switch-title">${lt('quickLogin')}</div>
          <div class="quick-switch-list" id="quickSwitchList"></div>
        </div>

        <!-- 登录表单 -->
        <form class="login-form" id="loginForm">
          <div class="form-group">
            <label for="loginUsername">${lt('username')}</label>
            <input type="text" id="loginUsername" placeholder="${lt('usernamePh')}" autocomplete="username" />
          </div>
          <div class="form-group">
            <label for="loginPassword">${lt('password')}</label>
            <input type="password" id="loginPassword" placeholder="${lt('passwordPh')}" autocomplete="current-password" />
          </div>
          <div class="form-options">
            <label class="checkbox-label">
              <input type="checkbox" id="rememberPassword" checked />
              <span>${lt('rememberPwd')}</span>
            </label>
          </div>
          <button type="submit" class="login-btn" id="loginBtn">${lt('login')}</button>
          <div class="form-link" style="display:none">
            ${lt('noAccount')}<a href="#" id="showRegister">${lt('register')}</a>
          </div>
        </form>

        <!-- Google 登录按钮（暂时屏蔽） -->
        <div class="google-login-divider" style="display:none">
          <span>${lt('or')}</span>
        </div>
        <button class="google-login-btn" id="googleLoginBtn" style="display:none">
          <svg class="google-icon" viewBox="0 0 24 24" width="18" height="18">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          ${lt('googleLogin')}
        </button>

        <!-- 注册表单 -->
        <form class="login-form" id="registerForm" style="display:none;">
          <div class="form-group">
            <label for="regUsername">${lt('regUsername')}</label>
            <input type="text" id="regUsername" placeholder="${lt('regUsernamePh')}" autocomplete="username" />
          </div>
          <div class="form-group">
            <label for="regPassword">${lt('regPassword')}</label>
            <input type="password" id="regPassword" placeholder="${lt('regPasswordPh')}" autocomplete="new-password" />
          </div>
          <div class="form-group">
            <label for="regConfirmPassword">${lt('regConfirm')}</label>
            <input type="password" id="regConfirmPassword" placeholder="${lt('regConfirmPh')}" autocomplete="new-password" />
          </div>
          <div class="form-group">
            <label for="regDisplayName">${lt('displayName')}</label>
            <input type="text" id="regDisplayName" placeholder="${lt('displayNamePh')}" autocomplete="name" />
          </div>
          <button type="submit" class="login-btn" id="registerBtn">${lt('register')}</button>
          <div class="form-link">
            ${lt('hasAccount')}<a href="#" id="showLogin">${lt('login')}</a>
          </div>
        </form>
      </div>
    `;

    return page;
  }

  // ==================== 事件绑定 ====================

  private bindEvents(): void {
    // 登录表单提交
    const loginForm = this.container.querySelector('#loginForm') as HTMLFormElement;
    loginForm?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleLogin();
    });

    // 注册表单提交
    const registerForm = this.container.querySelector('#registerForm') as HTMLFormElement;
    registerForm?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleRegister();
    });

    // 表单切换
    this.container.querySelector('#showRegister')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.switchForm('register');
    });
    this.container.querySelector('#showLogin')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.switchForm('login');
    });

    // Google 登录按钮
    this.container.querySelector('#googleLoginBtn')?.addEventListener('click', () => {
      this.handleGoogleLogin();
    });

    // 语言切换按钮
    this.container.querySelector('#loginLangBtn')?.addEventListener('click', () => {
      const newLang = getLang() === 'zh' ? 'en' : 'zh';
      localStorage.setItem('app-language', newLang);
      // 通知主进程
      window.electronAPI?.config?.setLanguage?.(newLang).catch(() => {});
      // 重新渲染整个登录页面
      this.render();
    });

    // 全局回车键提交
    this.boundKeydownHandler = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        const active = document.activeElement as HTMLElement;
        if (active?.tagName === 'INPUT') {
          e.preventDefault();
          if (this.currentForm === 'login') {
            this.handleLogin();
          } else {
            this.handleRegister();
          }
        }
      }
    };
    document.addEventListener('keydown', this.boundKeydownHandler);
  }

  // ==================== 表单切换 ====================

  private switchForm(form: 'login' | 'register'): void {
    this.currentForm = form;
    const loginForm = this.container.querySelector('#loginForm') as HTMLElement;
    const registerForm = this.container.querySelector('#registerForm') as HTMLElement;

    this.hideError();
    if (form === 'login') {
      this.hideSuccess();
    }

    if (form === 'login') {
      loginForm.style.display = '';
      registerForm.style.display = 'none';
    } else {
      loginForm.style.display = 'none';
      registerForm.style.display = '';
      this.hideSuccess();
    }
  }

  // ==================== 登录处理 ====================

  private async handleLogin(): Promise<void> {
    const usernameInput = this.container.querySelector('#loginUsername') as HTMLInputElement;
    const passwordInput = this.container.querySelector('#loginPassword') as HTMLInputElement;
    const rememberCheckbox = this.container.querySelector('#rememberPassword') as HTMLInputElement;
    const loginBtn = this.container.querySelector('#loginBtn') as HTMLButtonElement;

    const username = usernameInput?.value.trim();
    const password = passwordInput?.value;
    const rememberPassword = rememberCheckbox?.checked ?? true;

    if (!username) { this.showError(lt('enterUsername')); return; }
    if (!password) { this.showError(lt('enterPassword')); return; }

    this.setFormDisabled(true);
    loginBtn.textContent = lt('loggingIn');
    this.hideError();

    try {
      const result: LoginResult = await window.electronAPI.auth.login(username, password, rememberPassword);
      if (result.success && result.user) {
        this.handleLoginSuccess(result.user);
      } else {
        this.showError(result.error || lt('loginFailed'));
        this.setFormDisabled(false);
      }
    } catch (err: any) {
      this.showError(err.message || lt('loginFailed'));
      this.setFormDisabled(false);
    } finally {
      loginBtn.textContent = lt('login');
    }
  }

  // ==================== Google 登录处理 ====================

  private async handleGoogleLogin(): Promise<void> {
    const googleBtn = this.container.querySelector('#googleLoginBtn') as HTMLButtonElement;
    if (!googleBtn) return;

    this.hideError();
    this.setFormDisabled(true);
    googleBtn.textContent = lt('openingChrome');
    googleBtn.disabled = true;

    try {
      const result = await (window.electronAPI.auth as any).googleLogin();
      if (result.success && result.user) {
        this.handleLoginSuccess(result.user);
      } else {
        this.showError(result.error || lt('googleLoginFailed'));
        this.setFormDisabled(false);
      }
    } catch (err: any) {
      this.showError(err.message || lt('googleLoginFailed'));
      this.setFormDisabled(false);
    } finally {
      googleBtn.disabled = false;
      googleBtn.innerHTML = `
        <svg class="google-icon" viewBox="0 0 24 24" width="18" height="18">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
        </svg>
        ${lt('googleLogin')}
      `;
    }
  }

  // ==================== 注册处理 ====================

  private async handleRegister(): Promise<void> {
    const usernameInput = this.container.querySelector('#regUsername') as HTMLInputElement;
    const passwordInput = this.container.querySelector('#regPassword') as HTMLInputElement;
    const confirmInput = this.container.querySelector('#regConfirmPassword') as HTMLInputElement;
    const displayNameInput = this.container.querySelector('#regDisplayName') as HTMLInputElement;
    const registerBtn = this.container.querySelector('#registerBtn') as HTMLButtonElement;

    const username = usernameInput?.value.trim();
    const password = passwordInput?.value;
    const confirmPassword = confirmInput?.value;
    const displayName = displayNameInput?.value.trim();

    if (!username) { this.showError(lt('enterUsername')); return; }
    if (!password) { this.showError(lt('enterPassword')); return; }
    if (!confirmPassword) { this.showError(lt('confirmPassword')); return; }
    if (password !== confirmPassword) { this.showError(lt('passwordMismatch')); return; }
    if (!displayName) { this.showError(lt('enterDisplayName')); return; }

    registerBtn.disabled = true;
    registerBtn.textContent = lt('registering');
    this.setFormDisabled(true);
    this.hideError();

    try {
      const result: RegisterResult = await window.electronAPI.auth.register(username, password, displayName);
      if (result.success) {
        // 注册成功：切换到登录表单，显示成功提示
        this.switchForm('login');
        this.showSuccess(lt('registerSuccess'));
        // 预填用户名
        const loginUsernameInput = this.container.querySelector('#loginUsername') as HTMLInputElement;
        if (loginUsernameInput) {
          loginUsernameInput.value = username;
        }
        const loginPasswordInput = this.container.querySelector('#loginPassword') as HTMLInputElement;
        loginPasswordInput?.focus();
      } else {
        this.showError(result.error || lt('registerFailed'));
      }
    } catch (err: any) {
      this.showError(err.message || lt('registerFailed'));
    } finally {
      registerBtn.disabled = false;
      registerBtn.textContent = lt('register');
      this.setFormDisabled(false);
    }
  }

  // ==================== 登录成功处理（页面切换） ====================

  private handleLoginSuccess(user: AuthenticatedUser): void {
    // 隐藏登录页容器
    const loginContainer = document.getElementById('loginContainer');
    if (loginContainer) {
      loginContainer.style.display = 'none';
    }

    // 显示主页面容器（top-bar + split-container）
    const mainContainer = document.getElementById('mainContainer');
    if (mainContainer) {
      mainContainer.style.display = '';
    }

    // 触发外部回调
    if (this.onLoginSuccess) {
      this.onLoginSuccess(user);
    }
  }

  // ==================== 快速切换用户列表 ====================

  private async loadSavedCredentials(): Promise<void> {
    try {
      const credentials: SavedCredential[] = await window.electronAPI.auth.getSavedCredentials();
      this.renderQuickSwitch(credentials);
    } catch (err) {
      console.error('Failed to load saved credentials:', err);
    }
  }

  private renderQuickSwitch(credentials: SavedCredential[]): void {
    const quickSwitch = this.container.querySelector('#quickSwitch') as HTMLElement;
    const list = this.container.querySelector('#quickSwitchList') as HTMLElement;
    if (!quickSwitch || !list) return;

    if (!credentials || credentials.length === 0) {
      quickSwitch.style.display = 'none';
      return;
    }

    // 按最后登录时间倒序（API 已排序，但确保一下）
    const sorted = [...credentials].sort((a, b) => b.lastLoginAt - a.lastLoginAt);

    list.innerHTML = '';
    for (const cred of sorted) {
      const item = document.createElement('div');
      item.className = 'quick-switch-item';

      const info = document.createElement('div');
      info.className = 'quick-switch-info';
      info.innerHTML = `
        <span class="quick-switch-name">${this.esc(cred.displayName)}</span>
        <span class="quick-switch-username">@${this.esc(cred.username)}</span>
        ${cred.hasPassword ? `<span class="quick-switch-badge">${lt('savedPwd')}</span>` : ''}
      `;

      // 点击用户项
      info.addEventListener('click', () => this.handleQuickSwitch(cred));

      const removeBtn = document.createElement('button');
      removeBtn.className = 'quick-switch-remove';
      removeBtn.innerHTML = '×';
      removeBtn.title = lt('removeAccount');
      removeBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await this.handleRemoveCredential(cred.username);
      });

      item.appendChild(info);
      item.appendChild(removeBtn);
      list.appendChild(item);
    }

    quickSwitch.style.display = '';
  }

  private async handleQuickSwitch(cred: SavedCredential): Promise<void> {
    if (cred.hasPassword) {
      // 有记住密码 → 自动登录
      this.hideError();
      this.setFormDisabled(true);
      const loginBtn = this.container.querySelector('#loginBtn') as HTMLButtonElement;
      if (loginBtn) loginBtn.textContent = lt('loggingIn');
      try {
        const result: LoginResult = await window.electronAPI.auth.login(cred.username, '', true);
        if (result.success && result.user) {
          this.handleLoginSuccess(result.user);
        } else {
          this.showError(result.error || lt('autoLoginFailed'));
          this.setFormDisabled(false);
        }
      } catch (err: any) {
        this.showError(err.message || lt('autoLoginFailed'));
        this.setFormDisabled(false);
      } finally {
        if (loginBtn) loginBtn.textContent = lt('login');
      }
    } else {
      // 无记住密码 → 填充用户名，聚焦密码框
      this.switchForm('login');
      const usernameInput = this.container.querySelector('#loginUsername') as HTMLInputElement;
      const passwordInput = this.container.querySelector('#loginPassword') as HTMLInputElement;
      if (usernameInput) usernameInput.value = cred.username;
      if (passwordInput) {
        passwordInput.value = '';
        passwordInput.focus();
      }
    }
  }

  private async handleRemoveCredential(username: string): Promise<void> {
    try {
      await window.electronAPI.auth.removeSavedCredential(username);
      await this.loadSavedCredentials();
    } catch (err) {
      console.error('Failed to remove credential:', err);
    }
  }

  // ==================== 提示信息 ====================

  private showError(message: string): void {
    const el = this.container.querySelector('#loginError') as HTMLElement;
    if (el) {
      el.textContent = message;
      el.style.display = '';
    }
  }

  private hideError(): void {
    const el = this.container.querySelector('#loginError') as HTMLElement;
    if (el) el.style.display = 'none';
  }

  private showSuccess(message: string): void {
    const el = this.container.querySelector('#loginSuccess') as HTMLElement;
    if (el) {
      el.textContent = message;
      el.style.display = '';
    }
  }

  private hideSuccess(): void {
    const el = this.container.querySelector('#loginSuccess') as HTMLElement;
    if (el) el.style.display = 'none';
  }

  // ==================== 工具方法 ====================

  /** 禁用/启用整个登录卡片内的所有输入框、按钮和链接 */
  private setFormDisabled(disabled: boolean): void {
    const card = this.container.querySelector('.login-card');
    if (!card) return;
    card.querySelectorAll('input, button').forEach((el) => {
      (el as HTMLInputElement | HTMLButtonElement).disabled = disabled;
    });
    // 禁用/启用表单切换链接和快速切换点击区域
    card.querySelectorAll<HTMLElement>('a, .quick-switch-info, .quick-switch-remove').forEach((el) => {
      el.style.pointerEvents = disabled ? 'none' : '';
      el.style.opacity = disabled ? '0.5' : '';
    });
  }

  private esc(text: string): string {
    const d = document.createElement('div');
    d.textContent = text;
    return d.innerHTML;
  }
}
