/**
 * Skill Manager - 技能管理器
 * 
 * 职责：
 * - 协调所有技能相关操作
 * - 管理技能生命周期（加载、重载、卸载）
 * - 提供技能查询接口
 * - 生成AI可用的技能上下文
 */

import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import type { SkillDefinition, SkillResult, SkillExecutionContext } from '../shared/types';
import { SkillRegistry } from './skill-registry';
import { SkillLoader } from './skill-loader';
import { SkillExecutor } from './skill-executor';
import { Logger } from './logger';
import { getMemoryManager } from './memory/manager';
import type { IMemoryManager } from './memory/interfaces';
import { CookieService } from './cookie-service';
import { getWritableBasePath } from './path-resolver';

export class SkillManager {
  private registry: SkillRegistry;
  private loader: SkillLoader;
  private executor: SkillExecutor;
  private logger: Logger | null;
  private skillsDir: string;
  private scriptsDir: string;
  private isInitialized: boolean = false;
  private defaultTimeout: number;
  private llmEnv: Record<string, string> = {};
  private memoryManager: IMemoryManager | null = null;
  private cookieService: CookieService | null = null;

  constructor(skillsDir: string, scriptsDir: string, defaultTimeout: number = 30000, logger?: Logger) {
    this.skillsDir = skillsDir;
    this.scriptsDir = scriptsDir;
    this.defaultTimeout = defaultTimeout;
    this.logger = logger || null;

    this.registry = new SkillRegistry(logger);
    this.loader = new SkillLoader(skillsDir, scriptsDir, logger);
    this.executor = new SkillExecutor(this.registry, defaultTimeout, logger);
  }

  /**
   * 设置 LLM 环境变量，注入给爬虫子进程
   */
  setLLMEnv(apiKey: string, baseURL: string, model: string): void {
    this.llmEnv = {
      ...this.llmEnv,
      LLM_API_KEY: apiKey,
      LLM_BASE_URL: baseURL,
      LLM_MODEL: model,
    };
    if (this.logger) {
      this.logger.info('skill-manager', 'LLM env set for subprocess', { model, baseURL });
    }
  }

  /**
   * 设置数据库环境变量，注入给子进程（data-persistence / database-operations）
   */
  setDbEnv(host: string, port: string, user: string, password: string, userId: string): void {
    this.llmEnv = {
      ...this.llmEnv,
      DB_HOST: host,
      DB_PORT: port,
      DB_USER: user,
      DB_PASSWORD: password,
      DB_USER_ID: userId,
    };
    if (this.logger) {
      this.logger.info('skill-manager', 'DB env set for subprocess', { host, userId });
    }
  }

  /**
   * 设置 CookieService 实例，传递给 SkillExecutor 用于 Cookie 注入
   */
  setCookieService(service: CookieService): void {
    this.cookieService = service;
    this.executor.setCookieService(service);
    if (this.logger) {
      this.logger.info('skill-manager', 'CookieService set for SkillExecutor');
    }
  }

  /**
   * 初始化技能管理器
   */
  async initialize(): Promise<void> {
    if (this.logger) {
      this.logger.info('skill-manager', 'Initializing Skill Manager', {
        skillsDir: this.skillsDir,
        scriptsDir: this.scriptsDir
      });
    }

    try {
      // 初始化记忆系统（可选，失败不影响Skill系统）
      try {
        this.memoryManager = getMemoryManager();
        const initResult = await this.memoryManager.initialize();
        if (initResult.success && this.logger) {
          this.logger.info('skill-manager', 'Memory system initialized for skills');
        }
      } catch (memoryError) {
        // 记忆系统初始化失败，记录警告但继续
        if (this.logger) {
          this.logger.warn('skill-manager', 'Memory system initialization failed, skills will work without memory', {
            error: memoryError instanceof Error ? memoryError.message : String(memoryError)
          });
        }
        this.memoryManager = null;
      }

      // 加载所有技能
      await this.loadAllSkills();
      
      this.isInitialized = true;

      if (this.logger) {
        const stats = this.registry.getStats();
        this.logger.info('skill-manager', 'Skill Manager initialized', stats);
      }
    } catch (error) {
      if (this.logger) {
        this.logger.exception('skill-manager', error as Error, {
          phase: 'initialize'
        });
      }
      throw error;
    }
  }

  /**
   * 加载所有技能
   */
  async loadAllSkills(): Promise<void> {
    if (this.logger) {
      this.logger.info('skill-manager', 'Loading all skills');
    }

    try {
      // 清空现有技能
      this.registry.clear();

      // 从主 skills 目录加载技能
      const skills = await this.loader.loadFromDirectory();

      // 注册所有技能
      for (const skill of skills) {
        this.registry.register(skill);
      }

      // 打包模式下，额外扫描 writable path 的 skills/ 目录（agent 生成的技能）
      if (app.isPackaged) {
        const writableSkillsDir = path.join(getWritableBasePath(), 'skills');
        if (fs.existsSync(writableSkillsDir)) {
          const writableLoader = new SkillLoader(writableSkillsDir, this.scriptsDir, this.logger || undefined);
          const writableSkills = await writableLoader.loadFromDirectory();
          for (const skill of writableSkills) {
            // 仅注册主目录中不存在的技能（避免覆盖）
            if (!this.registry.get(skill.metadata.name)) {
              this.registry.register(skill);
            }
          }
          if (this.logger && writableSkills.length > 0) {
            this.logger.info('skill-manager', 'Loaded writable skills', {
              count: writableSkills.filter(s => s.status === 'loaded').length,
              dir: writableSkillsDir,
            });
          }
        }
      }

      if (this.logger) {
        const allSkills = this.registry.getAll();
        const loadedSkills = allSkills.filter(s => s.status === 'loaded');
        const errorSkills = allSkills.filter(s => s.status === 'error');

        this.logger.info('skill-manager', 'All skills loaded', {
          total: allSkills.length,
          loaded: loadedSkills.length,
          error: errorSkills.length,
          loadedSkillNames: loadedSkills.map(s => s.metadata.name),
          errorSkillNames: errorSkills.map(s => s.metadata.name)
        });
      }
    } catch (error) {
      if (this.logger) {
        this.logger.exception('skill-manager', error as Error, {
          phase: 'loadAllSkills'
        });
      }
      throw error;
    }
  }

  /**
   * 加载单个技能
   */
  async loadSkill(skillName: string): Promise<void> {
    if (this.logger) {
      this.logger.info('skill-manager', `Loading skill: ${skillName}`);
    }

    try {
      const skillPath = path.join(this.skillsDir, skillName);
      const result = await this.loader.loadSingleSkill(skillPath);

      if (result.success && result.skill) {
        this.registry.register(result.skill);
        
        if (this.logger) {
          this.logger.info('skill-manager', `Skill loaded: ${skillName}`);
        }
      } else {
        throw new Error(result.error || 'Failed to load skill');
      }
    } catch (error) {
      if (this.logger) {
        this.logger.exception('skill-manager', error as Error, {
          phase: 'loadSkill',
          skillName
        });
      }
      throw error;
    }
  }


  /**
   * 重载技能
   */
  async reloadSkill(skillName: string): Promise<void> {
    if (this.logger) {
      this.logger.info('skill-manager', `Reloading skill: ${skillName}`);
    }

    try {
      // 注销旧技能
      this.registry.unregister(skillName);

      // 重新加载
      await this.loadSkill(skillName);

      if (this.logger) {
        this.logger.info('skill-manager', `Skill reloaded: ${skillName}`);
      }
    } catch (error) {
      if (this.logger) {
        this.logger.exception('skill-manager', error as Error, {
          phase: 'reloadSkill',
          skillName
        });
      }
      throw error;
    }
  }

  /**
   * 重载所有技能
   */
  async reloadAllSkills(): Promise<void> {
    if (this.logger) {
      this.logger.info('skill-manager', 'Reloading all skills');
    }

    await this.loadAllSkills();
  }

  /**
   * 获取所有可用技能
   */
  getAvailableSkills(): SkillDefinition[] {
    return this.registry.getAll();
  }

  /**
   * 获取指定技能
   */
  getSkill(skillName: string): SkillDefinition | null {
    return this.registry.get(skillName);
  }

  /**
   * 获取已启用的技能
   */
  getEnabledSkills(): SkillDefinition[] {
    return this.registry.getEnabled();
  }

  /**
   * 格式化技能信息供AI使用
   */
  getSkillsForAI(): string {
    const enabledSkills = this.getEnabledSkills();

    if (enabledSkills.length === 0) {
      return '';
    }

    // 创建紧凑的技能列表
    let skillsContext = '\n\n## Available Skills\n\n';
    skillsContext += 'You have access to the following skills:\n\n';

    for (const skill of enabledSkills) {
      skillsContext += `### ${skill.metadata.name}\n`;
      skillsContext += `${skill.metadata.description}\n`;
      
      if (skill.metadata.tags && skill.metadata.tags.length > 0) {
        skillsContext += `Tags: ${skill.metadata.tags.join(', ')}\n`;
      }
      
      // 添加简化的使用说明（从content中提取）
      const usageSection = this.extractUsageSection(skill.content);
      if (usageSection) {
        skillsContext += `\n${usageSection}\n`;
      }
      
      skillsContext += '\n';
    }

    skillsContext += 'To use a skill, call the executeSkill function with the skill name and parameters.\n';

    return skillsContext;
  }

  /**
   * 从skill.md内容中提取使用说明部分
   */
  private extractUsageSection(content: string): string {
    // 简单提取：查找"使用方法"或"Usage"部分
    const usageRegex = /##\s*(使用方法|Usage|使用示例|Examples?)\s*\n([\s\S]*?)(?=\n##|$)/i;
    const match = content.match(usageRegex);
    
    if (match) {
      // 限制长度，避免提示词过长
      const usage = match[0].trim();
      return usage.length > 500 ? usage.substring(0, 500) + '...' : usage;
    }
    
    return '';
  }

  /**
   * 执行技能
   */
  async executeSkill(skillName: string, params: Record<string, any>, onProgress?: (event: any) => void): Promise<SkillResult> {
    if (!this.isInitialized) {
      throw new Error('Skill Manager not initialized');
    }

    if (this.logger) {
      this.logger.info('skill-manager', `Executing skill: ${skillName}`, {
        params
      });
    }

    try {
      // 检查技能是否存在
      const skill = this.registry.get(skillName);
      if (!skill) {
        throw new Error(`Skill not found: ${skillName}`);
      }

      // 创建执行上下文，注入 LLM 环境变量和记忆系统
      const context: SkillExecutionContext = {
        skillName,
        params,
        timeout: this.defaultTimeout,
        env: this.llmEnv,
        memory: this.memoryManager  // 注入记忆管理器
      };

      // 执行技能
      const result = await this.executor.execute(context, onProgress);

      if (this.logger) {
        if (result.success) {
          this.logger.info('skill-manager', `Skill executed successfully: ${skillName}`, {
            executionTime: result.executionTime,
            format: result.format
          });
        } else {
          this.logger.error('skill-manager', `Skill execution failed: ${skillName}`, {
            error: result.error,
            executionTime: result.executionTime
          });
        }
      }

      // file-operations 写入 skills/ 目录后，自动热加载新 skill
      // 仅对 writeFile 和 editFile 操作触发，readFile 和 listDir 不触发
      if (skillName === 'file-operations' && result.success) {
        const operation = params.operation || '';
        const filePath = params.filePath || '';
        if ((operation === 'writeFile' || operation === 'editFile') && filePath.startsWith('skills/')) {
          try {
            await this.reloadAllSkills();
            if (this.logger) {
              this.logger.info('skill-manager', 'Auto-reloaded skills after file-operations wrote to skills/', {
                filePath,
                operation,
                newSkillCount: this.registry.getAll().length
              });
            }
          } catch (reloadError) {
            if (this.logger) {
              this.logger.warn('skill-manager', 'Failed to auto-reload skills', {
                error: reloadError instanceof Error ? reloadError.message : String(reloadError)
              });
            }
          }
        }
      }

      return result;
    } catch (error) {
      if (this.logger) {
        this.logger.exception('skill-manager', error as Error, {
          phase: 'executeSkill',
          skillName
        });
      }

      return {
        success: false,
        output: null,
        error: error instanceof Error ? error.message : String(error),
        executionTime: 0,
        format: 'text'
      };
    }
  }

  // ── platformCode → login-check 参数映射 ──
  private static PLATFORM_LOGIN_MAP: Record<string, { domain: string; url: string; name: string }> = {
    ctrip:   { domain: 'ebooking.ctrip.com', url: 'https://ebooking.ctrip.com/home/mainland?microJump=true', name: '携程后台' },
    meituan: { domain: 'me.meituan.com', url: 'https://me.meituan.com/ebooking/merchant/ebIframe?iUrl=%2Febooking%2Fnew-workbench%2Findex.html%23%2F', name: '美团后台' },
    trip:    { domain: 'ebooking.trip.com', url: 'https://ebooking.trip.com/home/mainland?microJump=true', name: 'Trip.com后台' },
    // Booking 不做预检：Booking 的 WAF 对频繁打开后台页面敏感，会主动让 session 失效
    // Booking 的 verify-script.js 内部已有登录检测（检测 URL 重定向到 sign-in）
  };

  // 不再使用 API 探测，所有平台统一用 login-check（LoginDetector bgTab）检测
  // LoginDetector 通过 Electron 内嵌浏览器的 session 检测，不依赖系统 Chrome cookie
  private static API_PROBE_MAP: Record<string, { skill: string; cookieDomain: string }> = {};

  /**
   * 登录检测层（供 Agent 调价前调用）
   * ctrip/trip：调 API 探测，无数据 = 未登录
   * meituan/booking：用 login-check（LoginDetector）
   */
  async checkPlatformLogins(platformCodes: string[]): Promise<{ allLoggedIn: boolean; results: Record<string, boolean>; notLoggedIn: string[] }> {
    const results: Record<string, boolean> = {};
    const notLoggedIn: string[] = [];

    for (const code of platformCodes) {
      const target = SkillManager.PLATFORM_LOGIN_MAP[code];
      if (!target) { results[code] = true; continue; }

      const probe = SkillManager.API_PROBE_MAP[code];
      try {
        let loggedIn: boolean;

        if (probe && this.registry.get(probe.skill)) {
          // ── API 探测：调实际 API，看返回是否有数据 ──
          if (this.logger) this.logger.info('skill-manager', `API probe login check: ${target.name} via ${probe.skill}`);
          const today = new Date().toISOString().slice(0, 10);
          const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
          const res = await this.executor.execute({
            skillName: probe.skill,
            params: { cookieDomain: probe.cookieDomain, checkIn: today, checkOut: tomorrow },
            timeout: 60000,
            env: this.llmEnv,
          });
          loggedIn = this.isApiProbeDataValid(res);
        } else {
          // ── LoginDetector 检测 ──
          if (this.logger) this.logger.info('skill-manager', `Login check: ${target.name}`);
          const res = await this.executor.execute({
            skillName: 'login-check',
            params: { domain: target.domain, url: target.url, name: target.name },
            timeout: 60000,
            env: this.llmEnv,
          });
          const output = res.output;
          loggedIn = (output && typeof output.isLoggedIn === 'boolean') ? output.isLoggedIn : true;
        }

        results[code] = loggedIn;
        if (!loggedIn) notLoggedIn.push(target.name);
        if (this.logger) this.logger.info('skill-manager', `${target.name} → ${loggedIn ? 'OK' : 'NOT LOGGED IN'}`);
      } catch (e) {
        results[code] = true; // 检测出错默认放行
        if (this.logger) this.logger.warn('skill-manager', `Login check error for ${target.name}: ${e}`);
      }
    }

    return { allLoggedIn: notLoggedIn.length === 0, results, notLoggedIn };
  }

  /** API 探测结果是否包含有效数据（无数据 = 未登录） */
  private isApiProbeDataValid(res: SkillResult): boolean {
    if (!res.success) return false;
    const out = res.output;
    if (!out || typeof out !== 'object') return false;
    // API 脚本返回 { success: false, error: ... }
    if (out.success === false) return false;
    // 检查是否有实际业务数据
    const data = out.data || out;
    if (Array.isArray(data) && data.length === 0) return false;
    if (typeof data === 'object') {
      const keys = Object.keys(data);
      if (keys.length === 0) return false;
      // productList 为空数组 = 无数据
      if (Array.isArray(data.productList) && data.productList.length === 0) return false;
      if (Array.isArray(data.roomList) && data.roomList.length === 0) return false;
    }
    return true;
  }

  /**
    return this.isInitialized;
  }

  /**
   * 获取技能统计信息
   */
  getStats() {
    return this.registry.getStats();
  }

  /**
   * 获取 Executor 实例（用于设置 WebContents Proxy）
   */
  getExecutor(): SkillExecutor {
    return this.executor;
  }
}
