/**
 * Pi Agent Manager - Pi Coding Agent管理器
 * 
 * 职责：
 * - 初始化和管理pi-coding-agent实例
 * - 处理与AI模型的通信
 * - 维护对话历史
 * - 支持流式响应（可选）
 * - 管理API配置
 */

import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import type { PiAgentConfig, ChatMessage } from '../shared/types';
import { IPC_CHANNELS } from '../shared/types';
import { generateId } from '../shared/utils';
import { Logger } from './logger';
import type { SkillManager } from './skill-manager';
import type { BrowserWindow } from 'electron';
import { getBasePath, getAgentDir } from './path-resolver';
import { getMemoryManager } from './memory/manager';
import type { IMemoryManager } from './memory/interfaces';
import type { HotelEntity } from './memory/types';
import { databaseManager } from '../../database/dist/database-manager';
import { getFailureTracker, extractTargetFromSkill } from './api-self-repair';
import { detectAPIFailure } from './api-failure-detector';
import { loadLLMConfig, switchToFallback, isUsingFallback, isProviderUnavailableError, tryRecoverPrimary } from '../shared/llm-config-loader';

/**
 * Pi Agent Manager类
 * 
 * 注意：由于pi-coding-agent是一个CLI工具，这里我们实现一个简化版本
 * 实际使用时可能需要通过子进程或其他方式调用pi-coding-agent
 * 当前实现使用占位符，展示如何集成AI API
 */
export class PiAgentManager {
  private config: PiAgentConfig;
  private conversationHistory: ChatMessage[] = [];
  private logger: Logger | null = null;
  private isInitialized = false;
  private openaiClient: OpenAI | null = null;
  private skillManager: SkillManager | null = null;
  private mainWindow: BrowserWindow | null = null;
  private windowManager: any = null; // WindowManager 引用，用于获取标签页信息
  private memoryManager: IMemoryManager | null = null; // 记忆系统管理器
  private defaultSkillParams: Record<string, any> = {}; // 默认技能参数，会合并到每次 skill 调用
  private hotelMentionCount: Map<string, number> = new Map(); // 跟踪酒店提及次数
  private needsPersistenceSkill = false; // 本轮对话是否加载了需要持久化的策略skill
  private hasCalledPersistence = false; // 本轮对话是否已调用data-persistence
  private priceAdjustLoginBlock: { notLoggedIn: string[] } | null = null; // 登录检测层：跨轮次拦截
  private executedMutationToolKeys: Set<string> = new Set(); // 本轮请求内的真实写入工具去重
  private shouldStopToolLoop = false; // 提交型工具成功后立即终止 tool loop
  private mutationToolStopReply: string | null = null;
  private cachedOwnHotelName: string | null = null; // 缓存本店名称
  private cachedCompetitorNames: string[] = []; // 缓存竞品名称列表
  private chatHistoryLoaded = false; // 是否已加载过历史对话
  private recoveryMode = false;     // recovery 模式：跳过历史加载、记忆注入、数据库保存
  private currentLanguage: 'zh' | 'en' = 'zh'; // 当前语言偏好
  private currentTimezone: string = 'Asia/Shanghai'; // 当前时区偏好
  private skillAllowList: Set<string> | null = null; // null = 不过滤，非 null = 只暴露白名单中的 skill
  private currentSessionId: string | null = null; // 当前会话 ID
  private loginAlertService: any = null; // 登录提醒服务

  constructor(config: PiAgentConfig, logger?: Logger) {
    this.config = config;
    this.logger = logger || null;
  }

  /**
   * 设置SkillManager
   */
  setSkillManager(skillManager: SkillManager): void {
    this.skillManager = skillManager;

    if (this.logger) {
      this.logger.info('pi-agent', 'SkillManager attached to PiAgentManager');
    }
  }

  /**
   * 设置 mainWindow 引用（用于向渲染进程发送进度事件）
   */
  setMainWindow(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow;
    if (this.loginAlertService) this.loginAlertService.setMainWindow(mainWindow);

    if (this.logger) {
      this.logger.info('pi-agent', 'MainWindow attached to PiAgentManager');
    }
  }

  /**
   * 设置 WindowManager 引用（用于获取标签页信息）
   */
  setWindowManager(windowManager: any): void {
    this.windowManager = windowManager;

    if (this.logger) {
      this.logger.info('pi-agent', 'WindowManager attached to PiAgentManager');
    }
  }

  /**
   * 设置默认技能参数（会自动合并到每次 skill 调用的参数中）
   * 用于心跳场景强制注入 background: true 等参数
   */
  setDefaultSkillParams(params: Record<string, any>): void {
    this.defaultSkillParams = params;
  }

  /**
   * 设置 skill 白名单过滤。仅白名单中的 skill 对 LLM 可见。
   * 传 null 或不调用此方法 = 不过滤（默认，用户侧 Agent 保持全部可见）。
   */
  setSkillAllowList(names: string[] | null): void {
    this.skillAllowList = names ? new Set(names) : null;
  }

  /**
   * 设置登录提醒服务
   */
  setLoginAlertService(service: any): void {
    this.loginAlertService = service;
  }

  /**
   * 设置语言偏好（由 IPC handler 调用）
   */
  setLanguage(lang: 'zh' | 'en'): void {
    this.currentLanguage = lang;
    if (this.logger) {
      this.logger.info('pi-agent', `Language set to ${lang}`);
    }
  }

  /**
   * 设置时区偏好（由 IPC handler 调用）
   */
  setTimezone(tz: string): void {
    this.currentTimezone = tz;
    if (this.logger) {
      this.logger.info('pi-agent', `Timezone set to ${tz}`);
    }
  }

  /**
   * 初始化Pi Agent
   */
  async initialize(config?: PiAgentConfig): Promise<void> {
    if (config) {
      this.config = config;
    }

    if (this.logger) {
      this.logger.info('pi-agent', 'Initializing Pi Agent', {
        provider: this.config.provider,
        model: this.config.model
      });
    }

    try {
      // 验证配置
      this.validateConfig();

      // 初始化OpenAI客户端（如果provider是openai）
      if (this.config.provider === 'openai') {
        this.openaiClient = new OpenAI({
          apiKey: this.config.apiKey,
          baseURL: this.config.baseURL || 'https://api.openai.com/v1',
          timeout: 120000,  // 2 分钟超时，避免无限等待
        });
        
        if (this.logger) {
          this.logger.debug('pi-agent', 'OpenAI client initialized', {
            baseURL: this.config.baseURL || 'https://api.openai.com/v1'
          });
        }
      }

      // 初始化记忆系统（可选，失败不影响Agent核心功能）
      try {
        this.memoryManager = getMemoryManager();
        const initResult = await this.memoryManager.initialize();
        if (initResult.success && this.logger) {
          this.logger.info('pi-agent', 'Memory system initialized for agent');
        } else if (!initResult.success && this.logger) {
          this.logger.warn('pi-agent', 'Memory system initialization returned error', {
            error: initResult.error
          });
        }
      } catch (memoryError) {
        // 记忆系统初始化失败，记录警告但继续
        if (this.logger) {
          this.logger.warn('pi-agent', 'Memory system initialization failed, agent will work without memory', {
            error: memoryError instanceof Error ? memoryError.message : String(memoryError)
          });
        }
        this.memoryManager = null;
      }

      this.isInitialized = true;

      if (this.logger) {
        this.logger.info('pi-agent', 'Pi Agent initialized successfully');
      }
    } catch (error) {
      if (this.logger) {
        this.logger.exception('pi-agent', error as Error, { phase: 'initialization' });
      }
      throw error;
    }
  }

  /**
   * 切换到 fallback provider 并重新初始化 OpenAI 客户端
   * 返回 true 表示切换成功
   */
  private reinitializeWithFallback(): boolean {
    if (!switchToFallback()) return false;

    const fallbackConfig = loadLLMConfig();
    this.config = {
      ...this.config,
      apiKey: fallbackConfig.apiKey,
      baseURL: fallbackConfig.baseURL,
      model: fallbackConfig.model,
    };

    this.openaiClient = new OpenAI({
      apiKey: this.config.apiKey,
      baseURL: this.config.baseURL,
      timeout: 120000,
    });

    // 同步更新 SkillManager 的 LLM 环境变量，让后续子进程也用 fallback
    if (this.skillManager) {
      (this.skillManager as any).setLLMEnv(this.config.apiKey, this.config.baseURL, this.config.model);
    }

    console.log(`[PI-AGENT] ⚡ Switched to fallback: ${this.config.baseURL}, model: ${this.config.model}`);
    if (this.logger) {
      this.logger.info('pi-agent', 'Switched to fallback provider', {
        baseURL: this.config.baseURL,
        model: this.config.model,
      });
    }
    return true;
  }

  /**
   * 验证配置
   */
  private validateConfig(): void {
    if (!this.config.apiKey || this.config.apiKey.trim().length === 0) {
      throw new Error('API key is required');
    }

    if (!this.config.model || this.config.model.trim().length === 0) {
      throw new Error('Model is required');
    }

    if (this.config.temperature < 0 || this.config.temperature > 2) {
      throw new Error('Temperature must be between 0 and 2');
    }

    if (this.config.maxTokens < 1) {
      throw new Error('Max tokens must be greater than 0');
    }
  }

  /**
   * 发送消息到AI Agent
   */
  async sendMessage(message: string): Promise<string> {
    if (!this.isInitialized) {
      throw new Error('Pi Agent not initialized');
    }

    if (!message || message.trim().length === 0) {
      throw new Error('Message cannot be empty');
    }

    if (this.logger) {
      this.logger.info('pi-agent', 'Sending message', {
        messageLength: message.length,
        historyLength: this.conversationHistory.length
      });
    }

    try {
      // recovery 模式跳过数据库相关操作（历史加载、缓存刷新、对话保存）
      if (!this.recoveryMode) {
        // 预加载酒店配置到缓存（每次对话都刷新，确保控制台修改立即生效）
        await this.refreshHotelConfigCache();

        // 首次对话时加载历史记录
        if (!this.chatHistoryLoaded) {
          // 尝试恢复最近的会话，没有则创建新会话
          if (!this.currentSessionId) {
            try {
              const sessions = await databaseManager.getSessions();
              if (sessions.length > 0) {
                this.currentSessionId = sessions[0].id;
                this.logger?.info('pi-agent', `Restored last session: ${this.currentSessionId}`);
              }
            } catch (_) {}
            if (!this.currentSessionId) {
              const { v4: uuidv4 } = require('uuid');
              const newId: string = uuidv4();
              this.currentSessionId = newId;
              await databaseManager.createSession(newId, '新对话');
              this.logger?.info('pi-agent', `Auto-created session: ${this.currentSessionId}`);
            }
          }
          await this.loadChatHistory();
          this.chatHistoryLoaded = true;
        }
      }

      // recovery 模式跳过记忆关键词注入和智能提示
      const enrichedMessage = this.recoveryMode ? message : await this.processMemoryKeywords(message);
      const smartPrompt = this.recoveryMode ? null : await this.checkSmartPrompts();
      
      // 添加用户消息到历史
      const userMessage: ChatMessage = {
        id: generateId(),
        role: 'user',
        content: enrichedMessage,
        timestamp: Date.now()
      };
      this.conversationHistory.push(userMessage);

      const response = await this.callAIAPI(enrichedMessage);

      // 如果有智能提示，添加到响应中
      const finalResponse = smartPrompt ? `${response}\n\n${smartPrompt}` : response;

      // 添加AI响应到历史
      const assistantMessage: ChatMessage = {
        id: generateId(),
        role: 'assistant',
        content: finalResponse,
        timestamp: Date.now()
      };
      this.conversationHistory.push(assistantMessage);

      // recovery 模式跳过对话持久化
      if (!this.recoveryMode) {
        await this.saveChatToDatabase(message, finalResponse);
      }

      if (this.logger) {
        this.logger.info('pi-agent', 'Message processed successfully', {
          responseLength: finalResponse.length
        });
      }

      return finalResponse;
    } catch (error) {
      if (this.logger) {
        this.logger.exception('pi-agent', error as Error, {
          phase: 'sendMessage',
          messageLength: message.length
        });
      }
      throw error;
    }
  }

  /**
   * 调用AI API（占位符实现）
   */
  private async callAIAPI(message: string): Promise<string> {
    // TODO: 实现实际的API调用
    // 根据provider选择不同的API实现
    
    switch (this.config.provider) {
      case 'anthropic':
        return this.callAnthropicAPI(message);
      case 'openai':
        return this.callOpenAIAPI(message);
      case 'google':
        return this.callGoogleAPI(message);
      case 'azure':
        return this.callAzureAPI(message);
      case 'ollama':
        return this.callOllamaAPI(message);
      default:
        throw new Error(`Unsupported provider: ${this.config.provider}`);
    }
  }

  /**
   * 调用Anthropic API（占位符）
   */
  private async callAnthropicAPI(message: string): Promise<string> {
    // TODO: 实现Anthropic API调用
    // 使用 @anthropic-ai/sdk
    
    if (this.logger) {
      this.logger.debug('pi-agent', 'Calling Anthropic API (placeholder)');
    }

    // 占位符响应
    return `[Anthropic API 占位符响应]\n\n你说: "${message}"\n\n这是一个占位符响应。实际实现需要：\n1. 安装 @anthropic-ai/sdk\n2. 使用API密钥初始化客户端\n3. 调用messages.create()方法\n4. 处理流式响应（可选）\n\n当前配置:\n- Model: ${this.config.model}\n- Temperature: ${this.config.temperature}\n- Max Tokens: ${this.config.maxTokens}`;
  }

  /**
   * 调用OpenAI API（使用OpenAI SDK）
   */
  private async callOpenAIAPI(message: string): Promise<string> {
    if (!this.openaiClient) {
      throw new Error('OpenAI client not initialized');
    }

    if (this.logger) {
      this.logger.debug('pi-agent', 'Calling OpenAI API');
    }

    // 重置本轮对话的持久化跟踪标志
    this.needsPersistenceSkill = false;
    this.hasCalledPersistence = false;
    this.priceAdjustLoginBlock = null;
    this.resetMutationToolGuards();

    try {
      // 构建消息历史
      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

      // 添加系统提示词（包含技能信息）
      const systemPrompt = this.buildSystemPrompt();
      if (systemPrompt) {
        messages.push({
          role: 'system',
          content: systemPrompt
        });
      }

      // 添加对话历史
      this.conversationHistory.forEach(msg => {
        messages.push({
          role: msg.role as 'user' | 'assistant' | 'system',
          content: msg.content
        });
      });

      // 添加当前消息
      messages.push({
        role: 'user',
        content: message
      });

      // 构建工具定义（如果有SkillManager）
      const tools = this.buildToolDefinitions();

      // ── Prompt 诊断 ──
      console.error(`[PROMPT-DIAG] === Message breakdown (recoveryMode: ${this.recoveryMode}) ===`);
      console.error(`[PROMPT-DIAG] [0] system: ${(systemPrompt || '').length} chars`);
      if (this.conversationHistory.length > 0) {
        console.error(`[PROMPT-DIAG] [1..${this.conversationHistory.length}] history: ${this.conversationHistory.length} messages, ${this.conversationHistory.reduce((s, m) => s + (m.content?.length || 0), 0)} chars total`);
      }
      console.error(`[PROMPT-DIAG] [${messages.length - 1}] user: ${message.length} chars`);
      console.error(`[PROMPT-DIAG] total: ${messages.length} messages, tools: ${tools?.length || 0}`);

      if (this.logger) {
        this.logger.info('pi-agent', 'API request prepared', {
          model: this.config.model,
          messageCount: messages.length,
          toolsCount: tools?.length || 0,
          recoveryMode: this.recoveryMode,
        });
      }

      // Debug: print tool names to stderr for troubleshooting
      console.error('[PI-AGENT-DEBUG] Tools for API call:', tools?.map((t: any) => t.function?.name) || 'none');
      console.error('[PI-AGENT-DEBUG] Calling LLM API now...');

      // 如果当前在 fallback 且已超过恢复间隔，尝试切回主 provider
      if (tryRecoverPrimary()) {
        const primaryConfig = loadLLMConfig();
        this.config = { ...this.config, model: primaryConfig.model, baseURL: primaryConfig.baseURL, apiKey: primaryConfig.apiKey };
        this.openaiClient = new OpenAI({ apiKey: this.config.apiKey, baseURL: this.config.baseURL, timeout: 120000 });
        console.log(`[PI-AGENT-DEBUG] Trying primary provider: model=${this.config.model} baseURL=${this.config.baseURL}`);
      }

      // 调用OpenAI API
      const completionParams: OpenAI.Chat.ChatCompletionCreateParams = {
        model: this.config.model,
        messages: messages,
        temperature: this.config.temperature,
        max_tokens: this.config.maxTokens
      };

      // 如果有工具定义，添加到请求中
      if (tools && tools.length > 0) {
        completionParams.tools = tools;
        completionParams.tool_choice = 'auto';
      }

      console.error('[PI-AGENT-DEBUG] API request params:', {
        model: completionParams.model,
        messageCount: completionParams.messages?.length,
        toolCount: completionParams.tools?.length,
        maxTokens: completionParams.max_tokens,
        baseURL: this.config.baseURL,
      });
      const apiStartTime = Date.now();

      let completion = await this.openaiClient.chat.completions.create(completionParams).catch(async (err: any) => {
        const elapsed = Date.now() - apiStartTime;
        console.error(`[PI-AGENT-DEBUG] OpenAI API call error after ${elapsed}ms:`, err?.message || err);
        console.error(`[PI-AGENT-DEBUG] Error details:`, { status: err?.status, code: err?.code, type: err?.type });
        if (this.logger) {
          this.logger.error('pi-agent', 'OpenAI API call threw', { error: err?.message || String(err), elapsed });
        }
        // 尝试 fallback
        if (isProviderUnavailableError(err) && !isUsingFallback() && this.reinitializeWithFallback()) {
          completionParams.model = this.config.model;
          return this.openaiClient!.chat.completions.create(completionParams);
        }
        throw err;
      });

      const apiElapsed = Date.now() - apiStartTime;
      console.error(`[PI-AGENT-DEBUG] API response received in ${apiElapsed}ms, finish_reason: ${completion.choices[0]?.finish_reason}`);

      // 提取响应内容
      const choice = completion.choices[0];
      const responseMessage = choice?.message;
      
      // 检查是否是 function calling
      if (choice?.finish_reason === 'tool_calls' && responseMessage?.tool_calls) {
        console.error('[PI-AGENT-DEBUG] === ENTERED TOOL CALLING BRANCH ===', {
          toolCount: responseMessage.tool_calls.length,
          tools: responseMessage.tool_calls.map((tc: any) => tc.function.name)
        });

        if (this.logger) {
          this.logger.info('pi-agent', '=== ENTERED TOOL CALLING BRANCH ===', {
            toolCount: responseMessage.tool_calls.length,
            tools: responseMessage.tool_calls.map((tc: any) => tc.function.name)
          });
        }

        // 执行工具调用
        const toolResults = await this.executeToolCalls(responseMessage.tool_calls);

        // 将工具调用和结果添加到消息历史
        messages.push({
          role: 'assistant',
          content: null,
          tool_calls: responseMessage.tool_calls
        });

        // 添加工具结果
        for (const toolResult of toolResults) {
          messages.push({
            role: 'tool',
            tool_call_id: toolResult.tool_call_id,
            content: toolResult.content
          });
        }

        // 循环处理工具调用，直到 LLM 不再请求工具调用
        const maxToolCallIterations = 30; // 最多允许 30 次工具调用循环（支持 competitive-intel 等多任务 skill：美团3个+携程5个任务，每个任务含导航步骤）
        if (this.shouldStopToolLoop) {
          return this.mutationToolStopReply || 'smart-price-adjust 已执行成功，已停止后续工具调用。';
        }

        let currentIteration = 0;
        let currentMessages = [...messages];
        let finalContent: string | null = null;
        let finalFinishReason: string | null = null;

        // 强制进入循环，确保持久化检查能执行
        while (currentIteration < maxToolCallIterations) {
          currentIteration++;

          console.error(`[PI-AGENT-DEBUG] === LOOP ITERATION ${currentIteration} START ===`, {
            needsPersistenceSkill: this.needsPersistenceSkill,
            hasCalledPersistence: this.hasCalledPersistence
          });

          if (this.logger) {
            this.logger.info('pi-agent', `=== LOOP ITERATION ${currentIteration} START ===`, {
              needsPersistenceSkill: this.needsPersistenceSkill,
              hasCalledPersistence: this.hasCalledPersistence
            });
          }

          const nextParams: OpenAI.Chat.ChatCompletionCreateParams = {
            model: this.config.model,
            messages: currentMessages,
            temperature: this.config.temperature,
            max_tokens: this.config.maxTokens
          };

          // 每次迭代重新构建 tools，确保中途通过 file-operations 创建的新 skill 能出现在工具列表中
          const currentTools = this.buildToolDefinitions();

          // 始终带上 tools，让模型知道可以继续调用或输出文本
          if (currentTools && currentTools.length > 0) {
            nextParams.tools = currentTools;
            nextParams.tool_choice = 'auto';
          }

          console.error(`[PI-AGENT-DEBUG] Loop iteration ${currentIteration}: calling API...`);
          const loopApiStart = Date.now();

          const completion = await this.openaiClient.chat.completions.create(nextParams).catch(async (err: any) => {
            const elapsed = Date.now() - loopApiStart;
            console.error(`[PI-AGENT-DEBUG] Loop iteration ${currentIteration} API error after ${elapsed}ms:`, err?.message || err);
            console.error(`[PI-AGENT-DEBUG] Error details:`, { status: err?.status, code: err?.code, type: err?.type });
            if (this.logger) {
              this.logger.error('pi-agent', `Loop API call failed (iteration ${currentIteration})`, { error: err?.message || String(err), elapsed });
            }
            // 尝试 fallback
            if (isProviderUnavailableError(err) && !isUsingFallback() && this.reinitializeWithFallback()) {
              nextParams.model = this.config.model;
              return this.openaiClient!.chat.completions.create(nextParams);
            }
            throw err;
          });

          const loopElapsed = Date.now() - loopApiStart;
          console.error(`[PI-AGENT-DEBUG] Loop iteration ${currentIteration}: API responded in ${loopElapsed}ms, finish_reason: ${completion.choices[0]?.finish_reason}`);

          const choice = completion.choices[0];
          const responseMessage = choice?.message;
          const finishReason = choice?.finish_reason as string;

          // 如果 LLM 请求工具调用
          if (finishReason === 'tool_calls' && responseMessage?.tool_calls) {
            if (this.logger) {
              this.logger.info('pi-agent', `LLM requested additional tool calls (iteration ${currentIteration})`, {
                toolCount: responseMessage.tool_calls.length,
                tools: responseMessage.tool_calls.map((tc: any) => tc.function.name)
              });
            }

            // 执行工具调用
            const toolResults = await this.executeToolCalls(responseMessage.tool_calls);

            // 将工具调用和结果添加到消息历史
            currentMessages.push({
              role: 'assistant',
              content: null,
              tool_calls: responseMessage.tool_calls
            });

            // 添加工具结果
            for (const toolResult of toolResults) {
              currentMessages.push({
                role: 'tool',
                tool_call_id: toolResult.tool_call_id,
                content: toolResult.content
              });
            }

            // 继续下一次循环
            if (this.shouldStopToolLoop) {
              return this.mutationToolStopReply || 'smart-price-adjust 已执行成功，已停止后续工具调用。';
            }

            continue;
          }

          // 如果是 MALFORMED_FUNCTION_CALL，从 currentMessages 提取工具结果，不带 tools 重新请求总结
          if (finishReason === 'MALFORMED_FUNCTION_CALL') {
            if (this.logger) {
              this.logger.warn('pi-agent', 'LLM returned MALFORMED_FUNCTION_CALL, retrying without tools for summarization');
            }

            // 从 currentMessages 收集所有 tool role 的内容
            const toolContents: string[] = [];
            for (const msg of currentMessages) {
              if (msg.role === 'tool') {
                toolContents.push((msg as any).content || '');
              }
            }

            // 构建纯文本请求，要求模型基于工具结果给出自然语言总结
            const summaryMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
              ...currentMessages,
              {
                role: 'user',
                content: '请根据以上工具返回的数据，用自然语言给出详细的总结和回答，不要调用任何工具。'
              }
            ];

            try {
              const summaryCompletion = await this.openaiClient!.chat.completions.create({
                model: this.config.model,
                messages: summaryMessages,
                temperature: this.config.temperature,
                max_tokens: this.config.maxTokens
                // 故意不传 tools，强制模型输出文本
              });

              const summaryContent = summaryCompletion.choices[0]?.message?.content;
              if (summaryContent) {
                if (this.logger) {
                  this.logger.info('pi-agent', 'Summarization fallback succeeded', { contentLength: summaryContent.length });
                }
                return summaryContent;
              }
            } catch (summaryError) {
              if (this.logger) {
                this.logger.error('pi-agent', 'Summarization fallback failed', {
                  error: summaryError instanceof Error ? summaryError.message : String(summaryError)
                });
              }
            }

            return '抱歉，处理您的请求时遇到了问题。请重试或换一种方式提问。';
          }

          // 检查是否有内容
          finalContent = responseMessage?.content;
          finalFinishReason = finishReason;

          console.error('[PI-AGENT-DEBUG] Loop exit point check', {
            needsPersistenceSkill: this.needsPersistenceSkill,
            hasCalledPersistence: this.hasCalledPersistence,
            hasContent: !!finalContent,
            finishReason
          });

          if (this.logger) {
            this.logger.info('pi-agent', 'Loop exit point check', {
              needsPersistenceSkill: this.needsPersistenceSkill,
              hasCalledPersistence: this.hasCalledPersistence,
              hasContent: !!finalContent,
              finishReason
            });
          }

          if (!finalContent) {
            if (this.logger) {
              this.logger.warn('pi-agent', 'No content in response', { finishReason, iteration: currentIteration });
            }
            // content_filter: 模型安全过滤器拦截了响应，返回友好提示而非崩溃
            if (finishReason === 'content_filter') {
              if (this.logger) {
                this.logger.warn('pi-agent', 'Response blocked by content filter, returning fallback message');
              }
              return '抱歉，模型的安全过滤器拦截了本次响应。请换一种方式提问，或稍后重试。';
            }
            // finish_reason: length — 回复被 max_tokens 截断
            // 向 LLM 追加 "请继续" 让它完成被截断的回复，而不是直接报错
            if (finishReason === 'length' && currentIteration < maxToolCallIterations) {
              if (this.logger) {
                this.logger.warn('pi-agent', `Response truncated (finish_reason: length), asking LLM to continue (iteration ${currentIteration})`);
              }
              // 把已有的 partial content 加入历史（如果有）
              if (responseMessage?.content) {
                currentMessages.push({ role: 'assistant', content: responseMessage.content });
              }
              currentMessages.push({ role: 'user', content: '你的回复被截断了，请继续完成之前的操作。' });
              continue;
            }
            // finish_reason: stop 但无内容 — Recovery 模式下 LLM 可能在工具调用后
            // 误以为任务完成就返回了空 stop，需要提醒它继续完成验证和入库步骤
            if (finishReason === 'stop' && this.recoveryMode && currentIteration < maxToolCallIterations) {
              if (this.logger) {
                this.logger.warn('pi-agent', `Empty stop in recovery mode, nudging LLM to continue (iteration ${currentIteration})`);
              }
              currentMessages.push({
                role: 'user',
                content: '你还没有完成所有步骤。请继续：1) 如果还没写 skills/目录下的 SKILL.md，请用 file-operations 写入；2) 执行脚本验证（调用 api skill）；3) 调用 data-store 入库。禁止跳过任何步骤。'
              });
              continue;
            }
            // 如果没有内容但不是工具调用，抛出错误
            throw new Error(`No content in API response (finish_reason: ${finishReason})`);
          }

          // 持久化检查已移至策略 SKILL 的工作流步骤中，由 Agent 自主执行
          // API-First 模式下，Agent 需要多轮工具调用（API发现→写脚本→调API→持久化），
          // 强制注入会打断中间步骤，因此不再在此处强制注入持久化指令

          // 成功获取内容，退出循环
          break;
        }

        // 检查是否达到最大迭代次数
        if (currentIteration >= maxToolCallIterations && !finalContent) {
          if (this.logger) {
            this.logger.warn('pi-agent', 'Max tool call iterations reached');
          }
          throw new Error('Too many tool call iterations');
        }

        if (this.logger) {
          this.logger.debug('pi-agent', 'Final OpenAI API response received', {
            contentLength: finalContent?.length || 0,
            finishReason: finalFinishReason,
            iterations: currentIteration
          });
        }

        return finalContent!;
      }
      
      const content = responseMessage?.content;
      
      if (!content) {
        throw new Error('No content in API response');
      }

      if (this.logger) {
        this.logger.debug('pi-agent', 'OpenAI API response received', {
          contentLength: content.length,
          finishReason: completion.choices[0]?.finish_reason,
          usage: completion.usage
        });
      }

      return content;
    } catch (error) {
      if (this.logger) {
        this.logger.error('pi-agent', 'OpenAI API call failed', {
          error: error instanceof Error ? error.message : String(error)
        });
      }
      throw error;
    }
  }

  /**
   * 流式调用 OpenAI API
   * 直接发起流式请求。如果是简单文本回复，逐 chunk 推送给前端。
   * 如果 LLM 返回 tool_calls，放弃流式，fallback 到已验证的 callOpenAIAPI。
   */
  async streamCallOpenAIAPI(message: string, onChunk: (chunk: string) => void): Promise<string> {
    if (!this.openaiClient) {
      throw new Error('OpenAI client not initialized');
    }

    this.needsPersistenceSkill = false;
    this.hasCalledPersistence = false;
    this.priceAdjustLoginBlock = null;

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    const systemPrompt = this.buildSystemPrompt();
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    this.conversationHistory.forEach(msg => {
      messages.push({ role: msg.role as 'user' | 'assistant' | 'system', content: msg.content });
    });
    messages.push({ role: 'user', content: message });

    const tools = this.buildToolDefinitions();

    // 如果当前在 fallback 且已超过恢复间隔，尝试切回主 provider
    if (tryRecoverPrimary()) {
      const primaryConfig = loadLLMConfig();
      this.config = { ...this.config, model: primaryConfig.model, baseURL: primaryConfig.baseURL, apiKey: primaryConfig.apiKey };
      this.openaiClient = new OpenAI({ apiKey: this.config.apiKey, baseURL: this.config.baseURL, timeout: 120000 });
      console.log(`[PI-AGENT-DEBUG] Trying primary provider: model=${this.config.model} baseURL=${this.config.baseURL}`);
    }

    const streamParams: any = {
      model: this.config.model,
      messages,
      temperature: this.config.temperature,
      max_tokens: this.config.maxTokens,
      stream: true,
    };
    if (tools && tools.length > 0) {
      streamParams.tools = tools;
      streamParams.tool_choice = 'auto';
    }

    const stream = await this.openaiClient.chat.completions.create(streamParams).catch(async (err: any) => {
      console.error(`[PI-AGENT-DEBUG] Stream API call error:`, err?.message || err);
      // 主模型报错，立即切换到备用模型重试
      if (!isUsingFallback() && this.reinitializeWithFallback()) {
        console.error(`[PI-AGENT-DEBUG] Switched to fallback for stream, retrying with model=${this.config.model} baseURL=${this.config.baseURL}`);
        streamParams.model = this.config.model;
        return this.openaiClient!.chat.completions.create(streamParams);
      }
      throw err;
    });

    let fullText = '';
    let hasToolCalls = false;

    for await (const chunk of stream as any) {
      const delta = chunk.choices?.[0]?.delta;
      if (!delta) continue;

      // 检测到 tool_calls → 放弃流式，fallback 到非流式
      if (delta.tool_calls) {
        hasToolCalls = true;
        break;
      }

      if (delta.content) {
        fullText += delta.content;
        onChunk(delta.content);
      }
    }

    if (hasToolCalls) {
      // tool calling 场景：fallback 到已验证的非流式 callOpenAIAPI
      // 重置标志（callOpenAIAPI 内部会重新设置）
      this.needsPersistenceSkill = false;
      this.hasCalledPersistence = false;
      this.priceAdjustLoginBlock = null;
      const result = await this.callOpenAIAPI(message);
      onChunk(result);
      return result;
    }

    return fullText;
  }

  /**
   * 构建工具定义（从技能生成）
   */
  /**
   * 从API返回数据中提取一份结构完整的样本，保留完整嵌套深度但限制数量。
   * - depth 0-1: 数组保留前2条
   * - depth 2+: 数组只保留第1条
   * - 字符串截断到80字符
   * - 最终JSON超过3000字符时，自动降级为更紧凑的模式
   */
  private sampleApiData(data: any, depth: number = 0): any {
    if (data === null || data === undefined) return data;
    if (typeof data === 'string') {
      return data.length > 80 ? data.substring(0, 80) + `...(${data.length}chars)` : data;
    }
    if (typeof data === 'number' || typeof data === 'boolean') return data;
    if (Array.isArray(data)) {
      if (data.length === 0) return [];
      const keepCount = depth <= 1 ? 2 : 1;
      const sampled = data.slice(0, keepCount).map(item => this.sampleApiData(item, depth + 1));
      if (data.length > keepCount) {
        sampled.push(`...(共${data.length}条)`);
      }
      return sampled;
    }
    if (typeof data === 'object') {
      const result: Record<string, any> = {};
      const keys = Object.keys(data);
      // 深层对象key太多时只保留前10个
      const keepKeys = depth >= 3 ? keys.slice(0, 10) : keys;
      for (const key of keepKeys) {
        result[key] = this.sampleApiData(data[key], depth + 1);
      }
      if (keys.length > keepKeys.length) {
        result['...'] = `(还有${keys.length - keepKeys.length}个字段)`;
      }
      return result;
    }
    return data;
  }

  /**
   * 生成API数据样本，确保不超过字符上限。
   */
  private generateApiSample(data: any): string {
    const MAX_LEN = 3000;
    const sample = this.sampleApiData(data, 0);
    const json = JSON.stringify(sample, null, 2);

    if (json.length <= MAX_LEN) {
      return json;
    }

    // 超限时直接截断，Agent只需要看到足够的结构来判断数据是否匹配
    return json.substring(0, MAX_LEN) + '\n...(样本已截断，完整数据已保存)';
  }

  /**
   * 更紧凑的采样：数组只保留1条，字符串截断到40，对象只保留前5个key，最大深度3层
   */
  private compactSample(data: any, depth: number): any {
    if (data === null || data === undefined) return data;
    if (typeof data === 'string') {
      return data.length > 40 ? data.substring(0, 40) + '...' : data;
    }
    if (typeof data === 'number' || typeof data === 'boolean') return data;
    if (depth >= 3) {
      if (Array.isArray(data)) return `[Array(${data.length})]`;
      if (typeof data === 'object') return `{${Object.keys(data).slice(0, 5).join(', ')}${Object.keys(data).length > 5 ? ', ...' : ''}}`;
    }
    if (Array.isArray(data)) {
      if (data.length === 0) return [];
      return [this.compactSample(data[0], depth + 1), `...(共${data.length}条)`];
    }
    if (typeof data === 'object') {
      const result: Record<string, any> = {};
      const keys = Object.keys(data).slice(0, depth >= 2 ? 5 : 8);
      for (const key of keys) {
        result[key] = this.compactSample(data[key], depth + 1);
      }
      const total = Object.keys(data).length;
      if (total > keys.length) {
        result['...'] = `(还有${total - keys.length}个字段)`;
      }
      return result;
    }
    return data;
  }

  private buildToolDefinitions(): OpenAI.Chat.ChatCompletionTool[] | undefined {
    if (!this.skillManager) {
      return undefined;
    }

    let skills = this.skillManager.getEnabledSkills();
    // 按白名单过滤（Recovery Agent 等场景只暴露必要的 skill）
    if (this.skillAllowList) {
      skills = skills.filter(s => this.skillAllowList!.has(s.metadata.name));
    }
    if (skills.length === 0) {
      return undefined;
    }
    
    const tools: OpenAI.Chat.ChatCompletionTool[] = [];
    
    // Recovery 模式不需要 load_skill：recovery prompt 已包含完整修复指令，
    // load_skill 只会浪费迭代次数并膨胀上下文（每次返回完整 SKILL.md 内容）
    if (!this.recoveryMode) {
      // 添加 load_skill 工具，用于动态加载skill的完整内容
      tools.push({
        type: 'function',
        function: {
          name: 'load_skill',
          description: 'Load the full content and instructions of a skill. Call this before using a skill to get detailed guidance on how to use it.',
          parameters: {
            type: 'object',
            properties: {
              skill_name: {
                type: 'string',
                description: 'The name of the skill to load',
                enum: skills.map(s => s.metadata.name)
              }
            },
            required: ['skill_name']
          }
        }
      });
    }

    // 调价前置登录检测工具：Agent 传入要调价的平台列表，一次性检测
    if (!this.recoveryMode) {
      tools.push({
        type: 'function',
        function: {
          name: 'check_platform_logins',
          description: '检测指定 OTA 平台的登录状态（系统已自动在调价前预检，通常不需要手动调用）。传入平台代码列表，返回每个平台的登录状态。',
          parameters: {
            type: 'object',
            properties: {
              platforms: {
                type: 'array',
                items: { type: 'string', enum: ['ctrip', 'meituan', 'trip', 'booking'] },
                description: '要检测的平台代码列表'
              }
            },
            required: ['platforms']
          }
        }
      });
    }

    for (const skill of skills) {
      // 从skill.md的parameters字段构建参数schema
      // metadata可能包含额外的字段（如parameters），使用any类型访问
      const metadata = skill.metadata as any;
      const rawParameters = metadata.parameters || {};
      
      // 转换参数格式：从 skill.md 格式转换为 OpenAI JSON Schema 格式
      const properties: Record<string, any> = {};
      const required: string[] = [];
      
      for (const [paramName, paramDef] of Object.entries(rawParameters)) {
        const def = paramDef as any;
        
        // 提取 required 字段并添加到 required 数组
        if (def.required === true) {
          required.push(paramName);
        }
        
        // 构建属性定义（移除 required 和 default 字段，OpenAI JSON Schema 不支持）
        const { required: _, default: _default, ...propertyDef } = def;
        properties[paramName] = propertyDef;
      }
      
      tools.push({
        type: 'function',
        function: {
          name: skill.metadata.name,
          description: skill.metadata.description,
          parameters: {
            type: 'object',
            properties: properties,
            required: required
          }
        }
      });
    }
    
    return tools;
  }

  /**
   * 执行工具调用
   */
  private async executeToolCalls(toolCalls: any[]): Promise<Array<{tool_call_id: string, content: string}>> {
    const results: Array<{tool_call_id: string, content: string}> = [];

    // 当 load_skill 与其他工具同批调用时，只执行 load_skill，其他的跳过。
    // 强制 LLM 先读完 SKILL 内容再决定调什么工具。
    const hasLoadSkill = toolCalls.some(tc => tc.function.name === 'load_skill');
    if (hasLoadSkill && toolCalls.length > 1) {
      console.error(`[PI-AGENT-DEBUG] load_skill detected with ${toolCalls.length - 1} other tool(s), skipping non-load_skill calls`);
      const skippedCalls = toolCalls.filter(tc => tc.function.name !== 'load_skill');
      for (const skipped of skippedCalls) {
        results.push({
          tool_call_id: skipped.id,
          content: JSON.stringify({ skipped: true, reason: '请先阅读 load_skill 返回的 SKILL 内容，再根据内容决定调用什么工具' })
        });
      }
      toolCalls = toolCalls.filter(tc => tc.function.name === 'load_skill');
    }

    // ── 登录检测层：批量预检本轮所有 smart-price-adjust 涉及的平台 ──
    // 如果之前轮次已检测到未登录，直接复用（跨轮次拦截）
    if (!this.priceAdjustLoginBlock && this.skillManager) {
      const priceAdjustCalls = toolCalls.filter(tc => {
        const name = tc.function.name;
        return name === 'smart-price-adjust' || name === 'smart_price_adjust';
      });
      if (priceAdjustCalls.length > 0) {
        const platforms = priceAdjustCalls
          .map(tc => { try { return JSON.parse(tc.function.arguments || '{}').platformCode; } catch { return null; } })
          .filter((c): c is string => !!c);
        if (platforms.length > 0) {
          const loginResult = await this.skillManager.checkPlatformLogins(platforms);
          if (!loginResult.allLoggedIn) {
            this.priceAdjustLoginBlock = { notLoggedIn: loginResult.notLoggedIn };
            console.error(`[PI-AGENT-DEBUG] Login pre-check BLOCKED all price adjust: ${loginResult.notLoggedIn.join(', ')}`);
          }
        }
      }
    }

    for (const toolCall of toolCalls) {
      if (this.shouldStopToolLoop) break;
      // Normalize tool name: some models (e.g. Gemini) convert hyphens to underscores
      const rawToolName = toolCall.function.name;
      const toolName = rawToolName.includes('_') && !rawToolName.startsWith('load_') && !rawToolName.startsWith('check_')
        ? rawToolName.replace(/_/g, '-')
        : rawToolName;
      if (toolName !== rawToolName) {
        console.error(`[PI-AGENT-DEBUG] Tool name normalized: ${rawToolName} → ${toolName}`);
      }
      const toolCallId = toolCall.id;
      
      try {
        // 解析参数
        const args = JSON.parse(toolCall.function.arguments || '{}');
        console.error(`[PI-AGENT-DEBUG] Executing tool: ${toolName}`, JSON.stringify(args).substring(0, 200));
        if (this.logger) {
          this.logger.info('pi-agent', `Executing tool: ${toolName}`, { args });
        }
        
        // 特殊处理：load_skill 工具
        if (toolName === 'load_skill') {
          const skillName = args.skill_name;
          console.error(`[PI-AGENT-DEBUG] load_skill called: ${skillName}`);

          if (!this.skillManager) {
            throw new Error('SkillManager not available');
          }

          const skill = this.skillManager.getSkill(skillName);
          if (!skill) {
            throw new Error(`Skill not found: ${skillName}`);
          }

          // 检查是否是需要持久化的策略skill（调试阶段暂时清空，不强制持久化）
          const needsPersistenceSkills: string[] = [];
          if (needsPersistenceSkills.includes(skillName)) {
            this.needsPersistenceSkill = true;
            console.error(`[PI-AGENT-DEBUG] Loaded persistence-required skill: ${skillName}`);
            if (this.logger) {
              this.logger.info('pi-agent', `Loaded persistence-required skill: ${skillName}`);
            }
          }

          // 返回skill的完整内容
          const skillContent = {
            name: skill.metadata.name,
            type: skill.metadata.type || 'tool',
            description: skill.metadata.description,
            content: skill.content
          };
          
          results.push({
            tool_call_id: toolCallId,
            content: JSON.stringify(skillContent)
          });
          
          if (this.logger) {
            this.logger.info('pi-agent', `Skill loaded: ${skillName}`, {
              type: skill.metadata.type,
              contentLength: skill.content.length
            });
          }
          
          continue;
        }

        // 特殊处理：check_platform_logins 登录检测层
        if (toolName === 'check_platform_logins') {
          if (!this.skillManager) {
            throw new Error('SkillManager not available');
          }
          const platforms: string[] = args.platforms || [];
          const loginResult = await this.skillManager.checkPlatformLogins(platforms);
          results.push({
            tool_call_id: toolCallId,
            content: JSON.stringify(loginResult)
          });
          continue;
        }

        // ── 登录检测层：引用批量预检结果，拦截所有 smart-price-adjust ──
        if (toolName === 'smart-price-adjust' && this.priceAdjustLoginBlock) {
          console.error(`[PI-AGENT-DEBUG] Login check BLOCKED price adjust (${args.platformCode}): ${this.priceAdjustLoginBlock.notLoggedIn.join(', ')}`);
          results.push({
            tool_call_id: toolCallId,
            content: JSON.stringify({
              success: false,
              code: 'OTA_LOGIN_REQUIRED',
              notLoggedIn: this.priceAdjustLoginBlock.notLoggedIn,
              error: `以下平台未登录：${this.priceAdjustLoginBlock.notLoggedIn.join('、')}，所有平台调价已取消，请先在浏览器中登录后再执行调价操作`
            })
          });
          continue;
        }

        // ── 登录检测层：API skill 前置登录检测 ──
        const API_SKILL_PLATFORM: Record<string, string> = {
          'api-ctrip-public-price': 'ctrip',
          'api-ctrip-backend-price': 'ctrip',
          'api-ctrip-hotel-search': 'ctrip',
          'api-meituan-backend-price': 'meituan',
          'api-meituan-realtime-status': 'meituan',
          'api-trip-public-price': 'trip',
          'api-booking-backend-price': 'booking',
        };

        // 执行技能
        if (!this.skillManager) {
          throw new Error('SkillManager not available');
        }

        // 注入进度回调：通过 IPC 向渲染进程推送实时进度
        const onProgress = (event: any) => {
          try {
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
              this.mainWindow.webContents.send(IPC_CHANNELS.SKILL_PROGRESS, event);
            }
          } catch (e) {
            // 忽略发送失败（窗口可能已关闭）
          }
        };

        const mergedArgs = { ...this.defaultSkillParams, ...args };
        // 心跳任务强制注入：background 和 sessionId 不允许被 LLM 覆盖（安全隔离）
        if (this.defaultSkillParams.background !== undefined) {
          mergedArgs.background = this.defaultSkillParams.background;
        }
        // start_url：Agent 显式传入的优先（如后台 ebooking.ctrip.com），
        // 仅当 Agent 未传时才使用 defaultSkillParams 的兜底值
        if (args.start_url) {
          mergedArgs.start_url = args.start_url;
        }
        // sessionId 也强制注入，确保并发隔离
        if (this.defaultSkillParams.sessionId !== undefined) {
          mergedArgs.sessionId = this.defaultSkillParams.sessionId;
        }

        // DEBUG: 打印合并后的参数，排查 background 模式是否生效
        if (toolName === 'ai-web-crawler') {
          const op = mergedArgs.operation || args.operation;

          // ── 对话模式下禁止 fetch_data（导航+拦截 API）──
          // 对话中 API 失败 90% 是浏览器未登录导致的 Cookie 过期，
          // 调爬虫导航不仅解决不了问题，还会操控用户正在看的页面，体验极差。
          // 只有 recovery 模式（心跳自动修复）才允许 fetch_data。
          // extract_current（提取当前页面内容，评价回复等场景）不受影响。
          if (op === 'fetch_data' && !this.recoveryMode) {
            console.error(`[PI-AGENT-DEBUG] BLOCKED fetch_data in chat mode, returning login hint`);
            if (this.logger) {
              this.logger.info('pi-agent', 'Blocked fetch_data in chat mode, returning login guidance');
            }
            results.push({
              tool_call_id: toolCallId,
              content: JSON.stringify({
                success: false,
                blocked: true,
                reason: '对话模式下不允许执行导航操作。数据获取失败通常是因为浏览器未登录对应平台。请引导用户在左侧浏览器中登录对应的 OTA 平台后重试，不要尝试通过爬虫修复。',
              })
            });
            continue;
          }

          // extract_current / list_tabs 在用户对话模式下需要访问前台页面，不使用后台模式
          // recovery 模式（心跳）下仍然强制后台模式
          if ((op === 'extract_current' || op === 'list_tabs') && !this.recoveryMode) {
            mergedArgs.background = false;  // 显式 false，爬虫默认 true
          } else {
            mergedArgs.background = true;
          }
          console.error(`[PI-AGENT-DEBUG] ai-web-crawler mergedArgs:`, JSON.stringify(mergedArgs));
        }

        // 静默模式下的特殊处理
        if (mergedArgs.background && toolName === 'ai-web-crawler') {
          const op = mergedArgs.operation || args.operation;

          // 拦截无意义的 list_tabs / switch_tab 操作
          if (op === 'list_tabs' || op === 'switch_tab') {
            results.push({
              tool_call_id: toolCallId,
              content: JSON.stringify({
                success: false,
                error: '当前为静默后台模式，不支持 list_tabs / switch_tab。请直接使用 operation="fetch_data" 配合 target 和 extraction_goal 执行爬取。'
              })
            });
            continue;
          }

          // fetch_data 时自动清除 tab_keyword — 静默模式下 connectBackground 已连接到目标页面，tab_keyword 无意义
          if (op === 'fetch_data') {
            delete mergedArgs.tab_keyword;
            delete mergedArgs.tabKeyword;

            // 自动从 cookieDomain 或 target 推断 start_url
            if (!mergedArgs.start_url) {
              // 优先从 target 中提取完整 URL
              const target = String(mergedArgs.target || '');
              if (target.startsWith('http://') || target.startsWith('https://')) {
                mergedArgs.start_url = target;
              } else {
                // 从 cookieDomain 硬编码映射 start_url
                const domain = mergedArgs.cookieDomain || '';
                const DOMAIN_START_URL: Record<string, string> = {
                  'hotels.ctrip.com':   'https://hotels.ctrip.com/',
                  'ebooking.ctrip.com': 'https://ebooking.ctrip.com/',
                  'me.meituan.com':     'https://me.meituan.com/',
                  'www.trip.com':       'https://www.trip.com/',
                  'us.trip.com':        'https://us.trip.com/',
                  'www.booking.com':    'https://www.booking.com/',
                };
                if (DOMAIN_START_URL[domain]) {
                  mergedArgs.start_url = DOMAIN_START_URL[domain];
                }
              }

              // 最后兜底：从 defaultSkillParams 中继承 start_url（recovery 模式下由 heartbeat-manager 注入）
              if (!mergedArgs.start_url && this.defaultSkillParams.start_url) {
                mergedArgs.start_url = this.defaultSkillParams.start_url;
              }
            }
          }
        }

        if (this.isMutationTool(toolName)) {
          const mutationKey = this.buildMutationToolKey(toolName, mergedArgs);
          if (this.executedMutationToolKeys.has(mutationKey)) {
            console.error(`[PI-AGENT-DEBUG] duplicate mutation blocked: ${toolName}`);
            if (this.logger) {
              this.logger.warn('pi-agent', 'duplicate mutation blocked', { toolName });
            }
            results.push({
              tool_call_id: toolCallId,
              content: JSON.stringify({
                success: false,
                code: 'DUPLICATE_MUTATION_BLOCKED',
                message: '已阻止同一请求内重复执行真实改价'
              })
            });
            continue;
          }
          this.executedMutationToolKeys.add(mutationKey);
        }

        const result = await this.skillManager.executeSkill(toolName, mergedArgs, onProgress);

        // 跟踪 data-persistence 调用
        if (toolName === 'data-persistence') {
          this.hasCalledPersistence = true;
          console.error('[PI-AGENT-DEBUG] data-persistence called with args:', JSON.stringify(args, null, 2));
          console.error('[PI-AGENT-DEBUG] data-persistence executed', {
            success: result.success,
            output: result.output
          });
          if (this.logger) {
            this.logger.info('pi-agent', 'data-persistence executed', {
              success: result.success,
              output: result.output,
              args
            });
          }
        }

        // 格式化结果 — 只提取核心数据，去除导航路径、截图URL等噪音
        let resultContent: string;
        if (result.success) {
          const raw = result.output;

          // 从 CrawlerResult 中提取有效载荷
          // CrawlerResult 结构: { success, data: { data: extracted_data, confidence, strategy }, navigationPath, screenshots, stats }
          let payload: any;
          // smart-price-adjust 结果：精简透传，保留整体状态和必要的分段成败明细
          // 注意 format:text 时 raw 是终端文本，也必须在这里解析，不能交给 LLM 猜结果。
          if (toolName === 'smart-price-adjust') {
            payload = this.buildSmartPriceAdjustToolPayload(raw, result, mergedArgs);
          } else if (raw && typeof raw === 'object') {
            // API脚本结果：api-* skill 返回的数据，直接标记为高可信度
            // 格式: { success: true/false, data: {...} } 或 { success: false, error: {code, message} }
            if (toolName.startsWith('api-') && toolName !== 'ai-web-crawler') {
              if (raw.success === true && raw.data) {
                // Record success — resets consecutive failure count
                getFailureTracker().recordSuccess(toolName);

                // 优先用 adapter 解析标准化数据（比原始 JSON 摘要更准确）
                let adapterData: any = null;
                try {
                  const adapterPath = path.join(getBasePath(), 'scripts', toolName, 'adapter.js');
                  if (fs.existsSync(adapterPath)) {
                    // webpack 打包后 require() 动态路径不工作，用 vm 模块执行 adapter
                    const vm = require('vm');
                    const adapterCode = fs.readFileSync(adapterPath, 'utf-8');
                    const adapterModule = { exports: {} as any };
                    const wrapper = vm.runInNewContext(
                      `(function(module, exports, require) { ${adapterCode} })`,
                      { console, JSON, Object, Array, String, Number, parseInt, parseFloat, Math, Date, RegExp, Error, Map, Set }
                    );
                    wrapper(adapterModule, adapterModule.exports, require);
                    if (typeof adapterModule.exports.adapt === 'function') {
                      const adapted = adapterModule.exports.adapt(raw.data);
                      if (adapted && adapted.data && adapted.data.length > 0) {
                        adapterData = adapted.data;
                      }
                    }
                  }
                } catch (adapterErr) {
                  console.error(`[PI-AGENT-DEBUG] Adapter parse failed for ${toolName}:`, adapterErr instanceof Error ? adapterErr.message : adapterErr);
                }

                let sampleStr: string;
                let recordCount: number;
                if (adapterData) {
                  recordCount = adapterData.length;
                  sampleStr = JSON.stringify(adapterData, null, 2);
                  if (sampleStr.length > 4000) {
                    sampleStr = JSON.stringify(adapterData.slice(0, 20), null, 2) + `\n...(共${adapterData.length}条，已截断)`;
                  }
                  console.error(`[PI-AGENT-DEBUG] API-Script success (adapter parsed): ${toolName}, records: ${recordCount}`);
                } else {
                  sampleStr = this.generateApiSample(raw.data);
                  recordCount = Array.isArray(raw.data)
                    ? raw.data.length
                    : (typeof raw.data === 'string' ? 1 : Object.keys(raw.data).length);
                  console.error(`[PI-AGENT-DEBUG] API-Script success (raw sample): ${toolName}, data keys: ${Object.keys(raw.data).join(',')}`);
                }

                payload = {
                  success: true,
                  source: toolName,
                  record_count: recordCount,
                  data_sample: sampleStr,
                  file: raw.file || null,
                  parsed_by_adapter: !!adapterData,
                };              } else if (raw.success === false) {
                // Record failure and attach error context as reference
                const tracker = getFailureTracker();
                const errorStr = typeof raw.error === 'string' ? raw.error : JSON.stringify(raw.error);
                const isApiFailure = /HTTP\s*(401|403|404|500|502|503)/i.test(errorStr)
                  || /ECONNREFUSED|ETIMEDOUT|ENOTFOUND/i.test(errorStr)
                  || /token.*expired|session.*invalid|unauthorized/i.test(errorStr);

                // Start with the actual execution result — Agent sees this first
                payload = {
                  success: false,
                  error: raw.error,
                  source: toolName,
                };

                // Attach error stack as supplementary reference
                if (isApiFailure) {
                  const isDeprecated = tracker.recordFailure(toolName);
                  const failureCount = tracker.getFailureCount(toolName);
                  const isUnauthorized = /401|403|unauthorized|forbidden/i.test(errorStr);
                  const skillDef = this.skillManager.getSkill?.(toolName);
                  const targetInfo = skillDef ? extractTargetFromSkill(skillDef) : {};

                  payload._errorContext = {
                    type: 'api_failure',
                    failureCount,
                    isDeprecated,
                    loginRequired: isUnauthorized || undefined,
                    rediscoveryHint: (targetInfo.tabKeyword || targetInfo.target) ? {
                      tabKeyword: targetInfo.tabKeyword,
                      target: targetInfo.target,
                    } : undefined,
                  };
                } else {
                  payload._errorContext = { type: 'script_error' };
                }
                console.error(`[PI-AGENT-DEBUG] API-Script failed: ${toolName}, error: ${JSON.stringify(raw.error)}, isApiFailure: ${isApiFailure}`);
              } else {
                payload = { extracted_data: raw, source: toolName };
              }
            }
            // API-First 模式：当 apiCandidates 存在时，只返回 apiCandidates，删掉 extracted_data
            else if (raw.apiCandidates && raw.apiCandidates.length > 0) {
              // 从外部文件加载 API-First 指令，避免硬编码
              let apiFirstInstruction = '';
              try {
                const instructionPath = path.join(getAgentDir(), 'prompts', 'api-first-instruction.md');
                apiFirstInstruction = fs.readFileSync(instructionPath, 'utf-8').trim();
              } catch {
                apiFirstInstruction = '请分析 apiCandidates，选择正确的API，生成脚本并执行验证。禁止调用 data-persistence。';
              }
              payload = {
                apiCandidates: raw.apiCandidates,
                instruction: apiFirstInstruction,
              };
              console.error(`[PI-AGENT-DEBUG] API-First: returning ${raw.apiCandidates.length} apiCandidates, stripped extracted_data`);
            } else if (raw.data && raw.data.data !== undefined) {
              // 标准 CrawlerResult（无 apiCandidates）
              payload = {
                extracted_data: raw.data.data,
                confidence: raw.data.confidence,
                strategy: raw.data.strategy,
                stats: raw.stats,
              };
            } else if (raw.data !== undefined) {
              // list_tabs 等简单结果
              payload = { extracted_data: raw.data, confidence: 1.0 };
            } else {
              payload = { extracted_data: raw };
            }
          } else {
            payload = { extracted_data: raw };
          }

          if (this.logger) {
            this.logger.info('pi-agent', `Tool result payload for ${toolName}`, {
              hasApiCandidates: !!payload.apiCandidates,
              apiCandidatesCount: payload.apiCandidates?.length,
              confidence: payload.confidence,
              strategy: payload.strategy,
              extractedDataType: payload.extracted_data ? (Array.isArray(payload.extracted_data) ? `array[${payload.extracted_data.length}]` : typeof payload.extracted_data) : 'none',
            });
          }

          resultContent = JSON.stringify(payload);
        } else {
          // result.success === false — script-level failure (crash, timeout, etc.)
          if (toolName.startsWith('api-') && toolName !== 'ai-web-crawler') {
            const tracker = getFailureTracker();
            const hasApiPattern = detectAPIFailure(result);

            const errorPayload: any = {
              success: false,
              error: result.error,
              source: toolName,
            };

            if (hasApiPattern) {
              const isDeprecated = tracker.recordFailure(toolName);
              const failureCount = tracker.getFailureCount(toolName);
              const skillDef = this.skillManager.getSkill?.(toolName);
              const targetInfo = skillDef ? extractTargetFromSkill(skillDef) : {};

              errorPayload._errorContext = {
                type: 'api_failure',
                failureCount,
                isDeprecated,
                rediscoveryHint: (targetInfo.tabKeyword || targetInfo.target) ? {
                  tabKeyword: targetInfo.tabKeyword,
                  target: targetInfo.target,
                } : undefined,
              };
            } else {
              errorPayload._errorContext = { type: 'script_crash' };
            }

            resultContent = JSON.stringify(errorPayload);
            console.error(`[PI-AGENT-DEBUG] API-Script crash: ${toolName}, error: ${result.error}`);
          } else {
            resultContent = JSON.stringify({
              success: false,
              error: result.error
            });
          }
        }
        
        results.push({
          tool_call_id: toolCallId,
          content: resultContent
        });

        const mutationOutcome = this.detectMutationToolTerminalOutcome(toolName, resultContent) || this.detectMutationToolTerminalOutcome(toolName, result);
        if (mutationOutcome) {
          this.shouldStopToolLoop = true;
          this.mutationToolStopReply = this.buildMutationToolStopReplyV2(toolName, resultContent);
          console.error(`[PI-AGENT-DEBUG] mutation tool finished, stopping tool loop: ${toolName}, ok=${mutationOutcome.ok}, detectedPath=${mutationOutcome.path}`);
          if (this.logger) {
            this.logger.info('pi-agent', 'mutation tool finished, stopping tool loop', { toolName, ok: mutationOutcome.ok, detectedPath: mutationOutcome.path });
          }
          break;
        }
        
        if (this.logger) {
          this.logger.info('pi-agent', `Tool executed: ${toolName}`, {
            success: result.success,
            executionTime: result.executionTime
          });
        }
      } catch (error) {
        if (this.logger) {
          this.logger.error('pi-agent', `Tool execution failed: ${toolName}`, {
            error: error instanceof Error ? error.message : String(error)
          });
        }
        
        results.push({
          tool_call_id: toolCallId,
          content: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error)
          })
        });
      }
    }
    
    return results;
  }

  /**
   * 调用Google API（占位符）
   */
  private resetMutationToolGuards(): void {
    this.executedMutationToolKeys = new Set();
    this.shouldStopToolLoop = false;
    this.mutationToolStopReply = null;
  }

  private isMutationTool(toolName: string): boolean {
    return toolName === 'smart-price-adjust';
  }

  private buildMutationToolKey(toolName: string, args: Record<string, any>): string {
    return `${toolName}:${JSON.stringify(args || {})}`;
  }

  private buildSmartPriceAdjustToolPayload(raw: any, result?: any, args?: any): any {
    const data = raw && raw.data && typeof raw.data === 'object' ? raw.data : raw;
    if (!data || typeof data !== 'object') {
      const textPayload = this.buildSmartPriceAdjustPayloadFromText(
        [raw, result && result.stdout, result && result.stderr].filter(Boolean).join('\n'),
        args
      );
      if (textPayload) return textPayload;
    }

    const summary = data && data.summary && typeof data.summary === 'object' ? data.summary : {};
    const outcome = this.detectMutationTerminalOutcome(data, 'smart-price-adjust');
    const ok = Boolean(outcome && outcome.ok);
    const successfulSegments = this.extractSmartPriceAdjustSuccessfulSegments(data);
    const failedSegments = this.extractSmartPriceAdjustFailedSegments(data);
    const failure = data && data.failure && typeof data.failure === 'object' ? data.failure : null;

    const payload: any = {
      success: ok,
      ok,
      platformCode: (data && data.platformCode) || '',
      message: (data && data.message) || this.buildSmartPriceAdjustFallbackMessage(data, ok, failedSegments),
      summary
    };

    if (successfulSegments.length > 0) {
      payload.successfulSegments = successfulSegments;
    }

    if (!ok) {
      payload.failureCode = (data && data.failureReasonCode) || (failure && failure.code) || '';
      payload.failedStep = (data && data.failedStep) || (failure && failure.stage) || '';
      payload.failureReason = (data && data.failureReason) || (failure && failure.message) || '';
      if (failedSegments.length > 0) {
        payload.failedSegments = failedSegments;
      }
    }

    return payload;
  }

  private buildSmartPriceAdjustPayloadFromText(text: string, args?: any): any | null {
    if (!text || !/\[(失败|进度)\]/.test(text)) return null;
    const segmentsByIndex = new Map<number, any>();
    let platformCode = args && args.platformCode ? String(args.platformCode) : '';
    let totalSegments = 0;

    for (const line of text.split(/\r?\n/)) {
      const match = line.trim().match(/^\[(进度|失败)\]\s+(\S+)\s+第\s*(\d+)\/(\d+)\s*段：(.+)$/);
      if (!match) continue;
      const status = match[1];
      platformCode = match[2] || platformCode;
      const displayIndex = Number(match[3]);
      totalSegments = Math.max(totalSegments, Number(match[4]) || 0);
      const message = match[5].trim();
      const segment = segmentsByIndex.get(displayIndex) || {
        segmentIndex: displayIndex - 1,
        platformCode,
        startDate: '',
        endDate: '',
        ok: false,
        success: false,
        submitted: false,
        skipped: false,
        roomResults: this.getSmartPriceAdjustInputRooms(args, displayIndex - 1)
      };

      const dateMatch = message.match(/选择日期\s+(\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2})/);
      if (dateMatch) {
        segment.startDate = dateMatch[1];
        segment.endDate = dateMatch[2];
      }

      if (message.includes('提交成功') || message === '完成') {
        segment.ok = true;
        segment.success = true;
        segment.submitted = true;
        segment.failure = null;
        segment.roomResults = segment.roomResults.map((room: any) => ({ ...room, ok: true, failureCode: null, message: null }));
      }

      if (status === '失败') {
        const failureMatch = message.match(/^([a-zA-Z0-9_:-]+)\s*-\s*(.+)$/);
        const stage = failureMatch ? failureMatch[1] : 'unknown';
        const reason = failureMatch ? failureMatch[2] : message;
        segment.ok = false;
        segment.success = false;
        segment.failure = { code: '', stage, message: reason };
        segment.roomResults = segment.roomResults.map((room: any) => ({ ...room, ok: false, failureCode: '', message: reason }));
      }

      segmentsByIndex.set(displayIndex, segment);
    }

    const segmentResults = Array.from(segmentsByIndex.values()).sort((a, b) => a.segmentIndex - b.segmentIndex);
    if (segmentResults.length === 0) return null;
    const successSegments = segmentResults.filter((segment) => segment.ok).length;
    const failedSegments = segmentResults.filter((segment) => !segment.ok && segment.failure).length;
    const submittedSegments = segmentResults.filter((segment) => segment.submitted).length;
    const ok = totalSegments > 0 && successSegments === totalSegments && failedSegments === 0;
    const failure = segmentResults.find((segment) => segment.failure)?.failure || null;
    const normalized: any = {
      ok,
      success: ok,
      platformCode,
      summary: {
        totalSegments: totalSegments || segmentResults.length,
        successSegments,
        failedSegments,
        skippedSegments: Math.max(0, (totalSegments || segmentResults.length) - successSegments - failedSegments),
        submittedSegments,
        stopped: !ok
      },
      segmentResults,
      failure,
      failureReasonCode: failure && failure.code || '',
      failureReason: failure && failure.message || '',
      failedStep: failure && failure.stage || ''
    };
    normalized.message = this.buildSmartPriceAdjustFallbackMessage(normalized, ok, this.extractSmartPriceAdjustFailedSegments(normalized));
    return this.buildSmartPriceAdjustToolPayload(normalized);
  }

  private getSmartPriceAdjustInputRooms(args: any, segmentIndex: number): any[] {
    const segments = args && Array.isArray(args.segments) ? args.segments : [];
    const rooms = segments[segmentIndex] && Array.isArray(segments[segmentIndex].roomList) ? segments[segmentIndex].roomList : [];
    return rooms.map((room: any) => ({
      roomName: room && room.roomName ? String(room.roomName) : '',
      price: room && room.price ? String(room.price) : '',
      ok: false,
      failureCode: '',
      message: ''
    }));
  }

  private buildSmartPriceAdjustFallbackMessage(data: any, ok: boolean, failedSegments: any[]): string {
    const platformCode = data && data.platformCode ? String(data.platformCode) : 'OTA';
    const summary = data && data.summary && typeof data.summary === 'object' ? data.summary : {};
    const totalSegments = Number(summary.totalSegments || 0);
    const successSegments = Number(summary.successSegments || 0);
    const failedCount = failedSegments.length || Number(summary.failedSegments || 0);

    if (ok) {
      return totalSegments > 1 ? `${platformCode} 改价成功，共 ${totalSegments} 个日期段` : `${platformCode} 改价成功`;
    }
    if (successSegments > 0 && failedCount > 0) {
      return `${platformCode} 改价部分成功：成功 ${successSegments} 段，失败 ${failedCount} 段`;
    }
    if (successSegments > 0 || failedCount > 0) {
      return `${platformCode} 改价失败：成功 ${successSegments} 段，失败 ${failedCount} 段`;
    }
    return `${platformCode} 改价失败`;
  }

  private extractSmartPriceAdjustSuccessfulSegments(data: any): any[] {
    const segments = data && Array.isArray(data.segmentResults) ? data.segmentResults : [];
    return segments
      .filter((segment: any) => segment && (segment.ok === true || segment.success === true))
      .map((segment: any) => ({
        segmentIndex: Number.isInteger(segment.segmentIndex) ? segment.segmentIndex : undefined,
        startDate: segment.startDate || '',
        endDate: segment.endDate || '',
        rooms: this.extractSmartPriceAdjustRoomSummaries(segment.roomResults)
      }));
  }

  private extractSmartPriceAdjustFailedSegments(data: any): any[] {
    const segments = data && Array.isArray(data.segmentResults) ? data.segmentResults : [];
    return segments
      .filter((segment: any) => segment && (segment.ok === false || segment.success === false || segment.failure))
      .map((segment: any) => ({
        segmentIndex: Number.isInteger(segment.segmentIndex) ? segment.segmentIndex : undefined,
        startDate: segment.startDate || '',
        endDate: segment.endDate || '',
        failedStep: (segment.failure && segment.failure.stage) || '',
        failureCode: (segment.failure && segment.failure.code) || '',
        failureReason: (segment.failure && segment.failure.message) || '',
        rooms: this.extractSmartPriceAdjustRoomSummaries(segment.roomResults)
      }));
  }

  private extractSmartPriceAdjustRoomSummaries(roomResults: any): any[] {
    if (!Array.isArray(roomResults)) return [];
    return roomResults
      .filter((room: any) => room && (room.roomName || room.price || room.message))
      .map((room: any) => ({
        roomName: room.roomName || '',
        price: room.price || '',
        ok: room.ok,
        message: room.message || ''
      }));
  }

  private detectMutationToolTerminalOutcome(toolName: string, result: any): { path: string; ok: boolean } | null {
    if (!this.isMutationTool(toolName)) return null;
    return this.detectMutationTerminalOutcome(result, 'result');
  }

  private detectMutationTerminalOutcome(value: any, path: string): { path: string; ok: boolean } | null {
    const parsed = this.parseMutationResultValue(value);
    if (!parsed.ok) return null;
    const node = parsed.value;
    const nodePath = parsed.parsed ? `${path}.parsed` : path;
    if (!node || typeof node !== 'object' || Array.isArray(node)) return null;

    if (Object.prototype.hasOwnProperty.call(node, 'output')) {
      const outputOutcome = this.detectMutationTerminalOutcome(node.output, `${nodePath}.output`);
      if (outputOutcome) return outputOutcome;
      if (node.success === false) return { path: `${nodePath}.success`, ok: false };
      return null;
    }

    const dataOutcome = this.detectMutationTerminalOutcome(node.data, `${nodePath}.data`);
    if (dataOutcome) return dataOutcome;

    const flagOutcome = this.detectMutationFlagOutcome(node, nodePath);
    if (flagOutcome) return flagOutcome;

    const summaryOutcome = this.detectMutationSummaryOutcome(node.summary, `${nodePath}.summary`);
    if (summaryOutcome) return summaryOutcome;

    const platformOutcome = this.detectMutationArrayOutcome(node.platformResults, `${nodePath}.platformResults`);
    if (platformOutcome) return platformOutcome;

    return this.detectMutationArrayOutcome(node.segmentResults, `${nodePath}.segmentResults`);
  }

  private parseMutationResultValue(value: any): { ok: boolean; value: any; parsed?: boolean } {
    if (typeof value !== 'string') return { ok: true, value };
    try {
      return { ok: true, value: JSON.parse(value), parsed: true };
    } catch {
      return { ok: false, value: null };
    }
  }

  private detectMutationFlagOutcome(node: any, path: string): { path: string; ok: boolean } | null {
    if (!node || typeof node !== 'object') return null;
    for (const key of ['ok', 'success']) {
      if (node[key] === false) return { path: `${path}.${key}`, ok: false };
      if (node[key] === true) return { path: `${path}.${key}`, ok: true };
    }
    return null;
  }

  private detectMutationSummaryOutcome(summary: any, path: string): { path: string; ok: boolean } | null {
    if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return null;
    const totalSegments = Number(summary.totalSegments || 0);
    const successSegments = Number(summary.successSegments || 0);
    const failedSegments = Number(summary.failedSegments || 0);
    const skippedSegments = Number(summary.skippedSegments || 0);
    if (failedSegments > 0) return { path: `${path}.failedSegments`, ok: false };
    if (skippedSegments > 0) return { path: `${path}.skippedSegments`, ok: false };
    if (summary.stopped === true) return { path: `${path}.stopped`, ok: false };
    if (totalSegments > 0 && successSegments === totalSegments) return { path: `${path}.successSegments`, ok: true };
    return null;
  }

  private detectMutationArrayOutcome(items: any, path: string): { path: string; ok: boolean } | null {
    if (!Array.isArray(items) || items.length === 0) return null;
    let sawSuccess = false;
    let sawUnknown = false;
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      const itemPath = `${path}[${index}]`;
      const parsed = this.parseMutationResultValue(item);
      if (!parsed.ok) {
        sawUnknown = true;
        continue;
      }
      const node = parsed.value && parsed.value.data && typeof parsed.value.data === 'object'
        ? parsed.value.data
        : parsed.value;
      const nodePath = parsed.value && parsed.value.data && typeof parsed.value.data === 'object'
        ? `${itemPath}.data`
        : itemPath;
      const outcome = this.detectMutationTerminalOutcome(node, nodePath);
      if (outcome && !outcome.ok) return outcome;
      if (outcome && outcome.ok) sawSuccess = true;
      if (!outcome) sawUnknown = true;
    }
    if (sawSuccess && !sawUnknown) return { path, ok: true };
    return null;
  }

  private buildMutationToolStopReplyV2(toolName: string, resultContent: string): string {
    let payload: any = {};
    try {
      payload = JSON.parse(resultContent);
    } catch {
      payload = {};
    }
    const summary = payload.summary && typeof payload.summary === 'object' ? payload.summary : {};
    const lines: string[] = [];
    const overview: string[] = [];
    if (payload.platformCode) overview.push(`平台：${payload.platformCode}`);
    if (Number(summary.totalSegments || 0) > 0) overview.push(`总段数：${summary.totalSegments}`);
    if (Number(summary.successSegments || 0) > 0) overview.push(`成功：${summary.successSegments} 段`);
    if (Number(summary.failedSegments || 0) > 0) overview.push(`失败：${summary.failedSegments} 段`);
    if (Number(summary.skippedSegments || 0) > 0) overview.push(`跳过：${summary.skippedSegments} 段`);
    if (Number(summary.submittedSegments || 0) > 0) overview.push(`已提交：${summary.submittedSegments} 段`);
    if (overview.length > 0) lines.push(`执行概况：${overview.join('，')}`);

    const successfulSegments = Array.isArray(payload.successfulSegments) ? payload.successfulSegments : [];
    if (successfulSegments.length > 0) {
      lines.push('已成功：');
      for (const segment of successfulSegments) {
        lines.push(`- ${this.formatSmartPriceAdjustSegmentLine(segment, '成功')}`);
      }
    }

    const failedSegments = Array.isArray(payload.failedSegments) ? payload.failedSegments : [];
    if (failedSegments.length > 0) {
      lines.push('未成功：');
      for (const segment of failedSegments) {
        const reason = segment.failureReason || payload.failureReason || payload.message || 'unknown';
        const step = segment.failedStep || payload.failedStep || 'unknown';
        lines.push(`- ${this.formatSmartPriceAdjustSegmentLine(segment, '失败')}：${step} - ${reason}`);
      }
    }

    if (!payload.ok && !payload.success && payload.failureReason && failedSegments.length === 0) {
      lines.push(`失败原因：${payload.failedStep || 'unknown'} - ${payload.failureReason}`);
    }

    const message = payload.message || (payload.ok || payload.success ? `${toolName} 已执行成功` : `${toolName} 执行失败`);
    return `${message}${lines.length ? `\n\n${lines.join('\n')}` : ''}`;
  }

  private formatSmartPriceAdjustSegmentLine(segment: any, fallbackLabel: string): string {
    const displayIndex = Number.isInteger(segment.segmentIndex) ? segment.segmentIndex + 1 : '';
    const dateText = segment.startDate && segment.endDate ? `${segment.startDate} ~ ${segment.endDate}` : '';
    const prefix = `${fallbackLabel}段${displayIndex ? ` ${displayIndex}` : ''}${dateText ? `（${dateText}）` : ''}`;
    const rooms = this.formatSmartPriceAdjustRooms(segment.rooms);
    return rooms ? `${prefix}：${rooms}` : prefix;
  }

  private formatSmartPriceAdjustRooms(rooms: any): string {
    if (!Array.isArray(rooms) || rooms.length === 0) return '';
    return rooms
      .map((room: any) => {
        const name = room && room.roomName ? String(room.roomName) : '';
        const price = room && room.price ? ` -> ¥${room.price}` : '';
        return `${name}${price}`.trim();
      })
      .filter(Boolean)
      .join('，');
  }

  private buildMutationToolStopReply(toolName: string, resultContent: string): string {
    let payload: any = {};
    try {
      payload = JSON.parse(resultContent);
    } catch {
      payload = {};
    }
    const summary = payload.summary && typeof payload.summary === 'object' ? payload.summary : {};
    const details: string[] = [];
    if (payload.platformCode) details.push(`平台：${payload.platformCode}`);
    if (Number(summary.successSegments || 0) > 0) details.push(`成功段数：${summary.successSegments}`);
    if (Number(summary.submittedSegments || 0) > 0) details.push(`已提交段数：${summary.submittedSegments}`);
    const message = payload.message || `${toolName} 已执行成功`;
    return `${message}\n\n已停止后续工具调用，避免同一请求重复执行真实改价。${details.length ? `\n${details.join('，')}` : ''}`;
  }

  private async callGoogleAPI(message: string): Promise<string> {
    // TODO: 实现Google Gemini API调用
    
    if (this.logger) {
      this.logger.debug('pi-agent', 'Calling Google API (placeholder)');
    }

    return `[Google API 占位符响应] 收到消息: "${message}"`;
  }

  /**
   * 调用Azure API（占位符）
   */
  private async callAzureAPI(message: string): Promise<string> {
    // TODO: 实现Azure OpenAI API调用
    
    if (this.logger) {
      this.logger.debug('pi-agent', 'Calling Azure API (placeholder)');
    }

    return `[Azure API 占位符响应] 收到消息: "${message}"`;
  }

  /**
   * 调用Ollama API（占位符）
   */
  private async callOllamaAPI(message: string): Promise<string> {
    // TODO: 实现Ollama本地API调用
    
    if (this.logger) {
      this.logger.debug('pi-agent', 'Calling Ollama API (placeholder)');
    }

    return `[Ollama API 占位符响应] 收到消息: "${message}"`;
  }

  /**
   * 流式发送消息（真实流式输出）
   */
  async streamMessage(
    message: string,
    onChunk: (chunk: string) => void
  ): Promise<string> {
    if (!this.isInitialized) {
      throw new Error('Pi Agent not initialized');
    }

    try {
      // 和 sendMessage 一致的前置逻辑（非 recovery 模式）
      if (!this.recoveryMode) {
        await this.refreshHotelConfigCache();
        if (!this.chatHistoryLoaded) {
          if (!this.currentSessionId) {
            try {
              const sessions = await databaseManager.getSessions();
              if (sessions.length > 0) {
                this.currentSessionId = sessions[0].id;
              }
            } catch (_) {}
            if (!this.currentSessionId) {
              const { v4: uuidv4 } = require('uuid');
              this.currentSessionId = uuidv4();
              await databaseManager.createSession(this.currentSessionId!, '新对话');
            }
          }
          await this.loadChatHistory();
          this.chatHistoryLoaded = true;
        }
      }

      const enrichedMessage = this.recoveryMode ? message : await this.processMemoryKeywords(message);
      const smartPrompt = this.recoveryMode ? null : await this.checkSmartPrompts();

      // 添加用户消息到历史
      this.conversationHistory.push({
        id: generateId(),
        role: 'user',
        content: enrichedMessage,
        timestamp: Date.now()
      });

      // 调用流式 API
      const response = await this.streamCallOpenAIAPI(enrichedMessage, onChunk);

      const finalResponse = smartPrompt ? `${response}\n\n${smartPrompt}` : response;
      // 如果有 smartPrompt 追加，把追加部分也推给前端
      if (smartPrompt) {
        onChunk(`\n\n${smartPrompt}`);
      }

      // 添加 AI 响应到历史
      this.conversationHistory.push({
        id: generateId(),
        role: 'assistant',
        content: finalResponse,
        timestamp: Date.now()
      });

      if (!this.recoveryMode) {
        await this.saveChatToDatabase(message, finalResponse);
      }

      return finalResponse;
    } catch (error) {
      if (this.logger) {
        this.logger.exception('pi-agent', error as Error, { phase: 'streamMessage' });
      }
      throw error;
    }
  }

  /**
   * 清空对话历史
   */
  clearHistory(): void {
    if (this.logger) {
      this.logger.info('pi-agent', 'Clearing conversation history', {
        previousLength: this.conversationHistory.length
      });
    }

    this.conversationHistory = [];
  }

  /**
   * 获取对话历史
   */
  getHistory(): ChatMessage[] {
    return [...this.conversationHistory];
  }

  /** 新建会话：清空历史，设置新 sessionId */
  async newSession(sessionId: string, title?: string): Promise<void> {
    this.conversationHistory = [];
    this.chatHistoryLoaded = false;
    this.currentSessionId = sessionId;
    await databaseManager.createSession(sessionId, title || '新对话');
    this.logger?.info('pi-agent', `New session created: ${sessionId}`);
  }

  /** 切换会话：加载指定会话的历史 */
  async switchSession(sessionId: string): Promise<ChatMessage[]> {
    this.conversationHistory = [];
    this.currentSessionId = sessionId;
    const messages = await databaseManager.getSessionMessages(sessionId);
    for (const msg of messages) {
      this.conversationHistory.push({
        id: generateId(),
        role: msg.role,
        content: msg.content,
        timestamp: new Date(msg.created_at).getTime()
      });
    }
    this.chatHistoryLoaded = true;
    this.logger?.info('pi-agent', `Switched to session ${sessionId}, loaded ${messages.length} messages`);
    return this.getHistory();
  }

  /** 登出时重置所有会话状态，防止用户切换后残留旧数据 */
  resetForLogout(): void {
    this.conversationHistory = [];
    this.chatHistoryLoaded = false;
    this.currentSessionId = null;
    this.cachedOwnHotelName = null;
    this.cachedCompetitorNames = [];
    this.logger?.info('pi-agent', 'Session state reset on logout');
  }

  getCurrentSessionId(): string | null { return this.currentSessionId; }
  setCurrentSessionId(id: string): void { this.currentSessionId = id; }

  /**
   * 更新配置
   */
  async updateConfig(config: Partial<PiAgentConfig>): Promise<void> {
    if (this.logger) {
      this.logger.info('pi-agent', 'Updating configuration');
    }

    try {
      // 合并配置
      this.config = {
        ...this.config,
        ...config
      };

      // 验证新配置
      this.validateConfig();

      // 重新初始化
      this.isInitialized = false;
      await this.initialize();

      if (this.logger) {
        this.logger.info('pi-agent', 'Configuration updated successfully');
      }
    } catch (error) {
      if (this.logger) {
        this.logger.exception('pi-agent', error as Error, { phase: 'updateConfig' });
      }
      throw error;
    }
  }

  /**
   * 获取当前配置
   */
  getConfig(): PiAgentConfig {
    return { ...this.config };
  }

  /**
   * 检查是否已初始化
   */
  isReady(): boolean {
    return this.isInitialized;
  }

  /**
   * 构建系统提示词（包含技能信息和标签页上下文）
   * 角色定义从 agent/persona/*.md 文件加载，便于非开发人员维护
   * 优化版本：精简内容，减少 token 消耗
   */
  private buildSystemPrompt(): string {
    const parts: Array<{ source: string; chars: number }> = [];

    // 基础 prompt：recovery 用 config.systemPrompt，正常聊天用 persona 文件
    let prompt: string;
    if (this.config.systemPrompt) {
      prompt = this.config.systemPrompt;
      parts.push({ source: 'config.systemPrompt', chars: prompt.length });
    } else {
      prompt = this.loadPersonaFromFiles();
      parts.push({ source: 'persona-files(AGENTS+IDENTITY+SOUL)', chars: prompt.length });
    }

    // 注入当前日期时间 + 数据时间展示规则
    const tz = this.currentTimezone || 'Asia/Shanghai';
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: tz });
    const nowTime = new Date().toLocaleTimeString('sv-SE', { timeZone: tz, hour: '2-digit', minute: '2-digit' });
    const isEn = this.currentLanguage === 'en';
    const timeBlock = isEn
      ? `\n\n## Current Time\n\nNow: ${today} ${nowTime} (${tz}). Use date ${today} for "today" queries.\n\n## Data Time Display Rule\n\nAll data from the database has snapshot_time in Beijing time (UTC+8). When presenting data, convert to ${tz} and always show it. Format: "Data collected at: YYYY-MM-DD HH:MM (${tz})".`
      : `\n\n## 当前时间\n\n现在是 ${today} ${nowTime}（${tz}）。所有涉及"当天"、"今天"的查询请使用日期 ${today}。\n\n## 数据时间展示规则\n\n数据库中的数据都带有 snapshot_time 字段（北京时间 UTC+8）。向用户展示数据时，需转换为 ${tz} 时区并标注采集时间。格式："数据采集时间：YYYY-MM-DD HH:MM"。`;
    prompt += timeBlock;
    parts.push({ source: 'datetime+timezone-rule', chars: timeBlock.length });

    // 技能信息
    if (this.skillManager) {
      const skillsInfo = this.getSkillsForAI();
      if (skillsInfo) {
        prompt += '\n\n' + skillsInfo;
        parts.push({ source: 'skills-for-ai', chars: skillsInfo.length });
      }
    }

    // 记忆系统上下文（recovery 模式跳过）
    if (!this.recoveryMode) {
      const memoryContext = this.getMemoryContext();
      if (memoryContext) {
        prompt += '\n\n' + memoryContext;
        parts.push({ source: 'memory-context(hotel+competitors)', chars: memoryContext.length });
      }
    }

    // 语言指令
    if (this.currentLanguage === 'en') {
      const langBlock = '\n\n## Language Directive\n\nYou MUST respond in English.';
      prompt += langBlock;
      parts.push({ source: 'language-directive', chars: langBlock.length });
    }

    // 打印诊断
    const totalChars = parts.reduce((sum, p) => sum + p.chars, 0);
    console.error(`[PROMPT-DIAG] systemPrompt total: ${totalChars} chars, recoveryMode: ${this.recoveryMode}`);
    for (const p of parts) {
      console.error(`[PROMPT-DIAG]   ${p.source}: ${p.chars} chars`);
    }

    return prompt;
  }

  /**
   * 刷新酒店配置缓存（从 Memory 系统加载本店名和竞品列表）
   */
  private async refreshHotelConfigCache(): Promise<void> {
    // 本店名称：从数据库 hotel_config 表读取
    try {
      const config = await databaseManager.getHotelConfig();
      this.cachedOwnHotelName = config?.hotel_name || null;
    } catch (error) {
      this.logger?.warn('pi-agent', 'Failed to refresh own hotel cache from database', {
        error: error instanceof Error ? error.message : String(error)
      });
    }

    // 竞品列表：从数据库 competitors 表读取
    try {
      const competitors = await databaseManager.getCompetitorHotels();
      this.cachedCompetitorNames = competitors.map((c: any) => c.name);
    } catch (error) {
      this.logger?.warn('pi-agent', 'Failed to refresh competitor cache from database', {
        error: error instanceof Error ? error.message : String(error)
      });
      this.cachedCompetitorNames = [];
    }
  }

  /**
   * 加载当前会话的对话历史到 conversationHistory
   */
  private async loadChatHistory(): Promise<void> {
    try {
      const messages = this.currentSessionId
        ? await databaseManager.getSessionMessages(this.currentSessionId)
        : await databaseManager.getRecentChatMessages(2);
      if (messages.length === 0) return;

      for (const msg of messages) {
        this.conversationHistory.push({
          id: generateId(),
          role: msg.role,
          content: msg.content,
          timestamp: new Date(msg.created_at).getTime()
        });
      }
      this.logger?.info('pi-agent', `Loaded ${messages.length} chat history messages`);
    } catch (error) {
      this.logger?.warn('pi-agent', 'Failed to load chat history', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * 保存用户消息和 Agent 输出到数据库
   */
  private async saveChatToDatabase(userMessage: string, assistantResponse: string): Promise<void> {
    try {
      await databaseManager.saveChatMessage('user', userMessage, this.currentSessionId || undefined);
      await databaseManager.saveChatMessage('assistant', assistantResponse, this.currentSessionId || undefined);
      // 用第一条用户消息作为会话标题（截取前 30 字）
      if (this.currentSessionId && this.conversationHistory.length <= 2) {
        const title = userMessage.length > 30 ? userMessage.substring(0, 30) + '...' : userMessage;
        await databaseManager.updateSessionTitle(this.currentSessionId, title);
      }
    } catch (error) {
      this.logger?.warn('pi-agent', 'Failed to save chat to database', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * 获取记忆系统上下文信息（包含实际酒店配置数据）
   */
  private getMemoryContext(): string | null {
    try {
      let context = '## 酒店配置信息\n\n';

      // 注入本店名称（来自数据库 hotel_config）
      if (this.cachedOwnHotelName) {
        context += `**当前服务的酒店：** ${this.cachedOwnHotelName}\n\n`;
      } else {
        context += '**当前服务的酒店：** 未配置（请引导用户在管理后台配置本店名称）\n\n';
      }

      // 注入竞品列表（来自数据库 competitors）
      if (this.cachedCompetitorNames.length > 0) {
        context += '**竞品酒店：**\n';
        for (const name of this.cachedCompetitorNames) {
          context += `- ${name}\n`;
        }
        context += '\n';
      } else {
        context += '**竞品酒店：** 未配置\n\n';
      }

      // 使用说明
      context += '**使用规则：**\n';
      context += '- "本店"、"我们酒店" → 自动关联上方本店信息\n';
      context += '- "竞品"、"竞争对手" → 自动关联上方竞品列表\n';
      context += '- 查询竞品价格时，使用竞品名称作为搜索目标\n';
      context += '- 无竞品信息时，提示用户在管理后台配置\n';

      return context;
    } catch (error) {
      if (this.logger) {
        this.logger.warn('pi-agent', 'Failed to get memory context', {
          error: error instanceof Error ? error.message : String(error)
        });
      }
      return null;
    }
  }

  /**
   * 处理用户消息中的记忆关键词
   * 识别"本店"、"竞品"等关键词，自动关联记忆
   */
  private async processMemoryKeywords(message: string): Promise<string> {
    try {
      let enrichedMessage = message;
      
      // 检测"本店"、"我们酒店"等关键词
      const ownHotelKeywords = ['本店', '我们酒店', '我们的酒店', '自己的酒店'];
      const hasOwnHotelKeyword = ownHotelKeywords.some(keyword => message.includes(keyword));
      
      if (hasOwnHotelKeyword) {
        if (this.cachedOwnHotelName) {
          enrichedMessage += `\n[系统提示：本店是"${this.cachedOwnHotelName}"]`;
        } else {
          enrichedMessage += '\n[系统提示：尚未配置本店信息，建议先在管理后台配置本店名称]';
        }
      }
      
      // 检测"竞品"、"竞争对手"等关键词
      const competitorKeywords = ['竞品', '竞争对手', '周边酒店', '附近酒店'];
      const hasCompetitorKeyword = competitorKeywords.some(keyword => message.includes(keyword));
      
      if (hasCompetitorKeyword) {
        if (this.cachedCompetitorNames.length > 0) {
          const competitorNames = this.cachedCompetitorNames.join('、');
          enrichedMessage += `\n[系统提示：已配置的竞品有：${competitorNames}]`;
        } else {
          enrichedMessage += '\n[系统提示：尚未配置竞品信息]';
        }
      }
      
      return enrichedMessage;
    } catch (error) {
      if (this.logger) {
        this.logger.warn('pi-agent', 'Failed to process memory keywords', {
          error: error instanceof Error ? error.message : String(error)
        });
      }
      return message;
    }
  }

  /**
   * 检测消息中的酒店名称
   */
  private async detectHotelNames(message: string): Promise<HotelEntity[]> {
    if (!this.memoryManager) {
      return [];
    }

    try {
      // 获取所有已记住的酒店
      const result = await this.memoryManager.retrieveHotels({});
      if (!result.success || !result.data) {
        return [];
      }

      // 检查消息中是否包含任何已知酒店名称
      const matchedHotels: HotelEntity[] = [];
      for (const hotel of result.data) {
        if (message.includes(hotel.name)) {
          matchedHotels.push(hotel);
        }
      }

      return matchedHotels;
    } catch (error) {
      if (this.logger) {
        this.logger.warn('pi-agent', 'Failed to detect hotel names', {
          error: error instanceof Error ? error.message : String(error)
        });
      }
      return [];
    }
  }

  /**
   * 检查是否需要智能提示
   */
  private async checkSmartPrompts(): Promise<string | null> {
    try {
      // 检查是否是首次使用（没有本店信息）
      if (!this.cachedOwnHotelName) {
        return '提示：我注意到你还没有配置本店名称。为了更好地为你服务，建议先在管理后台配置本店信息。';
      }

      return null;
    } catch (error) {
      if (this.logger) {
        this.logger.warn('pi-agent', 'Failed to check smart prompts', {
          error: error instanceof Error ? error.message : String(error)
        });
      }
      return null;
    }
  }

  /**
   * 获取当前浏览器标签页上下文信息（精简版）
   */
  private getTabsContext(): string | null {
    if (!this.windowManager) {
      return null;
    }

    try {
      const tabs = this.windowManager.getTabList();
      const activeTabId = this.windowManager.getActiveTabId();

      if (!tabs || tabs.length === 0) {
        return null;
      }

      // 精简版：只列出标签页标题和活跃状态
      let context = '## 当前标签页\n';
      
      for (const tab of tabs) {
        const isActive = tab.id === activeTabId;
        if (isActive) {
          context += `活跃: ${tab.title || '新标签页'}\n`;
        }
      }

      return context;
    } catch (error) {
      if (this.logger) {
        this.logger.warn('pi-agent', 'Failed to get tabs context', {
          error: error instanceof Error ? error.message : String(error)
        });
      }
      return null;
    }
  }

  /**
   * 从 agent/persona/ 目录加载角色定义 .md 文件，拼接为系统提示词
   * 加载顺序：IDENTITY.md → SOUL.md → AGENTS.md
   */
  private loadPersonaFromFiles(): string {
    const personaDir = path.join(getAgentDir(), 'persona');
    const promptsDir = path.join(getAgentDir(), 'prompts');
    const files = ['IDENTITY.md', 'SOUL.md', 'AGENTS.md'];
    // 额外加载 prompts/ 下的异常认知文档（仅普通对话模式）
    const extraFiles: Array<{ dir: string; file: string }> = [
      { dir: promptsDir, file: 'error-awareness.md' },
      { dir: promptsDir, file: 'hotel-scenarios.md' },
    ];
    const parts: string[] = [];

    for (const file of files) {
      const filePath = path.join(personaDir, file);
      try {
        if (fs.existsSync(filePath)) {
          const content = fs.readFileSync(filePath, 'utf-8').trim();
          if (content) {
            parts.push(content);
          }
          this.logger?.info('persona', `Loaded ${file} (${content.length} chars)`);
        }
      } catch (error) {
        this.logger?.warn('persona', `Failed to load ${file}: ${String(error)}`);
      }
    }

    // 加载额外的 prompt 文件（异常认知等）
    for (const { dir, file } of extraFiles) {
      const filePath = path.join(dir, file);
      try {
        if (fs.existsSync(filePath)) {
          const content = fs.readFileSync(filePath, 'utf-8').trim();
          if (content) {
            parts.push(content);
          }
          this.logger?.info('persona', `Loaded extra prompt ${file} (${content.length} chars)`);
        }
      } catch (error) {
        this.logger?.warn('persona', `Failed to load extra prompt ${file}: ${String(error)}`);
      }
    }

    if (parts.length > 0) {
      return parts.join('\n\n---\n\n');
    }

    // 所有文件都加载失败时的兜底
    return '你是酒店行业智能运营助手"小酒"，请基于实际数据回答问题，严禁编造数据。';
  }

  /**
   * 获取格式化的技能信息供AI使用
   */
  private getSkillsForAI(): string | null {
    if (!this.skillManager) {
      return null;
    }

    const skills = this.skillManager.getAvailableSkills();
    let enabledSkills = skills.filter(s => s.status === 'loaded');

    // 按白名单过滤
    if (this.skillAllowList) {
      enabledSkills = enabledSkills.filter(s => this.skillAllowList!.has(s.metadata.name));
    }

    if (enabledSkills.length === 0) {
      return null;
    }

    let skillsText = '## Available Skills\n\n';

    // Recovery 模式：精简输出，只列名字，不需要 description/keywords（recovery prompt 已包含完整指令）
    if (this.recoveryMode) {
      skillsText += 'Available tools: ' + enabledSkills.map(s => s.metadata.name).join(', ') + '\n';
      skillsText += 'Call tools directly by name with required parameters. Do NOT call load_skill.\n';
      return skillsText;
    }

    skillsText += 'You have access to the following skills. When you need to use a skill, first call the `load_skill` tool to load its full content, then follow its instructions.\n\n';

    for (const skill of enabledSkills) {
      skillsText += `### ${skill.metadata.name}\n`;
      skillsText += `**Type:** ${skill.metadata.type || 'tool'}\n`;
      skillsText += `**Description:** ${skill.metadata.description}\n`;

      // 添加keywords，帮助LLM判断何时使用这个skill
      if (skill.metadata.tags && skill.metadata.tags.length > 0) {
        skillsText += `**Keywords:** ${skill.metadata.tags.join(', ')}\n`;
      }

      skillsText += '\n';
    }

    // 从文件加载 Skills Usage Rules（recovery 模式跳过，避免注入无关指令干扰修复流程）
    if (!this.recoveryMode) {
      try {
        const rulesPath = path.join(getAgentDir(), 'prompts', 'skills-usage-rules.md');
        if (fs.existsSync(rulesPath)) {
          skillsText += '\n' + fs.readFileSync(rulesPath, 'utf-8').trim() + '\n';
        }
      } catch {
        // 文件加载失败时使用内联兜底
        skillsText += '\n**CRITICAL:** MUST call `load_skill` before using any skill. NEVER claim completion without actual tool calls.\n';
      }
    }

    return skillsText;
  }

  /**
   * 销毁Pi Agent Manager
   */
  destroy(): void {
    if (this.logger) {
      this.logger.info('pi-agent', 'Destroying Pi Agent Manager');
    }

    this.conversationHistory = [];
    this.isInitialized = false;
    this.skillManager = null;
    this.memoryManager = null;
    this.hotelMentionCount.clear();
  }

  /**
   * 自动学习：从页面标题或URL中提取酒店名称
   * 可以被Skill调用，在访问酒店详情页后触发
   */
  async learnHotelFromPage(pageTitle: string, pageUrl: string, platform?: string): Promise<{
    success: boolean;
    hotelName?: string;
    shouldAsk?: boolean;
    message?: string;
  }> {
    if (!this.memoryManager) {
      return {
        success: false,
        message: 'Memory system not available'
      };
    }

    try {
      // 从页面标题中提取酒店名称
      // 常见格式：
      // - "酒店名称_携程酒店"
      // - "酒店名称-美团酒店"
      // - "酒店名称 | 飞猪"
      let hotelName = pageTitle;
      
      // 移除常见的平台后缀
      const platformSuffixes = [
        '_携程酒店', '-携程酒店', '携程酒店',
        '_美团酒店', '-美团酒店', '美团酒店',
        '_飞猪', '-飞猪', '飞猪',
        '_去哪儿', '-去哪儿', '去哪儿',
        ' | 携程', ' | 美团', ' | 飞猪', ' | 去哪儿'
      ];
      
      for (const suffix of platformSuffixes) {
        if (hotelName.includes(suffix)) {
          hotelName = hotelName.split(suffix)[0].trim();
          break;
        }
      }
      
      // 如果提取的名称太短或太长，可能不是有效的酒店名称
      if (hotelName.length < 3 || hotelName.length > 100) {
        return {
          success: false,
          message: 'Invalid hotel name extracted'
        };
      }
      
      // 检查是否已经记住了这个酒店
      const existingResult = await this.memoryManager.retrieveHotels({
        nameKeyword: hotelName
      });
      
      if (existingResult.success && existingResult.data && existingResult.data.length > 0) {
        // 已经记住了，不需要询问
        return {
          success: true,
          hotelName,
          shouldAsk: false,
          message: `Hotel "${hotelName}" is already in memory`
        };
      }
      
      // 新酒店，建议询问用户是否记住
      if (this.logger) {
        this.logger.info('pi-agent', 'New hotel detected from page', {
          hotelName,
          pageUrl,
          platform
        });
      }
      
      return {
        success: true,
        hotelName,
        shouldAsk: true,
        message: `Detected new hotel: "${hotelName}". Should I remember it?`
      };
    } catch (error) {
      if (this.logger) {
        this.logger.error('pi-agent', 'Failed to learn hotel from page', {
          error: error instanceof Error ? error.message : String(error),
          pageTitle,
          pageUrl
        });
      }
      
      return {
        success: false,
        message: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * 记住酒店（由用户确认后调用）
   */
  async rememberHotel(hotelName: string, type: 'own_hotel' | 'competitor', platform?: string, platformUrl?: string): Promise<{
    success: boolean;
    message: string;
  }> {
    if (!this.memoryManager) {
      return {
        success: false,
        message: 'Memory system not available'
      };
    }

    try {
      const platformInfo = platform && platformUrl ? [{
        platform: platform as any,
        url: platformUrl,
        lastVerified: new Date()
      }] : undefined;

      const result = await this.memoryManager.createHotel({
        name: hotelName,
        type,
        platforms: platformInfo,
        source: 'auto_learning'
      });

      if (result.success) {
        if (this.logger) {
          this.logger.info('pi-agent', 'Hotel remembered successfully', {
            hotelName,
            type,
            platform
          });
        }
        
        return {
          success: true,
          message: `Successfully remembered "${hotelName}" as ${type === 'own_hotel' ? '本店' : '竞品'}`
        };
      } else {
        return {
          success: false,
          message: result.error?.message || 'Failed to remember hotel'
        };
      }
    } catch (error) {
      if (this.logger) {
        this.logger.error('pi-agent', 'Failed to remember hotel', {
          error: error instanceof Error ? error.message : String(error),
          hotelName,
          type
        });
      }
      
      return {
        success: false,
        message: error instanceof Error ? error.message : String(error)
      };
    }
  }
}
