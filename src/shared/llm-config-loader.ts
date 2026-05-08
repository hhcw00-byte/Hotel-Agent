/**
 * 统一 LLM 配置加载器
 *
 * 敏感配置（API key 等）使用 Electron safeStorage 加密存储。
 * 首次加载时自动从明文 llm-config.json 迁移到加密的 llm-config.enc，然后删除明文。
 * 支持 fallback 自动切换：主 provider 不可用时自动切换到备用 provider。
 */

import * as fs from 'fs';
import * as path from 'path';
import { app, safeStorage } from 'electron';

// Import lazily to avoid circular deps when path-resolver isn't available (e.g. preload)
let _getLLMConfigPath: (() => string) | null = null;
function getLLMConfigPathSafe(): string | null {
  if (!_getLLMConfigPath) {
    try {
      const resolver = require('../main/path-resolver');
      _getLLMConfigPath = resolver.getLLMConfigPath;
    } catch {
      return null;
    }
  }
  return _getLLMConfigPath!();
}

export interface LLMFallbackConfig {
  apiKey: string;
  baseURL: string;
  model: string;
  recoveryModel?: string;
}

export interface LLMConfigFile {
  provider: string;
  apiKey: string;
  baseURL: string;
  model: string;
  recoveryModel?: string;
  temperature: number;
  maxTokens: number;
  fallback?: LLMFallbackConfig;
}

let cachedConfig: LLMConfigFile | null = null;
let _usingFallback = false;
let _fallbackSwitchTime = 0;  // 切换到 fallback 的时间戳
const FALLBACK_RETRY_INTERVAL = 5 * 60 * 1000; // 5 分钟后尝试恢复主 provider

// ─── 路径工具 ───

/** 明文 json 路径（迁移源 / 开发模式） */
function getJsonPath(): string {
  const writablePath = getLLMConfigPathSafe();
  if (writablePath && fs.existsSync(writablePath)) return writablePath;
  if (app.isPackaged) return path.join(process.resourcesPath, 'llm-config.json');
  return path.join(app.getAppPath(), 'llm-config.json');
}

/** 加密文件路径（始终在可写目录） */
function getEncPath(): string {
  const writablePath = getLLMConfigPathSafe();
  const dir = writablePath ? path.dirname(writablePath) : (app.isPackaged ? app.getPath('userData') : process.cwd());
  return path.join(dir, 'llm-config.enc');
}

// ─── 加密 / 解密 ───

function canEncrypt(): boolean {
  try { return safeStorage.isEncryptionAvailable(); } catch { return false; }
}

function encryptAndSave(config: LLMConfigFile): void {
  if (!canEncrypt()) return;
  try {
    const json = JSON.stringify(config);
    const encrypted = safeStorage.encryptString(json);
    fs.writeFileSync(getEncPath(), encrypted);
    console.log('LLMConfigLoader: Encrypted config saved to', getEncPath());
  } catch (err) {
    console.warn('LLMConfigLoader: Failed to encrypt config', err);
  }
}

function quarantineEncryptedConfig(encPath: string, reason: string): void {
  try {
    if (!fs.existsSync(encPath)) return;
    const backupPath = `${encPath}.invalid-${Date.now()}`;
    fs.renameSync(encPath, backupPath);
    console.warn(`LLMConfigLoader: Ignored unreadable encrypted config (${reason}); moved to ${backupPath}`);
  } catch (backupErr) {
    const backupMessage = backupErr instanceof Error ? backupErr.message : String(backupErr);
    console.warn(`LLMConfigLoader: Encrypted config is unreadable (${reason}) and could not be moved aside: ${backupMessage}`);
  }
}

function loadEncrypted(): LLMConfigFile | null {
  const encPath = getEncPath();
  if (!fs.existsSync(encPath) || !canEncrypt()) return null;
  try {
    const buf = fs.readFileSync(encPath);
    const json = safeStorage.decryptString(buf);
    return JSON.parse(json) as LLMConfigFile;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    quarantineEncryptedConfig(encPath, message);
    return null;
  }
}

// ─── 核心加载 ───

/**
 * 加载原始配置（带缓存）
 * 优先级：加密文件 > 明文文件（自动迁移） > 默认值
 */
function loadRawConfig(): LLMConfigFile {
  if (cachedConfig) return cachedConfig;

  // 1. 尝试加密文件
  const fromEnc = loadEncrypted();
  if (fromEnc) {
    cachedConfig = fromEnc;
    console.log('LLMConfigLoader: Loaded from encrypted store');
    return cachedConfig;
  }

  // 2. 尝试明文文件
  const jsonPath = getJsonPath();
  try {
    if (fs.existsSync(jsonPath)) {
      const content = fs.readFileSync(jsonPath, 'utf-8');
      cachedConfig = JSON.parse(content) as LLMConfigFile;
      console.log('LLMConfigLoader: Loaded plaintext from', jsonPath);

      // 自动迁移：加密保存，然后删除明文
      if (canEncrypt()) {
        encryptAndSave(cachedConfig);
        try {
          fs.unlinkSync(jsonPath);
          console.log('LLMConfigLoader: Plaintext config migrated to encrypted, deleted', jsonPath);
        } catch {}
      }
      return cachedConfig;
    }
  } catch (err) {
    console.warn('LLMConfigLoader: Failed to load plaintext config', err);
  }

  // 3. 默认值（无 key，需要用户配置）
  console.warn('LLMConfigLoader: No config found, using empty defaults');
  return {
    provider: 'openai',
    apiKey: '',
    baseURL: '',
    model: 'google/gemini-3.1-flash-lite-preview',
    temperature: 0.7,
    maxTokens: 4096,
  };
}

// ─── 公共 API ───

/**
 * 加载 LLM 配置（自动返回当前活跃的 provider 配置）
 * 如果已切换到 fallback，返回 fallback 覆盖后的配置
 */
export function loadLLMConfig(): LLMConfigFile {
  const raw = loadRawConfig();
  if (!_usingFallback || !raw.fallback) return raw;

  return {
    ...raw,
    apiKey: raw.fallback.apiKey,
    baseURL: raw.fallback.baseURL,
    model: raw.fallback.model,
    recoveryModel: raw.fallback.recoveryModel,
    fallback: raw.fallback,
  };
}

/**
 * 获取 recovery 模型名（优先用 recoveryModel 字段，否则回退到 model）
 */
export function getRecoveryModel(): string {
  const config = loadLLMConfig();
  return config.recoveryModel || config.model;
}

/**
 * 保存配置（加密写入磁盘，同时更新内存缓存）
 */
export function saveLLMConfig(config: LLMConfigFile): void {
  cachedConfig = config;
  if (canEncrypt()) {
    encryptAndSave(config);
  } else {
    // safeStorage 不可用时回退到明文（极少见）
    const jsonPath = getLLMConfigPathSafe() || getJsonPath();
    fs.writeFileSync(jsonPath, JSON.stringify(config, null, 2), 'utf-8');
  }
}

/**
 * 切换到 fallback provider
 */
export function switchToFallback(): boolean {
  const raw = loadRawConfig();
  if (!raw.fallback || !raw.fallback.apiKey) {
    console.warn('LLMConfigLoader: No fallback config available');
    return false;
  }
  if (_usingFallback) return true;
  _usingFallback = true;
  _fallbackSwitchTime = Date.now();
  console.log('LLMConfigLoader: ⚡ Switched to fallback provider:', raw.fallback.baseURL);
  return true;
}

/** 切换回主 provider */
export function switchToPrimary(): void {
  if (!_usingFallback) return;
  _usingFallback = false;
  _fallbackSwitchTime = 0;
  console.log('LLMConfigLoader: ✅ Switched back to primary provider');
}

/** 当前是否在使用 fallback */
export function isUsingFallback(): boolean {
  return _usingFallback;
}

/**
 * 判断是否应该尝试恢复主 provider
 * 切换到 fallback 超过 5 分钟后，下次调用自动尝试主 provider
 */
export function shouldTryPrimary(): boolean {
  if (!_usingFallback) return false;
  return Date.now() - _fallbackSwitchTime >= FALLBACK_RETRY_INTERVAL;
}

/**
 * 尝试恢复主 provider（供外部调用）
 * 如果距离上次切换已超过间隔时间，自动切回主 provider
 * 调用方应在主 provider 再次失败时重新调用 switchToFallback()
 */
export function tryRecoverPrimary(): boolean {
  if (shouldTryPrimary()) {
    switchToPrimary();
    return true;
  }
  return false;
}

/**
 * 判断错误是否属于 provider 不可用（网络错误/5xx/429）
 */
export function isProviderUnavailableError(err: any): boolean {
  if (!err) return false;
  const code = err.code || '';
  if (['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET', 'ERR_TLS_CERT_ALTNAME_INVALID'].includes(code)) {
    return true;
  }
  const status = err.status || err.statusCode || 0;
  if (status === 401 || status === 403 || status === 429 || status === 502 || status === 503 || status === 504 || status === 520 || status === 521 || status === 522 || status === 524) {
    return true;
  }
  const msg = String(err.message || '');
  if (/connect|timeout|ECONNREFUSED|ETIMEDOUT|network|fetch failed|not available in your region|socket hang up|ECONNRESET|ENOTFOUND|getaddrinfo|certificate|ssl|tls|abort/i.test(msg)) {
    return true;
  }
  // OpenRouter / 代理类错误
  if (/openrouter|rate.limit|quota|billing|insufficient|blocked|unavailable|unreachable/i.test(msg)) {
    return true;
  }
  const errType = String(err.type || err.name || '');
  if (/ConnectionError|NetworkError|FetchError|AbortError|TypeError/i.test(errType)) {
    return true;
  }
  return false;
}

/** 清除缓存，下次调用 loadLLMConfig 会重新读取 */
export function clearLLMConfigCache(): void {
  cachedConfig = null;
}
