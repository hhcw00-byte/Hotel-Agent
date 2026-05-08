/**
 * 应用程序常量
 */

export const APP_NAME = 'Hotel-Agent';
export const APP_VERSION = '1.0.0';

// 窗口默认配置
export const DEFAULT_WINDOW_WIDTH = 1400;
export const DEFAULT_WINDOW_HEIGHT = 900;
export const MIN_WINDOW_WIDTH = 1200;
export const MIN_WINDOW_HEIGHT = 800;
export const MIN_PANEL_WIDTH = 300;
export const DEFAULT_SPLIT_RATIO = 0.6; // 左侧60%，右侧40%

// 网页默认配置
export const DEFAULT_HOME_URL = 'https://www.google.com';

// Pi Agent默认配置
export const DEFAULT_PI_PROVIDER = 'openai';
export const DEFAULT_PI_MODEL = 'google/gemini-3.1-flash-lite-preview';
export const DEFAULT_TEMPERATURE = 0.7;
export const DEFAULT_MAX_TOKENS = 4096;

// 日志配置
export const DEFAULT_LOG_LEVEL = 'info';
export const DEFAULT_LOG_FILE = 'hotel-ai-browser.log';
export const DEFAULT_MAX_LOG_SIZE = 10 * 1024 * 1024; // 10MB
export const DEFAULT_MAX_LOG_FILES = 5;

// 对话配置
export const MAX_CONVERSATION_HISTORY = 100;
export const MESSAGE_TIMESTAMP_FORMAT = 'HH:mm:ss';

// 超时配置
export const IPC_TIMEOUT = 30000; // 30秒
export const API_TIMEOUT = 60000; // 60秒
export const NAVIGATION_TIMEOUT = 30000; // 30秒
