/**
 * Memory Retriever 属性测试
 * 使用 fast-check 进行基于属性的测试
 */

import * as fc from 'fast-check';
import { MemoryRetriever } from '../../retriever';
import { HotelEntity, HotelType, OTAPlatform, MemoryQuery, MemorySource } from '../../types';

// 测试数据生成器
const hotelTypeArb = fc.constantFrom<HotelType>('own_hotel', 'competitor');
const platformArb = fc.constantFrom<OTAPlatform>('ctrip', 'fliggy', 'meituan', 'qunar', 'other');
const memorySourceArb = fc.constantFrom<MemorySource>('user_input', 'auto_learning');

const platformInfoArb = fc.record({
  platform: platformArb,
  hotelId: fc.option(fc.string(), { nil: undefined }),
  url: fc.option(fc.webUrl(), { nil: undefined }),
  lastVerified: fc.option(fc.date(), { nil: undefined })
});

const hotelEntityArb = fc.record({
  id: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 200 }),
  type: hotelTypeArb,
  platforms: fc.array(platformInfoArb, { minLength: 0, maxLength: 5 }),
  source: memorySourceArb,
  createdAt: fc.date(),
  updatedAt: fc.date(),
  lastUsedAt: fc.option(fc.date(), { nil: undefined }),
  usageCount: fc.nat(),
  isDeleted: fc.boolean(),
  metadata: fc.option(fc.dictionary(fc.string(), fc.anything()), { nil: undefined })
});

describe('Memory Retriever Property Tests', () => {
  let retriever: MemoryRetriever;

  beforeEach(() => {
    retriever = new MemoryRetriever();
  });

  /**
   * Feature: agent-memory-system, Property 5: 类型过滤准确性
   * **Validates: Requirements 2.1, 2.2, 8.2, 8.3, 13.2**
   * 
   * 对于任意酒店类型（own_hotel或competitor），按该类型检索时返回的所有Hotel_Entity的type字段
   * 都应该等于查询的类型，且不应该遗漏任何该类型的未删除实体。
   */
  describe('Property 5: 类型过滤准确性', () => {
    it('should return only entities matching the queried type', () => {
      fc.assert(
        fc.property(
          fc.array(hotelEntityArb, { minLength: 0, maxLength: 50 }),
          hotelTypeArb,
          (entities, queryType) => {
            const query: MemoryQuery = { type: queryType };
            const results = retriever.search(entities, query);

            // 所有返回的实体类型都应该匹配查询类型
            const allMatchType = results.every(entity => entity.type === queryType);

            // 不应该遗漏任何该类型的未删除实体
            const expectedEntities = entities.filter(
              e => e.type === queryType && !e.isDeleted
            );
            const allFound = expectedEntities.every(expected =>
              results.some(result => result.id === expected.id)
            );

            return allMatchType && allFound;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should filter out deleted entities by default', () => {
      fc.assert(
        fc.property(
          fc.array(hotelEntityArb, { minLength: 0, maxLength: 50 }),
          hotelTypeArb,
          (entities, queryType) => {
            const query: MemoryQuery = { type: queryType };
            const results = retriever.search(entities, query);

            // 默认不应该返回已删除的实体
            return results.every(entity => !entity.isDeleted);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Feature: agent-memory-system, Property 6: 模糊搜索匹配
   * **Validates: Requirements 2.3, 13.1**
   * 
   * 对于任意包含特定关键词的酒店名称，使用该关键词进行模糊搜索时，
   * 返回结果应该包含所有名称中包含该关键词的Hotel_Entity（不区分大小写）。
   */
  describe('Property 6: 模糊搜索匹配', () => {
    it('should match all entities containing the keyword (case-insensitive)', () => {
      fc.assert(
        fc.property(
          fc.array(hotelEntityArb, { minLength: 0, maxLength: 50 }),
          fc.string({ minLength: 1, maxLength: 10 }),
          (entities, keyword) => {
            const query: MemoryQuery = { nameKeyword: keyword };
            const results = retriever.search(entities, query);

            // 所有返回的实体名称都应该包含关键词（不区分大小写）
            const allMatch = results.every(entity =>
              entity.name.toLowerCase().includes(keyword.toLowerCase())
            );

            // 不应该遗漏任何包含关键词的未删除实体
            const expectedEntities = entities.filter(
              e => !e.isDeleted && e.name.toLowerCase().includes(keyword.toLowerCase())
            );
            const allFound = expectedEntities.every(expected =>
              results.some(result => result.id === expected.id)
            );

            return allMatch && allFound;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should be case-insensitive', () => {
      fc.assert(
        fc.property(
          fc.array(hotelEntityArb, { minLength: 1, maxLength: 20 }),
          (entities) => {
            // 选择第一个未删除的实体
            const targetEntity = entities.find(e => !e.isDeleted);
            if (!targetEntity || targetEntity.name.length === 0) return true;

            const keyword = targetEntity.name.substring(0, Math.min(3, targetEntity.name.length));
            
            // 测试不同大小写的关键词
            const lowerResults = retriever.search(entities, { nameKeyword: keyword.toLowerCase() });
            const upperResults = retriever.search(entities, { nameKeyword: keyword.toUpperCase() });
            const mixedResults = retriever.search(entities, { nameKeyword: keyword });

            // 三种大小写应该返回相同的结果
            return lowerResults.length === upperResults.length &&
                   lowerResults.length === mixedResults.length;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Feature: agent-memory-system, Property 13: 平台过滤准确性
   * **Validates: Requirements 5.5, 13.3**
   * 
   * 对于任意OTA平台类型，按该平台检索时，返回的所有Hotel_Entity的platforms数组中
   * 都应该至少包含一个platform字段等于查询平台的PlatformInfo对象。
   */
  describe('Property 13: 平台过滤准确性', () => {
    it('should return only entities with the queried platform', () => {
      fc.assert(
        fc.property(
          fc.array(hotelEntityArb, { minLength: 0, maxLength: 50 }),
          platformArb,
          (entities, queryPlatform) => {
            const query: MemoryQuery = { platform: queryPlatform };
            const results = retriever.search(entities, query);

            // 所有返回的实体都应该包含查询的平台
            const allHavePlatform = results.every(entity =>
              entity.platforms.some(p => p.platform === queryPlatform)
            );

            // 不应该遗漏任何包含该平台的未删除实体
            const expectedEntities = entities.filter(
              e => !e.isDeleted && e.platforms.some(p => p.platform === queryPlatform)
            );
            const allFound = expectedEntities.every(expected =>
              results.some(result => result.id === expected.id)
            );

            return allHavePlatform && allFound;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Feature: agent-memory-system, Property 18: 组合查询准确性
   * **Validates: Requirements 8.4, 13.5**
   * 
   * 对于任意多个查询条件的组合（如type和platform同时指定），
   * 返回的所有Hotel_Entity都应该同时满足所有指定的条件。
   */
  describe('Property 18: 组合查询准确性', () => {
    it('should return entities matching all specified conditions', () => {
      fc.assert(
        fc.property(
          fc.array(hotelEntityArb, { minLength: 0, maxLength: 50 }),
          hotelTypeArb,
          platformArb,
          fc.string({ minLength: 1, maxLength: 5 }),
          (entities, queryType, queryPlatform, keyword) => {
            const query: MemoryQuery = {
              type: queryType,
              platform: queryPlatform,
              nameKeyword: keyword
            };
            const results = retriever.search(entities, query);

            // 所有返回的实体都应该同时满足所有条件
            const allMatch = results.every(entity =>
              entity.type === queryType &&
              entity.platforms.some(p => p.platform === queryPlatform) &&
              entity.name.toLowerCase().includes(keyword.toLowerCase()) &&
              !entity.isDeleted
            );

            // 不应该遗漏任何满足所有条件的未删除实体
            const expectedEntities = entities.filter(
              e => !e.isDeleted &&
                   e.type === queryType &&
                   e.platforms.some(p => p.platform === queryPlatform) &&
                   e.name.toLowerCase().includes(keyword.toLowerCase())
            );
            const allFound = expectedEntities.every(expected =>
              results.some(result => result.id === expected.id)
            );

            return allMatch && allFound;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle empty query (return all non-deleted entities)', () => {
      fc.assert(
        fc.property(
          fc.array(hotelEntityArb, { minLength: 0, maxLength: 50 }),
          (entities) => {
            const query: MemoryQuery = {};
            const results = retriever.search(entities, query);

            // 应该返回所有未删除的实体
            const expectedCount = entities.filter(e => !e.isDeleted).length;
            return results.length === expectedCount &&
                   results.every(entity => !entity.isDeleted);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Feature: agent-memory-system, Property 27: 结果排序正确性
   * **Validates: Requirements 13.4**
   * 
   * 对于任意指定的排序字段（createdAt、updatedAt、usageCount、name）和排序方向（升序或降序），
   * 返回的结果集应该按照指定字段和方向正确排序。
   */
  describe('Property 27: 结果排序正确性', () => {
    it('should sort by createdAt correctly', () => {
      fc.assert(
        fc.property(
          fc.array(hotelEntityArb, { minLength: 2, maxLength: 20 }),
          fc.constantFrom<'asc' | 'desc'>('asc', 'desc'),
          (entities, sortOrder) => {
            const query: MemoryQuery = { sortBy: 'createdAt', sortOrder };
            const results = retriever.search(entities, query);

            // 验证排序是否正确
            return isSorted(results, (a, b) => {
              const comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
              return sortOrder === 'asc' ? comparison : -comparison;
            });
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should sort by updatedAt correctly', () => {
      fc.assert(
        fc.property(
          fc.array(hotelEntityArb, { minLength: 2, maxLength: 20 }),
          fc.constantFrom<'asc' | 'desc'>('asc', 'desc'),
          (entities, sortOrder) => {
            const query: MemoryQuery = { sortBy: 'updatedAt', sortOrder };
            const results = retriever.search(entities, query);

            return isSorted(results, (a, b) => {
              const comparison = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
              return sortOrder === 'asc' ? comparison : -comparison;
            });
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should sort by usageCount correctly', () => {
      fc.assert(
        fc.property(
          fc.array(hotelEntityArb, { minLength: 2, maxLength: 20 }),
          fc.constantFrom<'asc' | 'desc'>('asc', 'desc'),
          (entities, sortOrder) => {
            const query: MemoryQuery = { sortBy: 'usageCount', sortOrder };
            const results = retriever.search(entities, query);

            return isSorted(results, (a, b) => {
              const comparison = a.usageCount - b.usageCount;
              return sortOrder === 'asc' ? comparison : -comparison;
            });
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should sort by name correctly', () => {
      fc.assert(
        fc.property(
          fc.array(hotelEntityArb, { minLength: 2, maxLength: 20 }),
          fc.constantFrom<'asc' | 'desc'>('asc', 'desc'),
          (entities, sortOrder) => {
            const query: MemoryQuery = { sortBy: 'name', sortOrder };
            const results = retriever.search(entities, query);

            return isSorted(results, (a, b) => {
              const comparison = a.name.localeCompare(b.name);
              return sortOrder === 'asc' ? comparison : -comparison;
            });
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should respect limit parameter', () => {
      fc.assert(
        fc.property(
          fc.array(hotelEntityArb, { minLength: 5, maxLength: 50 }),
          fc.integer({ min: 1, max: 10 }),
          (entities, limit) => {
            const query: MemoryQuery = { limit };
            const results = retriever.search(entities, query);

            // 结果数量不应该超过limit
            const nonDeletedCount = entities.filter(e => !e.isDeleted).length;
            const expectedCount = Math.min(limit, nonDeletedCount);
            return results.length <= expectedCount;
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});

/**
 * 辅助函数：检查数组是否按照给定的比较函数排序
 */
function isSorted<T>(arr: T[], compareFn: (a: T, b: T) => number): boolean {
  for (let i = 0; i < arr.length - 1; i++) {
    if (compareFn(arr[i], arr[i + 1]) > 0) {
      return false;
    }
  }
  return true;
}
