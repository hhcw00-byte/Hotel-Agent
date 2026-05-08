/**
 * Agent记忆系统接口定义
 */

import { HotelEntity, HotelType, MemoryQuery, MemoryStats, OperationResult, PlatformInfo } from './types';

/**
 * Memory Manager接口
 */
export interface IMemoryManager {
  /**
   * 初始化记忆系统
   */
  initialize(): Promise<OperationResult<void>>;
  
  /**
   * 创建新的酒店记忆
   */
  createHotel(data: {
    name: string;
    type: HotelType;
    platforms?: PlatformInfo[];
    source?: 'user_input' | 'auto_learning';
  }): Promise<OperationResult<HotelEntity>>;
  
  /**
   * 检索酒店记忆
   */
  retrieveHotels(query: MemoryQuery): Promise<OperationResult<HotelEntity[]>>;
  
  /**
   * 更新酒店记忆
   */
  updateHotel(id: string, updates: Partial<HotelEntity>): Promise<OperationResult<HotelEntity>>;
  
  /**
   * 删除酒店记忆（软删除）
   */
  deleteHotel(id: string, requireConfirm?: boolean): Promise<OperationResult<void>>;
  
  /**
   * 添加平台关联信息
   */
  addPlatformInfo(hotelId: string, platformInfo: PlatformInfo): Promise<OperationResult<HotelEntity>>;
  
  /**
   * 获取统计信息
   */
  getStats(): Promise<OperationResult<MemoryStats>>;
  
  /**
   * 导入记忆数据
   */
  importMemories(jsonData: string): Promise<OperationResult<{imported: number; skipped: number}>>;
  
  /**
   * 导出记忆数据
   */
  exportMemories(): Promise<OperationResult<string>>;
}

/**
 * Memory Store接口
 */
export interface IMemoryStore {
  /**
   * 加载所有记忆数据
   */
  load(): Promise<HotelEntity[]>;
  
  /**
   * 保存所有记忆数据
   */
  save(entities: HotelEntity[]): Promise<void>;
  
  /**
   * 获取存储文件路径
   */
  getStoragePath(): string;
  
  /**
   * 创建备份
   */
  createBackup(): Promise<string>;
  
  /**
   * 从备份恢复
   */
  restoreFromBackup(backupPath: string): Promise<void>;
}

/**
 * Memory Serializer接口
 */
export interface IMemorySerializer {
  /**
   * 序列化为JSON字符串
   */
  serialize(entities: HotelEntity[]): string;
  
  /**
   * 从JSON字符串反序列化
   */
  deserialize(jsonString: string): HotelEntity[];
  
  /**
   * 格式化输出
   */
  prettyPrint(entities: HotelEntity[]): string;
  
  /**
   * 验证数据格式
   */
  validate(jsonString: string): {valid: boolean; errors?: string[]};
}

/**
 * Memory Retriever接口
 */
export interface IMemoryRetriever {
  /**
   * 搜索记忆
   */
  search(entities: HotelEntity[], query: MemoryQuery): HotelEntity[];
}
