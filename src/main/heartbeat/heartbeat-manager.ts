/**
 * Heartbeat Manager
 * 心跳管理器 - 创建独立 PiAgentManager 实例，按 SKILL 策略执行定时任务
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CronJob } from 'cron';
import { BrowserWindow } from 'electron';
import { PiAgentManager } from '../pi-agent-manager';
import { getDataDir } from '../path-resolver';
import type { SkillManager } from '../skill-manager';
import type { Logger } from '../logger';
import type { PiAgentConfig } from '../../shared/types';
import { IPC_CHANNELS } from '../../shared/types';
import type { HeartbeatTask, TaskSchedule, TaskExecutionLog, PlatformGroup, ConcurrentRoundResult, PlatformExecutionResult, TaskExecutionResult } from './types';
import { databaseManager } from '../../../database/dist/database-manager';
import { getRecoveryModel, loadLLMConfig, switchToFallback, isUsingFallback, isProviderUnavailableError } from '../../shared/llm-config-loader';

const TASK_TIMEOUT_MS = 20 * 60 * 1000; // 20 minutes
const MAX_CONCURRENT_RECOVERY = 2;      // 最多同时运行的 recovery Agent 数量

const PLATFORM_START_URL: Record<string, string> = {
  'ctrip':   'https://hotels.ctrip.com/',
  'trip':    'https://www.trip.com/',
  'meituan': 'https://www.meituan.com/',
  'booking': 'https://www.booking.com/',
  'fliggy':  'https://www.fliggy.com/',
};

export class HeartbeatManager {
  private piAgentConfig: PiAgentConfig;
  private skillManager: SkillManager;
  private logger: Logger | null;
  private configPath: string;
  private resourcesBasePath: string;
  private tasks: Map<string, HeartbeatTask> = new Map();
  private cronJobs: Map<string, CronJob> = new Map();
  private executingTasks: Set<string> = new Set();
  private executingPlatforms: Set<string> = new Set();
  private platformQueues: Map<string, HeartbeatTask[]> = new Map();
  private taskQueue: HeartbeatTask[] = [];
  private isProcessingQueue = false;
  private isRunning = false;
  private mainWindow: BrowserWindow | null = null;
  private activeRecoveryCount = 0;
  private loginAlertService: any = null; // 登录提醒服务

  constructor(
    piAgentConfig: PiAgentConfig,
    skillManager: SkillManager,
    configPath: string = './tasks/schedule.json',
    logger?: Logger,
    resourcesBasePath?: string
  ) {
    this.piAgentConfig = piAgentConfig;
    this.skillManager = skillManager;
    this.configPath = configPath;
    this.resourcesBasePath = resourcesBasePath || path.resolve(path.dirname(configPath), '..');
    this.logger = logger || null;
  }

  /**
   * 启动心跳
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      this.log('warn', 'Heartbeat already running');
      return;
    }

    this.log('info', 'Starting heartbeat manager');
    await this.loadTasks();

    for (const task of this.tasks.values()) {
      if (task.enabled) {
        this.scheduleCronJob(task);
      }
    }

    this.isRunning = true;

    const enabledCount = Array.from(this.tasks.values()).filter(t => t.enabled).length;
    this.log('info', 'Heartbeat manager started', {
      tasksCount: this.tasks.size,
      enabledCount
    });
  }

  /**
   * 停止心跳
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;

    this.log('info', 'Stopping heartbeat manager');

    for (const [taskId, job] of this.cronJobs.entries()) {
      job.stop();
      this.log('debug', `Stopped cron job: ${taskId}`);
    }

    this.cronJobs.clear();
    this.taskQueue = [];
    this.platformQueues.clear();
    this.isRunning = false;

    this.log('info', 'Heartbeat manager stopped');
  }

  /**
   * 重新加载任务配置
   */
  async reload(): Promise<void> {
    this.log('info', 'Reloading tasks');
    await this.stop();
    await this.start();
  }

  /**
   * 加载任务配置
   */
  private async loadTasks(): Promise<void> {
    try {
      if (!fs.existsSync(this.configPath)) {
        this.log('warn', 'Config file not found, creating default', { configPath: this.configPath });
        const configDir = path.dirname(this.configPath);
        if (!fs.existsSync(configDir)) {
          fs.mkdirSync(configDir, { recursive: true });
        }
        const defaultSchedule: TaskSchedule = { tasks: [] };
        fs.writeFileSync(this.configPath, JSON.stringify(defaultSchedule, null, 2));
        return;
      }

      const configContent = fs.readFileSync(this.configPath, 'utf-8');
      const schedule: TaskSchedule = JSON.parse(configContent);
      this.tasks.clear();

      for (const task of schedule.tasks) {
        if (!task.id || !task.skill || !task.cron) {
          this.log('warn', 'Invalid task config, skipping', { task });
          continue;
        }
        this.tasks.set(task.id, task);
      }

      this.log('info', 'Tasks loaded', {
        count: this.tasks.size,
        tasks: Array.from(this.tasks.keys())
      });
    } catch (error) {
      this.log('error', 'Failed to load tasks', {
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * 为任务创建 cron job
   */
  private scheduleCronJob(task: HeartbeatTask): void {
    try {
      const job = new CronJob(
        task.cron,
        () => this.enqueueTask(task),
        null,
        true,
        'Asia/Shanghai'
      );

      this.cronJobs.set(task.id, job);
      this.log('info', `Scheduled task: ${task.id}`, {
        cron: task.cron,
        nextRun: job.nextDate().toISO()
      });
    } catch (error) {
      this.log('error', `Failed to schedule task: ${task.id}`, {
        error: error instanceof Error ? error.message : String(error),
        cron: task.cron
      });
    }
  }

  /**
   * 将任务加入串行队列（避免并发 LLM 调用过多）
   */
  private enqueueTask(task: HeartbeatTask): void {
    if (this.executingTasks.has(task.id)) {
      this.log('warn', `Task already executing, skipping: ${task.id}`);
      return;
    }

    const platform = task.platform || task.id;

    // 加入对应平台的队列
    if (!this.platformQueues.has(platform)) {
      this.platformQueues.set(platform, []);
    }
    this.platformQueues.get(platform)!.push(task);

    this.log('info', `Task enqueued: ${task.id}`, { platform, queueLength: this.platformQueues.get(platform)!.length });

    // 如果该平台当前没有在执行，立即启动（不阻塞其他平台）
    this.processPlatformQueue(platform);
  }

  /**
   * 处理单个平台的任务队列（串行执行该平台内的任务）。
   * 不同平台的 processPlatformQueue 可以并发运行。
   */
  private async processPlatformQueue(platform: string): Promise<void> {
    if (this.executingPlatforms.has(platform)) return;
    this.executingPlatforms.add(platform);

    try {
      const queue = this.platformQueues.get(platform);
      while (queue && queue.length > 0) {
        const task = queue.shift()!;
        if (this.executingTasks.has(task.id)) continue;
        await this.executeTask(task);
      }
    } finally {
      this.executingPlatforms.delete(platform);
    }
  }

  /**
   * 执行任务：直接调用 api-* 脚本 → data-store 入库。失败时走 Agent 闭环修复。
   */
  private async executeTask(task: HeartbeatTask): Promise<void> {
    const startTime = Date.now();
    this.executingTasks.add(task.id);
    this.pushTaskStatus(task.id, 'running');

    this.log('info', `Executing task: ${task.id}`, { skill: task.skill, params: task.params });

    // 0. 登录预检：检测该任务对应平台是否已登录
    const cookieDomain = (task.params as any)?.cookieDomain;
    if (cookieDomain) {
      const loginOk = await this.checkLoginForTask(task);
      if (!loginOk) {
        this.log('warn', `Skipping task ${task.id}: platform not logged in`, { cookieDomain });
        this.executingTasks.delete(task.id);
        this.pushTaskStatus(task.id, 'done');
        return;
      }
    }

    // 1. 前置修补：脚本中过期的硬编码日期替换为动态计算
    this.patchExpiredDates(task);

    // 0b. 前置修补：脚本中默认 hotelId 如果不是本店 ID，修正为本店 ID
    await this.patchWrongHotelId(task);

    // 0c. 从 hotel_config 注入本店平台 ID 到 taskParams
    const taskParams: Record<string, any> = { ...(task.params || {}) };
    try {
      const cfg = await databaseManager.getHotelConfig();
      console.error(`[INJECT-DEBUG] skill=${task.skill}, cfg=${cfg ? JSON.stringify({poi:cfg.meituan_poi_id,partner:cfg.meituan_partner_id,ctrip:cfg.ctrip_hotel_id,trip:cfg.trip_hotel_id,booking:cfg.booking_hotel_id}) : 'null'}, taskParams.hotelId=${taskParams.hotelId}`);
      if (cfg) {
        if (!taskParams.hotelId && cfg.ctrip_hotel_id && task.skill === 'api-ctrip-public-price') taskParams.hotelId = cfg.ctrip_hotel_id;
        if (!taskParams.hotelId && cfg.trip_hotel_id && task.skill === 'api-trip-public-price') taskParams.hotelId = cfg.trip_hotel_id;
        if (!taskParams.hotelSlug && cfg.booking_hotel_id && task.skill === 'api-booking-public-price') taskParams.hotelSlug = cfg.booking_hotel_id;
        if (!taskParams.poiId && cfg.meituan_poi_id && task.skill === 'api-meituan-backend-price') taskParams.poiId = cfg.meituan_poi_id;
        if (!taskParams.partnerId && cfg.meituan_partner_id && task.skill === 'api-meituan-backend-price') taskParams.partnerId = parseInt(cfg.meituan_partner_id, 10) || cfg.meituan_partner_id;
      }
    } catch (_) {}

    // 0d. 美团 poiId/partnerId 缺失时，自动从后台页面拦截提取
    if (task.skill === 'api-meituan-backend-price' && (!taskParams.poiId || !taskParams.partnerId)) {
      this.log('info', `Meituan poiId/partnerId missing, attempting auto-extraction via crawler`);
      try {
        const extracted = await this.extractMeituanIdsViaCrawler();
        if (extracted) {
          if (extracted.poiId) taskParams.poiId = extracted.poiId;
          if (extracted.partnerId) taskParams.partnerId = extracted.partnerId;
          // 存入数据库，下次不需要再提取
          await databaseManager.saveHotelConfig({
            meituanPoiId: extracted.poiId || undefined,
            meituanPartnerId: extracted.partnerId || undefined
          });
          this.log('info', `Meituan IDs extracted: poiId=${extracted.poiId}, partnerId=${extracted.partnerId}`);
        }
      } catch (e: any) {
        this.log('warn', `Meituan ID auto-extraction failed: ${e.message}`);
      }
    }

    try {
      // 1. 直接调用 api-* 脚本
      const apiResult = await Promise.race([
        this.skillManager.executeSkill(task.skill, taskParams),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`API call timeout after ${TASK_TIMEOUT_MS / 1000}s`)), TASK_TIMEOUT_MS)
        )
      ]);

      if (!apiResult.success || apiResult.output?.success === false) {
        const rawErr = apiResult.output?.error || apiResult.error || 'unknown error';
        const errStr = typeof rawErr === 'object' ? JSON.stringify(rawErr) : String(rawErr);
        throw new Error(`API skill failed: ${errStr}`);
      }

      // 检测 API 返回成功但数据实质为空的情况（如 Trip.com 返回 { data: {} }）
      if (this.isEmptyAPIResponse(apiResult.output)) {
        // 附上 API 实际返回的关键字段，帮助 Agent 更精准判断问题
        const hint = this.extractResponseHint(apiResult.output);
        throw new Error(`API returned empty data: response structure is valid but contains no actual records.${hint ? ' Response hint: ' + hint : ''}`);
      }

      this.log('info', `API call succeeded: ${task.skill}`, { executionTime: apiResult.executionTime });

      // 2. 调用 data-store 清洗 + 入库
      const storeResult = await this.skillManager.executeSkill('data-store', { source: task.skill });

      // 诊断：写文件记录 data-store 结果
      const storeDiagPath = path.join(getDataDir(), 'data-store-diag.json');
      try {
        fs.writeFileSync(storeDiagPath, JSON.stringify({
          timestamp: new Date().toISOString(),
          skill: task.skill,
          storeSuccess: storeResult.success,
          storeOutput: storeResult.output,
          storeError: storeResult.error,
        }, null, 2));
      } catch {}

      if (!storeResult.success || storeResult.output?.success === false || storeResult.output == null) {
        const storeError = storeResult.output?.error || storeResult.error
          || (storeResult.output == null ? `data-store returned no output (likely adapter.js missing for ${task.skill}). Check scripts/${task.skill}/adapter.js exists.` : 'unknown');
        // data-store 失败（含 adapter 缺失、返回空数组、output 为 null）→ 抛错触发 recovery
        throw new Error(`data-store failed: ${storeError}`);
      } else {
        const savedCount = storeResult.output?.savedCount ?? 0;
        const roomSavedCount = storeResult.output?.roomSavedCount ?? 0;
        const totalRecords = storeResult.output?.totalRecords ?? 0;

        if (savedCount === 0 && roomSavedCount === 0 && totalRecords > 0) {
          // adapter 解析出了 records 但全部被过滤掉（price 和 availableRooms 都为 null）
          // 说明 adapter 映射路径可能过期了
          throw new Error(
            `Adapter field mapping may be stale: ${totalRecords} records parsed but 0 had valid price/room data. ` +
            `Check if adapter.js field paths still match the API response structure.`
          );
        }

        this.log('info', `data-store succeeded for ${task.skill}`, { output: storeResult.output });

        // 3. 房型名称映射
        try {
          // platform 从 adapter 返回值获取，但 data-store 的 stdout 可能被 console.log 污染
          // 导致 storeResult.output 不是 JSON 对象。兜底：从 skill 名推断 platform
          let platform = (typeof storeResult.output === 'object' && storeResult.output?.platform) || null;
          if (!platform) {
            // skill 名格式：api-{platform}-{dataType}，adapter 返回的 platform 格式见下表
            const SKILL_TO_PLATFORM: Record<string, string> = {
              'api-ctrip-public-price': 'ctrip-public',
              'api-trip-public-price': 'trip-public',
              'api-ctrip-backend-price': 'ctrip-backend',
              'api-meituan-backend-price': 'meituan-backend',
              'api-meituan-realtime-status': 'meituan-pms',
              'api-booking-public-price': 'booking-public',
              'api-booking-backend-price': 'booking-backend',
            };
            platform = SKILL_TO_PLATFORM[task.skill] || null;
          }

          // 房型映射已改为用户手动配置，不再自动调用 LLM 匹配
        } catch (e: any) {
          this.log('warn', `Room mapping failed for ${task.skill}`, { error: e.message });
        }

        // 4. 竞品价格采集：本店成功后，遍历该平台已解析的竞品 hotelId
        try {
          await this.executeCompetitorTasks(task);
        } catch (e: any) {
          this.log('warn', `Competitor tasks failed for ${task.skill}`, { error: e.message });
        }
      }

      const endTime = Date.now();
      task.lastExecutedAt = startTime;

      await this.saveExecutionLog({
        taskId: task.id, skill: task.skill, startTime, endTime,
        duration: endTime - startTime, success: true
      });

    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.log('warn', `Direct API failed: ${task.id}`, { error: errMsg });

      // 3. 确定性预修复：代码层面检测并修复已知 pattern（日期硬编码、isRSC 等）
      const autoFixed = await this.autoFixScript(task);
      if (autoFixed) {
        this.log('info', `autoFixScript succeeded for ${task.id}, skipping Agent recovery`);
        // autoFix 成功也要采集竞品
        try { await this.executeCompetitorTasks(task); } catch (e: any) {
          this.log('warn', `Competitor tasks failed after autoFix: ${task.id}`, { error: e.message });
        }
        return;
      }

      // 4. 预修复失败 → Agent 闭环修复
      this.log('info', `autoFixScript failed or no fix applied, starting Agent recovery for ${task.id}`);
      const recovered = await this.executeAgentRecovery(task, errMsg);

      // Recovery 成功后也要采集竞品
      if (recovered) {
        try { await this.executeCompetitorTasks(task); } catch (e: any) {
          this.log('warn', `Competitor tasks failed after recovery: ${task.id}`, { error: e.message });
        }
      }

    } finally {
      this.executingTasks.delete(task.id);
      this.pushTaskStatus(task.id, 'done');
    }
  }

  /**
   * Agent 闭环修复：API 失效后，Agent 判断原因 → 重新拦截 → 生成新脚本 → 重新执行
   * 返回 true 表示修复成功（有有效数据），false 表示修复失败。
   */
  private async executeAgentRecovery(task: HeartbeatTask, errorMsg: string): Promise<boolean> {
    // 并发限制：等待 recovery 槽位
    while (this.activeRecoveryCount >= MAX_CONCURRENT_RECOVERY) {
      this.log('info', `Recovery waiting for slot (${this.activeRecoveryCount}/${MAX_CONCURRENT_RECOVERY})`, { taskId: task.id });
      await new Promise(r => setTimeout(r, 5000));
    }
    this.activeRecoveryCount++;
    this.log('info', `Recovery slot acquired (${this.activeRecoveryCount}/${MAX_CONCURRENT_RECOVERY})`, { taskId: task.id });

    const startTime = Date.now();
    const sessionId = `recovery-${task.id}-${Date.now()}`;

    // 清理当前 session 的残留 bg tab
    try {
      const cleanupFile = path.join(os.tmpdir(), `hotel-ai-browser-ipc-recovery-cleanup-${sessionId}.json`);
      fs.writeFileSync(cleanupFile, JSON.stringify({
        action: 'destroy_bg_tabs_by_session',
        sessionId: `recovery-${task.id}`,
        requestId: `recovery-cleanup-${sessionId}`,
        timestamp: Date.now()
      }));
    } catch {}

    try {
      // 代码判断策略：根据错误类型决定走策略A（爬虫重建）还是策略B（本地修复）
      const needsCrawler = errorMsg.includes('Skill not found')
        || errorMsg.includes('Script not found')
        || errorMsg.includes('Cannot find module')
        || /HTTP\s*(403|401|404)/i.test(errorMsg);

      const initialStrategy: 'a' | 'b' = needsCrawler ? 'a' : 'b';
      this.log('info', `Recovery strategy: ${initialStrategy}`, { taskId: task.id, needsCrawler });

      // 第一轮：执行初始策略
      const result1 = await this.runRecoveryAgent(task, errorMsg, initialStrategy, sessionId);

      // 强制合规：去掉 Agent 可能写入的硬编码酒店标识默认值
      this.sanitizeHardcodedIds(task.skill);

      // 验证数据
      let verified = this.verifyRecoveryData(task.skill, startTime);

      // 策略B失败 → 升级到策略A（爬虫重建）
      if (!verified && initialStrategy === 'b') {
        this.log('info', `Strategy B failed, escalating to Strategy A (crawler)`, { taskId: task.id });
        const previousAttempt = result1.error
          ? `策略B修复失败：${result1.error}`
          : '策略B修复完成但数据验证未通过，可能需要重新拦截 API。';

        await this.runRecoveryAgent(task, errorMsg, 'a', sessionId, previousAttempt);
        this.sanitizeHardcodedIds(task.skill);
        verified = this.verifyRecoveryData(task.skill, startTime);
      }

      this.log('info', `Agent recovery done: ${task.id}, dataVerified=${verified}`);

      // 从脚本提取平台 ID 存库（必须在 sanitize 之前，因为 sanitize 会删掉硬编码值）
      await this.extractAndSavePlatformIds(task);
      // 清理脚本中的硬编码默认值
      this.sanitizeHardcodedIds(task.skill);

      await this.saveExecutionLog({
        taskId: task.id, skill: task.skill, startTime, endTime: Date.now(),
        duration: Date.now() - startTime,
        success: verified,
        error: verified ? undefined : 'Recovery completed but no valid data produced'
      });

      return verified;
    } catch (fatalError) {
      const errMsg = fatalError instanceof Error ? fatalError.message : String(fatalError);
      this.log('error', `Agent recovery fatal: ${task.id}`, { error: errMsg });

      await this.saveExecutionLog({
        taskId: task.id, skill: task.skill, startTime, endTime: Date.now(),
        duration: Date.now() - startTime, success: false, error: errMsg
      });

      return false;
    } finally {
      this.activeRecoveryCount = Math.max(0, this.activeRecoveryCount - 1);

      // 清理 bgTab
      try {
        const ipcFile = path.join(os.tmpdir(), `hotel-ai-browser-ipc-cleanup-${sessionId}.json`);
        fs.writeFileSync(ipcFile, JSON.stringify({
          action: 'destroy_bg_tabs_by_session',
          sessionId,
          requestId: `cleanup-${sessionId}`,
          timestamp: Date.now()
        }));
      } catch {}

      try {
        const tmpDir = os.tmpdir();
        const residualFiles = fs.readdirSync(tmpDir).filter(f =>
          f.startsWith('hotel-ai-browser-tab-switched') ||
          f.startsWith('hotel-ai-browser-new-tab')
        );
        for (const f of residualFiles) {
          try { fs.unlinkSync(path.join(tmpDir, f)); } catch {}
        }
      } catch {}
    }
  }

  /**
   * 创建并运行一个 recovery 子Agent
   * 返回 { error?: string } 供调用方判断是否需要升级策略
   */
  private async runRecoveryAgent(
    task: HeartbeatTask,
    errorMsg: string,
    strategy: 'a' | 'b',
    sessionId: string,
    previousAttempt?: string
  ): Promise<{ error?: string }> {
    let agent: PiAgentManager | null = null;
    try {
      const today = new Date().toISOString().split('T')[0];
      const recoverySystemPrompt = `你是一个自动化 API 脚本修复器。你的唯一任务是诊断并修复失败的 API 脚本，确保数据正常获取并入库。\n\n## 当前日期\n今天是 ${today}。`;

      const recoveryConfig = {
        ...this.piAgentConfig,
        model: getRecoveryModel(),
        maxTokens: Math.max(this.piAgentConfig.maxTokens, 16384),
        systemPrompt: recoverySystemPrompt,
      };
      agent = new PiAgentManager(recoveryConfig, this.logger || undefined);
      await agent.initialize();
      agent.setSkillManager(this.skillManager);
      agent.clearHistory();
      (agent as any).recoveryMode = true;

      // 策略A需要爬虫，策略B不需要
      // 注意：不给 file-operations 写权限，防止 Agent 乱改脚本
      const allowList = [
        ...(strategy === 'a' ? ['ai-web-crawler'] : []),
        'data-store',
        task.skill,
      ];
      agent.setSkillAllowList(allowList);

      const startUrl = (task.params as any)?.startUrl || PLATFORM_START_URL[task.platform] || '';

      agent.setDefaultSkillParams({
        background: true,
        sessionId,
        ...(startUrl ? { start_url: startUrl } : {}),
      });

      this.log('info', `Running recovery agent (strategy ${strategy})`, { taskId: task.id, sessionId });

      const prompt = await this.buildRecoveryPrompt(task, errorMsg, strategy, previousAttempt);

      try {
        await Promise.race([
          agent.sendMessage(prompt),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Recovery timeout after ${TASK_TIMEOUT_MS / 1000}s`)), TASK_TIMEOUT_MS)
          )
        ]);
        return {};
      } catch (recoveryError) {
        const err = recoveryError instanceof Error ? recoveryError.message : String(recoveryError);
        this.log('warn', `Recovery agent (strategy ${strategy}) threw: ${err} — will still verify data`);
        return { error: err };
      }
    } finally {
      if (agent) agent.destroy();
    }
  }

  /**
   * 竞品价格采集：本店任务成功后，遍历该平台已解析的竞品 hotelId，
   * 用同一个 skill 逐个采集竞品价格并入库。
   * 竞品失败只打日志，不触发 Recovery（避免错误 hotelId 导致无效修复）。
   */
  private async executeCompetitorTasks(task: HeartbeatTask): Promise<void> {
    const diagPath = path.join(getDataDir(), 'competitor-task-diag.json');
    const diag: any = { timestamp: new Date().toISOString(), taskSkill: task.skill, taskPlatform: task.platform, steps: [] };

    const writeDiag = () => { try { fs.writeFileSync(diagPath, JSON.stringify(diag, null, 2)); } catch {} };

    // 只有公网价格类 skill 才展开竞品（后台只能查自己酒店，房态等不需要）
    if (!task.skill.includes('price') || task.skill.includes('backend')) {
      diag.steps.push('SKIP: not a public price skill');
      writeDiag();
      return;
    }

    // 平台映射：task.platform → competitor_platform_ids 里的 platform 值
    // ctrip 和 trip 共享 hotelId，所以 trip 任务也查 ctrip 的竞品
    const platformKey = task.platform === 'trip' ? 'ctrip' : task.platform;
    diag.platformKey = platformKey;

    let competitors: Array<{ competitorId: number; competitorName: string; platformHotelId: string }>;
    try {
      competitors = await databaseManager.getCompetitorPlatformIds(platformKey);
      diag.steps.push(`queried competitors: ${competitors.length} found`);
      diag.competitors = competitors;
    } catch (e: any) {
      diag.steps.push(`query error: ${e.message}`);
      writeDiag();
      this.log('warn', `Failed to query competitor platform IDs for ${platformKey}`, { error: e.message });
      return;
    }

    if (competitors.length === 0) {
      diag.steps.push('SKIP: no competitors with resolved hotelId');
      writeDiag();
      this.log('info', `No competitors with resolved hotelId for platform ${platformKey}`);
      return;
    }

    this.log('info', `Expanding ${competitors.length} competitor tasks for ${task.skill}`, {
      competitors: competitors.map(c => ({ id: c.competitorId, name: c.competitorName, hotelId: c.platformHotelId }))
    });

    for (const comp of competitors) {
      try {
        // 用同一个 skill，传入竞品的平台标识
        const compParams: Record<string, any> = { ...(task.params || {}) };
        if (task.platform === 'booking') {
          compParams.hotelSlug = comp.platformHotelId;
        } else {
          compParams.hotelId = parseInt(comp.platformHotelId) || comp.platformHotelId;
        }
        const apiResult = await Promise.race([
          this.skillManager.executeSkill(task.skill, compParams),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Competitor API timeout')), TASK_TIMEOUT_MS)
          )
        ]);

        if (!apiResult.success || apiResult.output?.success === false) {
          this.log('warn', `Competitor API failed: ${comp.competitorName}`, {
            hotelId: comp.platformHotelId, error: apiResult.output?.error || apiResult.error
          });
          continue;
        }

        if (this.isEmptyAPIResponse(apiResult.output)) {
          this.log('warn', `Competitor API returned empty data: ${comp.competitorName}`, { hotelId: comp.platformHotelId });
          continue;
        }

        // 入库：hotelId 传 competitorId（competitors 表的 id），用于区分本店和竞品
        const storeResult = await this.skillManager.executeSkill('data-store', {
          source: task.skill,
          hotelId: comp.competitorId
        });

        if (storeResult.success && storeResult.output?.success !== false) {
          this.log('info', `Competitor data stored: ${comp.competitorName}`, {
            hotelId: comp.platformHotelId,
            savedCount: storeResult.output?.savedCount,
            roomSavedCount: storeResult.output?.roomSavedCount
          });
        } else {
          this.log('warn', `Competitor data-store failed: ${comp.competitorName}`, {
            error: storeResult.output?.error || storeResult.error
          });
        }
      } catch (e: any) {
        // 单个竞品失败不影响其他竞品
        this.log('warn', `Competitor task error: ${comp.competitorName}`, {
          hotelId: comp.platformHotelId, error: e.message
        });
      }
    }
  }

  /**
   * 房型名称映射：data-store 入库后，检查并匹配跨平台房型名
   */
  private async resolveRoomMappings(skill: string, platform?: string): Promise<void> {
    if (!platform) return;

    this.log('info', `[RoomMapping] Starting for platform=${platform}, skill=${skill}`);

    // 查询该平台未映射的房型名
    const unmapped = await databaseManager.getUnmappedRoomNames(platform);
    this.log('info', `[RoomMapping] Unmapped names: ${unmapped.length}`, { unmapped });
    if (unmapped.length === 0) {
      return;
    }

    // 获取用户定义的标准房型名（来自"标准房型管理"配置）
    const canonicalNames = await databaseManager.getCanonicalRoomTypes();
    this.log('info', `[RoomMapping] Canonical room types: ${canonicalNames.length}`, { canonicalNames });

    if (canonicalNames.length === 0) {
      this.log('info', `[RoomMapping] No canonical room types configured, skipping`);
      return;
    }

    // 轻量级 LLM 调用：直接 HTTP 请求，不创建 Agent 实例
    try {
      const llmConfig = loadLLMConfig();

      const prompt = `你是酒店房型名称匹配专家。以下是同一家酒店在不同OTA平台的房型名称。
请将"待匹配名称"与"已知标准名称"进行一一对应。

规则：
- 忽略附加描述（如"不含早"、"公共卫浴"、"入住当天18:00前免费取消"等政策/设施信息），只匹配核心房型名
- 例如"小叮经济房-不含早-入住当天18:00前免费取消-男 二人间 公共卫浴 充电无忧"的核心房型是"男生双人间"或类似名称
- 如果某个名称确实无法匹配任何标准名，canonical_name 设为该名称自身

已知标准名称（来自PMS系统）：
${canonicalNames.join('\n')}

待匹配名称（来自 ${platform} 平台）：
${unmapped.join('\n')}

以纯 JSON 数组格式输出，不要其他文字：
[{"platform_name": "平台原始名（完整名，一个字都不要改）", "canonical_name": "对应标准名"}]`;

      const requestBody = JSON.stringify({
        model: llmConfig.model,
        messages: [
          { role: 'system', content: '你是一个房型名称匹配工具。只输出 JSON，不输出其他文字。' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.1,
        max_tokens: 2048,
      });

      const { net } = require('electron');

      // 带 fallback 的 LLM 调用
      const doFetch = async (cfg: { baseURL: string; apiKey: string; model: string }) => {
        const body = JSON.stringify({
          ...JSON.parse(requestBody),
          model: cfg.model,
        });
        return net.fetch(`${cfg.baseURL}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${cfg.apiKey}`,
          },
          body,
        });
      };

      let response;
      try {
        response = await doFetch(llmConfig);
        if (!response.ok) {
          const errText = await response.text();
          const err: any = new Error(`LLM API returned ${response.status}: ${errText}`);
          err.status = response.status;
          throw err;
        }
      } catch (fetchErr: any) {
        // 主 provider 失败，尝试 fallback
        if (isProviderUnavailableError(fetchErr) && !isUsingFallback()) {
          switchToFallback();
          const fbConfig = loadLLMConfig();
          this.log('info', `[RoomMapping] Primary provider failed, switching to fallback: ${fbConfig.baseURL}`);
          response = await doFetch(fbConfig);
          if (!response.ok) {
            throw new Error(`Fallback LLM API returned ${response.status}: ${await response.text()}`);
          }
        } else {
          throw fetchErr;
        }
      }

      const result = await response.json() as any;
      const content = result.choices?.[0]?.message?.content || '';

      this.log('info', `[RoomMapping] LLM response length: ${content.length}`, { contentPreview: content.substring(0, 300) });

      // 解析 LLM 返回的 JSON
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        this.log('warn', 'Room mapping LLM returned no valid JSON', { content: content.substring(0, 200) });
        return;
      }

      const mappings: Array<{ platform_name: string; canonical_name: string }> = JSON.parse(jsonMatch[0]);
      let saved = 0;
      for (const m of mappings) {
        if (m.platform_name && m.canonical_name) {
          await databaseManager.upsertRoomTypeMapping(m.canonical_name, platform, m.platform_name);
          saved++;
        }
      }

      this.log('info', `Room mapping: saved ${saved} mappings for ${platform} (lightweight LLM call)`);
    } catch (e: any) {
      this.log('warn', `LLM room mapping failed for ${platform}`, { error: e.message });
    }
  }

  /**
   * 保存执行日志（JSONL 格式）
   */
  private async saveExecutionLog(log: TaskExecutionLog): Promise<void> {
    try {
      const logDir = path.join(path.dirname(this.configPath), '.history');
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }

      const date = new Date(log.startTime).toISOString().split('T')[0];
      const logFile = path.join(logDir, `${date}.jsonl`);
      fs.appendFileSync(logFile, JSON.stringify(log) + '\n');
    } catch (error) {
      this.log('error', 'Failed to save execution log', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  // ─── Public API ───

  getTasks(): HeartbeatTask[] {
    return Array.from(this.tasks.values());
  }

  getTaskCount(): number {
    return this.tasks.size;
  }

  isActive(): boolean {
    return this.isRunning;
  }

  /**
   * 注入主窗口引用，用于推送任务执行状态到前端
   */
  setMainWindow(win: BrowserWindow): void {
    this.mainWindow = win;
    if (this.loginAlertService) this.loginAlertService.setMainWindow(win);
  }

  /**
   * 设置登录提醒服务
   */
  setLoginAlertService(service: any): void {
    this.loginAlertService = service;
    if (service) service.setMainWindow(this.mainWindow);
  }

  /** cookieDomain → login-check 所需的 URL 映射 */
  private static LOGIN_CHECK_URLS: Record<string, string> = {
    'ebooking.ctrip.com': 'https://ebooking.ctrip.com/home/mainland?microJump=true',
    'me.meituan.com': 'https://me.meituan.com/ebooking/merchant/ebIframe?iUrl=%2Febooking%2Fnew-workbench%2Findex.html%23%2F',
    'admin.booking.com': 'https://admin.booking.com/hotel/hoteladmin/extranet_ng/manage/start.html?hotel_id=15994510&lang=zh',
    'ebooking.trip.com': 'https://ebooking.trip.com/home/mainland?microJump=true',
    'hotels.ctrip.com': 'https://hotels.ctrip.com/hotels/detail/?hotelId=129175148',
  };

  /**
   * 检测任务对应平台的登录状态
   * @returns true = 已登录可执行，false = 未登录已弹窗
   */
  private async checkLoginForTask(task: HeartbeatTask): Promise<boolean> {
    const cookieDomain = (task.params as any)?.cookieDomain;
    if (!cookieDomain) return true;

    // Trip / 携程公网：用 API 返回值判断登录状态
    if (cookieDomain === 'trip.com' || cookieDomain === 'www.trip.com' || cookieDomain === 'hotels.ctrip.com') {
      const result = await this.checkOtaPublicLogin(cookieDomain);
      if (!result.loggedIn) {
        this.log('warn', `${result.platform} login check failed: ${result.reason}`);
        if (this.loginAlertService) this.loginAlertService.alertByDomains([cookieDomain]);
      }
      return result.loggedIn;
    }

    // 其他平台：用 login-check skill（bgTab + LoginDetector）
    let checkUrl = HeartbeatManager.LOGIN_CHECK_URLS[cookieDomain];

    // 如果静态映射里没有（如自定义 PMS），从任务参数的 startUrl 获取
    if (!checkUrl) {
      checkUrl = (task.params as any)?.startUrl;
    }

    // 还没有就尝试从数据库读 PMS URL
    if (!checkUrl) {
      try {
        const hotelConfig = await databaseManager.getHotelConfig();
        if (hotelConfig?.pms_url) {
          const pmsDomain = new URL(hotelConfig.pms_url).hostname;
          if (pmsDomain === cookieDomain) checkUrl = hotelConfig.pms_url;
        }
      } catch (_) {}
    }

    if (!checkUrl) {
      // PMS 任务（cookieDomain 含 pms）没有配置 PMS URL → 提醒并跳过
      if (cookieDomain.includes('pms') || task.skill.includes('status')) {
        this.log('warn', `Skipping task ${task.id}: PMS URL not configured`);
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send('login:status-alert', { platforms: ['PMS系统未配置，请在管理后台设置PMS地址'] });
        }
        return false;
      }
      return true; // 非 PMS 任务，没有检测 URL 就跳过检测
    }

    try {
      const result = await this.skillManager.executeSkill('login-check', {
        domain: cookieDomain,
        url: checkUrl,
        name: cookieDomain,
        cookieDomain,
      });
      // skill 执行失败（CDP 超时等）→ 视为未登录，跳过任务并提醒
      if (!result.success) {
        this.log('warn', `Login check skill failed for ${cookieDomain}: ${result.error || 'unknown'}`);
        if (this.loginAlertService) this.loginAlertService.alertByDomains([cookieDomain]);
        return false;
      }
      if (result.output && !result.output.isLoggedIn) {
        this.log('warn', `Login check failed for ${cookieDomain}`);
        if (this.loginAlertService) this.loginAlertService.alertByDomains([cookieDomain]);
        return false;
      }
      return true;
    } catch (err) {
      // CDP 超时等异常 → 视为未登录，跳过任务并提醒
      this.log('warn', `Login check exception for ${cookieDomain}: ${err}`);
      if (this.loginAlertService) this.loginAlertService.alertByDomains([cookieDomain]);
      return false;
    }
  }


  /**
   * 获取当前正在执行的任务 ID 列表
   */
  getExecutingTaskIds(): string[] {
    return Array.from(this.executingTasks);
  }

  /**
   * OTA 公网登录状态检测（Trip / 携程共用）
   * 通过调用公网 API 的返回值判断是否登录。
   * 供 heartbeat checkLoginForTask 和 ipc-handler LOGIN_CHECK_RUN 共同调用。
   */
  async checkOtaPublicLogin(cookieDomain: string): Promise<{ loggedIn: boolean; platform: string; reason?: string }> {
    const isTrip = cookieDomain === 'trip.com' || cookieDomain === 'www.trip.com';
    const platform = isTrip ? 'Trip.com' : '携程公网';

    try {
      const cfg = await databaseManager.getHotelConfig();
      const hotelId = isTrip ? cfg?.trip_hotel_id : cfg?.ctrip_hotel_id;
      if (!hotelId) {
        return { loggedIn: true, platform, reason: 'no hotelId configured, skipping' };
      }

      const skill = isTrip ? 'api-trip-public-price' : 'api-ctrip-public-price';
      const domain = isTrip ? 'trip.com' : 'hotels.ctrip.com';
      const result = await this.skillManager.executeSkill(skill, { cookieDomain: domain, hotelId });
      const data = result.output?.data || result.output;

      // 携程有 isLogin 字段，优先使用
      if (data?.data?.isLogin === true || data?.isLogin === true) {
        return { loggedIn: true, platform };
      }

      // 检查错误码（风控/未登录）
      const hasError = data?.data?.htlSpiderActionErrorCode || data?.htlSpiderActionErrorCode;
      if (hasError) {
        return { loggedIn: false, platform, reason: 'htlSpiderActionErrorCode detected' };
      }

      // 无错误码 → 视为已登录（roomList 为空可能只是售罄）
      return { loggedIn: true, platform };
    } catch (_) {
      return { loggedIn: true, platform, reason: 'exception, assuming logged in' };
    }
  }

  /**
   * 向前端推送任务执行状态变更
   */
  private pushTaskStatus(taskId: string, status: 'running' | 'done' | 'error'): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(IPC_CHANNELS.HEARTBEAT_TASK_STATUS, { taskId, status });
    }
  }

  /**
   * 按 platform 字段将任务分组，过滤掉 disabled 的任务。
   * 无 platform 字段的旧格式任务以 task.id 作为独立平台组（向后兼容）。
   */
  groupTasksByPlatform(tasks: HeartbeatTask[]): PlatformGroup[] {
    const groups = new Map<string, HeartbeatTask[]>();
    for (const task of tasks) {
      if (!task.enabled) continue;
      const platform = task.platform || task.id;
      const list = groups.get(platform) || [];
      list.push(task);
      groups.set(platform, list);
    }
    return Array.from(groups.entries()).map(([platform, tasks]) => ({ platform, tasks }));
  }

  /**
   * 并发执行一轮所有平台组。
   *
   * 1. 读取 schedule.json 获取所有任务
   * 2. 调用 groupTasksByPlatform 分组
   * 3. 使用 Promise.allSettled 并发执行所有平台组
   * 4. 收集各平台组执行结果到 Map
   * 5. 返回 ConcurrentRoundResult
   */
  async executeConcurrentRound(): Promise<ConcurrentRoundResult> {
    const roundId = Date.now().toString();
    const startTime = Date.now();

    this.log('info', 'Starting concurrent round', { roundId });

    // 0. 清理所有残留的后台标签页，防止累积导致 CDP 连接超时
    try {
      const cleanupFile = path.join(os.tmpdir(), `hotel-ai-browser-ipc-round-cleanup-${roundId}.json`);
      fs.writeFileSync(cleanupFile, JSON.stringify({
        action: 'destroy_all_bg_tabs',
        requestId: `round-cleanup-${roundId}`,
        timestamp: Date.now()
      }));
      this.log('info', 'Requested cleanup of all stale bg tabs before round', { roundId });
      // Give Electron time to process
      await new Promise(r => setTimeout(r, 500));
    } catch (e) {
      this.log('warn', 'Failed to request bg tab cleanup', { error: (e as Error).message });
    }

    // 1. 读取 schedule.json 获取所有任务
    const configContent = fs.readFileSync(this.configPath, 'utf-8');
    const schedule: TaskSchedule = JSON.parse(configContent);

    // 2. 按 platform 分组
    const groups = this.groupTasksByPlatform(schedule.tasks);

    this.log('info', 'Platform groups created', {
      roundId,
      groupCount: groups.length,
      platforms: groups.map(g => g.platform),
    });

    // 3. 使用 Promise.allSettled 并发执行所有平台组
    const settledResults = await Promise.allSettled(
      groups.map(group => this.executePlatformGroup(group, roundId))
    );

    // 4. 收集各平台组执行结果到 Map
    const platformResults = new Map<string, PlatformExecutionResult>();
    for (let i = 0; i < settledResults.length; i++) {
      const settled = settledResults[i];
      const platform = groups[i].platform;

      if (settled.status === 'fulfilled') {
        platformResults.set(platform, settled.value);
      } else {
        this.log('error', `Platform group failed: ${platform}`, {
          roundId,
          error: settled.reason instanceof Error ? settled.reason.message : String(settled.reason),
        });
        platformResults.set(platform, {
          platform,
          taskResults: [],
          duration: 0,
          success: false,
        });
      }
    }

    // 5. 返回结果（不再需要 DataAggregator，data-store 已在 executeTask 中完成入库）
    const totalDuration = Date.now() - startTime;
    const allSucceeded = [...platformResults.values()].every(r => r.success);

    this.log('info', 'Concurrent round completed', {
      roundId,
      totalDuration,
      allSucceeded,
      platformCount: platformResults.size,
    });

    return {
      roundId,
      platformResults,
      totalDuration,
      allSucceeded,
    };
  }

  /**
   * 执行单个平台组内的所有任务（串行）。
   * 直接调用 api-* → data-store，失败走 Agent 修复。
   */
  async executePlatformGroup(group: PlatformGroup, roundId: string): Promise<PlatformExecutionResult> {
    this.log('info', `Executing platform group: ${group.platform}`, {
      roundId,
      taskCount: group.tasks.length,
    });

    const taskResults: TaskExecutionResult[] = [];
    const groupStartTime = Date.now();

    for (const task of group.tasks) {
      const sessionId = `${task.id}-${roundId}`;
      const taskStartTime = Date.now();
      this.pushTaskStatus(task.id, 'running');

      try {
        // 1. 直接调用 api-* 脚本
        const apiResult = await Promise.race([
          this.skillManager.executeSkill(task.skill, task.params || {}),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`API timeout`)), TASK_TIMEOUT_MS)
          )
        ]);

        if (!apiResult.success || apiResult.output?.success === false) {
          throw new Error(`API failed: ${apiResult.output?.error || apiResult.error}`);
        }

        // 检测 API 返回成功但数据实质为空
        if (this.isEmptyAPIResponse(apiResult.output)) {
          throw new Error(`API returned empty data: response structure is valid but contains no actual records`);
        }

        // 2. data-store 清洗 + 入库
        const storeResult = await this.skillManager.executeSkill('data-store', { source: task.skill });
        if (!storeResult.success || storeResult.output?.success === false) {
          this.log('warn', `data-store failed: ${task.id}`, { error: storeResult.output?.error || storeResult.error });
        }

        taskResults.push({
          taskId: task.id, sessionId, jsonFilePath: '',
          success: true, duration: Date.now() - taskStartTime,
        });

        this.log('info', `Task completed: ${task.id}`, { roundId, duration: Date.now() - taskStartTime });
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);

        // 3. 确定性预修复
        const autoFixed = await this.autoFixScript(task);
        if (autoFixed) {
          this.log('info', `autoFixScript succeeded for ${task.id} in round ${roundId}`);
          taskResults.push({
            taskId: task.id, sessionId, jsonFilePath: '',
            success: true, duration: Date.now() - taskStartTime,
          });
        } else {
          // 4. 预修复失败 → Agent 修复
          this.log('warn', `Direct API failed: ${task.id}, trying Agent recovery`, { roundId, error: errMsg });
          const recovered = await this.executeAgentRecovery(task, errMsg);

          taskResults.push({
            taskId: task.id, sessionId, jsonFilePath: '',
            success: recovered, duration: Date.now() - taskStartTime, error: recovered ? undefined : errMsg,
          });
        }
      } finally {
        this.pushTaskStatus(task.id, 'done');
      }
    }

    return {
      platform: group.platform,
      taskResults,
      duration: Date.now() - groupStartTime,
      success: taskResults.every(r => r.success),
    };
  }

  /**
   * 构建 Agent 修复 prompt：根据策略类型加载不同的 prompt 文件
   * strategy: 'a' = 爬虫重建, 'b' = 本地修复
   * previousAttempt: 策略B失败后升级到策略A时，传入策略B的诊断摘要
   */
  private async buildRecoveryPrompt(
    task: HeartbeatTask,
    errorMsg: string,
    strategy: 'a' | 'b',
    previousAttempt?: string
  ): Promise<string> {
    // 从数据库获取酒店名称和平台 hotelId
    let hotelName = '（未配置酒店名）';
    let hotelIdInfo = '';
    try {
      const config = await databaseManager.getHotelConfig();
      if (config?.hotel_name) hotelName = config.hotel_name;
      // 收集本店各平台 hotelId，供 Agent 写脚本时设置默认值
      const ids: string[] = [];
      if (config?.ctrip_hotel_id) ids.push(`携程/Trip.com hotelId: ${config.ctrip_hotel_id}`);
      if (config?.meituan_hotel_id) ids.push(`美团 hotelId: ${config.meituan_hotel_id}`);
      if (config?.booking_hotel_id) ids.push(`Booking hotelId: ${config.booking_hotel_id}`);
      if (config?.meituan_poi_id) ids.push(`美团后台 poiId: ${config.meituan_poi_id}`);
      if (config?.meituan_partner_id) ids.push(`美团后台 partnerId: ${config.meituan_partner_id}`);
      if (ids.length > 0) {
        hotelIdInfo = `\n## 本店平台 ID（脚本必须从 params 读取，禁止写死默认值）\n${ids.join('\n')}\n` +
          `\n**重要：所有酒店标识（hotelId、hotelSlug、poiId、partnerId）必须通过 params 传入，不允许在脚本中硬编码默认值。** 如果 params 中没有传入，脚本应返回 MISSING_PARAM 错误。\n`;
      }
    } catch {}

    // 生成数据样本（adapter 相关错误时注入完整数据结构，帮助 Agent 写出准确的 adapter）
    let dataSample = '';
    try {
      const extractorPath = path.resolve(this.resourcesBasePath, 'scripts', 'data-store', 'sample-extractor.js');
      if (fs.existsSync(extractorPath)) {
        // webpack 打包后 require() 动态路径不工作，用 vm 模块执行
        const vm = require('vm');
        const extractorCode = fs.readFileSync(extractorPath, 'utf-8');
        const extractorModule = { exports: {} as any };
        const wrapper = vm.runInNewContext(
          `(function(module, exports, require) { ${extractorCode} })`,
          { console, JSON, Object, Array, String, Number, parseInt, parseFloat, Math, Date, RegExp, Error, Map, Set, Buffer, process }
        );
        // 提供一个能解析 'fs' 等内置模块的 require
        const builtinModules: Record<string, any> = { fs, path, os };
        const safeRequire = (id: string) => builtinModules[id] || require(id);
        wrapper(extractorModule, extractorModule.exports, safeRequire);
        const { extractDataSample } = extractorModule.exports;
        // 找最新的数据文件
        const apiResultsDir = path.join(getDataDir(), 'api-results');
        if (fs.existsSync(apiResultsDir)) {
          const files = fs.readdirSync(apiResultsDir)
            .filter((f: string) => f.startsWith(task.skill + '-') && f.endsWith('.json'))
            .sort().reverse();
          if (files.length > 0) {
            const raw = JSON.parse(fs.readFileSync(path.join(apiResultsDir, files[0]), 'utf-8'));
            // 健康检查：最新样本是否为失败响应（错误壳）
            // 避免 Agent 参考失败响应写出"假设成功结构"的 adapter
            const sampleIssue = this.detectFailedSample(raw);
            if (sampleIssue) {
              dataSample = `\n## 最新 API 响应数据样本\n` +
                `⚠️ 最新一次响应是**失败响应**：${sampleIssue}\n` +
                `无有效数据结构可参考。处理建议：\n` +
                `- 策略A（爬虫重建）：基于爬虫拦截到的新 apiCandidate 重写 index.js 和 adapter.js\n` +
                `- 策略B（本地修复）：禁止基于此错误样本编写 adapter；改为参考末尾"脚本参考示例"中对应平台的 adapter 模板作为起点，或查看 data/api-results/ 下更早的成功样本\n`;
            } else if (raw.success && raw.data) {
              const { sample, stats } = extractDataSample(raw.data);
              dataSample = `\n## 最新 API 响应数据样本（用于编写/修复 adapter）\n` +
                `原始数据 ${stats.originalSizeKB}KB，以下是精简样本（${stats.sampleSizeKB}KB），保留了完整的数据结构和真实值。\n` +
                `数组/Map 只展示 1-2 个完整样本，其余用 _arrayTotal/_mapMeta 标注总数。\n` +
                `标记 _trimmed 的对象中，非业务字段只保留类型摘要，业务字段（price/name/room/meal/date 等）保留完整值。\n` +
                '```json\n' + JSON.stringify(sample, null, 2) + '\n```\n' +
                `\n**重要：adapter.js 必须基于上述真实数据结构编写，不要猜测字段路径。**\n`;
            }
          }
        }
      }
    } catch (e) {
      this.log('warn', 'Failed to generate data sample for recovery prompt', {
        error: e instanceof Error ? e.message : String(e)
      });
    }

    // 从外部文件加载 Recovery prompt：base + 策略文件
    try {
      const agentDir = path.resolve(this.resourcesBasePath, 'agent');
      const basePath = path.join(agentDir, 'prompts', 'recovery-base.md');
      const strategyFile = strategy === 'a' ? 'recovery-strategy-a.md' : 'recovery-strategy-b.md';
      const strategyPath = path.join(agentDir, 'prompts', strategyFile);

      if (fs.existsSync(basePath) && fs.existsSync(strategyPath)) {
        const baseTemplate = fs.readFileSync(basePath, 'utf-8');
        const strategyTemplate = fs.readFileSync(strategyPath, 'utf-8');

        // 加载脚本参考示例（按平台过滤，只注入相关示例，节省 token）
        let scriptExamples = '';
        try {
          const examplesPath = path.join(agentDir, 'prompts', 'script-examples.md');
          if (fs.existsSync(examplesPath)) {
            const fullExamples = fs.readFileSync(examplesPath, 'utf-8');
            const platformKeywords: Record<string, string[]> = {
              'ctrip': ['示例1：携程公网', '示例5：携程 ebooking'],
              'trip': ['示例2：Trip.com'],
              'meituan': ['示例3：美团后台房价', '示例4：美团 PMS'],
              'booking': ['示例6：Booking 公网房价', '示例7：Booking 后台房价'],
            };
            const keywords = platformKeywords[task.platform] || [];
            const sections: string[] = [];
            for (const kw of keywords) {
              const startIdx = fullExamples.indexOf(`## ${kw}`);
              if (startIdx === -1) continue;
              const nextSection = fullExamples.indexOf('\n## 示例', startIdx + 10);
              const endIdx = nextSection === -1 ? fullExamples.indexOf('\n## 通用规则', startIdx) : nextSection;
              sections.push(fullExamples.substring(startIdx, endIdx === -1 ? undefined : endIdx).trim());
            }
            const rulesIdx = fullExamples.indexOf('## 通用规则');
            if (rulesIdx !== -1) sections.push(fullExamples.substring(rulesIdx).trim());

            if (sections.length > 0) {
              const examplesContent = sections.join('\n\n---\n\n');
              scriptExamples = '\n## 脚本参考示例（经过验证，必须参照编写）\n\n' + examplesContent + '\n';
            }
          }
        } catch {}

        // 拼接 base + strategy，统一做变量替换
        const combined = baseTemplate + '\n\n' + strategyTemplate;
        const rendered = combined
          .replace(/\{\{skill\}\}/g, task.skill)
          .replace(/\{\{hotelName\}\}/g, hotelName)
          .replace(/\{\{errorMsg\}\}/g, errorMsg)
          .replace(/\{\{params\}\}/g, JSON.stringify(task.params || {}, null, 2))
          .replace(/\{\{dataSample\}\}/g, dataSample)
          .replace(/\{\{hotelIdInfo\}\}/g, hotelIdInfo)
          .replace(/\{\{startUrl\}\}/g, (task.params as any)?.startUrl || PLATFORM_START_URL[task.platform] || '（未配置）')
          .replace(/\{\{scriptExamples\}\}/g, scriptExamples)
          .replace(/\{\{previousAttempt\}\}/g, previousAttempt
            ? `\n## 上一轮修复尝试（策略B）的诊断结果\n${previousAttempt}\n`
            : '');

        return rendered + '\n\n请立即开始修复。';
      }
    } catch (e) {
      this.log('warn', 'Failed to load recovery prompt templates, using inline fallback', {
        error: e instanceof Error ? e.message : String(e)
      });
    }

    // 内联兜底
    return `你是一个自动化任务修复器。API 脚本 "${task.skill}" 执行失败。
错误信息: ${errorMsg}
酒店: ${hotelName}
${dataSample}
请读取 scripts/${task.skill}/index.js 诊断问题并修复，修复后执行验证并调用 data-store 入库。
任务参数: ${JSON.stringify(task.params || {}, null, 2)}`;
  }

  /**
   * 手动触发任务执行
   */
  async executeTaskManually(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    this.enqueueTask(task);
  }

  /**
   * 更新任务属性（enabled / cron / scheduleType / scheduleConfig 等）并持久化到 schedule.json
   */
  updateTask(taskId: string, updates: Partial<HeartbeatTask>): void {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);

    // 1. 如果更新了 cron，先验证表达式有效性
    if (updates.cron !== undefined && updates.cron !== task.cron) {
      try {
        // 尝试创建 CronJob 验证 cron 表达式，立即停止（仅用于验证）
        const testJob = new CronJob(updates.cron, () => {}, null, false);
        testJob.stop();
      } catch (error) {
        throw new Error(`Invalid cron expression "${updates.cron}": ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // 2. 应用 scheduleType / scheduleConfig
    if (updates.scheduleType !== undefined) {
      task.scheduleType = updates.scheduleType;
    }
    if (updates.scheduleConfig !== undefined) {
      task.scheduleConfig = updates.scheduleConfig;
    }

    // 3. 应用 cron 变更 + 重建 CronJob
    if (updates.cron !== undefined && updates.cron !== task.cron) {
      const oldCron = task.cron;
      task.cron = updates.cron;

      if (task.enabled) {
        // 停止旧 CronJob
        if (this.cronJobs.has(taskId)) {
          this.cronJobs.get(taskId)!.stop();
          this.cronJobs.delete(taskId);
        }
        // 创建新 CronJob
        this.scheduleCronJob(task);
        this.log('info', `CronJob rebuilt for task: ${taskId}`, { oldCron, newCron: updates.cron });
      }
    }

    // 4. 应用 enabled 变更
    if (updates.enabled !== undefined) {
      task.enabled = updates.enabled;

      if (task.enabled && !this.cronJobs.has(taskId)) {
        this.scheduleCronJob(task);
      } else if (!task.enabled && this.cronJobs.has(taskId)) {
        this.cronJobs.get(taskId)!.stop();
        this.cronJobs.delete(taskId);
        this.log('info', `Stopped cron job: ${taskId}`);
      }
    }

    // 5. 持久化
    this.saveConfig();
    this.log('info', `Task updated: ${taskId}`, { updates });
  }

  /**
   * 将当前任务列表写回 schedule.json
   */
  private saveConfig(): void {
    try {
      const schedule: TaskSchedule = {
        tasks: Array.from(this.tasks.values())
      };
      const configDir = path.dirname(this.configPath);
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }
      const tmpPath = this.configPath + '.tmp';
      fs.writeFileSync(tmpPath, JSON.stringify(schedule, null, 2), 'utf-8');
      fs.renameSync(tmpPath, this.configPath);
    } catch (error) {
      this.log('error', 'Failed to save config', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  // ─── 前置日期修补 ───

  /**
   * 在执行脚本前，将过期的硬编码日期替换为动态计算。
   * 轻量操作：只改文件，不执行不验证。
   */
  private patchExpiredDates(task: HeartbeatTask): void {
    try {
      const basePath = this.resourcesBasePath;
      const scriptPath = path.join(basePath, 'scripts', task.skill, 'index.js');
      if (!fs.existsSync(scriptPath)) return;

      const original = fs.readFileSync(scriptPath, 'utf-8');
      let patched = original;
      const fixes: string[] = [];

      const today = new Date().toISOString().split('T')[0].replace(/-/g, ''); // YYYYMMDD

      const dateAssignPatterns = [
        /(?:const|let|var)\s+(checkIn|checkOut|startDate|endDate|check_in|check_out|start_date|end_date)\s*=\s*(['"])(\d{4}(?:-?\d{2}){2})\2/g,
        /(params\.(?:startDate|endDate|checkIn|checkOut|start_date|end_date|check_in|check_out)\s*\|\|\s*)(['"])(\d{4}(?:-?\d{2}){2})\2/g,
      ];

      for (const pattern of dateAssignPatterns) {
        let match: RegExpExecArray | null;
        pattern.lastIndex = 0;
        while ((match = pattern.exec(patched)) !== null) {
          const varName = match[1];
          const dateStr = match[3];
          const year = parseInt(dateStr.substring(0, 4));
          if (year < 2020 || year > 2030) continue;

          // 只修过期日期（今天之前）
          const normalized = dateStr.replace(/-/g, '');
          if (normalized >= today) continue;

          const hasDash = dateStr.includes('-');
          const isCheckOut = /check.?out|end.?date/i.test(varName);
          const offset = isCheckOut ? 1 : 0;

          let replacement: string;
          if (hasDash) {
            replacement = `(() => { const d = new Date(); d.setDate(d.getDate() + ${offset}); return d.toISOString().split('T')[0]; })()`;
          } else {
            replacement = `(() => { const d = new Date(); d.setDate(d.getDate() + ${offset}); return d.toISOString().split('T')[0].replace(/-/g, ''); })()`;
          }

          const fullMatch = match[0];
          const fixed = fullMatch.replace(match[2] + dateStr + match[2], replacement);
          patched = patched.replace(fullMatch, fixed);
          fixes.push(`${varName.trim()}: '${dateStr}' → dynamic(+${offset}d)`);
        }
      }

      if (patched !== original) {
        fs.writeFileSync(scriptPath, patched, 'utf-8');
        this.log('info', `patchExpiredDates: fixed ${fixes.length} expired date(s) in ${task.skill}`, { fixes });
      }
    } catch (e) {
      this.log('warn', `patchExpiredDates error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // ─── 确定性预修复 ───

  /**
   * 前置修补：检查脚本中默认 hotelId 是否为本店 ID，如果不是则修正。
   * 防止 Recovery Agent 生成脚本时误用爬虫导航过程中搜索到的竞品 hotelId。
   */
  private async patchWrongHotelId(task: HeartbeatTask): Promise<void> {
    try {
      const basePath = this.resourcesBasePath;
      const scriptPath = path.join(basePath, 'scripts', task.skill, 'index.js');
      if (!fs.existsSync(scriptPath)) {
        this.log('debug', `patchWrongHotelId: script not found, skipping`, { skill: task.skill });
        return;
      }

      // 从数据库获取本店在该平台的 hotelId
      let correctHotelId: string | null = null;
      try {
        const config = await databaseManager.getHotelConfig();
        if (!config) {
          this.log('debug', `patchWrongHotelId: no hotel config in database`);
          return;
        }
        const PLATFORM_HOTEL_ID_FIELD: Record<string, string> = {
          'ctrip': 'ctrip_hotel_id',
          'trip': 'ctrip_hotel_id',
          'meituan': 'meituan_hotel_id',
          'booking': 'booking_hotel_id',
        };
        const field = PLATFORM_HOTEL_ID_FIELD[task.platform];
        if (field && config[field]) {
          correctHotelId = String(config[field]);
        }
        this.log('debug', `patchWrongHotelId: config lookup`, {
          platform: task.platform, field, value: config[field] || 'empty', correctHotelId
        });
      } catch (dbErr) {
        this.log('warn', `patchWrongHotelId: database query failed`, {
          error: dbErr instanceof Error ? dbErr.message : String(dbErr)
        });
        return;
      }

      if (!correctHotelId) {
        this.log('debug', `patchWrongHotelId: no hotelId configured for platform ${task.platform}`);
        return;
      }

      const original = fs.readFileSync(scriptPath, 'utf-8');
      const pattern = /(params\.hotelId\s*\|\|\s*)(\d{5,})/;
      const match = pattern.exec(original);
      if (!match) {
        this.log('debug', `patchWrongHotelId: no hotelId pattern found in ${task.skill}`);
        return;
      }

      const currentDefault = match[2];
      if (currentDefault === correctHotelId) {
        this.log('debug', `patchWrongHotelId: hotelId already correct in ${task.skill}`, { hotelId: currentDefault });
        return;
      }

      const patched = original.replace(pattern, `$1${correctHotelId}`);
      fs.writeFileSync(scriptPath, patched, 'utf-8');
      this.log('info', `patchWrongHotelId: fixed default hotelId in ${task.skill}`, {
        from: currentDefault,
        to: correctHotelId,
      });
    } catch (e) {
      this.log('warn', `patchWrongHotelId error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /**
   * 代码层面自动检测并修复 API 脚本中的已知问题。
   * 不依赖 LLM，纯确定性逻辑。修复成功则直接入库并返回 true。
   *
   * 检测的 pattern：
   * 1. 日期硬编码（YYYYMMDD 或 YYYY-MM-DD 格式的固定字符串赋值）
   * 2. isRSC: true（携程系平台常见问题）
   */
  private async autoFixScript(task: HeartbeatTask): Promise<boolean> {
    const startTime = Date.now();
    try {
      // 定位脚本文件
      const basePath = this.resourcesBasePath;
      const scriptPath = path.join(basePath, 'scripts', task.skill, 'index.js');
      this.log('info', `autoFixScript: checking script`, { scriptPath, configPath: this.configPath, exists: fs.existsSync(scriptPath) });
      if (!fs.existsSync(scriptPath)) {
        this.log('warn', `autoFixScript: script not found: ${scriptPath}`);
        return false;
      }

      const original = fs.readFileSync(scriptPath, 'utf-8');
      let patched = original;
      const fixes: string[] = [];

      // ── Pattern 1: 硬编码日期 ──
      // 匹配 'YYYYMMDD' 或 "YYYYMMDD" 格式（8位纯数字，前4位是年份 2020-2030）
      const hardcodedDateYMD = /(['"])(\d{4})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\1/g;
      // 匹配 'YYYY-MM-DD' 或 "YYYY-MM-DD" 格式
      const hardcodedDateISO = /(['"])(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\1/g;

      // 检测是否有 checkIn/checkOut 相关赋值使用了硬编码日期
      const dateAssignPatterns = [
        // const checkIn = '20250101';  或  const checkOut = "20250102";
        /(?:const|let|var)\s+(checkIn|checkOut|startDate|endDate|check_in|check_out|start_date|end_date)\s*=\s*(['"])(\d{4}(?:-?\d{2}){2})\2/g,
        // params.startDate || '2026-04-01' (OR-fallback 默认值，Booking 等平台使用)
        /(params\.(?:startDate|endDate|checkIn|checkOut|start_date|end_date|check_in|check_out)\s*\|\|\s*)(['"])(\d{4}(?:-?\d{2}){2})\2/g,
      ];

      for (const pattern of dateAssignPatterns) {
        let match: RegExpExecArray | null;
        pattern.lastIndex = 0;
        while ((match = pattern.exec(patched)) !== null) {
          const varName = match[1];
          const dateStr = match[3];
          const year = parseInt(dateStr.substring(0, 4));
          if (year < 2020 || year > 2030) continue; // 不是日期

          // 判断日期格式
          const hasDash = dateStr.includes('-');
          const isCheckOut = /check.?out|end.?date/i.test(varName);
          const offset = isCheckOut ? 1 : 0;

          let replacement: string;
          if (hasDash) {
            // YYYY-MM-DD 格式
            replacement = `(() => { const d = new Date(); d.setDate(d.getDate() + ${offset}); return d.toISOString().split('T')[0]; })()`;
          } else {
            // YYYYMMDD 格式
            replacement = `(() => { const d = new Date(); d.setDate(d.getDate() + ${offset}); return d.toISOString().split('T')[0].replace(/-/g, ''); })()`;
          }

          const fullMatch = match[0];
          const fixed = fullMatch.replace(match[2] + dateStr + match[2], replacement);
          patched = patched.replace(fullMatch, fixed);
          fixes.push(`date: ${varName}='${dateStr}' → dynamic`);
        }
      }

      // ── Pattern 2: isRSC: true ──
      const isRSCPattern = /(['"]isRSC['"]\s*:\s*)true/g;
      if (isRSCPattern.test(patched)) {
        patched = patched.replace(/(['"]isRSC['"]\s*:\s*)true/g, '$1false');
        fixes.push('isRSC: true → false');
      }
      // 也匹配不带引号的 key
      const isRSCPattern2 = /(isRSC\s*:\s*)true/g;
      if (isRSCPattern2.test(patched)) {
        patched = patched.replace(/(isRSC\s*:\s*)true/g, '$1false');
        if (!fixes.includes('isRSC: true → false')) {
          fixes.push('isRSC: true → false');
        }
      }

      // 没有任何修改
      if (patched === original) {
        this.log('info', `autoFixScript: no known patterns found in ${task.skill}`, {
          scriptLength: original.length,
          scriptPreview: original.substring(0, 200),
        });
        return false;
      }

      // 写回修改后的脚本
      this.log('info', `autoFixScript: applying ${fixes.length} fix(es) to ${task.skill}`, { fixes });
      fs.writeFileSync(scriptPath, patched, 'utf-8');

      // 重新执行脚本验证
      const verifyResult = await Promise.race([
        this.skillManager.executeSkill(task.skill, task.params || {}),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('autoFix verify timeout')), 60_000)
        )
      ]);

      if (!verifyResult.success || verifyResult.output?.success === false) {
        this.log('warn', `autoFixScript: script still fails after fix`, { error: verifyResult.error });
        // 回滚脚本
        fs.writeFileSync(scriptPath, original, 'utf-8');
        return false;
      }

      if (this.isEmptyAPIResponse(verifyResult.output)) {
        this.log('warn', `autoFixScript: script returns empty data after fix`);
        // 回滚脚本
        fs.writeFileSync(scriptPath, original, 'utf-8');
        return false;
      }

      // 数据有效 → 入库
      this.log('info', `autoFixScript: fix verified, calling data-store for ${task.skill}`);
      const storeResult = await this.skillManager.executeSkill('data-store', { source: task.skill });
      if (!storeResult.success || storeResult.output?.success === false) {
        this.log('warn', `autoFixScript: data-store failed`, { error: storeResult.output?.error || storeResult.error });
      }

      await this.saveExecutionLog({
        taskId: task.id, skill: task.skill, startTime, endTime: Date.now(),
        duration: Date.now() - startTime, success: true,
      });

      return true;
    } catch (e) {
      this.log('warn', `autoFixScript error: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }

  // ─── Recovery 数据验证 ───

  /**
   * 强制合规：扫描 Agent 生成的脚本，将 params.xxx || '硬编码值' 替换为必传参数模式
   * Agent 经常无视 prompt 里的"禁止硬编码"指令，这里在代码层面兜底
   */
  private sanitizeHardcodedIds(skill: string): void {
    const ID_PARAMS = ['hotelId', 'hotelSlug', 'poiId', 'partnerId'];
    try {
      const scriptPath = path.resolve(this.resourcesBasePath, 'scripts', skill, 'index.js');
      if (!fs.existsSync(scriptPath)) return;
      let content = fs.readFileSync(scriptPath, 'utf-8');
      let changed = false;

      for (const param of ID_PARAMS) {
        // 匹配: const xxx = params.xxx || '值' 或 params.xxx || 数字
        const pattern = new RegExp(
          `(const\\s+${param}\\s*=\\s*)params\\.${param}\\s*\\|\\|\\s*['"]?[\\w-]+['"]?\\s*;`,
          'g'
        );
        const replacement = `$1params.${param};\n    if (!${param}) return runtime.outputError('MISSING_PARAM', '${param} is required');`;
        const newContent = content.replace(pattern, replacement);
        if (newContent !== content) {
          content = newContent;
          changed = true;
          this.log('info', `[sanitize] Removed hardcoded default for ${param} in ${skill}`);
        }
      }

      if (changed) {
        fs.writeFileSync(scriptPath, content, 'utf-8');
        this.log('info', `[sanitize] Script sanitized: ${skill}`);
      }
    } catch (e: any) {
      this.log('warn', `[sanitize] Failed to sanitize ${skill}`, { error: e.message });
    }
  }

  /**
   * 确定性提取美团 poiId/partnerId：通过爬虫打开美团后台，拦截页面初始化 API 获取商户信息。
   * 不依赖 Agent 决策，纯代码逻辑。
   */
  private async extractMeituanIdsViaCrawler(): Promise<{ poiId: string | null; partnerId: string | null } | null> {
    if (!this.skillManager) return null;

    try {
      // 打开美团后台首页（不需要导航到特定页面），拦截初始化 API 获取 poiId/partnerId
      const result = await this.skillManager.executeSkill('ai-web-crawler', {
        background: true,
        start_url: 'https://me.meituan.com/ebooking/merchant/ebIframe?iUrl=%2Febooking%2Fnew-workbench%2Findex.html%23%2F',
        intercept_apis: true,
        target: '美团商家后台首页，拦截包含poiId的API请求',
        operation: 'fetch_data',
        sessionId: `meituan-id-extract-${Date.now()}`,
      });

      if (!result.success || !result.output) return null;

      const candidates = result.output.apiCandidates || result.output.data?.apiCandidates || [];
      let poiId: string | null = null;
      let partnerId: string | null = null;

      for (const candidate of candidates) {
        // 检查请求 URL
        const url = candidate.url || candidate.requestUrl || '';
        // 检查请求体
        const body = candidate.requestBody || candidate.body || '';
        const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
        // 检查响应体
        const respStr = typeof candidate.responseBody === 'string' ? candidate.responseBody : JSON.stringify(candidate.responseBody || '');
        const combined = url + bodyStr + respStr;

        const poiMatch = combined.match(/poiId[=":]\s*"?(\d{5,})"?/);
        const partnerMatch = combined.match(/partnerId[=":]\s*"?(\d{5,})"?/);
        if (poiMatch && !poiId) poiId = poiMatch[1];
        if (partnerMatch && !partnerId) partnerId = partnerMatch[1];
        if (poiId && partnerId) break;
      }

      return (poiId || partnerId) ? { poiId, partnerId } : null;
    } catch (e: any) {
      this.log('warn', `extractMeituanIdsViaCrawler error: ${e.message}`);
      return null;
    }
  }

  /**
   * Recovery 成功后，从修复后的脚本中提取平台特定 ID 存入 hotel_config
   * 目前只处理美团后台的 poiId/partnerId
   */
  private async extractAndSavePlatformIds(task: HeartbeatTask): Promise<void> {
    if (task.skill !== 'api-meituan-backend-price') return;
    this.log('info', `[extractPlatformIds] Starting for ${task.skill}`);
    try {
      let poiId: string | null = null;
      let partnerId: string | null = null;

      // 来源1：从脚本提取（sanitize 之前，可能有硬编码值）
      const scriptPath = path.resolve(this.resourcesBasePath, 'scripts', task.skill, 'index.js');
      if (fs.existsSync(scriptPath)) {
        const code = fs.readFileSync(scriptPath, 'utf-8');
        const p1 = code.match(/poiId\s*(?:\|\||=|:)\s*['"]?(\d{5,})['"]?/);
        const p2 = code.match(/partnerId\s*(?:\|\||=|:)\s*['"]?(\d{5,})['"]?/);
        if (p1) poiId = p1[1];
        if (p2) partnerId = p2[1];
        this.log('info', `[extractPlatformIds] Script: poiId=${poiId}, partnerId=${partnerId}`);
      }

      // 来源2：从历史成功的结果文件兜底
      if (!poiId || !partnerId) {
        const dataDir = path.join(getDataDir(), 'api-results');
        if (fs.existsSync(dataDir)) {
          const files = fs.readdirSync(dataDir)
            .filter((f: string) => f.startsWith('api-meituan-backend-price-') && f.endsWith('.json'))
            .sort().reverse();
          for (const file of files) {
            const content = fs.readFileSync(path.join(dataDir, file), 'utf-8');
            if (!poiId) { const m = content.match(/"poiId"\s*:\s*"?(\d{5,})"?/); if (m) poiId = m[1]; }
            if (!partnerId) { const m = content.match(/"partnerId"\s*:\s*"?(\d{5,})"?/); if (m) partnerId = m[1]; }
            if (poiId && partnerId) break;
          }
        }
      }

      if (poiId && partnerId) {
        await databaseManager.saveHotelConfig({ meituanPoiId: poiId, meituanPartnerId: partnerId });
        this.log('info', `Saved meituan poiId=${poiId}, partnerId=${partnerId}`);
      } else {
        this.log('warn', `Could not extract meituan poiId/partnerId`);
      }
    } catch (e: any) {
      this.log('warn', `Failed to extract platform IDs`, { error: e.message });
    }
  }

  /**
   * 验证 Agent recovery 是否产生了有效数据文件。
   * 检查 data/api-results/ 下是否有本次 recovery 后新写入的、包含实际数据的文件。
   */
  private verifyRecoveryData(skill: string, afterTimestamp: number): boolean {
    try {
      const dataDir = path.join(getDataDir(), 'api-results');
      if (!fs.existsSync(dataDir)) return false;

      const files = fs.readdirSync(dataDir)
        .filter(f => f.startsWith(skill) && f.endsWith('.json'))
        .filter(f => {
          const stat = fs.statSync(path.join(dataDir, f));
          return stat.mtimeMs >= afterTimestamp;
        });

      if (files.length === 0) return false;

      // 读最新文件，检查是否有实际数据
      files.sort().reverse();
      const content = JSON.parse(fs.readFileSync(path.join(dataDir, files[0]), 'utf-8'));
      return content.success === true && !this.isEmptyAPIResponse(content);
    } catch {
      return false;
    }
  }

  // ─── 空数据检测 ───

  /**
   * 检测 API 返回是否实质为空（API 返回 success 但数据无实际内容）。
   * 典型场景：Trip.com 返回 { success: true, data: { data: {}, ResponseStatus: { Ack: "Success" } } }
   *
   * 只检测最明显的空数据模式，避免误判有数据的响应。
   */
  private isEmptyAPIResponse(output: any): boolean {
    if (!output) return true;

    // output 是 SkillExecutor parseOutput 后的结果
    // 对于 api-* 脚本，结构是 { success: true, data: ... }
    const data = output.data ?? output;

    // 情况1：data 本身就是空对象 {}
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const keys = Object.keys(data);
      if (keys.length === 0) {
        this.log('info', 'isEmptyAPIResponse: data is empty object {}');
        return true;
      }
      // 只有 ResponseStatus 没有实际数据
      if (keys.length === 1 && keys[0] === 'ResponseStatus') {
        this.log('info', 'isEmptyAPIResponse: data only has ResponseStatus, no actual data');
        return true;
      }
      // 嵌套空数据：{ data: {}, ResponseStatus: {...} }（Trip.com 典型响应壳）
      // data.data 是真正的数据体，如果它是空对象且只剩 ResponseStatus 元数据，判定为空
      if (keys.includes('data') && keys.includes('ResponseStatus') && typeof data.data === 'object') {
        const innerData = data.data;
        if (innerData === null || innerData === undefined) {
          this.log('info', 'isEmptyAPIResponse: data.data is null/undefined');
          return true;
        }
        if (Array.isArray(innerData) && innerData.length === 0) {
          this.log('info', 'isEmptyAPIResponse: data.data is empty array');
          return true;
        }
        if (!Array.isArray(innerData) && Object.keys(innerData).length === 0) {
          this.log('info', 'isEmptyAPIResponse: data.data is empty object (nested shell)');
          return true;
        }
        // 错误响应壳：data.data 只有错误码没有实际业务数据
        // 如 { htlSpiderActionErrorCode: 203 } 或 { code: 400, message: "..." }
        if (!Array.isArray(innerData)) {
          const innerKeys = Object.keys(innerData);
          const hasErrorIndicator = innerKeys.some(k =>
            /error|code|errcode|errmsg/i.test(k)
          );
          const hasBusinessData = innerKeys.some(k =>
            /room|price|inventory|hotel|list|items|data|result/i.test(k)
          );
          if (hasErrorIndicator && !hasBusinessData) {
            this.log('info', `isEmptyAPIResponse: data.data is error shell (keys: ${innerKeys.join(',')})`);
            return true;
          }
        }
      }
    }

    // 情况2：data 是空数组
    if (Array.isArray(data) && data.length === 0) {
      this.log('info', 'isEmptyAPIResponse: data is empty array');
      return true;
    }

    // 不做深层结构检查，避免误判
    return false;
  }

  /**
   * 检测 api-results 文件是否为失败响应（错误壳）。
   * 如果是，返回可读的失败原因字符串；否则返回 null。
   * 用于 buildRecoveryPrompt 中判断是否注入 dataSample，避免 Agent
   * 参考失败响应写出"假设成功结构"的 adapter。
   */
  private detectFailedSample(raw: any): string | null {
    if (!raw) return 'raw 文件为空';
    if (raw.success === false) {
      const errMsg = raw.error?.message || raw.error?.code || JSON.stringify(raw.error || {});
      return `脚本执行失败 (${errMsg})`;
    }
    const data = raw.data;
    if (!data) return 'raw.data 不存在';
    // 业务层失败码（携程/trip 系）：{ code: 400, message: 'Initial Parameter Error', data: null }
    if (typeof data === 'object' && !Array.isArray(data)) {
      if (typeof data.code === 'number' && data.code >= 400) {
        return `业务错误码 ${data.code}${data.message ? ': ' + data.message : ''}`;
      }
      // 反爬错误壳（ctrip/trip 系）：{ data: { htlSpiderActionErrorCode: 203 }, ResponseStatus: {...} }
      const inner = data.data;
      if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
        if (inner.htlSpiderActionErrorCode !== undefined) {
          return `反爬拦截 htlSpiderActionErrorCode=${inner.htlSpiderActionErrorCode}`;
        }
        const innerKeys = Object.keys(inner);
        const hasErrorIndicator = innerKeys.some(k => /error|code|errcode|errmsg/i.test(k));
        const hasBusinessData = innerKeys.some(k => /room|price|inventory|hotel|list|items|data|result/i.test(k));
        if (innerKeys.length > 0 && hasErrorIndicator && !hasBusinessData) {
          return `响应仅含错误字段 (${innerKeys.join(',')})，无业务数据`;
        }
      }
      // 典型响应壳：{ data: null/{}/[], ResponseStatus: {...} }
      if (Object.keys(data).includes('ResponseStatus')) {
        if (inner === null || inner === undefined) return 'data.data 为 null';
        if (Array.isArray(inner) && inner.length === 0) return 'data.data 为空数组';
        if (typeof inner === 'object' && !Array.isArray(inner) && Object.keys(inner).length === 0) return 'data.data 为空对象';
      }
    }
    return null;
  }

  /**
   * 从 API 响应中提取有用的错误线索（截断到200字符），帮助 Agent 诊断问题。
   */
  private extractResponseHint(output: any): string {
    try {
      const data = output?.data ?? output;
      if (!data || typeof data !== 'object') return '';
      // 常见的错误/状态字段
      const hintFields = ['error', 'message', 'msg', 'errMsg', 'ResponseStatus', 'status', 'code'];
      const parts: string[] = [];
      for (const field of hintFields) {
        if (data[field] !== undefined) {
          const val = typeof data[field] === 'object' ? JSON.stringify(data[field]) : String(data[field]);
          parts.push(`${field}=${val}`);
        }
      }
      const hint = parts.join(', ');
      return hint.length > 200 ? hint.substring(0, 200) + '...' : hint;
    } catch {
      return '';
    }
  }

  // ─── Logging helper ───

  private log(level: 'info' | 'warn' | 'error' | 'debug', message: string, meta?: Record<string, any>): void {
    if (!this.logger) return;
    if (level === 'debug') {
      this.logger.debug('heartbeat', message, meta);
    } else if (level === 'warn') {
      this.logger.warn('heartbeat', message, meta);
    } else if (level === 'error') {
      this.logger.error('heartbeat', message, meta);
    } else {
      this.logger.info('heartbeat', message, meta);
    }
  }
}
