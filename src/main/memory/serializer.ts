/**
 * Memory Serializer - 序列化器实现
 */

import { HotelEntity } from './types';
import { IMemorySerializer } from './interfaces';
import { SerializationError, ErrorCodes } from './errors';

export class MemorySerializer implements IMemorySerializer {
  /**
   * 序列化为JSON字符串
   */
  serialize(entities: HotelEntity[]): string {
    try {
      return JSON.stringify(entities);
    } catch (error) {
      throw new SerializationError(
        ErrorCodes.ENCODING_ERROR,
        'Failed to serialize entities',
        { error: error instanceof Error ? error.message : String(error) }
      );
    }
  }

  /**
   * 从JSON字符串反序列化
   */
  deserialize(jsonString: string): HotelEntity[] {
    try {
      const parsed = JSON.parse(jsonString);
      
      // 验证是否为数组
      if (!Array.isArray(parsed)) {
        throw new SerializationError(
          ErrorCodes.PARSE_ERROR,
          'Invalid data format: expected an array',
          { type: typeof parsed }
        );
      }

      // 验证并转换每个实体
      return parsed.map((item, index) => this.validateAndConvertEntity(item, index));
    } catch (error) {
      if (error instanceof SerializationError) {
        throw error;
      }
      if (error instanceof SyntaxError) {
        throw new SerializationError(
          ErrorCodes.INVALID_JSON,
          'Invalid JSON format',
          { error: error.message }
        );
      }
      throw new SerializationError(
        ErrorCodes.PARSE_ERROR,
        'Failed to deserialize entities',
        { error: error instanceof Error ? error.message : String(error) }
      );
    }
  }

  /**
   * 格式化输出（2空格缩进，字段排序）
   */
  prettyPrint(entities: HotelEntity[]): string {
    try {
      // 对每个实体的字段进行排序
      const sortedEntities = entities.map(entity => this.sortEntityFields(entity));
      return JSON.stringify(sortedEntities, null, 2);
    } catch (error) {
      throw new SerializationError(
        ErrorCodes.ENCODING_ERROR,
        'Failed to pretty print entities',
        { error: error instanceof Error ? error.message : String(error) }
      );
    }
  }

  /**
   * 验证数据格式
   */
  validate(jsonString: string): { valid: boolean; errors?: string[] } {
    const errors: string[] = [];

    try {
      const parsed = JSON.parse(jsonString);

      // 验证是否为数组
      if (!Array.isArray(parsed)) {
        errors.push('Data must be an array');
        return { valid: false, errors };
      }

      // 验证每个实体
      parsed.forEach((item, index) => {
        const entityErrors = this.validateEntity(item, index);
        errors.push(...entityErrors);
      });

      return {
        valid: errors.length === 0,
        errors: errors.length > 0 ? errors : undefined
      };
    } catch (error) {
      if (error instanceof SyntaxError) {
        errors.push(`Invalid JSON format: ${error.message}`);
      } else {
        errors.push(`Validation error: ${error instanceof Error ? error.message : String(error)}`);
      }
      return { valid: false, errors };
    }
  }

  /**
   * 验证并转换实体
   */
  private validateAndConvertEntity(item: any, index: number): HotelEntity {
    const errors = this.validateEntity(item, index);
    if (errors.length > 0) {
      throw new SerializationError(
        ErrorCodes.PARSE_ERROR,
        `Invalid entity at index ${index}: ${errors.join(', ')}`,
        { errors }
      );
    }

    // 转换日期字符串为Date对象
    return {
      id: item.id,
      name: item.name,
      type: item.type,
      platforms: (item.platforms || []).map((p: any) => ({
        platform: p.platform,
        hotelId: p.hotelId,
        url: p.url,
        lastVerified: p.lastVerified ? new Date(p.lastVerified) : undefined
      })),
      source: item.source || 'user_input',
      createdAt: new Date(item.createdAt),
      updatedAt: new Date(item.updatedAt),
      lastUsedAt: item.lastUsedAt ? new Date(item.lastUsedAt) : undefined,
      usageCount: item.usageCount ?? 0,
      isDeleted: item.isDeleted ?? false,
      metadata: item.metadata
    };
  }

  /**
   * 验证实体字段
   */
  private validateEntity(item: any, index: number): string[] {
    const errors: string[] = [];
    const prefix = `Entity at index ${index}`;

    // 验证必需字段
    if (!item.id) {
      errors.push(`${prefix}: missing required field 'id'`);
    }
    if (!item.name) {
      errors.push(`${prefix}: missing required field 'name'`);
    }
    if (!item.type) {
      errors.push(`${prefix}: missing required field 'type'`);
    } else if (item.type !== 'own_hotel' && item.type !== 'competitor') {
      errors.push(`${prefix}: invalid type '${item.type}', must be 'own_hotel' or 'competitor'`);
    }
    if (!item.createdAt) {
      errors.push(`${prefix}: missing required field 'createdAt'`);
    }
    if (!item.updatedAt) {
      errors.push(`${prefix}: missing required field 'updatedAt'`);
    }
    if (item.isDeleted === undefined) {
      errors.push(`${prefix}: missing required field 'isDeleted'`);
    }

    return errors;
  }

  /**
   * 对实体字段进行字母排序
   */
  private sortEntityFields(entity: HotelEntity): any {
    const sorted: any = {};
    const keys = Object.keys(entity).sort();
    
    for (const key of keys) {
      const value = (entity as any)[key];
      
      // 处理Date对象
      if (value instanceof Date) {
        sorted[key] = value.toISOString();
      }
      // 处理platforms数组
      else if (key === 'platforms' && Array.isArray(value)) {
        sorted[key] = value.map(p => this.sortPlatformFields(p));
      }
      // 处理metadata对象
      else if (key === 'metadata' && value && typeof value === 'object') {
        sorted[key] = this.sortObjectFields(value);
      }
      // 其他字段直接复制
      else {
        sorted[key] = value;
      }
    }
    
    return sorted;
  }

  /**
   * 对平台信息字段进行排序
   */
  private sortPlatformFields(platform: any): any {
    const sorted: any = {};
    const keys = Object.keys(platform).sort();
    
    for (const key of keys) {
      const value = platform[key];
      if (value instanceof Date) {
        sorted[key] = value.toISOString();
      } else {
        sorted[key] = value;
      }
    }
    
    return sorted;
  }

  /**
   * 对对象字段进行排序
   */
  private sortObjectFields(obj: Record<string, any>): any {
    const sorted: any = {};
    const keys = Object.keys(obj).sort();
    
    for (const key of keys) {
      sorted[key] = obj[key];
    }
    
    return sorted;
  }
}
