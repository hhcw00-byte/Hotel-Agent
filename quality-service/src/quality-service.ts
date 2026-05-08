import * as crypto from 'crypto';
import { QualityFileStore } from './quality-file-store';
import { QualityRepository } from './quality-repository';
import type {
  QualityAttachmentRecord,
  QualityCreateTaskInput,
  QualitySubmissionRecord,
  QualitySubmissionResult,
  QualitySubmitTaskInput,
  QualityTaskItemRecord,
  QualityTaskRecord,
  QualityTaskWithItems,
} from './quality-types';

export class QualityService {
  constructor(
    private readonly repository: QualityRepository,
    private readonly fileStore: QualityFileStore,
    private readonly getUserId: () => number,
    private readonly getBaseUrl: () => string
  ) {}

  async createTask(input: QualityCreateTaskInput): Promise<QualityTaskWithItems & { taskId: string; submitToken: string; submitLink: string; submitUrl: string }> {
    const userId = this.requireUserId();
    const taskId = crypto.randomUUID();
    const submitToken = crypto.randomBytes(24).toString('hex');
    const taskName = requireText(input.taskName, '\u4efb\u52a1\u540d\u79f0\u4e0d\u80fd\u4e3a\u7a7a');
    const storeName = requireText(input.storeName, '\u6267\u884c\u95e8\u5e97\u4e0d\u80fd\u4e3a\u7a7a');
    const items = normalizeItems(taskId, input.items);

    const task: QualityTaskRecord = {
      id: taskId,
      userId,
      taskName,
      storeName,
      dueAt: normalizeDateTime(input.dueAt || null),
      instructions: String(input.instructions || '').trim(),
      status: 'pending',
      submitToken,
      submittedAt: null,
      createdAt: '',
      updatedAt: '',
      itemCount: items.length,
    };

    const created = await this.repository.createTask({ task, items });
    return {
      ...created,
      taskId: created.task.id,
      submitToken: created.task.submitToken,
      submitLink: this.buildSubmitLink(created.task),
      submitUrl: this.buildSubmitLink(created.task),
    };
  }

  async listTasks(): Promise<Array<QualityTaskRecord & { submitLink: string }>> {
    const userId = this.requireUserId();
    const tasks = await this.repository.listTasks(userId);
    return tasks.map((task) => ({
      ...task,
      submitLink: this.buildSubmitLink(task),
    }));
  }

  async getSubmitTask(input: { taskId: string; submitToken: string }): Promise<QualityTaskWithItems & {
    submitLink: string;
    alreadySubmitted: boolean;
    submission: QualitySubmissionRecord | null;
  }> {
    const userId = this.requireUserId();
    const taskId = requireText(input.taskId, '\u7f3a\u5c11 taskId');
    const submitToken = requireText(input.submitToken, '\u7f3a\u5c11 submitToken');
    const taskWithItems = await this.repository.getTaskWithItemsByToken(taskId, submitToken, userId);
    if (!taskWithItems) {
      throw new Error('\u4efb\u52a1\u94fe\u63a5\u65e0\u6548\u6216\u5df2\u5931\u6548');
    }
    const submission = await this.repository.getSubmission(taskId, userId);
    return {
      ...taskWithItems,
      submission,
      submitLink: this.buildSubmitLink(taskWithItems.task),
      alreadySubmitted: taskWithItems.task.status === 'submitted' || taskWithItems.task.status === 'approved',
    };
  }

  async submitTask(input: QualitySubmitTaskInput): Promise<{ submittedAt: string }> {
    const userId = this.requireUserId();
    const taskId = requireText(input.taskId, '\u7f3a\u5c11 taskId');
    const submitToken = requireText(input.submitToken, '\u7f3a\u5c11 submitToken');
    const taskWithItems = await this.repository.getTaskWithItemsByToken(taskId, submitToken, userId);
    if (!taskWithItems) {
      throw new Error('\u4efb\u52a1\u94fe\u63a5\u65e0\u6548\u6216\u5df2\u5931\u6548');
    }
    if (taskWithItems.task.status === 'submitted') {
      throw new Error('\u8be5\u4efb\u52a1\u5df2\u63d0\u4ea4\uff0c\u7b49\u5f85\u5ba1\u6838');
    }
    if (taskWithItems.task.status === 'approved') {
      throw new Error('\u8be5\u4efb\u52a1\u5df2\u5ba1\u6838\u901a\u8fc7');
    }

    const submittedItems = new Map((input.items || []).map((item) => [item.itemId, item]));
    const validationErrors = validateSubmissionItems(taskWithItems.items, submittedItems);
    if (validationErrors.length > 0) {
      throw new Error(validationErrors.join('\n'));
    }

    const savedAttachments: QualityAttachmentRecord[] = [];
    try {
      const transactionItems = [];
      for (const item of taskWithItems.items) {
        const submitted = submittedItems.get(item.id);
        const attachments = await this.fileStore.saveFiles(taskId, item.id, submitted?.attachments || []);
        savedAttachments.push(...attachments);
        transactionItems.push({
          taskItemId: item.id,
          remark: String(submitted?.remark || '').trim(),
          attachments,
        });
      }

      const submittedAt = getChinaTimeString();
      await this.repository.insertSubmissionTransaction({
        taskId,
        userId,
        submittedAt,
        items: transactionItems,
      });
      return { submittedAt };
    } catch (error) {
      await this.fileStore.cleanupAttachments(savedAttachments);
      throw error;
    }
  }

  async getSubmissionResult(taskId: string): Promise<QualitySubmissionResult> {
    const userId = this.requireUserId();
    const result = await this.repository.getSubmissionResult(requireText(taskId, '\u7f3a\u5c11 taskId'), userId);
    if (!result) {
      throw new Error('\u4efb\u52a1\u4e0d\u5b58\u5728');
    }

    const submissionByItem = new Map(result.submissionItems.map((item) => [item.taskItemId, item]));
    return {
      task: result.taskWithItems.task,
      submission: result.submission,
      submitLink: this.buildSubmitLink(result.taskWithItems.task),
      items: result.taskWithItems.items.map((item) => {
        const submissionItem = submissionByItem.get(item.id);
        return {
          ...item,
          remark: submissionItem?.remark || '',
          attachments: (submissionItem?.attachments || []).map((attachment) => this.fileStore.decorateAttachment(attachment)),
        };
      }),
    };
  }

  async approveSubmission(taskId: string): Promise<QualitySubmissionRecord> {
    const userId = this.requireUserId();
    const reviewedAt = getChinaTimeString();
    return this.repository.reviewSubmission({
      taskId: requireText(taskId, '\u7f3a\u5c11 taskId'),
      userId,
      reviewStatus: 'approved',
      reviewComment: null,
      reviewedAt,
      reviewedBy: String(userId),
    });
  }

  async rejectSubmission(input: { taskId?: string; reason?: string }): Promise<QualitySubmissionRecord> {
    const userId = this.requireUserId();
    const reviewedAt = getChinaTimeString();
    return this.repository.reviewSubmission({
      taskId: requireText(input?.taskId, '\u7f3a\u5c11 taskId'),
      userId,
      reviewStatus: 'rejected',
      reviewComment: requireText(input?.reason, '\u9a73\u56de\u7406\u7531\u4e0d\u80fd\u4e3a\u7a7a'),
      reviewedAt,
      reviewedBy: String(userId),
    });
  }

  async openAttachment(relativePath: string): Promise<void> {
    this.fileStore.resolveRelativePath(requireText(relativePath, '\u7f3a\u5c11\u9644\u4ef6\u8def\u5f84'));
  }

  buildSubmitLink(task: Pick<QualityTaskRecord, 'id' | 'submitToken'>): string {
    const baseUrl = this.getBaseUrl().replace(/\/+$/, '');
    return `${baseUrl}/quality/submit?taskId=${encodeURIComponent(task.id)}&submitToken=${encodeURIComponent(task.submitToken)}`;
  }

  private requireUserId(): number {
    const userId = this.getUserId();
    if (!userId || userId <= 0) {
      throw new Error('\u7528\u6237\u672a\u767b\u5f55');
    }
    return userId;
  }
}

function normalizeItems(taskId: string, inputItems: any[]): QualityTaskItemRecord[] {
  if (!Array.isArray(inputItems)) {
    throw new Error('\u68c0\u67e5\u9879\u4e0d\u80fd\u4e3a\u7a7a');
  }

  const items = inputItems
    .map((item, index) => ({
      id: crypto.randomUUID(),
      taskId,
      name: String(item?.name || item?.itemName || '').trim(),
      description: String(item?.description || item?.itemDesc || '').trim(),
      requireAttachment: Boolean(item?.requireAttachment),
      requireRemark: Boolean(item?.requireRemark),
      sortOrder: Number.isFinite(Number(item?.sortOrder)) ? Number(item.sortOrder) : index + 1,
    }))
    .filter((item) => item.name);

  if (items.length === 0) {
    throw new Error('\u81f3\u5c11\u9700\u8981\u4e00\u4e2a\u68c0\u67e5\u9879');
  }
  return items;
}

function validateSubmissionItems(
  dbItems: QualityTaskItemRecord[],
  submittedItems: Map<string, { remark?: string; attachments?: unknown[] }>
): string[] {
  const errors: string[] = [];
  for (const item of dbItems) {
    const submitted = submittedItems.get(item.id);
    const remark = String(submitted?.remark || '').trim();
    const attachments = submitted?.attachments || [];
    if (item.requireAttachment && attachments.length === 0) {
      errors.push(`${item.name} \u7f3a\u5c11\u73b0\u573a\u7167\u7247/\u9644\u4ef6`);
    }
    if (item.requireRemark && !remark) {
      errors.push(`${item.name} \u7f3a\u5c11\u5907\u6ce8`);
    }
  }
  return errors;
}

function requireText(value: unknown, message: string): string {
  const text = String(value || '').trim();
  if (!text) throw new Error(message);
  return text;
}

function normalizeDateTime(value: string | null): string | null {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace('T', ' ');
  return normalized.length === 16 ? `${normalized}:00` : normalized.slice(0, 19);
}

function getChinaTimeString(): string {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).replace(',', '');
}
