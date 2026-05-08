// 鼠标行为模拟器

// 使用 any 类型以兼容 Playwright 和 Electron
type Page = any;

import { Point, ElementRect } from '../types';

/**
 * 鼠标模拟器
 * 使用贝塞尔曲线生成自然的鼠标移动轨迹
 * 使用正态分布生成随机点击落点
 */
export class MouseSimulator {
  /** 维护上次鼠标位置，避免每次都从 (0,0) 出发 */
  private lastPosition: Point = { x: 0, y: 0 };

  /**
   * Box-Muller 正态分布随机数生成器
   * @param mean 均值
   * @param stddev 标准差
   * @returns 正态分布随机数
   */
  private gaussianRandom(mean: number, stddev: number): number {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    return mean + z * stddev;
  }

  /**
   * 以元素矩形为基础，用正态分布生成随机点击落点
   * 落点以元素中心为均值，内缩 10% 边界为 ±2σ 范围
   *
   * @param rect 元素的矩形区域 { x, y, width, height }（x,y 为左上角坐标）
   * @returns 正态分布随机落点
   */
  getRandomClickPoint(rect: ElementRect): Point {
    // 内缩 10%：左右各缩 10%，上下各缩 10%
    const insetRatio = 0.1;
    const insetX = rect.width * insetRatio;
    const insetY = rect.height * insetRatio;

    // 有效区域
    const effectiveWidth = rect.width - 2 * insetX;
    const effectiveHeight = rect.height - 2 * insetY;

    // 中心点
    const centerX = rect.x + rect.width / 2;
    const centerY = rect.y + rect.height / 2;

    // 标准差设为有效区域的 1/4（≈95% 落在 ±2σ 即有效区域内）
    const stddevX = effectiveWidth / 4;
    const stddevY = effectiveHeight / 4;

    // 生成正态分布随机坐标
    let px = this.gaussianRandom(centerX, stddevX);
    let py = this.gaussianRandom(centerY, stddevY);

    // 硬边界 clamp：确保不超出内缩区域
    const minX = rect.x + insetX;
    const maxX = rect.x + rect.width - insetX;
    const minY = rect.y + insetY;
    const maxY = rect.y + rect.height - insetY;

    px = Math.max(minX, Math.min(maxX, px));
    py = Math.max(minY, Math.min(maxY, py));

    return { x: Math.round(px), y: Math.round(py) };
  }

  /**
   * 生成贝塞尔曲线路径点
   * @param start 起点
   * @param end 终点
   * @param controlPoints 控制点数量
   * @returns 路径点数组
   */
  private generateBezierPath(
    start: Point,
    end: Point,
    controlPoints: number = 2
  ): Point[] {
    const points: Point[] = [];
    const distance = Math.hypot(end.x - start.x, end.y - start.y);
    const steps = Math.max(5, Math.floor(distance / 5)); // 最少 5 个点，每 5 像素一个点

    // 控制点偏移量与距离成正比（距离的 20%~30%），避免短距离产生荒谬轨迹
    const offsetScale = Math.max(10, distance * 0.25);

    // 生成随机控制点
    const controls: Point[] = [];
    for (let i = 0; i < controlPoints; i++) {
      const t = (i + 1) / (controlPoints + 1);
      controls.push({
        x: start.x + (end.x - start.x) * t + (Math.random() - 0.5) * offsetScale,
        y: start.y + (end.y - start.y) * t + (Math.random() - 0.5) * offsetScale,
      });
    }

    // 计算贝塞尔曲线点
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const point = this.bezierPoint(t, start, controls, end);
      points.push(point);
    }

    return points;
  }

  /**
   * 计算贝塞尔曲线上的点（De Casteljau 算法）
   * @param t 参数 (0-1)
   * @param start 起点
   * @param controls 控制点数组
   * @param end 终点
   * @returns 曲线上的点
   */
  private bezierPoint(
    t: number,
    start: Point,
    controls: Point[],
    end: Point
  ): Point {
    const allPoints = [start, ...controls, end];
    let points = [...allPoints];

    while (points.length > 1) {
      const newPoints: Point[] = [];
      for (let i = 0; i < points.length - 1; i++) {
        newPoints.push({
          x: points[i].x + (points[i + 1].x - points[i].x) * t,
          y: points[i].y + (points[i + 1].y - points[i].y) * t,
        });
      }
      points = newPoints;
    }

    return points[0];
  }

  /**
   * 模拟人类鼠标移动
   * @param page Playwright 页面实例
   * @param from 起点（可选，默认使用上次位置）
   * @param to 终点
   * @param options 选项
   */
  async moveMouseHumanLike(
    page: Page,
    from: Point | null,
    to: Point,
    options: {
      speedVariation?: number; // 速度变化范围 0-1
      pauseProbability?: number; // 停顿概率 0-1
    } = {}
  ): Promise<void> {
    const {
      speedVariation = 0.3,
      pauseProbability = 0.1,
    } = options;

    // 使用传入的起点或上次记录的位置
    const startPoint = from ?? this.lastPosition;

    try {
      const path = this.generateBezierPath(startPoint, to);

      for (let i = 0; i < path.length; i++) {
        const point = path[i];

        // 移动鼠标
        await page.mouse.move(point.x, point.y);

        // 随机速度变化（模拟加速-减速曲线）
        const progress = i / path.length;
        // 起步和结尾慢，中间快
        const easeFactor = 1 - Math.abs(progress - 0.5) * 0.6;
        const baseDelay = 10 * easeFactor;
        const variation = baseDelay * speedVariation * (Math.random() - 0.5);
        const delay = Math.max(1, baseDelay + variation);

        await this.sleep(delay);

        // 随机停顿（模拟人类犹豫/分心）
        if (Math.random() < pauseProbability) {
          await this.sleep(50 + Math.random() * 150);
        }
      }

      // 更新最后位置
      this.lastPosition = { x: to.x, y: to.y };
    } catch (error) {
      console.error('[Mouse Simulator] Failed to move mouse:', error);
      // 降级方案：直接移动到目标位置
      await page.mouse.move(to.x, to.y);
      this.lastPosition = { x: to.x, y: to.y };
    }
  }

  /**
   * 人类化点击（基于坐标）
   * @param page Playwright 页面实例
   * @param x X 坐标
   * @param y Y 坐标
   * @param options 选项
   */
  async clickHumanLike(
    page: Page,
    x: number,
    y: number,
    options: {
      moveToTarget?: boolean;
      doubleClick?: boolean;
    } = {}
  ): Promise<void> {
    const { moveToTarget = true, doubleClick = false } = options;

    try {
      if (moveToTarget) {
        await this.moveMouseHumanLike(page, null, { x, y });
      }

      // 随机按下延迟 (50-150ms)
      const downDelay = 50 + Math.random() * 100;
      await page.mouse.down();
      await this.sleep(downDelay);
      await page.mouse.up();

      if (doubleClick) {
        await this.sleep(100 + Math.random() * 100);
        await page.mouse.down();
        await this.sleep(downDelay);
        await page.mouse.up();
      }

      // 点击后随机停顿
      await this.sleep(100 + Math.random() * 200);

      // 更新位置
      this.lastPosition = { x, y };
    } catch (error) {
      console.error('[Mouse Simulator] Failed to click:', error);
      throw error;
    }
  }

  /**
   * 人类化点击（基于元素矩形 + 正态分布随机落点）
   * AI 给出目标元素的 boundingRect，本方法用正态分布在内缩 10% 范围内生成随机落点
   *
   * @param page Playwright 页面实例
   * @param rect 目标元素的矩形区域 { x, y, width, height }
   * @param options 选项
   */
  async clickElementHumanLike(
    page: Page,
    rect: ElementRect,
    options: {
      moveToTarget?: boolean;
      doubleClick?: boolean;
    } = {}
  ): Promise<void> {
    const clickPoint = this.getRandomClickPoint(rect);
    await this.clickHumanLike(page, clickPoint.x, clickPoint.y, options);
  }

  /**
   * 获取当前鼠标位置
   */
  getLastPosition(): Point {
    return { ...this.lastPosition };
  }

  /**
   * 手动设置当前鼠标位置（用于同步外部状态）
   */
  setLastPosition(point: Point): void {
    this.lastPosition = { x: point.x, y: point.y };
  }

  /**
   * 休眠指定毫秒数
   * @param ms 毫秒数
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
