/**
 * Memory Store 属性测试
 * 使用 fast-check 进行基于属性的测试
 */

import * as fc from 'fast-check';
import { MemoryStore } from '../../store';
import { HotelEntity, HotelType, OTAPlatform, MemorySource } from '../../types';
import * as fs from 'fs/promises';
import * as path from 'path';
import { app } from 'electron';

// Mock electron app
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn(() => path.join(__dirname, 'test-data')),
    isPackaged: false
  }
}));

// Mock path-resolver to use test directory as base path
jest.mock('../../../path-resolver', () => ({
  getBasePath: () => path.join(__dirname, 'test-data')
}));

describe('Memory Store Property Tests', () => {
  let store: MemoryStore;
  let testDataDir: string;

  beforeEach(async () => {
    testDataDir = path.join(__dirname, 'test-data', 'data', 'memory');
    store = new MemoryStore();
    
    // 清理测试目录
    try {
      await fs.rm(testDataDir, { recursive: true, force: true });
    } catch (error) {
      // 目录不存在，忽略错误
    }
  });

  afterEach(async () => {
    // 清理测试数据
    try {
      await fs.rm(testDataDir, { recursive: true, force: true });
    } catch (error) {
      // 忽略清理错误
    }
  });

  // Arbitraries for generating test data
  const hotelTypeArb = fc.constantFrom<HotelType>('own_hotel', 'competitor');
  const platformArb = fc.constantFrom<OTAPlatform>('ctrip', 'fliggy', 'meituan', 'qunar', 'other');
  const memorySourceArb = fc.constantFrom<MemorySource>('user_input', 'auto_learning');

  const platformInfoArb = fc.record({
    platform: platformArb,
    hotelId: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
    url: fc.option(fc.webUrl(), { nil: undefined }),
    lastVerified: fc.option(fc.date(), { nil: undefined })
  });

  const hotelEntityArb = fc.record({
    id: fc.uuid(),
    name: fc.string({ minLength: 1, maxLength: 200 }),
    type: hotelTypeArb,
    platforms: fc.array(platformInfoArb, { maxLength: 5 }),
    source: memorySourceArb,
    createdAt: fc.date(),
    updatedAt: fc.date(),
    lastUsedAt: fc.option(fc.date(), { nil: undefined }),
    usageCount: fc.nat({ max: 10000 }),
    isDeleted: fc.boolean(),
    metadata: fc.option(fc.dictionary(fc.string(), fc.anything()), { nil: undefined })
  });

  /**
   * Feature: agent-memory-system, Property 16: 持久化往返一致性
   * **Validates: Requirements 7.1, 7.2, 7.5**
   * 
   * 对于任意Hotel_Entity集合，保存到文件系统后重新加载，
   * 应该得到等价的实体集合（所有字段值相同）
   */
  describe('Property 16: 持久化往返一致性', () => {
    it('should preserve entity data through save-load cycle', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(hotelEntityArb, { minLength: 0, maxLength: 10 }),
          async (entities) => {
            // 保存实体
            await store.save(entities);

            // 重新加载
            const loaded = await store.load();

            // 验证数量相同
            expect(loaded).toHaveLength(entities.length);

            // 验证每个实体的字段
            for (let i = 0; i < entities.length; i++) {
              const original = entities[i];
              const reloaded = loaded[i];

              expect(reloaded.id).toBe(original.id);
              expect(reloaded.name).toBe(original.name);
              expect(reloaded.type).toBe(original.type);
              expect(reloaded.source).toBe(original.source);
              expect(reloaded.usageCount).toBe(original.usageCount);
              expect(reloaded.isDeleted).toBe(original.isDeleted);

              // 验证日期（转换为时间戳比较）
              expect(reloaded.createdAt.getTime()).toBe(original.createdAt.getTime());
              expect(reloaded.updatedAt.getTime()).toBe(original.updatedAt.getTime());
              
              if (original.lastUsedAt) {
                expect(reloaded.lastUsedAt?.getTime()).toBe(original.lastUsedAt.getTime());
              } else {
                expect(reloaded.lastUsedAt).toBeUndefined();
              }

              // 验证平台信息
              expect(reloaded.platforms).toHaveLength(original.platforms.length);
              for (let j = 0; j < original.platforms.length; j++) {
                expect(reloaded.platforms[j].platform).toBe(original.platforms[j].platform);
                expect(reloaded.platforms[j].hotelId).toBe(original.platforms[j].hotelId);
                expect(reloaded.platforms[j].url).toBe(original.platforms[j].url);
                
                if (original.platforms[j].lastVerified) {
                  expect(reloaded.platforms[j].lastVerified?.getTime()).toBe(
                    original.platforms[j].lastVerified?.getTime()
                  );
                }
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle empty entity array', async () => {
      await store.save([]);
      const loaded = await store.load();
      expect(loaded).toEqual([]);
    });

    it('should handle entities with minimal fields', async () => {
      const minimalEntity: HotelEntity = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'Test Hotel',
        type: 'own_hotel',
        platforms: [],
        source: 'user_input',
        createdAt: new Date(),
        updatedAt: new Date(),
        usageCount: 0,
        isDeleted: false
      };

      await store.save([minimalEntity]);
      const loaded = await store.load();
      
      expect(loaded).toHaveLength(1);
      expect(loaded[0].id).toBe(minimalEntity.id);
      expect(loaded[0].name).toBe(minimalEntity.name);
    });
  });

  /**
   * Feature: agent-memory-system, Property 17: JSON格式存储
   * **Validates: Requirements 7.3**
   * 
   * 对于任意保存操作，生成的存储文件内容应该是有效的JSON格式，
   * 能够被标准JSON解析器解析，且包含version和entities字段
   */
  describe('Property 17: JSON格式存储', () => {
    it('should save data in valid JSON format', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(hotelEntityArb, { minLength: 1, maxLength: 5 }),
          async (entities) => {
            // 保存实体
            await store.save(entities);

            // 读取文件内容
            const storagePath = store.getStoragePath();
            const content = await fs.readFile(storagePath, 'utf-8');

            // 验证是有效的JSON
            let parsed: any;
            expect(() => {
              parsed = JSON.parse(content);
            }).not.toThrow();

            // 验证包含必需字段
            expect(parsed).toHaveProperty('version');
            expect(parsed).toHaveProperty('lastModified');
            expect(parsed).toHaveProperty('entities');
            expect(Array.isArray(parsed.entities)).toBe(true);
            expect(parsed.entities).toHaveLength(entities.length);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should create valid JSON for empty array', async () => {
      await store.save([]);
      
      const storagePath = store.getStoragePath();
      const content = await fs.readFile(storagePath, 'utf-8');
      const parsed = JSON.parse(content);

      expect(parsed.version).toBeDefined();
      expect(parsed.entities).toEqual([]);
    });

    it('should format JSON with proper indentation', async () => {
      const entity: HotelEntity = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'Test Hotel',
        type: 'own_hotel',
        platforms: [],
        source: 'user_input',
        createdAt: new Date(),
        updatedAt: new Date(),
        usageCount: 0,
        isDeleted: false
      };

      await store.save([entity]);
      
      const storagePath = store.getStoragePath();
      const content = await fs.readFile(storagePath, 'utf-8');

      // 验证包含换行符和缩进（格式化的JSON）
      expect(content).toContain('\n');
      expect(content).toContain('  '); // 2空格缩进
    });
  });

  /**
   * 额外测试：备份和恢复功能
   */
  describe('Backup and Restore', () => {
    it('should create backup and restore successfully', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(hotelEntityArb, { minLength: 1, maxLength: 5 }),
          async (entities) => {
            // 保存原始数据
            await store.save(entities);

            // 创建备份
            const backupPath = await store.createBackup();
            expect(backupPath).toBeDefined();

            // 修改数据
            await store.save([]);

            // 从备份恢复
            await store.restoreFromBackup();

            // 验证恢复的数据
            const restored = await store.load();
            expect(restored).toHaveLength(entities.length);
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  /**
   * 额外测试：文件不存在时的初始化
   */
  describe('Initialization', () => {
    it('should return empty array when file does not exist', async () => {
      const loaded = await store.load();
      expect(loaded).toEqual([]);
    });

    it('should create directory structure on first save', async () => {
      const entity: HotelEntity = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'Test Hotel',
        type: 'own_hotel',
        platforms: [],
        source: 'user_input',
        createdAt: new Date(),
        updatedAt: new Date(),
        usageCount: 0,
        isDeleted: false
      };

      await store.save([entity]);
      
      const storagePath = store.getStoragePath();
      const stats = await fs.stat(storagePath);
      expect(stats.isFile()).toBe(true);
    });
  });
});
