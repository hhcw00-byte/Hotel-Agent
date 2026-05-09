/**
 * HumanMouse
 * 人类化鼠标操作工具
 * - 贝塞尔曲线移动轨迹（加速-减速）
 * - 正态分布随机落点（避免每次点击同一像素）
 * - 正态分布随机输入延迟（模拟真实打字节奏）
 *
 * 独立模块，不依赖主进程路径，可在爬虫子进程中直接使用
 */

import { Page } from 'playwright-core';

export interface Point {
  x: number;
  y: number;
}

export interface ElementBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export class HumanMouse {
  /** 记录上次鼠标位置，避免每次从 (0,0) 出发 */
  private lastPos: Point = { x: 0, y: 0 };

  // ─────────────────────────────────────────────
  // 公开 API
  // ─────────────────────────────────────────────

  /**
   * 移动到目标点（贝塞尔曲线，加速-减速）
   */
  async moveTo(page: Page, target: Point): Promise<void> {
    const path = this.buildBezierPath(this.lastPos, target);

    for (let i = 0; i < path.length; i++) {
      const pt = path[i];
      await page.mouse.move(pt.x, pt.y);

      // 加速-减速：起步慢 → 中间快 → 结尾慢
      const progress = i / path.length;
      const ease = 1 - Math.abs(progress - 0.5) * 0.6;
      const base = 10 * ease;
      const jitter = base * 0.3 * (Math.random() - 0.5);
      await this.sleep(Math.max(1, base + jitter));

      // 1% 概率随机短暂停顿（模拟人类分心）
      if (Math.random() < 0.01) {
        await this.sleep(60 + Math.random() * 140);
      }
    }

    this.lastPos = { x: target.x, y: target.y };
  }

  /**
   * 点击：移动 → 按下 → 随机持续 → 抬起
   * @param box 元素 boundingBox，用正态分布在内缩 10% 区域内随机落点
   */
  async click(page: Page, box: ElementBox): Promise<void> {
    const target = this.randomPoint(box);
    await this.moveTo(page, target);

    // mousedown 持续时间：正态分布 80~150ms
    const holdMs = Math.max(40, this.gaussian(100, 20));
    await page.mouse.down();
    await this.sleep(holdMs);
    await page.mouse.up();

    // 点击后短暂停留（真实用户会等待页面响应）
    await this.sleep(80 + Math.random() * 120);
  }

  /**
   * 在已激活的输入框中逐字输入
   * 每个字符延迟：正态分布，均值 60ms，偶发长停顿模拟思考
   */
  async type(page: Page, text: string): Promise<void> {
    for (const char of text) {
      await page.keyboard.type(char);

      // 正态分布字符间隔：均值 60ms，标准差 25ms
      const delay = Math.max(20, this.gaussian(60, 25));
      await this.sleep(delay);

      // 5% 概率出现较长停顿（打字时短暂思考）
      if (Math.random() < 0.05) {
        await this.sleep(200 + Math.random() * 300);
      }
    }
  }

  /**
   * 同步外部已知的鼠标坐标（e.g. 坐标点击后同步状态）
   */
  setPosition(pos: Point): void {
    this.lastPos = { x: pos.x, y: pos.y };
  }

  getPosition(): Point {
    return { ...this.lastPos };
  }

  // ─────────────────────────────────────────────
  // 内部工具
  // ─────────────────────────────────────────────

  /**
   * Box-Muller 正态分布随机数
   */
  private gaussian(mean: number, std: number): number {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return mean + std * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /**
   * 在元素内缩 10% 区域内用正态分布生成随机落点
   */
  private randomPoint(box: ElementBox): Point {
    const inset = 0.1;
    const ix = box.width * inset;
    const iy = box.height * inset;

    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    // ±2σ 覆盖内缩区域 80% 面积
    const stdX = (box.width - 2 * ix) / 4;
    const stdY = (box.height - 2 * iy) / 4;

    const px = Math.max(box.x + ix, Math.min(box.x + box.width - ix,
      this.gaussian(cx, stdX)));
    const py = Math.max(box.y + iy, Math.min(box.y + box.height - iy,
      this.gaussian(cy, stdY)));

    return { x: Math.round(px), y: Math.round(py) };
  }

  /**
   * 构建二阶贝塞尔曲线路径
   * 控制点偏移量与距离成正比，短距离不产生荒谬轨迹
   */
  private buildBezierPath(from: Point, to: Point): Point[] {
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    const steps = Math.max(5, Math.floor(dist / 5));
    const offsetScale = Math.max(8, dist * 0.25);

    // 两个随机控制点
    const controls: Point[] = [0.33, 0.66].map(t => ({
      x: from.x + (to.x - from.x) * t + (Math.random() - 0.5) * offsetScale,
      y: from.y + (to.y - from.y) * t + (Math.random() - 0.5) * offsetScale,
    }));

    const path: Point[] = [];
    for (let i = 0; i <= steps; i++) {
      path.push(this.deCasteljau(i / steps, [from, ...controls, to]));
    }
    return path;
  }

  /** De Casteljau 算法求贝塞尔曲线点 */
  private deCasteljau(t: number, pts: Point[]): Point {
    let p = [...pts];
    while (p.length > 1) {
      p = p.slice(0, -1).map((pt, i) => ({
        x: pt.x + (p[i + 1].x - pt.x) * t,
        y: pt.y + (p[i + 1].y - pt.y) * t,
      }));
    }
    return p[0];
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
  }
}
