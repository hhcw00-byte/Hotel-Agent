/**
 * Version Checker - 版本校验器
 *
 * 职责：
 * - 连接公共管理库 hotel_agent_system 校验客户端版本
 * - 确保 system 数据库、版本表和设备表存在
 * - 注册/更新设备信息到 devices 表
 */

import mysql, { Pool, RowDataPacket } from 'mysql2/promise';
import { APP_VERSION } from '../shared/constants';
import type { CloudDbConfig, DeviceInfo } from '../shared/types';

export interface VersionCheckResult {
  passed: boolean;
  currentVersion: string;
  requiredVersion: string;
  message?: string;
}

export class VersionChecker {
  private cloudConfig: CloudDbConfig;
  private systemPool: Pool | null = null;

  constructor(cloudConfig: CloudDbConfig) {
    this.cloudConfig = cloudConfig;
  }

  /**
   * 校验客户端版本
   * 连接 hotel_agent_system，查询 required_version 并与 APP_VERSION 比较
   */
  async checkVersion(deviceInfo: DeviceInfo): Promise<VersionCheckResult> {
    try {
      // 确保 system 数据库和表存在
      await this.ensureSystemDatabase();

      // 查询当前生效的版本要求
      const [rows] = await this.systemPool!.execute<RowDataPacket[]>(
        'SELECT required_version FROM app_versions WHERE is_active = TRUE ORDER BY id DESC LIMIT 1'
      );

      if (rows.length === 0) {
        // 无版本记录，视为通过（首次部署场景）
        return {
          passed: true,
          currentVersion: APP_VERSION,
          requiredVersion: APP_VERSION,
        };
      }

      const requiredVersion = rows[0].required_version as string;
      const passed = APP_VERSION === requiredVersion;

      // 注册/更新设备信息
      await this.registerDevice(deviceInfo);

      return {
        passed,
        currentVersion: APP_VERSION,
        requiredVersion,
        message: passed
          ? undefined
          : `当前版本 ${APP_VERSION} 不符合要求版本 ${requiredVersion}，请更新后使用`,
      };
    } finally {
      // 确保连接池正确关闭
      if (this.systemPool) {
        await this.systemPool.end();
        this.systemPool = null;
      }
    }
  }

  /**
   * 确保 hotel_agent_system 数据库及其表结构存在
   * 如果 app_versions 表为空，插入默认版本记录
   */
  private async ensureSystemDatabase(): Promise<void> {
    // 先创建一个不指定数据库的连接池，用于创建 system 数据库
    const initPool = mysql.createPool({
      host: this.cloudConfig.host,
      port: this.cloudConfig.port,
      user: this.cloudConfig.user,
      password: this.cloudConfig.password,
      connectTimeout: 10000,
    });

    try {
      await initPool.execute(
        'CREATE DATABASE IF NOT EXISTS hotel_agent_system CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
      );
    } finally {
      await initPool.end();
    }

    // 连接到 hotel_agent_system，创建表结构
    this.systemPool = mysql.createPool({
      host: this.cloudConfig.host,
      port: this.cloudConfig.port,
      user: this.cloudConfig.user,
      password: this.cloudConfig.password,
      database: 'hotel_agent_system',
      connectTimeout: 10000,
    });

    // 创建 app_versions 表
    await this.systemPool.execute(`
      CREATE TABLE IF NOT EXISTS app_versions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        version VARCHAR(32) NOT NULL,
        required_version VARCHAR(32) NOT NULL,
        release_notes TEXT,
        is_active BOOLEAN DEFAULT TRUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    // 创建 devices 表
    await this.systemPool.execute(`
      CREATE TABLE IF NOT EXISTS devices (
        id INT AUTO_INCREMENT PRIMARY KEY,
        device_id VARCHAR(64) NOT NULL UNIQUE,
        device_id_short VARCHAR(16) NOT NULL UNIQUE,
        hostname VARCHAR(255),
        platform VARCHAR(64),
        app_version VARCHAR(32),
        database_name VARCHAR(128),
        last_seen DATETIME,
        first_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 如果 app_versions 表为空，插入默认版本记录
    const [countRows] = await this.systemPool.execute<RowDataPacket[]>(
      'SELECT COUNT(*) as cnt FROM app_versions'
    );

    if (countRows[0].cnt === 0) {
      await this.systemPool.execute(
        'INSERT INTO app_versions (version, required_version, release_notes, is_active) VALUES (?, ?, ?, TRUE)',
        [APP_VERSION, APP_VERSION, '自动初始化版本']
      );
    }
  }

  /**
   * 注册或更新设备信息到 devices 表
   * 使用 INSERT ... ON DUPLICATE KEY UPDATE 语义
   */
  private async registerDevice(deviceInfo: DeviceInfo): Promise<void> {
    await this.systemPool!.execute(
      `INSERT INTO devices (device_id, device_id_short, hostname, platform, app_version, database_name, last_seen, first_seen)
       VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())
       ON DUPLICATE KEY UPDATE
         hostname = VALUES(hostname),
         platform = VALUES(platform),
         app_version = VALUES(app_version),
         last_seen = NOW()`,
      [
        deviceInfo.deviceId,
        deviceInfo.deviceIdShort,
        deviceInfo.hostname,
        deviceInfo.platform,
        APP_VERSION,
        `hotel_agent_${deviceInfo.deviceIdShort}`,
      ]
    );
  }
}
