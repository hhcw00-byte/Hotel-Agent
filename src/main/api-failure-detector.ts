import type { SkillResult } from '../shared/types';

/**
 * API 失效检测器
 * 检测 API 脚本执行结果是否为 API 失效（区别于脚本逻辑错误）
 */

// HTTP status codes that indicate API failure
const API_FAILURE_STATUS_CODES = [401, 403, 404, 500, 502, 503];

// Network error patterns
const NETWORK_ERROR_PATTERNS = [
  /ECONNREFUSED/i,
  /ETIMEDOUT/i,
  /ENOTFOUND/i,
];

// Business error patterns (token/session expired)
const BUSINESS_ERROR_PATTERNS = [
  /token.*expired/i,
  /session.*invalid/i,
  /unauthorized/i,
];

/**
 * 检测 SkillResult 是否表示 API 失效
 */
export function detectAPIFailure(result: SkillResult): boolean {
  if (result.success) return false;

  const error = result.error || '';

  // Check HTTP status codes
  for (const code of API_FAILURE_STATUS_CODES) {
    if (new RegExp(`HTTP\\s*${code}`).test(error)) return true;
  }

  // Check network errors
  for (const pattern of NETWORK_ERROR_PATTERNS) {
    if (pattern.test(error)) return true;
  }

  // Check business errors
  for (const pattern of BUSINESS_ERROR_PATTERNS) {
    if (pattern.test(error)) return true;
  }

  return false;
}

/** Maximum consecutive failures before marking as deprecated */
const MAX_CONSECUTIVE_FAILURES = 3;

/**
 * API 失效追踪器
 * 维护每个 API skill 的连续失败计数
 */
export class APIFailureTracker {
  private failureCounts: Map<string, number> = new Map();
  private deprecatedSkills: Set<string> = new Set();

  /**
   * 记录一次失败
   * @returns true if the skill is now deprecated (>= 3 consecutive failures)
   */
  recordFailure(skillName: string): boolean {
    const count = (this.failureCounts.get(skillName) || 0) + 1;
    this.failureCounts.set(skillName, count);

    if (count >= MAX_CONSECUTIVE_FAILURES) {
      this.deprecatedSkills.add(skillName);
      return true;
    }
    return false;
  }

  /**
   * 记录一次成功（重置失败计数）
   */
  recordSuccess(skillName: string): void {
    this.failureCounts.set(skillName, 0);
    this.deprecatedSkills.delete(skillName);
  }

  /**
   * 检查 skill 是否已被标记为 deprecated
   */
  isDeprecated(skillName: string): boolean {
    return this.deprecatedSkills.has(skillName);
  }

  /**
   * 获取连续失败次数
   */
  getFailureCount(skillName: string): number {
    return this.failureCounts.get(skillName) || 0;
  }
}
