import * as fs from 'fs';
import * as path from 'path';
import type { QualityAttachmentRecord, QualityAttachmentUpload, QualityAttachmentView } from './quality-types';

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

export class QualityFileStore {
  private readonly serviceRoot = process.cwd();

  constructor(
    private readonly uploadRoot: string,
    private readonly getBaseUrl: () => string
  ) {}

  async saveFiles(taskId: string, itemId: string, files: QualityAttachmentUpload[]): Promise<QualityAttachmentRecord[]> {
    if (!files || files.length === 0) return [];

    const safeTaskId = sanitizePathSegment(taskId);
    const safeItemId = sanitizePathSegment(itemId);
    const dir = path.join(this.uploadRoot, safeTaskId, safeItemId);
    await fs.promises.mkdir(dir, { recursive: true });

    const saved: QualityAttachmentRecord[] = [];
    for (const file of files) {
      const originalName = sanitizeFileName(file.name || 'attachment');
      const buffer = toBuffer(file.data);
      if (buffer.length === 0) {
        throw new Error(`${originalName} 文件为空`);
      }

      const fileName = `${Date.now()}-${randomSuffix()}-${originalName}`;
      const absolutePath = path.join(dir, fileName);
      await fs.promises.writeFile(absolutePath, buffer);

      saved.push({
        relativePath: toRelativePath(path.relative(this.serviceRoot, absolutePath)),
        originalName,
        fileName,
        mimeType: file.type || inferMimeType(fileName),
        size: Number(file.size || buffer.length),
      });
    }
    return saved;
  }

  decorateAttachment(record: QualityAttachmentRecord): QualityAttachmentView {
    const absolutePath = this.resolveRelativePath(record.relativePath);
    const isImage = isImageAttachment(record);
    return {
      ...record,
      isImage,
      fileUrl: isImage ? `${this.getBaseUrl().replace(/\/+$/, '')}/${toRelativePath(path.relative(this.serviceRoot, absolutePath))}` : undefined,
    };
  }

  async cleanupAttachments(records: QualityAttachmentRecord[]): Promise<void> {
    const paths = new Set(records.map((record) => record.relativePath));
    for (const relativePath of paths) {
      try {
        await fs.promises.unlink(this.resolveRelativePath(relativePath));
      } catch {
        // Best-effort cleanup only.
      }
    }
  }

  resolveRelativePath(relativePath: string): string {
    const normalized = path.normalize(relativePath).replace(/^(\.\.(\\|\/|$))+/, '');
    const absolutePath = path.resolve(this.serviceRoot, normalized);
    const uploadRoot = path.resolve(this.uploadRoot);
    const uploadRootWithSep = uploadRoot + path.sep;
    if (absolutePath !== uploadRoot && !absolutePath.startsWith(uploadRootWithSep)) {
      throw new Error('附件路径非法');
    }
    return absolutePath;
  }
}

function sanitizePathSegment(value: string): string {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'unknown';
}

function sanitizeFileName(value: string): string {
  const base = path.basename(value).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim();
  return base.slice(0, 120) || 'attachment';
}

function toBuffer(data: ArrayBuffer | Uint8Array | number[]): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(new Uint8Array(data));
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (Array.isArray(data)) return Buffer.from(data);
  throw new Error('附件数据格式不支持');
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

function toRelativePath(relativePath: string): string {
  return relativePath.split(path.sep).join('/');
}

function isImageAttachment(record: QualityAttachmentRecord): boolean {
  if (record.mimeType && record.mimeType.startsWith('image/')) return true;
  return IMAGE_EXTENSIONS.has(path.extname(record.fileName || record.originalName).toLowerCase());
}

function inferMimeType(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.pdf') return 'application/pdf';
  return 'application/octet-stream';
}
