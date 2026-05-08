/**
 * Google Cookie Sync - 从系统 Chrome/Edge 同步 Google 登录态到 Electron
 */
import { session } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import * as child_process from 'child_process';
import * as os from 'os';

const GOOGLE_DOMAINS = ['.google.com', 'accounts.google.com', '.youtube.com', '.googleapis.com'];

interface DecryptedCookie {
  name: string; value: string; host: string; path: string;
  isSecure: boolean; isHttpOnly: boolean; expiresUtc: number; sameSite: number;
}

export class GoogleCookieSync {
  private aesKey: Buffer | null = null;

  async sync(): Promise<number> {
    if (process.platform !== 'win32') return 0;
    const localAppData = process.env.LOCALAPPDATA || '';
    if (!localAppData) return 0;

    // 查找 Chrome 或 Edge
    const browsers = [
      { name: 'Chrome', ls: path.join(localAppData, 'Google', 'Chrome', 'User Data', 'Local State'), ck: path.join(localAppData, 'Google', 'Chrome', 'User Data', 'Default', 'Network', 'Cookies') },
      { name: 'Edge', ls: path.join(localAppData, 'Microsoft', 'Edge', 'User Data', 'Local State'), ck: path.join(localAppData, 'Microsoft', 'Edge', 'User Data', 'Default', 'Network', 'Cookies') },
    ];
    const browser = browsers.find(b => fs.existsSync(b.ls) && fs.existsSync(b.ck));
    if (!browser) { console.log('[CookieSync] No Chrome/Edge found'); return 0; }
    console.log('[CookieSync] Using: ' + browser.name);

    try {
      this.aesKey = await this.decryptAesKey(browser.ls);
      if (!this.aesKey) return 0;
      console.log('[CookieSync] AES key OK');

      const cookies = await this.readCookies(browser.ck);
      if (cookies.length === 0) { console.log('[CookieSync] No Google cookies'); return 0; }
      console.log('[CookieSync] Found ' + cookies.length + ' cookies');

      return await this.importToElectron(cookies);
    } catch (e) { console.error('[CookieSync] Error:', e); return 0; }
    finally { if (this.aesKey) { this.aesKey.fill(0); this.aesKey = null; } }
  }

  private async decryptAesKey(localStatePath: string): Promise<Buffer | null> {
    try {
      const localState = JSON.parse(fs.readFileSync(localStatePath, 'utf-8'));
      const b64 = localState?.os_crypt?.encrypted_key;
      if (!b64) return null;
      const raw = Buffer.from(b64, 'base64');
      if (raw.toString('utf-8', 0, 5) !== 'DPAPI') return null;

      const tmp = os.tmpdir();
      const ts = Date.now();
      const blobFile = path.join(tmp, 'hai-b-' + ts + '.bin');
      const scriptFile = path.join(tmp, 'hai-d-' + ts + '.ps1');
      const resultFile = path.join(tmp, 'hai-r-' + ts + '.txt');

      fs.writeFileSync(blobFile, raw.subarray(5));

      const script = 'Add-Type -AssemblyName System.Security\r\n'
        + "$enc = [System.IO.File]::ReadAllBytes('" + blobFile.replace(/\\/g, '\\\\') + "')\r\n"
        + '$dec = [System.Security.Cryptography.ProtectedData]::Unprotect($enc, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)\r\n'
        + "[System.IO.File]::WriteAllText('" + resultFile.replace(/\\/g, '\\\\') + "', [Convert]::ToBase64String($dec))\r\n";

      fs.writeFileSync(scriptFile, script, 'utf-8');
      try {
        child_process.execSync('powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + scriptFile + '"', { timeout: 10000, stdio: 'pipe' });
        return Buffer.from(fs.readFileSync(resultFile, 'utf-8').trim(), 'base64');
      } finally {
        try { fs.unlinkSync(blobFile); } catch {}
        try { fs.unlinkSync(scriptFile); } catch {}
        try { fs.unlinkSync(resultFile); } catch {}
      }
    } catch (e) { console.error('[CookieSync] AES key decrypt failed:', e); return null; }
  }

  private async readCookies(cookieDbPath: string): Promise<DecryptedCookie[]> {
    const tmp = os.tmpdir();
    const ts = Date.now();
    const tmpDb = path.join(tmp, 'hai-ck-' + ts + '.db');

    // Chrome 运行时会锁定 Cookies 文件。尝试多种方式读取：
    // 方式1: 直接用 sql.js 读取原始文件（sql.js 用 fs.readFileSync 读取，可能绕过锁）
    // 方式2: 复制文件后读取
    // 方式3: 用 PowerShell 的 Volume Shadow Copy

    let dbBuffer: Buffer | null = null;

    // 方式1: 直接读取原始文件（Node.js 的 fs.readFileSync 有时能读取被锁定的文件）
    try {
      dbBuffer = fs.readFileSync(cookieDbPath);
      console.log('[CookieSync] Direct read OK (' + dbBuffer.length + ' bytes)');
    } catch {
      console.log('[CookieSync] Direct read failed, trying copy methods...');
    }

    // 方式2: 用 PowerShell 创建 Volume Shadow Copy 来读取
    if (!dbBuffer) {
      const copyScript = path.join(tmp, 'hai-cp-' + ts + '.ps1');
      const psContent = "$s = '" + cookieDbPath.replace(/'/g, "''") + "'\r\n"
        + "$d = '" + tmpDb.replace(/'/g, "''") + "'\r\n"
        + "# Try esentutl first\r\n"
        + "& esentutl.exe /y $s /d $d /o 2>$null\r\n"
        + "if (Test-Path $d) { exit 0 }\r\n"
        + "# Try .NET stream with sharing\r\n"
        + "try {\r\n"
        + "  $fs = New-Object System.IO.FileStream($s, 'Open', 'Read', 'ReadWrite,Delete')\r\n"
        + "  $ms = New-Object System.IO.MemoryStream\r\n"
        + "  $fs.CopyTo($ms)\r\n"
        + "  $fs.Close()\r\n"
        + "  [System.IO.File]::WriteAllBytes($d, $ms.ToArray())\r\n"
        + "  $ms.Close()\r\n"
        + "} catch {}\r\n"
        + "# Try robocopy as last resort\r\n"
        + "if (-not (Test-Path $d)) {\r\n"
        + "  $dir = Split-Path $s -Parent\r\n"
        + "  $file = Split-Path $s -Leaf\r\n"
        + "  & robocopy $dir $env:TEMP $file /R:0 /W:0 2>$null\r\n"
        + "  $roboDst = Join-Path $env:TEMP $file\r\n"
        + "  if (Test-Path $roboDst) { Move-Item $roboDst $d -Force }\r\n"
        + "}\r\n";

      fs.writeFileSync(copyScript, psContent, 'utf-8');
      try {
        child_process.execSync('powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + copyScript + '"', { timeout: 15000, stdio: 'pipe' });
      } catch {}
      try { fs.unlinkSync(copyScript); } catch {}

      if (fs.existsSync(tmpDb)) {
        try {
          dbBuffer = fs.readFileSync(tmpDb);
          console.log('[CookieSync] Copy+read OK (' + dbBuffer.length + ' bytes)');
        } catch {}
      }
    }

    if (!dbBuffer || dbBuffer.length === 0) {
      console.error('[CookieSync] Failed to read cookie database. Is Chrome running? Try closing Chrome first.');
      try { fs.unlinkSync(tmpDb); } catch {}
      return [];
    }

    try {
      const initSqlJs = require('sql.js');
      const SQL = await initSqlJs();
      const db = new SQL.Database(dbBuffer);

      const where = GOOGLE_DOMAINS.map(function(d) { return "host_key LIKE '%" + d + "%'"; }).join(' OR ');
      const q = 'SELECT host_key, name, encrypted_value, path, is_secure, is_httponly, expires_utc, samesite FROM cookies WHERE ' + where;
      const res = db.exec(q);
      db.close();

      if (!res || res.length === 0) return [];

      const cookies: DecryptedCookie[] = [];
      for (const row of res[0].values) {
        const encBytes = Buffer.from(row[2] as Uint8Array);
        const val = this.decrypt(encBytes);
        if (val === null) continue;
        cookies.push({
          name: row[1] as string, value: val, host: row[0] as string,
          path: (row[3] as string) || '/', isSecure: row[4] === 1,
          isHttpOnly: row[5] === 1, expiresUtc: (row[6] as number) || 0,
          sameSite: (row[7] as number) || 0,
        });
      }
      return cookies;
    } catch (e) { console.error('[CookieSync] SQLite read failed:', e); return []; }
    finally { try { fs.unlinkSync(tmpDb); } catch {} }
  }

  private decrypt(enc: Buffer): string | null {
    if (!enc || enc.length === 0) return '';
    try {
      const pfx = enc.toString('utf-8', 0, 3);
      if ((pfx === 'v10' || pfx === 'v20') && this.aesKey) {
        const nonce = enc.subarray(3, 15);
        const ct = enc.subarray(15);
        if (ct.length < 16) return null;
        const tag = ct.subarray(ct.length - 16);
        const data = ct.subarray(0, ct.length - 16);
        const d = crypto.createDecipheriv('aes-256-gcm', this.aesKey, nonce);
        d.setAuthTag(tag);
        return Buffer.concat([d.update(data), d.final()]).toString('utf-8');
      }
      return null;
    } catch { return null; }
  }

  private async importToElectron(cookies: DecryptedCookie[]): Promise<number> {
    const ses = session.defaultSession;
    let n = 0;
    for (const c of cookies) {
      try {
        const proto = c.isSecure ? 'https' : 'http';
        const dom = c.host.startsWith('.') ? c.host.substring(1) : c.host;
        const url = proto + '://' + dom + c.path;
        let ss: 'unspecified' | 'no_restriction' | 'lax' | 'strict' = 'unspecified';
        if (c.sameSite === 0) ss = 'no_restriction';
        else if (c.sameSite === 1) ss = 'lax';
        else if (c.sameSite === 2) ss = 'strict';

        const det: Electron.CookiesSetDetails = {
          url, name: c.name, value: c.value, domain: c.host,
          path: c.path, secure: c.isSecure, httpOnly: c.isHttpOnly, sameSite: ss,
        };
        if (c.expiresUtc > 0) {
          const unix = (c.expiresUtc / 1000000) - 11644473600;
          if (unix > Date.now() / 1000) det.expirationDate = unix;
        }
        await ses.cookies.set(det);
        n++;
      } catch {}
    }
    console.log('[CookieSync] Imported ' + n + ' cookies');
    return n;
  }
}
