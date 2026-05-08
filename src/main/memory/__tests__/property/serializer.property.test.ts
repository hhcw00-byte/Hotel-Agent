/**
 * Memory Serializer 属性测试
 * 使用 fast-check 进行基于属性的测试
 */

import * as fc from 'fast-check';
import { MemorySerializer } from '../../serializer';
import { HotelEntity, HotelType, OTAPlatform, MemorySource } from '../../types';

describe('Memory Serializer Property Tests', () => {
  let serializer: MemorySerializer;

  beforeEach(() => {
    serializer = new MemorySerializer();
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
   * Feature: agent-memory-system, Property 32: 序列化数据完整性
   * **Validates: Requirements 16.1, 16.2**
   * 
   * 对于任意有效的Hotel_Entity对象，序列化为JSON字符串后，
   * 该字符串应该是有效的JSON格式，且包含所有必需字段
   */
  describe('Property 32: 序列化数据完整性', () => {
    it('should serialize entities to valid JSON with all required fields', () => {
      fc.assert(
        fc.property(
          fc.array(hotelEntityArb, { minLength: 0, maxLength: 10 }),
          (entities) => {
            // 序列化
            const json = serializer.serialize(entities);

            // 验证是有效的JSON
            let parsed: any[];
            expect(() => {
              parsed = JSON.parse(json);
            }).not.toThrow();

            parsed = JSON.parse(json);

            // 验证是数组
            expect(Array.isArray(parsed)).toBe(true);
            expect(parsed).toHaveLength(entities.length);

            // 验证每个实体包含所有必需字段
            for (let i = 0; i < entities.length; i++) {
              const original = entities[i];
              const serialized = parsed[i];

              // 必需字段
              expect(serialized).toHaveProperty('id');
              expect(serialized).toHaveProperty('name');
              expect(serialized).toHaveProperty('type');
              expect(serialized).toHaveProperty('createdAt');
              expect(serialized).toHaveProperty('updatedAt');
              expect(serialized).toHaveProperty('isDeleted');

              // 验证值
              expect(serialized.id).toBe(original.id);
              expect(serialized.name).toBe(original.name);
              expect(serialized.type).toBe(original.type);
              expect(serialized.isDeleted).toBe(original.isDeleted);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle empty array', () => {
      const json = serializer.serialize([]);
      const parsed = JSON.parse(json);
      expect(parsed).toEqual([]);
    });

    it('should preserve special characters and Unicode', () => {
      const entity: HotelEntity = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: '五星级★酒店 🏨 "特殊\'字符"',
        type: 'own_hotel',
        platforms: [],
        source: 'user_input',
        createdAt: new Date(),
        updatedAt: new Date(),
        usageCount: 0,
        isDeleted: false
      };

      const json = serializer.serialize([entity]);
      const parsed = JSON.parse(json);
      expect(parsed[0].name).toBe(entity.name);
    });
  });

  /**
   * Feature: agent-memory-system, Property 33: 序列化格式化输出
   * **Validates: Requirements 16.5, 18.1, 18.2, 18.3**
   * 
   * 对于任意Hotel_Entity对象数组，使用Pretty Print序列化时，
   * 输出的JSON字符串应该包含换行符和缩进（2空格），且字段按字母顺序排列
   */
  describe('Property 33: 序列化格式化输出', () => {
    it('should format JSON with 2-space indentation and sorted fields', () => {
      fc.assert(
        fc.property(
          fc.array(hotelEntityArb, { minLength: 1, maxLength: 5 }),
          (entities) => {
            // 格式化输出
            const prettyJson = serializer.prettyPrint(entities);

            // 验证包含换行符
            expect(prettyJson).toContain('\n');

            // 验证包含2空格缩进
            expect(prettyJson).toContain('  ');

            // 验证是有效的JSON
            const parsed = JSON.parse(prettyJson);
            expect(Array.isArray(parsed)).toBe(true);
            expect(parsed).toHaveLength(entities.length);

            // 验证字段按字母顺序排列
            for (const entity of parsed) {
              const keys = Object.keys(entity);
              const sortedKeys = [...keys].sort();
              expect(keys).toEqual(sortedKeys);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should format empty array', () => {
      const prettyJson = serializer.prettyPrint([]);
      expect(prettyJson).toBe('[]');
    });

    it('should sort nested platform fields', () => {
      const entity: HotelEntity = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'Test Hotel',
        type: 'own_hotel',
        platforms: [
          {
            platform: 'ctrip',
            url: 'https://example.com',
            hotelId: '12345'
          }
        ],
        source: 'user_input',
        createdAt: new Date(),
        updatedAt: new Date(),
        usageCount: 0,
        isDeleted: false
      };

      const prettyJson = serializer.prettyPrint([entity]);
      const parsed = JSON.parse(prettyJson);

      // 验证平台字段也是排序的
      const platformKeys = Object.keys(parsed[0].platforms[0]);
      const sortedPlatformKeys = [...platformKeys].sort();
      expect(platformKeys).toEqual(sortedPlatformKeys);
    });
  });

  /**
   * Feature: agent-memory-system, Property 34: 反序列化错误处理
   * **Validates: Requirements 17.2, 17.3**
   * 
   * 对于任意无效的JSON字符串（语法错误或缺少必需字段），
   * 反序列化操作应该失败并返回描述性错误信息
   */
  describe('Property 34: 反序列化错误处理', () => {
    it('should throw error for invalid JSON syntax', () => {
      const invalidJsonStrings = [
        '{invalid json}',
        '[{id: "test"}]', // 缺少引号
        '{"name": "test",}', // 尾随逗号
        'not json at all',
        ''
      ];

      for (const invalidJson of invalidJsonStrings) {
        expect(() => {
          serializer.deserialize(invalidJson);
        }).toThrow();
      }
    });

    it('should throw error for non-array JSON', () => {
      const nonArrayJson = JSON.stringify({ id: 'test', name: 'Hotel' });
      
      expect(() => {
        serializer.deserialize(nonArrayJson);
      }).toThrow(/array/i);
    });

    it('should throw error for missing required fields', () => {
      // 缺少id
      const missingId = JSON.stringify([{
        name: 'Test Hotel',
        type: 'own_hotel',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isDeleted: false
      }]);

      expect(() => {
        serializer.deserialize(missingId);
      }).toThrow(/id/i);

      // 缺少name
      const missingName = JSON.stringify([{
        id: '123e4567-e89b-12d3-a456-426614174000',
        type: 'own_hotel',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isDeleted: false
      }]);

      expect(() => {
        serializer.deserialize(missingName);
      }).toThrow(/name/i);

      // 缺少type
      const missingType = JSON.stringify([{
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'Test Hotel',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isDeleted: false
      }]);

      expect(() => {
        serializer.deserialize(missingType);
      }).toThrow(/type/i);
    });

    it('should throw error for invalid type value', () => {
      const invalidType = JSON.stringify([{
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'Test Hotel',
        type: 'invalid_type',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isDeleted: false
      }]);

      expect(() => {
        serializer.deserialize(invalidType);
      }).toThrow(/type/i);
    });
  });

  /**
   * Feature: agent-memory-system, Property 35: 反序列化默认值处理
   * **Validates: Requirements 17.4, 17.5**
   * 
   * 对于任意缺少可选字段的有效JSON对象，反序列化时应该为缺失字段填充合理的默认值，
   * 且忽略未知字段
   */
  describe('Property 35: 反序列化默认值处理', () => {
    it('should provide default values for missing optional fields', () => {
      const minimalJson = JSON.stringify([{
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'Test Hotel',
        type: 'own_hotel',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isDeleted: false
      }]);

      const entities = serializer.deserialize(minimalJson);
      
      expect(entities).toHaveLength(1);
      const entity = entities[0];

      // 验证默认值
      expect(entity.platforms).toEqual([]);
      expect(entity.source).toBe('user_input');
      expect(entity.usageCount).toBe(0);
      expect(entity.lastUsedAt).toBeUndefined();
      expect(entity.metadata).toBeUndefined();
    });

    it('should ignore unknown fields', () => {
      const jsonWithUnknownFields = JSON.stringify([{
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'Test Hotel',
        type: 'own_hotel',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isDeleted: false,
        unknownField1: 'should be ignored',
        unknownField2: 12345
      }]);

      // 应该成功反序列化，忽略未知字段
      expect(() => {
        const entities = serializer.deserialize(jsonWithUnknownFields);
        expect(entities).toHaveLength(1);
      }).not.toThrow();
    });

    it('should handle missing usageCount with default 0', () => {
      const json = JSON.stringify([{
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'Test Hotel',
        type: 'own_hotel',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isDeleted: false
        // usageCount missing
      }]);

      const entities = serializer.deserialize(json);
      expect(entities[0].usageCount).toBe(0);
    });

    it('should handle missing platforms with empty array', () => {
      const json = JSON.stringify([{
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'Test Hotel',
        type: 'own_hotel',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isDeleted: false
        // platforms missing
      }]);

      const entities = serializer.deserialize(json);
      expect(entities[0].platforms).toEqual([]);
    });
  });

  /**
   * Feature: agent-memory-system, Property 36: 序列化反序列化往返一致性
   * **Validates: Requirements 18.5**
   * 
   * 对于任意有效的Hotel_Entity对象，序列化为JSON字符串后再反序列化，
   * 应该得到与原对象等价的对象（所有字段值相同）
   */
  describe('Property 36: 序列化反序列化往返一致性', () => {
    it('should preserve entity data through serialize-deserialize cycle', () => {
      fc.assert(
        fc.property(
          fc.array(hotelEntityArb, { minLength: 0, maxLength: 10 }),
          (entities) => {
            // 序列化
            const json = serializer.serialize(entities);

            // 反序列化
            const deserialized = serializer.deserialize(json);

            // 验证数量相同
            expect(deserialized).toHaveLength(entities.length);

            // 验证每个实体的字段
            for (let i = 0; i < entities.length; i++) {
              const original = entities[i];
              const restored = deserialized[i];

              // 验证基本字段
              expect(restored.id).toBe(original.id);
              expect(restored.name).toBe(original.name);
              expect(restored.type).toBe(original.type);
              expect(restored.source).toBe(original.source);
              expect(restored.usageCount).toBe(original.usageCount);
              expect(restored.isDeleted).toBe(original.isDeleted);

              // 验证日期（转换为时间戳比较）
              expect(restored.createdAt.getTime()).toBe(original.createdAt.getTime());
              expect(restored.updatedAt.getTime()).toBe(original.updatedAt.getTime());
              
              if (original.lastUsedAt) {
                expect(restored.lastUsedAt?.getTime()).toBe(original.lastUsedAt.getTime());
              } else {
                expect(restored.lastUsedAt).toBeUndefined();
              }

              // 验证平台信息
              expect(restored.platforms).toHaveLength(original.platforms.length);
              for (let j = 0; j < original.platforms.length; j++) {
                expect(restored.platforms[j].platform).toBe(original.platforms[j].platform);
                expect(restored.platforms[j].hotelId).toBe(original.platforms[j].hotelId);
                expect(restored.platforms[j].url).toBe(original.platforms[j].url);
                
                if (original.platforms[j].lastVerified) {
                  expect(restored.platforms[j].lastVerified?.getTime()).toBe(
                    original.platforms[j].lastVerified?.getTime()
                  );
                }
              }

              // 验证metadata
              if (original.metadata) {
                expect(restored.metadata).toBeDefined();
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle round-trip with prettyPrint', () => {
      fc.assert(
        fc.property(
          fc.array(hotelEntityArb, { minLength: 1, maxLength: 5 }),
          (entities) => {
            // 使用prettyPrint序列化
            const prettyJson = serializer.prettyPrint(entities);

            // 反序列化
            const deserialized = serializer.deserialize(prettyJson);

            // 验证数量相同
            expect(deserialized).toHaveLength(entities.length);

            // 验证关键字段
            for (let i = 0; i < entities.length; i++) {
              expect(deserialized[i].id).toBe(entities[i].id);
              expect(deserialized[i].name).toBe(entities[i].name);
              expect(deserialized[i].type).toBe(entities[i].type);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle empty array round-trip', () => {
      const json = serializer.serialize([]);
      const deserialized = serializer.deserialize(json);
      expect(deserialized).toEqual([]);
    });

    it('should handle entity with all optional fields', () => {
      const entity: HotelEntity = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'Complete Hotel',
        type: 'competitor',
        platforms: [
          {
            platform: 'ctrip',
            hotelId: '12345',
            url: 'https://example.com',
            lastVerified: new Date('2024-01-15T10:00:00Z')
          }
        ],
        source: 'auto_learning',
        createdAt: new Date('2024-01-10T08:00:00Z'),
        updatedAt: new Date('2024-01-15T10:30:00Z'),
        lastUsedAt: new Date('2024-01-15T10:00:00Z'),
        usageCount: 25,
        isDeleted: false,
        metadata: { key1: 'value1', key2: 123 }
      };

      const json = serializer.serialize([entity]);
      const deserialized = serializer.deserialize(json);

      expect(deserialized).toHaveLength(1);
      const restored = deserialized[0];

      expect(restored.id).toBe(entity.id);
      expect(restored.name).toBe(entity.name);
      expect(restored.lastUsedAt?.getTime()).toBe(entity.lastUsedAt?.getTime());
      expect(restored.metadata).toEqual(entity.metadata);
    });
  });

  /**
   * 额外测试：validate方法
   */
  describe('Validate Method', () => {
    it('should validate correct JSON', () => {
      const validJson = JSON.stringify([{
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'Test Hotel',
        type: 'own_hotel',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isDeleted: false
      }]);

      const result = serializer.validate(validJson);
      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('should detect invalid JSON syntax', () => {
      const result = serializer.validate('{invalid json}');
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors!.length).toBeGreaterThan(0);
    });

    it('should detect missing required fields', () => {
      const missingFields = JSON.stringify([{
        id: '123e4567-e89b-12d3-a456-426614174000'
        // missing name, type, etc.
      }]);

      const result = serializer.validate(missingFields);
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors!.some(e => e.includes('name'))).toBe(true);
    });

    it('should detect non-array data', () => {
      const nonArray = JSON.stringify({ id: 'test' });
      
      const result = serializer.validate(nonArray);
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors!.some(e => e.includes('array'))).toBe(true);
    });
  });
});
