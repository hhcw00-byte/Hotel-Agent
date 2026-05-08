# Requirements Document

## Introduction

The login-check-skill is a new independent skill that detects whether the user is currently logged into various OTA platforms (携程, 美团, Booking, Trip.com) by opening background tabs, navigating to each platform URL, and running the existing `LoginDetector` against the loaded page. Results feed into the existing `LoginAlertService` to display a popup for platforms that require login. The skill supports four trigger scenarios: manual button click, heartbeat pre-check, application startup, and post-login re-check. This is a NEW feature that does not modify existing functionality.

## Glossary

- **Login_Check_Skill**: The child-process script (`scripts/login-check/index.js`) that receives a list of platforms, checks each via bgTab + LoginDetector, and outputs a JSON result to stdout.
- **SKILL_Definition**: The metadata file (`skills/login-check/SKILL.md`) that declares the skill for registration by SkillLoader.
- **LoginDetector**: The existing DOM-based login page detector from `scripts/ai-web-crawler/dist/login-detector.js` that analyzes a page and returns `{ isLoginPage, confidence }`.
- **LoginAlertService**: The existing main-process service (`src/main/login-status-checker.ts`) that sends login alert popups to the renderer via IPC.
- **bgTab**: A hidden BrowserView created by WindowManager for background page loading, managed via IPC temp files in `os.tmpdir()`.
- **CDP**: Chrome DevTools Protocol, used by Playwright's `connectOverCDP` to attach to Electron's BrowserView.
- **IPC_Handler**: The main-process module (`src/main/ipc-handler.ts`) that registers IPC channels for renderer-to-main communication.
- **HeartbeatManager**: The main-process cron scheduler that executes periodic data-collection tasks.
- **Platform**: An OTA website identified by a `{ domain, url, name }` tuple (e.g., `{ domain: "ebooking.ctrip.com", url: "https://ebooking.ctrip.com/", name: "携程后台" }`).
- **PlatformCheckResult**: The per-platform output object containing `{ domain, url, name, isLoggedIn, confidence, error }`.
- **Fail_Open**: The error-handling policy where detection failures default to `isLoggedIn: true` to avoid blocking heartbeat tasks with false-positive login alerts.
- **CDP_Lock**: The mutex file at `os.tmpdir()/hotel-ai-browser-cdp.lock` that prevents concurrent CDP connections.

## Requirements

### Requirement 1: Skill Script Platform Detection

**User Story:** As the system, I want to check each OTA platform's login status by opening a background tab and running LoginDetector, so that I can determine which platforms require the user to log in.

#### Acceptance Criteria

1. WHEN the Login_Check_Skill receives a non-empty platforms array, THE Login_Check_Skill SHALL check each Platform sequentially by creating a bgTab, connecting via CDP, running LoginDetector, and recording the result.
2. WHEN the Login_Check_Skill receives no platforms parameter or an empty array, THE Login_Check_Skill SHALL use the default platform list containing all supported OTA platforms.
3. WHEN LoginDetector reports `isLoginPage: true` for a Platform, THE Login_Check_Skill SHALL set `isLoggedIn: false` for that PlatformCheckResult.
4. WHEN LoginDetector reports `isLoginPage: false` for a Platform, THE Login_Check_Skill SHALL set `isLoggedIn: true` for that PlatformCheckResult.
5. THE Login_Check_Skill SHALL output exactly one PlatformCheckResult for each Platform in the input list, regardless of individual check success or failure.
6. THE Login_Check_Skill SHALL output a summary object containing `total`, `loggedIn`, `notLoggedIn`, and `errors` counts that sum correctly: `loggedIn + notLoggedIn + errors = total`.

### Requirement 2: Fail-Open Error Handling

**User Story:** As the system, I want detection errors to default to "logged in" status, so that transient failures do not generate false-positive login alerts that block heartbeat tasks.

#### Acceptance Criteria

1. IF a bgTab creation request receives no response within 15 seconds, THEN THE Login_Check_Skill SHALL return `isLoggedIn: true` and populate the `error` field with a descriptive message for that Platform.
2. IF the CDP connection to a bgTab fails, THEN THE Login_Check_Skill SHALL return `isLoggedIn: true` and populate the `error` field for that Platform.
3. IF LoginDetector throws an exception during page analysis, THEN THE Login_Check_Skill SHALL return `isLoggedIn: true` with `confidence: 0` and populate the `error` field for that Platform.
4. IF a page load exceeds 15 seconds without reaching networkidle, THEN THE Login_Check_Skill SHALL attempt LoginDetector on the partially loaded page before falling back to `isLoggedIn: true`.
5. WHEN any individual Platform check fails, THE Login_Check_Skill SHALL continue checking the remaining platforms without aborting.

### Requirement 3: bgTab Lifecycle Management

**User Story:** As the system, I want every background tab to be properly created and destroyed during the check, so that no orphaned BrowserViews consume memory or interfere with other operations.

#### Acceptance Criteria

1. WHEN the Login_Check_Skill checks a Platform, THE Login_Check_Skill SHALL create exactly one bgTab for that Platform via IPC temp file.
2. WHEN a Platform check completes (success or failure), THE Login_Check_Skill SHALL destroy the bgTab in a finally block, ensuring cleanup regardless of outcome.
3. THE Login_Check_Skill SHALL maintain at most one bgTab at any time during the entire check sequence.
4. WHEN the Login_Check_Skill starts, THE Login_Check_Skill SHALL acquire the CDP_Lock before creating any bgTab.
5. WHEN the Login_Check_Skill finishes all checks, THE Login_Check_Skill SHALL release the CDP_Lock.

### Requirement 4: SKILL.md Registration

**User Story:** As the SkillLoader, I want a valid SKILL.md file for login-check, so that the skill is registered and available for programmatic invocation.

#### Acceptance Criteria

1. THE SKILL_Definition SHALL declare `name: login-check`, `type: tool`, and `script: scripts/login-check/index.js`.
2. THE SKILL_Definition SHALL set `user-invocable: false` to prevent direct invocation from user chat.
3. THE SKILL_Definition SHALL declare an optional `platforms` parameter of type `array`.

### Requirement 5: Manual Trigger via IPC

**User Story:** As a hotel operator, I want to click a button on the dashboard to check all platform login statuses, so that I can see which platforms need me to log in before running tasks.

#### Acceptance Criteria

1. WHEN the renderer invokes the `login-check:run` IPC channel, THE IPC_Handler SHALL call SkillManager.executeSkill with the login-check skill and default parameters.
2. WHEN the Login_Check_Skill returns results with platforms where `isLoggedIn` is false, THE IPC_Handler SHALL pass those domains to LoginAlertService.alertByDomains to trigger the login popup.
3. WHEN the Login_Check_Skill returns results, THE IPC_Handler SHALL return the full result object to the renderer for display.

### Requirement 6: Heartbeat Pre-Check Integration

**User Story:** As the HeartbeatManager, I want to check login status for a task's platform before executing the task, so that I can skip tasks for platforms where the user is not logged in and alert them instead.

#### Acceptance Criteria

1. WHEN HeartbeatManager is about to execute a task, THE HeartbeatManager SHALL invoke the Login_Check_Skill with only the single Platform matching the task's `cookieDomain`.
2. WHEN the pre-check result indicates the Platform is not logged in, THE HeartbeatManager SHALL skip the task execution and call LoginAlertService.alertByDomains with that domain.
3. WHEN the pre-check result indicates the Platform is logged in or the check errors out (Fail_Open), THE HeartbeatManager SHALL proceed with normal task execution.

### Requirement 7: UI Button for Manual Trigger

**User Story:** As a hotel operator, I want a "检测登录状态" button on the hotel-admin dashboard, so that I can manually initiate a login status check.

#### Acceptance Criteria

1. THE hotel-admin.html page SHALL display a "检测登录状态" button in the control panel section.
2. WHEN the user clicks the button, THE button SHALL enter a disabled loading state with text "检测中..." until the check completes.
3. WHEN the check completes successfully, THE UI SHALL display a toast showing the count of logged-in and not-logged-in platforms.
4. IF the check fails, THEN THE UI SHALL display an error toast with the failure message and restore the button to its original state.

### Requirement 8: Preload Bridge Extension

**User Story:** As the renderer process, I want a `window.electronAPI.loginCheck.run()` method exposed via the preload bridge, so that the UI can invoke the login check through the secure contextBridge.

#### Acceptance Criteria

1. THE preload bridge SHALL expose a `loginCheck.run` method that invokes the `login-check:run` IPC channel.
2. THE preload bridge SHALL return the IPC result to the caller without modification.

### Requirement 9: Input Validation

**User Story:** As the system, I want the skill to validate its input parameters, so that malformed input does not cause unexpected crashes.

#### Acceptance Criteria

1. WHEN the Login_Check_Skill receives a platforms array, THE Login_Check_Skill SHALL validate that each entry contains non-empty `domain` and `url` fields.
2. WHEN a platform entry has an empty `domain` or `url`, THE Login_Check_Skill SHALL skip that entry and log a warning.
3. WHEN the Login_Check_Skill receives a `url` that does not start with `https://`, THE Login_Check_Skill SHALL skip that entry and log a warning.

### Requirement 10: Sequential Execution and Resource Safety

**User Story:** As the system, I want platform checks to run one at a time, so that CDP connection conflicts and excessive memory usage are avoided.

#### Acceptance Criteria

1. THE Login_Check_Skill SHALL check platforms sequentially, completing one Platform check (including bgTab cleanup) before starting the next.
2. WHILE the CDP_Lock is held by another process, THE Login_Check_Skill SHALL wait up to 30 seconds for the lock to be released before aborting with an error.
3. THE Login_Check_Skill SHALL be idempotent: running the check multiple times for the same login state SHALL produce equivalent results without modifying any platform state.

### Requirement 11: Startup and Post-Login Re-Check Triggers

**User Story:** As the system, I want login checks to run automatically at app startup and after a login alert is dismissed, so that the user is promptly informed of login status changes.

#### Acceptance Criteria

1. WHEN the application finishes initialization, THE main process SHALL invoke the Login_Check_Skill with the default platform list as a background operation that does not block app startup.
2. WHEN a login alert popup is dismissed by the user, THE main process SHALL invoke the Login_Check_Skill for the platforms that were reported as not logged in, to verify whether the user has since logged in.
