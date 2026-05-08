/**
 * DOM Extractor
 * Comprehensive DOM content extraction — mirrors the reference project's page_extractor.py
 * Handles block-level elements, shadow DOM, aria-* attributes, data-* attributes, tables, selects.
 */

import { Page, Frame } from 'playwright';
import { DOMContent, TableData, SemanticAttribute, SelectOption } from './types';

export interface IFrameInfo {
  src: string;
  id?: string;
  name?: string;
  title?: string;
  width?: number;
  height?: number;
  isVisible: boolean;
}

export class DOMExtractor {
  private page: Page;
  private maxSize: number;

  constructor(page: Page, maxSize: number = 102400) {
    this.page = page;
    this.maxSize = maxSize;
  }

  /**
   * Extract all DOM content from every frame
   */
  async extractContent(): Promise<DOMContent> {
    const content: DOMContent = {
      text: [],
      tables: [],
      dataAttributes: [],
      semanticAttributes: [],
      selectOptions: [],
    };

    const frames = this.page.frames();
    for (const frame of frames) {
      try {
        const frameContent = await this.extractFromFrame(frame);
        this.mergeContent(content, frameContent);
      } catch {
        continue;
      }
    }

    content.text = this.deduplicate(content.text);
    content.text = this.truncateIfNeeded(content.text);

    return content;
  }

  /**
   * Extract content from a single frame using a comprehensive JS walker.
   * Mirrors hotel-ai-agent/scripts/web_scraper/page_extractor.py.
   */
  private async extractFromFrame(frame: Frame): Promise<Partial<DOMContent>> {
    const content: Partial<DOMContent> = {
      text: [],
      tables: [],
      dataAttributes: [],
      semanticAttributes: [],
      selectOptions: [],
    };

    try {
      const extracted = await frame.evaluate(() => {
        const result: {
          text: string[];
          tables: string[][];
          dataAttrs: Record<string, string>[];
        } = { text: [], tables: [], dataAttrs: [] };

        // ========== 1. Block-level text extraction ==========
        const textBlocks: string[] = [];
        const seen = new Set<string>();
        const blockTags = new Set([
          'DIV','P','LI','TD','TH','H1','H2','H3','H4','H5','H6',
          'SPAN','A','LABEL','DT','DD','SECTION','ARTICLE','HEADER',
          'FOOTER','NAV','ASIDE','MAIN','FIGCAPTION','SUMMARY','DETAILS'
        ]);

        function walkNode(root: Node) {
          if (!root) return;
          const walker = document.createTreeWalker(
            root as Element,
            NodeFilter.SHOW_ELEMENT,
            null
          );
          let node: Element | null;
          while ((node = walker.nextNode() as Element)) {
            // Penetrate shadow DOM
            if ((node as any).shadowRoot) {
              walkNode((node as any).shadowRoot);
            }

            if (!blockTags.has(node.tagName)) continue;

            // Direct text children only (avoid double-counting parent text)
            let directText = '';
            for (const child of node.childNodes) {
              if (child.nodeType === Node.TEXT_NODE) {
                directText += (child.textContent || '').trim() + ' ';
              }
            }
            directText = directText.trim();

            if (directText && directText.length > 0 && directText.length < 500) {
              // ✅ 修复 Bug2：短文本（价格、数量、库存等 ≤30字符）不参与去重
              // 原逻辑用纯文本做 key，导致价格相同的两个房型第二条被过滤掉
              if (directText.length <= 30 || !seen.has(directText)) {
                seen.add(directText);
                textBlocks.push(directText);
              }
            }

            // aria-label / title / alt semantic text
            const semanticValues = [
              node.getAttribute('title'),
              node.getAttribute('alt'),
              node.getAttribute('aria-label'),
              node.getAttribute('aria-valuetext'),
              node.getAttribute('aria-valuenow'),
            ].filter(Boolean) as string[];

            for (const sv of semanticValues) {
              const trimmed = sv.trim();
              if (trimmed && !seen.has(trimmed)) {
                seen.add(trimmed);
                textBlocks.push(`[${trimmed}]`);
              }
            }
          }
        }

        walkNode(document.body || document.documentElement);

        // Select options
        const selects = document.querySelectorAll('select');
        for (const sel of selects) {
          const optTexts: string[] = [];
          const label = sel.getAttribute('aria-label') || sel.getAttribute('name') || '';
          for (const opt of sel.options) {
            if (opt.text && opt.text.trim()) {
              optTexts.push(opt.selected ? `[${opt.text.trim()}✓]` : opt.text.trim());
            }
          }
          if (optTexts.length > 0) {
            const line = (label ? label + ': ' : '') + optTexts.join(' / ');
            if (!seen.has(line)) {
              seen.add(line);
              textBlocks.push(line);
            }
          }
        }

        result.text = textBlocks;

        // ========== 2. Table extraction ==========
        function extractTables(root: Document | ShadowRoot) {
          const tableEls = root.querySelectorAll('table');
          for (const table of tableEls) {
            const rows: string[][] = [];
            for (const tr of table.querySelectorAll('tr')) {
              const cells: string[] = [];
              for (const cell of tr.querySelectorAll('td, th')) {
                cells.push((cell as HTMLElement).innerText.trim());
              }
              if (cells.length > 0) rows.push(cells);
            }
            if (rows.length > 0) result.tables.push(...rows);
          }
        }
        extractTables(document);
        document.querySelectorAll('*').forEach(el => {
          if ((el as any).shadowRoot) extractTables((el as any).shadowRoot);
        });

        // ========== 3. data-* attribute extraction ==========
        function extractDataAttrs(root: Document | ShadowRoot) {
          for (const el of root.querySelectorAll('*')) {
            const attrs: Record<string, string> = {};
            let hasData = false;
            for (const attr of el.attributes) {
              if (attr.name.startsWith('data-') && attr.value) {
                // Skip framework internals
                if (/^data-(v-|react|ng-|_)/.test(attr.name)) continue;
                attrs[attr.name] = attr.value.substring(0, 500);
                hasData = true;
              }
            }
            if (hasData) {
              attrs['_text'] = ((el as HTMLElement).innerText || '').trim().substring(0, 200);
              const aria = el.getAttribute('aria-label');
              if (aria) attrs['_aria'] = aria;
              result.dataAttrs.push(attrs);
            }
          }
        }
        extractDataAttrs(document);
        document.querySelectorAll('*').forEach(el => {
          if ((el as any).shadowRoot) extractDataAttrs((el as any).shadowRoot);
        });

        // Cap data attrs
        if (result.dataAttrs.length > 200) {
          result.dataAttrs = result.dataAttrs.slice(0, 200);
        }

        return result;
      });

      content.text = extracted.text;
      // Tables come back as flat string[][] rows; wrap into TableData[]
      content.tables = extracted.tables.length > 0
        ? [{ headers: [], rows: extracted.tables }]
        : [];
      content.dataAttributes = extracted.dataAttrs;

    } catch {
      // Frame inaccessible, skip
    }

    return content;
  }

  private mergeContent(target: DOMContent, source: Partial<DOMContent>): void {
    if (source.text) target.text.push(...source.text);
    if (source.tables) target.tables.push(...source.tables);
    if (source.dataAttributes) target.dataAttributes.push(...source.dataAttributes);
    if (source.semanticAttributes) target.semanticAttributes.push(...(source.semanticAttributes as SemanticAttribute[]));
    if (source.selectOptions) target.selectOptions.push(...(source.selectOptions as SelectOption[]));
  }

  private deduplicate(arr: string[]): string[] {
    return [...new Set(arr)];
  }

  private truncateIfNeeded(texts: string[]): string[] {
    let total = 0;
    const result: string[] = [];
    for (const t of texts) {
      if (total + t.length > this.maxSize) break;
      result.push(t);
      total += t.length + 1;
    }
    return result;
  }

  getTextContent(content: DOMContent): string {
    return content.text.join('\n');
  }

  getContentSize(content: DOMContent): number {
    return JSON.stringify(content).length;
  }
}
