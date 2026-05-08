/**
 * Page Analyzer
 * Detects page completeness and identifies expandable content
 */

import { VisionNavigator } from './vision-navigator';
import { SmartClickHandler } from './smart-click-handler';
import { BrowserController } from './browser-controller';
import { CompletenessCheck, ExpandableElement } from './types';

export class PageAnalyzer {
  private visionNavigator: VisionNavigator;
  private clickHandler: SmartClickHandler;
  private browserController: BrowserController;
  private expandedElements: Set<string> = new Set(); // 记录已成功展开的元素
  private failedElements: Set<string> = new Set();   // 记录点击失败的元素（可重试）

  constructor(
    visionNavigator: VisionNavigator,
    clickHandler: SmartClickHandler,
    browserController: BrowserController
  ) {
    this.visionNavigator = visionNavigator;
    this.clickHandler = clickHandler;
    this.browserController = browserController;
  }

  /**
   * Check page completeness
   */
  async checkCompleteness(screenshot: Buffer): Promise<CompletenessCheck> {
    return await this.visionNavigator.checkCompleteness(screenshot);
  }

  /**
   * Scroll an element into view by matching its text content
   */
  private async scrollElementIntoView(elementText: string): Promise<void> {
    const page = this.browserController.getPage();
    if (!page) return;

    const MAX_SCROLL_ATTEMPTS = 10;
    
    for (let attempt = 0; attempt < MAX_SCROLL_ATTEMPTS; attempt++) {
      try {
        const result = await page.evaluate((text: string) => {
          const vw = window.innerWidth, vh = window.innerHeight;

          const findElement = (): Element | null => {
            const all = Array.from(document.querySelectorAll('*'));
            let best: Element | null = null;
            for (const el of all) {
              const elText = (el as HTMLElement).innerText?.replace(/\s+/g, ' ').trim() ||
                             el.textContent?.replace(/\s+/g, ' ').trim() || '';
              if (elText === text && (!best || best.contains(el))) best = el;
            }
            if (!best) {
              for (const el of all) {
                const elText = (el as HTMLElement).innerText?.replace(/\s+/g, ' ').trim() ||
                               el.textContent?.replace(/\s+/g, ' ').trim() || '';
                if (elText.startsWith(text)) { best = el; break; }
              }
            }
            return best;
          };

          const findMainContainer = (): Element | null => {
            const candidates = Array.from(document.querySelectorAll('*')).filter(el => {
              if (el === document.documentElement || el === document.body) return false;
              const style = getComputedStyle(el);
              const oy = style.overflowY;
              if (oy !== 'auto' && oy !== 'scroll') return false;
              const rect = el.getBoundingClientRect();
              if (rect.right <= 0 || rect.bottom <= 0 || rect.left >= vw || rect.top >= vh) return false;
              const visibleW = Math.min(rect.right, vw) - Math.max(rect.left, 0);
              const visibleH = Math.min(rect.bottom, vh) - Math.max(rect.top, 0);
              return visibleW * visibleH > vw * vh * 0.1;
            });
            if (candidates.length === 0) return null;
            return candidates.reduce((a, b) => {
              const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
              const areaA = (Math.min(ra.right, vw) - Math.max(ra.left, 0)) * (Math.min(ra.bottom, vh) - Math.max(ra.top, 0));
              const areaB = (Math.min(rb.right, vw) - Math.max(rb.left, 0)) * (Math.min(rb.bottom, vh) - Math.max(rb.top, 0));
              return areaA >= areaB ? a : b;
            });
          };

          const target = findElement();
          if (!target) return { type: 'not_found' as const };

          const rect = target.getBoundingClientRect();
          if (rect.height === 0 || rect.width === 0) {
            return { type: 'invisible' as const };
          }

          const container = findMainContainer();
          const elCenter = rect.top + rect.height / 2;

          if (container) {
            const cRect = container.getBoundingClientRect();
            const containerVisibleCenter = (Math.max(cRect.top, 0) + Math.min(cRect.bottom, vh)) / 2;
            const offset = elCenter - containerVisibleCenter;
            
            // Check if element is already centered (within 50px tolerance)
            if (Math.abs(offset) < 50) {
              return { type: 'centered' as const };
            }
            
            return { type: 'offset' as const, offset };
          } else {
            const offset = elCenter - vh / 2;
            if (Math.abs(offset) < 50) {
              return { type: 'centered' as const };
            }
            return { type: 'offset' as const, offset };
          }
        }, elementText);

        if (result.type === 'not_found') {
          console.error(`[scroll-into-view] "${elementText}" → not found`);
          return;
        }

        if (result.type === 'invisible') {
          // Element exists in DOM but has zero dimensions — likely CSS-hidden
          // (e.g. collapsed row in vxe-table). Don't waste time scrolling;
          // clickByText will find visible candidates on its own.
          console.error(`[scroll-into-view] "${elementText}" → invisible (CSS-hidden), skipping scroll`);
          return;
        }

        if (result.type === 'centered') {
          console.error(`[scroll-into-view] "${elementText}" → already centered`);
          return;
        }

        // Scroll gradually towards target (max 400px per step to look human)
        const offset = result.offset;
        const step = Math.sign(offset) * Math.min(Math.abs(offset), 400);
        console.error(`[scroll-into-view] "${elementText}" → offset=${Math.round(offset)}px, scrolling ${Math.round(step)}px`);
        await this.browserController.wheelScrollByDelta(step);
        await this.browserController.wait(80 + Math.random() * 70);

        // If offset was small, we're done
        if (Math.abs(offset) <= 400) return;

      } catch (err) {
        console.error(`[scroll-into-view] "${elementText}" → error: ${err}`);
        return;
      }
    }

    console.error(`[scroll-into-view] "${elementText}" → max attempts reached`);
  }

  /**
   * 等待页面 DOM 高度稳定（展开动画结束）
   * 每隔 interval ms 检查一次高度，连续 stableCount 次不变则认为稳定
   * 超过 timeout ms 后强制返回
   */
  private async waitForDomStable(timeout = 2000, interval = 150, stableCount = 3): Promise<void> {
    const page = this.browserController.getPage();
    if (!page) return;

    const deadline = Date.now() + timeout;
    let stable = 0;
    let lastHeight = -1;

    while (Date.now() < deadline) {
      const height = await page.evaluate(() => document.body.scrollHeight).catch(() => -1);
      if (height === lastHeight) {
        stable++;
        if (stable >= stableCount) return;
      } else {
        stable = 0;
        lastHeight = height;
      }
      await this.browserController.wait(interval);
    }
  }

  /**
   * Scroll the main scrollable container down by roughly one viewport height.
   * Returns whether the container actually scrolled (i.e. not already at bottom).
   *
   * Unlike browserController.scroll('down') which uses window.scrollBy,
   * this targets the actual overflow container — critical for admin panels
   * where the page body doesn't scroll but an inner div does.
   * Also critical for virtual-scroll tables (vxe-table) where off-viewport
   * rows only exist in the DOM after the container scrolls them into view.
   */
  private async scrollMainContainerDown(page: any): Promise<{ didScroll: boolean }> {
    if (!page) return { didScroll: false };

    try {
      // Get container info and current scroll position
      const scrollInfo = await page.evaluate(() => {
        const vw = window.innerWidth, vh = window.innerHeight;

        const candidates = Array.from(document.querySelectorAll('*')).filter(el => {
          if (el === document.documentElement || el === document.body) return false;
          const style = getComputedStyle(el);
          const oy = style.overflowY;
          if (oy !== 'auto' && oy !== 'scroll') return false;
          const rect = el.getBoundingClientRect();
          if (rect.right <= 0 || rect.bottom <= 0 || rect.left >= vw || rect.top >= vh) return false;
          const visibleW = Math.min(rect.right, vw) - Math.max(rect.left, 0);
          const visibleH = Math.min(rect.bottom, vh) - Math.max(rect.top, 0);
          return visibleW * visibleH > vw * vh * 0.1;
        });

        if (candidates.length === 0) {
          return { scrollTopBefore: window.scrollY, maxScroll: document.body.scrollHeight - window.innerHeight, usedWindow: true };
        }

        const container = candidates.reduce((a, b) => {
          const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
          const areaA = (Math.min(ra.right, vw) - Math.max(ra.left, 0)) * (Math.min(ra.bottom, vh) - Math.max(ra.top, 0));
          const areaB = (Math.min(rb.right, vw) - Math.max(rb.left, 0)) * (Math.min(rb.bottom, vh) - Math.max(rb.top, 0));
          return areaA >= areaB ? a : b;
        });

        const before = container.scrollTop;
        const maxScroll = container.scrollHeight - container.clientHeight;
        return { scrollTopBefore: before, maxScroll, usedWindow: false };
      });

      // Check if already at bottom
      if (scrollInfo.scrollTopBefore >= scrollInfo.maxScroll - 5) {
        console.error(`[scrollMainContainerDown] Already at bottom (${Math.round(scrollInfo.scrollTopBefore)}/${Math.round(scrollInfo.maxScroll)})`);
        return { didScroll: false };
      }

      // Scroll down using wheel events (human-like)
      const scrollAmount = Math.min(500, scrollInfo.maxScroll - scrollInfo.scrollTopBefore);
      await this.browserController.wheelScrollByDelta(scrollAmount);
      await this.browserController.wait(100 + Math.random() * 100);

      // Check new position
      const scrollTopAfter = await page.evaluate(() => {
        const vw = window.innerWidth, vh = window.innerHeight;
        const candidates = Array.from(document.querySelectorAll('*')).filter(el => {
          if (el === document.documentElement || el === document.body) return false;
          const style = getComputedStyle(el);
          if (style.overflowY !== 'auto' && style.overflowY !== 'scroll') return false;
          const rect = el.getBoundingClientRect();
          if (rect.right <= 0 || rect.bottom <= 0 || rect.left >= vw || rect.top >= vh) return false;
          const visibleW = Math.min(rect.right, vw) - Math.max(rect.left, 0);
          const visibleH = Math.min(rect.bottom, vh) - Math.max(rect.top, 0);
          return visibleW * visibleH > vw * vh * 0.1;
        });
        if (candidates.length === 0) return window.scrollY;
        const container = candidates.reduce((a, b) => {
          const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
          const areaA = (Math.min(ra.right, vw) - Math.max(ra.left, 0)) * (Math.min(ra.bottom, vh) - Math.max(ra.top, 0));
          const areaB = (Math.min(rb.right, vw) - Math.max(rb.left, 0)) * (Math.min(rb.bottom, vh) - Math.max(rb.top, 0));
          return areaA >= areaB ? a : b;
        });
        return container.scrollTop;
      });

      const didScroll = Math.abs(scrollTopAfter - scrollInfo.scrollTopBefore) > 5;
      console.error(`[scrollMainContainerDown] before=${Math.round(scrollInfo.scrollTopBefore)} after=${Math.round(scrollTopAfter)} didScroll=${didScroll}`);
      return { didScroll };
    } catch (err) {
      console.error(`[scrollMainContainerDown] error: ${err}`);
      return { didScroll: false };
    }
  }

  /**
   * Expand content by clicking expandable elements.
   *
   * Strategy A+B combined:
   *   - B: scrollIntoView before each click so off-screen elements become reachable
   *   - A: after exhausting visible elements, scroll down and re-detect until page bottom
   *
   * @param initialElements  Optional seed elements (e.g. from vision detection).
   *                         When omitted the method relies entirely on DOM detection.
   * @param maxSteps         Maximum number of expand/scroll actions.
   */
  async expandContent(initialElements: ExpandableElement[] = [], maxSteps: number): Promise<void> {
    const MAX_EMPTY_SCROLLS = 3;
    const MAX_RETRIES_PER_ELEMENT = 2;
    let step = 0;
    let emptyScrollCount = 0;
    const retryCounts = new Map<string, number>();
    const page = this.browserController.getPage();

    /** 获取当前页面 URL，用于检测点击后是否发生了页面跳转 */
    const getCurrentUrl = async (): Promise<string> => {
      try {
        return page ? page.url() : '';
      } catch {
        return '';
      }
    };

    /**
     * 尝试展开单个元素。
     * 返回 true = 成功展开，false = 点击失败或跳转（需重试或放弃）
     */
    const tryExpand = async (text: string): Promise<boolean> => {
      await this.scrollElementIntoView(text);

      /** Snapshot expanded state before click for verification */
      const snapshotExpanded = async (): Promise<{ score: number; details: string }> => {
        if (!page) return { score: 0, details: 'no-page' };
        return page.evaluate(() => {
          let score = 0;
          const details: string[] = [];

          // Strategy 1: Count total visible rows in vxe-table (for tree tables)
          const vxeRows = document.querySelectorAll('.vxe-body--row');
          if (vxeRows.length > 0) {
            let visibleCount = 0;
            vxeRows.forEach(r => {
              const style = getComputedStyle(r);
              if (style.display !== 'none' && (r as HTMLElement).offsetHeight > 0) visibleCount++;
            });
            score += visibleCount * 10;
            details.push(`vxe-rows:${visibleCount}`);
          }

          // Strategy 2: Count aria-expanded="true" elements
          const ariaExpanded = document.querySelectorAll('[aria-expanded="true"]').length;
          if (ariaExpanded > 0) {
            score += ariaExpanded * 10;
            details.push(`aria-expanded:${ariaExpanded}`);
          }

          // Strategy 3: Count total visible DOM elements (general expansion indicator)
          const allVisible = Array.from(document.querySelectorAll('*')).filter(el => {
            const style = getComputedStyle(el);
            return style.display !== 'none' && (el as HTMLElement).offsetHeight > 0;
          }).length;
          score += allVisible;
          details.push(`visible-elements:${allVisible}`);

          // Strategy 4: Measure total text content length (more content = likely expanded)
          const textLength = document.body.innerText?.length || 0;
          score += Math.floor(textLength / 100);
          details.push(`text-length:${textLength}`);

          return { score, details: details.join(', ') };
        });
      };

      const expandedBefore = await snapshotExpanded();
      const urlBefore = await getCurrentUrl();
      const scrollBefore = await page?.evaluate(() => window.scrollY) || 0;

      console.error(`[expandContent] Before click "${text}": score=${expandedBefore.score}, ${expandedBefore.details}`);

      // Try clicking candidates in order (nth=0 first, then nth=1, etc.)
      const MAX_CANDIDATES = 3;
      for (let nth = 0; nth < MAX_CANDIDATES; nth++) {
        let result;
        if (nth === 0) {
          result = await this.clickHandler.clickByText(text);
        } else {
          console.error(`[expandContent] Trying ${nth + 1}th candidate for "${text}"`);
          await this.scrollElementIntoView(text);
          result = await this.clickHandler.clickNthByText(text, nth);
        }

        if (!result.success) {
          console.error(`[expandContent] ✗ Click failed for "${text}" (candidate ${nth + 1})`);
          // Random delay before trying next candidate (human-like hesitation)
          if (nth < MAX_CANDIDATES - 1) {
            await this.browserController.wait(100 + Math.random() * 100);
          }
          continue;
        }

        // 等待 DOM 稳定（展开动画结束）
        await this.waitForDomStable(2000, 150, 3);

        // 检测 URL 是否跳转（误点了导航链接）
        const urlAfter = await getCurrentUrl();
        if (urlAfter !== urlBefore) {
          console.error(`[expandContent] ⚠️ URL changed after clicking "${text}": ${urlBefore} → ${urlAfter}. Aborting expand.`);
          return false;
        }

        // 检测锚点跳转（页面大幅滚动但内容没变，说明是锚点链接而非展开按钮）
        const scrollAfter = await page?.evaluate(() => window.scrollY) || 0;
        const scrollDelta = Math.abs(scrollAfter - scrollBefore);
        if (scrollDelta > 200) {
          console.error(`[expandContent] ⚠️ Anchor scroll detected for "${text}" (scrollDelta=${scrollDelta}px), skipping as non-expandable`);
          return false;
        }

        // Verify expansion actually happened
        const expandedAfter = await snapshotExpanded();
        console.error(`[expandContent] After click "${text}": score=${expandedAfter.score}, ${expandedAfter.details}`);

        // 🔥 关键修复：使用分数差异判断，而不是简单的大于比较
        // 允许5%的误差范围（避免因为动画、懒加载等导致的微小波动）
        const scoreDiff = expandedAfter.score - expandedBefore.score;
        const threshold = Math.max(10, expandedBefore.score * 0.05);

        if (scoreDiff > threshold) {
          console.error(`[expandContent] ✓ Expansion verified (score +${scoreDiff}) on ${nth > 0 ? (nth + 1) + 'th' : 'first'} candidate for "${text}"`);
          // Random delay after successful expansion (human reading/thinking time)
          await this.browserController.wait(150 + Math.random() * 150);
          return true;
        }

        // 🔥 新增：检测按钮文字是否变化（展开/收起切换）
        const buttonStillExists = await page?.evaluate((targetText: string) => {
          const all = Array.from(document.querySelectorAll('*'));
          return all.some(el => {
            const text = (el as HTMLElement).innerText?.replace(/\s+/g, ' ').trim() || '';
            return text === targetText;
          });
        }, text);

        if (!buttonStillExists) {
          console.error(`[expandContent] ✓ Button text changed (likely toggled) for "${text}", treating as success`);
          // Random delay after successful expansion
          await this.browserController.wait(150 + Math.random() * 150);
          return true;
        }

        console.error(`[expandContent] ⚠️ Candidate ${nth + 1} clicked but "${text}" did not expand (score diff=${scoreDiff}, threshold=${threshold}), trying next candidate`);
        // Random delay before trying next candidate
        if (nth < MAX_CANDIDATES - 1) {
          await this.browserController.wait(100 + Math.random() * 100);
        }
      }

      console.error(`[expandContent] ✗ All ${MAX_CANDIDATES} candidates failed to expand "${text}"`);
      return false;
    };

    // ── Phase 1: process seed elements (vision-detected or caller-supplied) ──
    for (const element of initialElements) {
      if (step >= maxSteps) return;

      try {
        if (element.action === 'scroll') {
          await this.scrollMainContainerDown(page);
          step++;
          await this.browserController.wait(1500);
          continue;
        }

        if (element.action === 'click') {
          if (this.expandedElements.has(element.text)) {
            console.error(`[expandContent] Skipping already expanded (seed): "${element.text}"`);
            continue;
          }

          const ok = await tryExpand(element.text);
          if (ok) {
            this.expandedElements.add(element.text);
            this.failedElements.delete(element.text);
            console.error(`[expandContent] ✓ Expanded (seed): "${element.text}"`);
            step++;
            // Random delay between seed expansions (human browsing rhythm)
            await this.browserController.wait(150 + Math.random() * 150);
          } else {
            // 失败：加入 failedElements，不加入 expandedElements，后续可重试
            this.failedElements.add(element.text);
          }
        }
      } catch (_err) {
        // Continue with next element
      }
    }

    // ── Phase 2: loop — detect → click → scroll (方案A+B) ──
    while (step < maxSteps) {
      const domElements = await this.detectAccordions();

      // pending = DOM 检测到的 + 之前失败的，排除已成功展开的
      const detectedTexts = new Set(domElements.map(e => e.text));
      const retryElements = Array.from(this.failedElements)
        .filter(t => !this.expandedElements.has(t))
        .map(t => ({ type: 'accordion' as const, text: t, action: 'click' as const }));

      const pending = [
        ...domElements.filter(e => !this.expandedElements.has(e.text)),
        ...retryElements.filter(e => !detectedTexts.has(e.text)), // 避免重复
      ];

      if (pending.length > 0) {
        emptyScrollCount = 0; // reset: we found something to do

        // 每次只处理第一个 pending 元素，展开后立即 break 回 while 顶部。
        // 这样 scrollElementIntoView 会在每次展开前重新定位，
        // 实现"展开 → 滚动定位 → 展开 → 滚动定位"的节奏，
        // 避免展开后内容撑高把后续元素挤出视口却不滚动的问题。
        const el = pending[0];

        try {
          if (el.action === 'scroll') {
            await this.scrollMainContainerDown(page);
            step++;
            await this.browserController.wait(1500);
          } else {
            const ok = await tryExpand(el.text);
            if (ok) {
              this.expandedElements.add(el.text);
              this.failedElements.delete(el.text);
              console.error(`[expandContent] ✓ Expanded (loop): "${el.text}"`);
              step++;
            } else {
              // 失败：记录重试次数，超过上限则放弃
              const retries = (retryCounts.get(el.text) || 0) + 1;
              retryCounts.set(el.text, retries);
              if (retries >= MAX_RETRIES_PER_ELEMENT) {
                this.failedElements.delete(el.text);
                this.expandedElements.add(el.text); // 标记为已处理，避免再次尝试
                console.error(`[expandContent] ✗ Giving up on "${el.text}" after ${retries} retries`);
              } else {
                this.failedElements.add(el.text);
                console.error(`[expandContent] ✗ Failed (loop): "${el.text}", queued for retry (${retries}/${MAX_RETRIES_PER_ELEMENT})`);
              }
            }
          }
        } catch (_err) {
          // 异常也计入重试次数，避免卡死
          const retries = (retryCounts.get(el.text) || 0) + 1;
          retryCounts.set(el.text, retries);
          if (retries >= MAX_RETRIES_PER_ELEMENT) {
            this.failedElements.delete(el.text);
            this.expandedElements.add(el.text);
          } else {
            this.failedElements.add(el.text);
          }
        }
      } else {
        // 方案A: no pending elements found — scroll the MAIN SCROLLABLE CONTAINER
        // to reveal more elements (critical for virtual-scroll tables like vxe-table
        // where off-viewport rows are not in the DOM).
        const scrollResult = await this.scrollMainContainerDown(page);

        if (!scrollResult.didScroll) {
          emptyScrollCount++;
          console.error(`[expandContent] Container did not scroll further (${emptyScrollCount}/${MAX_EMPTY_SCROLLS})`);

          // 滚动后没动，但仍有失败元素 → 再给一次机会
          if (this.failedElements.size > 0 && emptyScrollCount < MAX_EMPTY_SCROLLS) {
            console.error(`[expandContent] Still have ${this.failedElements.size} failed elements, will retry`);
            continue;
          }

          if (emptyScrollCount >= MAX_EMPTY_SCROLLS) {
            console.error('[expandContent] Reached container bottom, stopping.');
            break;
          }
        } else {
          emptyScrollCount = 0; // scrolled — keep looking
          console.error(`[expandContent] Scrolled container down, waiting for new elements to render...`);
          await this.browserController.wait(800);
        }
      }
    }
  }

  /**
   * Detect "Show More" buttons
   */
  async detectExpandButtons(): Promise<ExpandableElement[]> {
    const page = this.browserController.getPage();
    if (!page) {
      return [];
    }

    return await page.evaluate(() => {
      const elements: ExpandableElement[] = [];
      const keywords = [
        'show more', 'load more', 'view all', 'see more', 'see all',
        'read more', 'expand', 'show all', 'load all', 'more',
        '显示更多', '加载更多', '查看全部', '展开', '更多'
      ];

      const buttons = document.querySelectorAll('button, a, span[role="button"]');
      
      for (const button of buttons) {
        const text = button.textContent?.toLowerCase().trim() || '';
        
        for (const keyword of keywords) {
          if (text.includes(keyword)) {
            elements.push({
              type: 'button',
              text: button.textContent?.trim() || '',
              action: 'click',
            });
            break;
          }
        }
      }

      return elements;
    });
  }

  /**
   * Detect accordion panels
   */
  /**
     * Detect accordion panels
     */
    async detectAccordions(): Promise<ExpandableElement[]> {
      const page = this.browserController.getPage();
      if (!page) {
        return [];
      }

      return await page.evaluate(() => {
        const elements: ExpandableElement[] = [];

        // ── Pre-check: 如果页面已经全部展开，直接返回空数组 ──
        // 判断依据：存在"收起全部"/"collapse all"之类的按钮，说明内容已全部展开
        const collapseAllKeywords = [
          '收起全部', '收起所有', 'collapse all', 'collapse all',
          '全部收起', 'hide all', '折叠全部', '全部折叠',
        ];
        const allClickable = document.querySelectorAll('button, [role="button"], span, div, a');
        for (const el of allClickable) {
          const t = (el as HTMLElement).innerText?.replace(/\s+/g, ' ').trim() ||
                    el.textContent?.replace(/\s+/g, ' ').trim() || '';
          if (collapseAllKeywords.some(kw => t.toLowerCase().includes(kw.toLowerCase()))) {
            console.error(`[detectAccordions] Pre-check: Found "collapse all" indicator: "${t}" — page is already fully expanded, skipping.`);
            return [];
          }
        }

        // 🔥 Helper: 检测文字是否为"收起/隐藏"类按钮（已展开状态的按钮，不应该被检测为可展开元素）
        const isCollapseButton = (text: string): boolean => {
          const collapseKeywords = [
            '隐藏', '收起', '折叠', '收回', '关闭',
            'hide', 'collapse', 'fold', 'close', 'less',
          ];
          const lowerText = text.toLowerCase();
          return collapseKeywords.some(kw => lowerText.includes(kw));
        };

        // 🔥 Strategy 0: Check for vxe-table tree structure (common in admin panels)
        // Look for collapsed tree nodes in vxe-table
        const vxeTreeRows = document.querySelectorAll('.vxe-body--row.row--level-0');
        console.error(`[detectAccordions] Strategy 0: Found ${vxeTreeRows.length} vxe-table tree rows`);

        if (vxeTreeRows.length > 0) {
          // Check if these are room type rows (contain room names)
          for (const row of vxeTreeRows) {
            const nameElement = row.querySelector('.name-text, .room-name, [class*="name"]');
            if (nameElement) {
              const itemName = nameElement.textContent?.trim() || '';

              // 🔥 通用检测：只要有文本内容就认为是可展开项
              // 不限定特定语言或业务类型
              if (itemName && itemName.length > 0 && itemName.length < 100) {
                // 🔥 关键修复：检查是否已经展开
                // 在 vxe-table 中，展开的行会有子行（row--level-1, row--level-2 等）
                const rowId = row.getAttribute('rowid');
                console.error(`[detectAccordions] Strategy 0: Checking item "${itemName}", rowid="${rowId}"`);

                // 子行存在且可见（非 display:none）才算真正已展开
                const childRow = rowId
                  ? document.querySelector(`.vxe-body--row[rowid^="${rowId}-"]`)
                  : null;
                const childVisible = childRow
                  ? (childRow as HTMLElement).style.display !== 'none' &&
                    getComputedStyle(childRow).display !== 'none'
                  : false;
                console.error(`[detectAccordions] Strategy 0: childRow=${!!childRow}, childVisible=${childVisible}`);

                // 如果已经有可见子行，说明已经展开了，跳过
                if (childVisible) {
                  console.error(`[detectAccordions] Strategy 0: Item "${itemName}" is already expanded, skipping`);
                  continue;
                }
                
                // Check if this row has tree structure (is expandable)
                const hasTreeIcon = row.querySelector('.vxe-tree--btn-wrapper, .vxe-tree-cell, [class*="tree"]');

                if (hasTreeIcon || vxeTreeRows.length > 1) {
                  console.error(`[detectAccordions] Strategy 0: Found collapsed vxe-table item: "${itemName}"`);
                  elements.push({
                    type: 'accordion',
                    text: itemName,
                    action: 'click',
                  });
                }
              }
            }
          }

          // If we found vxe-table items, return them immediately
          if (elements.length > 0) {
            console.error(`[detectAccordions] Strategy 0: Found ${elements.length} collapsed vxe-table items`);
            return elements;
          } else if (vxeTreeRows.length > 0) {
            // All visible vxe-table items are expanded, but there may be more
            // items outside the virtual-scroll viewport. Don't return early —
            // fall through to other strategies which may find additional elements.
            console.error(`[detectAccordions] Strategy 0: All visible vxe-table items are expanded, checking other strategies...`);
          }
        }

        // 🔥 Strategy 1: Look for elements with aria-expanded="false"
        const collapsed = document.querySelectorAll('[aria-expanded="false"]');
        console.error(`[detectAccordions] Strategy 1: Found ${collapsed.length} elements with aria-expanded="false"`);

        // 如果页面上 aria-expanded="true" 的数量 >= aria-expanded="false" 的数量，
        // 说明大部分内容已展开，aria-expanded="false" 很可能是"收起"控件，跳过 Strategy 1
        const expandedCount = document.querySelectorAll('[aria-expanded="true"]').length;
        const collapsedCount = collapsed.length;
        console.error(`[detectAccordions] Strategy 1: expanded=${expandedCount} collapsed=${collapsedCount}`);

        // 排除下拉菜单、选择器、弹窗触发器等非内容折叠元素的关键词
        const dropdownExcludePatterns = [
          /\d+\s*间/, /\d+\s*成人/, /\d+\s*儿童/,  // 房间/人数选择器
          /入住/, /退房/, /选择日期/, /日期/,          // 日期选择器
          /筛选/, /排序/, /更多/,                      // 筛选/排序下拉
          /语言/, /货币/, /登录/, /注册/,              // 用户操作下拉
        ];
        const dropdownExcludeSelectors = [
          '[class*="guest"]', '[class*="Guest"]',
          '[class*="picker"]', '[class*="Picker"]',
          '[class*="dropdown"]', '[class*="Dropdown"]',
          '[class*="select"]', '[class*="Select"]',
          '[class*="popover"]', '[class*="Popover"]',
          '[class*="datepicker"]', '[class*="DatePicker"]',
          '[class*="calendar"]', '[class*="Calendar"]',
          '[role="listbox"]', '[role="combobox"]',
        ].join(', ');

        if (expandedCount >= collapsedCount && collapsedCount > 0) {
          console.error(`[detectAccordions] Strategy 1: More expanded than collapsed — likely "collapse" controls, skipping Strategy 1`);
        } else {
          for (const element of collapsed) {
            // 🔥 Skip navigation / header / topbar areas
            const isInNav = element.closest(
              'nav, aside, header, [class*="sidebar"], [class*="menu"], [class*="header"], [class*="topbar"], [class*="navbar"], [role="navigation"]'
            );
            if (isInNav) continue;

            // 🔥 Skip real links (<a> with href) — they navigate, not expand
            const anchor = element.closest('a[href]');
            if (anchor) continue;
            if (element.tagName === 'A' && (element as HTMLAnchorElement).href) continue;

            // 🔥 Skip dropdown/picker/select controls — they are NOT content accordions
            const isDropdown = element.closest(dropdownExcludeSelectors) || element.matches(dropdownExcludeSelectors);
            if (isDropdown) {
              console.error(`[detectAccordions] Strategy 1: Skipping dropdown/picker element`);
              continue;
            }

            const text = (element.textContent?.trim() || element.getAttribute('aria-label') || '').replace(/\s+/g, ' ');

            // 🔥 Skip if text matches dropdown/picker patterns (e.g. "1间, 1成人, 0儿童")
            if (text && dropdownExcludePatterns.some(p => p.test(text))) {
              console.error(`[detectAccordions] Strategy 1: Skipping dropdown-like text: "${text.substring(0, 50)}"`);
              continue;
            }

            // 🔥 Skip "collapse/hide" buttons (already expanded state)
            if (text && isCollapseButton(text)) {
              console.error(`[detectAccordions] Strategy 1: Skipping collapse button: "${text.substring(0, 50)}"`);
              continue;
            }

            // 🔥 文本至少 3 个字符，排除 "%"、"天" 等极短噪音
            if (text && text.length > 2 && text.length < 100) {
              console.error(`[detectAccordions] Strategy 1: Found valid element: "${text.substring(0, 50)}"`);
              elements.push({
                type: 'accordion',
                text,
                action: 'click',
              });
            }
          }
        }

        console.error(`[detectAccordions] Strategy 1: Found ${elements.length} valid elements`);

        // 🔥 Strategy 2: Look for collapsed room types in calendar view (main content area only)
        // Common patterns: elements with class containing "collapse", "fold", "expand"
        const potentialRoomTypes = document.querySelectorAll('[class*="collapse"], [class*="fold"], [class*="expand"], [class*="accordion"]');
        console.error(`[detectAccordions] Strategy 2: Found ${potentialRoomTypes.length} elements with collapse/fold/expand classes`);

        for (const element of potentialRoomTypes) {
          // 🔥 Skip if in navigation / header area
          const isInNav = element.closest(
            'nav, aside, header, [class*="sidebar"], [class*="menu"], [class*="header"], [class*="topbar"], [class*="navbar"], [role="navigation"]'
          );
          if (isInNav) continue;

          // 🔥 Skip real links
          const anchor = element.closest('a[href]');
          if (anchor) continue;
          if (element.tagName === 'A' && (element as HTMLAnchorElement).href) continue;

          // 🔥 Skip dropdown/picker/select controls
          const isDropdown = element.closest(dropdownExcludeSelectors) || element.matches(dropdownExcludeSelectors);
          if (isDropdown) continue;

          // Check if it's a clickable header/title (not a plain <a>)
          const isClickable = element.tagName === 'DIV' || element.tagName === 'BUTTON' ||
                             element.getAttribute('role') === 'button' ||
                             window.getComputedStyle(element).cursor === 'pointer';

          if (isClickable) {
            const text = (element.textContent?.trim() || '').replace(/\s+/g, ' ');
            // 🔥 Skip dropdown-like text patterns
            if (text && dropdownExcludePatterns.some(p => p.test(text))) continue;
            // 🔥 Skip "collapse/hide" buttons (already expanded state)
            if (text && isCollapseButton(text)) {
              console.error(`[detectAccordions] Strategy 2: Skipping collapse button: "${text}"`);
              continue;
            }
            if (text && text.length > 3 && text.length < 50) {
              if (!elements.some(e => e.text === text)) {
                console.error(`[detectAccordions] Strategy 2: Found valid expandable item: "${text}"`);
                elements.push({
                  type: 'accordion',
                  text,
                  action: 'click',
                });
              }
            }
          }
        }

        console.error(`[detectAccordions] Strategy 2: Found ${elements.length} total elements`);

        // 🔥 Strategy 3: Look for toggle icons (▶, ▼, >, arrows) in main content area
        // Focus on table rows or list items that might be room types
        const mainContent = document.querySelector('main, [role="main"], .content, .main-content') || document.body;
        const rowsWithArrows = mainContent.querySelectorAll('tr, li, [class*="row"], [class*="item"]');
        console.error(`[detectAccordions] Strategy 3: Found ${rowsWithArrows.length} potential rows/items`);

        for (const row of rowsWithArrows) {
          // Skip if in navigation / header
          const isInNav = row.closest(
            'nav, aside, header, [class*="sidebar"], [class*="menu"], [class*="header"], [class*="topbar"], [class*="navbar"], [role="navigation"]'
          );
          if (isInNav) continue;

          // 🔥 Skip rows that are themselves or contain only links
          if (row.tagName === 'A' && (row as HTMLAnchorElement).href) continue;

          const text = (row.textContent?.trim() || '').replace(/\s+/g, ' ');
          const hasArrow = text.includes('▶') || text.includes('▼') || text.includes('›') || text.includes('‹');

          if (hasArrow && text.length > 3 && text.length < 100) {
            const itemNameMatch = text.match(/^([^▶▼›‹]+)/);
            const itemName = itemNameMatch ? itemNameMatch[1].trim() : text;

            // 🔥 Skip "collapse/hide" buttons (already expanded state)
            if (itemName && isCollapseButton(itemName)) {
              console.error(`[detectAccordions] Strategy 3: Skipping collapse button: "${itemName}"`);
              continue;
            }

            if (itemName && itemName.length > 2 && itemName.length < 50 && !elements.some(e => e.text === itemName)) {
              console.error(`[detectAccordions] Strategy 3: Found item with arrow: "${itemName}"`);
              elements.push({
                type: 'accordion',
                text: itemName,
                action: 'click',
              });
            }
          }
        }

        console.error(`[detectAccordions] Total found: ${elements.length} expandable elements`);

        return elements;
      });
    }


  /**
   * Detect pagination
   */
  async detectPagination(): Promise<ExpandableElement[]> {
    const page = this.browserController.getPage();
    if (!page) {
      return [];
    }

    return await page.evaluate(() => {
      const elements: ExpandableElement[] = [];
      const keywords = ['next', 'next page', '下一页', '›', '»'];

      const links = document.querySelectorAll('a, button');
      
      for (const link of links) {
        const text = link.textContent?.toLowerCase().trim() || '';
        const ariaLabel = link.getAttribute('aria-label')?.toLowerCase() || '';
        
        for (const keyword of keywords) {
          if (text.includes(keyword) || ariaLabel.includes(keyword)) {
            elements.push({
              type: 'pagination',
              text: link.textContent?.trim() || 'Next',
              action: 'click',
            });
            break;
          }
        }
      }

      return elements;
    });
  }

  /**
   * Detect infinite scroll
   */
  async detectInfiniteScroll(): Promise<ExpandableElement[]> {
    const page = this.browserController.getPage();
    if (!page) {
      return [];
    }

    const hasInfiniteScroll = await page.evaluate(() => {
      // Check if page height increases after scrolling
      const initialHeight = document.body.scrollHeight;
      window.scrollTo(0, document.body.scrollHeight);
      
      return new Promise<boolean>((resolve) => {
        setTimeout(() => {
          const newHeight = document.body.scrollHeight;
          resolve(newHeight > initialHeight);
        }, 1000);
      });
    });

    if (hasInfiniteScroll) {
      return [{
        type: 'infinite_scroll',
        text: 'Scroll to load more',
        action: 'scroll',
      }];
    }

    return [];
  }
}
