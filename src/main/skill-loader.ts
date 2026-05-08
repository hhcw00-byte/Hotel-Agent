/**
 * Skill Loader - 技能加载器
 * 
 * 职责：
 * - 扫描skills目录
 * - 解析skill.md文件（YAML frontmatter + Markdown）
 * - 验证技能元数据
 * - 检查scripts目录是否存在
 * - 检查依赖是否满足
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type { SkillDefinition, SkillMetadata, LoadResult } from '../shared/types';
import { Logger } from './logger';

export class SkillLoader {
  private logger: Logger | null;
  private skillsDir: string;
  private scriptsDir: string;

  constructor(skillsDir: string, scriptsDir: string, logger?: Logger) {
    this.skillsDir = skillsDir;
    this.scriptsDir = scriptsDir;
    this.logger = logger || null;
  }

  /**
   * 从目录加载所有技能
   */
  async loadFromDirectory(): Promise<SkillDefinition[]> {
    if (this.logger) {
      this.logger.info('skill-loader', 'Loading skills from directory', {
        skillsDir: this.skillsDir
      });
    }

    const skills: SkillDefinition[] = [];

    try {
      // 检查skills目录是否存在
      if (!fs.existsSync(this.skillsDir)) {
        if (this.logger) {
          this.logger.warn('skill-loader', 'Skills directory does not exist', {
            path: this.skillsDir
          });
        }
        return skills;
      }

      // 读取skills目录
      const entries = fs.readdirSync(this.skillsDir, { withFileTypes: true });

      // 遍历每个子目录
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skillPath = path.join(this.skillsDir, entry.name);
          const result = await this.loadSingleSkill(skillPath);

          if (result.success && result.skill) {
            skills.push(result.skill);
          } else if (result.error) {
            // 创建错误状态的技能定义
            skills.push({
              metadata: {
                name: entry.name,
                description: 'Failed to load'
              },
              content: '',
              skillPath: skillPath,
              scriptsPath: path.join(this.scriptsDir, entry.name),
              status: 'error',
              error: result.error,
              loadedAt: Date.now()
            });
          }
        }
      }

      if (this.logger) {
        const loadedSkills = skills.filter(s => s.status === 'loaded');
        const errorSkills = skills.filter(s => s.status === 'error');
        
        this.logger.info('skill-loader', 'Skills loaded', {
          total: skills.length,
          loaded: loadedSkills.length,
          error: errorSkills.length,
          skillNames: loadedSkills.map(s => s.metadata.name)
        });
      }

      return skills;
    } catch (error) {
      if (this.logger) {
        this.logger.exception('skill-loader', error as Error, {
          phase: 'loadFromDirectory'
        });
      }
      throw error;
    }
  }


  /**
   * 加载单个技能
   */
  async loadSingleSkill(skillPath: string): Promise<LoadResult> {
    try {
      const skillName = path.basename(skillPath);

      // 尝试查找 skill.md 或 SKILL.md（兼容大小写）
      let skillMdPath = path.join(skillPath, 'skill.md');
      if (!fs.existsSync(skillMdPath)) {
        skillMdPath = path.join(skillPath, 'SKILL.md');
      }

      // 检查skill.md文件是否存在
      if (!fs.existsSync(skillMdPath)) {
        return {
          success: false,
          error: `skill.md or SKILL.md not found in ${skillPath}`
        };
      }

      // 读取skill.md文件
      const content = fs.readFileSync(skillMdPath, 'utf-8');

      // 解析skill.md
      const { metadata, markdown } = this.parseSkillMd(content);

      // 验证元数据
      if (!this.validateMetadata(metadata)) {
        return {
          success: false,
          error: `Invalid metadata in ${skillMdPath}`
        };
      }

      // 检查scripts目录
      const scriptsPath = path.join(this.scriptsDir, skillName);
      const scriptsExist = this.checkScriptsDirectory(scriptsPath);

      if (!scriptsExist && this.logger) {
        this.logger.warn('skill-loader', `Scripts directory not found for skill: ${skillName}`, {
          expectedPath: scriptsPath
        });
      }

      // 检查依赖
      const depCheck = this.checkDependencies(metadata);
      if (!depCheck.available && this.logger) {
        this.logger.warn('skill-loader', `Missing dependencies for skill: ${skillName}`, {
          missing: depCheck.missing
        });
      }

      // 创建技能定义
      const skill: SkillDefinition = {
        metadata,
        content: markdown,
        skillPath,
        scriptsPath,
        status: metadata.enabled === false ? 'disabled' : 'loaded',
        loadedAt: Date.now()
      };

      if (this.logger) {
        this.logger.info('skill-loader', `Skill loaded: ${skillName}`, {
          version: metadata.version,
          tags: metadata.tags
        });
      }

      return {
        success: true,
        skill
      };
    } catch (error) {
      if (this.logger) {
        this.logger.exception('skill-loader', error as Error, {
          phase: 'loadSingleSkill',
          skillPath
        });
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }


  /**
   * 解析skill.md文件（YAML frontmatter + Markdown）
   */
  parseSkillMd(content: string): { metadata: SkillMetadata; markdown: string } {
    // 检查是否有YAML frontmatter
    const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
    const match = content.match(frontmatterRegex);

    if (!match) {
      throw new Error('Invalid skill.md format: YAML frontmatter not found');
    }

    const yamlContent = match[1];
    const markdownContent = match[2];

    // 解析YAML
    let metadata: any;
    try {
      metadata = yaml.load(yamlContent);
    } catch (error) {
      throw new Error(`Failed to parse YAML frontmatter: ${error}`);
    }

    // 验证必需字段
    if (!metadata.name || typeof metadata.name !== 'string') {
      throw new Error('Missing required field: name');
    }

    if (!metadata.description || typeof metadata.description !== 'string') {
      throw new Error('Missing required field: description');
    }

    return {
      metadata: metadata as SkillMetadata,
      markdown: markdownContent.trim()
    };
  }

  /**
   * 验证元数据
   */
  validateMetadata(metadata: SkillMetadata): boolean {
    // 检查必需字段
    if (!metadata.name || !metadata.description) {
      return false;
    }

    // 检查name格式（只允许字母、数字、连字符、下划线）
    if (!/^[a-zA-Z0-9_-]+$/.test(metadata.name)) {
      if (this.logger) {
        this.logger.warn('skill-loader', `Invalid skill name format: ${metadata.name}`);
      }
      return false;
    }

    // 检查可选字段类型
    if (metadata.tags && !Array.isArray(metadata.tags)) {
      return false;
    }

    if (metadata.requires && !Array.isArray(metadata.requires)) {
      return false;
    }

    if (metadata.os && !Array.isArray(metadata.os)) {
      return false;
    }

    return true;
  }

  /**
   * 检查scripts目录是否存在
   */
  checkScriptsDirectory(scriptsPath: string): boolean {
    if (!fs.existsSync(scriptsPath)) {
      return false;
    }

    // 检查是否有入口文件
    const indexJs = path.join(scriptsPath, 'index.js');
    const packageJson = path.join(scriptsPath, 'package.json');

    if (fs.existsSync(indexJs)) {
      return true;
    }

    if (fs.existsSync(packageJson)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(packageJson, 'utf-8'));
        if (pkg.main) {
          const mainFile = path.join(scriptsPath, pkg.main);
          return fs.existsSync(mainFile);
        }
      } catch (error) {
        // package.json解析失败
        return false;
      }
    }

    return false;
  }

  /**
   * 检查依赖是否满足
   */
  checkDependencies(metadata: SkillMetadata): { available: boolean; missing: string[] } {
    const missing: string[] = [];

    if (!metadata.requires || metadata.requires.length === 0) {
      return { available: true, missing: [] };
    }

    // 检查每个依赖
    for (const dep of metadata.requires) {
      // 检查是否是系统命令
      try {
        // 简单检查：尝试执行 --version 或 -v
        const { execSync } = require('child_process');
        try {
          execSync(`${dep} --version`, { stdio: 'ignore' });
        } catch {
          try {
            execSync(`${dep} -v`, { stdio: 'ignore' });
          } catch {
            missing.push(dep);
          }
        }
      } catch (error) {
        missing.push(dep);
      }
    }

    return {
      available: missing.length === 0,
      missing
    };
  }
}
