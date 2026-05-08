import { BrowserWindow, clipboard, ipcMain, net } from 'electron';
import * as path from 'path';
import type { Pool } from 'mysql2/promise';
import { databaseManager } from '../../../database/dist/database-manager';
import { QualityFileStore } from './quality-file-store';
import { QualityRepository } from './quality-repository';
import { initializeQualitySchema } from './quality-schema';
import { QualityService } from './quality-service';
import type { QualityIpcResult } from './quality-types';
import { QualityWebServer } from './quality-web-server';

export const QUALITY_IPC_CHANNELS = {
  CREATE_TASK: 'quality:create-task',
  LIST_TASKS: 'quality:list-tasks',
  GET_SUBMIT_TASK: 'quality:get-submit-task',
  SUBMIT_TASK: 'quality:submit-task',
  GET_SUBMISSION_RESULT: 'quality:get-submission-result',
  APPROVE_SUBMISSION: 'quality:approve-submission',
  REJECT_SUBMISSION: 'quality:reject-submission',
  OPEN_ATTACHMENT: 'quality:open-attachment',
  OPEN_SUBMIT_LINK: 'quality:open-submit-link',
  GET_WEB_SUBMIT_LINK: 'quality:get-web-submit-link',
  COPY_TEXT: 'quality:copy-text',
  HTTP_REQUEST: 'quality:http-request',
} as const;

let isRegistered = false;
let servicePromise: Promise<QualityService> | null = null;
let webServer: QualityWebServer | null = null;
const submitWindows = new Set<BrowserWindow>();

export function registerQualityHandlers(): void {
  resetQualityHandlers();

  ipcMain.handle(QUALITY_IPC_CHANNELS.CREATE_TASK, async (_event, input) => {
    return invokeQuality(async (service) => service.createTask(input));
  });

  ipcMain.handle(QUALITY_IPC_CHANNELS.LIST_TASKS, async () => {
    return invokeQuality(async (service) => service.listTasks());
  });

  ipcMain.handle(QUALITY_IPC_CHANNELS.GET_SUBMIT_TASK, async (_event, input) => {
    return invokeQuality(async (service) => service.getSubmitTask(input));
  });

  ipcMain.handle(QUALITY_IPC_CHANNELS.SUBMIT_TASK, async (_event, input) => {
    return invokeQuality(async (service) => service.submitTask(input));
  });

  ipcMain.handle(QUALITY_IPC_CHANNELS.GET_SUBMISSION_RESULT, async (_event, taskId: string) => {
    return invokeQuality(async (service) => service.getSubmissionResult(taskId));
  });

  ipcMain.handle(QUALITY_IPC_CHANNELS.APPROVE_SUBMISSION, async (_event, taskId: string) => {
    return invokeQuality(async (service) => service.approveSubmission(taskId));
  });

  ipcMain.handle(QUALITY_IPC_CHANNELS.REJECT_SUBMISSION, async (_event, input: { taskId?: string; reason?: string }) => {
    return invokeQuality(async (service) => service.rejectSubmission(input));
  });

  ipcMain.handle(QUALITY_IPC_CHANNELS.OPEN_ATTACHMENT, async (_event, relativePath: string) => {
    return invokeQuality(async (service) => {
      await service.openAttachment(relativePath);
      return { opened: true };
    });
  });

  ipcMain.handle(QUALITY_IPC_CHANNELS.OPEN_SUBMIT_LINK, async (_event, input: { taskId?: string; submitToken?: string }) => {
    return invokePlain(async () => {
      const taskId = requireText(input?.taskId, '缺少 taskId');
      const submitToken = requireText(input?.submitToken, '缺少 submitToken');
      await openSubmitWindow(taskId, submitToken);
      return { opened: true };
    });
  });

  ipcMain.handle(QUALITY_IPC_CHANNELS.GET_WEB_SUBMIT_LINK, async (_event, input: { taskId?: string; submitToken?: string }) => {
    return invokePlain(async () => {
      const taskId = requireText(input?.taskId, '缺少 taskId');
      const submitToken = requireText(input?.submitToken, '缺少 submitToken');
      return getQualityWebServer().getSubmitLink({ taskId, submitToken });
    });
  });

  ipcMain.handle(QUALITY_IPC_CHANNELS.COPY_TEXT, async (_event, text: string) => {
    return invokeQuality(async () => {
      clipboard.writeText(String(text || ''));
      return { copied: true };
    });
  });

  // HTTP 代理：打包后 file:// 页面无法直接 fetch https://，通过主进程 Electron net 模块代发
  ipcMain.handle(QUALITY_IPC_CHANNELS.HTTP_REQUEST, async (_event, method: string, urlPath: string, body?: any) => {
    const QUALITY_SERVICE_BASE_URL = 'https://www.intent-computing.com/hotel-agent/api';
    const baseUrl = QUALITY_SERVICE_BASE_URL.replace(/\/+$/, '');
    const normalizedPath = String(urlPath || '').replace(/^\/+/, '');
    const fullUrl = baseUrl + '/' + normalizedPath;

    let userId = 0;
    try { userId = databaseManager.getUserId() || 0; } catch {}

    try {
      const headers: Record<string, string> = {
        'Accept': 'application/json',
        'X-Quality-User-Id': String(userId),
      };
      const postData = body != null ? JSON.stringify(body) : undefined;
      if (postData) {
        headers['Content-Type'] = 'application/json; charset=utf-8';
      }

      const response = await net.fetch(fullUrl, {
        method: (method || 'GET').toUpperCase(),
        headers,
        body: postData,
      });

      const text = await response.text();
      try {
        return JSON.parse(text);
      } catch {
        return { success: false, error: 'Invalid JSON: ' + text.slice(0, 200) };
      }
    } catch (err: any) {
      return { success: false, error: err.message || String(err) };
    }
  });

  getQualityWebServer().start();
  isRegistered = true;
  console.log('Quality IPC handlers registered:', Object.values(QUALITY_IPC_CHANNELS).join(', '));
}

function resetQualityHandlers(): void {
  for (const channel of Object.values(QUALITY_IPC_CHANNELS)) {
    try {
      ipcMain.removeHandler(channel);
    } catch {
      // ignored
    }
  }
  isRegistered = false;
}

async function invokeQuality<T>(handler: (service: QualityService) => Promise<T>): Promise<QualityIpcResult<T>> {
  try {
    const service = await getQualityService();
    const data = await handler(service);
    return { success: true, data };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function invokePlain<T>(handler: () => Promise<T>): Promise<QualityIpcResult<T>> {
  try {
    const data = await handler();
    return { success: true, data };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function getQualityService(): Promise<QualityService> {
  if (!servicePromise) {
    servicePromise = createQualityService();
  }
  try {
    return await servicePromise;
  } catch (error) {
    servicePromise = null;
    throw error;
  }
}

function getQualityWebServer(): QualityWebServer {
  if (!webServer) {
    webServer = new QualityWebServer(() => getQualityService());
  }
  return webServer;
}

async function createQualityService(): Promise<QualityService> {
  const pool = await databaseManager.initializeQualitySchema(async (currentPool: Pool) => {
    await initializeQualitySchema(currentPool);
  });
  return new QualityService(
    new QualityRepository(pool),
    new QualityFileStore(),
    () => databaseManager.getUserId()
  );
}

async function openSubmitWindow(taskId: string, submitToken: string): Promise<void> {
  const submitHtmlPath = path.join(__dirname, '../renderer/pages/quality/quality-submit.html');
  const preloadPath = path.join(__dirname, '../preload/index.js');
  const win = new BrowserWindow({
    width: 1000,
    height: 800,
    minWidth: 760,
    minHeight: 560,
    show: true,
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });

  submitWindows.add(win);
  win.on('closed', () => {
    submitWindows.delete(win);
  });

  await win.loadFile(submitHtmlPath, {
    query: {
      taskId: String(taskId),
      submitToken: String(submitToken),
    },
  });
}

function requireText(value: unknown, message: string): string {
  const text = String(value || '').trim();
  if (!text) throw new Error(message);
  return text;
}
