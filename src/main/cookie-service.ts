/**
 * CookieService - Cookie 实时获取服务
 * 
 * 通过 Electron session API 实时获取浏览器 Cookie，
 * 注入给 API 脚本子进程使用。
 */

import { session } from 'electron';

export class CookieService {
  /**
   * 获取指定域名的所有 Cookie，格式化为 HTTP Cookie header 字符串
   * @param domain - 目标域名（如 'me.meituan.com'）
   * @returns Cookie 字符串，格式为 'name1=value1; name2=value2'，无 Cookie 时返回空字符串
   */
  async getCookiesForDomain(domain: string): Promise<string> {
    try {
      // Use URL-based query to match cookies including parent domains
      // e.g., domain='ebooking.ctrip.com' → also gets cookies from '.ctrip.com'
      const url = `https://${domain}/`;
      const cookies = await session.defaultSession.cookies.get({ url });

      // If domain looks like a parent domain (no subdomain prefix or only TLD parts),
      // also fetch all subdomain cookies via dot-prefixed domain query.
      // e.g., domain='trip.com' → also gets cookies from '.trip.com', 'us.trip.com', 'www.trip.com'
      const isParentDomain = domain.split('.').length <= 2;
      let allCookies = cookies || [];

      if (isParentDomain) {
        try {
          const parentDomainCookies = await session.defaultSession.cookies.get({ domain: `.${domain}` });
          if (parentDomainCookies && parentDomainCookies.length > 0) {
            // Merge and deduplicate by cookie name (URL query result takes priority)
            const existingNames = new Set(allCookies.map(c => c.name));
            for (const c of parentDomainCookies) {
              if (!existingNames.has(c.name)) {
                allCookies.push(c);
                existingNames.add(c.name);
              }
            }
          }
        } catch (_) { /* ignore parent domain query errors */ }
      }

      if (allCookies.length > 0) {
        return allCookies.map(c => `${c.name}=${c.value}`).join('; ');
      }

      // Fallback: try exact domain match
      const domainCookies = await session.defaultSession.cookies.get({ domain });
      if (!domainCookies || domainCookies.length === 0) {
        return '';
      }
      return domainCookies.map(c => `${c.name}=${c.value}`).join('; ');
    } catch (error) {
      return '';
    }
  }

  /**
   * 获取指定 URL 的原始 Cookie 对象数组
   * @param url - 目标 URL
   * @returns Electron Cookie 对象数组
   */
  async getRawCookies(url: string): Promise<Electron.Cookie[]> {
    try {
      return await session.defaultSession.cookies.get({ url });
    } catch (error) {
      return [];
    }
  }
}
