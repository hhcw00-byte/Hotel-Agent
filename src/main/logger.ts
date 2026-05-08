/**
 * Logger - 日志系统
 * 
 * 职责：
 * - 实现日志级别（debug, info, warn, error）
 * - 实现日志文件写入
 * - 实现日志轮转（可选）
 * - 提供结构化日志记录
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

/**
 * 日志级别
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * 日志条目接口
 */
export interface LogEntry {
  timestamp: number;
  level: LogLevel;
  category: string;
  message: string;
  stack?: string;
  context?: Record<string, any>;
}

/**
 * 日志配置接口
 */
export interface LoggerConfig {
  level: LogLevel;
  filePath: string;
  maxFileSize: number;
  maxFiles: number;
  enableConsole: boolean;
}

/**
 * 日志级别优先级
 */
const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

/**
 * Logger类
 */
export class Logger {
  private config: LoggerConfig;
  private logFilePath: string;
  private writeStream: fs.WriteStream | null = null;

  constructor(config: Partial<LoggerConfig> = {}) {
    // 合并默认配置
    this.config = {
      level: config.level || 'info',
      filePath: config.filePath || path.join(app.getPath('userData'), 'hotel-ai-browser.log'),
      maxFileSize: config.maxFileSize || 10 * 1024 * 1024, // 10MB
      maxFiles: config.maxFiles || 5,
      enableConsole: config.enableConsole !== undefined ? config.enableConsole : true
    };

    this.logFilePath = this.config.filePath;

    // 初始化日志文件
    this.initializeLogFile();

    console.log('Logger: Initialized');
    console.log('Logger: Log file:', this.logFilePath);
  }

  /**
   * 初始化日志文件
   */
  private initializeLogFile(): void {
    try {
      // 确保日志目录存在
      const logDir = path.dirname(this.logFilePath);
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }

      // 检查文件大小，如果超过限制则轮转
      if (fs.existsSync(this.logFilePath)) {
        const stats = fs.statSync(this.logFilePath);
        if (stats.size >= this.config.maxFileSize) {
          this.rotateLogFile();
        }
      }

      // 创建写入流
      this.writeStream = fs.createWriteStream(this.logFilePath, { flags: 'a' });

      // 写入启动标记
      this.writeToFile({
        timestamp: Date.now(),
        level: 'info',
        category: 'system',
        message: '=== Application Started ==='
      });
    } catch (error) {
      console.error('Logger: Failed to initialize log file:', error);
    }
  }

  /**
   * 轮转日志文件
   */
  private rotateLogFile(): void {
    try {
      // 关闭当前写入流
      if (this.writeStream) {
        this.writeStream.end();
        this.writeStream = null;
      }

      // 删除最旧的日志文件
      const oldestLogFile = `${this.logFilePath}.${this.config.maxFiles}`;
      if (fs.existsSync(oldestLogFile)) {
        fs.unlinkSync(oldestLogFile);
      }

      // 重命名现有日志文件
      for (let i = this.config.maxFiles - 1; i >= 1; i--) {
        const oldFile = `${this.logFilePath}.${i}`;
        const newFile = `${this.logFilePath}.${i + 1}`;
        if (fs.existsSync(oldFile)) {
          fs.renameSync(oldFile, newFile);
        }
      }

      // 重命名当前日志文件
      if (fs.existsSync(this.logFilePath)) {
        fs.renameSync(this.logFilePath, `${this.logFilePath}.1`);
      }

      console.log('Logger: Log file rotated');
    } catch (error) {
      console.error('Logger: Failed to rotate log file:', error);
    }
  }

  /**
   * 写入日志到文件
   */
  private writeToFile(entry: LogEntry): void {
    if (!this.writeStream) {
      return;
    }

    try {
      // 格式化日志条目
      const logLine = this.formatLogEntry(entry);
      
      // 写入文件
      this.writeStream.write(logLine + '\n');

      // 检查文件大小
      const stats = fs.statSync(this.logFilePath);
      if (stats.size >= this.config.maxFileSize) {
        this.rotateLogFile();
        this.initializeLogFile();
      }
    } catch (error) {
      console.error('Logger: Failed to write to log file:', error);
    }
  }

  /**
   * 格式化日志条目
   */
  private formatLogEntry(entry: LogEntry): string {
    const timestamp = new Date(entry.timestamp).toISOString();
    const level = entry.level.toUpperCase().padEnd(5);
    const category = entry.category.padEnd(15);
    
    let logLine = `[${timestamp}] [${level}] [${category}] ${entry.message}`;

    // 添加上下文信息
    if (entry.context && Object.keys(entry.context).length > 0) {
      logLine += ` | Context: ${JSON.stringify(entry.context)}`;
    }

    // 添加堆栈信息
    if (entry.stack) {
      logLine += `\n${entry.stack}`;
    }

    return logLine;
  }

  /**
   * 检查是否应该记录该级别的日志
   */
  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.config.level];
  }

  /**
   * 记录日志
   */
  private log(level: LogLevel, category: string, message: string, context?: Record<string, any>): void {
    // 检查日志级别
    if (!this.shouldLog(level)) {
      return;
    }

    // 创建日志条目
    const entry: LogEntry = {
      timestamp: Date.now(),
      level,
      category,
      message,
      context
    };

    // 输出到控制台
    if (this.config.enableConsole) {
      this.logToConsole(entry);
    }

    // 写入文件
    this.writeToFile(entry);
  }

  /**
   * 输出到控制台
   */
  private logToConsole(entry: LogEntry): void {
    const timestamp = new Date(entry.timestamp).toISOString();
    const prefix = `[${timestamp}] [${entry.level.toUpperCase()}] [${entry.category}]`;
    const message = `${prefix} ${entry.message}`;

    switch (entry.level) {
      case 'debug':
        console.debug(message, entry.context || '');
        break;
      case 'info':
        console.info(message, entry.context || '');
        break;
      case 'warn':
        console.warn(message, entry.context || '');
        break;
      case 'error':
        console.error(message, entry.context || '');
        if (entry.stack) {
          console.error(entry.stack);
        }
        break;
    }
  }

  /**
   * Debug级别日志
   */
  debug(category: string, message: string, context?: Record<string, any>): void {
    this.log('debug', category, message, context);
  }

  /**
   * Info级别日志
   */
  info(category: string, message: string, context?: Record<string, any>): void {
    this.log('info', category, message, context);
  }

  /**
   * Warn级别日志
   */
  warn(category: string, message: string, context?: Record<string, any>): void {
    this.log('warn', category, message, context);
  }

  /**
   * Error级别日志
   */
  error(category: string, message: string, context?: Record<string, any>): void {
    // 如果context中有error对象，提取堆栈信息
    let stack: string | undefined;
    if (context && context.error instanceof Error) {
      stack = context.error.stack;
      context.errorMessage = context.error.message;
      delete context.error; // 移除error对象，避免循环引用
    }

    const entry: LogEntry = {
      timestamp: Date.now(),
      level: 'error',
      category,
      message,
      context,
      stack
    };

    // 输出到控制台
    if (this.config.enableConsole) {
      this.logToConsole(entry);
    }

    // 写入文件
    this.writeToFile(entry);
  }

  /**
   * 记录异常
   */
  exception(category: string, error: Error, context?: Record<string, any>): void {
    this.error(category, error.message, {
      ...context,
      error
    });
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<LoggerConfig>): void {
    this.config = {
      ...this.config,
      ...config
    };

    console.log('Logger: Configuration updated');
  }

  /**
   * 获取日志文件路径
   */
  getLogFilePath(): string {
    return this.logFilePath;
  }

  /**
   * 清理资源
   */
  destroy(): void {
    console.log('Logger: Destroying');

    // 写入关闭标记
    if (this.writeStream) {
      this.writeToFile({
        timestamp: Date.now(),
        level: 'info',
        category: 'system',
        message: '=== Application Stopped ==='
      });

      // 关闭写入流
      this.writeStream.end();
      this.writeStream = null;
    }

    console.log('Logger: Destroyed');
  }
}

/**
 * 全局Logger实例
 */
let globalLogger: Logger | null = null;

/**
 * 获取全局Logger实例
 */
export function getLogger(): Logger {
  if (!globalLogger) {
    globalLogger = new Logger();
  }
  return globalLogger;
}

/**
 * 初始化全局Logger
 */
export function initializeLogger(config?: Partial<LoggerConfig>): Logger {
  globalLogger = new Logger(config);
  return globalLogger;
}

/**
 * 销毁全局Logger
 */
export function destroyLogger(): void {
  if (globalLogger) {
    globalLogger.destroy();
    globalLogger = null;
  }
}
