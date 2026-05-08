/**
 * Memory IPC Property-Based Tests
 * 使用fast-check验证IPC API层的正确性属性
 */

import * as fc from 'fast-check';
import { MemoryIPCHandler } from '../../ipc';
import { MemoryManager } from '../../manager';
import { IMemoryStore } from '../../interfaces';
import { HotelEntity, HotelType, OTAPlatform, PlatformInfo } from '../../types';

// Mock uuid module
jest.mock('uuid', () => ({
  v4: jest.fn(() => {
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

describe('Memory IPC Property Tests', () => {
  let handler: MemoryIPCHandler;
  let manager: MemoryManager;

  beforeEach(async () => {
    // 创建新的handler和manager实例
    manager = new MemoryManager(new MockMemoryStore());
    handler = new MemoryIPCHandler(manager);
    
    // 初始化manager（不注册IPC handlers，因为我们直接调用manager方法）
    await manager.initialize();
  });

  /**
   * **Validates: Requirements 8.5**
   * Property 19: API错误响应结构
   * 对于任意失败的API调用，返回结果应该包含success=false和error对象
   */
  describe('Property 19: API错误响应结构', () => {
    it('should return consistent error structure for validation failures', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom('', '   ', 'a'.repeat(201)), // 无效的酒店名称
          hotelTypeArb,
          async (invalidName, type) => {
            // 尝试创建无效的酒店
            const result = await manager.createHotel({
              name: invalidName,
              type
            });

            // 验证错误响应结构
            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
            expect(result.error).toHaveProperty('code');
            expect(result.error).toHaveProperty('message');
            expect(typeof result.error!.code).toBe('string');
            expect(typeof result.error!.message).toBe('string');
            expect(result.error!.code.length).toBeGreaterThan(0);
            expect(result.error!.message.length).toBeGreaterThan(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should return consistent error structure for not found resources', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.uuid(), // 随机UUID
          async (nonExistentId) => {
            // 尝试更新不存在的酒店
            const result = await manager.updateHotel(nonExistentId, {
              name: 'New Name'
            });

            // 验证错误响应结构
            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
            expect(result.error).toHaveProperty('code');
            expect(result.error).toHaveProperty('message');
            expect(typeof result.error!.code).toBe('string');
            expect(typeof result.error!.message).toBe('string');
            expect(result.error!.code).toBe('HOTEL_NOT_FOUND');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should return consistent error structure for invalid types', async () => {
      await fc.assert(
        fc.asyncProperty(
          hotelNameArb,
          fc.constantFrom('invalid_type', 'wrong', 'bad_type'),
          async (name, invalidType) => {
            // 尝试创建无效类型的酒店
            const result = await manager.createHotel({
              name,
              type: invalidType as any
            });

            // 验证错误响应结构
            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
            expect(result.error).toHaveProperty('code');
            expect(result.error).toHaveProperty('message');
            expect(typeof result.error!.code).toBe('string');
            expect(typeof result.error!.message).toBe('string');
            expect(result.error!.code).toBe('INVALID_HOTEL_TYPE');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should include error details when available', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 201, maxLength: 300 }), // 超长名称
          hotelTypeArb,
          async (longName, type) => {
            // 尝试创建超长名称的酒店
            const result = await manager.createHotel({
              name: longName,
              type
            });

            // 验证错误响应包含details
            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
            expect(result.error!.code).toBe('INVALID_HOTEL_NAME');
            // details字段是可选的，但如果存在应该是对象
            if (result.error!.details) {
              expect(typeof result.error!.details).toBe('object');
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Validates: Requirements 15.5**
   * Property 31: 初始化就绪状态
   * 对于任意成功的初始化操作，系统应该设置就绪状态，API调用应该能正常执行
   */
  describe('Property 31: 初始化就绪状态', () => {
    it('should allow API calls after successful initialization', async () => {
      await fc.assert(
        fc.asyncProperty(
          hotelNameArb,
          hotelTypeArb,
          async (name, type) => {
            // 创建新的manager并初始化
            const newManager = new MemoryManager(new MockMemoryStore());
            const initResult = await newManager.initialize();

            // 验证初始化成功
            expect(initResult.success).toBe(true);

            // 验证API调用能正常执行
            const createResult = await newManager.createHotel({ name, type });
            expect(createResult.success).toBe(true);
            expect(createResult.data).toBeDefined();

            const retrieveResult = await newManager.retrieveHotels({});
            expect(retrieveResult.success).toBe(true);
            expect(retrieveResult.data).toBeDefined();
            expect(Array.isArray(retrieveResult.data)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should return error for API calls before initialization', async () => {
      await fc.assert(
        fc.asyncProperty(
          hotelNameArb,
          hotelTypeArb,
          async (name, type) => {
            // 创建新的manager但不初始化
            const uninitializedManager = new MemoryManager(new MockMemoryStore());

            // 尝试调用API
            const createResult = await uninitializedManager.createHotel({ name, type });

            // 验证返回未初始化错误
            expect(createResult.success).toBe(false);
            expect(createResult.error).toBeDefined();
            expect(createResult.error!.code).toBe('NOT_INITIALIZED');
            expect(createResult.error!.message).toContain('not initialized');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should maintain ready state across multiple API calls', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.record({
              name: hotelNameArb,
              type: hotelTypeArb
            }),
            { minLength: 1, maxLength: 10 }
          ),
          async (hotels) => {
            // 创建并初始化manager
            const newManager = new MemoryManager(new MockMemoryStore());
            await newManager.initialize();

            // 执行多个API调用
            for (const hotel of hotels) {
              const createResult = await newManager.createHotel(hotel);
              expect(createResult.success).toBe(true);
            }

            // 验证检索仍然正常工作
            const retrieveResult = await newManager.retrieveHotels({});
            expect(retrieveResult.success).toBe(true);
            expect(retrieveResult.data).toBeDefined();
            expect(retrieveResult.data!.length).toBe(hotels.length);
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should handle initialization failure gracefully', async () => {
      // 创建一个会失败的mock store
      class FailingMockStore implements IMemoryStore {
        async load(): Promise<HotelEntity[]> {
          throw new Error('Storage failure');
        }

        async save(): Promise<void> {
          throw new Error('Storage failure');
        }

        getStoragePath(): string {
          return '/mock/path';
        }

        async createBackup(): Promise<string> {
          throw new Error('Storage failure');
        }

        async restoreFromBackup(): Promise<void> {
          throw new Error('Storage failure');
        }
      }

      await fc.assert(
        fc.asyncProperty(
          hotelNameArb,
          hotelTypeArb,
          async (name, type) => {
            // 使用失败的store创建manager
            const failingManager = new MemoryManager(new FailingMockStore());
            const initResult = await failingManager.initialize();

            // 初始化应该失败但不抛出异常
            expect(initResult.success).toBe(false);
            expect(initResult.error).toBeDefined();

            // API调用应该仍然可以执行（使用空数据集）
            const createResult = await failingManager.createHotel({ name, type });
            // 可能成功（使用内存数据）或失败（取决于实现）
            expect(createResult).toHaveProperty('success');
            expect(typeof createResult.success).toBe('boolean');
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  /**
   * 额外测试：验证所有成功的API响应都有正确的结构
   */
  describe('Additional: Success response structure', () => {
    it('should return consistent success structure for all operations', async () => {
      await fc.assert(
        fc.asyncProperty(
          hotelNameArb,
          hotelTypeArb,
          async (name, type) => {
            // 创建
            const createResult = await manager.createHotel({ name, type });
            expect(createResult.success).toBe(true);
            expect(createResult.data).toBeDefined();
            expect(createResult.error).toBeUndefined();

            const hotelId = createResult.data!.id;

            // 检索
            const retrieveResult = await manager.retrieveHotels({});
            expect(retrieveResult.success).toBe(true);
            expect(retrieveResult.data).toBeDefined();
            expect(retrieveResult.error).toBeUndefined();

            // 更新
            const updateResult = await manager.updateHotel(hotelId, {
              name: name + ' Updated'
            });
            expect(updateResult.success).toBe(true);
            expect(updateResult.data).toBeDefined();
            expect(updateResult.error).toBeUndefined();

            // 统计
            const statsResult = await manager.getStats();
            expect(statsResult.success).toBe(true);
            expect(statsResult.data).toBeDefined();
            expect(statsResult.error).toBeUndefined();

            // 导出
            const exportResult = await manager.exportMemories();
            expect(exportResult.success).toBe(true);
            expect(exportResult.data).toBeDefined();
            expect(exportResult.error).toBeUndefined();

            // 删除
            const deleteResult = await manager.deleteHotel(
              hotelId,
              type === 'own_hotel' ? true : undefined // 本店需要确认
            );
            expect(deleteResult.success).toBe(true);
            expect(deleteResult.error).toBeUndefined();
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
