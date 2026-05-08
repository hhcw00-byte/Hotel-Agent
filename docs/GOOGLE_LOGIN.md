# Google 登录集成

## 功能概述

在登录页面新增"使用 Google 账号登录"按钮，通过打开系统 Chrome 完成 Google 认证，自动将 Google 登录状态同步到 Electron 应用内所有网页。

## 架构流程

```
登录页 [Google 登录按钮]
  → IPC 'auth:google-login'
  → Main Process: GoogleAuthChrome.performGoogleAuth()
  → 系统 Chrome 打开 accounts.google.com（绕过 Electron CDP 检测）
  → 用户完成登录
  → CDP 提取用户邮箱 + cookies
  → AuthManager.loginWithGoogle(email, displayName)
    → 数据库查找/自动注册用户
    → 创建 session（同普通登录）
  → cookies 导入 Electron session
  → 返回用户信息 → 显示主界面
  → 所有 BrowserView 自动拥有 Google 登录状态
```

## 修改文件清单

| 文件 | 改动内容 |
|------|----------|
| `src/main/auth-manager.ts` | users 表新增 `google_email`/`auth_type` 列；新增 `loginWithGoogle()` 方法 |
| `src/main/google-auth-chrome.ts` | 新增 `extractGoogleUserInfo()` 通过 CDP 获取邮箱和显示名 |
| `src/main/window-manager.ts` | 新增 `performGoogleLogin()`；`googleLoginDone` 标志位持久化；登出时重置 |
| `src/main/index.ts` | 新增 `auth:google-login` IPC 处理器（含多级回退）；登出时清除 Google cookies |
| `src/shared/types.ts` | 新增 `AUTH_GOOGLE_LOGIN` IPC 通道常量 |
| `src/preload/index.ts` | 暴露 `googleLogin` API 给渲染进程 |
| `src/renderer/components/login-page.ts` | 新增 Google 登录按钮 UI + 点击处理 |
| `src/renderer/styles/main.css` | Google 按钮样式（分隔线、按钮、hover/disabled 状态） |

## 数据库变更

`hotel_agent_system.users` 表新增两列（初始化时自动添加，幂等操作）：

```sql
ALTER TABLE users ADD COLUMN google_email VARCHAR(255) NULL UNIQUE COMMENT 'Google邮箱';
ALTER TABLE users ADD COLUMN auth_type VARCHAR(16) NOT NULL DEFAULT 'local' COMMENT '认证类型: local/google';
```

- `auth_type = 'google'`：Google 登录用户，`password_hash` 存随机哈希（不可用于密码登录）
- `google_email`：唯一 Google 邮箱，用于查找已注册用户

## 核心机制

### 1. 系统 Chrome 认证

使用 `--remote-debugging-port` 和临时 `--user-data-dir` 启动系统 Chrome，避免 Electron 内嵌浏览器被 Google 检测为自动化工具。

### 2. 用户信息提取（多级回退）

1. **CDP Runtime.evaluate**：通过 Google ListAccounts API 获取邮箱和显示名
2. **Electron session cookies**：从已导入的 cookies 中提取 Google 邮箱
3. **时间戳占位符**：兜底方案，确保登录不会因邮箱提取失败而中断

### 3. 拦截器放行（googleLoginDone）

`setupGoogleAuthInterception` 拦截器会阻止未授权的 Google OAuth 请求。Google 登录成功后设置 `googleLoginDone = true`（持久化到 electron-store），拦截器检测到此标志后放行所有后续 Google OAuth 请求。

- **持久化**：标志位保存在 `auth.json`，应用重启后自动恢复
- **登出清除**：登出时重置标志位，防止 cookie 泄露给下一个用户

### 4. 登出时 Cookie 清理

登出时清除以下域名的所有 cookies：
- `.google.com`
- `.youtube.com`
- `.googleapis.com`
- `accounts.google.com`

## 用户操作流程

1. 启动应用 → 登录页显示 Google 登录按钮
2. 点击按钮 → 系统 Chrome 打开 Google 登录页
3. 在 Chrome 中完成登录 → Chrome 自动关闭
4. 应用自动识别邮箱、创建/查找用户、显示主界面
5. 打开任意网站（携程、Booking 等）→ 点击 Google 登录 → 自动跳转（无需手动输入）
6. 重启应用 → 自动登录，Google OAuth 仍然有效
7. 登出 → Google cookies 被清除，下一个用户需重新登录

## 已知限制

- **Chrome 运行时同步失败**：`GoogleCookieSync` 读取 Chrome 的 SQLite cookie 数据库，Chrome 运行时数据库被锁定，无法读取
- **Cookie 过期**：Google cookies 有有效期，过期后需重新进行 Google 登录
- **CDP 检测**：Electron 内的交互式 Google 页面（如账号选择器）可能因 CDP 检测而失败，这是使用系统 Chrome 的原因
