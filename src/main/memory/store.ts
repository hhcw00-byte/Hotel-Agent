/**
 * Memory Store - 存储层实现
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { HotelEntity, MemoryStorageData } from './types';
import { IMemoryStore } from './interfaces';
import { getBasePath } from '../path-resolver';
import { StorageError, ErrorCodes } from './errors';

export class MemoryStore implements IMemoryStore {
  private storagePath: string;
  private backupPath: string;
  private readonly STORAGE_DIR = 'memory';
  private readonly STORAGE_FILE = 'hotels.json';
  private readonly BACKUP_FILE = 'hotels.backup.json';
  private readonly VERSION = '1.0.0';

  constructor() {
    const rootPath = getBasePath();
    const memoryDir = path.join(rootPath, 'data', this.STORAGE_DIR);
    this.storagePath = path.join(memoryDir, this.STORAGE_FILE);
    this.backupPath = path.join(memoryDir, this.BACKUP_FILE);
  }

  /**
   * 获取存储文件路径
   */
  getStoragePath(): string {
    return this.storagePath;
  }

  /**
   * 加载所有记忆数据
   */
  async load(): Promise<HotelEntity[]> {
    try {
      // 确保目录存在
      await this.ensureDirectoryExists();

      // 检查文件是否存在
      try {
        await fs.access(this.storagePath);
      } catch {
        // 文件不存在，返回空数组
        return [];
      }

      // 读取文件
      const content = await fs.readFile(this.storagePath, 'utf-8');
      const data: MemoryStorageData = JSON.parse(content);

      // 转换日期字符串为Date对象
      return data.entities.map(entity => this.deserializeEntity(entity));
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new StorageError(
          ErrorCodes.CORRUPTED_DATA,
          'Failed to parse storage file: invalid JSON format',
          { error: error.message }
        );
      }
      throw new StorageError(
        ErrorCodes.FILE_READ_ERROR,
        'Failed to load memory data',
        { error: error instanceof Error ? error.message : String(error) }
      );
    }
  }

  /**
   * 保存所有记忆数据（原子性写入）
   */
  async save(entities: HotelEntity[]): Promise<void> {
    try {
      // 确保目录存在
      await this.ensureDirectoryExists();

      // 准备存储数据
      const data: MemoryStorageData = {
        version: this.VERSION,
        lastModified: new Date().toISOString(),
        entities: entities.map(entity => this.serializeEntity(entity))
      };

      // 序列化为JSON
      const content = JSON.stringify(data, null, 2);

      // 原子性写入：先写入临时文件，然后重命名
      const tempPath = `${this.storagePath}.tmp`;
      await fs.writeFile(tempPath, content, 'utf-8');
      await fs.rename(tempPath, this.storagePath);
    } catch (error) {
      throw new StorageError(
        ErrorCodes.FILE_WRITE_ERROR,
        'Failed to save memory data',
        { error: error instanceof Error ? error.message : String(error) }
      );
    }
  }

  /**
   * 创建备份
   */
  async createBackup(): Promise<string> {
    try {
      // 检查主文件是否存在
      try {
        await fs.access(this.storagePath);
      } catch {
        throw new StorageError(
          ErrorCodes.FILE_READ_ERROR,
          'Cannot create backup: storage file does not exist'
        );
      }

      // 复制主文件到备份文件
      await fs.copyFile(this.storagePath, this.backupPath);
      return this.backupPath;
    } catch (error) {
      if (error instanceof StorageError) {
        throw error;
      }
      throw new StorageError(
        ErrorCodes.FILE_WRITE_ERROR,
        'Failed to create backup',
        { error: error instanceof Error ? error.message : String(error) }
      );
    }
  }

  /**
   * 从备份恢复
   */
  async restoreFromBackup(backupPath?: string): Promise<void> {
    try {
      const sourceBackup = backupPath || this.backupPath;

      // 检查备份文件是否存在
      try {
        await fs.access(sourceBackup);
      } catch {
        throw new StorageError(
          ErrorCodes.FILE_READ_ERROR,
          'Cannot restore: backup file does not exist',
          { backupPath: sourceBackup }
        );
      }

      // 复制备份文件到主文件
      await fs.copyFile(sourceBackup, this.storagePath);
    } catch (error) {
      if (error instanceof StorageError) {
        throw error;
      }
      throw new StorageError(
        ErrorCodes.FILE_WRITE_ERROR,
        'Failed to restore from backup',
        { error: error instanceof Error ? error.message : String(error) }
      );
    }
  }

  /**
   * 尝试从备份加载数据（用于数据恢复）
   */
  async loadFromBackup(): Promise<HotelEntity[]> {
    try {
      await fs.access(this.backupPath);
      const content = await fs.readFile(this.backupPath, 'utf-8');
      const data: MemoryStorageData = JSON.parse(content);
      return data.entities.map(entity => this.deserializeEntity(entity));
    } catch (error) {
      throw new StorageError(
        ErrorCodes.FILE_READ_ERROR,
        'Failed to load backup data',
        { error: error instanceof Error ? error.message : String(error) }
      );
    }
  }

  /**
   * 确保存储目录存在
   */
  private async ensureDirectoryExists(): Promise<void> {
    const dir = path.dirname(this.storagePath);
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (error) {
      throw new StorageError(
        ErrorCodes.PERMISSION_DENIED,
        'Failed to create storage directory',
        { error: error instanceof Error ? error.message : String(error) }
      );
    }
  }

  /**
   * 序列化实体（将Date对象转换为ISO字符串）
   */
  private serializeEntity(entity: HotelEntity): any {
    return {
      ...entity,
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
      lastUsedAt: entity.lastUsedAt?.toISOString(),
      platforms: entity.platforms.map(p => ({
        ...p,
        lastVerified: p.lastVerified?.toISOString()
      }))
    };
  }

  /**
   * 反序列化实体（将ISO字符串转换为Date对象）
   */
  private deserializeEntity(entity: any): HotelEntity {
    return {
      ...entity,
      createdAt: new Date(entity.createdAt),
      updatedAt: new Date(entity.updatedAt),
      lastUsedAt: entity.lastUsedAt ? new Date(entity.lastUsedAt) : undefined,
      platforms: entity.platforms.map((p: any) => ({
        ...p,
        lastVerified: p.lastVerified ? new Date(p.lastVerified) : undefined
      }))
    };
  }
}
