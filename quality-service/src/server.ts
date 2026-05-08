import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { URL } from 'url';
import { createPool, type Pool } from 'mysql2/promise';
import { config } from './config';
import { QualityFileStore } from './quality-file-store';
import { QualityRepository } from './quality-repository';
import { initializeQualitySchema } from './quality-schema';
import { QualityService } from './quality-service';
import type { QualityAttachmentUpload } from './quality-types';
import { renderQualitySubmitPage } from './quality-web-page';

const MAX_JSON_BODY_BYTES = 1024 * 1024;
const MAX_MULTIPART_BODY_BYTES = Math.max(config.maxUploadSizeBytes * 20, config.maxUploadSizeBytes + 1024 * 1024);
const BASE_PATH = '/hotel-ai-browser';
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

let pool: Pool;
let qualityService: QualityService;

async function bootstrap(): Promise<void> {
  await fs.promises.mkdir(config.uploadRoot, { recursive: true });

  pool = createPool({
    host: config.mysql.host,
    port: config.mysql.port,
    user: config.mysql.user,
    password: config.mysql.password,
    database: config.mysql.database,
    waitForConnections: true,
    connectionLimit: 10,
    namedPlaceholders: false,
    charset: 'utf8mb4',
    timezone: '+08:00',
  });

  await initializeMysqlCharset(pool);
  await initializeQualitySchema(pool);

  qualityService = new QualityService(
    new QualityRepository(pool),
    new QualityFileStore(config.uploadRoot, () => config.publicBaseUrl),
    () => 1,
    () => config.publicBaseUrl
  );

  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch((error) => {
      console.error('[quality-service] request failed:', error);
      if (!res.headersSent) {
        sendJson(res, errorStatus(error), {
          success: false,
          error: publicError(error, '服务暂不可用，请稍后重试'),
        });
      } else {
        res.end();
      }
    });
  });

  server.listen(config.port, '0.0.0.0', () => {
    console.log(`[quality-service] started at http://0.0.0.0:${config.port}`);
    console.log(`[quality-service] submit base url: ${config.publicBaseUrl}`);
  });
}

async function initializeMysqlCharset(currentPool: Pool): Promise<void> {
  await currentPool.query('SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci');
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  applyBaseHeaders(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = normalizePath(decodePathname(requestUrl.pathname));

  if (req.method === 'GET' && pathname === '/health') {
    sendJson(res, 200, { success: true, data: { status: 'ok' } });
    return;
  }

  if (req.method === 'POST' && isQualityRoute(pathname, '/tasks')) {
    await createTask(req, res);
    return;
  }

  if (req.method === 'GET' && isQualityRoute(pathname, '/tasks')) {
    const data = await qualityService.listTasks();
    sendJson(res, 200, { success: true, data });
    return;
  }

  const resultMatch = matchQualityTaskAction(pathname, 'result');
  if (req.method === 'GET' && resultMatch) {
    const data = await qualityService.getSubmissionResult(resultMatch[1]);
    sendJson(res, 200, { success: true, data });
    return;
  }

  if (req.method === 'GET' && pathname === '/quality/submit') {
    sendHtml(res, renderQualitySubmitPage(config.publicBaseUrl));
    return;
  }

  if (req.method === 'GET' && isQualityRoute(pathname, '/submit-task')) {
    await getSubmitTask(requestUrl, res);
    return;
  }

  if (req.method === 'POST' && isQualityRoute(pathname, '/submit')) {
    await submitTask(req, res);
    return;
  }

  const approveMatch = matchQualityTaskAction(pathname, 'approve');
  if (req.method === 'POST' && approveMatch) {
    const data = await qualityService.approveSubmission(approveMatch[1]);
    sendJson(res, 200, { success: true, data });
    return;
  }

  const rejectMatch = matchQualityTaskAction(pathname, 'reject');
  if (req.method === 'POST' && rejectMatch) {
    const body = await readJson(req);
    const data = await qualityService.rejectSubmission({
      taskId: rejectMatch[1],
      reason: String(body.reason || ''),
    });
    sendJson(res, 200, { success: true, data });
    return;
  }

  if (req.method === 'GET' && pathname.startsWith('/uploads/quality/')) {
    await serveQualityUpload(pathname, res);
    return;
  }

  sendJson(res, 404, { success: false, error: '资源不存在' });
}

async function createTask(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const body = await readJson(req);
  const created = await qualityService.createTask({
    taskName: String(body.taskName || ''),
    storeName: String(body.storeName || ''),
    dueAt: body.dueAt || null,
    instructions: String(body.instructions || ''),
    items: Array.isArray(body.items) ? body.items : [],
  });

  sendJson(res, 200, {
    success: true,
    data: {
      taskId: created.taskId,
      submitToken: created.submitToken,
      submitUrl: created.submitUrl,
    },
  });
}

async function getSubmitTask(requestUrl: URL, res: http.ServerResponse): Promise<void> {
  const taskId = String(requestUrl.searchParams.get('taskId') || '').trim();
  const submitToken = String(requestUrl.searchParams.get('submitToken') || '').trim();
  if (!taskId || !submitToken) {
    throw new HttpError('缺少 taskId 或 submitToken', 400);
  }

  const data = await qualityService.getSubmitTask({ taskId, submitToken });
  sendJson(res, 200, {
    success: true,
    data: {
      task: data.task,
      items: data.items,
      alreadySubmitted: data.alreadySubmitted,
      submission: data.submission,
    },
  });
}

async function submitTask(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const parsed = await parseMultipartRequest(req);
  const taskId = requireText(parsed.fields.taskId, '缺少 taskId');
  const submitToken = requireText(parsed.fields.submitToken, '缺少 submitToken');
  const itemInputs = parseSubmittedItems(parsed.fields.items);
  const filesByItem = groupFilesByItem(parsed.files, itemInputs);

  const items = itemInputs.map((item) => ({
    itemId: requireText(item.itemId, '检查项缺少 itemId'),
    remark: String(item.remark || ''),
    attachments: filesByItem.get(String(item.itemId)) || [],
  }));

  const data = await qualityService.submitTask({ taskId, submitToken, items });
  sendJson(res, 200, { success: true, data });
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

function groupFilesByItem(files: ParsedFile[], items: Array<{ itemId?: string }>): Map<string, QualityAttachmentUpload[]> {
  const result = new Map<string, QualityAttachmentUpload[]>();
  for (const file of files) {
    let itemId = '';
    if (file.fieldName.startsWith('file:')) itemId = file.fieldName.slice(5);
    if (file.fieldName.startsWith('files:')) itemId = file.fieldName.slice(6);
    if (file.fieldName === 'files' && items.length === 1) itemId = String(items[0].itemId || '');
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
  if (file.data.length > config.maxUploadSizeBytes) throw new HttpError(`${file.filename} 超过上传大小限制`, 400);

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

  const body = await readRequestBody(req, MAX_MULTIPART_BODY_BYTES);
  return parseMultipartBody(body, boundary);
}

function extractBoundary(contentType: string): string {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  return String((match && (match[1] || match[2])) || '').trim();
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

async function readJson(req: http.IncomingMessage): Promise<any> {
  const body = await readRequestBody(req, MAX_JSON_BODY_BYTES);
  if (body.length === 0) return {};
  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    throw new HttpError('JSON 格式错误', 400);
  }
}

function readRequestBody(req: http.IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const contentLength = Number(req.headers['content-length'] || 0);
    if (contentLength > maxBytes) {
      reject(new HttpError('请求内容过大', 413));
      return;
    }

    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new HttpError('请求内容过大', 413));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function serveQualityUpload(pathname: string, res: http.ServerResponse): Promise<void> {
  const relativeUrlPath = pathname.replace(/^\/+/, '');
  const absolutePath = path.resolve(process.cwd(), relativeUrlPath);
  const uploadRoot = path.resolve(config.uploadRoot);
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

function applyBaseHeaders(res: http.ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function isQualityRoute(pathname: string, suffix: string): boolean {
  return pathname === `/api/quality${suffix}` || pathname === `/quality${suffix}`;
}

function matchQualityTaskAction(pathname: string, action: string): RegExpExecArray | null {
  return new RegExp(`^/(?:api/)?quality/tasks/([^/]+)/${action}$`).exec(pathname);
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
    message.includes('备注') ||
    message.includes('格式')
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

function decodePathname(pathname: string): string {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}

function normalizePath(pathname: string): string {
  if (pathname === BASE_PATH) return '/';
  if (pathname.startsWith(`${BASE_PATH}/`)) {
    return pathname.slice(BASE_PATH.length) || '/';
  }
  return pathname;
}

bootstrap().catch((error) => {
  console.error('[quality-service] failed to start:', error);
  process.exitCode = 1;
});
