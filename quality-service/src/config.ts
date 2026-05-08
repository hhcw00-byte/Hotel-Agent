import * as fs from 'fs';
import * as path from 'path';

loadDotEnv();

export interface QualityServiceConfig {
  port: number;
  publicBaseUrl: string;
  uploadRoot: string;
  maxUploadSizeBytes: number;
  mysql: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
  };
}

export const config: QualityServiceConfig = {
  port: numberEnv('PORT', 17890),
  publicBaseUrl: normalizeBaseUrl(process.env.PUBLIC_BASE_URL, numberEnv('PORT', 17890)),
  uploadRoot: path.resolve(process.cwd(), stringEnv('UPLOAD_ROOT', 'uploads/quality')),
  maxUploadSizeBytes: numberEnv('MAX_UPLOAD_SIZE_MB', 10) * 1024 * 1024,
  mysql: {
    host: stringEnv('MYSQL_HOST', '127.0.0.1'),
    port: numberEnv('MYSQL_PORT', 3306),
    user: stringEnv('MYSQL_USER', 'root'),
    password: stringEnv('MYSQL_PASSWORD', ''),
    database: stringEnv('MYSQL_DATABASE', 'hotel_agent'),
  },
};

function loadDotEnv(): void {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;

  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^"|"$/g, '');
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function stringEnv(name: string, fallback: string): string {
  const value = String(process.env[name] || '').trim();
  return value || fallback;
}

function numberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function normalizeBaseUrl(value: string | undefined, port: number): string {
  const raw = String(value || '').trim();
  if (/^https?:\/\/[^/]+/i.test(raw)) {
    return raw.replace(/\/+$/, '');
  }
  return `http://localhost:${port}`;
}
