/**
 * Network Monitor (Enhanced)
 * Intercepts and captures network requests with full request/response details.
 * Captures request headers, request body, response headers, status code,
 * content type, and response size for API discovery.
 */

import { createHash } from 'crypto';
import { Page, Response } from 'playwright-core';
import { EnhancedCapturedRequest, APICandidate } from './types';

export class NetworkMonitor {
  private page: Page;
  private capturedData: EnhancedCapturedRequest[] = [];
  private isMonitoring: boolean = false;

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * Start monitoring network requests
   */
  async startMonitoring(): Promise<void> {
    if (this.isMonitoring) {
      return;
    }

    this.capturedData = [];
    this.isMonitoring = true;

    // Listen to response events
    this.page.on('response', async (response: Response) => {
      try {
        if (!this.isMonitoring) return;
        const url = response.url();
        if (!this.shouldCapture(url)) return;

        const responseHeaders = response.headers();
        const contentType = responseHeaders['content-type'] || '';
        const statusCode = response.status();
        const requestHeaders = response.request().headers();
        const requestBody = response.request().postData() ?? undefined;
        const method = response.request().method();

        if (this.isJSONContentType(contentType)) {
          // JSON response — capture as before
          const data = await response.json();
          const responseSize = JSON.stringify(data).length;
          this.capturedData.push({
            url, method, requestHeaders, requestBody,
            response: data, responseHeaders, statusCode,
            contentType, responseSize, timestamp: Date.now(),
          });
        } else if (this.isHTMLContentType(contentType) && method === 'GET' && this.isDocumentRequest(response)) {
          // HTML document response — extract embedded structured data
          const html = await response.text();
          console.error(`[NetworkMonitor] HTML document captured: ${url.substring(0, 120)} (${html.length} chars)`);
          const embedded = this.extractEmbeddedData(html);
          console.error(`[NetworkMonitor] extractEmbeddedData: ${JSON.stringify(Object.keys(embedded))}`);
          // Pure regex DOM parsing — no page.evaluate() to avoid navigation-time failures
          const domData = this.extractDomStructure(html);
          console.error(`[NetworkMonitor] extractDomStructure: ${JSON.stringify(Object.keys(domData))}`);
          const combined = { ...embedded, ...domData };
          const combinedKeys = Object.keys(combined);
          if (combinedKeys.length > 0) {
            const responseSize = JSON.stringify(combined).length;
            console.error(`[NetworkMonitor] HTML extraction result: ${combinedKeys.join(',')} (${responseSize} bytes)`);
            this.capturedData.push({
              url, method, requestHeaders, requestBody,
              response: combined, responseHeaders, statusCode,
              contentType: 'text/html+extracted-json',
              responseSize, timestamp: Date.now(),
            });
          } else {
            // Even with no extraction, keep a minimal entry so Agent knows this HTML page exists
            console.error(`[NetworkMonitor] HTML extraction empty, keeping minimal entry for: ${url.substring(0, 120)}`);
            this.capturedData.push({
              url, method, requestHeaders, requestBody,
              response: { _htmlPage: true, htmlSize: html.length, note: 'No structured data extracted. Agent can re-fetch and parse this URL.' },
              responseHeaders, statusCode,
              contentType: 'text/html+extracted-json',
              responseSize: html.length,
              timestamp: Date.now(),
            });
          }
        }
      } catch (error) {
        // Log but don't crash — response might not be parseable or already consumed
        const url = (() => { try { return response.url().substring(0, 80); } catch { return '?'; } })();
        console.error(`[NetworkMonitor] Response capture error for ${url}:`, (error as Error).message || error);
      }
    });
  }

  /**
   * Stop monitoring network requests
   */
  async stopMonitoring(): Promise<void> {
    this.isMonitoring = false;
    // Note: Playwright doesn't have a direct way to remove event listeners
    // The listener will remain but won't capture data after isMonitoring is false
  }

  /**
   * Get captured data
   */
  getCapturedData(): EnhancedCapturedRequest[] {
    return [...this.capturedData];
  }

  /**
   * Clear captured data
   */
  clearCapturedData(): void {
    this.capturedData = [];
  }

  /**
   * Restore previously captured data (used to preserve navigation-phase captures after reload)
   */
  restoreCapturedData(data: EnhancedCapturedRequest[]): void {
    this.capturedData.push(...data);
  }

  /**
   * Check if content type is JSON
   */
  private isJSONContentType(contentType: string): boolean {
    return contentType.includes('application/json') ||
           contentType.includes('application/ld+json') ||
           contentType.includes('text/json');
  }

  /**
   * Check if content type is HTML
   */
  private isHTMLContentType(contentType: string): boolean {
    return contentType.includes('text/html');
  }

  /**
   * Check if this is a top-level document request (not a sub-resource)
   */
  private isDocumentRequest(response: Response): boolean {
    const resourceType = response.request().resourceType();
    return resourceType === 'document';
  }

  /**
   * Extract structured content from HTML using pure regex/string parsing.
   * No page.evaluate() — safe to call during page navigation.
   */
  private extractDomStructure(html: string): any {
    const result: any = {};

    try {
      // 1. Extract page title
      const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      if (titleMatch) {
        const title = this.stripHtmlTags(titleMatch[1]).trim();
        if (title) result.pageTitle = title;
      }

      // 2. Extract meta description
      const metaDescMatch = html.match(/<meta[^>]*name\s*=\s*["']description["'][^>]*content\s*=\s*["']([\s\S]*?)["'][^>]*>/i)
        || html.match(/<meta[^>]*content\s*=\s*["']([\s\S]*?)["'][^>]*name\s*=\s*["']description["'][^>]*>/i);
      if (metaDescMatch) {
        const desc = metaDescMatch[1].trim();
        if (desc) result.metaDescription = desc;
      }

      // 3. Extract tables → structured arrays (regex-based)
      const tableRegex = /<table[\s\S]*?<\/table>/gi;
      const tables: any[] = [];
      let tableMatch;
      let tableCount = 0;
      while ((tableMatch = tableRegex.exec(html)) !== null && tableCount < 5) {
        const tableHtml = tableMatch[0];
        // Skip tiny tables (navigation menus etc.)
        if (tableHtml.length < 100) continue;

        const headers: string[] = [];
        // Extract headers from thead or first tr with th
        const theadMatch = tableHtml.match(/<thead[\s\S]*?<\/thead>/i);
        const headerSource = theadMatch ? theadMatch[0] : tableHtml;
        const thRegex = /<th[^>]*>([\s\S]*?)<\/th>/gi;
        let thMatch;
        while ((thMatch = thRegex.exec(headerSource)) !== null) {
          headers.push(this.stripHtmlTags(thMatch[1]).trim().replace(/\s+/g, ' '));
        }

        // Extract rows
        const rows: any[] = [];
        const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
        let trMatch;
        let rowCount = 0;
        while ((trMatch = trRegex.exec(tableHtml)) !== null && rowCount < 20) {
          const trContent = trMatch[1];
          const cells: string[] = [];
          const tdRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
          let tdMatch;
          while ((tdMatch = tdRegex.exec(trContent)) !== null) {
            cells.push(this.stripHtmlTags(tdMatch[1]).trim().replace(/\s+/g, ' '));
          }
          if (cells.length > 0 && cells.some(c => c.length > 0)) {
            if (headers.length > 0 && headers.length === cells.length) {
              const row: any = {};
              headers.forEach((h, i) => { row[h || `col${i}`] = cells[i]; });
              rows.push(row);
            } else {
              rows.push(cells);
            }
            rowCount++;
          }
        }
        if (rows.length > 0) {
          tables.push({ headers, rows, rowCount: rows.length });
          tableCount++;
        }
      }
      if (tables.length > 0) result.tables = tables;

      // 4. Extract Schema.org microdata (itemtype/itemprop attributes)
      const itemTypeRegex = /<[^>]*itemtype\s*=\s*["'][^"']*schema\.org[^"']*["'][^>]*>([\s\S]*?)(?=<[^>]*itemtype\s*=\s*["']|$)/gi;
      const schemaElements: any[] = [];
      let itemMatch;
      while ((itemMatch = itemTypeRegex.exec(html)) !== null && schemaElements.length < 10) {
        const item: any = {};
        const typeMatch = itemMatch[0].match(/itemtype\s*=\s*["']([^"']+)["']/i);
        if (typeMatch) item.type = typeMatch[1];

        const itemPropRegex = /<[^>]*itemprop\s*=\s*["']([^"']+)["'][^>]*(?:content\s*=\s*["']([^"']*?)["'])?[^>]*>([\s\S]*?)<\/[^>]+>/gi;
        let propMatch;
        while ((propMatch = itemPropRegex.exec(itemMatch[0])) !== null) {
          const name = propMatch[1];
          const content = propMatch[2] || this.stripHtmlTags(propMatch[3]).trim().replace(/\s+/g, ' ');
          if (name && content) item[name] = content.substring(0, 200);
        }
        // Also match self-closing itemprop tags: <meta itemprop="x" content="y"/>
        const selfClosingPropRegex = /<[^>]*itemprop\s*=\s*["']([^"']+)["'][^>]*content\s*=\s*["']([^"']*?)["'][^>]*\/?>/gi;
        let scMatch;
        while ((scMatch = selfClosingPropRegex.exec(itemMatch[0])) !== null) {
          if (scMatch[1] && scMatch[2] && !item[scMatch[1]]) {
            item[scMatch[1]] = scMatch[2].substring(0, 200);
          }
        }

        if (Object.keys(item).length > 1) {
          schemaElements.push(item);
        }
      }
      if (schemaElements.length > 0) result.schemaElements = schemaElements;

      // 5. Extract price-like elements (class/data-attribute based)
      const priceRegex = /<[^>]*(?:class\s*=\s*["'][^"']*(?:price|Price|rate|Rate|cost|Cost)[^"']*["']|data-(?:price|rate)\s*=\s*["']([^"']*?)["'])[^>]*>([\s\S]*?)<\/[^>]+>/gi;
      const prices: any[] = [];
      const seenPrices = new Set<string>();
      let priceMatch;
      while ((priceMatch = priceRegex.exec(html)) !== null && prices.length < 30) {
        const text = this.stripHtmlTags(priceMatch[2] || '').trim().replace(/\s+/g, ' ');
        if (text.length > 0 && text.length < 200 && !seenPrices.has(text)) {
          seenPrices.add(text);
          const item: any = { text };
          if (priceMatch[1]) item.value = priceMatch[1];
          prices.push(item);
        }
      }
      if (prices.length > 0) result.priceElements = prices;

      // 6. Extract data-testid elements (common in React apps like Booking.com)
      const testIdRegex = /<[^>]*data-testid\s*=\s*["']([^"']*(?:price|room|rate|name|title)[^"']*)["'][^>]*>([\s\S]*?)<\/[^>]+>/gi;
      const testIdElements: any[] = [];
      let tidMatch;
      while ((tidMatch = testIdRegex.exec(html)) !== null && testIdElements.length < 30) {
        const text = this.stripHtmlTags(tidMatch[2] || '').trim().replace(/\s+/g, ' ');
        if (text.length > 0 && text.length < 300) {
          testIdElements.push({ testId: tidMatch[1], text });
        }
      }
      if (testIdElements.length > 0) result.dataTestIdElements = testIdElements;

    } catch (error) {
      console.error('[NetworkMonitor] DOM structure extraction failed:', error);
    }

    return result;
  }

  /**
   * Strip HTML tags from a string, returning plain text.
   */
  private stripHtmlTags(html: string): string {
    return html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
  }

  /**
   * Extract embedded structured data from HTML.
   * Looks for JSON-LD scripts and large inline JSON objects in <script> tags.
   */
  private extractEmbeddedData(html: string): any {
    const result: any = {};

    // 1. Extract JSON-LD (<script type="application/ld+json">)
    const jsonLdRegex = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    const jsonLdBlocks: any[] = [];
    let match;
    while ((match = jsonLdRegex.exec(html)) !== null) {
      try {
        const parsed = JSON.parse(match[1].trim());
        jsonLdBlocks.push(parsed);
      } catch { /* skip invalid JSON */ }
    }
    if (jsonLdBlocks.length > 0) {
      result.jsonLd = jsonLdBlocks.length === 1 ? jsonLdBlocks[0] : jsonLdBlocks;
      console.error(`[NetworkMonitor] Found ${jsonLdBlocks.length} JSON-LD block(s)`);
    }

    // 2. Extract large inline JSON assignments in <script> tags
    // Patterns like: window.__DATA__ = {...}; or var config = {...};
    const scriptRegex = /<script(?![^>]* src\s*=)[^>]*>([\s\S]*?)<\/script>/gi;
    const inlineData: Record<string, any> = {};
    let inlineJsHints: any[] | undefined;
    while ((match = scriptRegex.exec(html)) !== null) {
      const scriptContent = match[1].trim();
      if (!scriptContent || scriptContent.length < 200) continue;

      // Look for JSON assignments: varName = { ... } or varName = [ ... ]
      const assignRegex = /(?:window\.|var\s+|let\s+|const\s+|this\.)?([\w.$]+)\s*=\s*(?=[\{\[])/g;
      let assignMatch;
      while ((assignMatch = assignRegex.exec(scriptContent)) !== null) {
        const varName = assignMatch[1];
        const startIdx = assignMatch.index + assignMatch[0].length;
        const jsonStr = this.extractBalancedBraces(scriptContent, startIdx);
        if (!jsonStr || jsonStr.length < 200) continue;
        try {
          const parsed = JSON.parse(jsonStr);
          const size = JSON.stringify(parsed).length;
          if (size >= 500) {
            inlineData[varName] = parsed;
          }
        } catch {
          // JSON.parse failed — likely JS object literal (unquoted keys, comments, etc.)
          // Still record it as a hint so Agent knows this variable exists and can target it with regex
          if (jsonStr.length >= 1000) {
            // Extract key property names from the first 3000 chars to help Agent identify useful data
            const preview = jsonStr.substring(0, 3000);
            const keyNames: string[] = [];
            const seen = new Set<string>();
            // Match quoted or unquoted property keys in JS object literal
            const keyRegex = /(?:^|[,{\n])\s*["']?(\w{3,30})["']?\s*:/g;
            let keyMatch;
            while ((keyMatch = keyRegex.exec(preview)) !== null && keyNames.length < 20) {
              const k = keyMatch[1];
              if (!seen.has(k)) {
                seen.add(k);
                keyNames.push(k);
              }
            }
            if (!inlineJsHints) inlineJsHints = [];
            inlineJsHints.push({
              varName,
              size: jsonStr.length,
              isJsObject: true,
              note: 'JS object literal (not JSON). Use regex to extract specific properties.',
              keyNames: keyNames.length > 0 ? keyNames : undefined,
              preview: preview.replace(/\s+/g, ' ').substring(0, 500),
            });
          }
        }
      }
    }
    if (Object.keys(inlineData).length > 0) {
      result.inlineData = inlineData;
      console.error(`[NetworkMonitor] Found inline data vars: ${Object.keys(inlineData).join(', ')}`);
    }
    if (inlineJsHints && inlineJsHints.length > 0) {
      result.inlineJsHints = inlineJsHints;
      console.error(`[NetworkMonitor] Found JS object hints: ${inlineJsHints.map((h: any) => `${h.varName}(${h.size}B, keys: ${(h.keyNames || []).join(',')})`).join(', ')}`);
    }

    return result;
  }

  /**
   * Extract a balanced JSON object or array starting at the given index.
   * Handles nested braces/brackets correctly by counting depth.
   * Returns the matched string or null if not found.
   */
  private extractBalancedBraces(str: string, startIdx: number): string | null {
    if (startIdx >= str.length) return null;
    const open = str[startIdx];
    const close = open === '{' ? '}' : open === '[' ? ']' : null;
    if (!close) return null;

    let depth = 0;
    let inString = false;
    let escape = false;
    // Cap scanning at 2MB to avoid hanging on huge scripts
    const maxLen = Math.min(str.length, startIdx + 2 * 1024 * 1024);

    for (let i = startIdx; i < maxLen; i++) {
      const ch = str[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\' && inString) {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === open) depth++;
      else if (ch === close) {
        depth--;
        if (depth === 0) {
          return str.substring(startIdx, i + 1);
        }
      }
    }
    return null; // unbalanced
  }

  /**
   * Check if URL should be captured
   */
  private shouldCapture(url: string): boolean {
    if (!this.isMonitoring) {
      return false;
    }

    // Exclude static resources
    const staticExtensions = [
      '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.ico',
      '.css', '.js', '.woff', '.woff2', '.ttf', '.eot',
      '.mp4', '.webm', '.mp3', '.wav',
      '.pdf', '.zip', '.tar', '.gz'
    ];

    const urlLower = url.toLowerCase();
    for (const ext of staticExtensions) {
      // Check extension before query string
      const urlPath = urlLower.split('?')[0];
      if (urlPath.endsWith(ext)) {
        return false;
      }
    }

    // Always capture HTML documents (will be filtered by isDocumentRequest later)
    if (urlLower.includes('.html') || urlLower.includes('.htm') || !urlLower.split('?')[0].includes('.')) {
      return true;
    }

    // Include API-like URLs
    const apiPatterns = [
      '/api/',
      '/v1/',
      '/v2/',
      '/graphql',
      '/rest/',
      '/data/',
      '.json'
    ];

    for (const pattern of apiPatterns) {
      if (urlLower.includes(pattern)) {
        return true;
      }
    }

    // Include if looks like an API endpoint
    return urlLower.includes('api') ||
           urlLower.includes('ajax') ||
           urlLower.includes('fetch');
  }

  /**
   * Get filtered API candidates (first-layer technical filtering)
   * Applies deduplication, noise filtering, and size-based ranking
   */
  getAPICandidates(): APICandidate[] {
    const staticExtensions = [
      '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.ico',
      '.css', '.js', '.woff', '.woff2', '.ttf', '.eot',
      '.mp4', '.webm', '.mp3', '.wav',
      '.pdf', '.zip', '.tar', '.gz',
    ];

    const excludePatterns = ['/log', '/track', '/beacon', '/analytics', '/ad/', '/pixel', '/event-tracking'];

    // CDN/config patterns that are never real business APIs
    const cdnPatterns = [
      'aram-canary-config/',
      '/dyna/',
      '/dist/',
      '/use-guide/',
      '/mss_',
      'horn/v1/modules/',
    ];

    // URL path keywords indicating non-data utility endpoints
    const utilityPatterns = [
      '/check/',       // various checks (agreement, ab-test, etc.)
      '/expose',       // tracking exposure
      '/protocol/',    // protocol/agreement pages
      '/guidance/',    // user guidance
      '/getKpPhone',   // phone number utility
      '/basicinfo',    // basic config info
      '/getSourceCity', // city list utility
    ];

    const MAX_RESPONSE_SIZE = 10 * 1024 * 1024; // 10MB
    const MIN_RESPONSE_SIZE = 300; // 300B minimum - tiny responses are status checks, not data

    const filtered = this.capturedData
      .filter((req) => {
        const urlLower = req.url.toLowerCase();

        // Exclude static resources
        if (staticExtensions.some((ext) => urlLower.endsWith(ext))) return false;

        // Only keep json, xml, text/plain, or extracted-json-from-html content types
        const ct = req.contentType.toLowerCase();
        if (!ct.includes('json') && !ct.includes('xml') && !ct.includes('text/plain') && !ct.includes('extracted-json')) return false;

        // For HTML-extracted entries, no minimum size (even minimal info like URL + title is useful for Agent)
        // For API responses, apply minimum size filter to skip tiny status-check responses
        if (!ct.includes('extracted-json')) {
          if (req.responseSize < MIN_RESPONSE_SIZE || req.responseSize > MAX_RESPONSE_SIZE) return false;
        } else {
          if (req.responseSize > MAX_RESPONSE_SIZE) return false;
        }

        // Exclude tracking/analytics patterns
        if (excludePatterns.some((p) => urlLower.includes(p))) return false;

        // Exclude CDN/config patterns (static JSON files, not APIs)
        if (cdnPatterns.some((p) => urlLower.includes(p))) return false;

        // Exclude utility/non-data endpoints
        if (utilityPatterns.some((p) => urlLower.includes(p))) return false;

        return true;
      });

    // Deduplicate by URL path + request body hash (same URL with different params = different candidates)
    const deduped = new Map<string, EnhancedCapturedRequest>();
    for (const req of filtered) {
      try {
        const urlObj = new URL(req.url);
        const bodyHash = req.requestBody
          ? createHash('md5').update(req.requestBody).digest('hex').substring(0, 8)
          : 'nobody';
        const pathKey = `${req.method}:${urlObj.hostname}${urlObj.pathname}:${bodyHash}`;
        const existing = deduped.get(pathKey);
        if (!existing || req.responseSize > existing.responseSize) {
          deduped.set(pathKey, req);
        }
      } catch {
        deduped.set(req.url, req);
      }
    }

    // Sort by responseSize descending and cap at 25 candidates
    const sorted = Array.from(deduped.values())
      .sort((a, b) => b.responseSize - a.responseSize)
      .slice(0, 25);

    return sorted.map((req) => {
      // Strip noisy headers that waste LLM tokens and aren't needed for script generation
      const noisyHeaders = [
        'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform',
        'sec-fetch-dest', 'sec-fetch-mode', 'sec-fetch-site',
        'upgrade-insecure-requests', 'accept-encoding',
        'cookie', 'host', ':authority', ':method', ':path', ':scheme',
      ];
      const cleanHeaders: Record<string, string> = {};
      for (const [key, value] of Object.entries(req.requestHeaders)) {
        if (!noisyHeaders.includes(key.toLowerCase())) {
          cleanHeaders[key] = value;
        }
      }

      return {
        url: req.url,
        method: req.method,
        requestHeaders: cleanHeaders,
        requestBody: req.requestBody,
        responsePreview: JSON.stringify(req.response).substring(0, 500),
        responseSchema: this.generateSchema(req.response),
        responseSize: req.responseSize,
        contentType: req.contentType,
        statusCode: req.statusCode,
      };
    });
  }

  /**
   * Generate a structural schema of a response object.
   * Shows key names, types, array lengths, and sample values — enough for the Agent
   * to write correct data-access code without seeing the full response.
   */
  private generateSchema(obj: any, depth: number = 0, maxDepth: number = 4): string {
    if (depth > maxDepth) return '...';
    if (obj === null || obj === undefined) return String(obj);
    if (typeof obj === 'string') {
      return obj.length > 60 ? `string(${obj.length}) "${obj.substring(0, 50)}..."` : `"${obj}"`;
    }
    if (typeof obj === 'number' || typeof obj === 'boolean') return String(obj);
    if (Array.isArray(obj)) {
      if (obj.length === 0) return '[]';
      // Show schema of first element + array length
      return `Array(${obj.length}) [${this.generateSchema(obj[0], depth + 1, maxDepth)}]`;
    }
    if (typeof obj === 'object') {
      const keys = Object.keys(obj);
      if (keys.length === 0) return '{}';
      const indent = '  '.repeat(depth + 1);
      const entries = keys.slice(0, 20).map(k => {
        return `${indent}${k}: ${this.generateSchema(obj[k], depth + 1, maxDepth)}`;
      });
      if (keys.length > 20) entries.push(`${indent}...(${keys.length - 20} more keys)`);
      return `{\n${entries.join(',\n')}\n${'  '.repeat(depth)}}`;
    }
    return typeof obj;
  }

  /**
   * Get the full response object for a given URL
   */
  getFullResponse(url: string): any {
    const entry = this.capturedData.find((req) => req.url === url);
    return entry ? entry.response : null;
  }

  /**
   * Get monitoring status
   */
  isActive(): boolean {
    return this.isMonitoring;
  }

  /**
   * Get captured data count
   */
  getCapturedCount(): number {
    return this.capturedData.length;
  }
}
