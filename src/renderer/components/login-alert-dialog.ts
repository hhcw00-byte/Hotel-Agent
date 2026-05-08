/**
 * LoginAlertDialog - 聊天面板内的登录提示弹窗
 * 当平台未登录时，在聊天消息区域内显示内联提示
 */

export class LoginAlertDialog {
  private chatMessages: HTMLElement;
  private lastAlertTime: Map<string, number> = new Map();
  private DEBOUNCE_MS = 60_000;

  constructor(chatMessagesElement: HTMLElement) {
    this.chatMessages = chatMessagesElement;
  }

  /** 显示登录提示 */
  show(platforms: string[]): void {
    if (platforms.length === 0) return;

    // 防抖：同一平台 60 秒内不重复弹窗
    const now = Date.now();
    const newPlatforms = platforms.filter(p => {
      const last = this.lastAlertTime.get(p) || 0;
      return now - last > this.DEBOUNCE_MS;
    });
    if (newPlatforms.length === 0) return;
    for (const p of newPlatforms) this.lastAlertTime.set(p, now);

    // 移除已有的提示（避免堆叠）
    this.dismiss();

    const alertDiv = document.createElement('div');
    alertDiv.className = 'login-alert-inline';
    alertDiv.id = 'loginAlertInline';

    const names = newPlatforms.join('、');
    alertDiv.innerHTML = `
      <div class="login-alert-content">
        <span class="login-alert-icon">🔐</span>
        <span class="login-alert-text">
          <strong>${this.escapeHtml(names)}</strong> 未登录，请在左侧浏览器中登录该平台，登录后即可正常获取数据。
        </span>
      </div>
      <div class="login-alert-actions">
        <button class="login-alert-btn login-alert-confirm">确认</button>
        <button class="login-alert-btn login-alert-cancel">取消</button>
      </div>
    `;

    alertDiv.querySelector('.login-alert-confirm')?.addEventListener('click', () => this.dismiss());
    alertDiv.querySelector('.login-alert-cancel')?.addEventListener('click', () => this.dismiss());

    this.chatMessages.appendChild(alertDiv);
    this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
  }

  /** 关闭提示 */
  dismiss(): void {
    const existing = document.getElementById('loginAlertInline');
    if (existing) existing.remove();
  }

  /** 清理 */
  destroy(): void {
    this.dismiss();
    this.lastAlertTime.clear();
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
