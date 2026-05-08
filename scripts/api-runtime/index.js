/**
 * api-runtime - API脚本执行运行时库
 *
 * 为Agent生成的API脚本提供内置反反爬策略的HTTP请求能力。
 * 仅使用 Node.js 内置模块（http, https, url）。
 *
 * 反反爬策略：
 * - 同域名请求间隔 >= 500ms + 随机抖动(0-500ms)
 * - 同域名并发请求数 <= 2
 * - 429/503 状态码自动重试，指数退避（1s, 2s, 4s，最多3次）
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');
const fs = require('fs');
const path = require('path');

/**
 * 清理 URL 中的签名/反爬参数，只保留业务参数
 * 这些签名参数是动态生成的，硬编码会过期
 */
function cleanUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    // 需要移除的签名/反爬参数
    const signParams = ['mtgsig', 'csecplatform', 'csecversion', 'yodaReady', '_token', 'sign', 'timestamp', 'nonce'];
    for (const param of signParams) {
      parsed.searchParams.delete(param);
    }
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

class APIRuntime {
  constructor() {
    /** @type {Map<string, number>} domain -> last request timestamp */
    this._domainLastRequestTime = new Map();
    /** @type {Map<string, number>} domain -> active concurrent request count */
    this._domainActiveCount = new Map();

    /** Minimum interval between same-domain requests (ms) */
    this.MIN_INTERVAL = 500;
    /** Maximum random jitter added on top of MIN_INTERVAL (ms) */
    this.MAX_JITTER = 500;
    /** Maximum concurrent requests per domain */
    this.MAX_CONCURRENCY = 2;
    /** Maximum retry attempts for 429/503 */
    this.MAX_RETRIES = 3;
    /** Concurrency wait poll interval (ms) */
    this.CONCURRENCY_POLL_INTERVAL = 100;
  }

  /**
   * Extract domain (hostname) from a URL string.
   * @param {string} url
   * @returns {string}
   */
  _getDomain(url) {
    try {
      const parsed = new URL(url);
      return parsed.hostname;
    } catch {
      return 'unknown';
    }
  }

  /**
   * Sleep for a given number of milliseconds.
   * @param {number} ms
   * @returns {Promise<void>}
   */
  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Wait until the rate limit interval has passed for the given domain.
   * Enforces >= 500ms + random jitter between same-domain requests.
   * @param {string} domain
   * @returns {Promise<void>}
   */
  async _waitForRateLimit(domain) {
    const lastTime = this._domainLastRequestTime.get(domain);
    if (lastTime !== undefined) {
      const elapsed = Date.now() - lastTime;
      const jitter = Math.floor(Math.random() * this.MAX_JITTER);
      const requiredDelay = this.MIN_INTERVAL + jitter;
      if (elapsed < requiredDelay) {
        await this._sleep(requiredDelay - elapsed);
      }
    }
  }

  /**
   * Wait until a concurrency slot is available for the given domain.
   * Max 2 concurrent requests per domain.
   * @param {string} domain
   * @returns {Promise<void>}
   */
  async _waitForConcurrencySlot(domain) {
    while ((this._domainActiveCount.get(domain) || 0) >= this.MAX_CONCURRENCY) {
      await this._sleep(this.CONCURRENCY_POLL_INTERVAL);
    }
  }

  /**
   * Increment the active request count for a domain.
   * @param {string} domain
   */
  _acquireConcurrencySlot(domain) {
    const current = this._domainActiveCount.get(domain) || 0;
    this._domainActiveCount.set(domain, current + 1);
  }

  /**
   * Decrement the active request count for a domain.
   * @param {string} domain
   */
  _releaseConcurrencySlot(domain) {
    const current = this._domainActiveCount.get(domain) || 0;
    this._domainActiveCount.set(domain, Math.max(0, current - 1));
  }

  /**
   * Perform a single HTTP request using Node.js built-in http/https modules.
   * Automatically follows 301/302/303/307/308 redirects up to maxRedirects hops.
   * @param {string} url
   * @param {object} options - { method?, headers?, body?, timeout?, maxRedirects? }
   * @returns {Promise<{ ok: boolean, status: number, data: any, headers: Record<string, string> }>}
   */
  _doRequest(url, options = {}, _redirectCount = 0) {
    const maxRedirects = options.maxRedirects ?? 5;
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const transport = parsed.protocol === 'https:' ? https : http;

      const reqOptions = {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: (options.method || 'GET').toUpperCase(),
        headers: { ...options.headers },
        timeout: options.timeout || 30000,
      };

      // Update Host header for redirected requests
      if (options.headers) {
        reqOptions.headers['Host'] = parsed.hostname;
      }

      const req = transport.request(reqOptions, (res) => {
        // Handle redirects
        const isRedirect = [301, 302, 303, 307, 308].includes(res.statusCode);
        if (isRedirect && res.headers.location && _redirectCount < maxRedirects) {
          // Consume the response body to free the socket
          res.resume();
          const redirectUrl = new URL(res.headers.location, url).toString();
          // 301/302/303 change method to GET (per HTTP spec), 307/308 preserve method
          const redirectOptions = { ...options };
          if ([301, 302, 303].includes(res.statusCode)) {
            redirectOptions.method = 'GET';
            delete redirectOptions.body;
          }
          process.stderr.write(`[api-runtime] Redirect ${res.statusCode} → ${redirectUrl.substring(0, 120)}\n`);
          resolve(this._doRequest(redirectUrl, redirectOptions, _redirectCount + 1));
          return;
        }

        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const rawBody = Buffer.concat(chunks).toString('utf-8');
          let data;
          try {
            data = JSON.parse(rawBody);
          } catch {
            data = rawBody;
          }

          const responseHeaders = {};
          for (const [key, value] of Object.entries(res.headers)) {
            responseHeaders[key] = Array.isArray(value) ? value.join(', ') : value;
          }

          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            data,
            headers: responseHeaders,
          });
        });
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      req.on('error', (err) => {
        reject(err);
      });

      if (options.body) {
        req.write(options.body);
      }
      req.end();
    });
  }

  /**
   * Make an HTTP request with built-in rate limiting, concurrency control,
   * auto-retry for 429/503, and cookie injection from BROWSER_COOKIES env var.
   *
   * @param {string} url - The request URL
   * @param {object} [options] - { method?, headers?, body?, timeout? }
   * @returns {Promise<{ ok: boolean, status: number, data: any, headers: Record<string, string> }>}
   */
  async fetch(url, options = {}) {
    const domain = this._getDomain(url);

    // Auto-inject cookies from BROWSER_COOKIES env var
    const cookies = this.getCookies();
    if (cookies) {
      options.headers = options.headers || {};
      if (!options.headers['Cookie'] && !options.headers['cookie']) {
        options.headers['Cookie'] = cookies;
      }
    }

    // Wait for concurrency slot
    await this._waitForConcurrencySlot(domain);
    this._acquireConcurrencySlot(domain);

    try {
      // Wait for rate limit
      await this._waitForRateLimit(domain);

      let lastResult;
      for (let attempt = 0; attempt <= this.MAX_RETRIES; attempt++) {
        // Record request time BEFORE making the request
        this._domainLastRequestTime.set(domain, Date.now());

        lastResult = await this._doRequest(url, options);

        // Only retry on 429 (Too Many Requests) and 503 (Service Unavailable)
        if ((lastResult.status === 429 || lastResult.status === 503) && attempt < this.MAX_RETRIES) {
          // Exponential backoff: 1s, 2s, 4s
          const backoffMs = Math.pow(2, attempt) * 1000;
          await this._sleep(backoffMs);
          continue;
        }

        return lastResult;
      }

      return lastResult;
    } finally {
      this._releaseConcurrencySlot(domain);
    }
  }

  /**
   * Get cookies from the BROWSER_COOKIES environment variable.
   * @returns {string} Cookie string or empty string
   */
  getCookies() {
    return process.env.BROWSER_COOKIES || '';
  }

  /**
   * Get default request headers.
   * @returns {Record<string, string>}
   */
  getHeaders() {
    return {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Connection': 'keep-alive',
    };
  }

  /**
   * Output success data to stdout in standardized JSON format.
   * Also saves a copy to data/api-results/ for inspection.
   * @param {any} data
   */
  output(data) {
    const cleaned = this._decodeHtmlEntities(data);
    const result = { success: true, data: cleaned };
    process.stdout.write(JSON.stringify(result) + '\n');
    this._saveResultFile(result);
  }

  /**
   * Output error to stdout in standardized JSON format.
   * Also saves a copy to data/api-results/ for inspection.
   * @param {string} code - Error code
   * @param {string} message - Error message
   */
  outputError(code, message) {
    const result = { success: false, error: { code, message } };
    process.stdout.write(JSON.stringify(result) + '\n');
    this._saveResultFile(result);
  }

  /**
   * Recursively decode HTML entities in all string values.
   * Handles &#NNNN; (decimal), &#xHHHH; (hex), and common named entities.
   * @param {any} obj
   * @returns {any}
   */
  _decodeHtmlEntities(obj) {
    if (typeof obj === 'string') {
      return obj
        .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
        .replace(/&nbsp;/g, ' ');
    }
    if (Array.isArray(obj)) {
      return obj.map(item => this._decodeHtmlEntities(item));
    }
    if (obj && typeof obj === 'object') {
      const decoded = {};
      for (const [k, v] of Object.entries(obj)) {
        decoded[k] = this._decodeHtmlEntities(v);
      }
      return decoded;
    }
    return obj;
  }

  /**
   * Save result to data/api-results/{skillName}-{timestamp}.json
   * @param {any} result
   */
  _saveResultFile(result) {
    try {
      const skillName = process.env.SKILL_NAME || 'unknown';
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const dir = process.env.DATA_DIR
        ? path.join(process.env.DATA_DIR, 'api-results')
        : path.join(process.cwd(), 'data', 'api-results');
      fs.mkdirSync(dir, { recursive: true });
      const filePath = path.join(dir, `${skillName}-${timestamp}.json`);
      fs.writeFileSync(filePath, JSON.stringify(result, null, 2), 'utf-8');
      process.stderr.write(`[api-runtime] Result saved to: ${filePath}\n`);
    } catch (e) {
      process.stderr.write(`[api-runtime] Failed to save result file: ${e.message}\n`);
    }
  }
}

module.exports = { APIRuntime, cleanUrl };
