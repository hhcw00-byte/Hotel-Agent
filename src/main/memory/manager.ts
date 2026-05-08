/**
 * Memory Manager - 记忆管理器
 * 业务逻辑层，协调Store、Serializer、Retriever
 */

import { v4 as uuidv4 } from 'uuid';
import { HotelEntity, HotelType, MemoryQuery, MemoryStats, OperationResult, PlatformInfo, OTAPlatform } from './types';
import { IMemoryManager, IMemoryStore, IMemoryRetriever } from './interfaces';
import { MemoryStore } from './store';
import { MemoryRetriever } from './retriever';
import { MemorySerializer } from './serializer';
import { ValidationError, ResourceError, SystemError, ErrorCodes, MemoryError } from './errors';

export class MemoryManager implements IMemoryManager {
  private store: IMemoryStore;
  private retriever: IMemoryRetriever;
  private serializer: MemorySerializer;
  private entities: HotelEntity[] = [];
  private isInitialized = false;

  constructor(store?: IMemoryStore, retriever?: IMemoryRetriever) {
    this.store = store || new MemoryStore();
    this.retriever = retriever || new MemoryRetriever();
    this.serializer = new MemorySerializer();
  }

  /**
   * 初始化记忆系统
   */
  async initialize(): Promise<OperationResult<void>> {
    try {
      // 加载已保存的记忆数据
      this.entities = await this.store.load();
      this.isInitialized = true;

      return {
        success: true,
        data: undefined
      };
    } catch (error) {
      // 如果加载失败，尝试从备份恢复
      try {
        this.entities = await (this.store as MemoryStore).loadFromBackup();
        this.isInitialized = true;
        
        return {
          success: true,
          data: undefined
        };
      } catch (backupError) {
        // 备份也失败，使用空数据集
        this.entities = [];
        this.isInitialized = true;

        return {
          success: false,
          error: {
            code: ErrorCodes.FILE_READ_ERROR,
            message: 'Failed to load memory data, starting with empty dataset',
            details: {
              primaryError: error instanceof Error ? error.message : String(error),
              backupError: backupError instanceof Error ? backupError.message : String(backupError)
            }
          }
        };
      }
    }
  }

  /**
   * 创建新的酒店记忆
   */
  async createHotel(data: {
    name: string;
    type: HotelType;
    platforms?: PlatformInfo[];
    source?: 'user_input' | 'auto_learning';
  }): Promise<OperationResult<HotelEntity>> {
    try {
      // 检查系统是否已初始化
      if (!this.isInitialized) {
        throw new SystemError(
          ErrorCodes.NOT_INITIALIZED,
          'Memory system is not initialized'
        );
      }

      // 验证输入数据
      this.validateHotelData(data);

      // 检查重复酒店
      const duplicate = this.entities.find(
        e => e.name === data.name && !e.isDeleted
      );
      if (duplicate) {
        return {
          success: false,
          error: {
            code: ErrorCodes.DUPLICATE_HOTEL,
            message: `Hotel "${data.name}" already exists`,
            details: { existingId: duplicate.id }
          }
        };
      }

      // 创建新实体
      const now = new Date();
      const entity: HotelEntity = {
        id: uuidv4(),
        name: data.name,
        type: data.type,
        platforms: data.platforms || [],
        source: data.source || 'user_input',
        createdAt: now,
        updatedAt: now,
        usageCount: 0,
        isDeleted: false,
        metadata: {}
      };

      // 添加到内存
      this.entities.push(entity);

      // 持久化
      await this.store.save(this.entities);

      return {
        success: true,
        data: entity
      };
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * 检索酒店记忆
   */
  async retrieveHotels(query: MemoryQuery): Promise<OperationResult<HotelEntity[]>> {
    try {
      // 检查系统是否已初始化
      if (!this.isInitialized) {
        throw new SystemError(
          ErrorCodes.NOT_INITIALIZED,
          'Memory system is not initialized'
        );
      }

      // 使用检索器搜索
      const results = this.retriever.search(this.entities, query);

      // 更新使用统计
      for (const entity of results) {
        if (!entity.isDeleted) {
          entity.usageCount++;
          entity.lastUsedAt = new Date();
        }
      }

      // 保存更新后的统计信息
      await this.store.save(this.entities);

      return {
        success: true,
        data: results
      };
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * 更新酒店记忆
   */
  async updateHotel(id: string, updates: Partial<HotelEntity>): Promise<OperationResult<HotelEntity>> {
    try {
      // 检查系统是否已初始化
      if (!this.isInitialized) {
        throw new SystemError(
          ErrorCodes.NOT_INITIALIZED,
          'Memory system is not initialized'
        );
      }

      // 查找实体
      const entity = this.entities.find(e => e.id === id);
      if (!entity) {
        throw new ResourceError(
          ErrorCodes.HOTEL_NOT_FOUND,
          `Hotel with id "${id}" not found`
        );
      }

      // 验证更新数据
      if (updates.name !== undefined) {
        this.validateHotelName(updates.name);
      }
      if (updates.type !== undefined) {
        this.validateHotelType(updates.type);
      }

      // 应用更新
      Object.assign(entity, updates, {
        updatedAt: new Date()
      });

      // 持久化
      await this.store.save(this.entities);

      return {
        success: true,
        data: entity
      };
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * 删除酒店记忆（软删除）
   */
  async deleteHotel(id: string, requireConfirm?: boolean): Promise<OperationResult<void>> {
    try {
      // 检查系统是否已初始化
      if (!this.isInitialized) {
        throw new SystemError(
          ErrorCodes.NOT_INITIALIZED,
          'Memory system is not initialized'
        );
      }

      // 查找实体
      const entity = this.entities.find(e => e.id === id);
      if (!entity) {
        throw new ResourceError(
          ErrorCodes.HOTEL_NOT_FOUND,
          `Hotel with id "${id}" not found`
        );
      }

      // 如果是本店且需要确认
      if (entity.type === 'own_hotel' && requireConfirm !== true) {
        return {
          success: false,
          error: {
            code: 'CONFIRMATION_REQUIRED',
            message: 'Deleting own hotel requires confirmation',
            details: { requireConfirm: true }
          }
        };
      }

      // 物理删除（从数组中移除）
      this.entities = this.entities.filter(e => e.id !== id);

      // 持久化
      await this.store.save(this.entities);

      return {
        success: true,
        data: undefined
      };
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * 添加平台关联信息
   */
  async addPlatformInfo(hotelId: string, platformInfo: PlatformInfo): Promise<OperationResult<HotelEntity>> {
    try {
      // 检查系统是否已初始化
      if (!this.isInitialized) {
        throw new SystemError(
          ErrorCodes.NOT_INITIALIZED,
          'Memory system is not initialized'
        );
      }

      // 验证平台信息
      this.validatePlatform(platformInfo.platform);

      // 查找实体
      const entity = this.entities.find(e => e.id === hotelId);
      if (!entity) {
        throw new ResourceError(
          ErrorCodes.HOTEL_NOT_FOUND,
          `Hotel with id "${hotelId}" not found`
        );
      }

      // 检查是否已存在该平台的信息
      const existingIndex = entity.platforms.findIndex(
        p => p.platform === platformInfo.platform
      );

      if (existingIndex >= 0) {
        // 更新现有平台信息
        entity.platforms[existingIndex] = platformInfo;
      } else {
        // 添加新平台信息
        entity.platforms.push(platformInfo);
      }

      entity.updatedAt = new Date();

      // 持久化
      await this.store.save(this.entities);

      return {
        success: true,
        data: entity
      };
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * 获取统计信息
   */
  async getStats(): Promise<OperationResult<MemoryStats>> {
    try {
      // 检查系统是否已初始化
      if (!this.isInitialized) {
        throw new SystemError(
          ErrorCodes.NOT_INITIALIZED,
          'Memory system is not initialized'
        );
      }

      const activeEntities = this.entities.filter(e => !e.isDeleted);

      // 统计本店和竞品数量
      const ownHotelCount = activeEntities.filter(e => e.type === 'own_hotel').length;
      const competitorCount = activeEntities.filter(e => e.type === 'competitor').length;

      // 统计平台分布
      const platformDistribution: Record<OTAPlatform, number> = {
        ctrip: 0,
        fliggy: 0,
        meituan: 0,
        qunar: 0,
        other: 0
      };

      for (const entity of activeEntities) {
        for (const platform of entity.platforms) {
          platformDistribution[platform.platform]++;
        }
      }

      // 找出最常用的酒店（按usageCount降序）
      const sortedByUsage = [...activeEntities].sort((a, b) => b.usageCount - a.usageCount);
      const mostUsedHotels = sortedByUsage.slice(0, 10).map(e => ({
        id: e.id,
        name: e.name,
        count: e.usageCount
      }));

      // 找出最后更新时间
      const lastUpdateTime = activeEntities.length > 0
        ? new Date(Math.max(...activeEntities.map(e => e.updatedAt.getTime())))
        : new Date();

      const stats: MemoryStats = {
        totalCount: activeEntities.length,
        ownHotelCount,
        competitorCount,
        platformDistribution,
        mostUsedHotels,
        lastUpdateTime
      };

      return {
        success: true,
        data: stats
      };
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * 导入记忆数据
   */
  async importMemories(jsonData: string): Promise<OperationResult<{imported: number; skipped: number}>> {
    try {
      // 检查系统是否已初始化
      if (!this.isInitialized) {
        throw new SystemError(
          ErrorCodes.NOT_INITIALIZED,
          'Memory system is not initialized'
        );
      }

      // 验证JSON格式
      const validation = this.serializer.validate(jsonData);
      if (!validation.valid) {
        throw new ValidationError(
          ErrorCodes.INVALID_JSON,
          'Invalid import data format',
          { errors: validation.errors }
        );
      }

      // 反序列化
      const importedEntities = this.serializer.deserialize(jsonData);

      let imported = 0;
      let skipped = 0;

      // 逐个导入实体
      for (const entity of importedEntities) {
        // 检查是否已存在同名酒店
        const existing = this.entities.find(
          e => e.name === entity.name && !e.isDeleted
        );

        if (existing) {
          skipped++;
        } else {
          // 生成新ID和时间戳
          entity.id = uuidv4();
          entity.createdAt = new Date();
          entity.updatedAt = new Date();
          this.entities.push(entity);
          imported++;
        }
      }

      // 持久化
      await this.store.save(this.entities);

      return {
        success: true,
        data: { imported, skipped }
      };
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * 导出记忆数据
   */
  async exportMemories(): Promise<OperationResult<string>> {
    try {
      // 检查系统是否已初始化
      if (!this.isInitialized) {
        throw new SystemError(
          ErrorCodes.NOT_INITIALIZED,
          'Memory system is not initialized'
        );
      }

      // 只导出未删除的实体
      const activeEntities = this.entities.filter(e => !e.isDeleted);

      // 序列化为格式化的JSON
      const jsonData = this.serializer.prettyPrint(activeEntities);

      return {
        success: true,
        data: jsonData
      };
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * 验证酒店数据
   */
  private validateHotelData(data: { name: string; type: HotelType }): void {
    this.validateHotelName(data.name);
    this.validateHotelType(data.type);
  }

  /**
   * 验证酒店名称
   */
  private validateHotelName(name: string): void {
    if (!name || name.trim().length === 0) {
      throw new ValidationError(
        ErrorCodes.INVALID_HOTEL_NAME,
        'Hotel name cannot be empty'
      );
    }

    if (name.length > 200) {
      throw new ValidationError(
        ErrorCodes.INVALID_HOTEL_NAME,
        'Hotel name is too long (max 200 characters)',
        { length: name.length }
      );
    }
  }

  /**
   * 验证酒店类型
   */
  private validateHotelType(type: HotelType): void {
    if (type !== 'own_hotel' && type !== 'competitor') {
      throw new ValidationError(
        ErrorCodes.INVALID_HOTEL_TYPE,
        `Invalid hotel type "${type}", must be "own_hotel" or "competitor"`
      );
    }
  }

  /**
   * 验证平台类型
   */
  private validatePlatform(platform: OTAPlatform): void {
    const validPlatforms: OTAPlatform[] = ['ctrip', 'fliggy', 'meituan', 'qunar', 'other'];
    if (!validPlatforms.includes(platform)) {
      throw new ValidationError(
        ErrorCodes.INVALID_PLATFORM,
        `Invalid platform "${platform}"`,
        { validPlatforms }
      );
    }
  }

  /**
   * 统一错误处理
   */
  private handleError(error: unknown): OperationResult<any> {
    if (error instanceof MemoryError) {
      return {
        success: false,
        error: {
          code: error.code,
          message: error.message,
          details: error.details
        }
      };
    }

    return {
      success: false,
      error: {
        code: ErrorCodes.INTERNAL_ERROR,
        message: error instanceof Error ? error.message : String(error)
      }
    };
  }
}

// Singleton instance
let memoryManagerInstance: MemoryManager | null = null;

/**
 * 获取或创建MemoryManager单例
 */
export function getMemoryManager(): MemoryManager {
  if (!memoryManagerInstance) {
    memoryManagerInstance = new MemoryManager();
  }
  return memoryManagerInstance;
}
