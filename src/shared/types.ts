/**
 * 共享类型定义
 * 用于主进程、渲染进程和预加载脚本之间的类型共享
 */

// ==================== 配置相关类型 ====================

export interface PiAgentConfig {
  provider: 'anthropic' | 'openai' | 'google' | 'azure' | 'ollama';
  model: string;
  apiKey: string;
  baseURL?: string;
  temperature: number;
  maxTokens: number;
  systemPrompt?: string;
}

export interface WindowConfig {
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
  splitRatio: number;  // 0.0 - 1.0
  rememberPosition: boolean;
  x?: number;
  y?: number;
}

export interface WebViewConfig {
  defaultURL: string;
  userAgent?: string;
  enableJavaScript: boolean;
  enablePlugins: boolean;
  allowPopups: boolean;
}

export interface LoggingConfig {
  level: 'debug' | 'info' | 'warn' | 'error';
  filePath: string;
  maxFileSize: number;
  maxFiles: number;
}

export interface SkillsConfig {
  enabled: boolean;
  skillsDir: string;
  scriptsDir: string;
  defaultTimeout: number;
  maxConcurrent: number;
  autoReload: boolean;
  disabledSkills: string[];
  skillConfigs: Record<string, any>;
}

export interface CloudDbConfig {
  host: string;
  port: number;
  user: string;
  password: string;
}

export interface DeviceInfo {
  deviceId: string;
  deviceIdShort: string;
  hostname: string;
  platform: string;
  firstSeen: string;
}

export interface AppConfig {
  version: string;
  piAgent: PiAgentConfig;
  window: WindowConfig;
  webView: WebViewConfig;
  logging: LoggingConfig;
  skills: SkillsConfig;
  language: 'zh' | 'en';
  database: CloudDbConfig;
}

// ==================== 对话相关类型 ====================

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  metadata?: MessageMetadata;
}

export interface MessageMetadata {
  model?: string;
  tokens?: number;
  duration?: number;
  error?: string;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

// ==================== 导航相关类型 ====================

export interface NavigationState {
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
  progress: number;  // 0-100
}

export interface NavigationEntry {
  url: string;
  title: string;
  timestamp: number;
}

export interface NavigationHistory {
  entries: NavigationEntry[];
  currentIndex: number;
}

// ==================== 认证相关类型 ====================

export interface AuthenticatedUser {
  id: number;
  username: string;
  displayName: string;
}

export interface RegisterResult {
  success: boolean;
  error?: string;
}

export interface LoginResult {
  success: boolean;
  user?: AuthenticatedUser;
  error?: string;
}

export interface SavedCredential {
  username: string;
  displayName: string;
  hasPassword: boolean;
  lastLoginAt: number;
}

export interface AuthSession {
  userId: number;
  username: string;
  displayName: string;
  loginTimestamp: number;
}

// ==================== IPC通道名称 ====================

export const IPC_CHANNELS = {
  // Pi Agent相关
  PI_SEND_MESSAGE: 'pi:send-message',
  PI_STREAM_MESSAGE: 'pi:stream-message',
  PI_STREAM_CHUNK: 'pi:stream-chunk',
  PI_STREAM_END: 'pi:stream-end',
  PI_STREAM_ERROR: 'pi:stream-error',
  PI_GET_RESPONSE: 'pi:get-response',
  PI_CLEAR_HISTORY: 'pi:clear-history',
  PI_RESPONSE: 'pi:response',
  PI_NEW_SESSION: 'pi:new-session',
  PI_SWITCH_SESSION: 'pi:switch-session',

  // 会话管理
  SESSION_LIST: 'session:list',
  SESSION_DELETE: 'session:delete',
  SESSION_RENAME: 'session:rename',
  SESSION_SWITCH: 'session:switch-notify',
  
  // WebView相关
  WEBVIEW_NAVIGATE: 'webview:navigate',
  WEBVIEW_GO_BACK: 'webview:go-back',
  WEBVIEW_GO_FORWARD: 'webview:go-forward',
  WEBVIEW_RELOAD: 'webview:reload',
  WEBVIEW_GET_URL: 'webview:get-url',
  WEBVIEW_UPDATE_STATE: 'webview:update-state',
  WEBVIEW_LOAD_ERROR: 'webview:load-error',
  
  // 配置相关
  CONFIG_GET: 'config:get',
  CONFIG_SET: 'config:set',
  CONFIG_VALIDATE_API_KEY: 'config:validate-api-key',
  
  // 布局相关
  LAYOUT_UPDATE_BOUNDS: 'layout:update-bounds',
  
  // Skills相关
  SKILLS_GET_ALL: 'skills:get-all',
  SKILLS_GET: 'skills:get',
  SKILLS_EXECUTE: 'skills:execute',
  SKILLS_RELOAD: 'skills:reload',
  SKILLS_ENABLE: 'skills:enable',
  SKILLS_DISABLE: 'skills:disable',

  // 技能执行进度
  SKILL_PROGRESS: 'skill:progress',

  // 标签页相关
  TAB_CREATE: 'tab:create',
  TAB_CLOSE: 'tab:close',
  TAB_SWITCH: 'tab:switch',
  TAB_LIST: 'tab:list',
  TAB_UPDATE: 'tab:update',

  // 记忆系统相关
  MEMORY_CREATE: 'memory:create',
  MEMORY_RETRIEVE: 'memory:retrieve',
  MEMORY_UPDATE: 'memory:update',
  MEMORY_DELETE: 'memory:delete',
  MEMORY_IMPORT: 'memory:import',
  MEMORY_EXPORT: 'memory:export',
  MEMORY_STATS: 'memory:stats',

  // 数据渠道配置（心跳任务直控）
  HEARTBEAT_GET_TASKS: 'heartbeat:get-tasks',
  HEARTBEAT_UPDATE_TASK: 'heartbeat:update-task',
  HEARTBEAT_TASK_STATUS: 'heartbeat:task-status',
  HEARTBEAT_GET_EXECUTING: 'heartbeat:get-executing',
  HEARTBEAT_EXECUTE_TASK: 'heartbeat:execute-task',

  // 数据面板
  DASHBOARD_PUBLIC_PRICES: 'dashboard:public-prices',
  DASHBOARD_COMPETITOR_PRICES: 'dashboard:competitor-prices',
  DASHBOARD_BACKEND_PRICES: 'dashboard:backend-prices',
  DASHBOARD_REALTIME_ROOM_STATUS: 'dashboard:realtime-room-status',
  DASHBOARD_FUTURE_ROOM_STATUS: 'dashboard:future-room-status',
  DASHBOARD_PRICE_SNAPSHOTS: 'dashboard:price-snapshots',
  DASHBOARD_ROOM_SNAPSHOTS: 'dashboard:room-snapshots',
  DASHBOARD_PRICE_CALENDAR: 'dashboard:price-calendar',
  DASHBOARD_ROOM_CALENDAR: 'dashboard:room-calendar',
  DASHBOARD_ROOM_MAPPING: 'dashboard:room-mapping',

  // 标准房型管理
  ROOM_TYPES_LIST: 'room-types:list',
  ROOM_TYPES_ADD: 'room-types:add',
  ROOM_TYPES_REMOVE: 'room-types:remove',
  ROOM_MAPPING_GET_ALL: 'room-mapping:get-all',
  ROOM_MAPPING_SAVE: 'room-mapping:save',

  // 竞品管理
  HOTEL_CONFIG_GET: 'hotel-config:get',
  HOTEL_CONFIG_SAVE: 'hotel-config:save',
  COMPETITOR_LIST: 'competitor:list',
  COMPETITOR_ADD: 'competitor:add',
  COMPETITOR_REMOVE: 'competitor:remove',
  COMPETITOR_SEARCH_NEARBY: 'competitor:search-nearby',
  COMPETITOR_SEARCH_BY_NAME: 'competitor:search-by-name',
  COMPETITOR_RESOLVE_LOCATION: 'competitor:resolve-location',
  COMPETITOR_RESOLVE_PLATFORM_IDS: 'competitor:resolve-platform-ids',

  // 应用相关
  APP_GET_PAGES_PATH: 'app:get-pages-path',
  APP_GET_DEVICE_ID: 'app:get-device-id',

  // 语言切换
  CONFIG_SET_LANGUAGE: 'config:set-language',

  // 时区切换
  CONFIG_SET_TIMEZONE: 'config:set-timezone',

  // 焦点管理
  FOCUS_MAIN_WEBCONTENTS: 'focus:main-webcontents',

  // 确认对话框（替代渲染进程的 confirm()，避免 BrowserView 焦点抢占）
  DIALOG_CONFIRM: 'dialog:confirm',

  // 登录辅助相关
  LOGIN_REQUIRED: 'login:required',
  LOGIN_ACTION: 'login:action',
  LOGIN_DISMISSED: 'login:dismissed',
  LOGIN_STATUS_ALERT: 'login:status-alert',
  LOGIN_CHECK_RUN: 'login-check:run',

  // 认证相关
  AUTH_REGISTER: 'auth:register',
  AUTH_LOGIN: 'auth:login',
  AUTH_LOGOUT: 'auth:logout',
  AUTH_GET_CURRENT_USER: 'auth:get-current-user',
  AUTH_ON_STATE_CHANGE: 'auth:on-state-change',
  AUTH_GET_SAVED_CREDENTIALS: 'auth:get-saved-credentials',
  AUTH_REMOVE_SAVED_CREDENTIAL: 'auth:remove-saved-credential',
  AUTH_GOOGLE_LOGIN: 'auth:google-login'
} as const;

// ==================== 错误类型 ====================

export interface AppError {
  code: string;
  message: string;
  details?: any;
  timestamp: number;
}

export type ErrorCategory = 
  | 'network'
  | 'configuration'
  | 'ipc'
  | 'pi-agent'
  | 'ui-rendering'
  | 'skill-loading'
  | 'skill-execution'
  | 'unknown';

// ==================== Skills相关类型 ====================

export interface SkillMetadata {
  name: string;
  description: string;
  script?: string;  // 脚本路径（相对于项目根目录）
  type?: string;    // 技能类型（tool, workflow等）
  version?: string;
  author?: string;
  tags?: string[];
  requires?: string[];
  os?: ('windows' | 'macos' | 'linux')[];
  enabled?: boolean;  // 是否启用该技能，默认为 true
}

export interface SkillDefinition {
  metadata: SkillMetadata;
  content: string;
  skillPath: string;
  scriptsPath: string;
  status: 'loaded' | 'error' | 'disabled';
  error?: string;
  loadedAt: number;
}

export interface SkillExecutionContext {
  skillName: string;
  params: Record<string, any>;
  timeout?: number;
  env?: Record<string, string>;
  workingDir?: string;
  memory?: any;  // MemoryClient instance for accessing memory system
}

export interface SkillResult {
  success: boolean;
  output: any;
  error?: string;
  executionTime: number;
  format: 'json' | 'text' | 'markdown' | 'html';
  stdout?: string;
  stderr?: string;
}

export interface LoadResult {
  success: boolean;
  skill?: SkillDefinition;
  error?: string;
}
