/**
 * Memory System IPC Handlers
 * Main进程IPC处理器，暴露记忆系统API供Renderer进程调用
 */

import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { IPC_CHANNELS } from '../../shared/types';
import { MemoryManager } from './manager';
import { HotelType, MemoryQuery, OperationResult, PlatformInfo } from './types';

/**
 * Memory IPC Handler类
 * 负责注册和处理所有记忆系统相关的IPC调用
 */
export class MemoryIPCHandler {
  private manager: MemoryManager;
  private isRegistered = false;

  constructor(manager?: MemoryManager) {
    this.manager = manager || new MemoryManager();
  }

  /**
   * 注册所有IPC处理器
   */
  async register(): Promise<void> {
    if (this.isRegistered) {
      console.warn('Memory IPC handlers already registered');
      return;
    }

    // 初始化记忆系统
    const initResult = await this.manager.initialize();
    if (!initResult.success) {
      console.error('Failed to initialize memory system:', initResult.error);
    }

    // 注册各个IPC处理器
    this.registerCreateHandler();
    this.registerRetrieveHandler();
    this.registerUpdateHandler();
    this.registerDeleteHandler();
    this.registerImportHandler();
    this.registerExportHandler();
    this.registerStatsHandler();

    this.isRegistered = true;
    console.log('Memory IPC handlers registered successfully');
  }

  /**
   * 注销所有IPC处理器
   */
  unregister(): void {
    if (!this.isRegistered) {
      return;
    }

    ipcMain.removeHandler(IPC_CHANNELS.MEMORY_CREATE);
    ipcMain.removeHandler(IPC_CHANNELS.MEMORY_RETRIEVE);
    ipcMain.removeHandler(IPC_CHANNELS.MEMORY_UPDATE);
    ipcMain.removeHandler(IPC_CHANNELS.MEMORY_DELETE);
    ipcMain.removeHandler(IPC_CHANNELS.MEMORY_IMPORT);
    ipcMain.removeHandler(IPC_CHANNELS.MEMORY_EXPORT);
    ipcMain.removeHandler(IPC_CHANNELS.MEMORY_STATS);

    this.isRegistered = false;
    console.log('Memory IPC handlers unregistered');
  }

  /**
   * 注册 memory:create 处理器
   */
  private registerCreateHandler(): void {
    ipcMain.handle(
      IPC_CHANNELS.MEMORY_CREATE,
      async (
        _event: IpcMainInvokeEvent,
        data: {
          name: string;
          type: HotelType;
          platforms?: PlatformInfo[];
          source?: 'user_input' | 'auto_learning';
        }
      ): Promise<OperationResult> => {
        try {
          return await this.manager.createHotel(data);
        } catch (error) {
          return this.createErrorResponse(error);
        }
      }
    );
  }

  /**
   * 注册 memory:retrieve 处理器
   */
  private registerRetrieveHandler(): void {
    ipcMain.handle(
      IPC_CHANNELS.MEMORY_RETRIEVE,
      async (
        _event: IpcMainInvokeEvent,
        query: MemoryQuery
      ): Promise<OperationResult> => {
        try {
          return await this.manager.retrieveHotels(query);
        } catch (error) {
          return this.createErrorResponse(error);
        }
      }
    );
  }

  /**
   * 注册 memory:update 处理器
   */
  private registerUpdateHandler(): void {
    ipcMain.handle(
      IPC_CHANNELS.MEMORY_UPDATE,
      async (
        _event: IpcMainInvokeEvent,
        id: string,
        updates: Partial<any>
      ): Promise<OperationResult> => {
        try {
          return await this.manager.updateHotel(id, updates);
        } catch (error) {
          return this.createErrorResponse(error);
        }
      }
    );
  }

  /**
   * 注册 memory:delete 处理器
   */
  private registerDeleteHandler(): void {
    ipcMain.handle(
      IPC_CHANNELS.MEMORY_DELETE,
      async (
        _event: IpcMainInvokeEvent,
        id: string,
        requireConfirm?: boolean
      ): Promise<OperationResult> => {
        try {
          return await this.manager.deleteHotel(id, requireConfirm);
        } catch (error) {
          return this.createErrorResponse(error);
        }
      }
    );
  }

  /**
   * 注册 memory:import 处理器
   */
  private registerImportHandler(): void {
    ipcMain.handle(
      IPC_CHANNELS.MEMORY_IMPORT,
      async (
        _event: IpcMainInvokeEvent,
        jsonData: string
      ): Promise<OperationResult> => {
        try {
          return await this.manager.importMemories(jsonData);
        } catch (error) {
          return this.createErrorResponse(error);
        }
      }
    );
  }

  /**
   * 注册 memory:export 处理器
   */
  private registerExportHandler(): void {
    ipcMain.handle(
      IPC_CHANNELS.MEMORY_EXPORT,
      async (_event: IpcMainInvokeEvent): Promise<OperationResult> => {
        try {
          return await this.manager.exportMemories();
        } catch (error) {
          return this.createErrorResponse(error);
        }
      }
    );
  }

  /**
   * 注册 memory:stats 处理器
   */
  private registerStatsHandler(): void {
    ipcMain.handle(
      IPC_CHANNELS.MEMORY_STATS,
      async (_event: IpcMainInvokeEvent): Promise<OperationResult> => {
        try {
          return await this.manager.getStats();
        } catch (error) {
          return this.createErrorResponse(error);
        }
      }
    );
  }

  /**
   * 创建统一的错误响应格式
   */
  private createErrorResponse(error: unknown): OperationResult {
    return {
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error instanceof Error ? error.message : String(error),
        details: error
      }
    };
  }

  /**
   * 获取Manager实例（用于测试）
   */
  getManager(): MemoryManager {
    return this.manager;
  }
}

// 导出单例实例
let memoryIPCHandler: MemoryIPCHandler | null = null;

/**
 * 获取或创建Memory IPC Handler单例
 */
export function getMemoryIPCHandler(): MemoryIPCHandler {
  if (!memoryIPCHandler) {
    memoryIPCHandler = new MemoryIPCHandler();
  }
  return memoryIPCHandler;
}

/**
 * 初始化并注册Memory IPC处理器
 */
export async function initializeMemoryIPC(): Promise<void> {
  const handler = getMemoryIPCHandler();
  await handler.register();
}

/**
 * 注销Memory IPC处理器
 */
export function cleanupMemoryIPC(): void {
  if (memoryIPCHandler) {
    memoryIPCHandler.unregister();
    memoryIPCHandler = null;
  }
}
