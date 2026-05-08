# Implementation Plan: Login Detection Prompt

## Overview

在 API skill / 调价 skill 执行失败或心跳任务预检时，通过 Cookie 空检测判断平台登录状态，未登录则在聊天面板弹出内联提示弹窗。纯正向新增，不修改现有功能逻辑。

## Tasks

- [x] 1. Create LoginStatusChecker and add IPC channel constant
  - [x] 1.1 Add LOGIN_STATUS_ALERT IPC channel to shared types
    - In `src/shared/types.ts`, add `LOGIN_STATUS_ALERT: 'login:status-alert'` to the `IPC_CHANNELS` object, inside the existing `// 登录辅助相关` section
    - _Requirements: 7.1_

  - [x] 1.2 Create `src/main/login-status-checker.ts`
    - Import `CookieService` from `./cookie-service`
    - Define `PLATFORM_DISPLAY_NAMES` mapping (cookieDomain → Chinese display name) as specified in the design document
    - Implement `LoginStatusChecker` class with constructor accepting `CookieService`
    - Implement `isLoggedIn(cookieDomain: string): Promise<boolean>` — returns `true` if `CookieService.getCookiesForDomain()` returns non-empty string, `false` otherwise
    - Implement `getDisplayName(cookieDomain: string): string` — returns mapped name or raw cookieDomain as fallback
    - Keep it simple: ~20 lines total
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

  - [ ]* 1.3 Write property tests for LoginStatusChecker
    - **Property 1: Cookie empty string equals not logged in**
    - **Property 2: Platform display name resolution**
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5**

- [x] 2. Create LoginAlertDialog renderer component and styles
  - [x] 2.1 Create `src/renderer/components/login-alert-dialog.ts`
    - Implement `LoginAlertDialog` class with constructor accepting `chatMessagesElement: HTMLElement`
    - Implement `show(platforms: string[]): void` — renders inline alert with platform names joined by "、", with "确认" and "取消" buttons
    - Implement debounce: `lastAlertTime` Map, suppress same platform within 60 seconds
    - Implement `dismiss(): void` — removes existing alert by ID `loginAlertInline`
    - Before showing new alert, call `dismiss()` to remove any existing one (at most one alert at a time)
    - Both buttons call `dismiss()` on click
    - Use CSS class `login-alert-inline` matching the `.skill-progress` panel style
    - Implement `destroy(): void` for cleanup
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 6.1, 6.2_

  - [x] 2.2 Add login alert dialog CSS styles to `src/renderer/styles/main.css`
    - Add styles for `.login-alert-inline`, `.login-alert-content`, `.login-alert-icon`, `.login-alert-text`, `.login-alert-actions`, `.login-alert-btn`, `.login-alert-confirm`, `.login-alert-cancel`
    - Match existing `.skill-progress` panel visual style (margin-left: 40px, CSS variables for colors, rounded corners, subtle background)
    - Support dark theme via `[data-theme="dark"]` selectors using existing CSS variables
    - ~30 lines of CSS
    - _Requirements: 5.1_

  - [ ]* 2.3 Write property tests for LoginAlertDialog
    - **Property 3: Alert text contains all platform names joined by "、"**
    - **Property 4: At most one alert element in DOM at any time**
    - **Property 5: Same platform suppressed within 60 seconds**
    - **Validates: Requirements 5.1, 5.5, 5.6, 6.1**

- [x] 3. Wire preload bridge and renderer initialization
  - [x] 3.1 Add `onStatusAlert` listener to preload bridge
    - In `src/preload/index.ts`, add `onStatusAlert` method to the `login` section of the `ElectronAPI` interface: `onStatusAlert: (callback: (event: { platforms: string[] }) => void) => () => void`
    - In the `login` implementation object, add: `onStatusAlert: (callback) => createEventListener(IPC_CHANNELS.LOGIN_STATUS_ALERT, callback)`
    - _Requirements: 7.2_

  - [x] 3.2 Initialize LoginAlertDialog in renderer app.ts
    - In `src/renderer/app.ts`, import `LoginAlertDialog` from `./components/login-alert-dialog`
    - Add a new `initializeLoginAlert()` function that: gets `chatMessages` element by ID, creates `LoginAlertDialog` instance, subscribes to `window.electronAPI.login.onStatusAlert` and calls `loginAlert.show(event.platforms)`
    - Call `initializeLoginAlert()` at the end of `initializeMainPageComponents()`
    - _Requirements: 5.1, 7.2_

- [x] 4. Checkpoint - Verify renderer components compile and render
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Integrate LoginStatusChecker into main process triggers
  - [x] 5.1 Inject LoginStatusChecker in main process entry
    - In `src/main/index.ts`, inside `initializeBusiness()`, after `CookieService` is created and injected into `SkillManager`:
    - Import `LoginStatusChecker` from `./login-status-checker`
    - Create `const loginStatusChecker = new LoginStatusChecker(cookieService)`
    - Call `this.piAgentManager.setLoginStatusChecker(loginStatusChecker)` (if piAgentManager exists)
    - Call `this.heartbeatManager.setLoginStatusChecker(loginStatusChecker)` (if heartbeatManager exists)
    - _Requirements: 7.3_

  - [x] 5.2 Add setter and login check in PiAgentManager
    - In `src/main/pi-agent-manager.ts`:
    - Add private field `private loginStatusChecker: any = null`
    - Add setter method `setLoginStatusChecker(checker: any): void { this.loginStatusChecker = checker; }`
    - In `executeToolCalls()`, after an api-* skill returns failure (both `result.success === false` and `raw.success === false` branches), add login check: extract `cookieDomain` from `mergedArgs`, call `this.loginStatusChecker.isLoggedIn(cookieDomain)`, if not logged in send `LOGIN_STATUS_ALERT` IPC with `{ platforms: [displayName] }` via `this.mainWindow.webContents.send()`
    - Also handle `smart-price-adjust` skill failure: hardcode `cookieDomain = 'ebooking.ctrip.com'` for that skill
    - Keep additions minimal (~15 lines in executeToolCalls, 2 lines for field+setter)
    - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.2_

  - [x] 5.3 Add pre-check in HeartbeatManager
    - In `src/main/heartbeat/heartbeat-manager.ts`:
    - Add private field `private loginStatusChecker: any = null`
    - Add setter method `setLoginStatusChecker(checker: any): void { this.loginStatusChecker = checker; }`
    - In `executeTask()`, at the very beginning of the method (before `executingTasks.add`), add pre-check: extract `cookieDomain` from `task.params`, if present and `loginStatusChecker` exists, call `isLoggedIn()`, if not logged in → log warning, send `LOGIN_STATUS_ALERT` IPC, call `pushTaskStatus(task.id, 'done')`, and `return` early
    - ~15 lines of new code
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 8.3_

- [x] 6. Final checkpoint - Ensure all tests pass and feature is complete
  - Ensure all tests pass, ask the user if questions arise.
  - Verify: Cookie detection correctly identifies empty vs non-empty cookies
  - Verify: Login alert dialog renders inside chat panel with correct platform names
  - Verify: Debounce suppresses duplicate alerts within 60 seconds
  - Verify: Existing LoginNotificationBanner and recovery flows remain unchanged

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- This is a NEW feature — no existing functionality logic is modified
- LoginStatusChecker is intentionally simple: just wraps CookieService.getCookiesForDomain() with empty check
- LoginAlertDialog is an inline element in the chat panel, not a full-screen overlay
- CSS matches existing .skill-progress panel style
- Minimal changes to existing files (just adding hooks to trigger the check)
