# Design: 登录状态检测与提示

## 概述

API skill 或调价 skill 执行失败时，检测对应平台是否已登录（通过 Cookie 是否为空判断），未登录则在聊天面板弹出提示弹窗。

## 核心原则

- **正向新增**，不修改现有功能代码的逻辑
- **简洁**，能 10 行解决不用 100 行
- **稳定检测**：Cookie 字符串为空 = 未登录，有内容 = 已登录。不依赖特征 Cookie 名

## High-Level Design

```
API skill / 调价 skill 执行失败
  → 主进程：CookieService.getCookiesForDomain(cookieDomain)
  → Cookie 为空？
    → 是：IPC 推送 LOGIN_STATUS_ALERT 到渲染进程
    → 否：正常走错误处理（不是登录问题）
  → 渲染进程：在聊天面板弹出提示弹窗
    → 用户点"确认"：关闭弹窗
    → 用户点"取消"：关闭弹窗
```

### 触发时机

| 触发源 | 时机 | 条件 |
|--------|------|------|
| 对话中 API skill 失败 | `executeToolCalls()` 中 api-* 返回失败 | cookieDomain 的 Cookie 为空 |
| 对话中调价 skill 失败 | `smart-price-adjust` 返回失败 | ebooking.ctrip.com 的 Cookie 为空 |
| 心跳任务预检 | `executeTask()` 执行前 | cookieDomain 的 Cookie 为空 → 跳过任务 |
| 对话中 fetch_data 被拦截 | `executeToolCalls()` 中 block | 相关平台 Cookie 为空 |

### 平台映射（cookieDomain → 显示名称）

```typescript
const PLATFORM_DISPLAY_NAMES: Record<string, string> = {
  'ebooking.ctrip.com': '携程后台 (ebooking)',
  'hotels.ctrip.com': '携程',
  'ehotel.meituan.com': '美团商家后台',
  'me.meituan.com': '美团商家后台',
  'pms.meituan.com': '美团 PMS',
  'admin.booking.com': 'Booking 后台',
  'www.booking.com': 'Booking',
  'www.trip.com': 'Trip.com',
  'trip.com': 'Trip.com',
};
```

### 弹窗 UI

在聊天面板内弹出，不是全屏遮罩。样式类似现有的 skill-progress 面板。

```
┌─────────────────────────────────────┐
│  🔐 {平台名} 未登录                  │
│                                     │
│  请在左侧浏览器中登录该平台，         │
│  登录后即可正常获取数据。             │
│                                     │
│      [ 确认 ]    [ 取消 ]            │
└─────────────────────────────────────┘
```

- 多个平台未登录时，合并为一条消息：`携程后台、美团商家后台 未登录`
- 防抖：同一平台 60 秒内不重复弹窗

## Low-Level Design

### 新增文件

#### 1. `src/main/login-status-checker.ts`

```typescript
import { CookieService } from './cookie-service';

const PLATFORM_DISPLAY_NAMES: Record<string, string> = {
  'ebooking.ctrip.com': '携程后台 (ebooking)',
  'hotels.ctrip.com': '携程',
  'ehotel.meituan.com': '美团商家后台',
  'me.meituan.com': '美团商家后台',
  'pms.meituan.com': '美团 PMS',
  'admin.booking.com': 'Booking 后台',
  'www.booking.com': 'Booking',
  'www.trip.com': 'Trip.com',
  'trip.com': 'Trip.com',
};

export class LoginStatusChecker {
  private cookieService: CookieService;

  constructor(cookieService: CookieService) {
    this.cookieService = cookieService;
  }

  /** Cookie 为空 = 未登录 */
  async isLoggedIn(cookieDomain: string): Promise<boolean> {
    const cookies = await this.cookieService.getCookiesForDomain(cookieDomain);
    return cookies.length > 0;
  }

  /** 获取平台显示名称 */
  getDisplayName(cookieDomain: string): string {
    return PLATFORM_DISPLAY_NAMES[cookieDomain] || cookieDomain;
  }
}
```

就这么简单。核心就一个方法 `isLoggedIn()`，内部调用已有的 `CookieService`。

#### 2. `src/renderer/components/login-alert-dialog.ts`

```typescript
/**
 * 聊天面板内的登录提示弹窗
 * 插入到 chatMessages 容器中，不是全屏遮罩
 */
export class LoginAlertDialog {
  private chatMessages: HTMLElement;
  private lastAlertTime: Map<string, number> = new Map();
  private DEBOUNCE_MS = 60_000;

  constructor(chatMessagesElement: HTMLElement) {
    this.chatMessages = chatMessagesElement;
  }

  /**
   * 显示登录提示
   * @param platforms 未登录的平台名称列表（已翻译为中文）
   */
  show(platforms: string[]): void {
    if (platforms.length === 0) return;

    // 防抖
    const now = Date.now();
    const newPlatforms = platforms.filter(p => {
      const last = this.lastAlertTime.get(p) || 0;
      return now - last > this.DEBOUNCE_MS;
    });
    if (newPlatforms.length === 0) return;
    for (const p of newPlatforms) this.lastAlertTime.set(p, now);

    // 移除已有的提示（避免堆叠）
    this.dismiss();

    const alertDiv = document.createElement('div');
    alertDiv.className = 'login-alert-inline';
    alertDiv.id = 'loginAlertInline';

    const names = newPlatforms.join('、');
    alertDiv.innerHTML = `
      <div class="login-alert-content">
        <span class="login-alert-icon">🔐</span>
        <span class="login-alert-text">
          <strong>${names}</strong> 未登录，请在左侧浏览器中登录该平台，登录后即可正常获取数据。
        </span>
      </div>
      <div class="login-alert-actions">
        <button class="login-alert-btn login-alert-confirm">确认</button>
        <button class="login-alert-btn login-alert-cancel">取消</button>
      </div>
    `;

    alertDiv.querySelector('.login-alert-confirm')?.addEventListener('click', () => this.dismiss());
    alertDiv.querySelector('.login-alert-cancel')?.addEventListener('click', () => this.dismiss());

    this.chatMessages.appendChild(alertDiv);
    this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
  }

  dismiss(): void {
    const existing = document.getElementById('loginAlertInline');
    if (existing) existing.remove();
  }

  destroy(): void {
    this.dismiss();
    this.lastAlertTime.clear();
  }
}
```

### 修改的现有文件（最小改动）

#### 3. `src/shared/types.ts` — 新增 1 个 IPC 通道

```typescript
// IPC_CHANNELS 中新增一行
LOGIN_STATUS_ALERT: 'login:status-alert',
```

#### 4. `src/preload/index.ts` — login 对象新增 1 个方法

```typescript
// 在 login: { ... } 中新增
onStatusAlert: (callback: (event: { platforms: string[] }) => void): (() => void) => {
  return createEventListener(IPC_CHANNELS.LOGIN_STATUS_ALERT, callback);
},
```

#### 5. `src/renderer/app.ts` — 初始化时创建 LoginAlertDialog 并监听事件

```typescript
// 在 initializeMainPageComponents() 末尾新增
function initializeLoginAlert(): void {
  const chatMessages = document.getElementById('chatMessages');
  if (!chatMessages) return;
  const loginAlert = new LoginAlertDialog(chatMessages);
  window.electronAPI.login.onStatusAlert((event) => {
    loginAlert.show(event.platforms);
  });
}
```

#### 6. `src/main/pi-agent-manager.ts` — executeToolCalls 中 API skill 失败时触发

在 api-* skill 返回失败的分支中，新增约 10 行代码：

```typescript
// 在 result.success === false 且 toolName.startsWith('api-') 的分支末尾
if (cookieDomain && this.loginStatusChecker) {
  const loggedIn = await this.loginStatusChecker.isLoggedIn(cookieDomain);
  if (!loggedIn && this.mainWindow && !this.mainWindow.isDestroyed()) {
    const displayName = this.loginStatusChecker.getDisplayName(cookieDomain);
    this.mainWindow.webContents.send('login:status-alert', { platforms: [displayName] });
  }
}
```

#### 7. `src/main/heartbeat/heartbeat-manager.ts` — executeTask 开头预检

在 `executeTask()` 方法的 `try` 块最前面新增约 15 行：

```typescript
const cookieDomain = (task.params as any)?.cookieDomain;
if (cookieDomain && this.loginStatusChecker) {
  const loggedIn = await this.loginStatusChecker.isLoggedIn(cookieDomain);
  if (!loggedIn) {
    this.log('warn', `Skipping task ${task.id}: platform not logged in`, { cookieDomain });
    const displayName = this.loginStatusChecker.getDisplayName(cookieDomain);
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('login:status-alert', { platforms: [displayName] });
    }
    this.pushTaskStatus(task.id, 'done');
    return;
  }
}
```

#### 8. `src/renderer/styles/main.css` — 弹窗样式

约 30 行 CSS，样式与现有的 `.skill-progress` 面板风格一致。

### 不改动的文件

- `login-notification-banner.ts` — 不动，爬虫场景继续用它
- `tab-promotion-manager.ts` — 不动
- `window-manager.ts` — 不动
- `skill-executor.ts` — 不动（Cookie 注入逻辑不变）
- `api-failure-detector.ts` — 不动
- `api-self-repair.ts` — 不动

## 依赖注入

`LoginStatusChecker` 需要 `CookieService` 实例。在 `HotelAIBrowserApp`（`src/main/index.ts`）初始化时创建，传给 `PiAgentManager` 和 `HeartbeatManager`：

```typescript
// index.ts 中
const loginStatusChecker = new LoginStatusChecker(this.cookieService);
this.piAgentManager.setLoginStatusChecker(loginStatusChecker);
this.heartbeatManager.setLoginStatusChecker(loginStatusChecker);
```

`PiAgentManager` 和 `HeartbeatManager` 各新增一个 setter 方法（2 行代码）。


## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Cookie 空字符串等价于未登录

*For any* cookieDomain string, `isLoggedIn(cookieDomain)` SHALL return `true` if and only if `CookieService.getCookiesForDomain(cookieDomain)` returns a non-empty string; it SHALL return `false` if and only if the returned Cookie string is empty.

**Validates: Requirements 1.1, 1.2, 1.3**

### Property 2: 平台显示名称解析

*For any* cookieDomain string, `getDisplayName(cookieDomain)` SHALL return the value from `PLATFORM_DISPLAY_NAMES[cookieDomain]` if the key exists, and SHALL return the raw cookieDomain string unchanged if the key does not exist.

**Validates: Requirements 1.4, 1.5**

### Property 3: 弹窗渲染包含所有平台名称

*For any* non-empty list of platform name strings, after calling `LoginAlertDialog.show(platforms)`, the rendered alert text SHALL contain all platform names joined by the separator "、".

**Validates: Requirements 5.1, 5.5**

### Property 4: 同一时刻最多一个弹窗

*For any* sequence of `LoginAlertDialog.show()` calls, the DOM SHALL contain at most one login alert element at any point in time.

**Validates: Requirement 5.6**

### Property 5: 同平台 60 秒内防抖

*For any* platform name, if `LoginAlertDialog.show([platform])` was called within the last 60 seconds, a subsequent call with the same platform name SHALL be suppressed and no new alert SHALL be rendered.

**Validates: Requirement 6.1**
