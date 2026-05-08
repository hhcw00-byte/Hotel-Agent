// 反爬虫检测规避系统 - 类型定义

/**
 * 点坐标
 */
export interface Point {
  x: number;
  y: number;
}

/**
 * 元素矩形区域（用于正态分布点击随机化）
 */
export interface ElementRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 指纹配置
 */
export interface FingerprintConfig {
  /** 是否移除 WebDriver 标记 */
  removeWebDriver: boolean;
  /** Canvas 噪声级别 (0-1) */
  canvasNoiseLevel: number;
  /** 是否启用 WebGL 保护 */
  webglProtection: boolean;
}

/**
 * 行为配置
 */
export interface BehaviorConfig {
  /** 是否启用人类化鼠标 */
  humanLikeMouse: boolean;
  /** 速度变化范围 (0-1) */
  speedVariation: number;
  /** 随机停顿概率 (0-1) */
  pauseProbability: number;
}

/**
 * 网络配置
 */
export interface NetworkConfig {
  /** 是否启用 Stealth 插件 */
  stealthPlugin: boolean;
  /** 自定义 User-Agent */
  customUserAgent?: string;
}

/**
 * 环境配置
 */
export interface EnvironmentConfig {
  /** 国家代码 */
  countryCode: string;
  /** 时区 */
  timezone?: string;
  /** 语言 */
  locale?: string;
  /** 地理位置 */
  geolocation?: {
    latitude: number;
    longitude: number;
    accuracy: number;
  };
}

/**
 * 反检测配置
 */
export interface AntiDetectionConfig {
  fingerprint: FingerprintConfig;
  behavior: BehaviorConfig;
  network: NetworkConfig;
  environment: EnvironmentConfig;
}
