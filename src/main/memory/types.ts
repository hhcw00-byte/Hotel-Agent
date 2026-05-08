/**
 * Agent记忆系统核心类型定义
 */

/**
 * 酒店实体类型
 */
export type HotelType = 'own_hotel' | 'competitor';

/**
 * OTA平台枚举
 */
export type OTAPlatform = 'ctrip' | 'fliggy' | 'meituan' | 'qunar' | 'other';

/**
 * 记忆来源
 */
export type MemorySource = 'user_input' | 'auto_learning';

/**
 * 平台关联信息
 */
export interface PlatformInfo {
  platform: OTAPlatform;
  hotelId?: string;        // 平台上的酒店ID
  url?: string;            // 酒店详情页URL
  lastVerified?: Date;     // 最后验证时间
}

/**
 * 酒店实体
 */
export interface HotelEntity {
  id: string;                    // UUID
  name: string;                  // 酒店名称
  type: HotelType;               // 酒店类型
  platforms: PlatformInfo[];     // 平台关联信息
  source: MemorySource;          // 记忆来源
  createdAt: Date;               // 创建时间
  updatedAt: Date;               // 最后更新时间
  lastUsedAt?: Date;             // 最后使用时间
  usageCount: number;            // 使用次数
  isDeleted: boolean;            // 软删除标记
  metadata?: Record<string, any>; // 扩展元数据
}

/**
 * 记忆查询条件
 */
export interface MemoryQuery {
  type?: HotelType;              // 按类型过滤
  platform?: OTAPlatform;        // 按平台过滤
  nameKeyword?: string;          // 名称关键词
  includeDeleted?: boolean;      // 是否包含已删除
  sortBy?: 'createdAt' | 'updatedAt' | 'usageCount' | 'name';
  sortOrder?: 'asc' | 'desc';
  limit?: number;                // 结果数量限制
}

/**
 * 记忆统计信息
 */
export interface MemoryStats {
  totalCount: number;
  ownHotelCount: number;
  competitorCount: number;
  platformDistribution: Record<OTAPlatform, number>;
  mostUsedHotels: Array<{id: string; name: string; count: number}>;
  lastUpdateTime: Date;
}

/**
 * 操作结果
 */
export interface OperationResult<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
}

/**
 * 存储数据格式
 */
export interface MemoryStorageData {
  version: string;
  lastModified: string;
  entities: HotelEntity[];
}
