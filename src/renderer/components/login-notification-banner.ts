/**
 * Login Notification Banner
 * 聊天面板顶部非侵入式登录通知横幅，支持多个并发请求堆叠
 */

export interface LoginNotification {
  id: string;
  siteUrl: string;
  siteDomain: string;
  siteTitle: string;
  timestamp: number;
}

export class LoginNotificationBanner {
  private notifications: Map<string, LoginNotification> = new Map();
  private container: HTMLElement;
  private onGoToLogin?: (id: string) => void;
  private onLoginDone?: (id: string) => void;
  private onSkipLogin?: (id: string) => void;

  constructor(parentElement: HTMLElement) {
    this.container = parentElement;
    this.container.className = 'login-banner-container';
  }

  addNotification(notification: LoginNotification): void {
    if (this.notifications.has(notification.id)) return;
    this.notifications.set(notification.id, notification);
    this.renderItem(notification);
  }

  removeNotification(id: string): void {
    if (!this.notifications.has(id)) return;
    this.notifications.delete(id);
    const el = this.container.querySelector(`[data-login-id="${id}"]`);
    if (el) {
      el.classList.add('login-banner-exit');
      setTimeout(() => el.remove(), 200);
    }
  }

  setOnGoToLogin(cb: (id: string) => void): void { this.onGoToLogin = cb; }
  setOnLoginDone(cb: (id: string) => void): void { this.onLoginDone = cb; }
  setOnSkipLogin(cb: (id: string) => void): void { this.onSkipLogin = cb; }

  private renderItem(n: LoginNotification): void {
    const item = document.createElement('div');
    item.className = 'login-banner-item';
    item.dataset.loginId = n.id;

    const name = this.esc(n.siteTitle || n.siteDomain || n.siteUrl);
    item.innerHTML = `
      <div class="login-banner-icon">🔐</div>
      <div class="login-banner-text">
        <span class="login-banner-site">${name}</span>
        <span class="login-banner-hint">需要登录</span>
      </div>
      <div class="login-banner-actions">
        <button class="login-banner-btn login-banner-goto" data-action="go_to_login">前往登录</button>
        <button class="login-banner-btn login-banner-done" data-action="done">完成</button>
        <button class="login-banner-btn login-banner-skip" data-action="skip">跳过</button>
      </div>
    `;

    item.querySelector('[data-action="go_to_login"]')?.addEventListener('click', () => this.onGoToLogin?.(n.id));
    item.querySelector('[data-action="done"]')?.addEventListener('click', () => this.onLoginDone?.(n.id));
    item.querySelector('[data-action="skip"]')?.addEventListener('click', () => this.onSkipLogin?.(n.id));

    this.container.appendChild(item);
  }

  private esc(text: string): string {
    const d = document.createElement('div');
    d.textContent = text;
    return d.innerHTML;
  }

  destroy(): void {
    this.notifications.clear();
    this.container.innerHTML = '';
    this.onGoToLogin = undefined;
    this.onLoginDone = undefined;
    this.onSkipLogin = undefined;
  }
}
