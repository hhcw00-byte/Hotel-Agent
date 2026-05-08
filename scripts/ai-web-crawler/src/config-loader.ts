/**
 * Configuration Loader
 * Loads and validates configuration from YAML file and environment variables
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as yaml from 'js-yaml';
import { AppConfig } from './config-types';

export class ConfigLoader {
  private config: AppConfig | null = null;
  private static readonly ENCRYPTION_KEY_SEED = 'hotel-ai-browser-config-v1';

  /**
   * Derive AES-256 key from seed string using SHA-256
   */
  private deriveKey(seed: string): Buffer {
    return crypto.createHash('sha256').update(seed).digest();
  }

  /**
   * Decrypt AES-256-GCM encrypted file
   * Format: iv(12 bytes) + authTag(16 bytes) + ciphertext
   */
  private decryptFile(encryptedPath: string): string {
    const key = this.deriveKey(ConfigLoader.ENCRYPTION_KEY_SEED);
    const data = fs.readFileSync(encryptedPath);
    const iv = data.subarray(0, 12);
    const tag = data.subarray(12, 28);
    const ciphertext = data.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString('utf-8');
  }

  /**
   * Load configuration from file and environment variables
   */
  load(configPath?: string): AppConfig {
    const baseDir = configPath ? path.dirname(configPath) : path.join(__dirname, '..');
    const encPath = path.join(baseDir, 'config.enc');
    const yamlPath = configPath || path.join(baseDir, 'config.yaml');

    // Load from YAML file (prefer encrypted config.enc, fallback to config.yaml)
    let fileConfig: Partial<AppConfig> = {};
    if (fs.existsSync(encPath)) {
      const decrypted = this.decryptFile(encPath);
      fileConfig = yaml.load(decrypted) as Partial<AppConfig>;
    } else if (fs.existsSync(yamlPath)) {
      const fileContent = fs.readFileSync(yamlPath, 'utf8');
      fileConfig = yaml.load(fileContent) as Partial<AppConfig>;
    } else {
      throw new Error('Config file not found (neither config.enc nor config.yaml)');
    }

    // Merge with environment variables
    const config = this.mergeWithEnv(fileConfig);

    // Validate configuration
    this.validate(config);

    this.config = config;
    return config;
  }

  /**
   * Get current configuration
   */
  getConfig(): AppConfig {
    if (!this.config) {
      throw new Error('Configuration not loaded. Call load() first.');
    }
    return this.config;
  }

  /**
   * Try to load LLM settings from the unified llm-config.json (project root or resources/)
   */
  private loadUnifiedLLMConfig(baseDir: string): Partial<{ provider: string; api_key: string; base_url: string; model: string }> | null {
    // 向上查找 llm-config.json：baseDir -> parent -> grandparent ...
    let dir = baseDir;
    for (let i = 0; i < 5; i++) {
      const candidate = path.join(dir, 'llm-config.json');
      if (fs.existsSync(candidate)) {
        try {
          const raw = JSON.parse(fs.readFileSync(candidate, 'utf-8'));
          return {
            provider: raw.provider || 'openai',
            api_key: raw.apiKey,
            base_url: raw.baseURL,
            model: raw.model,
          };
        } catch { /* ignore parse errors */ }
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return null;
  }

  /**
   * Merge file configuration with environment variables
   */
  private mergeWithEnv(fileConfig: Partial<AppConfig>): AppConfig {
    // 优先从统一的 llm-config.json 读取 LLM 配置
    const baseDir = this.config ? path.join(__dirname, '..') : path.join(__dirname, '..');
    const unified = this.loadUnifiedLLMConfig(baseDir);

    const config: AppConfig = {
      browser: {
        default_port: this.getEnvNumber('BROWSER_PORT') || fileConfig.browser?.default_port || 9222,
        timeout: fileConfig.browser?.timeout || 90000,
        headless: this.getEnvBoolean('BROWSER_HEADLESS') ?? fileConfig.browser?.headless ?? false,
      },
      llm: {
        provider: (process.env.LLM_PROVIDER as any) || unified?.provider || fileConfig.llm?.provider || 'openai',
        api_key: process.env.LLM_API_KEY || unified?.api_key || this.resolveEnvVar(fileConfig.llm?.api_key) || '',
        base_url: process.env.LLM_BASE_URL || unified?.base_url || this.resolveEnvVar(fileConfig.llm?.base_url),
        model: process.env.LLM_MODEL || unified?.model || this.resolveEnvVar(fileConfig.llm?.model) || 'gemini-pro-vision',
        timeout: fileConfig.llm?.timeout || 45000,
        max_retries: fileConfig.llm?.max_retries ?? 1,
      },
      crawler: {
        max_navigation_steps: fileConfig.crawler?.max_navigation_steps || 20,  // 默认值从 10 调整到 20
        max_expand_steps: fileConfig.crawler?.max_expand_steps || 10,
        screenshot_quality: fileConfig.crawler?.screenshot_quality || 80,
        screenshot_max_size: fileConfig.crawler?.screenshot_max_size || 5242880, // 5MB
        wait_after_action: fileConfig.crawler?.wait_after_action || 800,
      },
      extraction: {
        max_dom_size: fileConfig.extraction?.max_dom_size || 102400, // 100KB
        include_network_data: fileConfig.extraction?.include_network_data ?? true,
        confidence_threshold: fileConfig.extraction?.confidence_threshold || 0.5,
      },
    };

    return config;
  }

  /**
   * Resolve environment variable placeholders like ${VAR_NAME}
   */
  private resolveEnvVar(value: string | undefined): string | undefined {
    if (!value) return undefined;
    
    const match = value.match(/^\$\{(.+)\}$/);
    if (match) {
      return process.env[match[1]];
    }
    return value;
  }

  /**
   * Get environment variable as number
   */
  private getEnvNumber(key: string): number | undefined {
    const value = process.env[key];
    if (!value) return undefined;
    const num = parseInt(value, 10);
    return isNaN(num) ? undefined : num;
  }

  /**
   * Get environment variable as boolean
   */
  private getEnvBoolean(key: string): boolean | undefined {
    const value = process.env[key];
    if (!value) return undefined;
    return value.toLowerCase() === 'true' || value === '1';
  }

  /**
   * Validate configuration
   */
  private validate(config: AppConfig): void {
    const errors: string[] = [];

    // Validate browser port
    if (config.browser.default_port < 1024 || config.browser.default_port > 65535) {
      errors.push('Browser port must be between 1024 and 65535');
    }

    // Validate timeouts
    if (config.browser.timeout <= 0) {
      errors.push('Browser timeout must be positive');
    }
    if (config.llm.timeout <= 0) {
      errors.push('LLM timeout must be positive');
    }

    // Validate navigation steps
    if (config.crawler.max_navigation_steps <= 0) {
      errors.push('Max navigation steps must be positive');
    }
    if (config.crawler.max_expand_steps < 0) {
      errors.push('Max expand steps must be non-negative');
    }

    // Validate screenshot settings
    if (config.crawler.screenshot_quality < 1 || config.crawler.screenshot_quality > 100) {
      errors.push('Screenshot quality must be between 1 and 100');
    }
    if (config.crawler.screenshot_max_size <= 0) {
      errors.push('Screenshot max size must be positive');
    }

    // Validate confidence threshold
    if (config.extraction.confidence_threshold < 0 || config.extraction.confidence_threshold > 1) {
      errors.push('Confidence threshold must be between 0 and 1');
    }

    if (errors.length > 0) {
      throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
    }
  }
}
