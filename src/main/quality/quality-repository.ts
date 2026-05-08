import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import type {
  QualityAttachmentRecord,
  QualitySubmissionItemRecord,
  QualitySubmissionRecord,
  QualityTaskItemRecord,
  QualityTaskRecord,
  QualityTaskStatus,
  QualityTaskWithItems,
} from './quality-types';

interface CreateTaskArgs {
  task: QualityTaskRecord;
  items: QualityTaskItemRecord[];
}

interface SubmitTransactionArgs {
  taskId: string;
  userId: number;
  submittedAt: string;
  items: Array<{
    taskItemId: string;
    remark: string;
    attachments: QualityAttachmentRecord[];
  }>;
}

interface ReviewSubmissionArgs {
  taskId: string;
  userId: number;
  reviewStatus: 'approved' | 'rejected';
  reviewComment: string | null;
  reviewedAt: string;
  reviewedBy: string;
}

export class QualityRepository {
  constructor(private readonly pool: Pool) {}

  async createTask(args: CreateTaskArgs): Promise<QualityTaskWithItems> {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute(
        `INSERT INTO quality_tasks
         (id, user_id, task_name, store_name, due_at, instructions, status, submit_token, submitted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          args.task.id,
          args.task.userId,
          args.task.taskName,
          args.task.storeName,
          args.task.dueAt,
          args.task.instructions,
          args.task.status,
          args.task.submitToken,
          args.task.submittedAt,
        ]
      );

      for (const item of args.items) {
        await conn.execute(
          `INSERT INTO quality_task_items
           (id, task_id, item_name, item_desc, require_attachment, require_remark, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            item.id,
            item.taskId,
            item.name,
            item.description,
            item.requireAttachment ? 1 : 0,
            item.requireRemark ? 1 : 0,
            item.sortOrder,
          ]
        );
      }

      await conn.commit();
      return { task: args.task, items: args.items };
    } catch (error) {
      await rollbackQuietly(conn);
      throw error;
    } finally {
      conn.release();
    }
  }

  async listTasks(userId: number): Promise<QualityTaskRecord[]> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT t.*, COALESCE(i.item_count, 0) AS item_count
       FROM quality_tasks t
       LEFT JOIN (
         SELECT task_id, COUNT(*) AS item_count
         FROM quality_task_items
         GROUP BY task_id
       ) i ON i.task_id = t.id
       WHERE t.user_id = ?
       ORDER BY t.created_at DESC`,
      [userId]
    );
    return rows.map(mapTaskRow);
  }

  async getTaskWithItems(taskId: string, userId: number): Promise<QualityTaskWithItems | null> {
    const task = await this.getTask(taskId, userId);
    if (!task) return null;
    const items = await this.getTaskItems(taskId);
    return { task, items };
  }

  async getTaskWithItemsByToken(taskId: string, submitToken: string, userId: number): Promise<QualityTaskWithItems | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT * FROM quality_tasks
       WHERE id = ? AND submit_token = ? AND user_id = ?
       LIMIT 1`,
      [taskId, submitToken, userId]
    );
    if (rows.length === 0) return null;
    const task = mapTaskRow(rows[0]);
    const items = await this.getTaskItems(taskId);
    return { task, items };
  }

  async getSubmissionResult(taskId: string, userId: number): Promise<{
    taskWithItems: QualityTaskWithItems;
    submission: QualitySubmissionRecord | null;
    submissionItems: QualitySubmissionItemRecord[];
  } | null> {
    const taskWithItems = await this.getTaskWithItems(taskId, userId);
    if (!taskWithItems) return null;

    const submission = await this.getSubmission(taskId, userId);
    if (!submission) {
      return { taskWithItems, submission: null, submissionItems: [] };
    }

    const [itemRows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT * FROM quality_submission_items
       WHERE submission_id = ?
       ORDER BY created_at ASC`,
      [submission.id]
    );

    return {
      taskWithItems,
      submission,
      submissionItems: itemRows.map(mapSubmissionItemRow),
    };
  }

  async getSubmission(taskId: string, userId: number): Promise<QualitySubmissionRecord | null> {
    const [submissionRows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT * FROM quality_submissions
       WHERE task_id = ? AND user_id = ?
       LIMIT 1`,
      [taskId, userId]
    );
    return submissionRows.length > 0 ? mapSubmissionRow(submissionRows[0]) : null;
  }

  async insertSubmissionTransaction(args: SubmitTransactionArgs): Promise<QualitySubmissionRecord> {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();

      const [taskRows] = await conn.execute<RowDataPacket[]>(
        `SELECT id, status FROM quality_tasks
         WHERE id = ? AND user_id = ?
         FOR UPDATE`,
        [args.taskId, args.userId]
      );
      if (taskRows.length === 0) {
        throw new Error('\u4efb\u52a1\u4e0d\u5b58\u5728');
      }

      const currentStatus = String(taskRows[0].status || 'pending');
      if (currentStatus === 'submitted') {
        throw new Error('\u8be5\u4efb\u52a1\u5df2\u63d0\u4ea4\uff0c\u7b49\u5f85\u5ba1\u6838');
      }
      if (currentStatus === 'approved') {
        throw new Error('\u8be5\u4efb\u52a1\u5df2\u5ba1\u6838\u901a\u8fc7');
      }

      const [submissionRows] = await conn.execute<RowDataPacket[]>(
        `SELECT * FROM quality_submissions
         WHERE task_id = ? AND user_id = ?
         LIMIT 1
         FOR UPDATE`,
        [args.taskId, args.userId]
      );

      let submissionId = '';
      if (submissionRows.length > 0) {
        submissionId = String(submissionRows[0].id);
        await conn.execute(
          `DELETE FROM quality_submission_items
           WHERE submission_id = ?`,
          [submissionId]
        );
        await conn.execute(
          `UPDATE quality_submissions
           SET submitted_at = ?, review_status = NULL, review_comment = NULL, reviewed_at = NULL, reviewed_by = NULL
           WHERE id = ? AND user_id = ?`,
          [args.submittedAt, submissionId, args.userId]
        );
      } else {
        submissionId = createUuid();
        await conn.execute(
          `INSERT INTO quality_submissions (id, task_id, user_id, submitted_at)
           VALUES (?, ?, ?, ?)`,
          [submissionId, args.taskId, args.userId, args.submittedAt]
        );
      }

      for (const item of args.items) {
        await conn.execute(
          `INSERT INTO quality_submission_items
           (id, submission_id, task_id, item_id, remark, attachments_json)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            createUuid(),
            submissionId,
            args.taskId,
            item.taskItemId,
            item.remark,
            JSON.stringify(item.attachments),
          ]
        );
      }

      await conn.execute(
        `UPDATE quality_tasks
         SET status = 'submitted', submitted_at = ?
         WHERE id = ? AND user_id = ?`,
        [args.submittedAt, args.taskId, args.userId]
      );

      await conn.commit();
      return {
        id: submissionId,
        taskId: args.taskId,
        userId: args.userId,
        submittedAt: args.submittedAt,
        reviewStatus: null,
        reviewComment: null,
        reviewedAt: null,
        reviewedBy: null,
      };
    } catch (error: any) {
      await rollbackQuietly(conn);
      if (error?.code === 'ER_DUP_ENTRY') {
        throw new Error('\u8be5\u4efb\u52a1\u5df2\u63d0\u4ea4\uff0c\u7b49\u5f85\u5ba1\u6838');
      }
      throw error;
    } finally {
      conn.release();
    }
  }

  async reviewSubmission(args: ReviewSubmissionArgs): Promise<QualitySubmissionRecord> {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();

      const [taskRows] = await conn.execute<RowDataPacket[]>(
        `SELECT id FROM quality_tasks
         WHERE id = ? AND user_id = ?
         FOR UPDATE`,
        [args.taskId, args.userId]
      );
      if (taskRows.length === 0) {
        throw new Error('\u4efb\u52a1\u4e0d\u5b58\u5728');
      }

      const [submissionRows] = await conn.execute<RowDataPacket[]>(
        `SELECT * FROM quality_submissions
         WHERE task_id = ? AND user_id = ?
         LIMIT 1
         FOR UPDATE`,
        [args.taskId, args.userId]
      );
      if (submissionRows.length === 0) {
        throw new Error('\u4efb\u52a1\u5c1a\u672a\u63d0\u4ea4\uff0c\u65e0\u6cd5\u5ba1\u6838');
      }

      const submissionId = String(submissionRows[0].id);
      await conn.execute(
        `UPDATE quality_submissions
         SET review_status = ?, review_comment = ?, reviewed_at = ?, reviewed_by = ?
         WHERE id = ? AND user_id = ?`,
        [args.reviewStatus, args.reviewComment, args.reviewedAt, args.reviewedBy, submissionId, args.userId]
      );

      await conn.execute(
        `UPDATE quality_tasks
         SET status = ?
         WHERE id = ? AND user_id = ?`,
        [args.reviewStatus, args.taskId, args.userId]
      );

      await conn.commit();
      return {
        id: submissionId,
        taskId: args.taskId,
        userId: args.userId,
        submittedAt: formatDbDate(submissionRows[0].submitted_at) || '',
        reviewStatus: args.reviewStatus,
        reviewComment: args.reviewComment,
        reviewedAt: args.reviewedAt,
        reviewedBy: args.reviewedBy,
      };
    } catch (error) {
      await rollbackQuietly(conn);
      throw error;
    } finally {
      conn.release();
    }
  }

  private async getTask(taskId: string, userId: number): Promise<QualityTaskRecord | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT * FROM quality_tasks WHERE id = ? AND user_id = ? LIMIT 1`,
      [taskId, userId]
    );
    return rows.length > 0 ? mapTaskRow(rows[0]) : null;
  }

  private async getTaskItems(taskId: string): Promise<QualityTaskItemRecord[]> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT * FROM quality_task_items
       WHERE task_id = ?
       ORDER BY sort_order ASC, created_at ASC`,
      [taskId]
    );
    return rows.map(mapTaskItemRow);
  }
}

function mapTaskRow(row: RowDataPacket): QualityTaskRecord {
  return {
    id: String(row.id),
    userId: Number(row.user_id),
    taskName: String(row.task_name || ''),
    storeName: String(row.store_name || row.hotel_name || '-'),
    dueAt: formatDbDate(row.due_at),
    instructions: String(row.instructions || ''),
    status: String(row.status || 'pending') as QualityTaskStatus,
    submitToken: String(row.submit_token || ''),
    submittedAt: formatDbDate(row.submitted_at),
    createdAt: formatDbDate(row.created_at) || '',
    updatedAt: formatDbDate(row.updated_at) || '',
    itemCount: Number(row.item_count || 0),
  };
}

function mapTaskItemRow(row: RowDataPacket): QualityTaskItemRecord {
  return {
    id: String(row.id),
    taskId: String(row.task_id),
    name: String(row.item_name || ''),
    description: String(row.item_desc || row.item_description || ''),
    requireAttachment: Number(row.require_attachment || 0) === 1,
    requireRemark: Number(row.require_remark || 0) === 1,
    sortOrder: Number(row.sort_order || 0),
  };
}

function mapSubmissionRow(row: RowDataPacket): QualitySubmissionRecord {
  const reviewStatus = String(row.review_status || '');
  return {
    id: String(row.id),
    taskId: String(row.task_id),
    userId: Number(row.user_id),
    submittedAt: formatDbDate(row.submitted_at) || '',
    reviewStatus: reviewStatus === 'approved' || reviewStatus === 'rejected' ? reviewStatus : null,
    reviewComment: row.review_comment == null ? null : String(row.review_comment),
    reviewedAt: formatDbDate(row.reviewed_at),
    reviewedBy: row.reviewed_by == null ? null : String(row.reviewed_by),
  };
}

function mapSubmissionItemRow(row: RowDataPacket): QualitySubmissionItemRecord {
  return {
    id: String(row.id),
    submissionId: String(row.submission_id),
    taskItemId: String(row.item_id || row.task_item_id),
    remark: String(row.remark || ''),
    attachments: parseAttachments(row.attachments_json),
  };
}

function parseAttachments(value: unknown): QualityAttachmentRecord[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function formatDbDate(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) {
    return value.toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).replace(',', '');
  }
  return String(value);
}

function createUuid(): string {
  return require('crypto').randomUUID();
}

async function rollbackQuietly(conn: PoolConnection): Promise<void> {
  try {
    await conn.rollback();
  } catch {
    // ignored
  }
}
