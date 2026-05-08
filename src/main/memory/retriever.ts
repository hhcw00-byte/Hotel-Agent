/**
 * Memory Retriever - 记忆检索器
 * 负责根据查询条件检索相关记忆
 */

import { HotelEntity, MemoryQuery } from './types';
import { IMemoryRetriever } from './interfaces';

export class MemoryRetriever implements IMemoryRetriever {
  /**
   * 搜索记忆
   * @param entities 所有实体
   * @param query 查询条件
   * @returns 过滤和排序后的实体列表
   */
  search(entities: HotelEntity[], query: MemoryQuery): HotelEntity[] {
    let results = [...entities];

    // 1. 过滤已删除的实体（除非明确要求包含）
    if (!query.includeDeleted) {
      results = results.filter(entity => !entity.isDeleted);
    }

    // 2. 按类型过滤
    if (query.type) {
      results = results.filter(entity => entity.type === query.type);
    }

    // 3. 按平台过滤
    if (query.platform) {
      results = results.filter(entity => 
        entity.platforms.some(p => p.platform === query.platform)
      );
    }

    // 4. 模糊名称搜索（不区分大小写）
    if (query.nameKeyword) {
      const keyword = query.nameKeyword.toLowerCase();
      results = results.filter(entity => 
        entity.name.toLowerCase().includes(keyword)
      );
    }

    // 5. 排序
    if (query.sortBy) {
      const sortOrder = query.sortOrder || 'asc';
      results = this.sortResults(results, query.sortBy, sortOrder);
    }

    // 6. 限制结果数量
    if (query.limit && query.limit > 0) {
      results = results.slice(0, query.limit);
    }

    return results;
  }

  /**
   * 对结果进行排序
   */
  private sortResults(
    entities: HotelEntity[], 
    sortBy: 'createdAt' | 'updatedAt' | 'usageCount' | 'name',
    sortOrder: 'asc' | 'desc'
  ): HotelEntity[] {
    const sorted = [...entities];
    
    sorted.sort((a, b) => {
      let comparison = 0;

      switch (sortBy) {
        case 'createdAt':
          comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          break;
        case 'updatedAt':
          comparison = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
          break;
        case 'usageCount':
          comparison = a.usageCount - b.usageCount;
          break;
        case 'name':
          comparison = a.name.localeCompare(b.name);
          break;
      }

      return sortOrder === 'asc' ? comparison : -comparison;
    });

    return sorted;
  }
}
