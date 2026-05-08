/**
 * Memory Manager Property-Based Tests
 * 使用fast-check验证Memory Manager的正确性属性
 */

import * as fc from 'fast-check';
import { MemoryManager } from '../../manager';
import { IMemoryStore } from '../../interfaces';
import { HotelEntity, HotelType, OTAPlatform, PlatformInfo } from '../../types';

// Mock uuid module
jest.mock('uuid', () => ({
  v4: jest.fn(() => {
    // Generate a simple UUID-like string for testing
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  })
}));

// Mock Store for testing
class MockMemoryStore implements IMemoryStore {
  private data: HotelEntity[] = [];

  async load(): Promise<HotelEntity[]> {
    return [...this.data];
  }

  async save(entities: HotelEntity[]): Promise<void> {
    this.data = [...entities];
  }

  getStoragePath(): string {
    return '/mock/path/hotels.json';
  }

  async createBackup(): Promise<string> {
    return '/mock/path/hotels.backup.json';
  }

  async restoreFromBackup(): Promise<void> {
    // Mock implementation
  }
}

// Arbitraries for generating test data
const hotelNameArb = fc.string({ minLength: 1, maxLength: 200 }).filter(s => s.trim().length > 0);
const hotelTypeArb = fc.constantFrom<HotelType>('own_hotel', 'competitor');
const platformTypeArb = fc.constantFrom<OTAPlatform>('ctrip', 'fliggy', 'meituan', 'qunar', 'other');
const memorySourceArb = fc.constantFrom<'user_input' | 'auto_learning'>('user_input', 'auto_learning');

const platformInfoArb: fc.Arbitrary<PlatformInfo> = fc.record({
  platform: platformTypeArb,
  hotelId: fc.option(fc.string(), { nil: undefined }),
  url: fc.option(fc.webUrl(), { nil: undefined }),
  lastVerified: fc.option(fc.date(), { nil: undefined })
});

describe('Memory Manager Property Tests', () => {
  /**
   * **Validates: Requirements 1.1, 1.2**
   * Property 1: 酒店实体创建和检索一致性
   * 对于任意有效的酒店名称和类型，创建后立即检索应该能找到该实体
   */
  describe('Property 1: 酒店实体创建和检索一致性', () => {
    it('should retrieve created hotel with consistent name and type', async () => {
      await fc.assert(
        fc.asyncProperty(hotelNameArb, hotelTypeArb, async (name, type) => {
          const manager = new MemoryManager(new MockMemoryStore());
          await manager.initialize();

          // 创建酒店
          const createResult = await manager.createHotel({ name, type });
          expect(createResult.success).toBe(true);
          expect(createResult.data).toBeDefined();

          // 立即检索
          const retrieveResult = await manager.retrieveHotels({ type });
          expect(retrieveResult.success).toBe(true);
          expect(retrieveResult.data).toBeDefined();

          // 验证能找到该实体
          const found = retrieveResult.data!.find(h => h.id === createResult.data!.id);
          expect(found).toBeDefined();
          expect(found!.name).toBe(name);
          expect(found!.type).toBe(type);
        }),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Validates: Requirements 1.3**
   * Property 2: 唯一标识符生成
   * 对于任意创建的Hotel_Entity，系统应该分配一个有效的UUID v4格式的唯一标识符
   */
  describe('Property 2: 唯一标识符生成', () => {
    it('should generate unique UUID v4 for each hotel', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(fc.tuple(hotelNameArb, hotelTypeArb), { minLength: 2, maxLength: 10 }),
          async (hotels) => {
            const manager = new MemoryManager(new MockMemoryStore());
            await manager.initialize();

            const ids = new Set<string>();
            const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

            for (const [name, type] of hotels) {
              const result = await manager.createHotel({ name: `${name}_${Math.random()}`, type });
              if (result.success && result.data) {
                const id = result.data.id;
                
                // 验证UUID v4格式
                expect(id).toMatch(uuidV4Regex);
                
                // 验证唯一性
                expect(ids.has(id)).toBe(false);
                ids.add(id);
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Validates: Requirements 1.4**
   * Property 3: 时间戳自动记录
   * 对于任意新创建的Hotel_Entity，系统应该自动记录createdAt和updatedAt时间戳
   */
  describe('Property 3: 时间戳自动记录', () => {
    it('should automatically record timestamps on creation', async () => {
      await fc.assert(
        fc.asyncProperty(hotelNameArb, hotelTypeArb, async (name, type) => {
          const manager = new MemoryManager(new MockMemoryStore());
          await manager.initialize();

          const beforeCreate = new Date();
          const result = await manager.createHotel({ name, type });
          const afterCreate = new Date();

          expect(result.success).toBe(true);
          expect(result.data).toBeDefined();

          const entity = result.data!;
          
          // 验证时间戳存在
          expect(entity.createdAt).toBeInstanceOf(Date);
          expect(entity.updatedAt).toBeInstanceOf(Date);
          
          // 验证时间戳在合理范围内
          expect(entity.createdAt.getTime()).toBeGreaterThanOrEqual(beforeCreate.getTime() - 1000);
          expect(entity.createdAt.getTime()).toBeLessThanOrEqual(afterCreate.getTime() + 1000);
          
          // 验证updatedAt >= createdAt
          expect(entity.updatedAt.getTime()).toBeGreaterThanOrEqual(entity.createdAt.getTime());
        }),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Validates: Requirements 1.5**
   * Property 4: 创建操作响应完整性
   * 对于任意成功的Hotel_Entity创建操作，返回结果应该包含完整的实体信息
   */
  describe('Property 4: 创建操作响应完整性', () => {
    it('should return complete entity information on successful creation', async () => {
      await fc.assert(
        fc.asyncProperty(hotelNameArb, hotelTypeArb, async (name, type) => {
          const manager = new MemoryManager(new MockMemoryStore());
          await manager.initialize();

          const result = await manager.createHotel({ name, type });

          expect(result.success).toBe(true);
          expect(result.data).toBeDefined();

          const entity = result.data!;
          
          // 验证必需字段存在
          expect(entity.id).toBeDefined();
          expect(typeof entity.id).toBe('string');
          expect(entity.name).toBe(name);
          expect(entity.type).toBe(type);
          expect(entity.createdAt).toBeInstanceOf(Date);
          expect(entity.updatedAt).toBeInstanceOf(Date);
          expect(entity.isDeleted).toBe(false);
          expect(entity.usageCount).toBe(0);
        }),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Validates: Requirements 3.1, 3.2, 3.3**
   * Property 7: 更新操作一致性
   * 对于任意已存在的Hotel_Entity和有效的更新数据，更新操作成功后检索该实体应该得到更新后的值
   */
  describe('Property 7: 更新操作一致性', () => {
    it('should reflect updates when retrieving entity', async () => {
      await fc.assert(
        fc.asyncProperty(
          hotelNameArb,
          hotelTypeArb,
          hotelNameArb,
          async (originalName, originalType, newName) => {
            const manager = new MemoryManager(new MockMemoryStore());
            await manager.initialize();

            // 创建实体
            const createResult = await manager.createHotel({ name: originalName, type: originalType });
            expect(createResult.success).toBe(true);
            const entityId = createResult.data!.id;
            const originalUpdatedAt = createResult.data!.updatedAt;

            // 等待一小段时间确保时间戳不同
            await new Promise(resolve => setTimeout(resolve, 10));

            // 更新实体
            const updateResult = await manager.updateHotel(entityId, { name: newName });
            expect(updateResult.success).toBe(true);
            expect(updateResult.data!.name).toBe(newName);
            expect(updateResult.data!.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime());

            // 检索验证
            const retrieveResult = await manager.retrieveHotels({});
            const updated = retrieveResult.data!.find(h => h.id === entityId);
            expect(updated).toBeDefined();
            expect(updated!.name).toBe(newName);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Validates: Requirements 3.4**
   * Property 8: 更新不存在实体的错误处理
   * 对于任意不存在的实体ID，尝试更新该实体应该返回失败结果
   */
  describe('Property 8: 更新不存在实体的错误处理', () => {
    it('should return error when updating non-existent entity', async () => {
      await fc.assert(
        fc.asyncProperty(fc.uuid(), hotelNameArb, async (nonExistentId, newName) => {
          const manager = new MemoryManager(new MockMemoryStore());
          await manager.initialize();

          const result = await manager.updateHotel(nonExistentId, { name: newName });

          expect(result.success).toBe(false);
          expect(result.error).toBeDefined();
          expect(result.error!.code).toBe('HOTEL_NOT_FOUND');
          expect(result.error!.message).toBeTruthy();
        }),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Validates: Requirements 3.5**
   * Property 9: 输入数据验证
   * 对于任意无效的输入数据，创建或更新操作应该被拒绝
   */
  describe('Property 9: 输入数据验证', () => {
    it('should reject empty hotel names', async () => {
      const manager = new MemoryManager(new MockMemoryStore());
      await manager.initialize();

      const result = await manager.createHotel({ name: '', type: 'own_hotel' });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error!.code).toBe('INVALID_HOTEL_NAME');
    });

    it('should reject invalid hotel types', async () => {
      await fc.assert(
        fc.asyncProperty(hotelNameArb, async (name) => {
          const manager = new MemoryManager(new MockMemoryStore());
          await manager.initialize();

          const result = await manager.createHotel({ 
            name, 
            type: 'invalid_type' as HotelType 
          });

          expect(result.success).toBe(false);
          expect(result.error).toBeDefined();
          expect(result.error!.code).toBe('INVALID_HOTEL_TYPE');
        }),
        { numRuns: 50 }
      );
    });

    it('should reject names that are too long', async () => {
      const manager = new MemoryManager(new MockMemoryStore());
      await manager.initialize();

      const longName = 'a'.repeat(201);
      const result = await manager.createHotel({ name: longName, type: 'own_hotel' });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error!.code).toBe('INVALID_HOTEL_NAME');
    });
  });

  /**
   * **Validates: Requirements 4.1, 4.4**
   * Property 10: 删除行为
   * 对于任意已存在的Hotel_Entity，执行删除操作后，该实体应从列表中完全移除
   */
  describe('Property 10: 删除行为', () => {
    it('should remove entity from retrieval after deletion', async () => {
      await fc.assert(
        fc.asyncProperty(hotelNameArb, hotelTypeArb, async (name, type) => {
          const manager = new MemoryManager(new MockMemoryStore());
          await manager.initialize();

          // 创建实体
          const createResult = await manager.createHotel({ name, type });
          expect(createResult.success).toBe(true);
          const entityId = createResult.data!.id;

          // 删除实体（本店需要确认）
          const deleteResult = await manager.deleteHotel(entityId, type === 'own_hotel');
          expect(deleteResult.success).toBe(true);

          // 删除后检索不应该返回该实体
          const retrieve = await manager.retrieveHotels({});
          const found = retrieve.data!.find(h => h.id === entityId);
          expect(found).toBeUndefined();
        }),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Validates: Requirements 4.2, 4.3**
   * Property 11: 删除操作响应
   * 对于任意成功的删除操作，返回结果的success应该为true
   */
  describe('Property 11: 删除操作响应', () => {
    it('should return success for valid deletion', async () => {
      await fc.assert(
        fc.asyncProperty(hotelNameArb, hotelTypeArb, async (name, type) => {
          const manager = new MemoryManager(new MockMemoryStore());
          await manager.initialize();

          const createResult = await manager.createHotel({ name, type });
          const entityId = createResult.data!.id;

          const deleteResult = await manager.deleteHotel(entityId, type === 'own_hotel');

          expect(deleteResult.success).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    it('should return error for non-existent entity deletion', async () => {
      await fc.assert(
        fc.asyncProperty(fc.uuid(), async (nonExistentId) => {
          const manager = new MemoryManager(new MockMemoryStore());
          await manager.initialize();

          const result = await manager.deleteHotel(nonExistentId);

          expect(result.success).toBe(false);
          expect(result.error).toBeDefined();
          expect(result.error!.code).toBe('HOTEL_NOT_FOUND');
        }),
        { numRuns: 100 }
      );
    });

    it('should require confirmation for deleting own hotel', async () => {
      await fc.assert(
        fc.asyncProperty(hotelNameArb, async (name) => {
          const manager = new MemoryManager(new MockMemoryStore());
          await manager.initialize();

          const createResult = await manager.createHotel({ name, type: 'own_hotel' });
          const entityId = createResult.data!.id;

          // 不提供确认应该失败
          const deleteResult = await manager.deleteHotel(entityId, false);

          expect(deleteResult.success).toBe(false);
          expect(deleteResult.error).toBeDefined();
          expect(deleteResult.error!.code).toBe('CONFIRMATION_REQUIRED');
        }),
        { numRuns: 50 }
      );
    });
  });

  /**
   * **Validates: Requirements 5.1, 5.2, 5.3, 5.4**
   * Property 12: 平台信息关联
   * 对于任意已存在的Hotel_Entity和有效的平台信息，添加平台关联后应该包含新添加的平台信息
   */
  describe('Property 12: 平台信息关联', () => {
    it('should add platform info to hotel entity', async () => {
      await fc.assert(
        fc.asyncProperty(
          hotelNameArb,
          hotelTypeArb,
          platformInfoArb,
          async (name, type, platformInfo) => {
            const manager = new MemoryManager(new MockMemoryStore());
            await manager.initialize();

            // 创建实体
            const createResult = await manager.createHotel({ name, type });
            const entityId = createResult.data!.id;

            // 添加平台信息
            const addResult = await manager.addPlatformInfo(entityId, platformInfo);

            expect(addResult.success).toBe(true);
            expect(addResult.data).toBeDefined();
            expect(addResult.data!.platforms).toContainEqual(
              expect.objectContaining({ platform: platformInfo.platform })
            );
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should support multiple platforms for same hotel', async () => {
      await fc.assert(
        fc.asyncProperty(
          hotelNameArb,
          hotelTypeArb,
          fc.array(platformInfoArb, { minLength: 2, maxLength: 5 }),
          async (name, type, platforms) => {
            const manager = new MemoryManager(new MockMemoryStore());
            await manager.initialize();

            const createResult = await manager.createHotel({ name, type });
            const entityId = createResult.data!.id;

            // 添加多个不同平台
            const uniquePlatforms = Array.from(
              new Map(platforms.map(p => [p.platform, p])).values()
            );

            for (const platform of uniquePlatforms) {
              await manager.addPlatformInfo(entityId, platform);
            }

            // 检索验证
            const retrieveResult = await manager.retrieveHotels({});
            const entity = retrieveResult.data!.find(h => h.id === entityId);
            
            expect(entity).toBeDefined();
            expect(entity!.platforms.length).toBeGreaterThanOrEqual(uniquePlatforms.length);
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  /**
   * **Validates: Requirements 6.2, 6.4**
   * Property 14: 自动学习记忆来源标记
   * 对于任意通过自动学习创建的Hotel_Entity，其source字段应该被标记为'auto_learning'
   */
  describe('Property 14: 自动学习记忆来源标记', () => {
    it('should mark source correctly based on creation method', async () => {
      await fc.assert(
        fc.asyncProperty(
          hotelNameArb,
          hotelTypeArb,
          memorySourceArb,
          async (name, type, source) => {
            const manager = new MemoryManager(new MockMemoryStore());
            await manager.initialize();

            const result = await manager.createHotel({ name, type, source });

            expect(result.success).toBe(true);
            expect(result.data!.source).toBe(source);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should default to user_input when source not specified', async () => {
      await fc.assert(
        fc.asyncProperty(hotelNameArb, hotelTypeArb, async (name, type) => {
          const manager = new MemoryManager(new MockMemoryStore());
          await manager.initialize();

          const result = await manager.createHotel({ name, type });

          expect(result.success).toBe(true);
          expect(result.data!.source).toBe('user_input');
        }),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Validates: Requirements 6.3**
   * Property 15: 重复酒店检测
   * 对于任意已存在的酒店名称，尝试创建同名酒店时，系统应该能检测到重复
   */
  describe('Property 15: 重复酒店检测', () => {
    it('should detect duplicate hotel names', async () => {
      await fc.assert(
        fc.asyncProperty(hotelNameArb, hotelTypeArb, async (name, type) => {
          const manager = new MemoryManager(new MockMemoryStore());
          await manager.initialize();

          // 创建第一个酒店
          const firstResult = await manager.createHotel({ name, type });
          expect(firstResult.success).toBe(true);

          // 尝试创建同名酒店
          const duplicateResult = await manager.createHotel({ name, type });

          expect(duplicateResult.success).toBe(false);
          expect(duplicateResult.error).toBeDefined();
          expect(duplicateResult.error!.code).toBe('DUPLICATE_HOTEL');
          expect(duplicateResult.error!.details).toHaveProperty('existingId');
        }),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Validates: Requirements 14.2, 14.5**
   * Property 29: 使用计数更新
   * 对于任意Hotel_Entity，每次通过检索访问该实体时，其usageCount应该增加
   */
  describe('Property 29: 使用计数更新', () => {
    it('should increment usage count on each retrieval', async () => {
      await fc.assert(
        fc.asyncProperty(
          hotelNameArb,
          hotelTypeArb,
          fc.integer({ min: 1, max: 10 }),
          async (name, type, retrievalCount) => {
            const manager = new MemoryManager(new MockMemoryStore());
            await manager.initialize();

            // 创建实体
            const createResult = await manager.createHotel({ name, type });
            expect(createResult.success).toBe(true);
            const entityId = createResult.data!.id;

            // 多次检索
            for (let i = 0; i < retrievalCount; i++) {
              await manager.retrieveHotels({ type });
            }

            // 验证使用计数
            const finalRetrieve = await manager.retrieveHotels({ includeDeleted: false });
            const entity = finalRetrieve.data!.find(h => h.id === entityId);
            
            expect(entity).toBeDefined();
            expect(entity!.usageCount).toBe(retrievalCount + 1); // +1 for final retrieve
            expect(entity!.lastUsedAt).toBeInstanceOf(Date);
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  /**
   * **Validates: Requirements 14.1**
   * Property 28: 统计数据准确性
   * 对于任意当前的记忆数据集合，统计接口返回的本店数量、竞品数量应该等于实际未删除实体中对应类型的数量
   */
  describe('Property 28: 统计数据准确性', () => {
    it('should return accurate statistics for hotel counts', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(fc.tuple(hotelNameArb, hotelTypeArb), { minLength: 1, maxLength: 20 }),
          async (hotels) => {
            const manager = new MemoryManager(new MockMemoryStore());
            await manager.initialize();

            // 创建酒店实体
            const createdHotels = [];
            for (const [name, type] of hotels) {
              const result = await manager.createHotel({ 
                name: `${name}_${Math.random()}`, 
                type 
              });
              if (result.success && result.data) {
                createdHotels.push(result.data);
              }
            }

            // 获取统计信息
            const statsResult = await manager.getStats();
            expect(statsResult.success).toBe(true);
            expect(statsResult.data).toBeDefined();

            const stats = statsResult.data!;

            // 计算预期的数量
            const expectedOwnCount = createdHotels.filter(h => h.type === 'own_hotel').length;
            const expectedCompetitorCount = createdHotels.filter(h => h.type === 'competitor').length;
            const expectedTotal = expectedOwnCount + expectedCompetitorCount;

            // 验证统计准确性
            expect(stats.totalCount).toBe(expectedTotal);
            expect(stats.ownHotelCount).toBe(expectedOwnCount);
            expect(stats.competitorCount).toBe(expectedCompetitorCount);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should exclude deleted entities from statistics', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(fc.tuple(hotelNameArb, hotelTypeArb), { minLength: 2, maxLength: 10 }),
          fc.integer({ min: 1, max: 5 }),
          async (hotels, deleteCount) => {
            const manager = new MemoryManager(new MockMemoryStore());
            await manager.initialize();

            // 创建酒店实体
            const createdIds = [];
            for (const [name, type] of hotels) {
              const result = await manager.createHotel({ 
                name: `${name}_${Math.random()}`, 
                type 
              });
              if (result.success && result.data) {
                createdIds.push({ id: result.data.id, type: result.data.type });
              }
            }

            // 删除一些实体
            const toDelete = Math.min(deleteCount, createdIds.length);
            for (let i = 0; i < toDelete; i++) {
              const { id, type } = createdIds[i];
              await manager.deleteHotel(id, type === 'own_hotel');
            }

            // 获取统计信息
            const statsResult = await manager.getStats();
            expect(statsResult.success).toBe(true);

            // 验证统计不包含已删除的实体
            const stats = statsResult.data!;
            expect(stats.totalCount).toBe(createdIds.length - toDelete);
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should accurately count platform distribution', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.tuple(hotelNameArb, hotelTypeArb, fc.array(platformInfoArb, { minLength: 1, maxLength: 3 })),
            { minLength: 1, maxLength: 10 }
          ),
          async (hotelsWithPlatforms) => {
            const manager = new MemoryManager(new MockMemoryStore());
            await manager.initialize();

            // 创建酒店并添加平台信息
            const expectedPlatformCounts: Record<OTAPlatform, number> = {
              ctrip: 0,
              fliggy: 0,
              meituan: 0,
              qunar: 0,
              other: 0
            };

            for (const [name, type, platforms] of hotelsWithPlatforms) {
              const result = await manager.createHotel({ 
                name: `${name}_${Math.random()}`, 
                type 
              });
              
              if (result.success && result.data) {
                // 去重平台信息，因为同一酒店的同一平台只计数一次
                const uniquePlatforms = Array.from(
                  new Map(platforms.map(p => [p.platform, p])).values()
                );
                
                for (const platform of uniquePlatforms) {
                  await manager.addPlatformInfo(result.data.id, platform);
                  expectedPlatformCounts[platform.platform]++;
                }
              }
            }

            // 获取统计信息
            const statsResult = await manager.getStats();
            expect(statsResult.success).toBe(true);

            const stats = statsResult.data!;

            // 验证平台分布统计
            for (const platform of Object.keys(expectedPlatformCounts) as OTAPlatform[]) {
              expect(stats.platformDistribution[platform]).toBe(expectedPlatformCounts[platform]);
            }
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  /**
   * **Validates: Requirements 14.3**
   * Property 30: 最常用酒店识别
   * 对于任意记忆数据集合，查询最常用的竞品酒店时，返回结果应该按usageCount降序排列
   */
  describe('Property 30: 最常用酒店识别', () => {
    it('should identify most used hotels sorted by usage count', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.tuple(hotelNameArb, hotelTypeArb, fc.integer({ min: 0, max: 50 })),
            { minLength: 3, maxLength: 15 }
          ),
          async (hotelsWithUsage) => {
            const manager = new MemoryManager(new MockMemoryStore());
            await manager.initialize();

            // 创建酒店并模拟使用次数
            for (const [name, type, usageCount] of hotelsWithUsage) {
              const result = await manager.createHotel({ 
                name: `${name}_${Math.random()}`, 
                type 
              });
              
              if (result.success && result.data) {
                // 通过多次检索来增加使用计数
                for (let i = 0; i < usageCount; i++) {
                  await manager.retrieveHotels({ type });
                }
              }
            }

            // 获取统计信息
            const statsResult = await manager.getStats();
            expect(statsResult.success).toBe(true);

            const stats = statsResult.data!;
            const mostUsed = stats.mostUsedHotels;

            // 验证按usageCount降序排列
            for (let i = 0; i < mostUsed.length - 1; i++) {
              expect(mostUsed[i].count).toBeGreaterThanOrEqual(mostUsed[i + 1].count);
            }

            // 验证所有返回的酒店都有有效的使用计数
            for (const hotel of mostUsed) {
              expect(hotel.id).toBeDefined();
              expect(hotel.name).toBeDefined();
              expect(typeof hotel.count).toBe('number');
              expect(hotel.count).toBeGreaterThanOrEqual(0);
            }
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should limit most used hotels to top 10', async () => {
      const manager = new MemoryManager(new MockMemoryStore());
      await manager.initialize();

      // 创建超过10个酒店
      for (let i = 0; i < 15; i++) {
        await manager.createHotel({ 
          name: `Hotel_${i}_${Math.random()}`, 
          type: 'competitor' 
        });
      }

      // 获取统计信息
      const statsResult = await manager.getStats();
      expect(statsResult.success).toBe(true);

      const stats = statsResult.data!;
      
      // 验证最多返回10个
      expect(stats.mostUsedHotels.length).toBeLessThanOrEqual(10);
    });
  });

  /**
   * **Validates: Requirements 10.1, 10.2**
   * Property 20: 导入导出往返一致性
   * 对于任意当前的记忆数据集合，导出为JSON字符串后再导入，应该得到等价的数据集合
   */
  describe('Property 20: 导入导出往返一致性', () => {
    it('should preserve data through export-import cycle', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.tuple(hotelNameArb, hotelTypeArb, fc.array(platformInfoArb, { maxLength: 2 })),
            { minLength: 1, maxLength: 10 }
          ),
          async (hotels) => {
            const manager1 = new MemoryManager(new MockMemoryStore());
            await manager1.initialize();

            // 创建酒店实体
            const createdHotels = [];
            for (const [name, type, platforms] of hotels) {
              const result = await manager1.createHotel({ 
                name: `${name}_${Math.random()}`, 
                type 
              });
              
              if (result.success && result.data) {
                createdHotels.push(result.data);
                
                // 添加平台信息
                for (const platform of platforms) {
                  await manager1.addPlatformInfo(result.data.id, platform);
                }
              }
            }

            // 导出数据
            const exportResult = await manager1.exportMemories();
            expect(exportResult.success).toBe(true);
            expect(exportResult.data).toBeDefined();

            // 创建新的manager并导入
            const manager2 = new MemoryManager(new MockMemoryStore());
            await manager2.initialize();

            const importResult = await manager2.importMemories(exportResult.data!);
            expect(importResult.success).toBe(true);
            expect(importResult.data!.imported).toBe(createdHotels.length);
            expect(importResult.data!.skipped).toBe(0);

            // 验证导入的数据
            const retrieveResult = await manager2.retrieveHotels({});
            expect(retrieveResult.success).toBe(true);
            expect(retrieveResult.data!.length).toBe(createdHotels.length);

            // 验证关键字段一致（ID会不同，因为导入时重新生成）
            for (const original of createdHotels) {
              const imported = retrieveResult.data!.find(h => h.name === original.name);
              expect(imported).toBeDefined();
              expect(imported!.type).toBe(original.type);
              expect(imported!.platforms.length).toBe(original.platforms.length);
            }
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should only export non-deleted entities', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(fc.tuple(hotelNameArb, hotelTypeArb), { minLength: 3, maxLength: 10 }),
          async (hotels) => {
            const manager = new MemoryManager(new MockMemoryStore());
            await manager.initialize();

            // 创建酒店实体
            const createdIds = [];
            for (const [name, type] of hotels) {
              const result = await manager.createHotel({ 
                name: `${name}_${Math.random()}`, 
                type 
              });
              if (result.success && result.data) {
                createdIds.push({ id: result.data.id, type: result.data.type });
              }
            }

            // 删除第一个实体
            if (createdIds.length > 0) {
              const { id, type } = createdIds[0];
              await manager.deleteHotel(id, type === 'own_hotel');
            }

            // 导出数据
            const exportResult = await manager.exportMemories();
            expect(exportResult.success).toBe(true);

            // 验证导出的数据不包含已删除的实体
            // 序列化器返回的是JSON数组，不是包含entities字段的对象
            const exportedData = JSON.parse(exportResult.data!);
            expect(Array.isArray(exportedData)).toBe(true);
            expect(exportedData.length).toBe(createdIds.length - 1);
            
            // 验证所有导出的实体都未被删除
            for (const entity of exportedData) {
              expect(entity.isDeleted).toBe(false);
            }
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  /**
   * **Validates: Requirements 10.3**
   * Property 21: 导入数据验证
   * 对于任意无效的JSON数据，导入操作应该被拒绝，返回失败结果并包含具体的验证错误信息
   */
  describe('Property 21: 导入数据验证', () => {
    it('should reject invalid JSON format', async () => {
      const manager = new MemoryManager(new MockMemoryStore());
      await manager.initialize();

      const invalidJson = 'this is not valid json {[}]';
      const result = await manager.importMemories(invalidJson);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error!.code).toBe('INVALID_JSON');
    });

    it('should reject JSON missing required fields', async () => {
      const manager = new MemoryManager(new MockMemoryStore());
      await manager.initialize();

      // JSON缺少必需字段
      const invalidData = JSON.stringify({
        version: '1.0.0',
        entities: [
          {
            // 缺少id, name, type等必需字段
            platforms: []
          }
        ]
      });

      const result = await manager.importMemories(invalidData);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should validate entity structure', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.record({
              // 故意创建可能无效的实体结构
              name: fc.option(fc.string(), { nil: null }),
              type: fc.option(fc.constantFrom('own_hotel', 'competitor', 'invalid'), { nil: null }),
              platforms: fc.option(fc.array(fc.anything()), { nil: null })
            }),
            { minLength: 1, maxLength: 5 }
          ),
          async (invalidEntities) => {
            const manager = new MemoryManager(new MockMemoryStore());
            await manager.initialize();

            const invalidData = JSON.stringify({
              version: '1.0.0',
              entities: invalidEntities
            });

            const result = await manager.importMemories(invalidData);

            // 应该拒绝无效数据或者跳过无效实体
            if (!result.success) {
              expect(result.error).toBeDefined();
            } else {
              // 如果成功，验证导入的数量合理
              expect(result.data!.imported).toBeLessThanOrEqual(invalidEntities.length);
            }
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  /**
   * **Validates: Requirements 10.4**
   * Property 22: 导入冲突检测
   * 对于任意导入的酒店数据，如果其名称与现有实体冲突，系统应该能检测到冲突
   */
  describe('Property 22: 导入冲突检测', () => {
    it('should detect and skip duplicate hotel names on import', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(fc.tuple(hotelNameArb, hotelTypeArb), { minLength: 2, maxLength: 10 }),
          async (hotels) => {
            const manager1 = new MemoryManager(new MockMemoryStore());
            await manager1.initialize();

            // 创建一些酒店
            const createdNames = [];
            for (const [name, type] of hotels) {
              const uniqueName = `${name}_${Math.random()}`;
              const result = await manager1.createHotel({ name: uniqueName, type });
              if (result.success) {
                createdNames.push(uniqueName);
              }
            }

            // 导出数据
            const exportResult = await manager1.exportMemories();
            expect(exportResult.success).toBe(true);

            // 创建新的manager，先创建一些同名酒店
            const manager2 = new MemoryManager(new MockMemoryStore());
            await manager2.initialize();

            // 创建一半的同名酒店
            const conflictCount = Math.floor(createdNames.length / 2);
            for (let i = 0; i < conflictCount; i++) {
              await manager2.createHotel({ 
                name: createdNames[i], 
                type: hotels[i][1] 
              });
            }

            // 尝试导入（应该检测到冲突）
            const importResult = await manager2.importMemories(exportResult.data!);
            expect(importResult.success).toBe(true);

            // 验证冲突的酒店被跳过
            expect(importResult.data!.skipped).toBeGreaterThanOrEqual(conflictCount);
            expect(importResult.data!.imported).toBe(createdNames.length - conflictCount);

            // 验证总数正确
            const retrieveResult = await manager2.retrieveHotels({});
            expect(retrieveResult.data!.length).toBe(createdNames.length);
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should not create duplicate entries for conflicting names', async () => {
      await fc.assert(
        fc.asyncProperty(
          hotelNameArb,
          hotelTypeArb,
          async (name, type) => {
            const manager = new MemoryManager(new MockMemoryStore());
            await manager.initialize();

            // 创建酒店
            const createResult = await manager.createHotel({ name, type });
            expect(createResult.success).toBe(true);

            // 导出数据
            const exportResult = await manager.exportMemories();
            expect(exportResult.success).toBe(true);

            // 尝试再次导入相同的数据
            const importResult = await manager.importMemories(exportResult.data!);
            expect(importResult.success).toBe(true);

            // 验证冲突被检测到
            expect(importResult.data!.skipped).toBe(1);
            expect(importResult.data!.imported).toBe(0);

            // 验证没有创建重复实体
            const retrieveResult = await manager.retrieveHotels({});
            expect(retrieveResult.data!.length).toBe(1);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
