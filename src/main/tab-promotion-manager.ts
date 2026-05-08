/**
 * Tab Promotion Manager
 * 管理后台标签页（bgTab）与前端标签页（tab）之间的提升/降级
 * 
 * 流程：
 * 1. 爬虫检测到登录页 → notifyLoginRequired() → 只显示横幅，bgTab 不动
 * 2. 用户点击"前往登录" → promoteAndSwitch() → 提升 bgTab 并切换显示
 * 3. 用户点击"完成" → demoteToBgTab() → 降级回 bgTab
 * 4. 用户点击"跳过" → skipLogin() → 写 skipped 响应
 */

import { BrowserWindow } from 'electron';
import { WindowManager } from './window-manager';
import { IPC_CHANNELS } from '../shared/types';

export interface PendingLoginRequest {
  bgTabId: string;
  requestId: string;
  siteInfo: { url: string; domain: string; title: string };
  createdAt: number;
}

export interface PromotedTabInfo {
  originalBgTabId: string;
  promotedTabId: string;
  sessionId: string | null;
  requestId: string;
  notificationId: string;
  siteInfo: { url: string; domain: string; title: string };
  promotedAt: number;
}

export class TabPromotionManager {
  private promotedTabs: Map<string, PromotedTabInfo> = new Map();
  private pendingLogins: Map<string, PendingLoginRequest> = new Map();
  private notifToPromoted: Map<string, string> = new Map();
  private notificationCounter = 0;

  constructor(
    private windowManager: WindowManager,
    private mainWindow: BrowserWindow
  ) {}

  /**
   * 第一步：只显示横幅通知，不提升 bgTab。
   * bgTab 保持在 bgWindow 中，不会触发任何弹窗。
   */
  notifyLoginRequired(bgTabId: string, requestId: string, siteInfo: PendingLoginRequest['siteInfo']): string {
    const notificationId = `login-notify-${++this.notificationCounter}`;
    this.pendingLogins.set(notificationId, { bgTabId, requestId, siteInfo, createdAt: Date.now() });

    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(IPC_CHANNELS.LOGIN_REQUIRED, {
        id: notificationId, siteUrl: siteInfo.url, siteDomain: siteInfo.domain, siteTitle: siteInfo.title,
      });
    }
    console.log(`[TabPromotionManager] Login notification sent: ${notificationId} (bgTab=${bgTabId})`);
    return notificationId;
  }

  /**
   * 第二步：用户点击"前往登录"时才提升 bgTab 并切换显示。
   */
  promoteAndSwitch(notificationId: string): void {
    const pending = this.pendingLogins.get(notificationId);
    if (!pending) {
      console.warn(`[TabPromotionManager] No pending login for: ${notificationId}`);
      return;
    }

    const sessionId = this.windowManager.getBgTabSessionId(pending.bgTabId);
    let promotedTabId: string;
    try {
      promotedTabId = this.windowManager.promoteBgTabToFront(pending.bgTabId);
    } catch (e) {
      console.error(`[TabPromotionManager] Failed to promote bgTab ${pending.bgTabId}:`, e);
      this.pendingLogins.delete(notificationId);
      this.dismissNotification(notificationId);
      return;
    }

    this.promotedTabs.set(promotedTabId, {
      originalBgTabId: pending.bgTabId, promotedTabId, sessionId,
      requestId: pending.requestId, notificationId, siteInfo: pending.siteInfo, promotedAt: Date.now(),
    });
    this.notifToPromoted.set(notificationId, promotedTabId);
    this.pendingLogins.delete(notificationId);

    this.windowManager.switchTab(promotedTabId);
    console.log(`[TabPromotionManager] Promoted and switched: ${pending.bgTabId} → ${promotedTabId}`);
  }

  /** 根据 notificationId 或 promotedTabId 解析出 promotedTabId */
  private resolvePromotedTabId(id: string): string | null {
    if (this.promotedTabs.has(id)) return id;
    return this.notifToPromoted.get(id) || null;
  }

  /** 将前端标签页降级回 bg tab */
  demoteToBgTab(id: string): string {
    const promotedTabId = this.resolvePromotedTabId(id);
    if (!promotedTabId) throw new Error(`Promoted tab not found for: ${id}`);
    const info = this.promotedTabs.get(promotedTabId)!;

    const bgTabId = this.windowManager.demoteTabToBg(promotedTabId, info.originalBgTabId, info.sessionId);
    this.cleanupEntry(info);
    console.log(`[TabPromotionManager] Demoted ${promotedTabId} → ${bgTabId}`);
    return bgTabId;
  }

  /** 跳过登录 */
  skipLogin(id: string): void {
    // 还在 pending 阶段（用户没点"前往登录"就点了"跳过"）
    if (this.pendingLogins.has(id)) {
      this.pendingLogins.delete(id);
      this.dismissNotification(id);
      console.log(`[TabPromotionManager] Skipped login (pending): ${id}`);
      return;
    }
    // 已经提升了
    const promotedTabId = this.resolvePromotedTabId(id);
    if (!promotedTabId) return;
    const info = this.promotedTabs.get(promotedTabId);
    if (!info) return;

    this.windowManager.closeTab(promotedTabId);
    this.cleanupEntry(info);
    console.log(`[TabPromotionManager] Skipped login (promoted): ${promotedTabId}`);
  }

  /** 获取 requestId（用于写 IPC 响应文件） */
  getRequestId(id: string): string | null {
    const pending = this.pendingLogins.get(id);
    if (pending) return pending.requestId;
    const promotedTabId = this.resolvePromotedTabId(id);
    if (promotedTabId) return this.promotedTabs.get(promotedTabId)?.requestId || null;
    return null;
  }

  getPromotedTabInfo(id: string): PromotedTabInfo | undefined {
    const promotedTabId = this.resolvePromotedTabId(id);
    return promotedTabId ? this.promotedTabs.get(promotedTabId) : undefined;
  }

  isPromotedTab(tabId: string): boolean { return this.promotedTabs.has(tabId); }
  isPendingLogin(id: string): boolean { return this.pendingLogins.has(id); }
  getPromotedTabs(): PromotedTabInfo[] { return Array.from(this.promotedTabs.values()); }
  hasPromotedTabs(): boolean { return this.promotedTabs.size > 0; }
  setMainWindow(win: BrowserWindow): void { this.mainWindow = win; }

  /** 清理提升记录（由 WindowManager.closeTab 调用，避免递归） */
  dismissAndCleanup(promotedTabId: string): void {
    const info = this.promotedTabs.get(promotedTabId);
    if (!info) return;
    this.cleanupEntry(info);
  }

  private cleanupEntry(info: PromotedTabInfo): void {
    this.dismissNotification(info.notificationId);
    this.promotedTabs.delete(info.promotedTabId);
    this.notifToPromoted.delete(info.notificationId);
  }

  private dismissNotification(id: string): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(IPC_CHANNELS.LOGIN_DISMISSED, { id });
    }
  }
}
