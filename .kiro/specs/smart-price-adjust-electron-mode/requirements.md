# Requirements: smart-price-adjust Electron Mode

## 概述

将 smart-price-adjust 调价技能从独立 Chrome 窗口模式改造为 Electron BrowserView（bgTab）模式，复用项目已有的 CDP 连接和 IPC 文件机制，实现在 Electron 内隐藏执行调价操作。

## 用户故事

### US-1: Electron 模式自动启用
作为酒店管理员，当我在 Electron 应用内通过 AI 对话触发调价时，调价脚本应自动通过 Electron 内置浏览器执行，无需安装独立 Chrome 或配置 Chrome profile。

**验收标准：**
- AC-1.1: Electron 应用运行时（CDP 端口 9222 可达），调价自动使用 Electron bgTab 模式
- AC-1.2: 调价在隐藏的 bgTab 中执行，用户无感知
- AC-1.3: 复用 Electron session 的 Cookie（携程 ebooking 登录态），无需独立 Chrome profile

### US-2: Chrome 模式兼容降级
作为开发者，当 Electron 环境不可用时（如独立测试），调价脚本应自动降级到独立 Chrome 模式，保持原有行为不变。

**验收标准：**
- AC-2.1: `SMART_PRICE_BROWSER_MODE=chrome` 时，行为与改造前完全一致
- AC-2.2: `SMART_PRICE_BROWSER_MODE=auto`（默认）且 CDP 端口不可达时，静默降级到 Chrome 模式
- AC-2.3: 现有 `createRuntime` 的 persistent 和 non-persistent 路径代码零修改

### US-3: CDP 锁互斥
作为系统，调价脚本和爬虫不应同时使用 CDP 连接，避免 Playwright 并发连接冲突。

**验收标准：**
- AC-3.1: 调价与爬虫共享同一个 CDP 锁文件（`hotel-ai-browser-cdp.lock`）
- AC-3.2: 锁获取超时 5 分钟后抛错，调价失败
- AC-3.3: Stale 锁自动检测清除（PID 存活性 + 2 分钟 mtime 阈值）
- AC-3.4: 进程异常退出后锁残留可被下次获取时自动清除

### US-4: bgTab 生命周期管理
作为系统，调价创建的 bgTab 应在调价完成或失败后被正确清理，不留残留资源。

**验收标准：**
- AC-4.1: 调价完成后通过 IPC 文件请求 Electron 销毁对应 session 的 bgTab
- AC-4.2: 调价异常失败时，cleanup 回调自动释放锁 + 销毁 bgTab
- AC-4.3: 每次调价使用唯一 sessionId（`price-adjust-{timestamp}`），不影响其他 session 的 bgTab

### US-5: 返回值兼容
作为调价业务逻辑（2000+ 行），Electron 模式返回的 Page 对象和 RuntimeResult 结构应与现有模式完全一致，无需任何适配。

**验收标准：**
- AC-5.1: `createRuntimeFromElectronBgTab` 返回值包含 browser、context、page 等字段，结构与现有 `createRuntime` 一致
- AC-5.2: 下游业务逻辑（stepEnterPricePage、stepSelectRoomType 等）无需任何修改
- AC-5.3: SKILL.md 参数定义不变，Agent 调用方式不变

## 约束

- 所有代码修改限制在 `scripts/smart-price-adjust/` 目录内（3 个文件）
- 不修改 WindowManager、HeartbeatManager、SkillExecutor 等已有模块
- 调价只通过用户对话触发，不走心跳系统
- 复用现有 IPC 文件协议（`create_bg_tab`、`destroy_bg_tabs_by_session`），不新增协议
