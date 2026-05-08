# Requirements Document

## Introduction

本功能为酒店 AI 浏览器新增登录状态检测与提示机制。当 API skill、调价 skill 执行失败或心跳任务预检时，通过检测对应平台 Cookie 是否为空来判断登录状态，未登录则在聊天面板内弹出提示弹窗，引导用户在左侧浏览器中登录。本功能为纯正向新增，不修改现有功能逻辑。

## Glossary

- **LoginStatusChecker**: 主进程中的登录状态检测服务，通过 CookieService 判断指定平台是否已登录
- **LoginAlertDialog**: 渲染进程中的聊天面板内联提示弹窗组件，用于显示未登录提示
- **CookieService**: 已有的 Electron session Cookie 提取服务，提供 `getCookiesForDomain()` 方法
- **PiAgentManager**: 已有的 LLM Agent 管理器，负责对话和 tool calling
- **HeartbeatManager**: 已有的心跳调度管理器，负责定时任务执行
- **ChatPanel**: 渲染进程中的 AI 对话面板区域
- **Platform**: OTA 平台（携程、美团、Booking、Trip.com 等），通过 cookieDomain 标识
- **LoginNotificationBanner**: 已有的爬虫场景登录通知横幅组件，本功能不修改该组件

## Requirements

### Requirement 1: 登录状态检测

**User Story:** As a system operator, I want the system to detect whether a platform is logged in by checking cookies, so that login-related failures can be identified quickly.

#### Acceptance Criteria

1. WHEN a cookieDomain is provided, THE LoginStatusChecker SHALL determine login status by checking whether the Cookie string returned by CookieService is empty
2. WHEN the Cookie string for a cookieDomain is empty, THE LoginStatusChecker SHALL report the platform as not logged in
3. WHEN the Cookie string for a cookieDomain is non-empty, THE LoginStatusChecker SHALL report the platform as logged in
4. WHEN a cookieDomain is provided, THE LoginStatusChecker SHALL return the corresponding Chinese display name from the platform mapping table
5. WHEN a cookieDomain has no entry in the platform mapping table, THE LoginStatusChecker SHALL return the raw cookieDomain string as the display name

### Requirement 2: API Skill 失败时触发登录检测

**User Story:** As a system operator, I want the system to check login status when an API skill fails, so that I am notified if the failure is caused by not being logged in.

#### Acceptance Criteria

1. WHEN an api-* skill returns a failure result, THE PiAgentManager SHALL invoke LoginStatusChecker to check the login status of the corresponding cookieDomain
2. WHEN the login check determines the platform is not logged in, THE PiAgentManager SHALL send a LOGIN_STATUS_ALERT IPC event to the renderer process containing the platform display name
3. WHEN the login check determines the platform is logged in, THE PiAgentManager SHALL proceed with normal error handling without sending a login alert

### Requirement 3: 调价 Skill 失败时触发登录检测

**User Story:** As a system operator, I want the system to check login status when the smart-price-adjust skill fails, so that I am notified if the failure is caused by not being logged in to ebooking.

#### Acceptance Criteria

1. WHEN the smart-price-adjust skill returns a failure result, THE PiAgentManager SHALL invoke LoginStatusChecker to check the login status of ebooking.ctrip.com
2. WHEN the login check determines ebooking.ctrip.com is not logged in, THE PiAgentManager SHALL send a LOGIN_STATUS_ALERT IPC event to the renderer process containing the platform display name

### Requirement 4: 心跳任务预检

**User Story:** As a system operator, I want the heartbeat system to skip tasks for platforms that are not logged in, so that unnecessary recovery attempts are avoided.

#### Acceptance Criteria

1. WHEN a heartbeat task is about to execute and the task has a cookieDomain parameter, THE HeartbeatManager SHALL check login status before executing the task
2. WHEN the pre-check determines the platform is not logged in, THE HeartbeatManager SHALL skip the task without entering the recovery flow
3. WHEN the pre-check determines the platform is not logged in, THE HeartbeatManager SHALL send a LOGIN_STATUS_ALERT IPC event to the renderer process containing the platform display name
4. WHEN the pre-check determines the platform is not logged in, THE HeartbeatManager SHALL mark the task status as done
5. WHEN the pre-check determines the platform is logged in, THE HeartbeatManager SHALL proceed with normal task execution

### Requirement 5: 聊天面板内联提示弹窗

**User Story:** As a user, I want to see a login prompt inside the chat panel when a platform is not logged in, so that I know which platform needs login without being interrupted by a full-screen overlay.

#### Acceptance Criteria

1. WHEN a LOGIN_STATUS_ALERT event is received, THE LoginAlertDialog SHALL display an inline alert inside the ChatPanel showing the platform name and a login instruction message
2. THE LoginAlertDialog SHALL display two buttons: "确认" and "取消"
3. WHEN the user clicks "确认", THE LoginAlertDialog SHALL close the alert dialog
4. WHEN the user clicks "取消", THE LoginAlertDialog SHALL close the alert dialog
5. WHEN multiple platforms are not logged in simultaneously, THE LoginAlertDialog SHALL combine platform names into a single alert message separated by "、"
6. WHEN a new alert is triggered while an existing alert is displayed, THE LoginAlertDialog SHALL remove the existing alert before showing the new one

### Requirement 6: 防抖机制

**User Story:** As a user, I want the system to avoid repeated login alerts for the same platform within a short period, so that I am not overwhelmed by duplicate notifications.

#### Acceptance Criteria

1. WHEN a login alert for a specific platform was shown within the last 60 seconds, THE LoginAlertDialog SHALL suppress the duplicate alert for that platform
2. WHEN 60 seconds have elapsed since the last alert for a specific platform, THE LoginAlertDialog SHALL allow a new alert for that platform

### Requirement 7: IPC 通道与依赖注入

**User Story:** As a developer, I want the login detection feature to follow the existing IPC and dependency injection patterns, so that the codebase remains consistent and maintainable.

#### Acceptance Criteria

1. THE system SHALL define a LOGIN_STATUS_ALERT IPC channel in the shared types module
2. THE preload bridge SHALL expose an onStatusAlert listener method in the login namespace for the renderer process to subscribe to LOGIN_STATUS_ALERT events
3. WHEN the application initializes, THE main process SHALL create a LoginStatusChecker instance with the existing CookieService and inject it into PiAgentManager and HeartbeatManager via setter methods

### Requirement 8: 现有功能隔离

**User Story:** As a developer, I want the new login detection feature to be completely independent from the existing LoginNotificationBanner, so that the crawler login flow remains unaffected.

#### Acceptance Criteria

1. THE LoginAlertDialog SHALL be a separate component from the existing LoginNotificationBanner
2. THE LoginNotificationBanner SHALL continue to function unchanged for crawler-based login scenarios
3. THE LoginStatusChecker SHALL not modify any existing error handling or recovery logic in PiAgentManager or HeartbeatManager
