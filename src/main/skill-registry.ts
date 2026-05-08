/**
 * Skill Registry - 技能注册表
 * 
 * 职责：
 * - 存储已加载技能的元数据
 * - 提供快速查询接口
 * - 管理技能状态
 */

import type { SkillDefinition } from '../shared/types';
import { Logger } from './logger';

export class SkillRegistry {
  private skills: Map<string, SkillDefinition>;
  private logger: Logger | null;

  constructor(logger?: Logger) {
    this.skills = new Map();
    this.logger = logger || null;
  }

  /**
   * 注册技能
   */
  register(skill: SkillDefinition): void {
    if (this.logger) {
      this.logger.info('skill-registry', `Registering skill: ${skill.metadata.name}`, {
        status: skill.status,
        path: skill.skillPath
      });
    }

    this.skills.set(skill.metadata.name, skill);
  }

  /**
   * 注销技能
   */
  unregister(skillName: string): void {
    if (this.logger) {
      this.logger.info('skill-registry', `Unregistering skill: ${skillName}`);
    }

    this.skills.delete(skillName);
  }

  /**
   * 获取指定技能
   */
  get(skillName: string): SkillDefinition | null {
    return this.skills.get(skillName) || null;
  }

  /**
   * 获取所有技能
   */
  getAll(): SkillDefinition[] {
    return Array.from(this.skills.values());
  }


  /**
   * 检查技能是否存在
   */
  has(skillName: string): boolean {
    return this.skills.has(skillName);
  }

  /**
   * 获取已启用的技能
   */
  getEnabled(): SkillDefinition[] {
    return Array.from(this.skills.values()).filter(
      skill => skill.status === 'loaded'
    );
  }

  /**
   * 根据标签获取技能
   */
  getByTag(tag: string): SkillDefinition[] {
    return Array.from(this.skills.values()).filter(
      skill => skill.metadata.tags?.includes(tag)
    );
  }

  /**
   * 清空所有技能
   */
  clear(): void {
    if (this.logger) {
      this.logger.info('skill-registry', 'Clearing all skills', {
        count: this.skills.size
      });
    }

    this.skills.clear();
  }

  /**
   * 获取技能数量
   */
  count(): number {
    return this.skills.size;
  }

  /**
   * 获取技能统计信息
   */
  getStats(): { total: number; loaded: number; error: number; disabled: number } {
    const all = this.getAll();
    return {
      total: all.length,
      loaded: all.filter(s => s.status === 'loaded').length,
      error: all.filter(s => s.status === 'error').length,
      disabled: all.filter(s => s.status === 'disabled').length
    };
  }
}
