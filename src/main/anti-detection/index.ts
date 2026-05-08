// 反爬虫检测规避系统 - 导出索引

export { AntiDetectionManager } from './manager';
export { MouseSimulator } from './behavior/mouse-simulator';
export { NetworkProtector } from './network/network-protector';
export { EnvironmentConfigurator } from './environment/env-configurator';
export { removeWebDriverMarkers } from './scripts/webdriver-remover';
export { protectCanvasFingerprint } from './scripts/canvas-protector';
export { applyExtraProtections, getExtraProtectionsScript } from './scripts/extra-protections';

export type {
  Point,
  ElementRect,
  FingerprintConfig,
  BehaviorConfig,
  NetworkConfig,
  EnvironmentConfig,
  AntiDetectionConfig,
} from './types';
