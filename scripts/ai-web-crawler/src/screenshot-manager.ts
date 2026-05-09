/**
 * Screenshot Manager
 * Handles screenshot capture, compression, and storage
 *
 * sharp 采用延迟加载：仅在首次调用 compress / compressForLLM 时才 require('sharp')。
 * 这样即使目标机器缺少 VC++ Runtime 导致 sharp native binding 加载失败，
 * 爬虫的核心功能（CDP 连接、DOM 提取、截图捕获）仍然可以正常工作。
 */

import * as fs from 'fs';
import * as path from 'path';
import { Page } from 'playwright-core';
import { ScreenshotOptions, ScreenshotMetadata } from './types';

// Lazy-loaded sharp instance
let _sharp: typeof import('sharp') | null = null;
let _sharpLoadError: Error | null = null;

function getSharp(): typeof import('sharp') {
  if (_sharp) return _sharp;
  if (_sharpLoadError) throw _sharpLoadError;
  try {
    _sharp = require('sharp');
    return _sharp!;
  } catch (err) {
    _sharpLoadError = err as Error;
    console.error('[ScreenshotManager] Failed to load sharp:', (err as Error).message);
    console.error('[ScreenshotManager] Image compression will be unavailable. Screenshots will be sent uncompressed.');
    throw err;
  }
}

export class ScreenshotManager {
  private outputDir: string;
  private quality: number;
  private maxSize: number;

  constructor(outputDir: string, quality: number = 80, maxSize: number = 5242880) {
    this.outputDir = outputDir;
    this.quality = quality;
    this.maxSize = maxSize;

    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
  }

  /**
   * Capture screenshot from page
   */
  async capture(page: Page, options?: ScreenshotOptions): Promise<Buffer> {
    const quality = options?.quality || this.quality;
    const format = options?.format || 'jpeg';
    const fullPage = options?.fullPage !== undefined ? options.fullPage : true;

    // Try standard Playwright screenshot first (short timeout for off-screen pages)
    try {
      const screenshot = await page.screenshot({
        type: format,
        quality: format === 'jpeg' ? quality : undefined,
        fullPage,
        timeout: fullPage ? 15000 : 3000, // 全页截图给更长的合成时间
        animations: 'disabled',
        scale: 'css',
      });
      return Buffer.from(screenshot);
    } catch (err) {
      // Fallback: use CDP Page.captureScreenshot directly (works for off-screen BrowserViews)
    }

    // CDP fallback — works even when the page is off-screen.
    // Note: captureBeyondViewport captures from current scroll position downward,
    // so callers must ensure the page is scrolled to top before fullPage capture.
    // Wrap in hard timeout to prevent CDP session hanging forever on unresponsive pages.
    const CDP_SCREENSHOT_TIMEOUT = 15000;
    const cdpSession = await page.context().newCDPSession(page);
    try {
      const result = await Promise.race([
        cdpSession.send('Page.captureScreenshot', {
          format: format === 'jpeg' ? 'jpeg' : 'png',
          quality: format === 'jpeg' ? quality : undefined,
          captureBeyondViewport: true,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`CDP screenshot timeout (${CDP_SCREENSHOT_TIMEOUT}ms)`)), CDP_SCREENSHOT_TIMEOUT)
        ),
      ]);
      return Buffer.from(result.data, 'base64');
    } finally {
      await cdpSession.detach().catch(() => {});
    }
  }

  /**
   * Save screenshot to disk and return URL path
   */
  async save(screenshot: Buffer, metadata: ScreenshotMetadata): Promise<string> {
    const filename = this.generateFilename(metadata);
    const filepath = path.join(this.outputDir, filename);

    // Compress if needed
    let finalBuffer = screenshot;
    let compressed = false;

    if (screenshot.length > this.maxSize) {
      try {
        finalBuffer = await this.compress(screenshot, this.maxSize);
        compressed = true;
      } catch (err) {
        // sharp not available — save uncompressed
        console.warn('[ScreenshotManager] Compression unavailable, saving uncompressed');
      }
    }

    // Save to disk
    fs.writeFileSync(filepath, finalBuffer);

    // Update metadata
    metadata.size = finalBuffer.length;
    metadata.compressed = compressed;

    // Return URL path (relative to output dir)
    return `/${path.relative(process.cwd(), filepath).replace(/\\/g, '/')}`;
  }

  /**
   * Compress screenshot to fit within size limit
   */
  async compress(screenshot: Buffer, maxSize: number): Promise<Buffer> {
    const sharpModule = getSharp();
    let compressed = screenshot;
    let quality = this.quality;
    let scale = 1.0;

    // Try reducing quality first
    while (compressed.length > maxSize && quality > 20) {
      quality -= 10;
      compressed = await sharpModule(screenshot)
        .jpeg({ quality })
        .toBuffer();
    }

    // If still too large, reduce resolution
    while (compressed.length > maxSize && scale > 0.3) {
      scale -= 0.1;
      const metadata = await sharpModule(screenshot).metadata();
      const newWidth = Math.floor((metadata.width || 1920) * scale);
      const newHeight = Math.floor((metadata.height || 1080) * scale);

      compressed = await sharpModule(screenshot)
        .resize(newWidth, newHeight, { fit: 'inside' })
        .jpeg({ quality })
        .toBuffer();
    }

    return compressed;
  }

  /**
   * Generate filename from metadata
   */
  private generateFilename(metadata: ScreenshotMetadata): string {
    const timestamp = new Date(metadata.timestamp).toISOString().replace(/[:.]/g, '-');
    const label = metadata.label.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    return `${timestamp}_step${metadata.step}_${label}.jpg`;
  }

  /**
   * Compress screenshot for LLM consumption.
   * Resizes to max 1280px width and JPEG quality 60 to keep base64 payload small.
   * Typical output: 80-200KB instead of 1-5MB.
   */
  static async compressForLLM(
    screenshot: Buffer,
    maxWidth: number = 1280,
    llmQuality: number = 60
  ): Promise<Buffer> {
    let sharpModule: typeof import('sharp');
    try {
      sharpModule = getSharp();
    } catch {
      // sharp unavailable — return original buffer (larger but functional)
      return screenshot;
    }

    const metadata = await sharpModule(screenshot).metadata();
    const origWidth = metadata.width || 1920;
    const origHeight = metadata.height || 1080;

    let pipeline = sharpModule(screenshot);

    // Only resize if wider than maxWidth
    if (origWidth > maxWidth) {
      const scale = maxWidth / origWidth;
      const newHeight = Math.floor(origHeight * scale);
      pipeline = pipeline.resize(maxWidth, newHeight, { fit: 'inside' });
    }

    // Always re-encode as JPEG at reduced quality
    return pipeline.jpeg({ quality: llmQuality }).toBuffer();
  }

  /**
   * Get output directory
   */
  getOutputDir(): string {
    return this.outputDir;
  }

  /**
   * Clear all screenshots in output directory
   */
  clearAll(): void {
    if (fs.existsSync(this.outputDir)) {
      const files = fs.readdirSync(this.outputDir);
      for (const file of files) {
        if (file.endsWith('.jpg') || file.endsWith('.png')) {
          fs.unlinkSync(path.join(this.outputDir, file));
        }
      }
    }
  }
}
