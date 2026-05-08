import mysql, { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';

export class DatabaseManager {
  private pool: Pool | null = null;
  private userId: number = 0;
  private config = {
    host: '',
    port: 3306,
    user: '',
    password: '',
    database: 'hotel_agent_data',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    charset: 'utf8mb4',
    connectTimeout: 30000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
  };

  constructor() {
    // 检查是否有环境变量配置（子进程场景）
    const envHost = process.env.DB_HOST;
    const envUser = process.env.DB_USER;
    const envPassword = process.env.DB_PASSWORD;
    const envUserId = process.env.DB_USER_ID;

    if (envHost && envUserId) {
      const parsedUserId = parseInt(envUserId, 10);
      if (isNaN(parsedUserId) || parsedUserId <= 0) {
        throw new Error('DB_USER_ID 必须为正整数');
      }
      this.userId = parsedUserId;
      this.config.host = envHost;
      this.config.port = parseInt(process.env.DB_PORT || '3306', 10);
      this.config.user = envUser || 'root';
      this.config.password = envPassword || '';
    } else {
      const requiredVars = [envHost, envUser, envPassword, envUserId];
      const hasAny = requiredVars.some(v => !!v);
      const hasAll = requiredVars.every(v => !!v);
      if (hasAny && !hasAll) {
        throw new Error('缺少数据库环境变量配置');
      }
    }
  }

  /**
   * 设置数据库连接配置
   * @param cloudConfig 云端数据库配置（host, port, user, password）
   * @param userId 当前登录用户ID
   */
  public setConfig(cloudConfig: { host: string; port: number; user: string; password: string }, userId: number): void {
    this.config.host = cloudConfig.host;
    this.config.port = cloudConfig.port;
    this.config.user = cloudConfig.user;
    this.config.password = cloudConfig.password;
    this.userId = userId;
  }

  /** 获取当前用户ID */
  public getUserId(): number {
    return this.userId;
  }

  /**
   * 初始化数据库连接池并创建表结构
   */
  public async initialize(): Promise<void> {
    try {
      const tempPool = mysql.createPool({
        host: this.config.host,
        port: this.config.port,
        user: this.config.user,
        password: this.config.password,
        charset: this.config.charset,
      });

      await tempPool.execute(
        `CREATE DATABASE IF NOT EXISTS \`${this.config.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
      );
      await tempPool.end();

      this.pool = mysql.createPool(this.config);
      await this.createTables();

      console.log('[DatabaseManager] MySQL 数据库初始化完成');
    } catch (error) {
      console.error('[DatabaseManager] 数据库初始化失败:', error);
      throw error;
    }
  }

  /**
   * 创建所有表结构
   */
  private async createTables(): Promise<void> {
    if (!this.pool) throw new Error('数据库未初始化');

    // 1. 价格快照表（所有价格数据：本店+竞品，公网+后台）
    await this.pool.execute(`
      CREATE TABLE IF NOT EXISTS price_snapshots (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        platform VARCHAR(64) NOT NULL,
        room_name VARCHAR(512) NOT NULL,
        price DECIMAL(10,2),
        original_price DECIMAL(10,2),
        currency VARCHAR(8) NOT NULL DEFAULT 'CNY',
        date DATE DEFAULT NULL,
        plan_name VARCHAR(512) DEFAULT NULL,
        cost DECIMAL(10,2) DEFAULT NULL,
        breakfast VARCHAR(64) DEFAULT NULL,
        available TINYINT(1) DEFAULT NULL,
        source_type VARCHAR(16) DEFAULT NULL,
        hotel_id INT NOT NULL DEFAULT 0,
        snapshot_time DATETIME NOT NULL,
        INDEX idx_ps_user_platform (user_id, platform),
        INDEX idx_ps_snapshot_time (snapshot_time),
        INDEX idx_ps_date (date),
        INDEX idx_ps_hotel (hotel_id)
      )
    `);

    // 2. 房态快照表（实时+远期）
    await this.pool.execute(`
      CREATE TABLE IF NOT EXISTS room_snapshots (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        platform VARCHAR(64) NOT NULL,
        room_name VARCHAR(512) NOT NULL,
        date DATE,
        total_rooms INT,
        available_rooms INT,
        occupancy_rate DECIMAL(5,2) DEFAULT NULL,
        adr DECIMAL(10,2) DEFAULT NULL,
        revpar DECIMAL(10,2) DEFAULT NULL,
        hotel_id INT NOT NULL DEFAULT 0,
        snapshot_time DATETIME NOT NULL,
        INDEX idx_rs_user_platform (user_id, platform),
        INDEX idx_rs_snapshot_time (snapshot_time),
        INDEX idx_rs_date (date),
        INDEX idx_rs_hotel (hotel_id)
      )
    `);

    // 3. 竞品主表
    await this.pool.execute(`
      CREATE TABLE IF NOT EXISTS competitors (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        name VARCHAR(255) NOT NULL,
        amap_poi_id VARCHAR(50) DEFAULT NULL,
        address VARCHAR(500) DEFAULT NULL,
        lat DECIMAL(10,7) DEFAULT NULL,
        lng DECIMAL(10,7) DEFAULT NULL,
        distance_meters INT DEFAULT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uk_user_competitor (user_id, name),
        INDEX idx_competitors_user_id (user_id)
      )
    `);

    // 4. 竞品平台ID映射表
    await this.pool.execute(`
      CREATE TABLE IF NOT EXISTS competitor_platform_ids (
        id INT AUTO_INCREMENT PRIMARY KEY,
        competitor_id INT NOT NULL,
        platform VARCHAR(50) NOT NULL,
        platform_hotel_id VARCHAR(200) DEFAULT NULL,
        platform_hotel_name VARCHAR(200) DEFAULT NULL,
        resolved_at DATETIME DEFAULT NULL,
        UNIQUE KEY uk_comp_platform (competitor_id, platform)
      )
    `);

    // 5. 本店配置表
    await this.pool.execute(`
      CREATE TABLE IF NOT EXISTS hotel_config (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        hotel_name VARCHAR(200) DEFAULT NULL,
        address VARCHAR(500) DEFAULT NULL,
        lat DECIMAL(10,7) DEFAULT NULL,
        lng DECIMAL(10,7) DEFAULT NULL,
        amap_poi_id VARCHAR(50) DEFAULT NULL,
        ctrip_hotel_id VARCHAR(50) DEFAULT NULL,
        meituan_hotel_id VARCHAR(50) DEFAULT NULL,
        booking_hotel_id VARCHAR(50) DEFAULT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_user (user_id)
      )
    `);

    // 自动添加平台 hotelId 字段（兼容已有表）
    const platformIdColumns = ['ctrip_hotel_id', 'meituan_hotel_id', 'booking_hotel_id', 'trip_hotel_id', 'meituan_poi_id', 'meituan_partner_id', 'pms_url'];
    for (const col of platformIdColumns) {
      try {
        await this.pool.execute(`ALTER TABLE hotel_config ADD COLUMN ${col} VARCHAR(${col === 'pms_url' ? '500' : '50'}) DEFAULT NULL`);
      } catch (e: any) {
        // 字段已存在则忽略
        if (!e.message?.includes('Duplicate column')) throw e;
      }
    }

    // 6. 房型名称映射表（跨平台房型对齐）
    await this.pool.execute(`
      CREATE TABLE IF NOT EXISTS room_type_mapping (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        canonical_name VARCHAR(256) NOT NULL,
        platform VARCHAR(64) NOT NULL,
        platform_room_name VARCHAR(512) NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uk_mapping (user_id, platform, platform_room_name),
        INDEX idx_rtm_user_canonical (user_id, canonical_name)
      )
    `);

    // 7. 对话记录表
    await this.pool.execute(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        role VARCHAR(32) NOT NULL,
        content LONGTEXT NOT NULL,
        chat_date VARCHAR(16) NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_chat_messages_user_id (user_id),
        INDEX idx_chat_messages_date (chat_date)
      )
    `);

    // 8. 会话表
    await this.pool.execute(`
      CREATE TABLE IF NOT EXISTS chat_sessions (
        id VARCHAR(36) PRIMARY KEY,
        user_id INT NOT NULL,
        title VARCHAR(200) DEFAULT '新对话',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_chat_sessions_user (user_id)
      )
    `);

    // 兼容升级：给 chat_messages 加 session_id 字段（已有表不会重复加）
    try {
      await this.pool.execute(`ALTER TABLE chat_messages ADD COLUMN session_id VARCHAR(36) DEFAULT NULL`);
      await this.pool.execute(`ALTER TABLE chat_messages ADD INDEX idx_chat_messages_session (session_id)`);
    } catch (_) { /* 字段已存在则忽略 */ }
  }

  /**
   * 获取中国标准时间字符串 YYYY-MM-DD HH:MM:SS
   */
  private getChinaTimeString(): string {
    return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).replace(',', '');
  }

  /**
   * 获取中国标准日期字符串 YYYY-MM-DD
   */
  private getChinaDateString(): string {
    return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
  }

  /**
   * 关闭连接池
   */
  public async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      console.log('[DatabaseManager] 数据库连接池已关闭');
    }
  }

  /**
   * 获取数据库连接信息
   */
  public getDbPath(): string {
    return `mysql://${this.config.user}@${this.config.host}:${this.config.port}/${this.config.database}`;
  }

  /**
   * 初始化质检模块表结构（由 quality-ipc 调用）
   * @param schemaInit 回调函数，接收 pool 并执行建表/迁移
   * @returns 当前连接池
   */
  public async initializeQualitySchema(schemaInit: (pool: Pool) => Promise<void>): Promise<Pool> {
    if (!this.pool) throw new Error('数据库未初始化');
    await schemaInit(this.pool);
    return this.pool;
  }

  // ==================== 本店配置管理 ====================

  /**
   * 获取本店配置
   */
  public async getHotelConfig(): Promise<any | null> {
    if (!this.pool) throw new Error('数据库未初始化');
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      'SELECT * FROM hotel_config WHERE user_id = ?',
      [this.userId]
    );
    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * 保存或更新本店配置（upsert）
   */
  public async saveHotelConfig(data: {
    hotelName?: string;
    address?: string;
    lat?: number;
    lng?: number;
    amapPoiId?: string;
    ctripHotelId?: string;
    meituanHotelId?: string;
    bookingHotelId?: string;
    tripHotelId?: string;
    meituanPoiId?: string;
    meituanPartnerId?: string;
    pmsUrl?: string;
  }): Promise<void> {
    if (!this.pool) throw new Error('数据库未初始化');
    await this.pool.execute(
      `INSERT INTO hotel_config (user_id, hotel_name, address, lat, lng, amap_poi_id, ctrip_hotel_id, meituan_hotel_id, booking_hotel_id, trip_hotel_id, meituan_poi_id, meituan_partner_id, pms_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         hotel_name = COALESCE(VALUES(hotel_name), hotel_name),
         address = COALESCE(VALUES(address), address),
         lat = COALESCE(VALUES(lat), lat),
         lng = COALESCE(VALUES(lng), lng),
         amap_poi_id = COALESCE(VALUES(amap_poi_id), amap_poi_id),
         ctrip_hotel_id = COALESCE(VALUES(ctrip_hotel_id), ctrip_hotel_id),
         meituan_hotel_id = COALESCE(VALUES(meituan_hotel_id), meituan_hotel_id),
         booking_hotel_id = COALESCE(VALUES(booking_hotel_id), booking_hotel_id),
         trip_hotel_id = COALESCE(VALUES(trip_hotel_id), trip_hotel_id),
         meituan_poi_id = COALESCE(VALUES(meituan_poi_id), meituan_poi_id),
         meituan_partner_id = COALESCE(VALUES(meituan_partner_id), meituan_partner_id),
         pms_url = COALESCE(VALUES(pms_url), pms_url)`,
      [this.userId, data.hotelName || null, data.address || null,
       data.lat ?? null, data.lng ?? null, data.amapPoiId || null,
       data.ctripHotelId || null, data.meituanHotelId || null, data.bookingHotelId || null,
       data.tripHotelId || null, data.meituanPoiId || null, data.meituanPartnerId || null,
       data.pmsUrl || null]
    );
  }

  // ==================== 竞品酒店管理（扩展） ====================

  /**
   * 添加竞品酒店（含位置信息）
   */
  public async addCompetitorHotel(data: {
    name: string;
    amapPoiId?: string;
    address?: string;
    lat?: number;
    lng?: number;
    distanceMeters?: number;
  }): Promise<number> {
    if (!this.pool) throw new Error('数据库未初始化');

    // 先检查是否已存在（按 amap_poi_id 去重）
    if (data.amapPoiId) {
      const [existing] = await this.pool.execute<RowDataPacket[]>(
        'SELECT id FROM competitors WHERE user_id = ? AND amap_poi_id = ?',
        [this.userId, data.amapPoiId]
      );
      if (existing.length > 0) {
        const existingId = existing[0].id as number;
        await this.pool.execute(
          `UPDATE competitors SET
             address = COALESCE(?, address),
             lat = COALESCE(?, lat),
             lng = COALESCE(?, lng),
             distance_meters = COALESCE(?, distance_meters)
           WHERE id = ?`,
          [data.address || null, data.lat ?? null, data.lng ?? null, data.distanceMeters ?? null, existingId]
        );
        return existingId;
      }
    }

    const [result] = await this.pool.execute<ResultSetHeader>(
      `INSERT INTO competitors (user_id, name, amap_poi_id, address, lat, lng, distance_meters)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         amap_poi_id = COALESCE(VALUES(amap_poi_id), amap_poi_id),
         address = COALESCE(VALUES(address), address),
         lat = COALESCE(VALUES(lat), lat),
         lng = COALESCE(VALUES(lng), lng),
         distance_meters = COALESCE(VALUES(distance_meters), distance_meters)`,
      [this.userId, data.name, data.amapPoiId || null, data.address || null,
       data.lat ?? null, data.lng ?? null, data.distanceMeters ?? null]
    );
    // ON DUPLICATE KEY UPDATE 时 insertId 可能为 0，需要重新查询
    if (result.insertId === 0) {
      const [rows] = await this.pool.execute<RowDataPacket[]>(
        'SELECT id FROM competitors WHERE user_id = ? AND name = ?',
        [this.userId, data.name]
      );
      return rows[0].id as number;
    }
    return result.insertId;
  }

  /**
   * 获取所有竞品酒店（含位置信息）
   */
  public async getCompetitorHotels(): Promise<any[]> {
    if (!this.pool) throw new Error('数据库未初始化');
    try {
      const [rows] = await this.pool.execute<RowDataPacket[]>(
        `SELECT c.*, GROUP_CONCAT(
           CONCAT(cp.platform, ':', IFNULL(cp.platform_hotel_id, ''), ':', IFNULL(cp.platform_hotel_name, ''))
           SEPARATOR '||'
         ) AS platform_ids
         FROM competitors c
         LEFT JOIN competitor_platform_ids cp ON c.id = cp.competitor_id
         WHERE c.user_id = ?
         GROUP BY c.id
         ORDER BY c.distance_meters ASC, c.id ASC`,
        [this.userId]
      );
      return rows;
    } catch (e: any) {
      // 如果 platform_hotel_name 列不存在（1054 = Unknown column），降级到不含 name 的查询
      if (e.errno === 1054) {
        const [rows] = await this.pool.execute<RowDataPacket[]>(
          `SELECT c.*, GROUP_CONCAT(
             CONCAT(cp.platform, ':', IFNULL(cp.platform_hotel_id, ''))
             SEPARATOR '||'
           ) AS platform_ids
           FROM competitors c
           LEFT JOIN competitor_platform_ids cp ON c.id = cp.competitor_id
           WHERE c.user_id = ?
           GROUP BY c.id
           ORDER BY c.distance_meters ASC, c.id ASC`,
          [this.userId]
        );
        return rows;
      }
      throw e;
    }
  }

  /**
   * 删除竞品酒店（硬删除，同时清理关联的 platform_ids）
   */
  public async removeCompetitorHotel(competitorId: number): Promise<void> {
    if (!this.pool) throw new Error('数据库未初始化');
    // 先删关联的平台ID映射
    await this.pool.execute(
      'DELETE FROM competitor_platform_ids WHERE competitor_id = ?',
      [competitorId]
    );
    // 再删竞品本身
    await this.pool.execute(
      'DELETE FROM competitors WHERE id = ? AND user_id = ?',
      [competitorId, this.userId]
    );
  }

  /**
   * 设置竞品在某平台的 hotelId
   */
  public async setCompetitorPlatformId(competitorId: number, platform: string, platformHotelId: string, platformHotelName?: string): Promise<void> {
    if (!this.pool) throw new Error('数据库未初始化');
    await this.pool.execute(
      `INSERT INTO competitor_platform_ids (competitor_id, platform, platform_hotel_id, platform_hotel_name, resolved_at)
       VALUES (?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE platform_hotel_id = VALUES(platform_hotel_id), platform_hotel_name = VALUES(platform_hotel_name), resolved_at = NOW()`,
      [competitorId, platform, platformHotelId, platformHotelName || null]
    );
  }

  /**
   * 批量设置竞品平台ID（一次写入多条记录）
   */
  public async batchSetCompetitorPlatformIds(records: Array<{ competitorId: number; platform: string; platformHotelId: string; platformHotelName?: string }>): Promise<{ savedCount: number }> {
    if (!this.pool) throw new Error('数据库未初始化');
    if (records.length === 0) return { savedCount: 0 };

    const values = records.map(r => [r.competitorId, r.platform, r.platformHotelId, r.platformHotelName || null]);
    const placeholders = values.map(() => '(?, ?, ?, ?, NOW())').join(', ');
    const flat = values.flat();

    await this.pool.execute(
      `INSERT INTO competitor_platform_ids (competitor_id, platform, platform_hotel_id, platform_hotel_name, resolved_at)
       VALUES ${placeholders}
       ON DUPLICATE KEY UPDATE platform_hotel_id = VALUES(platform_hotel_id), platform_hotel_name = VALUES(platform_hotel_name), resolved_at = NOW()`,
      flat
    );
    return { savedCount: records.length };
  }

  /**
   * 获取指定平台下所有已解析 hotelId 的竞品
   * 返回 [{ competitorId, competitorName, platformHotelId }]
   */
  public async getCompetitorPlatformIds(platform: string): Promise<Array<{
    competitorId: number;
    competitorName: string;
    platformHotelId: string;
  }>> {
    if (!this.pool) throw new Error('数据库未初始化');
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT c.id AS competitorId, c.name AS competitorName, cp.platform_hotel_id AS platformHotelId
       FROM competitors c
       INNER JOIN competitor_platform_ids cp ON c.id = cp.competitor_id
       WHERE c.user_id = ? AND cp.platform = ? AND cp.platform_hotel_id IS NOT NULL AND cp.platform_hotel_id != ''`,
      [this.userId, platform]
    );
    return rows as any[];
  }

  // ==================== 智能调价聚合查询 ====================

  /**
   * 获取调价所需的全部数据（房态 + 本店价格 + 竞品价格）
   * 从 price_snapshots 和 room_snapshots 取最新快照数据
   */
  public async getPricingData(query?: { startDate?: string; endDate?: string }): Promise<{
    roomSnapshots: any[];
    ownPrices: any[];
    competitorPrices: any[];
  }> {
    if (!this.pool) throw new Error('数据库未初始化');

    // 默认：最近3天到未来7天
    const now = new Date();
    const defaultStart = new Date(now.getTime() - 3 * 86400000).toISOString().split('T')[0];
    const defaultEnd = new Date(now.getTime() + 7 * 86400000).toISOString().split('T')[0];
    // 只取日期部分，防止 Agent 传入带时间的字符串
    const startDate = (query?.startDate || defaultStart).substring(0, 10);
    const endDate = (query?.endDate || defaultEnd).substring(0, 10);
    const startTime = startDate + ' 00:00:00';
    const endTime = endDate + ' 23:59:59';

    // 1. 房态快照（本店，hotel_id=0）
    const [roomRows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT platform, room_name, date, total_rooms, available_rooms,
              occupancy_rate, adr, revpar, snapshot_time
       FROM room_snapshots
       WHERE user_id = ? AND hotel_id = 0 AND snapshot_time BETWEEN ? AND ?
       ORDER BY snapshot_time DESC, room_name, date`,
      [this.userId, startTime, endTime]
    );

    // 2. 本店价格快照（hotel_id=0），每个 (platform, room_name, date) 取最新一条
    const [ownRows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT platform, room_name, price, original_price, cost, currency,
              date, plan_name, breakfast, available, source_type, snapshot_time
       FROM price_snapshots
       WHERE user_id = ? AND hotel_id = 0 AND snapshot_time BETWEEN ? AND ?
         AND id IN (
           SELECT MAX(id) FROM price_snapshots
           WHERE user_id = ? AND hotel_id = 0 AND snapshot_time BETWEEN ? AND ?
           GROUP BY platform, room_name, COALESCE(date, DATE(snapshot_time))
         )
       ORDER BY platform, room_name, date`,
      [this.userId, startTime, endTime, this.userId, startTime, endTime]
    );

    // 3. 竞品价格快照（hotel_id>0），JOIN competitors 拿竞品名
    const [compRows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT ps.platform, ps.room_name, ps.price, ps.original_price, ps.currency,
              ps.date, ps.breakfast, ps.available, ps.source_type, ps.snapshot_time,
              ps.hotel_id, c.name AS competitor_name
       FROM price_snapshots ps
       LEFT JOIN competitors c ON ps.hotel_id = c.id
       WHERE ps.user_id = ? AND ps.hotel_id > 0 AND ps.snapshot_time BETWEEN ? AND ?
         AND ps.id IN (
           SELECT MAX(id) FROM price_snapshots
           WHERE user_id = ? AND hotel_id > 0 AND snapshot_time BETWEEN ? AND ?
           GROUP BY hotel_id, platform, room_name, COALESCE(date, DATE(snapshot_time))
         )
       ORDER BY c.name, ps.platform, ps.room_name, ps.date`,
      [this.userId, startTime, endTime, this.userId, startTime, endTime]
    );

    return {
      roomSnapshots: roomRows,
      ownPrices: ownRows,
      competitorPrices: compRows,
    };
  }

  // ==================== 对话记录管理 ====================

  /**
   * 保存对话消息
   */
  public async saveChatMessage(role: string, content: string, sessionId?: string): Promise<number> {
    if (!this.pool) throw new Error('数据库未初始化');

    const chatDate = this.getChinaDateString();
    const [result] = await this.pool.execute<ResultSetHeader>(
      'INSERT INTO chat_messages (user_id, role, content, chat_date, session_id) VALUES (?, ?, ?, ?, ?)',
      [this.userId, role, content, chatDate, sessionId || null]
    );
    // 更新会话的 updated_at
    if (sessionId) {
      await this.pool.execute('UPDATE chat_sessions SET updated_at = NOW() WHERE id = ?', [sessionId]).catch(() => {});
    }
    return result.insertId;
  }

  /**
   * 查询最近N天的对话记录（默认2天：今天+昨天）
   */
  public async getRecentChatMessages(days: number = 2): Promise<any[]> {
    if (!this.pool) throw new Error('数据库未初始化');

    const now = new Date();
    now.setDate(now.getDate() - (days - 1));
    const startDateStr = now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });

    const [rows] = await this.pool.execute<RowDataPacket[]>(
      'SELECT * FROM chat_messages WHERE user_id = ? AND chat_date >= ? ORDER BY created_at ASC',
      [this.userId, startDateStr]
    );
    return rows;
  }

  // ==================== 会话管理 ====================

  public async createSession(id: string, title: string = '新对话'): Promise<void> {
    if (!this.pool) throw new Error('数据库未初始化');
    await this.pool.execute(
      'INSERT INTO chat_sessions (id, user_id, title) VALUES (?, ?, ?)',
      [id, this.userId, title]
    );
  }

  public async getSessions(): Promise<any[]> {
    if (!this.pool) throw new Error('数据库未初始化');
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      'SELECT * FROM chat_sessions WHERE user_id = ? ORDER BY updated_at DESC',
      [this.userId]
    );
    return rows;
  }

  public async getSessionMessages(sessionId: string): Promise<any[]> {
    if (!this.pool) throw new Error('数据库未初始化');
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      'SELECT * FROM chat_messages WHERE user_id = ? AND session_id = ? ORDER BY created_at ASC',
      [this.userId, sessionId]
    );
    return rows;
  }

  public async updateSessionTitle(sessionId: string, title: string): Promise<void> {
    if (!this.pool) throw new Error('数据库未初始化');
    await this.pool.execute('UPDATE chat_sessions SET title = ? WHERE id = ? AND user_id = ?', [title, sessionId, this.userId]);
  }

  public async deleteSession(sessionId: string): Promise<void> {
    if (!this.pool) throw new Error('数据库未初始化');
    await this.pool.execute('DELETE FROM chat_messages WHERE session_id = ? AND user_id = ?', [sessionId, this.userId]);
    await this.pool.execute('DELETE FROM chat_sessions WHERE id = ? AND user_id = ?', [sessionId, this.userId]);
  }

  // ==================== 数据面板聚合查询（旧表已删除，返回空数组兼容 IPC） ====================

  public async getDashboardPublicPrices(_startTime: string): Promise<any[]> { return []; }
  public async getDashboardCompetitorPrices(_startTime: string): Promise<any[]> { return []; }
  public async getDashboardBackendPrices(_startTime: string): Promise<any[]> { return []; }
  public async getDashboardRealtimeRoomStatus(_startTime: string): Promise<any[]> { return []; }
  public async getDashboardFutureRoomStatus(_startTime: string): Promise<any[]> { return []; }

  // ==================== 价格快照 Dashboard ====================

  /**
   * Dashboard 查询：按平台+时间获取价格快照
   */
  public async getDashboardPriceSnapshots(startTime: string): Promise<any[]> {
    if (!this.pool) throw new Error('数据库未初始化');
    const sql = `
      SELECT ps.platform, ps.room_name, ps.price, ps.original_price, ps.currency,
             ps.date, ps.plan_name, ps.cost, ps.breakfast, ps.available, ps.source_type, ps.snapshot_time,
             ps.hotel_id,
             CASE WHEN ps.hotel_id = 0 THEN '本店' ELSE COALESCE(c.name, CONCAT('竞品#', ps.hotel_id)) END AS hotel_name,
             COALESCE(m.canonical_name, ps.room_name) AS display_name
      FROM price_snapshots ps
      LEFT JOIN room_type_mapping m
        ON m.id = (
          SELECT m2.id FROM room_type_mapping m2
          WHERE m2.user_id = ps.user_id
            AND (m2.platform = ps.platform OR ps.platform LIKE CONCAT(m2.platform, '-%'))
            AND (m2.platform_room_name = ps.room_name
                 OR INSTR(m2.platform_room_name, ps.room_name) > 0
                 OR INSTR(ps.room_name, m2.platform_room_name) > 0)
          ORDER BY CHAR_LENGTH(m2.platform_room_name) DESC
          LIMIT 1
        )
      LEFT JOIN competitors c ON ps.hotel_id = c.id AND ps.hotel_id > 0
      WHERE ps.user_id = ? AND ps.snapshot_time >= ?
      ORDER BY ps.hotel_id ASC, ps.snapshot_time DESC, ps.platform, display_name
    `;
    const [rows] = await this.pool.execute<RowDataPacket[]>(sql, [this.userId, startTime]);
    return rows;
  }

  // ==================== 价格快照 ====================

  /**
   * 批量插入价格快照（adapter 输出直存）
   */
  public async insertPriceSnapshots(platform: string, records: Array<{
    roomName: string;
    price?: number | null;
    originalPrice?: number | null;
    currency?: string;
    date?: string | null;
    planName?: string | null;
    cost?: number | null;
    breakfast?: string | null;
    available?: boolean | null;
    sourceType?: string | null;
  }>, hotelId: number = 0): Promise<{ savedCount: number }> {
    if (!this.pool) throw new Error('数据库未初始化');
    const now = this.getChinaTimeString();
    let savedCount = 0;

    for (const r of records) {
      if (!r.roomName || r.price == null) continue;
      await this.pool.execute(
        `INSERT INTO price_snapshots (user_id, platform, room_name, price, original_price, currency, date, plan_name, cost, breakfast, available, source_type, hotel_id, snapshot_time)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [this.userId, platform, r.roomName, r.price, r.originalPrice ?? null, r.currency || 'CNY',
         r.date || null, r.planName || null, r.cost ?? null, r.breakfast || null,
         r.available != null ? (r.available ? 1 : 0) : null, r.sourceType || null, hotelId, now]
      );
      savedCount++;
    }

    return { savedCount };
  }

  // ==================== 房态快照 ====================

  /**
   * 批量插入房态快照（adapter 输出直存）
   * date 为 null 表示实时房态，非 null 表示远���房态
   */
  public async insertRoomSnapshots(platform: string, records: Array<{
    roomName: string;
    date?: string | null;
    totalRooms?: number | null;
    availableRooms?: number | null;
    occupancyRate?: number | null;
    adr?: number | null;
    revpar?: number | null;
  }>, hotelId: number = 0): Promise<{ savedCount: number }> {
    if (!this.pool) throw new Error('数据库未初始化');
    const now = this.getChinaTimeString();
    let savedCount = 0;

    for (const r of records) {
      if (!r.roomName || r.availableRooms == null) continue;
      await this.pool.execute(
        `INSERT INTO room_snapshots (user_id, platform, room_name, date, total_rooms, available_rooms, occupancy_rate, adr, revpar, hotel_id, snapshot_time)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [this.userId, platform, r.roomName, r.date || null, r.totalRooms ?? null, r.availableRooms,
         r.occupancyRate ?? null, r.adr ?? null, r.revpar ?? null, hotelId, now]
      );
      savedCount++;
    }

    return { savedCount };
  }

  /**
   * Dashboard 查询：按平台+时间获取房态快照
   */
  public async getDashboardRoomSnapshots(startTime: string): Promise<any[]> {
    if (!this.pool) throw new Error('数据库未初始化');
    const sql = `
      SELECT platform, room_name, date, total_rooms, available_rooms,
             occupancy_rate, adr, revpar, snapshot_time
      FROM room_snapshots
      WHERE user_id = ? AND snapshot_time >= ?
      ORDER BY snapshot_time DESC, platform, room_name, date
    `;
    const [rows] = await this.pool.execute<RowDataPacket[]>(sql, [this.userId, startTime]);
    return rows;
  }

  /**
   * 查询价格快照
   */
  public async getPriceSnapshots(query?: {
    platform?: string;
    startTime?: string;
    limit?: number;
  }): Promise<any[]> {
    if (!this.pool) throw new Error('数据库未初始化');
    let sql = 'SELECT * FROM price_snapshots WHERE user_id = ?';
    const params: any[] = [this.userId];

    if (query?.platform) {
      sql += ' AND platform = ?';
      params.push(query.platform);
    }
    if (query?.startTime) {
      sql += ' AND snapshot_time >= ?';
      params.push(query.startTime);
    }
    sql += ' ORDER BY snapshot_time DESC';
    if (query?.limit) {
      sql += ' LIMIT ?';
      params.push(query.limit);
    }

    const [rows] = await this.pool.execute<RowDataPacket[]>(sql, params);
    return rows;
  }

  // ==================== 房型名称映射 ====================

  /**
   * 查询房型映射（可按平台过滤）
   */
  public async getRoomTypeMappings(platform?: string): Promise<any[]> {
    if (!this.pool) throw new Error('数据库未初始化');
    let sql = 'SELECT * FROM room_type_mapping WHERE user_id = ?';
    const params: any[] = [this.userId];
    if (platform) {
      sql += ' AND platform = ?';
      params.push(platform);
    }
    sql += ' ORDER BY canonical_name, platform';
    const [rows] = await this.pool.execute<RowDataPacket[]>(sql, params);
    return rows;
  }

  /**
   * 插入/更新房型映射（ON DUPLICATE KEY UPDATE）
   */
  public async upsertRoomTypeMapping(canonicalName: string, platform: string, platformRoomName: string): Promise<void> {
    if (!this.pool) throw new Error('数据库未初始化');
    await this.pool.execute(
      `INSERT INTO room_type_mapping (user_id, canonical_name, platform, platform_room_name, created_at)
       VALUES (?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE canonical_name = VALUES(canonical_name)`,
      [this.userId, canonicalName, platform, platformRoomName]
    );
  }

  /**
   * 查询指定平台在 price_snapshots + room_snapshots 中无映射的 room_name
   */
  public async getUnmappedRoomNames(platform: string): Promise<string[]> {
    if (!this.pool) throw new Error('数据库未初始化');
    const sql = `
      SELECT DISTINCT room_name FROM (
        SELECT room_name FROM price_snapshots WHERE user_id = ? AND platform = ?
        UNION
        SELECT room_name FROM room_snapshots WHERE user_id = ? AND platform = ?
      ) AS all_names
      WHERE room_name NOT IN (
        SELECT platform_room_name FROM room_type_mapping WHERE user_id = ? AND platform = ?
      )
    `;
    const [rows] = await this.pool.execute<RowDataPacket[]>(sql, [
      this.userId, platform, this.userId, platform, this.userId, platform
    ]);
    return rows.map((r: any) => r.room_name);
  }

  /**
   * 查询所有 canonical_name（去重）
   */
  public async getAllCanonicalNames(): Promise<string[]> {
    if (!this.pool) throw new Error('数据库未初始化');
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      'SELECT DISTINCT canonical_name FROM room_type_mapping WHERE user_id = ? ORDER BY canonical_name',
      [this.userId]
    );
    return rows.map((r: any) => r.canonical_name);
  }

  // ==================== 标准房型管理 ====================

  /**
   * 获取用户定义的标准房型名列表
   * 存储方式：room_type_mapping 表中 platform='canonical' 的记录
   */
  public async getCanonicalRoomTypes(): Promise<string[]> {
    if (!this.pool) throw new Error('数据库未初始化');
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT canonical_name FROM room_type_mapping WHERE user_id = ? AND platform = 'canonical' ORDER BY canonical_name`,
      [this.userId]
    );
    return rows.map((r: any) => r.canonical_name);
  }

  /**
   * 添加一个标准房型名
   */
  public async addCanonicalRoomType(name: string): Promise<void> {
    if (!this.pool) throw new Error('数据库未初始化');
    await this.pool.execute(
      `INSERT INTO room_type_mapping (user_id, canonical_name, platform, platform_room_name, created_at)
       VALUES (?, ?, 'canonical', ?, NOW())
       ON DUPLICATE KEY UPDATE canonical_name = VALUES(canonical_name)`,
      [this.userId, name, name]
    );
  }

  /**
   * 删除一个标准房型名（同时删除所有平台对该名称的映射）
   */
  public async removeCanonicalRoomType(name: string): Promise<void> {
    if (!this.pool) throw new Error('数据库未初始化');
    // 删除 canonical 记录
    await this.pool.execute(
      `DELETE FROM room_type_mapping WHERE user_id = ? AND platform = 'canonical' AND canonical_name = ?`,
      [this.userId, name]
    );
    // 同时清除其他平台映射到该名称的记录（让它们重新映射）
    await this.pool.execute(
      `DELETE FROM room_type_mapping WHERE user_id = ? AND platform != 'canonical' AND canonical_name = ?`,
      [this.userId, name]
    );
  }

  /**
   * 清除所有平台映射记录（保留 canonical 记录）
   */
  public async clearPlatformMappings(): Promise<void> {
    if (!this.pool) throw new Error('数据库未初始化');
    await this.pool.execute(
      `DELETE FROM room_type_mapping WHERE user_id = ? AND platform != 'canonical'`,
      [this.userId]
    );
  }

  // ==================== 价格日历查询 ====================

  /**
   * Dashboard 价格日历：按日期范围查询，JOIN room_type_mapping 获取 display_name
   * 每个 (platform, room_name, date) 只取最新一条
   * 映射匹配规则：包含匹配 + 最长匹配优先（越具体越优先）
   */
  public async getDashboardPriceCalendar(startDate: string, endDate: string): Promise<any[]> {
    if (!this.pool) throw new Error('数据库未初始化');
    const sql = `
      SELECT p.platform, p.room_name, p.date, p.price, p.original_price, p.cost,
             p.breakfast, p.available, p.source_type, p.plan_name, p.currency, p.snapshot_time,
             COALESCE(m.canonical_name, p.room_name) AS display_name,
             p.hotel_id,
             CASE WHEN p.hotel_id = 0 THEN '本店' ELSE COALESCE(c.name, CONCAT('竞品#', p.hotel_id)) END AS hotel_name
      FROM price_snapshots p
      LEFT JOIN room_type_mapping m
        ON m.id = (
          SELECT m2.id FROM room_type_mapping m2
          WHERE m2.user_id = p.user_id
            AND (m2.platform = p.platform OR p.platform LIKE CONCAT(m2.platform, '-%'))
            AND (m2.platform_room_name = p.room_name
                 OR INSTR(m2.platform_room_name, p.room_name) > 0
                 OR INSTR(p.room_name, m2.platform_room_name) > 0)
          ORDER BY CHAR_LENGTH(m2.platform_room_name) DESC
          LIMIT 1
        )
      LEFT JOIN competitors c ON p.hotel_id = c.id AND p.hotel_id > 0
      WHERE p.user_id = ? AND p.date BETWEEN ? AND ?
        AND p.id IN (
          SELECT MAX(id) FROM price_snapshots
          WHERE user_id = ? AND date BETWEEN ? AND ?
          GROUP BY platform, room_name, date, hotel_id
        )
      ORDER BY p.hotel_id ASC, display_name, p.date, p.platform
    `;
    const [rows] = await this.pool.execute<RowDataPacket[]>(sql, [
      this.userId, startDate, endDate, this.userId, startDate, endDate
    ]);
    return rows;
  }

  /**
   * Dashboard 房态日历：按日期范围查询，JOIN room_type_mapping
   * 映射匹配规则：包含匹配 + 最长匹配优先
   */
  public async getDashboardRoomCalendar(startDate: string, endDate: string): Promise<any[]> {
    if (!this.pool) throw new Error('数据库未初始化');
    const sql = `
      SELECT r.platform, r.room_name, r.date, r.total_rooms, r.available_rooms,
             r.occupancy_rate, r.adr, r.revpar, r.snapshot_time,
             COALESCE(m.canonical_name, r.room_name) AS display_name
      FROM room_snapshots r
      LEFT JOIN room_type_mapping m
        ON m.id = (
          SELECT m2.id FROM room_type_mapping m2
          WHERE m2.user_id = r.user_id
            AND (m2.platform = r.platform OR r.platform LIKE CONCAT(m2.platform, '-%'))
            AND (m2.platform_room_name = r.room_name
                 OR INSTR(m2.platform_room_name, r.room_name) > 0
                 OR INSTR(r.room_name, m2.platform_room_name) > 0)
          ORDER BY CHAR_LENGTH(m2.platform_room_name) DESC
          LIMIT 1
        )
      WHERE r.user_id = ? AND r.date BETWEEN ? AND ?
        AND r.id IN (
          SELECT MAX(id) FROM room_snapshots
          WHERE user_id = ? AND date BETWEEN ? AND ?
          GROUP BY platform, room_name, date
        )
      ORDER BY display_name, r.date, r.platform
    `;
    const [rows] = await this.pool.execute<RowDataPacket[]>(sql, [
      this.userId, startDate, endDate, this.userId, startDate, endDate
    ]);
    return rows;
  }
}

// 导出单例实例
export const databaseManager = new DatabaseManager();
