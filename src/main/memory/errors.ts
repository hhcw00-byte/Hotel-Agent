/**
 * Agent记忆系统错误类定义
 */

/**
 * 基础错误类
 */
export class MemoryError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: any
  ) {
    super(message);
    this.name = 'MemoryError';
  }
}

/**
 * 验证错误
 */
export class ValidationError extends MemoryError {
  constructor(code: string, message: string, details?: any) {
    super(code, message, details);
    this.name = 'ValidationError';
  }
}

/**
 * 资源错误
 */
export class ResourceError extends MemoryError {
  constructor(code: string, message: string, details?: any) {
    super(code, message, details);
    this.name = 'ResourceError';
  }
}

/**
 * 存储错误
 */
export class StorageError extends MemoryError {
  constructor(code: string, message: string, details?: any) {
    super(code, message, details);
    this.name = 'StorageError';
  }
}

/**
 * 序列化错误
 */
export class SerializationError extends MemoryError {
  constructor(code: string, message: string, details?: any) {
    super(code, message, details);
    this.name = 'SerializationError';
  }
}

/**
 * 系统错误
 */
export class SystemError extends MemoryError {
  constructor(code: string, message: string, details?: any) {
    super(code, message, details);
    this.name = 'SystemError';
  }
}

/**
 * 错误码常量
 */
export const ErrorCodes = {
  // 验证错误
  INVALID_HOTEL_NAME: 'INVALID_HOTEL_NAME',
  INVALID_HOTEL_TYPE: 'INVALID_HOTEL_TYPE',
  INVALID_PLATFORM: 'INVALID_PLATFORM',
  MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',
  
  // 资源错误
  HOTEL_NOT_FOUND: 'HOTEL_NOT_FOUND',
  DUPLICATE_HOTEL: 'DUPLICATE_HOTEL',
  IMPORT_CONFLICT: 'IMPORT_CONFLICT',
  
  // 存储错误
  FILE_READ_ERROR: 'FILE_READ_ERROR',
  FILE_WRITE_ERROR: 'FILE_WRITE_ERROR',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  CORRUPTED_DATA: 'CORRUPTED_DATA',
  
  // 序列化错误
  INVALID_JSON: 'INVALID_JSON',
  PARSE_ERROR: 'PARSE_ERROR',
  ENCODING_ERROR: 'ENCODING_ERROR',
  
  // 系统错误
  NOT_INITIALIZED: 'NOT_INITIALIZED',
  UNAUTHORIZED: 'UNAUTHORIZED',
  INTERNAL_ERROR: 'INTERNAL_ERROR'
} as const;
