/**
 * Device Manager - 设备管理器
 *
 * 职责：
 * - 基于硬件指纹生成唯一设备ID
 * - 持久化设备信息到 electron-store
 * - 提供设备信息访问接口
 */

import * as os from 'os';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import type { DeviceInfo } from '../shared/types';

/**
 * 采集硬件指纹并生成设备ID
 */
export function generateDeviceId(): DeviceInfo {
  const networkInterfaces = os.networkInterfaces();
  const macAddresses = Object.values(networkInterfaces)
    .flat()
    .filter(
      (iface): iface is os.NetworkInterfaceInfo =>
        iface !== undefined &&
        !iface.internal &&
        iface.mac !== '00:00:00:00:00:00'
    )
    .map((iface) => iface.mac)
    .sort();

  const cpuModel = os.cpus()[0]?.model || 'unknown';
  const hostname = os.hostname();

  let fingerprint: string;
  if (macAddresses.length === 0) {
    // 无物理网卡回退：hostname + cpuModel + 随机UUID
    fingerprint = `${hostname}::${cpuModel}::${uuidv4()}`;
  } else {
    fingerprint = `${macAddresses.join('|')}::${cpuModel}::${hostname}`;
  }

  const hash = crypto.createHash('sha256').update(fingerprint).digest('hex');

  return {
    deviceId: hash,
    deviceIdShort: hash.substring(0, 12),
    hostname,
    platform: os.platform(),
    firstSeen: new Date().toISOString(),
  };
}


/**
 * 设备管理器类
 *
 * 管理设备ID的生成、持久化和读取。
 * 构造函数接受一个 store 实例（electron-store），
 * 需要支持 get(key) 和 set(key, value) 方法。
 */
export class DeviceManager {
  private store: any;

  constructor(store: any) {
    this.store = store;
  }

  /**
   * 获取或创建设备ID
   * 优先从 store 读取已有 deviceInfo，不存在则生成并持久化
   */
  getOrCreateDeviceId(): DeviceInfo {
    const existing = this.store.get('deviceInfo') as DeviceInfo | undefined;

    if (existing && existing.deviceId && existing.deviceIdShort) {
      return existing;
    }

    const deviceInfo = generateDeviceId();
    this.store.set('deviceInfo', deviceInfo);
    return deviceInfo;
  }

  /**
   * 获取设备短ID
   */
  getDeviceIdShort(): string {
    const info = this.getOrCreateDeviceId();
    return info.deviceIdShort;
  }

  /**
   * 获取完整设备信息
   */
  getDeviceInfo(): DeviceInfo {
    return this.getOrCreateDeviceId();
  }
}
