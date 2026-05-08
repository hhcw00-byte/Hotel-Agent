import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { URL } from 'url';
import { getWritableBasePath } from '../path-resolver';
import type { QualityService } from './quality-service';
import type { QualityAttachmentUpload } from './quality-types';
import { renderQualitySubmitPage } from './quality-web-page';

const DEFAULT_PORT = 17890;
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_BODY_SIZE = 80 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.pdf']);
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'application/octet-stream',
]);

interface ParsedFile {
  fieldName: string;
  filename: string;
  contentType: string;
  data: Buffer;
}

interface ParsedMultipart {
  fields: Record<string, string>;
  files: ParsedFile[];
}

class HttpError extends Error {
  constructor(
    message: string,
    readonly statusCode: number
  ) {
    super(message);
  }
}

export class QualityWebServer {
  private server: http.Server | null = null;
  private lastError: string | null = null;

  constructor(
    private readonly getService: () => Promise<QualityService>,
    private readonly port = DEFAULT_PORT
  ) {}

  start(): void {
    if (this.server) return;

    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res).catch((error) => {
        console.error('[quality-web] request failed:', error);
        if (!res.headersSent) {
          sendJson(res, 500, { success: false, error: '服务暂不可用，请稍后重试' });
        } else {
          res.end();
        }
      });
    });

    this.server.on('error', (error: NodeJS.ErrnoException) => {
      this.lastError = error.code === 'EADDRINUSE'
        ? `端口 ${this.port} 已被占用`
        : error.message;
      console.error(`[quality-web] failed to start: ${this.lastError}`);
      this.server = null;
    });

    this.server.listen(this.port, '0.0.0.0', () => {
      this.lastError = null;
      console.log(`[quality-web] server started at http://0.0.0.0:${this.port}, LAN IP: ${getLanIpAddress()}`);
      // Windows 防火墙放行：允许局域网设备访问质检提交页面
      this.ensureFirewallRule();
    });
  }

  getSubmitLink(input: { taskId: string; submitToken: string }): { submitLink: string; lanIp: string; port: number } {
    if (this.lastError) {
      throw new Error(`局域网提交服务未启动：${this.lastError}`);
    }
    const taskId = requireText(input.taskId, '缺少 taskId');
    const submitToken = requireText(input.submitToken, '缺少 submitToken');
    const lanIp = getLanIpAddress();
    const submitLink = `http://${lanIp}:${this.port}/quality/submit?taskId=${encodeURIComponent(taskId)}&submitToken=${encodeURIComponent(submitToken)}`;
    return { submitLink, lanIp, port: this.port };
  }

  /**
   * Windows 防火墙：添加入站规则放行质检 HTTP 端口，让局域网设备能访问
   */
  private ensureFirewallRule(): void {
    if (process.platform !== 'win32') return;
    const ruleName = 'HotelAI Quality Web';
    const { execSync } = require('child_process');
    try {
      // 检查规则是否已存在
      execSync(`netsh advfirewall firewall show rule name="${ruleName}"`, { stdio: 'pipe' });
      console.log('[quality-web] Firewall rule already exists');
    } catch {
      // 不存在，创建
      try {
        execSync(
          `netsh advfirewall firewall add rule name="${ruleName}" dir=in action=allow protocol=TCP localport=${this.port}`,
          { stdio: 'pipe' }
        );
        console.log(`[quality-web] Firewall rule added for port ${this.port}`);
      } catch (e) {
        console.warn('[quality-web] Failed to add firewall rule (may need admin rights):', (e as Error).message);
      }
    }
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const requestUrl = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
    const pathname = decodePathname(requestUrl.pathname);

    if (req.method === 'GET' && pathname === '/quality/submit') {
      sendHtml(res, renderQualitySubmitPage());
      return;
    }

    if (req.method === 'GET' && pathname === '/api/quality/task') {
      await this.handleGetTask(requestUrl, res);
      return;
    }

    if (req.method === 'POST' && pathname === '/api/quality/submit') {
      await this.handleSubmit(req, res);
      return;
    }

    if (req.method === 'GET' && pathname.startsWith('/uploads/quality/')) {
      await serveQualityUpload(pathname, res);
      return;
    }

    sendJson(res, 404, { success: false, error: '资源不存在' });
  }

  private async handleGetTask(requestUrl: URL, res: http.ServerResponse): Promise<void> {
    const taskId = String(requestUrl.searchParams.get('taskId') || '').trim();
    const submitToken = String(requestUrl.searchParams.get('submitToken') || '').trim();
    if (!taskId || !submitToken) {
      sendJson(res, 400, { success: false, error: '缺少 taskId 或 submitToken' });
      return;
    }

    try {
      const service = await this.getService();
      const data = await service.getSubmitTask({ taskId, submitToken });
      sendJson(res, 200, {
        success: true,
        data: {
          task: data.task,
          items: data.items,
          alreadySubmitted: data.alreadySubmitted,
          submission: data.submission,
        },
      });
    } catch (error) {
      sendJson(res, errorStatus(error), { success: false, error: publicError(error, '任务链接无效或已失效') });
    }
  }

  private async handleSubmit(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const parsed = await parseMultipartRequest(req);
      const taskId = requireText(parsed.fields.taskId, '缺少 taskId');
      const submitToken = requireText(parsed.fields.submitToken, '缺少 submitToken');
      const itemInputs = parseSubmittedItems(parsed.fields.items);
      const filesByItem = groupFilesByItem(parsed.files);

      const items = itemInputs.map((item) => ({
        itemId: requireText(item.itemId, '检查项缺少 itemId'),
        remark: String(item.remark || ''),
        attachments: filesByItem.get(String(item.itemId)) || [],
      }));

      const service = await this.getService();
      const data = await service.submitTask({ taskId, submitToken, items });
      sendJson(res, 200, { success: true, data });
    } catch (error) {
      const status = error instanceof HttpError ? error.statusCode : errorStatus(error);
      sendJson(res, status, { success: false, error: publicError(error, '提交失败，请稍后重试') });
    }
  }
}

export function getLanIpAddress(): string {
  const interfaces = os.networkInterfaces();
  const candidates: string[] = [];

  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      if (entry.family !== 'IPv4' || entry.internal || !entry.address) continue;
      candidates.push(entry.address);
    }
  }

  const privateAddress = candidates.find((address) => (
    address.startsWith('192.168.') ||
    address.startsWith('10.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(address)
  ));
  return privateAddress || candidates[0] || '127.0.0.1';
}

function parseSubmittedItems(value: string | undefined): Array<{ itemId?: string; remark?: string }> {
  if (!value) throw new HttpError('缺少提交明细', 400);
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) throw new Error('items is not array');
    return parsed;
  } catch {
    throw new HttpError('提交明细格式错误', 400);
  }
}

function groupFilesByItem(files: ParsedFile[]): Map<string, QualityAttachmentUpload[]> {
  const result = new Map<string, QualityAttachmentUpload[]>();
  for (const file of files) {
    const itemId = file.fieldName.startsWith('file:') ? file.fieldName.slice(5) : '';
    if (!itemId) continue;
    validateUploadFile(file);
    const current = result.get(itemId) || [];
    current.push({
      name: file.filename,
      type: file.contentType || inferMimeType(file.filename),
      size: file.data.length,
      data: file.data,
    });
    result.set(itemId, current);
  }
  return result;
}

function validateUploadFile(file: ParsedFile): void {
  if (!file.filename) throw new HttpError('附件名称不能为空', 400);
  if (file.data.length <= 0) throw new HttpError(`${file.filename} 文件为空`, 400);
  if (file.data.length > MAX_FILE_SIZE) throw new HttpError(`${file.filename} 超过 10MB`, 400);

  const ext = path.extname(file.filename).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new HttpError(`${file.filename} 类型不支持，仅支持 jpg/jpeg/png/webp/pdf`, 400);
  }

  const mimeType = String(file.contentType || '').toLowerCase();
  if (mimeType && !ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new HttpError(`${file.filename} 类型不支持，仅支持 jpg/jpeg/png/webp/pdf`, 400);
  }
}

async function parseMultipartRequest(req: http.IncomingMessage): Promise<ParsedMultipart> {
  const contentType = String(req.headers['content-type'] || '');
  const boundary = extractBoundary(contentType);
  if (!boundary) {
    throw new HttpError('请求格式错误，请使用 multipart/form-data', 400);
  }

  const body = await readRequestBody(req, MAX_BODY_SIZE);
  return parseMultipartBody(body, boundary);
}

function extractBoundary(contentType: string): string {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  return String((match && (match[1] || match[2])) || '').trim();
}

function readRequestBody(req: http.IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const contentLength = Number(req.headers['content-length'] || 0);
    if (contentLength > maxBytes) {
      reject(new HttpError('提交内容过大', 413));
      return;
    }

    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new HttpError('提交内容过大', 413));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseMultipartBody(body: Buffer, boundary: string): ParsedMultipart {
  const fields: Record<string, string> = {};
  const files: ParsedFile[] = [];
  const boundaryBuffer = Buffer.from(`--${boundary}`);
  const parts = splitBuffer(body, boundaryBuffer);

  for (let part of parts) {
    part = trimLeadingCrlf(part);
    if (part.length === 0 || startsWith(part, Buffer.from('--'))) continue;
    part = trimTrailingCrlf(part);

    const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'));
    if (headerEnd < 0) continue;

    const headersText = part.slice(0, headerEnd).toString('utf8');
    const content = trimTrailingCrlf(part.slice(headerEnd + 4));
    const headers = parsePartHeaders(headersText);
    const disposition = headers['content-disposition'] || '';
    const name = parseHeaderParam(disposition, 'name');
    const filename = parseHeaderParam(disposition, 'filename');
    if (!name) continue;

    if (filename) {
      files.push({
        fieldName: name,
        filename: path.basename(filename),
        contentType: headers['content-type'] || '',
        data: content,
      });
    } else {
      fields[name] = content.toString('utf8');
    }
  }

  return { fields, files };
}

function splitBuffer(buffer: Buffer, separator: Buffer): Buffer[] {
  const parts: Buffer[] = [];
  let start = 0;
  let index = buffer.indexOf(separator, start);
  while (index !== -1) {
    parts.push(buffer.slice(start, index));
    start = index + separator.length;
    index = buffer.indexOf(separator, start);
  }
  parts.push(buffer.slice(start));
  return parts;
}

function trimLeadingCrlf(buffer: Buffer): Buffer {
  while (buffer.length >= 2 && buffer[0] === 13 && buffer[1] === 10) {
    buffer = buffer.slice(2);
  }
  return buffer;
}

function trimTrailingCrlf(buffer: Buffer): Buffer {
  while (buffer.length >= 2 && buffer[buffer.length - 2] === 13 && buffer[buffer.length - 1] === 10) {
    buffer = buffer.slice(0, buffer.length - 2);
  }
  return buffer;
}

function startsWith(buffer: Buffer, prefix: Buffer): boolean {
  if (buffer.length < prefix.length) return false;
  return buffer.slice(0, prefix.length).equals(prefix);
}

function parsePartHeaders(headersText: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of headersText.split('\r\n')) {
    const colonIndex = line.indexOf(':');
    if (colonIndex <= 0) continue;
    headers[line.slice(0, colonIndex).trim().toLowerCase()] = line.slice(colonIndex + 1).trim();
  }
  return headers;
}

function parseHeaderParam(headerValue: string, paramName: string): string {
  const pattern = new RegExp(`${paramName}="([^"]*)"`, 'i');
  const quoted = pattern.exec(headerValue);
  if (quoted) return quoted[1];

  const unquoted = new RegExp(`${paramName}=([^;]+)`, 'i').exec(headerValue);
  return unquoted ? unquoted[1].trim() : '';
}

async function serveQualityUpload(pathname: string, res: http.ServerResponse): Promise<void> {
  const writableBase = path.resolve(getWritableBasePath());
  const uploadRoot = path.resolve(writableBase, 'uploads', 'quality');
  const relativeUrlPath = pathname.replace(/^\/+/, '');
  const absolutePath = path.resolve(writableBase, relativeUrlPath);
  const uploadRootWithSep = uploadRoot + path.sep;

  if (absolutePath !== uploadRoot && !absolutePath.startsWith(uploadRootWithSep)) {
    sendJson(res, 403, { success: false, error: '附件路径非法' });
    return;
  }

  const ext = path.extname(absolutePath).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    sendJson(res, 403, { success: false, error: '附件类型不允许访问' });
    return;
  }

  try {
    const stat = await fs.promises.stat(absolutePath);
    if (!stat.isFile()) {
      sendJson(res, 404, { success: false, error: '附件不存在' });
      return;
    }
    res.writeHead(200, {
      'Content-Type': inferMimeType(absolutePath),
      'Content-Length': stat.size,
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    });
    fs.createReadStream(absolutePath).pipe(res);
  } catch {
    sendJson(res, 404, { success: false, error: '附件不存在' });
  }
}

function decodePathname(pathname: string): string {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}

function sendHtml(res: http.ServerResponse, html: string): void {
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(html);
}

function sendJson(res: http.ServerResponse, statusCode: number, payload: unknown): void {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(payload));
}

function publicError(error: unknown, fallback: string): string {
  if (error instanceof HttpError) return error.message;
  const message = error instanceof Error ? error.message : String(error || '');
  if (!message || looksLikeSqlError(message)) return fallback;
  return message;
}

function errorStatus(error: unknown): number {
  if (error instanceof HttpError) return error.statusCode;
  const message = error instanceof Error ? error.message : String(error || '');
  if (message.includes('任务链接无效') || message.includes('submitToken')) return 403;
  if (
    message.includes('缺少') ||
    message.includes('已提交') ||
    message.includes('审核通过') ||
    message.includes('附件') ||
    message.includes('备注')
  ) {
    return 400;
  }
  return 500;
}

function looksLikeSqlError(message: string): boolean {
  return /SQL|ER_|SELECT|INSERT|UPDATE|DELETE|ALTER|mysql|syntax|unknown column|field .*default|data truncated|duplicate entry|constraint|foreign key/i.test(message);
}

function inferMimeType(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.pdf') return 'application/pdf';
  return 'application/octet-stream';
}

function requireText(value: unknown, message: string): string {
  const text = String(value || '').trim();
  if (!text) throw new HttpError(message, 400);
  return text;
}
