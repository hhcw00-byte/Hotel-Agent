/**
 * Skill Executor - 技能执行器
 * 
 * 职责：
 * - 执行技能脚本
 * - 参数验证和清理
 * - 超时控制
 * - 输出解析和格式化
 * - 错误处理
 */

import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import type { SkillExecutionContext, SkillResult, SkillDefinition } from '../shared/types';
import { SkillRegistry } from './skill-registry';
import { Logger } from './logger';
import { getBasePath, getDataDir, getWritableBasePath } from './path-resolver';
import { CookieService } from './cookie-service';
import { detectAPIFailure } from './api-failure-detector';
import { app } from 'electron';

export class SkillExecutor {
  private logger: Logger | null;
  private registry: SkillRegistry;
  private defaultTimeout: number;
  private cookieService: CookieService | null = null;

  constructor(registry: SkillRegistry, defaultTimeout: number = 120000, logger?: Logger) {
    this.registry = registry;
    this.defaultTimeout = defaultTimeout;
    this.logger = logger || null;
  }

  /**
   * 设置 CookieService 实例，用于 API 脚本的 Cookie 注入
   */
  setCookieService(service: CookieService): void {
    this.cookieService = service;
  }

  /**
   * 执行技能
   */
  async execute(context: SkillExecutionContext, onProgress?: (event: any) => void): Promise<SkillResult> {
    const startTime = Date.now();

    if (this.logger) {
      this.logger.info('skill-executor', `Executing skill: ${context.skillName}`, {
        params: context.params,
        timeout: context.timeout || this.defaultTimeout
      });
    }

    try {
      // 验证技能存在
      const skill = this.registry.get(context.skillName);
      if (!skill) {
        throw new Error(`Skill not found: ${context.skillName}`);
      }

      // 检查技能状态
      if (skill.status !== 'loaded') {
        throw new Error(`Skill is not available: ${context.skillName} (status: ${skill.status})`);
      }

      // 验证参数
      if (!this.validateParams(context.params)) {
        throw new Error('Invalid parameters');
      }

      // 执行脚本
      const { stdout, stderr } = await this.executeScript(skill, context, onProgress);

      // 解析输出
      const { data, format } = this.parseOutput(stdout);

      const executionTime = Date.now() - startTime;

      if (this.logger) {
        this.logger.info('skill-executor', `Skill executed successfully: ${context.skillName}`, {
          executionTime,
          format
        });
      }

      return {
        success: true,
        output: data,
        executionTime,
        format: format as 'json' | 'text' | 'markdown' | 'html',
        stdout,
        stderr
      };
    } catch (error) {
      const executionTime = Date.now() - startTime;

      if (this.logger) {
        this.logger.exception('skill-executor', error as Error, {
          skillName: context.skillName,
          executionTime
        });
      }

      const failResult: SkillResult = {
        success: false,
        output: null,
        error: error instanceof Error ? error.message : String(error),
        executionTime,
        format: 'text'
      };

      // 对 api-* 类型的 skill，检测是否为 API 失效并附加标记
      if (context.skillName.startsWith('api-') && detectAPIFailure(failResult)) {
        failResult.output = { _apiFailure: true };
        if (this.logger) {
          this.logger.warn('skill-executor', `API failure detected for skill: ${context.skillName}`, {
            error: failResult.error,
          });
        }
      }

      return failResult;
    }
  }

  /**
   * 验证参数
   */
  private validateParams(params: Record<string, any>): boolean {
      // 基础验证：确保params是对象
      if (!params || typeof params !== 'object') {
        return false;
      }

      // 对内容类参数跳过路径遍历检查（如 file-operations 的 content、oldContent、newContent）
      const contentKeys = new Set(['content', 'oldContent', 'newContent', 'extraction_goal', 'navigation_hint', 'prompt', 'description']);

      // 检查是否有危险的参数（路径遍历等）
      for (const [key, value] of Object.entries(params)) {
        if (typeof value === 'string' && !contentKeys.has(key)) {
          // 检查路径遍历
          if (value.includes('..') || value.includes('~')) {
            if (this.logger) {
              this.logger.warn('skill-executor', `Suspicious parameter detected: ${key}`, {
                value
              });
            }
            return false;
          }
        }
      }

      return true;
    }


  /**
   * 清理路径（防止目录遍历）
   */
  private sanitizePath(inputPath: string): string {
    // 移除 .. 和 ~
    let sanitized = inputPath.replace(/\.\./g, '').replace(/~/g, '');
    
    // 规范化路径
    sanitized = path.normalize(sanitized);
    
    return sanitized;
  }

  /**
   * 执行脚本
   */
  private async executeScript(
    skill: SkillDefinition,
    context: SkillExecutionContext,
    onProgress?: (event: any) => void
  ): Promise<{ stdout: string; stderr: string }> {
    // 获取脚本路径
    let scriptPath: string;
    
    if (skill.metadata.script) {
      // 如果 metadata 中指定了 script 路径，使用该路径（相对于项目根目录）
      scriptPath = path.resolve(getBasePath(), skill.metadata.script);
    } else {
      // 否则使用默认路径：scriptsPath/index.js
      scriptPath = path.join(skill.scriptsPath, 'index.js');
    }
    
    if (this.logger) {
      this.logger.debug('skill-executor', `Script path resolved: ${scriptPath}`, {
        skillName: skill.metadata.name,
        hasCustomScript: !!skill.metadata.script
      });
    }

    // 前置检查：脚本文件是否存在（避免 spawn 后才报 Cannot find module，错误信息不明确）
    // 打包后 agent 生成的脚本可能写入 writable path，尝试 fallback
    if (!fs.existsSync(scriptPath)) {
      if (app.isPackaged && skill.metadata.script) {
        const writableFallback = path.resolve(getWritableBasePath(), skill.metadata.script);
        if (fs.existsSync(writableFallback)) {
          scriptPath = writableFallback;
        }
      }
    }
    if (!fs.existsSync(scriptPath)) {
      throw new Error(`Script not found: ${scriptPath}. The skill is registered but its script file does not exist. Need to regenerate via crawler API interception.`);
    }
    
    const timeout = context.timeout || this.defaultTimeout;

    // 准备参数（作为JSON字符串传递）
    const paramsJson = JSON.stringify(context.params);

    // 准备环境变量
    const env: Record<string, string | undefined> = {
      ...process.env,
      SKILL_PARAMS: paramsJson,
      SKILL_NAME: context.skillName,
      // 禁用Playwright/Chromium的详细日志
      DEBUG: '',
      PWDEBUG: '',
      PLAYWRIGHT_CHROMIUM_USE_HEADLESS_NEW: '1',
      // 为 file-operations 提供回退写入路径（当 resources/ 目录不可写时）
      APP_USER_DATA_PATH: app.getPath('userData'),
      // 为子进程提供可写数据目录（打包后 resources/ 只读）
      DATA_DIR: getDataDir(),
      ...context.env
    };

    // Cookie 注入：对 api-* 和 login-check 类型的 skill 注入浏览器 Cookie
    if ((context.skillName.startsWith('api-') || context.skillName === 'login-check') && this.cookieService) {
      const cookieDomain = context.params?.cookieDomain as string | undefined;
      if (cookieDomain) {
        try {
          const cookies = await this.cookieService.getCookiesForDomain(cookieDomain);
          env.BROWSER_COOKIES = cookies;
          env.COOKIE_DOMAIN = cookieDomain;
          if (this.logger) {
            this.logger.info('skill-executor', `Injected cookies for domain: ${cookieDomain}`, {
              skillName: context.skillName,
              cookieLength: cookies.length,
            });
          }
        } catch (error) {
          if (this.logger) {
            this.logger.warn('skill-executor', `Failed to get cookies for domain: ${cookieDomain}`, {
              skillName: context.skillName,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }
    }

    // 执行脚本
    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let isTimedOut = false;

      // 启动子进程
      // Windows 下 Electron 环境中 PATH 不含 node，使用 process.execPath + ELECTRON_RUN_AS_NODE 绕过
      const nodeExecutable = process.execPath;

      // 确定工作目录：优先使用 context.workingDir，否则使用项目根目录（app.getAppPath()）
      // 这样 data-persistence 等脚本会在项目根目录创建 data/ 文件夹
      const workingDir = context.workingDir || getBasePath();

      if (this.logger) {
        this.logger.info('skill-executor', `Spawning child process`, {
          nodeExecutable,
          scriptPath,
          workingDir,
          skillName: context.skillName,
          isPackaged: app.isPackaged,
        });
      }

      const child = spawn(nodeExecutable, [scriptPath, paramsJson], {
        cwd: workingDir,
        env: { ...env, ELECTRON_RUN_AS_NODE: '1' }
      });

      // 安全超时：如果子进程在 5 分钟内没有任何输出也没有退出，强制 kill
      // 防止模块加载卡死等极端情况导致进程永远挂起
      let lastActivity = Date.now();
      const SAFETY_TIMEOUT = 5 * 60 * 1000; // 5 minutes
      const safetyTimer = setInterval(() => {
        if (Date.now() - lastActivity > SAFETY_TIMEOUT) {
          clearInterval(safetyTimer);
          if (this.logger) {
            this.logger.error('skill-executor', `Safety timeout: child process has no activity for ${SAFETY_TIMEOUT / 1000}s, killing`, {
              skillName: context.skillName,
              pid: child.pid,
            });
          }
          isTimedOut = true;
          child.kill('SIGKILL');
        }
      }, 10000);

      // 收集stdout — 逐行解析，progress 事件实时推送
      let stdoutBuffer = '';
      child.stdout.on('data', (data) => {
        lastActivity = Date.now();
        stdoutBuffer += data.toString();
        const lines = stdoutBuffer.split('\n');
        stdoutBuffer = lines.pop() || '';  // 保留不完整的最后一行
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const parsed = JSON.parse(trimmed);
            if (parsed?.type === 'progress' && onProgress) {
              onProgress(parsed);
              continue;  // progress 事件不加入 stdout 累积
            }
          } catch {
            // 不是 JSON 行，保留原样
          }
          stdout += line + '\n';
        }
      });

      // 收集stderr 并实时输出到控制台（用于调试）
      // 过滤Chromium/Playwright的SSL错误，避免终端刷屏
      const sslErrorPatterns = [
        'ssl_client_socket_impl.cc',
        'handshake failed',
        'SSL error code',
        'net_error -100',
        'net::ERR_',
        'ERROR:ssl',
        'ERROR:network',
        'certificate',
        'CERT_',
      ];
      
      const shouldFilterStderr = (text: string): boolean => {
        return sslErrorPatterns.some(pattern => text.includes(pattern));
      };
      
      child.stderr.on('data', (data) => {
        lastActivity = Date.now();
        const text = data.toString();
        stderr += text;
        
        // 过滤SSL错误后再输出到控制台
        if (!shouldFilterStderr(text)) {
          process.stderr.write(text);
        }

        // 🔥 关键诊断行也写入 Logger，确保出现在日志文件中
        if (this.logger && (text.includes('[CRAWLER-BOOT]') || text.includes('[CRAWLER-ENV]') || text.includes('[CRAWLER-DEBUG]') || text.includes('[extractor]'))) {
          for (const line of text.split('\n')) {
            const trimmed = line.trim();
            if (trimmed) {
              this.logger.info('skill-stderr', trimmed, { skillName: context.skillName });
            }
          }
        }
      });

      // 处理错误
      child.on('error', (error) => {
        reject(new Error(`Failed to execute script: ${error.message}`));
      });

      child.on('close', (code) => {
        clearInterval(safetyTimer);

        // 爬虫子进程退出后，主动清理 CDP 锁文件。
        // SIGKILL 不触发子进程的 process.once('exit')，锁会残留。
        // 主进程的 close 回调一定会执行，在这里清理最可靠。
        if (context.skillName === 'ai-web-crawler' && child.pid != null) {
          try {
            const lockFile = path.join(os.tmpdir(), 'hotel-ai-browser-cdp.lock');
            if (fs.existsSync(lockFile)) {
              const lockPid = fs.readFileSync(lockFile, 'utf-8').trim();
              if (lockPid === String(child.pid)) {
                fs.unlinkSync(lockFile);
              }
            }
          } catch (_) {}
        }

        // 安全网：background 模式的爬虫子进程退出后，兜底写 IPC 文件通知 Electron 销毁 bgTab
        // 爬虫自己的 closeBackgroundPage() 是 fire-and-forget，可能还没被 Electron 轮询器处理就 exit 了
        if (context.params?.background && context.params?.sessionId) {
          try {
            const ipcFile = path.join(os.tmpdir(), `hotel-ai-browser-ipc-executor-cleanup-${context.params.sessionId}.json`);
            fs.writeFileSync(ipcFile, JSON.stringify({
              action: 'destroy_bg_tabs_by_session',
              sessionId: context.params.sessionId,
              requestId: `executor-cleanup-${context.params.sessionId}`,
              timestamp: Date.now()
            }));
          } catch {}
        }

        if (isTimedOut) {
          reject(new Error(`Script execution timed out (${timeout}ms)`));
        } else if (code !== 0) {
          // 即使退出码非 0，也尝试解析 stdout（脚本可能已经输出了错误信息）
          if (stdout.trim()) {
            if (this.logger) {
              this.logger.warn('skill-executor', `Script exited with code ${code}, but has output`, {
                skillName: skill.metadata.name,
                executionTime: Date.now() - Date.now()
              });
            }
            resolve({ stdout, stderr });
          } else {
            reject(new Error(`Script exited with code ${code}: ${stderr}`));
          }
        } else {
          resolve({ stdout, stderr });
        }
      });
    });
  }


  /**
   * 解析输出
   * 爬虫脚本会混合输出 progress 行（单行JSON）和最终结果（多行格式化JSON）。
   * 策略：把所有非 progress 的内容拼在一起，尝试解析出最后一个完整的 JSON 对象。
   */
  private parseOutput(output: string): { data: any; format: string } {
    if (!output || output.trim().length === 0) {
      return { data: null, format: 'text' };
    }

    // 1. 先把 stdout 按行拆分，过滤掉 progress 行，再拼回完整字符串
    const lines = output.split('\n');
    const filteredLines: string[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      // 跳过单行 progress JSON（含 type:'progress' 字段）
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && parsed.type === 'progress') continue;
      } catch {
        // 不是完整 JSON 行，保留（可能是多行 JSON 的一部分）
      }
      filteredLines.push(line);
    }
    const filtered = filteredLines.join('\n').trim();

    // 2. 尝试直接解析过滤后的完整字符串
    try {
      const data = JSON.parse(filtered);
      return { data, format: 'json' };
    } catch {
      // 继续尝试其他方法
    }

    // 3. 从字符串中找最后一个完整的 JSON 对象（{...}）
    //    用栈方式找到最外层括号匹配的最后一个对象
    const lastJsonObj = this.extractLastJsonObject(filtered);
    if (lastJsonObj !== null) {
      try {
        const data = JSON.parse(lastJsonObj);
        return { data, format: 'json' };
      } catch {
        // 解析失败继续
      }
    }

    // 4. 兜底：检查是否是 Markdown / HTML / 纯文本
    if (output.includes('```') || output.includes('##') || output.includes('**')) {
      return { data: output, format: 'markdown' };
    }
    if (output.includes('<html') || output.includes('<!DOCTYPE')) {
      return { data: output, format: 'html' };
    }
    return { data: output, format: 'text' };
  }

  /**
   * 从字符串中提取最后一个完整的 JSON 对象（{...}）
   */
  private extractLastJsonObject(text: string): string | null {
    let lastStart = -1;
    let depth = 0;
    let inString = false;
    let escape = false;
    let lastComplete: string | null = null;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];

      if (escape) { escape = false; continue; }
      if (ch === '\\' && inString) { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;

      if (ch === '{') {
        if (depth === 0) lastStart = i;
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0 && lastStart !== -1) {
          lastComplete = text.substring(lastStart, i + 1);
        }
      }
    }

    return lastComplete;
  }

  /**
   * 强制超时（辅助方法）
   */
  private enforceTimeout<T>(promise: Promise<T>, timeout: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Operation timed out after ${timeout}ms`));
        }, timeout);
      })
    ]);
  }
}
