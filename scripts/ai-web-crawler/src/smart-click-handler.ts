/**
 * Smart Click Handler
 * Multi-layer locator strategies with scoring and disambiguation
 */

import { Page, ElementHandle, CDPSession } from 'playwright-core';
import { ClickResult, ElementScore, InputResult } from './types';
import { HumanMouse } from './human-mouse';

/**
 * Info about a cross-origin iframe accessible via CDP Runtime.evaluate.
 * Set by CrawlerOrchestrator when detectCrossOriginIframe() succeeds.
 */
export interface CrossOriginIframeInfo {
  iframeSrc: string;
  cdpSession: CDPSession;
  contextId: number;
  iframeBounds: { x: number; y: number; w: number; h: number };
}

export class SmartClickHandler {
  private page: Page;
  private maxAttempts: number = 5;
  private humanMouse: HumanMouse = new HumanMouse();
  private crossOriginIframe: CrossOriginIframeInfo | null = null;
  private backgroundMode: boolean = true;

  constructor(page: Page, backgroundMode: boolean = true) {
    this.page = page;
    this.backgroundMode = backgroundMode;
  }

  /**
   * 智能点击：
   * - 后台模式：element.click({ force: true }) — 跳过可见性检查，直接在元素上派发事件
   * - 前台模式：humanMouse.click() — 完全模拟真实鼠标轨迹
   */
  private async smartClick(x: number, y: number, box?: { x: number; y: number; width: number; height: number }): Promise<void> {
    if (this.backgroundMode) {
      // 后台模式：CDP dispatchMouseEvent 在 y:-9999 的 BrowserView 中 hit-testing 会失败
      // 但 element.click({ force: true }) 不依赖 hit-testing，直接在元素上派发事件
      // 这里只做 CDP click 作为基础，实际的 element.click 在 clickByText 的调用处处理
      await this.cdpClick(x, y);
    } else {
      // 前台模式：完全模拟真实鼠标
      await this.humanMouse.click(this.page, box || { x, y, width: 1, height: 1 });
    }
  }

  /**
   * 通过 CDP 派发真实鼠标点击事件（isTrusted=true）
   */
  private async cdpClick(x: number, y: number): Promise<void> {
    const cdp = await this.page.context().newCDPSession(this.page);
    try {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    } finally {
      await cdp.detach().catch(() => {});
    }
  }

  /**
   * Set cross-origin iframe info (called by orchestrator after detection)
   */
  setCrossOriginIframe(info: CrossOriginIframeInfo | null): void {
    this.crossOriginIframe = info;
  }

  /**
   * Extract navigation elements from a cross-origin iframe via CDP Runtime.evaluate
   */
  private async extractFromCrossOriginIframeCDP(): Promise<Array<{
    selector: string; text: string; position: string; type: string;
    ariaLabel?: string; semantic?: string;
  }>> {
    if (!this.crossOriginIframe) return [];

    const { cdpSession, contextId, iframeBounds } = this.crossOriginIframe;

    try {
      const result: any = await cdpSession.send('Runtime.evaluate', {
        contextId,
        expression: `
          (function() {
            const out = [];
            const vw = window.innerWidth;
            const vh = window.innerHeight;
            const seen = new Set();

            function pos(rect) {
              const cx = rect.x + rect.width / 2;
              const cy = rect.y + rect.height / 2;
              const h = cx < vw * 0.25 ? '左侧' : cx > vw * 0.75 ? '右侧' : '中部';
              const v = cy < vh * 0.25 ? '顶部' : cy > vh * 0.75 ? '底部' : '中部';
              return v + h;
            }

            // Nav menus
            const navSels = ['nav a','nav li','[class*="sidebar"] a','[class*="menu"] a','[class*="menu"] li','[role="menuitem"]','[role="tab"]','aside a','aside li'];
            for (const sel of navSels) {
              for (const el of document.querySelectorAll(sel)) {
                const rect = el.getBoundingClientRect();
                if (rect.width <= 0 || rect.height <= 0) continue;
                const text = (el.innerText || '').replace(/\\s+/g, ' ').trim();
                if (!text || text.length > 50 || text.length < 2) continue;
                if (seen.has(text)) continue;
                seen.add(text);
                out.push({ selector: text, text, position: pos(rect), type: 'content-tab' });
              }
            }

            // Content tabs
            const tabSels = ['[role="tab"]','[class*="tab"] a','[class*="tab"] span','[class*="tab"] div','[class*="tab"] button'];
            for (const sel of tabSels) {
              for (const el of document.querySelectorAll(sel)) {
                const rect = el.getBoundingClientRect();
                if (rect.width <= 0 || rect.height <= 0) continue;
                const text = (el.innerText || '').replace(/\\s+/g, ' ').trim();
                if (!text || text.length > 40 || text.length < 2) continue;
                if (seen.has(text)) continue;
                seen.add(text);
                out.push({ selector: text, text, position: pos(rect), type: 'content-tab' });
              }
            }

            return JSON.stringify(out);
          })()
        `,
        returnByValue: true,
      });

      if (result.result?.value) {
        const elements = JSON.parse(result.result.value);
        console.error(`[dom-hints-cdp] Extracted ${elements.length} elements from cross-origin iframe via CDP`);
        return elements;
      }
    } catch (e) {
      console.error(`[dom-hints-cdp] Failed to extract from cross-origin iframe:`, e);
    }

    return [];
  }

  /**
   * Click an element inside the cross-origin iframe by text.
   * Uses CDP Runtime.evaluate to find the element's coordinates within the iframe,
   * then adds the iframe's offset to get absolute viewport coordinates,
   * and clicks using humanMouse.
   */
  async clickInCrossOriginIframe(text: string): Promise<ClickResult> {
    if (!this.crossOriginIframe) {
      return { success: false, urlChanged: false, elementFound: false, strategy: 'cdp-iframe', attempts: 0 };
    }

    const { cdpSession, contextId, iframeBounds } = this.crossOriginIframe;
    const urlBefore = this.page.url();

    try {
      const result: any = await cdpSession.send('Runtime.evaluate', {
        contextId,
        expression: `
          (function() {
            const searchText = ${JSON.stringify(text)}.replace(/\\s+/g, ' ').trim().toLowerCase();
            const allEls = document.querySelectorAll('a, button, span, div, li, td, th, [role="tab"], [role="menuitem"], [role="button"]');
            for (const el of allEls) {
              const elText = (el.innerText || '').replace(/\\s+/g, ' ').trim().toLowerCase();
              if (elText === searchText || elText.includes(searchText)) {
                const rect = el.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                  return JSON.stringify({
                    x: rect.x + rect.width / 2,
                    y: rect.y + rect.height / 2,
                    w: rect.width,
                    h: rect.height,
                    tag: el.tagName.toLowerCase(),
                    text: (el.innerText || '').substring(0, 50)
                  });
                }
              }
            }
            return 'null';
          })()
        `,
        returnByValue: true,
      });

      if (!result.result?.value || result.result.value === 'null') {
        console.error(`[click-cdp-iframe] Element "${text}" not found in cross-origin iframe`);
        return { success: false, urlChanged: false, elementFound: false, strategy: 'cdp-iframe', attempts: 1 };
      }

      const coords = JSON.parse(result.result.value);
      // Convert iframe-relative coords to absolute viewport coords
      const absX = iframeBounds.x + coords.x;
      const absY = iframeBounds.y + coords.y;

      console.error(`[click-cdp-iframe] Found "${text}" at iframe-relative (${Math.round(coords.x)}, ${Math.round(coords.y)}) → absolute (${Math.round(absX)}, ${Math.round(absY)})`);

      await this.smartClick(absX, absY);
      await this.page.waitForTimeout(300);

      const urlAfter = this.page.url();
      console.error(`[click-cdp-iframe] ✅ Click success in cross-origin iframe: "${text}"`);

      return {
        success: true,
        urlChanged: urlAfter !== urlBefore,
        elementFound: true,
        strategy: 'cdp-iframe',
        attempts: 1,
      };
    } catch (e) {
      console.error(`[click-cdp-iframe] Failed:`, e);
      return { success: false, urlChanged: false, elementFound: false, strategy: 'cdp-iframe', attempts: 1 };
    }
  }

  /**
   * Recursively collect all frames (including nested child frames)
   * page.frames() only returns top-level frames, missing nested iframes
   *
   * 🔥 Enhanced to properly traverse deeply nested iframes
   */
  private getAllFrames(): any[] {
    const allFrames: any[] = [];
    const visited = new Set<string>();

    const collectFrames = (frame: any) => {
      try {
        const frameUrl = frame.url();
        if (visited.has(frameUrl)) return;
        visited.add(frameUrl);
        allFrames.push(frame);

        console.error(`[frame-debug] Collected frame: ${frameUrl.substring(0, 80)}`);

        try {
          const children = frame.childFrames();
          for (const child of children) {
            collectFrames(child);
          }
        } catch (e) {
          console.error(`[frame-debug] Failed to get childFrames():`, e);
        }
      } catch (e) {
        console.error(`[frame-debug] Failed to process frame:`, e);
      }
    };

    const topFrames = this.page.frames();
    for (const frame of topFrames) {
      collectFrames(frame);
    }

    console.error(`[frame-debug] Frames: ${allFrames.length}`);
    return allFrames;
  }

  /**
   * Collect FrameLocator wrappers for every <iframe> found in the DOM of each
   * known frame, even when Playwright hasn't registered them as child frames
   * (common with cross-origin iframes in CDP-connected Electron apps).
   *
   * Returns objects with { locator, srcHint } so callers can evaluate JS inside
   * the iframe via locator.evaluate() / locator.locator(...).
   */
  private async getAllFrameLocators(): Promise<Array<{ locator: any; srcHint: string }>> {
    const result: Array<{ locator: any; srcHint: string }> = [];

    for (const frame of this.page.frames()) {
      try {
        // Find all <iframe> elements in this frame's DOM
        const iframeSrcs: string[] = await frame.evaluate(() => {
          return Array.from(document.querySelectorAll('iframe'))
            .map(f => f.src || f.getAttribute('src') || '')
            .filter(s => s.length > 0);
        });

        for (const src of iframeSrcs) {
          try {
            // Use frameLocator with a src-based selector — works even when
            // Playwright hasn't registered the frame in its internal tree
            const locator = frame.frameLocator(`iframe[src*="${new URL(src).pathname.split('/').slice(0, 4).join('/')}"]`);
            result.push({ locator, srcHint: src });
            console.error(`[frame-locator] Found iframe via DOM: ${src.substring(0, 80)}`);
          } catch (_) {
            // URL parse failed — fall back to full src match
            const locator = frame.frameLocator(`iframe[src="${src}"]`);
            result.push({ locator, srcHint: src });
          }
        }
      } catch (_) {}
    }

    return result;
  }

  /**
   * Extract clickable navigation elements (sidebar menu items, icons, etc.)
   * Used to provide DOM hints to vision navigator for better decision making
   * 
   * Enhanced to extract right-side floating icons (IM/chat buttons) that are often missed
   */
  async extractNavigationElements(): Promise<Array<{
    selector: string;
    text: string;
    position: string;
    type: string;
    ariaLabel?: string;
    semantic?: string;
  }>> {
    const allElements: Array<{
      selector: string;
      text: string;
      position: string;
      type: string;
      ariaLabel?: string;
      semantic?: string;
    }> = [];

    // 🔥 Log all frames for debugging (including nested child frames)
    const allFrames = this.getAllFrames();
    // console.error(`[dom-hints] getAllFrames() count=${allFrames.length}`);
    // allFrames.forEach((f, i) => {
    //   const url = f.url();
    //   console.error(`[dom-hints] frame[${i}] url="${url.substring(0, 100)}"`);
    // });

    // 🔥 Iterate through all frames (including nested child frames)
    for (let frameIndex = 0; frameIndex < allFrames.length; frameIndex++) {
      const frame = allFrames[frameIndex];
      const frameUrl = frame.url();

      try {
        // console.error(`[dom-hints] Extracting from frame[${frameIndex}]: ${frameUrl.substring(0, 80)}`);

        const result = await frame.evaluate(() => {
          const results: Array<{
            selector: string;
            text: string;
            position: string;
            type: string;
            ariaLabel?: string;
            semantic?: string;
          }> = [];
          const debugLogs: string[] = [];

          const vw = window.innerWidth;
          const vh = window.innerHeight;
          const RIGHT_THRESHOLD = vw * 0.6;

          function descPosition(rect: DOMRect): string {
            const cx = rect.x + rect.width / 2;
            const cy = rect.y + rect.height / 2;
            const h = cx < vw * 0.25 ? '左侧' : cx > vw * 0.75 ? '右侧' : '中部';
            const v = cy < vh * 0.25 ? '顶部' : cy > vh * 0.75 ? '底部' : '中部';
            return v + h;
          }

          const seen = new Set<string>();

          // Strategy 1: Extract sidebar navigation menu items (left side)
          const navSelectors = [
            'nav a', 'nav li', 'nav button',
            '[class*="sidebar"] a', '[class*="sidebar"] li',
            '[class*="menu"] a', '[class*="menu"] li',
            '[class*="nav"] a', '[class*="nav"] li',
            '[role="navigation"] a', '[role="navigation"] li',
            '[role="menuitem"]', '[role="tab"]',
            'aside a', 'aside li', 'aside button',
            '.sidebar a', '.sidebar li',
            '.menu a', '.menu li',
            '.nav a', '.nav li'
          ];

          for (const selector of navSelectors) {
            const elements = document.querySelectorAll(selector);
            for (const el of elements) {
              const rect = el.getBoundingClientRect();
              if (rect.width <= 0 || rect.height <= 0) continue;

              // Focus on left sidebar (x < 30% of viewport width)
              const cx = rect.x + rect.width / 2;
              if (cx > vw * 0.3) continue;

              const rawText = (el as HTMLElement).innerText?.trim() || '';
              // Normalize whitespace (collapse newlines/spaces) so "数据中心\nNEW" → "数据中心 NEW"
              const text = rawText.replace(/\s+/g, ' ').trim();
              if (!text || text.length > 50 || text.length < 2) continue;

              const ariaLabel = el.getAttribute('aria-label') || undefined;
              const key = text + (ariaLabel || '');
              if (seen.has(key)) continue;
              seen.add(key);

              let uniqueSelector = text;
              if (ariaLabel) uniqueSelector = ariaLabel;

              results.push({
                selector: uniqueSelector,
                text,
                position: descPosition(rect),
                type: 'nav-menu',
                ariaLabel
              });
            }
          }

          // Strategy 3: Extract content-area tabs and sub-navigation (middle area)
          // Targets tab bars, pill nav, and secondary nav links in the main content zone
          const tabSelectors = [
            '[role="tab"]', '[role="tablist"] *',
            'div[class*="tab"]', 'span[class*="tab"]',
            '[class*="tab"] a', '[class*="tab"] li', '[class*="tab"] span',
            '[class*="tab"] button', '[class*="tab"] div',
            '[class*="pill"] a', '[class*="pill"] li',
            '[class*="segment"] a', '[class*="segment"] li',
            '[class*="sub-nav"] a', '[class*="subnav"] a',
            '[class*="secondary"] a', '[class*="secondary"] li',
          ];

          let tabCandidatesTotal = 0;
          let tabFilteredOut = 0;
          for (const selector of tabSelectors) {
            const elements = document.querySelectorAll(selector);
            for (const el of elements) {
              const rect = el.getBoundingClientRect();
              if (rect.width <= 0 || rect.height <= 0) continue;

              const rawTextCheck = (el as HTMLElement).innerText?.trim() || '';
              const textCheck = rawTextCheck.replace(/\s+/g, ' ').trim();
              if (!textCheck || textCheck.length > 30 || textCheck.length < 2) continue;

              tabCandidatesTotal++;

              // Only middle content area (x between 20% and 85% of viewport)
              const cx = rect.x + rect.width / 2;
              if (cx < vw * 0.2 || cx > vw * 0.85) {
                tabFilteredOut++;
                continue;
              }

              // Only near the top of the content area (y < 60% of viewport)
              const cy = rect.y + rect.height / 2;
              if (cy > vh * 0.6) {
                tabFilteredOut++;
                continue;
              }

              const rawText = (el as HTMLElement).innerText?.trim() || '';
              const text = rawText.replace(/\s+/g, ' ').trim();
              if (!text || text.length > 30 || text.length < 2) continue;

              // Skip elements that are just containers (have many children with text)
              const directTextLength = Array.from(el.childNodes)
                .filter(n => n.nodeType === Node.TEXT_NODE)
                .map(n => (n.textContent || '').trim())
                .join('').length;
              const hasDirectText = directTextLength > 0 || el.children.length <= 2;
              if (!hasDirectText) continue;

              const ariaLabel = el.getAttribute('aria-label') || undefined;
              const key = 'tab:' + text + (ariaLabel || '');
              if (seen.has(key)) continue;
              seen.add(key);

              results.push({
                selector: text,
                text,
                position: descPosition(rect),
                type: 'content-tab',
                ariaLabel
              });
            }
          }

          debugLogs.push(`[tab-debug] Total tab candidates: ${tabCandidatesTotal}, filtered out: ${tabFilteredOut}, kept: ${results.filter(r => r.type === 'content-tab').length}`);

          // Strategy 2: Extract right-side floating icons (IM/chat buttons)
          // This mirrors the Python reference project's extract_clickable_icons() method
          const candidates = new Set<Element>();

          debugLogs.push(`[icon-debug] Starting icon extraction, RIGHT_THRESHOLD=${RIGHT_THRESHOLD}, vw=${vw}`);

          // 2.1: position:fixed containers on the right side
          const allEls = document.querySelectorAll('*');
          
          let fixedCount = 0;
          for (const el of allEls) {
            const style = window.getComputedStyle(el);
            if (style.position !== 'fixed') continue;
            fixedCount++;
            
            const rect = el.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) continue;
            
            const cx = rect.x + rect.width / 2;
            if (cx < RIGHT_THRESHOLD) continue;
            
            // Container itself is a small icon
            if (rect.width <= 80 && rect.height <= 80) {
              candidates.add(el);
            }
            
            // Check children for small icons
            const children = el.querySelectorAll('*');
            for (const child of children) {
              const cr = child.getBoundingClientRect();
              if (cr.width > 0 && cr.height > 0 && cr.width <= 80 && cr.height <= 80) {
                const ccx = cr.x + cr.width / 2;
                if (ccx >= RIGHT_THRESHOLD) {
                  candidates.add(child);
                }
              }
            }
          }
          debugLogs.push(`[icon-debug] Fixed elements found: ${fixedCount}, candidates from fixed: ${candidates.size}`);

          // 2.2: Right-side elements with aria-label (e.g., Ctrip IM)
          for (const el of document.querySelectorAll('[aria-label]')) {
            const rect = el.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0 || rect.width > 80 || rect.height > 80) continue;
            const cx = rect.x + rect.width / 2;
            if (cx >= RIGHT_THRESHOLD) {
              candidates.add(el);
            }
          }

          // 2.3: Right-side SVG use icons (e.g., Meituan #icon-meguke)
          for (const use of document.querySelectorAll('svg use')) {
            const href = use.getAttribute('xlink:href') || use.getAttribute('href') || '';
            if (!href) continue;
            
            let parent: Element | null = use.closest('[class*="icon"], [class*="wrapper"], [role="button"]') || use.parentElement;
            for (let i = 0; i < 6 && parent; i++) {
              const rect = parent.getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0 && rect.width <= 80 && rect.height <= 80) {
                const cx = rect.x + rect.width / 2;
                if (cx >= RIGHT_THRESHOLD) {
                  (parent as any)._svgHref = href;
                  candidates.add(parent);
                }
                break;
              }
              parent = parent.parentElement;
            }
          }

          // Extract information from candidates
          for (const el of candidates) {
            const rect = el.getBoundingClientRect();
            // Skip elements outside viewport
            if (rect.right < 0 || rect.bottom < 0 || rect.left > vw || rect.top > vh) continue;
            
            const text = (el as HTMLElement).innerText?.trim() || '';
            
            // Skip elements with too much text (likely not icons)
            if (text.length > 4) {
              continue;
            }

            const ariaLabel = el.getAttribute('aria-label') || '';
            const cls = (el as HTMLElement).className || '';
            const clsStr = typeof cls === 'string' ? cls : String(cls);
            const useEl = el.querySelector('svg use');
            const svgHref = (el as any)._svgHref || (useEl ? (useEl.getAttribute('xlink:href') || useEl.getAttribute('href') || '') : '');

            let selector = '';
            let desc = '';
            
            if (ariaLabel) {
              selector = ariaLabel;
              desc = `aria-label="${ariaLabel}"`;
            } else if (svgHref) {
              selector = svgHref.replace('#', '');
              desc = `svg-icon="${svgHref}"`;
            } else if (clsStr && !clsStr.includes('[object')) {  // Filter out SVGAnimatedString
              const classes = clsStr.split(/\s+/).filter(c => c.length >= 2 && !c.startsWith('data-v-'));  // 放宽：>= 2
              const iconClass = classes.find(c => c.includes('icon') || c.includes('portal')) || classes[0];
              if (iconClass) {
                selector = iconClass;
                desc = `class="${iconClass}"`;
              }
            }
            
            // Fallback: use position if no selector found
            if (!selector) {
              const position = descPosition(rect).replace(/\s+/g, '-');
              selector = `icon-${position}`;
              desc = `position-fallback`;
            }

            // Debug: log when selector is found (skip position-fallback duplicates to reduce noise)
            if (desc !== 'position-fallback') {
              debugLogs.push(`[icon-debug] Selector: "${selector}" from ${desc}`);
            }

            // Semantic analysis removed - IM/chat/review icons no longer needed for navigation
            const sLower = selector.toLowerCase();
            let semantic = '';
            // IM/chat/customer service semantic tags removed
            // if (sLower.includes('comment') || sLower.includes('chat') || sLower.includes('message') ||
            //     sLower.includes('im-') || sLower.includes('guke') || sLower.includes('kefu') ||
            //     sLower.includes('consult')) {
            //   semantic = '★IM/聊天/客服入口（优先点击）';
            // }
            if (sLower.includes('phone') || sLower.includes('tel') || sLower.includes('call') || sLower.includes('dial')) {
              semantic = '电话（非IM）';
            } else if (sLower.includes('bell') || sLower.includes('notif') || sLower.includes('alert')) {
              semantic = '通知';
            }

            if (seen.has(selector)) continue;
            seen.add(selector);

            results.push({
              selector,
              text: text || '(图标)',
              position: descPosition(rect),
              type: 'floating-icon',
              ariaLabel: ariaLabel || undefined,
              semantic: semantic || undefined
            });
          }

          return { results, debugLogs };
        });

        const { results: elements, debugLogs } = result;

        // Output debug logs to Node.js console
        debugLogs.forEach((log: string) => console.error(log));

        if (elements && elements.length > 0) {
          // console.error(`[dom-hints] ✅ Extracted ${elements.length} elements from frame[${frameIndex}]`);
          allElements.push(...elements);
        } else {
          // console.error(`[dom-hints] ⚠️ No elements found in frame[${frameIndex}]`);
        }
      } catch (error) {
        console.error(`[dom-hints] ❌ Failed to extract from frame[${frameIndex}] (${frameUrl.substring(0, 50)}):`, error);
        continue;
      }
    }

    // Also extract from cross-origin iframes not registered in Playwright's frame tree
    const iframeExtras = await this.extractFromUnregisteredIframes();
    if (iframeExtras.length > 0) {
      // console.error(`[dom-hints] Adding ${iframeExtras.length} elements from unregistered iframes`);
      allElements.push(...iframeExtras);
    }

    // Extract from cross-origin iframe via CDP (if detected)
    const cdpIframeExtras = await this.extractFromCrossOriginIframeCDP();
    if (cdpIframeExtras.length > 0) {
      // console.error(`[dom-hints] Adding ${cdpIframeExtras.length} elements from cross-origin iframe via CDP`);
      allElements.push(...cdpIframeExtras);
    }

    // console.error(`[dom-hints] 📊 Total elements before deduplication: ${allElements.length}`);

    // Deduplicate across frames and filter out position fallback selectors
    const seen = new Set<string>();
    const uniqueElements = allElements.filter(el => {
      // Filter out position fallback selectors (they are invalid and confuse the LLM)
      if (el.type === 'floating-icon' && el.selector.startsWith('icon-') && 
          (el.selector.includes('左侧') || el.selector.includes('右侧') || 
           el.selector.includes('顶部') || el.selector.includes('底部') || 
           el.selector.includes('中部'))) {
        return false;
      }
      
      if (seen.has(el.selector)) return false;
      seen.add(el.selector);
      return true;
    });

    // console.error(`[dom-hints] 📊 After deduplication: ${uniqueElements.length} unique elements from ${allFrames.length} frames`);
    // uniqueElements.forEach((el, idx) => {
    //   const semanticTag = el.semantic ? ` ${el.semantic}` : '';
    //   if (el.type === 'floating-icon') {
    //     console.error(`[dom-hints] [${idx}] [${el.position}] selector="${el.selector}" (${el.type})${semanticTag}`);
    //   } else {
    //     console.error(`[dom-hints] [${idx}] [${el.position}] "${el.text}" (${el.type})${semanticTag}`);
    //   }
    // });

    return uniqueElements;
  }

  /**
   * Extract navigation elements from iframes that Playwright hasn't registered
   * as child frames (cross-origin iframes in CDP-connected Electron apps).
   * Uses FrameLocator to reach into the iframe DOM.
   */
  private async extractFromUnregisteredIframes(): Promise<Array<{
    selector: string; text: string; position: string; type: string;
    ariaLabel?: string; semantic?: string;
  }>> {
    const results: Array<{ selector: string; text: string; position: string; type: string; ariaLabel?: string; semantic?: string }> = [];
    const frameLocators = await this.getAllFrameLocators();
    if (frameLocators.length === 0) return results;

    for (const { locator: fl, srcHint } of frameLocators) {
      console.error(`[dom-hints-iframe] Extracting from unregistered iframe: ${srcHint.substring(0, 80)}`);
      try {
        const extracted = await fl.locator('body').evaluate((body: HTMLElement) => {
          const out: Array<{ selector: string; text: string; position: string; type: string }> = [];
          const vw = window.innerWidth;
          const vh = window.innerHeight;
          const seen = new Set<string>();

          function pos(rect: DOMRect) {
            const cx = rect.x + rect.width / 2;
            const cy = rect.y + rect.height / 2;
            const h = cx < vw * 0.25 ? '左侧' : cx > vw * 0.75 ? '右侧' : '中部';
            const v = cy < vh * 0.25 ? '顶部' : cy > vh * 0.75 ? '底部' : '中部';
            return v + h;
          }

          const tabSels = ['[role="tab"]', '[class*="tab"]', '[class*="nav"] a', '[class*="menu"] a'];
          for (const sel of tabSels) {
            for (const el of body.querySelectorAll(sel)) {
              const rect = (el as HTMLElement).getBoundingClientRect();
              if (rect.width <= 0 || rect.height <= 0) continue;
              const text = ((el as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim();
              if (!text || text.length > 40 || text.length < 2) continue;
              if (seen.has(text)) continue;
              seen.add(text);
              out.push({ selector: text, text, position: pos(rect), type: 'content-tab' });
            }
          }
          return out;
        });
        console.error(`[dom-hints-iframe] Extracted ${extracted.length} elements from unregistered iframe`);
        results.push(...extracted);
      } catch (e) {
        console.error(`[dom-hints-iframe] Failed:`, e);
      }
    }
    return results;
  }

  /**
   * Click element by text with disambiguation
   * 🔥 Enhanced to search in all nested iframes
   */
  async clickByText(text: string): Promise<ClickResult> {
    // Normalize whitespace in text (e.g. "数据中心\nNEW" → "数据中心 NEW")
    text = text.replace(/\s+/g, ' ').trim();
    const urlBefore = this.page.url();
    let attempts = 0;
    let elementFound = false;
    let strategy = '';

    // 🔥 Try in all frames (including nested child frames)
    const framesToTry = this.getAllFrames();
    console.error(`[click] Searching for "${text}" in ${framesToTry.length} frames`);

    for (let frameIndex = 0; frameIndex < framesToTry.length; frameIndex++) {
      const frame = framesToTry[frameIndex];
      const frameUrl = frame.url();
      console.error(`[click] Trying frame[${frameIndex}]: ${frameUrl.substring(0, 60)}`);

      const strategies = [
        () => this.tryPlaywrightLocators(text, frame),
        () => this.tryXPathLocators(text, frame),
        () => this.tryJavaScriptSearch(text, frame),
      ];

      for (const strategyFn of strategies) {
        try {
          const elements = await strategyFn();
          if (elements && elements.length > 0) {
            elementFound = true;
            strategy = strategyFn.name + `@frame[${frameUrl.substring(0, 50)}]`;
            console.error(`[click] Found ${elements.length} candidates in frame[${frameIndex}] using ${strategyFn.name}`);

            const scored = await this.scoreElements(elements, text);

            for (const { element } of scored) {
              attempts++;
              if (attempts > this.maxAttempts) break;

              try {
                if (this.backgroundMode) {
                  // 后台模式：直接用 Playwright element.click({ force: true })
                  // 跳过可见性检查，不做鼠标移动，不会卡死，且 isTrusted=true
                  await element.click({ timeout: 5000, force: true });
                } else {
                  // 前台模式：先确保元素在视口内，再用 humanMouse 模拟真实鼠标
                  await element.evaluate((el: any) => {
                    if (el.scrollIntoViewIfNeeded) el.scrollIntoViewIfNeeded(true);
                    else el.scrollIntoView({ block: 'center', inline: 'center' });
                  }).catch(() => {});
                  await new Promise(r => setTimeout(r, 100));
                  const box = await element.boundingBox();
                  if (box) {
                    await this.humanMouse.click(this.page, box);
                  } else {
                    await element.click({ timeout: 5000, force: true });
                  }
                }
                await this.page.waitForTimeout(300);

                // Success = element was found and clicked, regardless of URL change
                // (SPA navigation may not change the URL)
                const urlAfter = this.page.url();
                console.error(`[click] Success: "${text}" (${strategy}, attempts=${attempts})`);
                return {
                  success: true,
                  urlChanged: urlAfter !== urlBefore,
                  elementFound: true,
                  strategy,
                  attempts,
                };
              } catch (error) {
                console.error(`[click] Attempt ${attempts} failed for "${text}":`, error);
                
                // If click failed due to interception, try coordinate click at center
                if (error instanceof Error && error.message.includes('intercepts pointer events')) {
                  try {
                    console.error(`[click] Element intercepted, trying coordinate click...`);
                    const box2 = await element.boundingBox();
                    if (box2) {
                      await this.smartClick(box2.x + box2.width / 2, box2.y + box2.height / 2, box2);
                    } else {
                      await element.evaluate((el: any) => el.click());
                    }
                    await this.page.waitForTimeout(300);
                    
                    const urlAfter = this.page.url();
                    console.error(`[click] Success via JS click: "${text}" (${strategy}, attempts=${attempts})`);
                    return {
                      success: true,
                      urlChanged: urlAfter !== urlBefore,
                      elementFound: true,
                      strategy: strategy + '+js-click',
                      attempts,
                    };
                  } catch (jsError) {
                    console.error(`[click] JavaScript click also failed:`, jsError);
                  }
                }
                
                continue;
              }
            }
          }
        } catch (error) {
          continue;
        }
      }

      // If found elements in this frame but all clicks failed, try next frame
      if (elementFound) {
        console.error(`[click] Found elements in frame but all clicks failed, trying next frame`);
      }
    }

    // Fallback: search inside iframes that Playwright hasn't registered as child frames
    // (cross-origin iframes in CDP-connected Electron apps often don't appear in page.frames())
    const frameLocators = await this.getAllFrameLocators();
    if (frameLocators.length > 0) {
      console.error(`[click] Trying ${frameLocators.length} DOM-discovered iframe(s) via FrameLocator`);
      for (const { locator: fl, srcHint } of frameLocators) {
        console.error(`[click] FrameLocator search in: ${srcHint.substring(0, 80)}`);
        try {
          // getByText is the most reliable way to find text inside a FrameLocator
          const el = fl.getByText(text, { exact: false });
          const count = await el.count();
          console.error(`[click] FrameLocator getByText("${text}") count=${count}`);
          if (count > 0) {
            await el.first().click({ timeout: 5000 });
            await this.page.waitForTimeout(800);
            const urlAfter = this.page.url();
            console.error(`[click] FrameLocator click success: "${text}"`);
            return {
              success: true,
              urlChanged: urlAfter !== urlBefore,
              elementFound: true,
              strategy: `frame-locator@${srcHint.substring(0, 50)}`,
              attempts: attempts + 1,
            };
          }
        } catch (e) {
          console.error(`[click] FrameLocator attempt failed:`, e);
        }
      }
    }

    // Fallback: try clicking inside cross-origin iframe via CDP Runtime.evaluate
    if (this.crossOriginIframe) {
      console.error(`[click] Trying cross-origin iframe via CDP for "${text}"`);
      const cdpResult = await this.clickInCrossOriginIframe(text);
      if (cdpResult.success) return cdpResult;
    }

    // Last resort: try with stripped parenthetical (avoid infinite recursion)
    if (text.includes('(')) {
      const strippedText = this.stripParenthetical(text);
      if (strippedText !== text && strippedText.length > 0) {
        console.error(`[click] Retrying with stripped text: "${strippedText}"`);
        return await this.clickByText(strippedText);
      }
    }

    console.error(`[click] Failed: "${text}" (elementFound=${elementFound}, strategy=${strategy})`);
    return {
      success: false,
      urlChanged: false,
      elementFound,
      strategy,
      attempts,
    };
  }

  /**
   * Click at absolute viewport coordinates (x, y).
   * Used as the last-resort fallback when DOM-based click fails —
   * coordinates are obtained from Gemini's visual analysis of a viewport screenshot.
   */
  async clickByCoordinate(x: number, y: number): Promise<ClickResult> {
    const urlBefore = this.page.url();
    console.error(`[click-coord] Clicking at viewport coordinate (${x}, ${y})`);
    try {
      await this.smartClick(x, y);
      await this.page.waitForTimeout(300);
      const urlAfter = this.page.url();
      console.error(`[click-coord] Success at (${x}, ${y})`);
      return {
        success: true,
        urlChanged: urlAfter !== urlBefore,
        elementFound: true,
        strategy: 'coordinate-fallback',
        attempts: 1,
      };
    } catch (error) {
      console.error(`[click-coord] Failed at (${x}, ${y}):`, error);
      return {
        success: false,
        urlChanged: false,
        elementFound: false,
        strategy: 'coordinate-fallback',
        attempts: 1,
      };
    }
  }

  /**
   * Click element by selector (for icon elements)
   * Matches Python project's click_by_selector method
   */
  async clickBySelector(selector: string): Promise<ClickResult> {
    const urlBefore = this.page.url();
    
    console.error(`[click-selector] Attempting to click selector: "${selector}"`);
    
    for (const frame of this.getAllFrames()) {
      try {
        const coords = await frame.evaluate((text: string) => {
          let matchedBy = '';
          
          function findElement() {
            let el: Element | null = null;
            
            // Strategy 1: aria-label exact match
            el = document.querySelector(`[aria-label="${text}"]`);
            if (el) { matchedBy = 'aria-label-exact'; return el; }
            
            // Strategy 2: aria-label contains match (case-insensitive)
            const lower = text.toLowerCase();
            for (const e of document.querySelectorAll('[aria-label]')) {
              const ariaLabel = e.getAttribute('aria-label');
              if (ariaLabel && ariaLabel.toLowerCase().includes(lower)) {
                matchedBy = 'aria-label-contains';
                return e;
              }
            }
            
            // Strategy 3: title exact match
            el = document.querySelector(`[title="${text}"]`);
            if (el) { matchedBy = 'title-exact'; return el; }
            
            // Strategy 4: title contains match
            for (const e of document.querySelectorAll('[title]')) {
              const title = e.getAttribute('title');
              if (title && title.toLowerCase().includes(lower)) {
                matchedBy = 'title-contains';
                return e;
              }
            }
            
            // Strategy 5: class name exact match
            try {
              el = document.querySelector(`.${CSS.escape(text)}`);
              if (el) { matchedBy = 'class-exact'; return el; }
            } catch (e) {}
            
            // Strategy 6: class contains match
            for (const e of document.querySelectorAll('*')) {
              const cls = (e as HTMLElement).className;
              const clsStr = typeof cls === 'string' ? cls : String(cls);
              if (clsStr.includes(text)) {
                const rect = e.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                  matchedBy = 'class-contains';
                  return e;
                }
              }
            }
            
            // Strategy 7: SVG use href match (e.g., #icon-meguke)
            const hrefSelector = text.startsWith('#') ? text : '#' + text;
            for (const use of document.querySelectorAll('svg use')) {
              const href = use.getAttribute('xlink:href') || use.getAttribute('href') || '';
              if (href === hrefSelector || href === text || href === '#' + text) {
                let parent: Element | null = use.closest('[role="button"], a, button, [class*="icon"], [class*="portal"], [class*="wrapper"]');
                if (!parent) parent = use.parentElement;
                for (let i = 0; i < 8 && parent; i++) {
                  const rect = parent.getBoundingClientRect();
                  if (rect.width > 0 && rect.height > 0) {
                    matchedBy = 'svg-use-href';
                    return parent;
                  }
                  parent = parent.parentElement;
                }
              }
            }
            
            // Strategy 8: data-icon attribute
            el = document.querySelector(`[data-icon="${text}"], svg[data-icon="${text}"]`);
            if (el) {
              let parent: Element | null = el.closest('[role="button"], a, button, [class*="icon"]');
              if (!parent) parent = el.parentElement;
              for (let i = 0; i < 8 && parent; i++) {
                const rect = parent.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                  matchedBy = 'data-icon';
                  return parent;
                }
                parent = parent.parentElement;
              }
            }
            
            return null;
          }
          
          let el = findElement();
          if (!el) return null;
          
          // Ensure element is visible, otherwise find parent
          let rect = el.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) {
            let parent = el.parentElement;
            for (let i = 0; i < 5 && parent; i++) {
              rect = parent.getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0) {
                el = parent;
                break;
              }
              parent = parent.parentElement;
            }
          }
          
          rect = el.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return null;
          
          return {
            x: rect.x + rect.width / 2,
            y: rect.y + rect.height / 2,
            tag: el.tagName.toLowerCase(),
            cls: ((el as HTMLElement).className || '').toString().substring(0, 80),
            aria: el.getAttribute('aria-label') || '',
            matchedBy: matchedBy
          };
        }, selector);
        
        if (!coords) continue;
        
        console.error(`[click-selector] Found element (strategy:${coords.matchedBy}): <${coords.tag}> class='${coords.cls}' aria='${coords.aria}' coords=(${Math.round(coords.x)}, ${Math.round(coords.y)})`);
        
        // Calculate absolute coordinates (handle iframe offset)
        let absX = coords.x;
        let absY = coords.y;
        
        if (frame !== this.page.mainFrame()) {
          try {
            const frameElement = await frame.frameElement();
            const frameBox = await frameElement?.boundingBox();
            if (frameBox) {
              absX = frameBox.x + coords.x;
              absY = frameBox.y + coords.y;
            }
          } catch (e) {
            // Frame element not accessible, use relative coords
          }
        }
        
        // 用 smartClick 派发点击事件
        await this.smartClick(absX, absY);
        await this.page.waitForTimeout(300);
        
        const urlAfter = this.page.url();
        console.error(`[click-selector] Success: "${selector}" (${coords.matchedBy}, coords=(${Math.round(absX)}, ${Math.round(absY)}))`);
        
        return {
          success: true,
          urlChanged: urlAfter !== urlBefore,
          elementFound: true,
          strategy: `selector-${coords.matchedBy}@frame`,
          attempts: 1,
        };
        
      } catch (error) {
        console.error(`[click-selector] Frame failed:`, error);
        continue;
      }
    }
    
    console.error(`[click-selector] Failed: selector "${selector}" not found in any frame`);
    return {
      success: false,
      urlChanged: false,
      elementFound: false,
      strategy: 'selector',
      attempts: 1,
    };
  }

  /**
   * Click nth element by text (after scoring and sorting)
   * Used to retry clicking when the first match was wrong
   */
  async clickNthByText(text: string, nth: number): Promise<ClickResult> {
    const urlBefore = this.page.url();
    
    console.error(`[click-nth] Looking for ${nth+1}th match of "${text}"`);

    // Try in all frames (including nested child frames)
    const framesToTry = this.getAllFrames();
    
    for (const frame of framesToTry) {
      try {
        // Use JavaScript to find, score, and click the nth element
        const clicked = await frame.evaluate(([searchText, nthIndex]: [string, number]) => {
          const candidates: Array<{el: Element, score: number}> = [];
          const baseText = searchText.replace(/\s*[\(（]\s*\d+\s*[\)）]\s*$/, '').trim();
          
          const allElements = document.querySelectorAll('*');
          for (const el of allElements) {
            const innerText = (el as HTMLElement).innerText?.trim() || '';
            const textMatch = innerText === searchText || 
                            innerText === baseText ||
                            (innerText.includes(searchText) && innerText.length < searchText.length * 3) ||
                            (baseText !== searchText && innerText.includes(baseText) && innerText.length < baseText.length * 3);
            
            if (!textMatch) continue;
            
            const rect = el.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0 || rect.width > 600) continue;
            
            const tag = el.tagName.toLowerCase();
            const hasHref = !!(el as HTMLAnchorElement).href;
            const cursor = window.getComputedStyle(el).cursor;
            const isClickable = tag === 'a' || tag === 'button' || hasHref || cursor === 'pointer';
            
            let score = 0;
            if (isClickable) score -= 100;
            if (tag === 'a' || tag === 'button') score -= 50;
            if (hasHref) score -= 30;
            if (rect.y < 80) score -= 40;
            if (rect.x < 250) score -= 20;
            score += Math.abs(innerText.length - searchText.length);
            score += (rect.width * rect.height) / 10000;
            
            // Prefer deeper nested elements (sub-menu items)
            let depth = 0;
            let current: Element | null = el;
            while (current && depth < 20) {
              current = current.parentElement;
              depth++;
            }
            if (depth > 10) score -= 5;
            else if (depth > 5) score -= 2;
            
            candidates.push({ el, score });
          }
          
          if (candidates.length <= nthIndex) return false;
          
          // Sort by score (lower is better)
          candidates.sort((a, b) => a.score - b.score);
          
          // Click the nth element
          (candidates[nthIndex].el as HTMLElement).click();
          return true;
        }, [text, nth] as [string, number]);
        
        if (clicked) {
          await this.page.waitForTimeout(1500);
          const urlAfter = this.page.url();
          console.error(`[click-nth] Success: ${nth+1}th match clicked (frame: ${frame.url().substring(0, 50)})`);
          return {
            success: true,
            urlChanged: urlAfter !== urlBefore,
            elementFound: true,
            strategy: `nth-${nth+1}@frame`,
            attempts: 1,
          };
        }
      } catch (error) {
        console.error(`[click-nth] Frame failed:`, error);
        continue;
      }
    }
    
    console.error(`[click-nth] Failed: ${nth+1}th match not found for "${text}"`);
    return { 
      success: false, 
      urlChanged: false, 
      elementFound: false, 
      strategy: `nth-${nth+1}`, 
      attempts: 1 
    };
  }

  /**
   * Find elements by text using multiple strategies
   */
  private async findElementsByText(text: string): Promise<ElementHandle[]> {
    const elements: ElementHandle[] = [];
    for (const frame of this.getAllFrames()) {
      const playwrightElements = await this.tryPlaywrightLocators(text, frame);
      if (playwrightElements) elements.push(...playwrightElements);
      const xpathElements = await this.tryXPathLocators(text, frame);
      if (xpathElements) elements.push(...xpathElements);
      const jsElements = await this.tryJavaScriptSearch(text, frame);
      if (jsElements) elements.push(...jsElements);
    }
    return elements;
  }

  /**
   * Score and rank elements (照抄 Python 版本的负分制评分)
   * 分数越低越好！
   * 
   * 关键改进：先过滤可见性，再评分
   */
  private async scoreElements(elements: ElementHandle[], targetText: string): Promise<ElementScore[]> {
    const scored: ElementScore[] = [];

    for (const element of elements) {
      let score = 0;
      const reasons: string[] = [];

      try {
        // 🔥 关键修复：先检查元素是否可见
        const isVisible = await element.isVisible().catch(() => false);
        if (!isVisible) {
          continue;  // 跳过不可见的元素
        }

        const box = await element.boundingBox();
        if (!box || box.width <= 0 || box.height <= 0) {
          continue;  // 跳过没有尺寸的元素
        }

        const tagName = await element.evaluate((el: any) => el.tagName.toLowerCase());
        
        // 可点击标签：减分（越低越好）
        if (tagName === 'a' || tagName === 'button') {
          score -= 100;
          reasons.push('clickable-tag');
        }

        // 检查元素是否是父菜单（有子菜单）
        const menuInfo = await element.evaluate((el: any) => {
          const classList = Array.from(el.classList || []) as string[];
          
          // 检查是否有子菜单（查找子元素中是否有列表）
          const hasSubmenu = el.querySelector('ul, ol, [role="menu"]') !== null;
          
          // 检查是否是父菜单（通过 class 名称模糊匹配）
          const isParent = classList.some((c) => 
            c.includes('parent') || c.includes('has-child') || c.includes('expandable')
          );
          
          // 检查是否有展开/折叠图标（父菜单的特征）
          const hasExpandIcon = el.querySelector('[class*="arrow"], [class*="direction"], [class*="expand"], [class*="icon-down"], [class*="icon-up"], i[class*="icon"]') !== null;
          
          // 检查最近的 <li> 或 <a> 祖先元素
          let closestInteractive: Element | null = el.closest('li, a, button');
          let interactiveHasChildren = false;
          let interactiveIsLeaf = false;
          
          if (closestInteractive) {
            // 检查这个交互元素是否包含子列表（说明是父菜单）
            interactiveHasChildren = closestInteractive.querySelector('ul, ol') !== null;
            
            // 检查这个交互元素是否是叶子节点（没有子列表，说明是子菜单项）
            interactiveIsLeaf = !interactiveHasChildren;
            
            // 检查是否有 href 属性（叶子节点通常有真实链接）
            if (closestInteractive.tagName.toLowerCase() === 'a') {
              const href = closestInteractive.getAttribute('href');
              if (href && href !== '#' && !href.startsWith('javascript:')) {
                interactiveIsLeaf = true;
              }
            }
          }
          
          // 检查元素的嵌套深度（子菜单项通常嵌套更深）
          let depth = 0;
          let current: Element | null = el;
          let listDepth = 0; // 统计经过了多少个 ul/ol
          
          while (current && depth < 20) {
            if (current.tagName === 'UL' || current.tagName === 'OL') {
              listDepth++;
            }
            current = current.parentElement;
            depth++;
          }
          
          // listDepth > 1 说明在嵌套列表中（子菜单）
          const inNestedList = listDepth > 1;

          // 🔥 Generic submenu toggle detection
          // Universal pattern across UI frameworks (Ant Design, Element UI, Meituan Vina, etc.):
          //   <li class="submenu">
          //     <div class="submenu-title">Title Text</div>   ← toggle trigger
          //     <ul class="submenu-content">
          //       <li><a>Sub Item</a></li>                     ← actual nav target
          //     </ul>
          //   </li>
          // If the element is in the "title" branch (NOT inside the <ul>), clicking it
          // only toggles the menu open/close — it does NOT navigate to a page.
          let isInsideSubmenuToggle = false;
          let toggleWalker: Element | null = el;
          while (toggleWalker && toggleWalker !== document.body) {
            const parent = toggleWalker.parentElement;
            if (!parent) break;

            // Check <li> parents and <div> parents that wrap both a title and a list
            if (parent.tagName === 'LI' || parent.tagName === 'DIV') {
              const children = Array.from(parent.children);
              const listChild = children.find((c: Element) => c.tagName === 'UL' || c.tagName === 'OL');
              if (listChild && !listChild.contains(el)) {
                // The element is NOT inside the child list, but a sibling list exists
                // → This element is in the "toggle/title" area of the submenu
                isInsideSubmenuToggle = true;
                break;
              }
            }

            toggleWalker = parent;
          }

          // Check if element is inside an <a> tag (strong signal for actual navigation item)
          // Menu toggle triggers are typically <div>/<span>, NOT wrapped in <a>
          const closestAnchor = el.closest('a');
          const isInsideAnchor = closestAnchor !== null;

          return {
            hasSubmenu,
            isParent,
            hasExpandIcon,
            interactiveHasChildren,
            interactiveIsLeaf,
            inNestedList,
            listDepth,
            depth,
            isInsideSubmenuToggle,
            isInsideAnchor,
            classList: classList.join(' ')
          };
        });
        
        // 调试输出
        const debugText = await element.textContent();
        console.error(`[score-debug] Element: "${debugText?.substring(0, 30)}" tag=${tagName} hasSubmenu=${menuInfo.hasSubmenu} isToggle=${menuInfo.isInsideSubmenuToggle} isInAnchor=${menuInfo.isInsideAnchor} interactiveIsLeaf=${menuInfo.interactiveIsLeaf} inNestedList=${menuInfo.inNestedList} listDepth=${menuInfo.listDepth}`);

        // 🔥 Submenu toggle trigger: massive penalty
        // These elements only expand/collapse the menu, they do NOT navigate
        if (menuInfo.isInsideSubmenuToggle) {
          score += 300;
          reasons.push('submenu-toggle');
        }

        // Element inside an <a> tag: strong signal for actual navigation item
        if (menuInfo.isInsideAnchor) {
          score -= 80;
          reasons.push('inside-anchor');
        }

        // 父菜单：大幅惩罚
        if (menuInfo.hasSubmenu || menuInfo.isParent || menuInfo.hasExpandIcon || menuInfo.interactiveHasChildren) {
          score += 200;
          reasons.push('parent-menu');
        }

        // 子菜单项（叶子节点）：大幅优先
        if (menuInfo.interactiveIsLeaf || menuInfo.inNestedList) {
          score -= 150;
          reasons.push('leaf-menu-item');
        }

        // 检查 href 属性：真实 URL 优先于 # 或 javascript:
        const hrefInfo = await element.evaluate((el: any) => {
          const href = el.getAttribute('href');
          if (!href) return { hasHref: false, isRealUrl: false };
          
          // 检查是否是真实 URL（不是 # 或 javascript:）
          const isRealUrl = href && 
                           href !== '#' && 
                           !href.startsWith('javascript:') &&
                           !href.startsWith('#') &&
                           href.length > 1;
          
          return { hasHref: true, isRealUrl, href };
        });
        
        if (hrefInfo.hasHref) {
          if (hrefInfo.isRealUrl) {
            score -= 100;  // 真实 URL：大幅减分（优先选择）
            reasons.push('real-url-href');
          } else {
            score += 50;   // 假 URL（# 或 javascript:）：加分（惩罚，可能是父菜单）
            reasons.push('fake-href');
          }
        }

        // 顶部元素：减分（优先）
        if (box.y < 100) { 
          score -= 30; 
          reasons.push('top-area'); 
        }
        
        // 左侧元素：减分（优先）
        if (box.x < 250) { 
          score -= 20; 
          reasons.push('left-area'); 
        }
        
        // 大元素：加分（惩罚，越大越差）
        const area = box.width * box.height;
        score += area / 10000;
        if (area > 50000) {
          reasons.push('large-element-penalty');
        }

        const elementText = await element.textContent();
        if (elementText) {
          const textLower = elementText.toLowerCase().trim();
          const targetLower = targetText.toLowerCase().trim();
          
          // 文本长度差异：越接近越好
          const lengthDiff = Math.abs(elementText.length - targetText.length);
          score += lengthDiff;
          
          if (textLower === targetLower) { 
            score -= 50;  // 精确匹配：大幅减分
            reasons.push('exact-match'); 
          } else if (textLower.includes(targetLower)) {
            // 包含匹配：根据长度差异评分
            if (elementText.length < targetText.length * 2) {
              score -= 20;  // 文本不太长，可能是正确的
              reasons.push('contains-match-short');
            } else {
              score += 10;  // 文本太长，可能是父容器
              reasons.push('contains-match-long');
            }
          }
        }

        const isNav = await element.evaluate((el: any) => {
          let current: Element | null = el;
          while (current) {
            const tag = current.tagName.toLowerCase();
            if (tag === 'nav' || tag === 'header') return true;
            current = current.parentElement;
          }
          return false;
        });
        if (isNav) { 
          score -= 30;  // 在导航区域：减分
          reasons.push('in-navigation'); 
        }

        // 嵌套深度：更深的元素优先（子菜单项）
        const depth = await element.evaluate((el: any) => {
          let depth = 0;
          let current: Element | null = el;
          while (current && depth < 20) {
            current = current.parentElement;
            depth++;
          }
          return depth;
        });
        if (depth > 10) { 
          score -= 5; 
          reasons.push('deep-nested'); 
        } else if (depth > 5) { 
          score -= 2; 
          reasons.push('nested'); 
        }

        scored.push({ element, score, reason: reasons.join(', ') });
      } catch (error) {
        continue;
      }
    }

    // 按分数排序：分数越低越好
    scored.sort((a, b) => a.score - b.score);
    
    // 输出前3个候选元素的评分（调试用）
    if (scored.length > 0) {
      console.error(`[score] Filtered ${scored.length} visible candidates for "${targetText}"`);
      console.error(`[score] Top 3 candidates:`);
      for (let i = 0; i < Math.min(3, scored.length); i++) {
        console.error(`  [${i+1}] score=${scored[i].score.toFixed(1)} reason=${scored[i].reason}`);
      }
    }
    
    return scored;
  }

  /**
   * Try Playwright locators
   */
  private async tryPlaywrightLocators(text: string, frame: any): Promise<ElementHandle[] | null> {
    try {
      const elements: ElementHandle[] = [];
      // Also try normalized version (collapse whitespace) for elements with embedded newlines
      const normalizedText = text.replace(/\s+/g, ' ').trim();
      const exactElements = await frame.getByText(text, { exact: true }).elementHandles();
      elements.push(...exactElements);
      if (normalizedText !== text) {
        const normExact = await frame.getByText(normalizedText, { exact: true }).elementHandles();
        elements.push(...normExact);
      }
      const partialElements = await frame.getByText(text, { exact: false }).elementHandles();
      elements.push(...partialElements);
      const roleElements = await frame.getByRole('link', { name: text }).elementHandles();
      elements.push(...roleElements);
      const buttonElements = await frame.getByRole('button', { name: text }).elementHandles();
      elements.push(...buttonElements);
      return elements.length > 0 ? elements : null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Try XPath locators
   */
  private async tryXPathLocators(text: string, frame: any): Promise<ElementHandle[] | null> {
    try {
      // Normalize whitespace for XPath matching
      const normalizedText = text.replace(/\s+/g, ' ').trim();
      const xpaths = [
        `//*[normalize-space(text())="${normalizedText}"]`,
        `//*[contains(normalize-space(text()), "${normalizedText}")]`,
        `//a[contains(normalize-space(text()), "${normalizedText}")]`,
        `//button[contains(normalize-space(text()), "${normalizedText}")]`,
        `//*[@aria-label="${normalizedText}"]`,
        `//*[@title="${normalizedText}"]`,
        `//*[contains(@class, "${normalizedText}")]`,  // For icon class names
      ];
      const elements: ElementHandle[] = [];
      for (const xpath of xpaths) {
        try {
          const found = await frame.$$(xpath);
          elements.push(...found);
        } catch (error) {
          continue;
        }
      }
      return elements.length > 0 ? elements : null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Try JavaScript search (enhanced to match aria-label, title, class for icon elements)
   */
  private async tryJavaScriptSearch(text: string, frame: any): Promise<ElementHandle[] | null> {
    try {
      const frameUrl = frame.url ? frame.url().substring(0, 60) : 'unknown';
      const jsHandle = await frame.evaluateHandle((searchText: string) => {
        const elements: Element[] = [];
        // Normalize whitespace for matching (handles elements with embedded newlines)
        const normalizedSearch = searchText.replace(/\s+/g, ' ').trim();
        const lowerSearch = normalizedSearch.toLowerCase();

        const walker = document.createTreeWalker(
          document.body,
          NodeFilter.SHOW_ELEMENT,
          null
        );

        let totalNodes = 0;
        let node;
        while ((node = walker.nextNode() as Element)) {
          totalNodes++;
          const rawText = node.textContent || '';
          const textContent = rawText.replace(/\s+/g, ' ').trim();
          const ariaLabel = node.getAttribute('aria-label') || '';
          const title = node.getAttribute('title') || '';
          const className = (node as HTMLElement).className || '';
          const classStr = typeof className === 'string' ? className : String(className);

          // Also try innerText (respects CSS visibility, closer to what user sees)
          const innerText = ((node as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim();

          // Match by text content, aria-label, title, or class name
          if (textContent.toLowerCase().includes(lowerSearch) ||
              innerText.toLowerCase().includes(lowerSearch) ||
              ariaLabel.toLowerCase().includes(lowerSearch) ||
              title.toLowerCase().includes(lowerSearch) ||
              classStr.toLowerCase().includes(lowerSearch)) {
            elements.push(node);
          }
        }
        // Attach debug info to first element slot (hack: use a sentinel)
        (window as any).__jsSearchDebug = { totalNodes, found: elements.length, search: lowerSearch };
        return elements;
      }, text);

      // Read debug info
      try {
        const debugInfo = await frame.evaluate(() => (window as any).__jsSearchDebug);
        console.error(`[js-search] frame="${frameUrl}" totalNodes=${debugInfo?.totalNodes} found=${debugInfo?.found} search="${debugInfo?.search}"`);
      } catch (_) {}


      const properties = await jsHandle.getProperties();
      const elements: ElementHandle[] = [];
      for (const prop of properties.values()) {
        const el = prop.asElement();
        if (el) elements.push(el as ElementHandle);
      }
      await jsHandle.dispose();
      return elements.length > 0 ? elements : null;
    } catch (error) {
      return null;
    }
  }

  private stripParenthetical(text: string): string {
    // 去掉完整括号对 "(xxx)"
    let result = text.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
    // 也去掉未闭合的尾部括号 "(xxx..."（截断文本常见）
    result = result.replace(/\s*\([^)]*$/g, '').trim();
    return result;
  }

  setMaxAttempts(max: number): void {
    this.maxAttempts = max;
  }

  /**
   * Input text into an input field by placeholder or label
   * Supports multiple locator strategies for maximum compatibility
   */
  async inputByPlaceholder(placeholder: string, text: string): Promise<InputResult> {
    console.error(`[input] Attempting to input "${text}" into field with placeholder: "${placeholder}"`);

    // Try in all frames (including nested child frames)
    const framesToTry = this.getAllFrames();
    
    for (const frame of framesToTry) {
      try {
        // Strategy 1: Find by placeholder attribute
        let input = await frame.$(`input[placeholder*="${placeholder}"], textarea[placeholder*="${placeholder}"]`);
        
        // Strategy 2: Find by aria-label
        if (!input) {
          input = await frame.$(`input[aria-label*="${placeholder}"], textarea[aria-label*="${placeholder}"]`);
        }
        
        // Strategy 3: Find by label text
        if (!input) {
          // Use CSS selector to get a proper ElementHandle instead of returning a DOM node
          const labeledInputSelector = await frame.evaluate((placeholderText: string) => {
            const labels = document.querySelectorAll('label');
            for (const label of labels) {
              if (label.textContent?.includes(placeholderText)) {
                const forAttr = label.getAttribute('for');
                if (forAttr) {
                  const el = document.getElementById(forAttr);
                  if (el) return `#${CSS.escape(forAttr)}`;
                }
                const inputInLabel = label.querySelector('input, textarea');
                if (inputInLabel) {
                  const id = inputInLabel.getAttribute('id');
                  if (id) return `#${CSS.escape(id)}`;
                  const name = inputInLabel.getAttribute('name');
                  if (name) return `[name="${name}"]`;
                }
              }
            }
            return null;
          }, placeholder);

          if (labeledInputSelector) {
            input = await frame.$(labeledInputSelector).catch(() => null);
          }
        }

        // Strategy 4: Find by name attribute (case-insensitive contains)
        if (!input) {
          const lowerPlaceholder = placeholder.toLowerCase();
          const selector = await frame.evaluate((searchText: string) => {
            const inputs = document.querySelectorAll('input, textarea');
            for (const inp of inputs) {
              const name = inp.getAttribute('name')?.toLowerCase() || '';
              const id = inp.getAttribute('id')?.toLowerCase() || '';
              if (name.includes(searchText)) return `[name="${inp.getAttribute('name')}"]`;
              if (id.includes(searchText)) return `#${CSS.escape(inp.getAttribute('id')!)}`;
            }
            return null;
          }, lowerPlaceholder);

          if (selector) {
            input = await frame.$(selector).catch(() => null);
          }
        }

        // Strategy 5: Find by nearby text node (for inputs without placeholder/aria-label)
        // This handles cases where extractInputFields found a label via DOM traversal
        if (!input) {
          const selector = await frame.evaluate((searchText: string) => {
            const lowerSearch = searchText.toLowerCase();
            const inputs = document.querySelectorAll('input:not([type="hidden"]), textarea');
            for (const inp of inputs) {
              // Check preceding siblings for matching text
              let sibling = inp.previousElementSibling;
              for (let i = 0; i < 3 && sibling; i++) {
                const sibText = ((sibling as HTMLElement).innerText || '').trim().toLowerCase();
                if (sibText && sibText.includes(lowerSearch)) {
                  const id = inp.getAttribute('id');
                  if (id) return `#${CSS.escape(id)}`;
                  const name = inp.getAttribute('name');
                  if (name) return `[name="${name}"]`;
                }
                sibling = sibling.previousElementSibling;
              }

              // Check parent and grandparent containers for a heading/span with matching text
              const parent = inp.parentElement;
              const grandParent = parent?.parentElement;
              for (const container of [parent, grandParent]) {
                if (!container) continue;
                const candidates = container.querySelectorAll('span, label, p, [class*="title"], [class*="label"], [class*="placeholder"]');
                for (const c of candidates) {
                  if (c === inp) continue;
                  const cText = ((c as HTMLElement).innerText || '').trim().toLowerCase();
                  if (cText && cText.includes(lowerSearch)) {
                    const id = inp.getAttribute('id');
                    if (id) return `#${CSS.escape(id)}`;
                    const name = inp.getAttribute('name');
                    if (name) return `[name="${name}"]`;
                  }
                }
              }
            }
            return null;
          }, placeholder);

          if (selector) {
            input = await frame.$(selector).catch(() => null);
          }
        }

        // Strategy 6: Find by custom placeholder div in ancestor container
        // Handles patterns like: <div class="container"><div class="fake-placeholder">位置/品牌/酒店</div><input></div>
        // Common in OTA sites (Fliggy, Ctrip) where placeholder is a sibling div, not an attribute
        // Returns {x, y} coordinates directly to avoid ElementHandle issues with evaluate-returned nodes
        if (!input) {
          const coords = await frame.evaluate((searchText: string) => {
            const lowerSearch = searchText.toLowerCase();

            const allEls = document.querySelectorAll('*');
            for (const el of allEls) {
              if (el.children.length > 3) continue;
              const elText = ((el as HTMLElement).innerText || '').trim().toLowerCase();
              if (!elText || !elText.includes(lowerSearch) || elText.length > searchText.length * 3) continue;

              // First try: click the matching text element itself (fake placeholder pattern)
              const elRect = (el as HTMLElement).getBoundingClientRect();
              if (elRect.width > 0 && elRect.height > 0) {
                return { x: elRect.left + elRect.width / 2, y: elRect.top + elRect.height / 2 };
              }

              // Second try: find input in ancestor container
              let container: Element | null = el.parentElement;
              for (let depth = 0; depth < 5 && container; depth++) {
                // Try the container itself first (it may be the clickable area)
                const containerRect = (container as HTMLElement).getBoundingClientRect();
                if (containerRect.width > 0 && containerRect.height > 0) {
                  const inp = container.querySelector('input:not([type="hidden"]), textarea') as HTMLElement | null;
                  if (inp) {
                    // Prefer input coords if visible, else use container coords
                    const inpRect = inp.getBoundingClientRect();
                    if (inpRect.width > 0 && inpRect.height > 0) {
                      return { x: inpRect.left + inpRect.width / 2, y: inpRect.top + inpRect.height / 2 };
                    }
                    // Input is hidden/zero-size — click the container to activate it
                    return { x: containerRect.left + containerRect.width / 2, y: containerRect.top + containerRect.height / 2 };
                  }
                }
                container = container.parentElement;
              }
            }
            return null;
          }, placeholder);

          if (coords) {
            await this.page.mouse.click(coords.x, coords.y);
            await this.page.waitForTimeout(300);

            // After clicking, verify focus landed on an input; if not, force-focus the nearest input
            const focused = await frame.evaluate(({ cx, cy }: { cx: number; cy: number }) => {
              const active = document.activeElement;
              if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
                return 'already-focused';
              }
              // Find the nearest input to the click point and focus it
              const inputs = Array.from(document.querySelectorAll('input:not([type="hidden"]), textarea')) as HTMLElement[];
              let best: HTMLElement | null = null;
              let bestDist = Infinity;
              for (const inp of inputs) {
                const r = inp.getBoundingClientRect();
                if (r.width === 0 && r.height === 0) continue;
                const dx = cx - (r.left + r.width / 2);
                const dy = cy - (r.top + r.height / 2);
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < bestDist) { bestDist = dist; best = inp; }
              }
              if (best && bestDist < 300) {
                best.focus();
                (best as HTMLInputElement).click();
                return 'force-focused';
              }
              return 'no-input-found';
            }, { cx: coords.x, cy: coords.y });

            console.error(`[input] Strategy-6 focus state: ${focused}`);
            await this.page.waitForTimeout(200);
            await this.page.keyboard.press('Control+a');
            await this.page.keyboard.type(text, { delay: 80 });
            await this.page.waitForTimeout(500);
            console.error(`[input] ✅ Successfully input "${text}" via strategy-6 coordinate click (focus: ${focused})`);
            return { success: true, elementFound: true, strategy: 'fake-placeholder@frame', inputValue: text };
          }
        }
        
        if (!input) {
          console.error(`[input] Input field not found in frame: ${frame.url().substring(0, 50)}`);
          continue;
        }

        console.error(`[input] Found input field in frame: ${frame.url().substring(0, 50)}`);

        // All strategies above return proper Playwright ElementHandles now.
        // But the input itself may be hidden (zero bounding box) — e.g. wrapped in a custom UI component.
        // In that case, click the nearest visible ancestor, then force-focus the input.
        let inputHandle = input as any;
        const inputBox = await inputHandle.boundingBox().catch(() => null);
        if (!inputBox || inputBox.width === 0 || inputBox.height === 0) {
          // Input is hidden — find nearest visible ancestor via JS and click it
          const ancestorCoords = await inputHandle.evaluate((el: HTMLElement) => {
            let node: Element | null = el.parentElement;
            for (let d = 0; d < 10 && node; d++) {
              const r = (node as HTMLElement).getBoundingClientRect();
              if (r.width > 0 && r.height > 0) {
                return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
              }
              node = node.parentElement;
            }
            return null;
          }).catch(() => null);

          if (ancestorCoords) {
            await this.page.mouse.click(ancestorCoords.x, ancestorCoords.y);
            await this.page.waitForTimeout(300);
            // Force focus directly on the input element
            await inputHandle.evaluate((el: HTMLElement) => { el.focus(); el.click(); }).catch(() => {});
            await this.page.waitForTimeout(150);
            await this.page.keyboard.press('Control+a');
            await this.page.keyboard.type(text, { delay: 80 });
            await this.page.waitForTimeout(500);
            console.error(`[input] ✅ Successfully input "${text}" via hidden-input ancestor click`);
            return { success: true, elementFound: true, strategy: 'hidden-input-ancestor@frame', inputValue: text };
          }
          console.error(`[input] Cannot get coordinates for input in frame: ${frame.url().substring(0, 50)}`);
          continue;
        }
        // 用 smartClick 点击激活输入框
        await this.smartClick(inputBox.x + inputBox.width / 2, inputBox.y + inputBox.height / 2, inputBox);

        // 清空现有内容
        await inputHandle.fill('');

        // 用正态分布随机延迟逐字输入（模拟真实打字节奏）
        await this.humanMouse.type(this.page, text);

        // 等待自动补全或建议出现
        await this.page.waitForTimeout(500);
        
        console.error(`[input] ✅ Successfully input "${text}" into field`);
        
        return {
          success: true,
          elementFound: true,
          strategy: `placeholder-match@frame`,
          inputValue: text,
        };
        
      } catch (error) {
        console.error(`[input] Frame failed:`, error);
        continue;
      }
    }
    
    console.error(`[input] ❌ Failed: input field with placeholder "${placeholder}" not found in any frame`);
    return {
      success: false,
      elementFound: false,
      strategy: 'placeholder',
      inputValue: text,
    };
  }

  /**
   * Extract input fields from the page (for DOM hints)
   * Helps LLM identify available input fields
   */
  async extractInputFields(): Promise<Array<{
    placeholder: string;
    label: string;
    type: string;
    position: string;
  }>> {
    const allFields: Array<{
      placeholder: string;
      label: string;
      type: string;
      position: string;
    }> = [];

    for (const frame of this.getAllFrames()) {
      try {
        const fields = await frame.evaluate(() => {
          const results: Array<{
            placeholder: string;
            label: string;
            type: string;
            position: string;
          }> = [];
          
          const vw = window.innerWidth;
          const vh = window.innerHeight;
          
          function descPosition(rect: DOMRect): string {
            const cx = rect.x + rect.width / 2;
            const cy = rect.y + rect.height / 2;
            const h = cx < vw * 0.25 ? '左侧' : cx > vw * 0.75 ? '右侧' : '中部';
            const v = cy < vh * 0.25 ? '顶部' : cy > vh * 0.75 ? '底部' : '中部';
            return v + h;
          }
          
          const inputs = document.querySelectorAll('input:not([type="hidden"]), textarea');
          
          for (const input of inputs) {
            const rect = input.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) continue;
            
            // Skip if outside viewport
            if (rect.right < 0 || rect.bottom < 0 || rect.left > vw || rect.top > vh) continue;
            
            const placeholder = input.getAttribute('placeholder') || '';
            const ariaLabel = input.getAttribute('aria-label') || '';
            const type = input.getAttribute('type') || 'text';

            // Try to find associated label
            let labelText = '';
            const id = input.getAttribute('id');
            if (id) {
              const label = document.querySelector(`label[for="${id}"]`);
              if (label) labelText = label.textContent?.trim() || '';
            }
            if (!labelText) {
              const parentLabel = input.closest('label');
              if (parentLabel) labelText = parentLabel.textContent?.trim() || '';
            }
            // Try to find nearby label text from parent container (for inputs without placeholder)
            if (!labelText && !placeholder && !ariaLabel) {
              // Look for a preceding sibling or parent text node that acts as a label
              const parent = input.parentElement;
              if (parent) {
                // Check preceding sibling elements for label-like text
                let sibling = input.previousElementSibling;
                for (let i = 0; i < 3 && sibling; i++) {
                  const sibText = (sibling as HTMLElement).innerText?.trim() || '';
                  if (sibText && sibText.length > 0 && sibText.length < 30) {
                    labelText = sibText;
                    break;
                  }
                  sibling = sibling.previousElementSibling;
                }
                // If still no label, check grandparent container for a title/heading
                if (!labelText) {
                  const grandParent = parent.parentElement;
                  if (grandParent) {
                    const heading = grandParent.querySelector('span, label, p, h1, h2, h3, h4, h5, h6, [class*="title"], [class*="label"]');
                    if (heading && heading !== input) {
                      const headingText = (heading as HTMLElement).innerText?.trim() || '';
                      if (headingText && headingText.length > 0 && headingText.length < 30) {
                        labelText = headingText;
                      }
                    }
                  }
                }
              }
            }

            const displayText = placeholder || ariaLabel || labelText || `${type}输入框`;
            
            if (displayText && displayText.length > 0) {
              results.push({
                placeholder: displayText,
                label: labelText,
                type: type === 'textarea' ? 'textarea' : type,
                position: descPosition(rect),
              });
            }
          }
          
          return results;
        });
        
        if (fields && fields.length > 0) {
          allFields.push(...fields);
        }
      } catch (error) {
        console.error(`[input-hints] Failed to extract from frame:`, error);
        continue;
      }
    }
    
    // Deduplicate
    const seen = new Set<string>();
    const uniqueFields = allFields.filter(field => {
      const key = field.placeholder + field.position;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    
    console.error(`[input-hints] Extracted ${uniqueFields.length} input fields`);
    uniqueFields.forEach((field, idx) => {
      console.error(`[input-hints] [${idx}] [${field.position}] "${field.placeholder}" (${field.type})`);
    });
    
    return uniqueFields;
  }
}
