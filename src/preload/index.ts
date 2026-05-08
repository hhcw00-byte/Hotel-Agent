/**
 * Preload Script - 预加载脚本
 * 
 * 职责：
 * - 使用contextBridge安全地暴露API
 * - 桥接渲染进程和主进程
 * - 不直接暴露Node.js或Electron API
 * - 提供类型安全的接口
 */

import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import { IPC_CHANNELS } from '../shared/types';
import type { AppConfig, ChatMessage, NavigationState, SkillDefinition, SkillExecutionContext, SkillResult } from '../shared/types';

/**
 * Electron API接口定义
 * 这个接口将被暴露到渲染进程的window.electronAPI
 */
interface ElectronAPI {
  // Pi Agent API
  piAgent: {
    sendMessage: (message: string) => Promise<string>;
    streamMessage: (message: string) => Promise<string>;
    onStreamChunk: (callback: (chunk: string) => void) => () => void;
    onStreamEnd: (callback: () => void) => () => void;
    onStreamError: (callback: (error: string) => void) => () => void;
    clearHistory: () => Promise<void>;
    newSession: (sessionId: string, title?: string) => Promise<any>;
    switchSession: (sessionId: string) => Promise<any>;
    onResponse: (callback: (response: string) => void) => () => void;
    onProgress: (callback: (event: any) => void) => () => void;
  };

  // 会话管理 API
  sessions: {
    list: () => Promise<any[]>;
    delete: (sessionId: string) => Promise<any>;
    rename: (sessionId: string, title: string) => Promise<any>;
    switchFromAdmin: (sessionId: string) => Promise<any>;
    onSwitch: (callback: (data: { sessionId: string; messages: any[] }) => void) => () => void;
  };
  
  // WebView API
  webView: {
    navigate: (url: string) => Promise<void>;
    goBack: () => Promise<void>;
    goForward: () => Promise<void>;
    reload: () => Promise<void>;
    getCurrentURL: () => Promise<string>;
    getNavigationState: () => Promise<NavigationState>;
    onNavigate: (callback: (state: NavigationState) => void) => () => void;
    onLoadError: (callback: (error: { errorCode: number; errorDescription: string; url: string }) => void) => () => void;
  };

  // Tab API
  tabs: {
    create: (url?: string) => Promise<{ tabId: string; tabs: any[]; activeTabId: string | null }>;
    close: (tabId: string) => Promise<{ tabs: any[]; activeTabId: string | null }>;
    switch: (tabId: string) => Promise<{ tabs: any[]; activeTabId: string | null }>;
    list: () => Promise<{ tabs: any[]; activeTabId: string | null }>;
    onUpdate: (callback: (data: { tabs: any[]; activeTabId: string | null }) => void) => () => void;
  };
  
  // Config API
  config: {
    get: () => Promise<AppConfig>;
    set: (config: Partial<AppConfig>) => Promise<void>;
    validateApiKey: (apiKey: string) => Promise<boolean>;
    setLanguage: (lang: string) => Promise<void>;
    setTimezone: (tz: string) => Promise<void>;
  };

  // Layout API
  layout: {
    updateBounds: (bounds: { x: number; y: number; width: number; height: number }) => Promise<void>;
  };

  // Skills API
  skills: {
    getAll: () => Promise<SkillDefinition[]>;
    get: (skillName: string) => Promise<SkillDefinition | null>;
    execute: (context: SkillExecutionContext) => Promise<SkillResult>;
    reload: (skillName?: string) => Promise<void>;
    enable: (skillName: string) => Promise<void>;
    disable: (skillName: string) => Promise<void>;
  };

  // Memory API
  memory: {
    create: (data: any) => Promise<any>;
    retrieve: (query: any) => Promise<any>;
    update: (id: string, updates: any) => Promise<any>;
    delete: (id: string, requireConfirm?: boolean) => Promise<any>;
    import: (jsonData: string) => Promise<any>;
    export: () => Promise<any>;
    stats: () => Promise<any>;
  };

  // Heartbeat API
  heartbeat: {
    getTasks: () => Promise<any>;
    updateTask: (taskId: string, updates: any) => Promise<any>;
    getExecutingTasks: () => Promise<string[]>;
    executeTask: (taskId: string) => Promise<any>;
    onTaskStatus: (callback: (data: { taskId: string; status: string }) => void) => () => void;
  };

  // Dashboard API
  dashboard: {
    getPublicPrices: (startTime: string) => Promise<any[]>;
    getCompetitorPrices: (startTime: string) => Promise<any[]>;
    getBackendPrices: (startTime: string) => Promise<any[]>;
    getRealtimeRoomStatus: (startTime: string) => Promise<any[]>;
    getFutureRoomStatus: (startTime: string) => Promise<any[]>;
    getPriceSnapshots: (startTime: string) => Promise<any[]>;
    getRoomSnapshots: (startTime: string) => Promise<any[]>;
    getPriceCalendar: (startDate: string, endDate: string) => Promise<any[]>;
    getRoomCalendar: (startDate: string, endDate: string) => Promise<any[]>;
    getRoomMappings: () => Promise<any[]>;
  };

  // Hotel Config API
  hotelConfig: {
    get: () => Promise<any>;
    save: (data: { hotelName?: string; address?: string; lat?: number; lng?: number; amapPoiId?: string; pmsUrl?: string }) => Promise<void>;
  };

  // Room Types API
  roomTypes: {
    list: () => Promise<string[]>;
    add: (name: string) => Promise<void>;
    remove: (name: string) => Promise<void>;
    getMappings: () => Promise<Array<{ canonical_name: string; platform: string; platform_room_name: string }>>;
    saveMappings: (mappings: Array<{ canonicalName: string; platform: string; platformRoomName: string }>) => Promise<void>;
  };

  // Competitor API
  competitor: {
    list: () => Promise<any[]>;
    add: (data: { name: string; amapPoiId?: string; address?: string; lat?: number; lng?: number; distanceMeters?: number }) => Promise<number>;
    remove: (competitorId: number) => Promise<void>;
    searchNearby: (lat: number, lng: number, radius: number) => Promise<any[]>;
    searchByName: (keyword: string) => Promise<any[]>;
    resolveLocation: (hotelName: string) => Promise<any>;
    resolvePlatformIds: () => Promise<{ success: boolean; message: string }>;
  };

  // App API
  app: {
    getPagesPath: () => Promise<string>;
    getDeviceId: () => Promise<string>;
  };

  // Dialog API（替代渲染进程的 confirm()，避免 BrowserView 焦点问题）
  dialog: {
    confirm: (message: string, title?: string) => Promise<boolean>;
  };

  // Focus API（焦点管理）
  focus: {
    mainWebContents: () => Promise<void>;
  };

  // Login API（登录辅助）
  login: {
    onRequired: (callback: (event: { id: string; siteUrl: string; siteDomain: string; siteTitle: string }) => void) => () => void;
    action: (event: { id: string; action: 'go_to_login' | 'done' | 'skip' }) => Promise<void>;
    onDismissed: (callback: (data: { id: string }) => void) => () => void;
    onStatusAlert: (callback: (event: { platforms: string[] }) => void) => () => void;
  };

  // Login Check API（登录检测）
  loginCheck: {
    run: () => Promise<any>;
  };

  // Quality API（质检系统）
  quality: {
    createTask: (input: any) => Promise<any>;
    listTasks: () => Promise<any>;
    getSubmitTask: (input: any) => Promise<any>;
    submitTask: (input: any) => Promise<any>;
    getSubmissionResult: (taskId: string) => Promise<any>;
    approveSubmission: (taskId: string) => Promise<any>;
    rejectSubmission: (input: any) => Promise<any>;
    openAttachment: (relativePath: string) => Promise<any>;
    openSubmitLink: (input: any) => Promise<any>;
    getWebSubmitLink: (input: any) => Promise<any>;
    copyText: (text: string) => Promise<any>;
    httpRequest: (method: string, path: string, body?: any) => Promise<any>;
  };

  // Auth API（用户认证）
  auth: {
    register: (username: string, password: string, displayName: string) => Promise<any>;
    login: (username: string, password: string, rememberPassword: boolean) => Promise<any>;
    logout: () => Promise<void>;
    getCurrentUser: () => Promise<any>;
    onStateChange: (callback: (user: any) => void) => () => void;
    getSavedCredentials: () => Promise<any[]>;
    removeSavedCredential: (username: string) => Promise<void>;
    googleLogin: () => Promise<any>;
  };

  // IPC Renderer (for menu events)
  ipcRenderer: {
    on: (channel: string, callback: (event: any, ...args: any[]) => void) => void;
    removeListener: (channel: string, callback: (event: any, ...args: any[]) => void) => void;
  };
}

/**
 * 创建事件监听器的辅助函数
 * 返回一个清理函数，用于移除监听器
 */
function createEventListener<T>(
  channel: string,
  callback: (data: T) => void
): () => void {
  const listener = (_event: IpcRendererEvent, data: T) => {
    callback(data);
  };
  
  ipcRenderer.on(channel, listener);
  
  // 返回清理函数
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

/**
 * 暴露到渲染进程的API
 */
const electronAPI: ElectronAPI = {
  // ==================== Pi Agent API ====================
  piAgent: {
    /**
     * 发送消息到AI Agent
     */
    sendMessage: (message: string): Promise<string> => {
      return ipcRenderer.invoke(IPC_CHANNELS.PI_SEND_MESSAGE, message);
    },

    /**
     * 流式发送消息到AI Agent
     */
    streamMessage: (message: string): Promise<string> => {
      return ipcRenderer.invoke(IPC_CHANNELS.PI_STREAM_MESSAGE, message);
    },

    onStreamChunk: (callback: (chunk: string) => void): (() => void) => {
      return createEventListener<string>(IPC_CHANNELS.PI_STREAM_CHUNK, callback);
    },

    onStreamEnd: (callback: () => void): (() => void) => {
      return createEventListener<void>(IPC_CHANNELS.PI_STREAM_END, callback);
    },

    onStreamError: (callback: (error: string) => void): (() => void) => {
      return createEventListener<string>(IPC_CHANNELS.PI_STREAM_ERROR, callback);
    },

    /**
     * 清空对话历史
     */
    clearHistory: (): Promise<void> => {
      return ipcRenderer.invoke(IPC_CHANNELS.PI_CLEAR_HISTORY);
    },

    newSession: (sessionId: string, title?: string): Promise<any> => {
      return ipcRenderer.invoke(IPC_CHANNELS.PI_NEW_SESSION, sessionId, title);
    },

    switchSession: (sessionId: string): Promise<any> => {
      return ipcRenderer.invoke(IPC_CHANNELS.PI_SWITCH_SESSION, sessionId);
    },

    /**
     * 监听AI响应
     */
    onResponse: (callback: (response: string) => void): (() => void) => {
      return createEventListener<string>(IPC_CHANNELS.PI_RESPONSE, callback);
    },

    /**
     * 监听技能执行进度事件
     */
    onProgress: (callback: (event: any) => void): (() => void) => {
      return createEventListener<any>(IPC_CHANNELS.SKILL_PROGRESS, callback);
    }
  },

  // ==================== Sessions API ====================
  sessions: {
    list: (): Promise<any[]> => ipcRenderer.invoke(IPC_CHANNELS.SESSION_LIST),
    delete: (sessionId: string): Promise<any> => ipcRenderer.invoke(IPC_CHANNELS.SESSION_DELETE, sessionId),
    rename: (sessionId: string, title: string): Promise<any> => ipcRenderer.invoke(IPC_CHANNELS.SESSION_RENAME, sessionId, title),
    switchFromAdmin: (sessionId: string): Promise<any> => ipcRenderer.invoke(IPC_CHANNELS.SESSION_SWITCH, sessionId),
    onSwitch: (callback: (data: { sessionId: string; messages: any[] }) => void): (() => void) => {
      return createEventListener<{ sessionId: string; messages: any[] }>(IPC_CHANNELS.SESSION_SWITCH, callback);
    },
  },

  // ==================== WebView API ====================
  webView: {
    /**
     * 导航到指定URL
     */
    navigate: (url: string): Promise<void> => {
      return ipcRenderer.invoke(IPC_CHANNELS.WEBVIEW_NAVIGATE, url);
    },

    /**
     * 后退
     */
    goBack: (): Promise<void> => {
      return ipcRenderer.invoke(IPC_CHANNELS.WEBVIEW_GO_BACK);
    },

    /**
     * 前进
     */
    goForward: (): Promise<void> => {
      return ipcRenderer.invoke(IPC_CHANNELS.WEBVIEW_GO_FORWARD);
    },

    /**
     * 刷新
     */
    reload: (): Promise<void> => {
      return ipcRenderer.invoke(IPC_CHANNELS.WEBVIEW_RELOAD);
    },

    /**
     * 获取当前URL
     */
    getCurrentURL: (): Promise<string> => {
      return ipcRenderer.invoke(IPC_CHANNELS.WEBVIEW_GET_URL);
    },

    /**
     * 获取导航状态
     */
    getNavigationState: (): Promise<NavigationState> => {
      return ipcRenderer.invoke(IPC_CHANNELS.WEBVIEW_GET_URL);
    },

    /**
     * 监听导航状态变化
     */
    onNavigate: (callback: (state: NavigationState) => void): (() => void) => {
      return createEventListener<NavigationState>(
        IPC_CHANNELS.WEBVIEW_UPDATE_STATE,
        callback
      );
    },

    onLoadError: (callback: (error: { errorCode: number; errorDescription: string; url: string }) => void): (() => void) => {
      return createEventListener<{ errorCode: number; errorDescription: string; url: string }>(
        IPC_CHANNELS.WEBVIEW_LOAD_ERROR,
        callback
      );
    }
  },

  // ==================== Config API ====================
  config: {
    /**
     * 获取配置
     */
    get: (): Promise<AppConfig> => {
      return ipcRenderer.invoke(IPC_CHANNELS.CONFIG_GET);
    },

    /**
     * 设置配置
     */
    set: (config: Partial<AppConfig>): Promise<void> => {
      return ipcRenderer.invoke(IPC_CHANNELS.CONFIG_SET, config);
    },

    /**
     * 验证API密钥
     */
    validateApiKey: (apiKey: string): Promise<boolean> => {
      return ipcRenderer.invoke(IPC_CHANNELS.CONFIG_VALIDATE_API_KEY, apiKey);
    },

    /**
     * 设置语言偏好
     */
    setLanguage: (lang: string): Promise<void> => {
      return ipcRenderer.invoke(IPC_CHANNELS.CONFIG_SET_LANGUAGE, lang);
    },

    setTimezone: (tz: string): Promise<void> => {
      return ipcRenderer.invoke(IPC_CHANNELS.CONFIG_SET_TIMEZONE, tz);
    }
  },

  // ==================== Layout API ====================
  layout: {
    /**
     * 更新WebContentsView边界
     */
    updateBounds: (bounds: { x: number; y: number; width: number; height: number }): Promise<void> => {
      return ipcRenderer.invoke(IPC_CHANNELS.LAYOUT_UPDATE_BOUNDS, bounds);
    }
  },

  // ==================== Tab API ====================
  tabs: {
    /**
     * 创建新标签页
     */
    create: (url?: string): Promise<{ tabId: string; tabs: any[]; activeTabId: string | null }> => {
      return ipcRenderer.invoke(IPC_CHANNELS.TAB_CREATE, url);
    },

    /**
     * 关闭标签页
     */
    close: (tabId: string): Promise<{ tabs: any[]; activeTabId: string | null }> => {
      return ipcRenderer.invoke(IPC_CHANNELS.TAB_CLOSE, tabId);
    },

    /**
     * 切换标签页
     */
    switch: (tabId: string): Promise<{ tabs: any[]; activeTabId: string | null }> => {
      return ipcRenderer.invoke(IPC_CHANNELS.TAB_SWITCH, tabId);
    },

    /**
     * 获取标签页列表
     */
    list: (): Promise<{ tabs: any[]; activeTabId: string | null }> => {
      return ipcRenderer.invoke(IPC_CHANNELS.TAB_LIST);
    },

    /**
     * 监听标签页更新
     */
    onUpdate: (callback: (data: { tabs: any[]; activeTabId: string | null }) => void): (() => void) => {
      return createEventListener<{ tabs: any[]; activeTabId: string | null }>(
        IPC_CHANNELS.TAB_UPDATE,
        callback
      );
    }
  },

  // ==================== Skills API ====================
  skills: {
    /**
     * 获取所有技能
     */
    getAll: (): Promise<SkillDefinition[]> => {
      return ipcRenderer.invoke(IPC_CHANNELS.SKILLS_GET_ALL);
    },

    /**
     * 获取单个技能
     */
    get: (skillName: string): Promise<SkillDefinition | null> => {
      return ipcRenderer.invoke(IPC_CHANNELS.SKILLS_GET, skillName);
    },

    /**
     * 执行技能
     */
    execute: (context: SkillExecutionContext): Promise<SkillResult> => {
      return ipcRenderer.invoke(IPC_CHANNELS.SKILLS_EXECUTE, context);
    },

    /**
     * 重载技能
     */
    reload: (skillName?: string): Promise<void> => {
      return ipcRenderer.invoke(IPC_CHANNELS.SKILLS_RELOAD, skillName);
    },

    /**
     * 启用技能
     */
    enable: (skillName: string): Promise<void> => {
      return ipcRenderer.invoke(IPC_CHANNELS.SKILLS_ENABLE, skillName);
    },

    /**
     * 禁用技能
     */
    disable: (skillName: string): Promise<void> => {
      return ipcRenderer.invoke(IPC_CHANNELS.SKILLS_DISABLE, skillName);
    }
  },

  // ==================== Memory API ====================
  memory: {
    /**
     * 创建新的酒店记忆
     */
    create: (data: any): Promise<any> => {
      return ipcRenderer.invoke(IPC_CHANNELS.MEMORY_CREATE, data);
    },

    /**
     * 检索酒店记忆
     */
    retrieve: (query: any): Promise<any> => {
      return ipcRenderer.invoke(IPC_CHANNELS.MEMORY_RETRIEVE, query);
    },

    /**
     * 更新酒店记忆
     */
    update: (id: string, updates: any): Promise<any> => {
      return ipcRenderer.invoke(IPC_CHANNELS.MEMORY_UPDATE, id, updates);
    },

    /**
     * 删除酒店记忆
     */
    delete: (id: string, requireConfirm?: boolean): Promise<any> => {
      return ipcRenderer.invoke(IPC_CHANNELS.MEMORY_DELETE, id, requireConfirm);
    },

    /**
     * 导入记忆数据
     */
    import: (jsonData: string): Promise<any> => {
      return ipcRenderer.invoke(IPC_CHANNELS.MEMORY_IMPORT, jsonData);
    },

    /**
     * 导出记忆数据
     */
    export: (): Promise<any> => {
      return ipcRenderer.invoke(IPC_CHANNELS.MEMORY_EXPORT);
    },

    /**
     * 获取统计信息
     */
    stats: (): Promise<any> => {
      return ipcRenderer.invoke(IPC_CHANNELS.MEMORY_STATS);
    }
  },

  // ==================== Heartbeat API ====================
  heartbeat: {
    getTasks: (): Promise<any> => {
      return ipcRenderer.invoke(IPC_CHANNELS.HEARTBEAT_GET_TASKS);
    },
    updateTask: (taskId: string, updates: any): Promise<any> => {
      return ipcRenderer.invoke(IPC_CHANNELS.HEARTBEAT_UPDATE_TASK, taskId, updates);
    },
    getExecutingTasks: (): Promise<string[]> => {
      return ipcRenderer.invoke(IPC_CHANNELS.HEARTBEAT_GET_EXECUTING);
    },
    executeTask: (taskId: string): Promise<any> => {
      return ipcRenderer.invoke(IPC_CHANNELS.HEARTBEAT_EXECUTE_TASK, taskId);
    },
    onTaskStatus: (callback: (data: { taskId: string; status: string }) => void): (() => void) => {
      const handler = (_event: any, data: { taskId: string; status: string }) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.HEARTBEAT_TASK_STATUS, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.HEARTBEAT_TASK_STATUS, handler);
    }
  },

  // ==================== Dashboard API ====================
  dashboard: {
    getPublicPrices: (startTime: string): Promise<any[]> => {
      return ipcRenderer.invoke(IPC_CHANNELS.DASHBOARD_PUBLIC_PRICES, startTime);
    },
    getCompetitorPrices: (startTime: string): Promise<any[]> => {
      return ipcRenderer.invoke(IPC_CHANNELS.DASHBOARD_COMPETITOR_PRICES, startTime);
    },
    getBackendPrices: (startTime: string): Promise<any[]> => {
      return ipcRenderer.invoke(IPC_CHANNELS.DASHBOARD_BACKEND_PRICES, startTime);
    },
    getRealtimeRoomStatus: (startTime: string): Promise<any[]> => {
      return ipcRenderer.invoke(IPC_CHANNELS.DASHBOARD_REALTIME_ROOM_STATUS, startTime);
    },
    getFutureRoomStatus: (startTime: string): Promise<any[]> => {
      return ipcRenderer.invoke(IPC_CHANNELS.DASHBOARD_FUTURE_ROOM_STATUS, startTime);
    },
    getPriceSnapshots: (startTime: string): Promise<any[]> => {
      return ipcRenderer.invoke(IPC_CHANNELS.DASHBOARD_PRICE_SNAPSHOTS, startTime);
    },
    getRoomSnapshots: (startTime: string): Promise<any[]> => {
      return ipcRenderer.invoke(IPC_CHANNELS.DASHBOARD_ROOM_SNAPSHOTS, startTime);
    },
    getPriceCalendar: (startDate: string, endDate: string): Promise<any[]> => {
      return ipcRenderer.invoke(IPC_CHANNELS.DASHBOARD_PRICE_CALENDAR, startDate, endDate);
    },
    getRoomCalendar: (startDate: string, endDate: string): Promise<any[]> => {
      return ipcRenderer.invoke(IPC_CHANNELS.DASHBOARD_ROOM_CALENDAR, startDate, endDate);
    },
    getRoomMappings: (): Promise<any[]> => {
      return ipcRenderer.invoke(IPC_CHANNELS.DASHBOARD_ROOM_MAPPING);
    }
  },

  // ==================== 竞品管理 API ====================
  hotelConfig: {
    get: (): Promise<any> => {
      return ipcRenderer.invoke(IPC_CHANNELS.HOTEL_CONFIG_GET);
    },
    save: (data: { hotelName?: string; address?: string; lat?: number; lng?: number; amapPoiId?: string; pmsUrl?: string }): Promise<void> => {
      return ipcRenderer.invoke(IPC_CHANNELS.HOTEL_CONFIG_SAVE, data);
    },
  },
  roomTypes: {
    list: (): Promise<string[]> => {
      return ipcRenderer.invoke(IPC_CHANNELS.ROOM_TYPES_LIST);
    },
    add: (name: string): Promise<void> => {
      return ipcRenderer.invoke(IPC_CHANNELS.ROOM_TYPES_ADD, name);
    },
    remove: (name: string): Promise<void> => {
      return ipcRenderer.invoke(IPC_CHANNELS.ROOM_TYPES_REMOVE, name);
    },
    getMappings: (): Promise<Array<{ canonical_name: string; platform: string; platform_room_name: string }>> => {
      return ipcRenderer.invoke(IPC_CHANNELS.ROOM_MAPPING_GET_ALL);
    },
    saveMappings: (mappings: Array<{ canonicalName: string; platform: string; platformRoomName: string }>): Promise<void> => {
      return ipcRenderer.invoke(IPC_CHANNELS.ROOM_MAPPING_SAVE, mappings);
    },
  },
  competitor: {
    list: (): Promise<any[]> => {
      return ipcRenderer.invoke(IPC_CHANNELS.COMPETITOR_LIST);
    },
    add: (data: { name: string; amapPoiId?: string; address?: string; lat?: number; lng?: number; distanceMeters?: number }): Promise<number> => {
      return ipcRenderer.invoke(IPC_CHANNELS.COMPETITOR_ADD, data);
    },
    remove: (competitorId: number): Promise<void> => {
      return ipcRenderer.invoke(IPC_CHANNELS.COMPETITOR_REMOVE, competitorId);
    },
    searchNearby: (lat: number, lng: number, radius: number): Promise<any[]> => {
      return ipcRenderer.invoke(IPC_CHANNELS.COMPETITOR_SEARCH_NEARBY, lat, lng, radius);
    },
    searchByName: (keyword: string): Promise<any[]> => {
      return ipcRenderer.invoke(IPC_CHANNELS.COMPETITOR_SEARCH_BY_NAME, keyword);
    },
    resolveLocation: (hotelName: string): Promise<any> => {
      return ipcRenderer.invoke(IPC_CHANNELS.COMPETITOR_RESOLVE_LOCATION, hotelName);
    },
    resolvePlatformIds: (): Promise<{ success: boolean; message: string }> => {
      return ipcRenderer.invoke(IPC_CHANNELS.COMPETITOR_RESOLVE_PLATFORM_IDS);
    },
  },

  // ==================== App API ====================
  app: {
    getPagesPath: (): Promise<string> => {
      return ipcRenderer.invoke(IPC_CHANNELS.APP_GET_PAGES_PATH);
    },
    getDeviceId: (): Promise<string> => {
      return ipcRenderer.invoke(IPC_CHANNELS.APP_GET_DEVICE_ID);
    }
  },

  // ==================== Dialog API ====================
  dialog: {
    confirm: (message: string, title?: string): Promise<boolean> => {
      return ipcRenderer.invoke(IPC_CHANNELS.DIALOG_CONFIRM, message, title);
    }
  },

  // ==================== Focus API ====================
  focus: {
    mainWebContents: (): Promise<void> => {
      return ipcRenderer.invoke(IPC_CHANNELS.FOCUS_MAIN_WEBCONTENTS);
    }
  },

  // ==================== Login API ====================
  login: {
    onRequired: (callback: (event: { id: string; siteUrl: string; siteDomain: string; siteTitle: string }) => void): (() => void) => {
      return createEventListener(IPC_CHANNELS.LOGIN_REQUIRED, callback);
    },
    action: (event: { id: string; action: 'go_to_login' | 'done' | 'skip' }): Promise<void> => {
      return ipcRenderer.invoke(IPC_CHANNELS.LOGIN_ACTION, event);
    },
    onDismissed: (callback: (data: { id: string }) => void): (() => void) => {
      return createEventListener(IPC_CHANNELS.LOGIN_DISMISSED, callback);
    },
    onStatusAlert: (callback: (event: { platforms: string[] }) => void): (() => void) => {
      return createEventListener(IPC_CHANNELS.LOGIN_STATUS_ALERT, callback);
    },
  },

  // ==================== Login Check API（登录检测） ====================
  loginCheck: {
    run: (): Promise<any> => {
      return ipcRenderer.invoke(IPC_CHANNELS.LOGIN_CHECK_RUN);
    },
  },

  // ==================== Quality API（质检系统） ====================
  quality: {
    createTask: (input: any): Promise<any> => ipcRenderer.invoke('quality:create-task', input),
    listTasks: (): Promise<any> => ipcRenderer.invoke('quality:list-tasks'),
    getSubmitTask: (input: any): Promise<any> => ipcRenderer.invoke('quality:get-submit-task', input),
    submitTask: (input: any): Promise<any> => ipcRenderer.invoke('quality:submit-task', input),
    getSubmissionResult: (taskId: string): Promise<any> => ipcRenderer.invoke('quality:get-submission-result', taskId),
    approveSubmission: (taskId: string): Promise<any> => ipcRenderer.invoke('quality:approve-submission', taskId),
    rejectSubmission: (input: any): Promise<any> => ipcRenderer.invoke('quality:reject-submission', input),
    openAttachment: (relativePath: string): Promise<any> => ipcRenderer.invoke('quality:open-attachment', relativePath),
    openSubmitLink: (input: any): Promise<any> => ipcRenderer.invoke('quality:open-submit-link', input),
    getWebSubmitLink: (input: any): Promise<any> => ipcRenderer.invoke('quality:get-web-submit-link', input),
    copyText: (text: string): Promise<any> => ipcRenderer.invoke('quality:copy-text', text),
    httpRequest: (method: string, path: string, body?: any): Promise<any> => ipcRenderer.invoke('quality:http-request', method, path, body),
  },

  // ==================== Auth API（用户认证） ====================
  auth: {
    register: (username: string, password: string, displayName: string) => {
      return ipcRenderer.invoke(IPC_CHANNELS.AUTH_REGISTER, username, password, displayName);
    },
    login: (username: string, password: string, rememberPassword: boolean) => {
      return ipcRenderer.invoke(IPC_CHANNELS.AUTH_LOGIN, username, password, rememberPassword);
    },
    logout: () => {
      return ipcRenderer.invoke(IPC_CHANNELS.AUTH_LOGOUT);
    },
    getCurrentUser: () => {
      return ipcRenderer.invoke(IPC_CHANNELS.AUTH_GET_CURRENT_USER);
    },
    onStateChange: (callback: (user: any) => void): (() => void) => {
      const listener = (_event: any, user: any) => callback(user);
      ipcRenderer.on(IPC_CHANNELS.AUTH_ON_STATE_CHANGE, listener);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.AUTH_ON_STATE_CHANGE, listener);
    },
    getSavedCredentials: () => {
      return ipcRenderer.invoke(IPC_CHANNELS.AUTH_GET_SAVED_CREDENTIALS);
    },
    removeSavedCredential: (username: string) => {
      return ipcRenderer.invoke(IPC_CHANNELS.AUTH_REMOVE_SAVED_CREDENTIAL, username);
    },
    googleLogin: () => {
      return ipcRenderer.invoke(IPC_CHANNELS.AUTH_GOOGLE_LOGIN);
    },
  },

  // ==================== IPC Renderer (for menu events) ====================
  ipcRenderer: {
    /**
     * 监听IPC事件
     */
    on: (channel: string, callback: (event: any, ...args: any[]) => void): void => {
      // 只允许特定的频道
      const allowedChannels = ['menu:show-about'];
      if (allowedChannels.includes(channel)) {
        ipcRenderer.on(channel, callback);
      } else {
        console.warn(`Preload: Channel "${channel}" is not allowed`);
      }
    },

    /**
     * 移除IPC事件监听器
     */
    removeListener: (channel: string, callback: (event: any, ...args: any[]) => void): void => {
      ipcRenderer.removeListener(channel, callback);
    }
  }
};

/**
 * 使用contextBridge安全地暴露API到渲染进程
 * 
 * 安全特性：
 * 1. contextIsolation已启用，渲染进程和预加载脚本运行在不同的上下文
 * 2. 不直接暴露ipcRenderer或任何Node.js API
 * 3. 只暴露明确定义的、经过验证的API
 * 4. 所有IPC通信都通过invoke/on模式，确保类型安全
 */
contextBridge.exposeInMainWorld('electronAPI', electronAPI);

/**
 * 类型声明，用于TypeScript支持
 * 在渲染进程中可以通过window.electronAPI访问
 */
declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

// 日志输出，确认预加载脚本已加载
console.log('Preload script loaded successfully');
console.log('Context isolation:', process.contextIsolated);
console.log('Node integration:', process.versions.node ? 'enabled' : 'disabled');
