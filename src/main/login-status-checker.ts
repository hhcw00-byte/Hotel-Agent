/**
 * LoginAlertService - 登录提醒服务
 * 
 * 纯弹窗能力：接收未登录的平台列表，向前端发送提示。
 * 不做任何登录检测逻辑（检测由外部 skill 或调用方负责）。
 */

import type { BrowserWindow } from 'electron';

const PLATFORM_DISPLAY_NAMES: Record<string, string> = {
  'ebooking.ctrip.com': '携程后台 (ebooking)',
  'hotels.ctrip.com': '携程',
  'ehotel.meituan.com': '美团商家后台',
  'me.meituan.com': '美团商家后台',
  'pms.meituan.com': '美团 PMS',
  'admin.booking.com': 'Booking 后台',
  'www.booking.com': 'Booking',
  'www.trip.com': 'Trip.com',
  'trip.com': 'Trip.com',
};

export class LoginAlertService {
  private mainWindow: BrowserWindow | null = null;

  setMainWindow(win: BrowserWindow): void {
    this.mainWindow = win;
  }

  /** 获取平台显示名称 */
  getDisplayName(cookieDomain: string): string {
    return PLATFORM_DISPLAY_NAMES[cookieDomain] || cookieDomain;
  }

  /**
   * 向前端发送登录提醒弹窗
   * @param platforms 未登录的平台显示名称列表（中文）
   */
  alert(platforms: string[]): void {
    if (platforms.length === 0) return;
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('login:status-alert', { platforms });
    }
  }

  /**
   * 根据 cookieDomain 发送登录提醒（自动翻译为中文名）
   * @param cookieDomains 未登录的平台 cookieDomain 列表
   */
  alertByDomains(cookieDomains: string[]): void {
    const names = cookieDomains.map(d => this.getDisplayName(d));
    this.alert(names);
  }
}
