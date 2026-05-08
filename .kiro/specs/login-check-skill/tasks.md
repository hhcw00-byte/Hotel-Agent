# Implementation Plan: login-check-skill

## Overview

Implement a new login-check skill that detects OTA platform login status via background tabs and LoginDetector. The skill runs as a child process, checks platforms sequentially, and feeds results into the existing LoginAlertService. Implementation follows the smart-price-adjust pattern for CDP connection and bgTab IPC.

Files to create: `skills/login-check/SKILL.md`, `scripts/login-check/index.js`
Files to modify (minimal additions): `src/shared/types.ts`, `src/preload/index.ts`, `src/main/ipc-handler.ts`, `src/renderer/pages/hotel-admin.html`, `package.json`

Deferred to later: Heartbeat pre-check (Req 6), App startup trigger (Req 11.1), Post-login re-check (Req 11.2).

## Tasks

- [x] 1. Add IPC channel constant and preload bridge
  - [x] 1.1 Add `LOGIN_CHECK_RUN` constant to `IPC_CHANNELS` in `src/shared/types.ts`
    - Add `LOGIN_CHECK_RUN: 'login-check:run'` to the IPC_CHANNELS object, in the login section near existing `LOGIN_STATUS_ALERT`
    - _Requirements: 5.1, 8.1_

  - [x] 1.2 Add `loginCheck.run` method to preload bridge in `src/preload/index.ts`
    - Add `loginCheck` section to the `ElectronAPI` interface with `run: () => Promise<any>`
    - Add `loginCheck` implementation to the `electronAPI` object: `run: () => ipcRenderer.invoke(IPC_CHANNELS.LOGIN_CHECK_RUN)`
    - Follow the exact pattern of existing bridge methods (e.g., `competitor.resolvePlatformIds`)
    - _Requirements: 8.1, 8.2_

- [x] 2. Create SKILL.md definition
  - [x] 2.1 Create `skills/login-check/SKILL.md`
    - YAML frontmatter: `name: login-check`, `description: 检测各OTA平台登录状态...`, `script: scripts/login-check/index.js`, `type: tool`, `user-invocable: false`
    - Declare optional `platforms` parameter of type `array`
    - Add usage section with example JSON input/output
    - _Requirements: 4.1, 4.2, 4.3_

- [x] 3. Implement core skill script
  - [x] 3.1 Create `scripts/login-check/index.js` with input parsing, default platforms, and output helpers
    - Define `DEFAULT_PLATFORMS` array with all 7 OTA platforms (domain, url, name)
    - Parse `process.argv[2]` JSON; fall back to `DEFAULT_PLATFORMS` when platforms param is empty/missing
    - Implement `validatePlatforms()` — filter out entries with empty domain, empty url, or non-https url; log warnings to stderr
    - Implement `output()` helper that writes JSON to stdout
    - Implement `computeSummary(results)` — calculate total, loggedIn, notLoggedIn, errors counts
    - Wire up the main IIFE: parse → validate → sequential loop → summary → output
    - _Requirements: 1.1, 1.2, 1.5, 1.6, 9.1, 9.2, 9.3_

  - [x] 3.2 Implement bgTab IPC helpers (`requestBgTab`, `destroyBgTab`) and CDP lock
    - `requestBgTab(url, sessionId)`: write IPC temp file to `os.tmpdir()`, poll for response file, 15s timeout. Follow the smart-price-adjust pattern for IPC temp file format.
    - `destroyBgTab(tabId, sessionId)`: fire-and-forget IPC temp file write, never throws
    - `acquireCdpLock(sessionId)`: write lock file at `os.tmpdir()/hotel-ai-browser-cdp.lock`, wait up to 30s if held by another process (stale detection: PID check + 2min mtime)
    - `releaseCdpLock()`: delete lock file, silently ignore errors
    - _Requirements: 3.1, 3.2, 3.4, 3.5, 10.1, 10.2_

  - [x] 3.3 Implement `checkPlatform(platform, cdpPort, sessionId)` with LoginDetector integration
    - Create bgTab via `requestBgTab`, connect via Playwright `connectOverCDP`, find page by URL
    - Wait for page load (networkidle, max 15s); on timeout, attempt detection on partial page
    - Load `LoginDetector` from `scripts/ai-web-crawler/dist/login-detector.js`, call `detectLogin(page)`
    - Map result: `isLoggedIn = !detection.isLoginPage`, preserve `confidence`
    - Fail-open on any error: return `{ isLoggedIn: true, confidence: 0, error: message }`
    - Always destroy bgTab in finally block; always close browser connection
    - Maintain at most one bgTab at a time (sequential execution)
    - _Requirements: 1.1, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 2.5, 3.2, 3.3, 10.1, 10.3_

  - [ ]* 3.4 Write property tests for input parsing and result computation (fast-check)
    - **Property 4: Default platform fallback** — for any empty/null/undefined platforms input, default list is used; for non-empty valid input, provided list is used
    - **Validates: Requirements 1.2**

  - [ ]* 3.5 Write property tests for summary computation and output count
    - **Property 2: Output count invariant** — for any N valid platforms, output contains exactly N results
    - **Property 3: Summary arithmetic invariant** — `loggedIn + notLoggedIn + errors === total === results.length`
    - **Validates: Requirements 1.5, 1.6**

  - [ ]* 3.6 Write property test for login status inversion
    - **Property 1: Login status inversion** — for any LoginDetector result, `isLoggedIn === !isLoginPage`
    - **Validates: Requirements 1.3, 1.4**

  - [ ]* 3.7 Write property test for input validation filtering
    - **Property 5: Input validation filtering** — entries with empty domain, empty url, or non-https url are excluded
    - **Validates: Requirements 9.1, 9.2, 9.3**

- [x] 4. Checkpoint - Ensure skill script works standalone
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Register IPC handler and wire LoginAlertService
  - [x] 5.1 Add `registerLoginCheckHandlers()` in `src/main/ipc-handler.ts`
    - Register `ipcMain.handle(IPC_CHANNELS.LOGIN_CHECK_RUN, ...)` handler
    - Call `this.skillManager.executeSkill('login-check', {})` with default params
    - Extract not-logged-in domains from results (`isLoggedIn === false`)
    - Pass domains to `LoginAlertService.alertByDomains()` (access via existing `loginAlertService` reference pattern)
    - Return full result to renderer
    - _Requirements: 5.1, 5.2, 5.3_

  - [x] 5.2 Call `registerLoginCheckHandlers()` from `registerHandlers()` method
    - Add the call in the handler registration sequence, near `registerLoginHandlers()`
    - _Requirements: 5.1_

  - [ ]* 5.3 Write property test for not-logged-in domain filtering
    - **Property 6: Not-logged-in domain filtering for alerts** — domains sent to alertByDomains are exactly those where `isLoggedIn === false`
    - **Validates: Requirements 5.2**

- [x] 6. Add UI button to hotel-admin.html
  - [x] 6.1 Add "检测登录状态" button and `runLoginCheck()` function to `src/renderer/pages/hotel-admin.html`
    - Add button in the platform config section (数据渠道配置 card), styled with existing `.btn .btn-primary` classes
    - Button text: `🔐 检测登录状态`, disabled state text: `检测中...`
    - `runLoginCheck()`: call `window.electronAPI.loginCheck.run()`, show loading state, display toast with summary on success, error toast on failure, restore button in finally
    - Add i18n entries for button text and result messages
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

- [x] 7. Add extraResources entry for packaging
  - [x] 7.1 Add `scripts/login-check` to `build.extraResources` in `package.json`
    - Add entry: `{ "from": "scripts/login-check", "to": "scripts/login-check", "filter": ["**/*.js"] }`
    - Place near the other `scripts/*` entries
    - _Requirements: 4.1 (packaging support)_

- [x] 8. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Requirements 6 (heartbeat pre-check), 11.1 (startup trigger), and 11.2 (post-login re-check) are deferred to a follow-up task list
- The skill script is plain JavaScript (not TypeScript), runs as a child process via SkillExecutor
- Follow the smart-price-adjust pattern for CDP connection and bgTab IPC temp file communication
