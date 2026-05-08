export type QualityTaskStatus = 'pending' | 'submitted' | 'approved' | 'rejected';
export type QualityReviewStatus = 'approved' | 'rejected' | null;

export interface QualityTaskItemInput {
  name: string;
  description?: string;
  requireAttachment?: boolean;
  requireRemark?: boolean;
  sortOrder?: number;
}

export interface QualityCreateTaskInput {
  taskName: string;
  storeName: string;
  dueAt?: string | null;
  instructions?: string;
  items: QualityTaskItemInput[];
}

export interface QualityTaskRecord {
  id: string;
  userId: number;
  taskName: string;
  storeName: string;
  dueAt: string | null;
  instructions: string;
  status: QualityTaskStatus;
  submitToken: string;
  submittedAt: string | null;
  createdAt: string;
  updatedAt: string;
  itemCount?: number;
}

export interface QualityTaskItemRecord {
  id: string;
  taskId: string;
  name: string;
  description: string;
  requireAttachment: boolean;
  requireRemark: boolean;
  sortOrder: number;
}

export interface QualityAttachmentUpload {
  name: string;
  type?: string;
  size?: number;
  data: ArrayBuffer | Uint8Array | number[];
}

export interface QualitySubmissionItemInput {
  itemId: string;
  remark?: string;
  attachments?: QualityAttachmentUpload[];
}

export interface QualitySubmitTaskInput {
  taskId: string;
  submitToken: string;
  items: QualitySubmissionItemInput[];
}

export interface QualityAttachmentRecord {
  relativePath: string;
  originalName: string;
  fileName: string;
  mimeType: string;
  size: number;
}

export interface QualityAttachmentView extends QualityAttachmentRecord {
  isImage: boolean;
  fileUrl?: string;
}

export interface QualitySubmissionRecord {
  id: string;
  taskId: string;
  userId: number;
  submittedAt: string;
  reviewStatus: QualityReviewStatus;
  reviewComment: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
}

export interface QualitySubmissionItemRecord {
  id: string;
  submissionId: string;
  taskItemId: string;
  remark: string;
  attachments: QualityAttachmentRecord[];
}

export interface QualityTaskWithItems {
  task: QualityTaskRecord;
  items: QualityTaskItemRecord[];
}

export interface QualitySubmissionResult {
  task: QualityTaskRecord;
  items: Array<QualityTaskItemRecord & {
    remark: string;
    attachments: QualityAttachmentView[];
  }>;
  submission: QualitySubmissionRecord | null;
  submitLink: string;
}

export interface QualityIpcResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}
