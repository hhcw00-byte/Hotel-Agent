/**
 * Error Dialog - 错误提示组件
 *
 * 轻量级 toast 风格提示，显示在右侧面板顶部，不遮挡 BrowserView，
 * 无需隐藏/恢复 BrowserView，避免白屏问题。
 * 3秒后自动消失，也可点击关闭。
 */

export type ErrorLevel = 'error' | 'warning';

export interface ErrorDialogOptions {
  title?: string;
  message: string;
  details?: string;
  level?: ErrorLevel;
  onClose?: () => void;
}

/**
 * 错误提示类（Toast 风格）
 */
export class ErrorDialog {
  constructor() {}

  /**
   * 显示提示
   */
  async show(options: ErrorDialogOptions): Promise<void> {
    // 移除已有的 toast
    const existing = document.getElementById('errorToast');
    if (existing) existing.remove();

    const level = options.level || 'error';
    const icon = level === 'error' ? '⚠' : 'ℹ';

    const toast = document.createElement('div');
    toast.id = 'errorToast';
    toast.className = `error-toast error-toast-${level}`;
    toast.innerHTML = `
      <span class="error-toast-icon">${icon}</span>
      <span class="error-toast-message">${this.escapeHtml(options.message)}</span>
      <button class="error-toast-close" title="关闭">✕</button>
    `;

    // 插入到右侧面板（chatPanel 所在区域）顶部
    const rightPanel = document.getElementById('rightPanel');
    if (rightPanel) {
      rightPanel.insertBefore(toast, rightPanel.firstChild);
    } else {
      document.body.appendChild(toast);
    }

    // 关闭按钮
    const closeBtn = toast.querySelector('.error-toast-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        toast.classList.add('error-toast-hide');
        setTimeout(() => toast.remove(), 300);
      });
    }

    // 3秒后自动消失
    setTimeout(() => {
      if (toast.parentNode) {
        toast.classList.add('error-toast-hide');
        setTimeout(() => toast.remove(), 300);
      }
    }, 3000);
  }

  hide(): void {
    const toast = document.getElementById('errorToast');
    if (toast) toast.remove();
  }

  destroy(): void {
    this.hide();
  }

  private escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}

// 全局实例
let globalErrorDialog: ErrorDialog | null = null;

/**
 * 显示错误提示
 */
export function showError(message: string, _details?: string): void {
  if (!globalErrorDialog) {
    globalErrorDialog = new ErrorDialog();
  }
  globalErrorDialog.show({ level: 'error', message });
}

/**
 * 显示警告提示
 */
export function showWarning(message: string, _details?: string): void {
  if (!globalErrorDialog) {
    globalErrorDialog = new ErrorDialog();
  }
  globalErrorDialog.show({ level: 'warning', title: '警告', message });
}
