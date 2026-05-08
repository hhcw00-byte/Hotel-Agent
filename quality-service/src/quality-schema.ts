import type { Pool, RowDataPacket } from 'mysql2/promise';

type ColumnConfig = {
  sql: string;
};

const QUALITY_COLUMNS: Record<string, Record<string, ColumnConfig>> = {
  quality_tasks: {
    id: { sql: '`id` VARCHAR(36) NOT NULL' },
    user_id: { sql: '`user_id` INT NOT NULL DEFAULT 0' },
    task_name: { sql: '`task_name` VARCHAR(255) NOT NULL DEFAULT \'\'' },
    store_name: { sql: '`store_name` VARCHAR(255) NOT NULL DEFAULT \'\'' },
    due_at: { sql: '`due_at` DATETIME DEFAULT NULL' },
    instructions: { sql: '`instructions` TEXT' },
    status: { sql: '`status` VARCHAR(32) NOT NULL DEFAULT \'pending\'' },
    submit_token: { sql: '`submit_token` VARCHAR(128) NOT NULL DEFAULT \'\'' },
    submitted_at: { sql: '`submitted_at` DATETIME DEFAULT NULL' },
    created_at: { sql: '`created_at` DATETIME DEFAULT CURRENT_TIMESTAMP' },
    updated_at: { sql: '`updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP' },
  },
  quality_task_items: {
    id: { sql: '`id` VARCHAR(36) NOT NULL' },
    task_id: { sql: '`task_id` VARCHAR(36) NOT NULL DEFAULT \'\'' },
    item_name: { sql: '`item_name` VARCHAR(255) NOT NULL DEFAULT \'\'' },
    item_desc: { sql: '`item_desc` TEXT' },
    require_attachment: { sql: '`require_attachment` TINYINT(1) NOT NULL DEFAULT 0' },
    require_remark: { sql: '`require_remark` TINYINT(1) NOT NULL DEFAULT 0' },
    sort_order: { sql: '`sort_order` INT NOT NULL DEFAULT 0' },
    created_at: { sql: '`created_at` DATETIME DEFAULT CURRENT_TIMESTAMP' },
    updated_at: { sql: '`updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP' },
  },
  quality_submissions: {
    id: { sql: '`id` VARCHAR(36) NOT NULL' },
    task_id: { sql: '`task_id` VARCHAR(36) NOT NULL DEFAULT \'\'' },
    user_id: { sql: '`user_id` INT NOT NULL DEFAULT 0' },
    submitted_at: { sql: '`submitted_at` DATETIME DEFAULT NULL' },
    review_status: { sql: '`review_status` VARCHAR(32) NULL' },
    review_comment: { sql: '`review_comment` TEXT' },
    reviewed_at: { sql: '`reviewed_at` DATETIME DEFAULT NULL' },
    reviewed_by: { sql: '`reviewed_by` VARCHAR(36) DEFAULT NULL' },
    created_at: { sql: '`created_at` DATETIME DEFAULT CURRENT_TIMESTAMP' },
  },
  quality_submission_items: {
    id: { sql: '`id` VARCHAR(36) NOT NULL' },
    submission_id: { sql: '`submission_id` VARCHAR(36) NOT NULL DEFAULT \'\'' },
    task_id: { sql: '`task_id` VARCHAR(36) NOT NULL DEFAULT \'\'' },
    item_id: { sql: '`item_id` VARCHAR(36) NOT NULL DEFAULT \'\'' },
    remark: { sql: '`remark` TEXT' },
    attachments_json: { sql: '`attachments_json` LONGTEXT' },
    created_at: { sql: '`created_at` DATETIME DEFAULT CURRENT_TIMESTAMP' },
  },
};

const LEGACY_COLUMNS: Record<string, string[]> = {
  quality_tasks: ['name', 'title', 'taskName', 'store', 'storeName', 'hotel_name', 'submitToken'],
  quality_task_items: ['item_description', 'description'],
  quality_submissions: ['answers_json'],
  quality_submission_items: ['task_item_id'],
};

const QUALITY_TASK_INSERT_COLUMNS = new Set([
  'id',
  'user_id',
  'task_name',
  'store_name',
  'due_at',
  'instructions',
  'status',
  'submit_token',
  'submitted_at',
]);

const QUALITY_SUBMISSION_INSERT_COLUMNS = new Set([
  'id',
  'task_id',
  'user_id',
  'submitted_at',
]);

const QUALITY_SUBMISSION_ITEM_INSERT_COLUMNS = new Set([
  'id',
  'submission_id',
  'task_id',
  'item_id',
  'remark',
  'attachments_json',
]);

export async function initializeQualitySchema(pool: Pool): Promise<void> {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS quality_tasks (
      id VARCHAR(36) PRIMARY KEY,
      user_id INT NOT NULL,
      task_name VARCHAR(255) NOT NULL,
      store_name VARCHAR(255) NOT NULL,
      due_at DATETIME DEFAULT NULL,
      instructions TEXT,
      status VARCHAR(32) NOT NULL DEFAULT 'pending',
      submit_token VARCHAR(128) NOT NULL,
      submitted_at DATETIME DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_quality_tasks_user (user_id),
      INDEX idx_quality_tasks_status (status),
      INDEX idx_quality_tasks_due_at (due_at),
      INDEX idx_quality_tasks_token (id, submit_token)
    )
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS quality_task_items (
      id VARCHAR(36) PRIMARY KEY,
      task_id VARCHAR(36) NOT NULL,
      item_name VARCHAR(255) NOT NULL,
      item_desc TEXT,
      require_attachment TINYINT(1) NOT NULL DEFAULT 0,
      require_remark TINYINT(1) NOT NULL DEFAULT 0,
      sort_order INT NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_quality_task_items_task (task_id),
      INDEX idx_quality_task_items_sort (task_id, sort_order)
    )
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS quality_submissions (
      id VARCHAR(36) PRIMARY KEY,
      task_id VARCHAR(36) NOT NULL,
      user_id INT NOT NULL,
      submitted_at DATETIME NOT NULL,
      review_status VARCHAR(32) NULL,
      review_comment TEXT,
      reviewed_at DATETIME DEFAULT NULL,
      reviewed_by VARCHAR(36) DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uk_quality_submissions_task (task_id),
      INDEX idx_quality_submissions_user (user_id),
      INDEX idx_quality_submissions_submitted_at (submitted_at)
    )
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS quality_submission_items (
      id VARCHAR(36) PRIMARY KEY,
      submission_id VARCHAR(36) NOT NULL,
      task_id VARCHAR(36) NOT NULL,
      item_id VARCHAR(36) NOT NULL,
      remark TEXT,
      attachments_json LONGTEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_quality_submission_items_submission (submission_id),
      INDEX idx_quality_submission_items_task (task_id),
      INDEX idx_quality_submission_items_item (item_id)
    )
  `);

  await migrateExistingQualitySchema(pool);
}

async function migrateExistingQualitySchema(pool: Pool): Promise<void> {
  await ensureQualityTasksColumns(pool);
  await ensureQualityTaskItemsColumns(pool);
  await ensureQualitySubmissionsColumns(pool);
  await ensureQualitySubmissionItemsColumns(pool);
  await relaxLegacyQualityTaskColumns(pool);
  await relaxLegacySubmissionColumns(pool);
  await backfillLegacyQualityColumns(pool);
}

async function ensureQualityTasksColumns(pool: Pool): Promise<void> {
  await ensureColumn(pool, 'quality_tasks', 'id', 'VARCHAR(36) NOT NULL');
  await ensureColumn(pool, 'quality_tasks', 'user_id', 'INT NOT NULL DEFAULT 0');
  await ensureColumn(pool, 'quality_tasks', 'task_name', 'VARCHAR(255) NOT NULL DEFAULT \'\'');
  await ensureColumn(pool, 'quality_tasks', 'store_name', 'VARCHAR(255) NOT NULL DEFAULT \'\'');
  await ensureColumn(pool, 'quality_tasks', 'due_at', 'DATETIME DEFAULT NULL');
  await ensureColumn(pool, 'quality_tasks', 'instructions', 'TEXT');
  await ensureColumn(pool, 'quality_tasks', 'status', 'VARCHAR(32) NOT NULL DEFAULT \'pending\'');
  await ensureColumn(pool, 'quality_tasks', 'submit_token', 'VARCHAR(128) NOT NULL DEFAULT \'\'');
  await ensureColumn(pool, 'quality_tasks', 'submitted_at', 'DATETIME DEFAULT NULL');
  await ensureColumn(pool, 'quality_tasks', 'created_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP');
  await ensureColumn(pool, 'quality_tasks', 'updated_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');

  await ensureVarcharColumn(pool, 'quality_tasks', 'id', 36, 'VARCHAR(36) NOT NULL');
  await ensureVarcharColumn(pool, 'quality_tasks', 'status', 32, 'VARCHAR(32) NOT NULL DEFAULT \'pending\'');
  await ensureVarcharColumn(pool, 'quality_tasks', 'submit_token', 128, 'VARCHAR(128) NOT NULL DEFAULT \'\'');
}

async function ensureQualityTaskItemsColumns(pool: Pool): Promise<void> {
  await ensureColumn(pool, 'quality_task_items', 'id', 'VARCHAR(36) NOT NULL');
  await ensureColumn(pool, 'quality_task_items', 'task_id', 'VARCHAR(36) NOT NULL DEFAULT \'\'');
  await ensureColumn(pool, 'quality_task_items', 'item_name', 'VARCHAR(255) NOT NULL DEFAULT \'\'');
  await ensureColumn(pool, 'quality_task_items', 'item_desc', 'TEXT');
  await ensureColumn(pool, 'quality_task_items', 'require_attachment', 'TINYINT(1) NOT NULL DEFAULT 0');
  await ensureColumn(pool, 'quality_task_items', 'require_remark', 'TINYINT(1) NOT NULL DEFAULT 0');
  await ensureColumn(pool, 'quality_task_items', 'sort_order', 'INT NOT NULL DEFAULT 0');
  await ensureColumn(pool, 'quality_task_items', 'created_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP');
  await ensureColumn(pool, 'quality_task_items', 'updated_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');

  await ensureVarcharColumn(pool, 'quality_task_items', 'id', 36, 'VARCHAR(36) NOT NULL');
  await ensureVarcharColumn(pool, 'quality_task_items', 'task_id', 36, 'VARCHAR(36) NOT NULL DEFAULT \'\'');
}

async function ensureQualitySubmissionsColumns(pool: Pool): Promise<void> {
  await ensureColumn(pool, 'quality_submissions', 'id', 'VARCHAR(36) NOT NULL');
  await ensureColumn(pool, 'quality_submissions', 'task_id', 'VARCHAR(36) NOT NULL DEFAULT \'\'');
  await ensureColumn(pool, 'quality_submissions', 'user_id', 'INT NOT NULL DEFAULT 0');
  await ensureColumn(pool, 'quality_submissions', 'submitted_at', 'DATETIME DEFAULT NULL');
  await ensureColumn(pool, 'quality_submissions', 'review_status', 'VARCHAR(32) NULL');
  await ensureColumn(pool, 'quality_submissions', 'review_comment', 'TEXT');
  await ensureColumn(pool, 'quality_submissions', 'reviewed_at', 'DATETIME DEFAULT NULL');
  await ensureColumn(pool, 'quality_submissions', 'reviewed_by', 'VARCHAR(36) DEFAULT NULL');
  await ensureColumn(pool, 'quality_submissions', 'created_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP');

  await ensureVarcharColumn(pool, 'quality_submissions', 'id', 36, 'VARCHAR(36) NOT NULL');
  await ensureVarcharColumn(pool, 'quality_submissions', 'task_id', 36, 'VARCHAR(36) NOT NULL DEFAULT \'\'');
  await ensureVarcharColumn(pool, 'quality_submissions', 'review_status', 32, 'VARCHAR(32) NULL');
  await ensureVarcharColumn(pool, 'quality_submissions', 'reviewed_by', 36, 'VARCHAR(36) DEFAULT NULL');
}

async function ensureQualitySubmissionItemsColumns(pool: Pool): Promise<void> {
  await ensureColumn(pool, 'quality_submission_items', 'id', 'VARCHAR(36) NOT NULL');
  await ensureColumn(pool, 'quality_submission_items', 'submission_id', 'VARCHAR(36) NOT NULL DEFAULT \'\'');
  await ensureColumn(pool, 'quality_submission_items', 'task_id', 'VARCHAR(36) NOT NULL DEFAULT \'\'');
  await ensureColumn(pool, 'quality_submission_items', 'item_id', 'VARCHAR(36) NOT NULL DEFAULT \'\'');
  await ensureColumn(pool, 'quality_submission_items', 'remark', 'TEXT');
  await ensureColumn(pool, 'quality_submission_items', 'attachments_json', 'LONGTEXT');
  await ensureColumn(pool, 'quality_submission_items', 'created_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP');

  await ensureVarcharColumn(pool, 'quality_submission_items', 'id', 36, 'VARCHAR(36) NOT NULL');
  await ensureVarcharColumn(pool, 'quality_submission_items', 'submission_id', 36, 'VARCHAR(36) NOT NULL DEFAULT \'\'');
  await ensureVarcharColumn(pool, 'quality_submission_items', 'task_id', 36, 'VARCHAR(36) NOT NULL DEFAULT \'\'');
  await ensureVarcharColumn(pool, 'quality_submission_items', 'item_id', 36, 'VARCHAR(36) NOT NULL DEFAULT \'\'');
}

async function backfillLegacyQualityColumns(pool: Pool): Promise<void> {
  await copyColumnIfPresent(pool, 'quality_tasks', 'name', 'task_name');
  await copyColumnIfPresent(pool, 'quality_tasks', 'title', 'task_name');
  await copyColumnIfPresent(pool, 'quality_tasks', 'taskName', 'task_name');
  await copyColumnIfPresent(pool, 'quality_tasks', 'store', 'store_name');
  await copyColumnIfPresent(pool, 'quality_tasks', 'storeName', 'store_name');
  await copyColumnIfPresent(pool, 'quality_tasks', 'hotel_name', 'store_name');
  await copyColumnIfPresent(pool, 'quality_tasks', 'submitToken', 'submit_token');

  await copyColumnIfPresent(pool, 'quality_task_items', 'item_description', 'item_desc');
  await copyColumnIfPresent(pool, 'quality_task_items', 'description', 'item_desc');

  await copyColumnIfPresent(pool, 'quality_submission_items', 'task_item_id', 'item_id');

  await pool.query(`
    UPDATE quality_submission_items si
    INNER JOIN quality_task_items ti ON ti.id = si.item_id
    SET si.task_id = ti.task_id
    WHERE (si.task_id IS NULL OR si.task_id = '')
      AND ti.task_id IS NOT NULL
      AND ti.task_id <> ''
  `);

  await pool.query(`
    UPDATE quality_tasks
    SET status = 'pending'
    WHERE status IS NULL OR status = ''
  `);

  await pool.query(`
    UPDATE quality_tasks
    SET submit_token = LOWER(REPLACE(UUID(), '-', ''))
    WHERE submit_token IS NULL OR submit_token = ''
  `);
}

async function relaxLegacyQualityTaskColumns(pool: Pool): Promise<void> {
  const hotelNameColumn = await getColumn(pool, 'quality_tasks', 'hotel_name');
  if (hotelNameColumn) {
    await pool.query('ALTER TABLE `quality_tasks` MODIFY COLUMN `hotel_name` VARCHAR(255) NULL DEFAULT NULL');
  }

  await relaxBlockingColumns(pool, 'quality_tasks', QUALITY_TASK_INSERT_COLUMNS);
}

async function relaxLegacySubmissionColumns(pool: Pool): Promise<void> {
  await relaxBlockingColumns(pool, 'quality_submissions', QUALITY_SUBMISSION_INSERT_COLUMNS);
  await relaxBlockingColumns(pool, 'quality_submission_items', QUALITY_SUBMISSION_ITEM_INSERT_COLUMNS);
}

async function relaxBlockingColumns(pool: Pool, tableName: string, insertColumns: Set<string>): Promise<void> {
  const blockingColumns = await getBlockingColumns(pool, tableName);
  for (const column of blockingColumns) {
    const columnName = String(column.columnName || '');
    if (insertColumns.has(columnName)) continue;
    if (!isSafeIdentifier(columnName)) continue;

    const columnType = String(column.columnType || '').trim();
    const dataType = String(column.dataType || '').toLowerCase();
    if (!columnType || !isSafeColumnType(columnType)) continue;

    const defaultClause = typeDisallowsDefault(dataType) ? 'NULL' : 'NULL DEFAULT NULL';
    await pool.query(`ALTER TABLE ${quoteQualityTable(tableName)} MODIFY COLUMN \`${columnName}\` ${columnType} ${defaultClause}`);
  }
}

async function ensureColumn(pool: Pool, tableName: string, columnName: string, _definition: string): Promise<void> {
  const column = await getColumn(pool, tableName, columnName);
  if (column) return;
  await pool.query(`ALTER TABLE ${quoteQualityTable(tableName)} ADD COLUMN ${getQualityColumnSql(tableName, columnName)}`);
}

async function ensureVarcharColumn(
  pool: Pool,
  tableName: string,
  columnName: string,
  length: number,
  _definition: string
): Promise<void> {
  const column = await getColumn(pool, tableName, columnName);
  if (!column) return;
  const type = String(column.Type || '').toLowerCase();
  if (type !== `varchar(${length})`) {
    await pool.query(`ALTER TABLE ${quoteQualityTable(tableName)} MODIFY COLUMN ${getQualityColumnSql(tableName, columnName)}`);
  }
}

async function copyColumnIfPresent(pool: Pool, tableName: string, fromColumn: string, toColumn: string): Promise<void> {
  const [from, to] = await Promise.all([
    getColumn(pool, tableName, fromColumn),
    getColumn(pool, tableName, toColumn),
  ]);
  if (!from || !to) return;

  const tableSql = quoteQualityTable(tableName);
  const fromSql = quoteQualityColumn(tableName, fromColumn);
  const toSql = quoteQualityColumn(tableName, toColumn);

  await pool.query(`
    UPDATE ${tableSql}
    SET ${toSql} = ${fromSql}
    WHERE (${toSql} IS NULL OR ${toSql} = '')
      AND ${fromSql} IS NOT NULL
  `);
}

async function getColumn(pool: Pool, tableName: string, columnName: string): Promise<RowDataPacket | null> {
  assertQualityColumn(tableName, columnName);
  const [rows] = await pool.query<RowDataPacket[]>(`
    SELECT COLUMN_NAME AS Field, COLUMN_TYPE AS Type
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ${quoteSqlString(tableName)}
      AND COLUMN_NAME = ${quoteSqlString(columnName)}
    LIMIT 1
  `);
  return rows.length > 0 ? rows[0] : null;
}

async function getBlockingColumns(pool: Pool, tableName: string): Promise<RowDataPacket[]> {
  quoteQualityTable(tableName);
  const [rows] = await pool.query<RowDataPacket[]>(`
    SELECT
      COLUMN_NAME AS columnName,
      COLUMN_TYPE AS columnType,
      DATA_TYPE AS dataType,
      EXTRA AS extra
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ${quoteSqlString(tableName)}
      AND IS_NULLABLE = 'NO'
      AND COLUMN_DEFAULT IS NULL
      AND EXTRA NOT LIKE '%auto_increment%'
  `);
  return rows;
}

function quoteQualityTable(tableName: string): string {
  if (!QUALITY_COLUMNS[tableName]) {
    throw new Error(`Unknown quality table: ${tableName}`);
  }
  return `\`${tableName}\``;
}

function quoteQualityColumn(tableName: string, columnName: string): string {
  assertQualityColumn(tableName, columnName);
  return `\`${columnName}\``;
}

function getQualityColumnSql(tableName: string, columnName: string): string {
  const column = QUALITY_COLUMNS[tableName]?.[columnName];
  if (!column) {
    throw new Error(`Unknown quality schema column: ${tableName}.${columnName}`);
  }
  return column.sql;
}

function assertQualityColumn(tableName: string, columnName: string): void {
  const currentColumn = QUALITY_COLUMNS[tableName]?.[columnName];
  const legacyColumn = LEGACY_COLUMNS[tableName]?.includes(columnName);
  if (!currentColumn && !legacyColumn) {
    throw new Error(`Unknown quality schema column: ${tableName}.${columnName}`);
  }
}

function quoteSqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function isSafeIdentifier(value: string): boolean {
  return /^[A-Za-z0-9_]+$/.test(value);
}

function isSafeColumnType(value: string): boolean {
  return /^[A-Za-z0-9_(),'\s]+$/.test(value);
}

function typeDisallowsDefault(dataType: string): boolean {
  return [
    'blob',
    'tinyblob',
    'mediumblob',
    'longblob',
    'text',
    'tinytext',
    'mediumtext',
    'longtext',
    'json',
    'geometry',
  ].includes(dataType);
}
