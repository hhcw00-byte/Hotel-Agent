/**
 * AuthManager - 认证管理器
 *
 * 职责：
 * - 用户注册、认证、会话管理
 * - 凭证存储（记住密码）
 * - Session 持久化（electron-store，7天有效期）
 * - 连接 hotel_agent_system 数据库管理 users 表
 */

import mysql, { Pool, RowDataPacket } from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import Store from 'electron-store';
import { safeStorage } from 'electron';
import type {
  CloudDbConfig,
  AuthenticatedUser,
  RegisterResult,
  LoginResult,
  SavedCredential,
  AuthSession,
} from '../shared/types';

/** Session 最大有效期：7 天 */
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** 最多保存的凭证数量 */
const MAX_SAVED_CREDENTIALS = 10;

/** getSavedCredentials 返回的最大条数 */
const MAX_DISPLAY_CREDENTIALS = 5;

interface StoredCredential {
  username: string;
  displayName: string;
  encryptedPassword: string | null;
  lastLoginAt: number;
}

export class AuthManager {
  private systemPool: Pool | null = null;
  private dbConfig: CloudDbConfig;
  private store: Store;
  private currentSession: AuthSession | null = null;

  constructor(dbConfig: CloudDbConfig) {
    this.dbConfig = dbConfig;
    this.store = new Store({ name: 'auth' });
  }

  // ==================== 2.1: 初始化 ====================

  /**
   * 初始化：连接 hotel_agent_system 数据库，创建 users 表
   */
  async initialize(): Promise<void> {
    // 先确保 hotel_agent_system 数据库存在
    const tempPool = mysql.createPool({
      host: this.dbConfig.host,
      port: this.dbConfig.port,
      user: this.dbConfig.user,
      password: this.dbConfig.password,
      connectTimeout: 10000,
    });
    await tempPool.execute(
      'CREATE DATABASE IF NOT EXISTS hotel_agent_system CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
    );
    await tempPool.end();

    // 连接 hotel_agent_system
    this.systemPool = mysql.createPool({
      host: this.dbConfig.host,
      port: this.dbConfig.port,
      user: this.dbConfig.user,
      password: this.dbConfig.password,
      database: 'hotel_agent_system',
      connectTimeout: 10000,
    });

    await this.systemPool.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(64) NOT NULL UNIQUE COMMENT '登录用户名',
        password_hash VARCHAR(255) NOT NULL COMMENT 'bcrypt哈希',
        display_name VARCHAR(64) NOT NULL COMMENT '显示名称',
        status ENUM('active','disabled') NOT NULL DEFAULT 'active',
        last_login_at DATETIME NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    // Add Google auth columns if they don't exist
    for (const stmt of [
      "ALTER TABLE users ADD COLUMN google_email VARCHAR(255) NULL UNIQUE COMMENT 'Google邮箱'",
      "ALTER TABLE users ADD COLUMN auth_type VARCHAR(16) NOT NULL DEFAULT 'local' COMMENT '认证类型: local/google'",
    ]) {
      try { await this.systemPool.execute(stmt); } catch (e: any) {
        // Ignore "Duplicate column name" error (column already exists)
        if (!e.message?.includes('Duplicate column')) throw e;
      }
    }
  }

  // ==================== 2.2: 注册 ====================

  /**
   * 注册新用户
   */
  async register(username: string, password: string, displayName: string): Promise<RegisterResult> {
    if (!this.systemPool) throw new Error('AuthManager not initialized');

    // 校验用户名格式：2-32位，字母数字下划线
    if (!/^[a-zA-Z0-9_]{2,32}$/.test(username)) {
      return { success: false, error: '用户名只能包含字母、数字和下划线，长度2-32位' };
    }

    // 校验密码长度：6-64位
    if (password.length < 6 || password.length > 64) {
      return { success: false, error: '密码长度需要6-64位' };
    }

    // 校验显示名称：非空且≤32字符
    if (!displayName.trim() || displayName.length > 32) {
      return { success: false, error: '显示名称不能为空，最长32个字符' };
    }

    // 检查用户名唯一性
    const [existing] = await this.systemPool.execute<RowDataPacket[]>(
      'SELECT id FROM users WHERE username = ?',
      [username]
    );
    if (existing.length > 0) {
      return { success: false, error: '用户名已存在' };
    }

    // bcrypt 哈希密码后存储
    const hash = await bcrypt.hash(password, 10);
    await this.systemPool.execute(
      'INSERT INTO users (username, password_hash, display_name) VALUES (?, ?, ?)',
      [username, hash, displayName.trim()]
    );

    return { success: true };
  }

  // ==================== 2.3: 登录 ====================

  /**
   * 用户登录
   */
  async login(username: string, password: string, rememberPassword: boolean = false): Promise<LoginResult> {
    if (!this.systemPool) throw new Error('AuthManager not initialized');

    const [rows] = await this.systemPool.execute<RowDataPacket[]>(
      'SELECT id, username, display_name, password_hash, status FROM users WHERE username = ?',
      [username]
    );

    if (rows.length === 0) {
      return { success: false, error: '用户名或密码错误' };
    }

    const user = rows[0];

    // 校验账号状态
    if (user.status === 'disabled') {
      return { success: false, error: '账号已被禁用' };
    }

    // bcrypt.compare 校验密码
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return { success: false, error: '用户名或密码错误' };
    }

    // 更新 last_login_at
    await this.systemPool.execute(
      'UPDATE users SET last_login_at = NOW() WHERE id = ?',
      [user.id]
    );

    // 创建 session 并持久化到 electron-store
    this.currentSession = {
      userId: user.id,
      username: user.username,
      displayName: user.display_name,
      loginTimestamp: Date.now(),
    };
    this.store.set('session', this.currentSession);

    // 保存凭证
    this.updateSavedCredential(username, user.display_name, rememberPassword ? password : null);

    return {
      success: true,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
      },
    };
  }

  // ==================== 2.4: 自动登录 ====================

  /**
   * Google 登录：根据 Google 邮箱查找或自动注册用户，然后创建 session
   */
  async loginWithGoogle(email: string, displayName: string): Promise<LoginResult> {
    if (!this.systemPool) throw new Error('AuthManager not initialized');

    // 1. 查找已有 Google 用户
    const [rows] = await this.systemPool.execute<RowDataPacket[]>(
      'SELECT id, username, display_name, status FROM users WHERE google_email = ?',
      [email]
    );

    let user: any;

    if (rows.length > 0) {
      user = rows[0];
      if (user.status === 'disabled') {
        return { success: false, error: '账号已被禁用' };
      }
      // 更新 last_login_at
      await this.systemPool.execute(
        'UPDATE users SET last_login_at = NOW() WHERE id = ?',
        [user.id]
      );
    } else {
      // 2. 自动注册：username = email prefix (确保唯一), password = random hash
      const crypto = require('crypto');
      let username = email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '_').substring(0, 32);
      if (username.length < 2) username = 'g_' + username;

      // 确保用户名唯一
      const [existing] = await this.systemPool.execute<RowDataPacket[]>(
        'SELECT id FROM users WHERE username = ?',
        [username]
      );
      if (existing.length > 0) {
        username = username.substring(0, 26) + '_' + crypto.randomBytes(3).toString('hex');
      }

      const randomPassword = crypto.randomBytes(32).toString('hex');
      const hash = await bcrypt.hash(randomPassword, 10);
      const effectiveDisplayName = (displayName || email.split('@')[0]).substring(0, 64);

      const [insertResult] = await this.systemPool.execute<any>(
        'INSERT INTO users (username, password_hash, display_name, google_email, auth_type) VALUES (?, ?, ?, ?, ?)',
        [username, hash, effectiveDisplayName, email, 'google']
      );

      user = {
        id: insertResult.insertId,
        username,
        display_name: effectiveDisplayName,
      };
    }

    // 3. 创建 session
    this.currentSession = {
      userId: user.id,
      username: user.username,
      displayName: user.display_name,
      loginTimestamp: Date.now(),
    };
    this.store.set('session', this.currentSession);
    // 标记 Google 登录成功时间，拦截器在冷却期内放行后续 Google OAuth 请求
    this.store.set('googleAuthSuccessTime', Date.now());

    return {
      success: true,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
      },
    };
  }

  // ==================== 2.5: 自动登录 ====================

  /**
   * 尝试自动登录：从 electron-store 读取 session，检查有效期和用户状态
   */
  async tryAutoLogin(): Promise<LoginResult> {
    const session = this.store.get('session') as AuthSession | undefined;
    if (!session) {
      return { success: false, error: '无登录态' };
    }

    // 检查 7 天有效期
    if (Date.now() - session.loginTimestamp > SESSION_MAX_AGE_MS) {
      this.store.delete('session');
      return { success: false, error: '登录已过期' };
    }

    // 验证用户状态仍为 active
    if (!this.systemPool) throw new Error('AuthManager not initialized');

    const [rows] = await this.systemPool.execute<RowDataPacket[]>(
      'SELECT status FROM users WHERE id = ?',
      [session.userId]
    );

    const result = rows[0];
    if (!result || result.status !== 'active') {
      this.store.delete('session');
      return { success: false, error: '账号状态异常' };
    }

    this.currentSession = session;
    return {
      success: true,
      user: {
        id: session.userId,
        username: session.username,
        displayName: session.displayName,
      },
    };
  }

  // ==================== 2.5: logout / getCurrentUser / isAuthenticated ====================

  /**
   * 登出：清除 session
   */
  async logout(): Promise<void> {
    this.currentSession = null;
    this.store.delete('session');
  }

  /**
   * 获取当前已认证用户，未登录返回 null
   */
  getCurrentUser(): AuthenticatedUser | null {
    if (!this.currentSession) return null;
    return {
      id: this.currentSession.userId,
      username: this.currentSession.username,
      displayName: this.currentSession.displayName,
    };
  }

  /**
   * 是否已认证
   */
  isAuthenticated(): boolean {
    return this.currentSession !== null;
  }

  // ==================== 2.6: 凭证管理 ====================

  /**
   * 获取已保存凭证列表（不含密码明文），按 lastLoginAt 降序，最多返回 5 条显示
   */
  getSavedCredentials(): SavedCredential[] {
    const creds = (this.store.get('savedCredentials') || []) as StoredCredential[];
    return creds
      .map((c) => ({
        username: c.username,
        displayName: c.displayName,
        hasPassword: !!c.encryptedPassword,
        lastLoginAt: c.lastLoginAt || 0,
      }))
      .sort((a, b) => b.lastLoginAt - a.lastLoginAt)
      .slice(0, MAX_DISPLAY_CREDENTIALS);
  }

  /**
   * 使用 Electron safeStorage 解密密码
   */
  getDecryptedPassword(username: string): string | null {
    const creds = (this.store.get('savedCredentials') || []) as StoredCredential[];
    const cred = creds.find((c) => c.username === username);
    if (!cred?.encryptedPassword) return null;
    try {
      return safeStorage.decryptString(Buffer.from(cred.encryptedPassword, 'base64'));
    } catch {
      return null;
    }
  }

  /**
   * 移除指定用户凭证
   */
  removeSavedCredential(username: string): void {
    const creds = (this.store.get('savedCredentials') || []) as StoredCredential[];
    this.store.set(
      'savedCredentials',
      creds.filter((c) => c.username !== username)
    );
  }

  /**
   * 更新已保存凭证：safeStorage 不可用时跳过密码保存，最多保存 10 条
   */
  private updateSavedCredential(
    username: string,
    displayName: string,
    plainPassword: string | null
  ): void {
    const creds = (this.store.get('savedCredentials') || []) as StoredCredential[];
    const existing = creds.find((c) => c.username === username);

    let encryptedPassword: string | null = null;
    if (plainPassword && safeStorage.isEncryptionAvailable()) {
      try {
        encryptedPassword = safeStorage.encryptString(plainPassword).toString('base64');
      } catch {
        /* 加密失败则不保存密码 */
      }
    }

    if (existing) {
      existing.displayName = displayName;
      existing.lastLoginAt = Date.now();
      if (plainPassword !== null) {
        existing.encryptedPassword = encryptedPassword;
      }
    } else {
      creds.push({
        username,
        displayName,
        encryptedPassword,
        lastLoginAt: Date.now(),
      });
    }

    // 按 lastLoginAt 降序排列，保留最近的 10 条
    this.store.set(
      'savedCredentials',
      creds
        .sort((a, b) => (b.lastLoginAt || 0) - (a.lastLoginAt || 0))
        .slice(0, MAX_SAVED_CREDENTIALS)
    );
  }

  // ==================== 2.7: 销毁 ====================

  /**
   * 关闭数据库连接池
   */
  async destroy(): Promise<void> {
    if (this.systemPool) {
      await this.systemPool.end();
      this.systemPool = null;
    }
  }
}
