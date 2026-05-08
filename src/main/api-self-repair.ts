/**
 * API 自修复协调器
 * 
 * 当 API 脚本执行失败时，协调重新发现和修复流程。
 */

import type { SkillResult, SkillDefinition } from '../shared/types';
import type { SkillManager } from './skill-manager';
import { detectAPIFailure, APIFailureTracker } from './api-failure-detector';

// Singleton failure tracker
const failureTracker = new APIFailureTracker();

/**
 * 从 SKILL.md 内容中提取原始目标信息
 * Agent 生成的 SKILL.md 中通常包含 tab_keyword 和 target 信息
 */
export function extractTargetFromSkill(skill: SkillDefinition | null): {
  tabKeyword?: string;
  target?: string;
} {
  if (!skill) return {};
  
  const content = skill.content || '';
  
  // 尝试从 SKILL.md 内容中提取 tab_keyword 和 target
  // Agent 生成的 SKILL.md 通常在描述中包含这些信息
  const tabKeywordMatch = content.match(/tab_keyword[:\s]*["']?([^"'\n]+)["']?/i);
  const targetMatch = content.match(/target[:\s]*["']?([^"'\n]+)["']?/i);
  
  return {
    tabKeyword: tabKeywordMatch?.[1]?.trim(),
    target: targetMatch?.[1]?.trim(),
  };
}

/**
 * 处理 API 脚本执行，包含失效检测和自修复触发
 * 
 * @param skillManager - SkillManager 实例
 * @param skillName - 要执行的 skill 名称
 * @param params - 执行参数
 * @param maxRetries - 最大重试次数（默认1）
 * @returns SkillResult，如果 API 失效会附加 metadata 信息
 */
export async function handleAPIExecution(
  skillManager: SkillManager,
  skillName: string,
  params: Record<string, any>,
  maxRetries: number = 1
): Promise<SkillResult> {
  const result = await skillManager.executeSkill(skillName, params);
  
  if (result.success) {
    failureTracker.recordSuccess(skillName);
    return result;
  }
  
  // 检测是否是 API 失效
  const isAPIFailure = detectAPIFailure(result);
  
  if (!isAPIFailure) {
    // 不是 API 失效（可能是脚本逻辑错误），直接返回
    return result;
  }
  
  // 记录失败
  const isDeprecated = failureTracker.recordFailure(skillName);
  
  // 附加失效信息到结果中，供 Agent 决策
  const enhancedResult: SkillResult = {
    ...result,
    output: {
      ...((typeof result.output === 'object' && result.output) || {}),
      _apiFailure: true,
      _isDeprecated: isDeprecated,
      _failureCount: failureTracker.getFailureCount(skillName),
      _shouldRegenerate: isDeprecated, // deprecated 时应完全重新生成
      _shouldRediscover: !isDeprecated && maxRetries > 0, // 非 deprecated 时尝试重新发现
    },
  };
  
  // 检测是否为 401/unauthorized 错误，可能需要重新登录
  const error = result.error || '';
  const isUnauthorized = /401/i.test(error) || /unauthorized/i.test(error);
  if (isUnauthorized) {
    enhancedResult.output._loginRequired = true;
  }

  // 如果还有重试机会且未 deprecated，提取目标信息供 Agent 使用
  if (!isDeprecated && maxRetries > 0) {
    const skillDef = skillManager.getSkill(skillName);
    const targetInfo = extractTargetFromSkill(skillDef);
    
    let hintMessage = 'API失效，建议调用 ai-web-crawler 以 intercept_apis=true 模式重新发现API';
    if (isUnauthorized) {
      hintMessage += '。请在浏览器中重新登录目标平台';
    }

    enhancedResult.output._rediscoveryHint = {
      tabKeyword: targetInfo.tabKeyword,
      target: targetInfo.target,
      message: hintMessage,
    };
  } else if (isDeprecated) {
    let deprecatedMessage = `API连续失败${failureTracker.getFailureCount(skillName)}次，已标记为deprecated。建议完全重新生成脚本。`;
    if (isUnauthorized) {
      deprecatedMessage += '请在浏览器中重新登录目标平台';
    }

    enhancedResult.output._rediscoveryHint = {
      message: deprecatedMessage,
    };
  }
  
  return enhancedResult;
}

/**
 * 获取失效追踪器实例（用于外部查询状态）
 */
export function getFailureTracker(): APIFailureTracker {
  return failureTracker;
}
