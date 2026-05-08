# Hotel AI Browser — 项目架构文档

> 本文档供 AI 会话快速理解项目全貌。更新日期：2026-05-07

## 一、项目概述

酒店行业 AI 浏览器桌面应用。核心能力：内嵌浏览器访问各 OTA 平台（携程/美团/Trip.com/Booking 等）后台和公网，通过 AI Agent 自动拦截 API、生成请求脚本、定时采集价格/房态数据并入库，形成自维护闭环。

关键闭环流程：
```
HeartbeatManager.executeTask()
  → 直接执行 API 脚本（不经过 Agent）
  → isEmptyAPIResponse() 检测数据是否为空壳
  → 如果为空 → executeAgentRecovery()
    策略B：读脚本 → 诊断 → 修复 → 执行 → 验证 → data-store 入库
    策略A：爬虫拦截 API → 重写脚本 → 执行 → 验证 → data-store 入库
  → verifyRecoveryData() 独立验证数据文件（不依赖 Agent 文字回复）
```

## 二、技术栈概览

| 层面 | 技术 | 说明 |
|------|------|------|
| 桌面框架 | Electron 28 | main + renderer + preload 三进程架构 |
| 语言 | TypeScript (主进程/渲染进程) + JavaScript (scripts/) | tsconfig target ES2020, module commonjs |
| UI | 原生 DOM + 手写 TS class 组件 | 无 React/Vue/Angular |
| 样式 | 纯 CSS + CSS 变量 | 无 Tailwind/SCSS，支持亮/暗主题切换 |
| 状态管理 | 无框架 | 主进程各 Manager 类内存状态 + electron-store 持久化 |
| 构建 | Webpack 5 + ts-loader | 4 个 entry: main, preload, renderer, google-auth-subprocess |
| 打包 | electron-builder | NSIS installer for Windows, DMG for macOS |
| 数据库 | MySQL 2 (云端远程) | 通过 database/database-manager.ts 访问 |
| AI/LLM | OpenAI SDK + 多 provider | Anthropic / Google Gemini / Azure / Ollama |
| Agent 框架 | @mariozechner/pi-coding-agent | tool-use 模式，skill 作为 function calling |
| 爬虫 | Playwright (独立子项目 scripts/ai-web-crawler/) | CDP 连接 Electron BrowserView |
| 定时任务 | cron 库 | HeartbeatManager 调度 |
| 测试 | Jest + ts-jest | 单元测试 |
| 代码混淆 | javascript-obfuscator | 打包时对 dist/ 混淆 |

## 三、目录结构

```
hotel-ai-browser/
├── src/                          # 源码（TypeScript）
│   ├── main/                     # Electron 主进程（所有业务逻辑）
│   │   ├── index.ts              # 入口：HotelAIBrowserApp 类
│   │   ├── heartbeat/            # 心跳调度系统
│   │   │   ├── heartbeat-manager.ts  # 定时任务执行 + recovery 闭环
│   │   │   └── types.ts
│   │   ├── skill-loader.ts       # 扫描 skills/ 目录，解析 SKILL.md
│   │   ├── skill-registry.ts     # 技能注册表（内存 Map）
│   │   ├── skill-manager.ts      # 技能生命周期管理 + AI 上下文生成
│   │   ├── skill-executor.ts     # 技能脚本执行（spawn 子进程）
│   │   ├── pi-agent-manager.ts   # LLM Agent 管理（对话 + tool calling）
│   │   ├── browser-manager.ts    # BrowserView 管理
│   │   ├── window-manager.ts     # 窗口 + bgTab 后台标签页管理
│   │   ├── cookie-service.ts     # 从 Electron session 提取 Cookie
│   │   ├── config-manager.ts     # 应用配置（electron-store）
│   │   ├── auth-manager.ts       # 用户认证（MySQL + bcrypt）
│   │   ├── ipc-handler.ts        # IPC 通道注册（main ↔ renderer）
│   │   ├── database-loader.ts    # 数据库模块加载（处理打包路径）
│   │   ├── api-failure-detector.ts # API 失效检测（HTTP 状态码/网络错误/token 过期）
│   │   ├── api-self-repair.ts    # API 自修复
│   │   ├── logger.ts             # 日志系统（文件 + 控制台，自动轮转）
│   │   ├── path-resolver.ts      # 路径解析（双基路径：静态/可写，开发/打包环境兼容）
│   │   ├── anti-detection/       # 反检测模块
│   │   └── memory/               # 记忆系统（酒店配置持久化）
│   ├── renderer/                 # Electron 渲染进程（前端 UI）
│   │   ├── app.ts                # 渲染进程入口
│   │   ├── components/           # UI 组件
│   │   │   ├── chat-panel.ts     # AI 对话面板
│   │   │   ├── split-layout.ts   # 左右分屏拖拽布局
│   │   │   ├── web-controls.ts   # 浏览器地址栏和导航
│   │   │   ├── message-renderer.ts # Markdown → HTML 渲染
│   │   │   ├── login-page.ts     # 登录页
│   │   │   ├── login-notification-banner.ts # 登录提示横幅
│   │   │   └── error-dialog.ts   # 错误弹窗
│   │   ├── pages/                # 独立 HTML 页面
│   │   │   └── hotel-admin.html  # Dashboard 数据面板
│   │   ├── styles/
│   │   │   └── main.css          # 全局样式（CSS 变量主题）
│   │   ├── index.html            # 主页面模板
│   │   └── i18n.ts               # 国际化（中/英）
│   ├── preload/
│   │   └── index.ts              # contextBridge 安全桥接
│   └── shared/
│       ├── types.ts              # 所有 TypeScript 接口 + IPC 通道常量
│       ├── constants.ts
│       ├── utils.ts
│       └── llm-config-loader.ts
│
├── scripts/                      # 技能脚本（JS，由 Agent 生成/维护）
│   ├── api-runtime/              # API 脚本运行时库（唯一 HTTP 封装）
│   │   └── index.js              # APIRuntime 类：fetch + Cookie注入 + 限速 + 重试
│   ├── api-ctrip-public-price/   # 携程公网价格（index.js + adapter.js）
│   ├── api-ctrip-backend-price/  # 携程后台价格
│   ├── api-trip-public-price/    # Trip.com 公网价格
│   ├── api-meituan-backend-price/# 美团后台价格
│   ├── api-meituan-realtime-status/ # 美团 PMS 房态
│   ├── api-ctrip-hotel-search/   # 携程酒店搜索
│   ├── api-booking-hotel-search/ # Booking 酒店搜索（slug 解析）
│   ├── api-booking-backend-price/# Booking 后台房价
│   ├── data-store/               # 数据解析 + 入库（调 adapter → 写 MySQL）
│   ├── data-cleaner/             # 数据清洗（含旧版 adapter）
│   ├── ai-web-crawler/           # 爬虫子项目（独立 TS 项目）
│   │   ├── src/                  # Playwright + LLM 视觉导航
│   │   ├── dist/                 # 编译产物
│   │   ├── package.json          # 独立依赖
│   │   └── tsconfig.json
│   ├── file-operations/          # 文件操作（Agent 读写 scripts/ 和 skills/）
│   ├── database-operations/      # 数据库查询（独立 TS 子项目）
│   ├── smart-price-adjust/       # OTA 一键调价 V2（Playwright 自动化，支持携程/美团/Trip/Booking）
│   └── data-persistence/         # 数据持久化（旧版，逐步废弃）
│
├── skills/                       # 技能定义（SKILL.md）
│   ├── ai-web-crawler/SKILL.md   # 爬虫 skill（最详细的参考）
│   ├── api-*/SKILL.md            # 各 API skill 定义
│   ├── api-booking-hotel-search/SKILL.md
│   ├── api-booking-backend-price/SKILL.md
│   ├── data-store/SKILL.md       # 数据入库 skill
│   ├── file-operations/SKILL.md  # 文件操作 skill
│   ├── database-operations/SKILL.md # 数据库查询 skill
│   ├── public-pricing/SKILL.md   # 策略型：公网价格获取流程
│   ├── smart-pricing/SKILL.md    # 策略型：智能调价建议
│   ├── smart-reply/SKILL.md      # 策略型：智能回复
│   └── smart-price-adjust/SKILL.md # 工具型：OTA 一键调价执行
│
├── agent/                        # Agent 人设和 prompt 模板
│   ├── persona/                  # Agent 身份定义
│   │   ├── IDENTITY.md
│   │   ├── SOUL.md
│   │   └── AGENTS.md
│   └── prompts/                  # Recovery prompt 模板
│       ├── recovery.md           # 完整 recovery prompt（策略A+B）
│       ├── recovery-base.md      # recovery 基础信息
│       ├── recovery-strategy-a.md # 策略A：爬虫重新拦截
│       ├── recovery-strategy-b.md # 策略B：本地修复脚本
│       ├── api-first-instruction.md # API 拦截后的脚本生成指令
│       ├── script-examples.md    # 经过验证的脚本示例
│       └── skills-usage-rules.md # 工具调用规则
│
├── database/                     # 数据库模块（独立 TS 子项目）
│   ├── database-manager.ts       # DatabaseManager 类（MySQL 操作）
│   ├── dist/                     # 编译产物
│   ├── package.json              # 独立依赖（mysql2）
│   └── tsconfig.json
│
├── tasks/
│   └── schedule.json             # 心跳任务调度配置（打包后迁移到 userData/tasks/）
│
├── data/                         # 运行时数据（打包后迁移到 userData/data/）
│   ├── api-results/              # API 原始响应存档（每次调用生成一个文件）
│   ├── memory/hotels.json        # 酒店记忆数据
│   └── *-diag.json               # 诊断文件
│
├── dist/                         # Webpack 构建产物
├── release/                      # electron-builder 打包产物
├── screenshots/                  # 爬虫导航截图
├── docs/                         # 项目文档
├── tests/                        # 集成测试
│
├── package.json                  # 主项目依赖和脚本
├── tsconfig.json                 # TypeScript 配置
├── webpack.config.js             # Webpack 配置（4 个 entry）
├── llm-config.json               # LLM 模型配置
└── .eslintrc.js                  # ESLint 配置
```

## 四、核心架构模式

### 4.1 进程模型

```
┌─────────────────────────────────────────────────────┐
│                   Electron Main Process              │
│                                                     │
│  HotelAIBrowserApp                                  │
│    ├── ConfigManager (electron-store)                │
│    ├── AuthManager (MySQL + bcrypt)                  │
│    ├── WindowManager (BrowserView + bgTab)           │
│    ├── SkillManager                                  │
│    │     ├── SkillLoader (扫描 skills/*.md)          │
│    │     ├── SkillRegistry (内存 Map)                │
│    │     └── SkillExecutor (spawn 子进程)            │
│    ├── PiAgentManager (LLM tool-calling)             │
│    ├── HeartbeatManager (cron 调度)                  │
│    ├── CookieService (session Cookie 提取)           │
│    ├── IPCHandler (IPC 通道注册)                     │
│    └── Logger (文件+控制台，自动轮转)                │
│                                                     │
│         ┌──────────┐    ┌──────────────┐            │
│         │ preload   │    │ BrowserView  │            │
│         │ (bridge)  │    │ (OTA 网站)   │            │
│         └────┬──────┘    └──────────────┘            │
│              │ contextBridge                         │
│         ┌────▼──────┐                                │
│         │ Renderer  │                                │
│         │ (UI 组件) │                                │
│         └───────────┘                                │
└─────────────────────────────────────────────────────┘

子进程（spawn，独立 Node.js）：
  ├── scripts/api-*/index.js        ← API 数据获取
  ├── scripts/data-store/index.js   ← 数据解析+入库
  ├── scripts/ai-web-crawler/dist/  ← Playwright 爬虫
  ├── scripts/file-operations/      ← 文件读写
  └── scripts/database-operations/  ← 数据库查询
```

### 4.2 数据请求体系

项目有三套独立的 HTTP 请求体系：

**体系 A：API 脚本 → 外部平台（scripts/api-runtime/）**

所有 `api-*` 脚本获取外部数据的唯一通道。基于 Node.js 内置 `http`/`https` 模块，不用 axios。

```
APIRuntime.fetch(url, options)
  ├── Cookie 自动注入：从 env.BROWSER_COOKIES 读取
  ├── 同域限速：>= 500ms + 随机抖动(0-500ms)
  ├── 同域并发控制：<= 2
  ├── 自动重试：429/503 指数退避（1s→2s→4s，最多3次）
  ├── 自动跟随重定向：301/302/303/307/308，最多5跳
  └── 输出：runtime.output(data) → stdout JSON
```

Cookie 注入链路：
```
Electron session.defaultSession.cookies
  → CookieService.getCookiesForDomain(domain)
  → SkillExecutor 写入子进程 env.BROWSER_COOKIES
  → APIRuntime.fetch() 自动读取 env 注入到 headers
```

没有跨域问题（Node.js 子进程发请求，不受 CORS 限制）。

**体系 B：渲染进程 ↔ 主进程（IPC）**

渲染进程不直接发 HTTP 请求，所有操作通过 IPC：
```
renderer: window.electronAPI.dashboard.getPriceSnapshots(startTime)
  → preload: ipcRenderer.invoke('dashboard:price-snapshots', startTime)
  → main: IPCHandler → DatabaseManager.getDashboardPriceSnapshots()
  → MySQL → 返回
```

IPC 通道常量定义在 `src/shared/types.ts` 的 `IPC_CHANNELS` 对象中。

**体系 C：LLM API 调用（pi-agent-manager.ts）**

使用 OpenAI SDK，支持多 provider 分发（callAnthropicAPI / callOpenAIAPI / callGoogleAPI 等）。

### 4.3 状态管理

无 Redux/Vuex 等框架。"主进程为王"模式，所有业务状态在主进程。

| 状态持有者 | 存储方式 | 内容 |
|-----------|---------|------|
| ConfigManager | electron-store (JSON 文件) | LLM 配置、窗口尺寸、语言、DB 连接 |
| AuthManager | MySQL + electron-store | 当前用户、saved credentials |
| SkillRegistry | 内存 Map | 已加载 skill 元数据和状态 |
| HeartbeatManager | 内存 Map + userData/tasks/schedule.json | 定时任务、执行状态 |
| PiAgentManager | 内存数组 | 对话历史（也写入 MySQL chat_messages） |
| WindowManager | 内存 | BrowserView 列表、bgTab、活跃标签页 |
| MemoryManager | JSON 文件 (data/memory/) | 酒店记忆 |
| DatabaseManager | MySQL 远程 | 价格快照、房态快照、竞品、房型映射 |

渲染进程状态极轻量：各组件内部维护（ChatPanel.messages、SplitLayout.splitRatio 等）。
跨进程同步靠 IPC push 事件（HEARTBEAT_TASK_STATUS、TAB_UPDATE 等）。

### 4.4 双基路径架构（Dual Base Path）

打包后 `process.resourcesPath`（`C:\Program Files\...\resources\`）在 Windows 上对非管理员用户只读。`path-resolver.ts` 提供两条路径：

| | 静态路径 `getBasePath()` | 可写路径 `getWritableBasePath()` |
|---|---|---|
| **打包** | `process.resourcesPath` (只读) | `app.getPath('userData')` (%APPDATA%/Hotel AI Browser/) |
| **开发** | `process.cwd()` | `process.cwd()` (同一目录，零行为差异) |

路径分配：

| 路径函数 | 指向 | 内容 |
|---------|------|------|
| `getBasePath()` | 静态 | scripts/、database/dist/、agent prompts |
| `getWritableBasePath()` | 可写 | — |
| `getDataDir()` | 可写 | data/api-results/、data/memory/ |
| `getTasksDir()` | 可写 | tasks/schedule.json |
| `getLLMConfigPath()` | 可写 | llm-config.json |
| `getSkillsDir()` | asar 内 | skills/ (webpack 打包) |
| `getScriptsDir()` | 静态 | scripts/ |
| `getAgentDir()` | asar 内 | agent/ (webpack 打包) |

首次启动迁移（`ensureRuntimeDirs()`，仅打包模式）：
1. 创建 `userData/data/api-results/`、`userData/data/memory/`、`userData/tasks/`
2. 复制 `resources/tasks/*.json` → `userData/tasks/`（目标不存在时）
3. 复制 `resources/llm-config.json` → `userData/llm-config.json`（目标不存在时）

子进程通过环境变量 `DATA_DIR` 获取可写数据目录：
```javascript
const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
```

HeartbeatManager 接收 `resourcesBasePath` 参数定位只读资源（scripts/、agent/），`configPath` 指向可写的 `userData/tasks/schedule.json`。

### 4.5 样式与组件体系

**样式**：纯手写 CSS，CSS 变量做主题切换。

```css
:root { --primary-color: #2a5298; --background: #f5f7fa; }
[data-theme="dark"] { --primary-color: #5b8dd9; --background: #1e1e1e; }
```

全局样式在 `src/renderer/styles/main.css`，通过 webpack style-loader 注入。无 CSS Modules。

**组件**：原生 TypeScript class，统一模式：

```typescript
class SomeComponent {
  constructor(config?) {
    // 1. getElementById 获取 DOM
    // 2. addEventListener 绑定事件
    // 3. 初始化状态
  }
  // 公共方法操作 DOM
  destroy(): void { /* 清理 */ }
}
```

无通用 UI 组件库，所有 Button/Input/Modal 直接写 HTML+CSS。

## 五、Skill 系统（核心机制）

### 5.1 Skill 类型

| type | 说明 | 可执行 | 示例 |
|------|------|--------|------|
| tool | 可执行工具，有对应 scripts/ 脚本 | ✅ | api-ctrip-public-price, data-store, file-operations |
| strategy | 操作手册/流程指南，无脚本 | ❌ | public-pricing, backend-pricing, competitive-intel |

### 5.2 SKILL.md 格式

```markdown
---
name: api-ctrip-public-price          # 唯一标识，[a-zA-Z0-9_-]
description: 携程公网房价实时API...     # Agent 看到的描述
script: scripts/api-ctrip-public-price/index.js  # 脚本路径
type: tool                             # tool | strategy
user-invocable: false                  # 是否允许用户直接调用
parameters:                            # 参数定义 → 转换为 OpenAI function schema
  cookieDomain:
    type: string
    description: Cookie域名
    required: true
  hotelId:
    type: number
    description: 酒店ID
    required: false
---

## 使用方法
（Markdown 正文，Agent load_skill 时看到的完整内容）
```

### 5.3 Skill 加载流程

```
SkillLoader.loadFromDirectory()
  → 扫描 skills/ 下所有子目录
  → 读取每个目录的 SKILL.md（兼容大小写）
  → 解析 YAML frontmatter → SkillMetadata
  → 检查 scripts/ 下对应脚本是否存在
  → 注册到 SkillRegistry

SkillManager.loadAllSkills()（打包模式额外步骤）
  → 上述流程加载主 skills 目录后
  → 额外扫描 getWritableBasePath()/skills/（agent 生成的 skill）
  → 仅注册主目录中不存在的 skill（避免覆盖）
```

### 5.4 Skill 执行流程

```
SkillManager.executeSkill(skillName, params)
  → SkillRegistry.get(skillName)
  → SkillExecutor.execute(context)
    → 解析 metadata.script 得到脚本路径
    → 检查脚本文件存在（打包时 fallback 到 getWritableBasePath()）
    → 注入环境变量（SKILL_PARAMS, BROWSER_COOKIES, DATA_DIR, DB_*, LLM_*）
    → spawn(process.execPath, [scriptPath, paramsJson], { env: { ELECTRON_RUN_AS_NODE: '1' } })
    → 收集 stdout/stderr
    → parseOutput() 提取最后一个完整 JSON 对象
    → 返回 SkillResult { success, output, executionTime, format }
```

### 5.5 Agent 如何使用 Skill

PiAgentManager 将 skill 转换为 OpenAI function calling tools：

```
buildToolDefinitions()
  → 遍历 SkillRegistry.getEnabled()
  → 每个 skill 的 metadata.parameters → OpenAI JSON Schema properties
  → 额外添加 load_skill 工具（非 recovery 模式）

executeToolCalls()
  → load_skill → 返回 skill 的完整 SKILL.md 内容
  → 其他 tool → SkillManager.executeSkill()
  → 结果格式化后返回给 LLM
```

关键行为：
- `load_skill` 与其他工具同批调用时，只执行 `load_skill`，其他跳过
- Gemini 会把 tool name 连字符转下划线，executeToolCalls 有 normalize 逻辑
- Recovery 模式下不暴露 `load_skill`（prompt 已包含完整指令）
- 爬虫调用强制注入 `background: true`（静默模式）

### 5.6 API 脚本规范

所有 `api-*` 脚本必须遵循：

```javascript
// 1. 引入运行时（唯一 HTTP 库，禁止 axios）
const { APIRuntime } = require('../api-runtime');
const runtime = new APIRuntime();
const params = JSON.parse(process.argv[2] || '{}');

// 2. 顶层立即执行（禁止 module.exports = { run }）
(async () => {
  try {
    const response = await runtime.fetch(url, {
      method: 'POST',
      headers: { /* 从拦截结果完整复制 */ },
      body: JSON.stringify(payload)  // body 必须是字符串
    });
    if (!response.ok) return runtime.outputError('HTTP_ERROR', `status: ${response.status}`);
    runtime.output(response.data);
  } catch (e) { runtime.outputError('EXCEPTION', e.message); }
})();
```

铁律：
- 日期必须动态计算，禁止硬编码
- Cookie 通过 runtime 自动注入，禁止硬编码
- headers 从 apiCandidates[i].requestHeaders 完整复制
- isRSC 必须为 false

### 5.7 Adapter 规范

每个 `api-*` 脚本配套一个 `adapter.js`，负责原始响应 → 标准格式：

```javascript
function adapt(rawData) {
  return {
    platform: 'ctrip-public',  // 平台标识
    data: [{
      roomName: '豪华大床房',
      planName: '含早套餐',
      date: '2026-04-20',       // YYYY-MM-DD
      price: 388,               // 元（美团分→元需 /100）
      originalPrice: 488,
      cost: null,
      currency: 'CNY',
      breakfast: '含早',
      available: true,
      totalRooms: 20,
      availableRooms: null,     // 公网必须为 null
      occupancyRate: 0.85,
      adr: 350,
      revpar: 297,
      sourceType: 'public'      // 'public' | 'backend'
    }]
  };
}
module.exports = { adapt };
```

availableRooms 铁律：
- 公网 API（sourceType='public'）→ 必须为 null
- 后台 API（sourceType='backend'）→ `(val != null && val < 999) ? val : null`

## 六、心跳系统与 Recovery 闭环

### 6.1 任务调度

配置文件：`tasks/schedule.json`

```json
{
  "tasks": [{
    "id": "api-ctrip-public",
    "skill": "api-ctrip-public-price",
    "platform": "ctrip",
    "cron": "7 16 * * *",
    "enabled": true,
    "params": {
      "cookieDomain": "hotels.ctrip.com",
      "startUrl": "https://hotels.ctrip.com/",
      "crawlerTarget": "搜索住小叮三里屯酒店，进入酒店详情页查看房价"
    }
  }, {
    "id": "api-booking-backend",
    "skill": "api-booking-backend-price",
    "platform": "booking",
    "cron": "12 16 * * *",
    "enabled": true,
    "params": {
      "cookieDomain": "admin.booking.com"
    }
  }]
}
```

### 6.2 executeTask 完整流程

```
executeTask(task)
  ├── 前置：登录预检 checkLoginForTask()
  ├── 前置修补：patchExpiredDates() + patchWrongHotelId()
  ├── 步骤0c：从 hotel_config 注入平台 ID（poiId/partnerId/hotelId/hotelSlug）到 taskParams
  │   └── 美团 partnerId 做 parseInt() 转数字（VARCHAR → number）
  ├── try:
  │   ├── 1. skillManager.executeSkill(task.skill, taskParams)  ← 直接调 API
  │   ├── 2. isEmptyAPIResponse() 检测空壳
  │   ├── 3. skillManager.executeSkill('data-store', { source }) ← 入库
  │   └── 4. executeCompetitorTasks() ← 竞品价格采集
  └── catch:
      ├── autoFixScript() ← 确定性修复（日期/isRSC/hotelId）
      │   └── 成功 → executeCompetitorTasks() → return
      └── executeAgentRecovery() ← Agent 闭环修复
          ├── sanitizeHardcodedIds() ← 去掉脚本中硬编码的酒店标识默认值
          ├── extractAndSavePlatformIds() ← 从 api-results 提取 poiId/partnerId 存库
          └── 成功 → executeCompetitorTasks()
```

### 6.3 Recovery Agent 流程

```
executeAgentRecovery(task, errorMsg)
  ├── 清理旧 bgTab（前缀匹配 destroyBgTabsBySession）
  ├── 构建 recovery prompt（buildRecoveryPrompt）
  │   ├── 注入：错误信息、任务参数、本店 hotelId、脚本示例
  │   └── 选择策略：完整(A+B) / 仅A / 仅B
  ├── 创建 Recovery PiAgentManager（独立实例）
  │   ├── skillAllowList: [ai-web-crawler, file-operations, 目标skill, data-store, data-cleaner]
  │   ├── defaultSkillParams: { background:true, sessionId, start_url, cookieDomain }
  │   └── recoveryMode: true（不暴露 load_skill）
  ├── sendMessage(recoveryPrompt)
  │   └── Agent 自主调用工具链：爬虫→file-operations→api-*→data-store
  └── verifyRecoveryData(skill, afterTimestamp)
      └── 检查 data/api-results/ 下是否有新的成功数据文件
```

### 6.4 竞品采集流程

```
executeCompetitorTasks(task)
  ├── 仅公网价格 skill 展开（含 'price' 且不含 'backend'）
  ├── databaseManager.getCompetitorPlatformIds(platform)
  └── 遍历竞品：
      ├── Booking 平台：传 hotelSlug（slug 字符串）
      ├── 其他平台：传 hotelId（数字 ID）
      ├── executeSkill('data-store', { source, hotelId: competitorId })
      └── resolveRoomMappings()
```

### 6.5 竞品平台 ID 解析（确定性代码）

竞品平台 ID 解析已从 Agent 决策模式改为确定性代码（`ipc-handler.ts` 的 `executeCompetitorResolver`）：

```
executeCompetitorResolver()
  ├── 解析本店 Booking slug（如 hotel_config 中无 booking_hotel_id）
  ├── 遍历每个竞品：
  │   ├── api-ctrip-hotel-search → 成功则写入 ctrip + trip
  │   └── api-booking-hotel-search → 成功则写入 booking（含品牌名校验）
  └── 成功一个存一个，单条失败不影响其他
```

不依赖 Agent/LLM 决策，无需 AI 配置即可执行。

## 七、数据库设计

### 7.1 连接方式

- 主进程：`database/database-manager.ts` 编译后通过 `database-loader.ts` 加载，直连 MySQL
- 子进程脚本：通过环境变量 `DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_USER_ID` 获取连接信息
- 两者使用同一个 `DatabaseManager` 类

### 7.2 核心表

```sql
price_snapshots     -- 所有价格数据（本店+竞品，公网+后台）
room_snapshots      -- 所有房态数据（实时+远期）
competitors         -- 竞品列表（含位置信息）
competitor_platform_ids -- 竞品在各平台的 hotelId 映射
hotel_config        -- 本店配置（名称、地址、经纬度、各平台 hotelId）
room_type_mapping   -- 跨平台房型名映射（canonical_name ↔ platform_room_name）
chat_messages       -- 对话记录
```

### 7.3 数据流

```
API 脚本 → userData/data/api-results/{skill}-{timestamp}.json（原始存档，打包后在 %APPDATA%）
  → data-store/index.js
    → adapter.adapt(rawData) → 标准 records
    → price 有效 → databaseManager.insertPriceSnapshots()
    → availableRooms 有效 → databaseManager.insertRoomSnapshots()
```

## 八、开发规范

### 8.1 新增 API Skill

1. 创建脚本：`scripts/api-{platform}-{dataType}/index.js`（遵循 APIRuntime 规范）
2. 创建适配器：`scripts/api-{platform}-{dataType}/adapter.js`（遵循 adapter 规范）
3. 创建定义：`skills/api-{platform}-{dataType}/SKILL.md`（YAML frontmatter + Markdown）
4. 调用 `reloadAllSkills` 热加载（或 file-operations 写入 skills/ 时自动触发）
5. 在 `tasks/schedule.json` 添加心跳任务
6. 在 `package.json` 的 `build.extraResources` 添加打包配置

### 8.2 新增渲染进程页面

1. 在 `src/renderer/pages/` 创建 HTML 文件
2. webpack.config.js 的 `rendererConfig.plugins` 中 CopyWebpackPlugin 已配置复制 `pages/`
3. 通过 `window.electronAPI.app.getPagesPath()` 获取页面路径
4. 用 BrowserView 或 iframe 加载
5. 页面内通过 `window.electronAPI.*` 调用主进程 API

### 8.3 新增 IPC 通道

1. 在 `src/shared/types.ts` 的 `IPC_CHANNELS` 添加通道常量
2. 在 `src/main/ipc-handler.ts` 注册 handler（`ipcMain.handle`）
3. 在 `src/preload/index.ts` 的 `ElectronAPI` 接口添加方法
4. 在 `src/preload/index.ts` 的 `electronAPI` 实现中添加 `ipcRenderer.invoke` 调用
5. 渲染进程通过 `window.electronAPI.xxx.method()` 调用

### 8.4 新增 UI 组件

1. 在 `src/renderer/components/` 创建 TS 文件
2. 遵循 class 组件模式（constructor 获取 DOM + 绑定事件 + destroy 清理）
3. 在 `src/renderer/app.ts` 的 `initializeApp()` 中实例化
4. 样式写在 `src/renderer/styles/main.css`（全局 CSS，用 CSS 变量）

### 8.5 修改数据库表结构

1. 修改 `database/database-manager.ts` 的 `createTables()` 方法
2. 编译：在 `database/` 目录下 `npx tsc`
3. 产物在 `database/dist/database-manager.js`
4. 主进程通过 `database-loader.ts` 自动加载

### 8.6 构建与运行

```bash
# 开发
npm run dev          # webpack --mode development --watch
npm run start        # 启动 Electron（带 stderr 过滤）
npm run dev:electron # 启动 Electron（带 inspector）

# 构建
npm run build        # webpack --mode production
npm run package:win  # 构建 + 打包 Windows 安装包

# 测试
npm test             # jest
```

## 九、特殊逻辑与注意事项

### 9.1 子进程执行模型

所有 skill 脚本通过 `child_process.spawn` 独立执行：
- 输入：`process.argv[2]`（JSON 参数）+ 环境变量
- 输出：`stdout`（JSON 结果）+ `stderr`（日志）
- `ELECTRON_RUN_AS_NODE=1` 让 Electron 可执行文件当普通 Node.js 用
- `DATA_DIR` 环境变量指向可写数据目录（打包后 %APPDATA%/Hotel AI Browser/data/）
- 脚本崩溃不影响主进程，但每次执行都 fork 新进程

### 9.2 Webpack 打包后的 require 陷阱

webpack 打包后动态 `require()` 路径不工作。`pi-agent-manager.ts` 中用 `vm.runInNewContext` 执行 adapter.js 作为 workaround。

### 9.3 CDP 锁机制

爬虫通过 `os.tmpdir()/hotel-ai-browser-cdp.lock` 文件互斥。SIGKILL 不触发 `process.once('exit')`，所以 `SkillExecutor.child.on('close')` 有兜底清理。stale 检测：PID 存活性检查 + 2 分钟 mtime 阈值。

### 9.4 Tool Name 下划线/连字符转换

Gemini 模型把连字符转下划线（`api-ctrip-public-price` → `api_ctrip_public_price`）。`executeToolCalls` 有 normalize：非 `load_` 开头的 tool name 中下划线转回连字符。

### 9.5 Recovery 模式隔离

Recovery Agent 和用户对话 Agent 是同一个 `PiAgentManager` 类的不同实例：
- `recoveryMode: true` → 不暴露 `load_skill`
- `skillAllowList` → 只暴露必要 skill
- `defaultSkillParams` → 强制注入 `background:true`、`sessionId`
- 爬虫调用自动清除 `tab_keyword`，自动推断 `start_url`

### 9.6 file-operations 写入触发热加载

`SkillManager.executeSkill` 中，如果 `file-operations` 的 `writeFile`/`editFile` 操作目标路径以 `skills/` 开头，会自动调用 `reloadAllSkills()` 热加载新 skill。

### 9.7 data/api-results 文件累积

`APIRuntime._saveResultFile()` 每次调用生成带时间戳的 JSON 文件（打包后写入 `%APPDATA%/Hotel AI Browser/data/api-results/`），无自动清理。长期运行会吃满磁盘。需要定期手动清理或实现自动清理。

### 9.8 electron-store 明文存储

`ConfigManager` 用 `electron-store` 存配置，LLM API Key 和 DB 密码是明文 JSON。`AuthManager` 的用户密码用 bcrypt 加密。

### 9.9 数据库双轨制

主进程直接 `require` DatabaseManager 连 MySQL；子进程脚本通过环境变量获取连接信息后独立连接。两者用同一个 DatabaseManager 类但不同实例。

### 9.10 bgTab 后台标签页

爬虫在静默模式下创建隐藏的 BrowserView（bgTab），与用户浏览器完全解耦。sessionId 格式 `recovery-{taskId}-{timestamp}`。`destroyBgTabsBySession` 使用前缀匹配清理。

### 9.11 smart-price-adjust 调价 skill

OTA 一键调价工具 V2，支持携程、美团、Trip.com、Booking 四个平台。代码在 `scripts/smart-price-adjust/`，通过 Playwright 自动化操作各 OTA 后台批量改价页面。

输入协议（三种模式）：

单平台单段：
```json
{
  "platformCode": "ctrip",
  "startDate": "2026-05-27",
  "endDate": "2026-05-28",
  "roomList": [{ "roomName": "豪华单人间", "price": "392" }]
}
```

单平台多段：
```json
{
  "platformCode": "ctrip",
  "segments": [
    { "startDate": "2026-05-12", "endDate": "2026-05-13", "roomList": [...] },
    { "startDate": "2026-05-19", "endDate": "2026-05-20", "roomList": [...] }
  ]
}
```

跨平台批量：
```json
{
  "tasks": [
    { "platformCode": "ctrip", ... },
    { "platformCode": "meituan", ... }
  ]
}
```

调用链路：
```
Agent 调用 smart-price-adjust skill
  → SkillExecutor spawn scripts/smart-price-adjust/index.js（桥接入口）
    → 环境准备（NODE_PATH → ai-web-crawler/node_modules, ELECTRON_RUN_AS_NODE=1）
    → runtime 注入（connectMode=electron-bgtab, cdpEndpoint, sessionId）
    → login-precheck.js（登录预检：检测需要调价的平台登录态）
    → 分发：
      ├── 有 tasks[] → batch-runner.js（串行执行每个平台）
      └── 无 tasks[] → core.js → input-normalizer → runtime-normalizer → router
    → segment-runner → {ctrip,trip,meituan,booking}/executor.js
    → shared/electron-runtime.js（Electron bgTab 运行时）
      ├── CDP 锁获取（与爬虫共享 hotel-ai-browser-cdp.lock）
      ├── connectOverCDP → Electron
      ├── IPC 文件 → 创建 bgTab
      ├── 监听 page 事件 → 获取 page
      └── setViewportSize + applyNotificationPolicy
    → date-select / room-select / price-fill / submit / verify-result
    → process.exit(0)
```

登录预检逻辑：
- 只检测需要调价的平台（不检测不相关的平台）
- 通过 login-checker 模块 CDP 连接 Electron 打开目标后台页面检测 URL
- 任一平台未登录 → 全部调价任务终止，返回 `OTA_LOGIN_REQUIRED`

平台能力边界：
| 平台 | 单段 | 多段 | 多房型 | 真实提交 |
|------|------|------|--------|---------|
| ctrip | 支持 | 支持 | 支持 | 已验证 |
| meituan | 支持 | 支持 | 支持 | 已验证 |
| trip | 支持 | 支持 | 支持 | 已验证 |
| booking | 支持 | 支持 | 每段仅1个room | 已验证 |

### 9.12 登录横幅延迟提升

爬虫检测到登录页时，不再立即提升 bgTab 到 mainWindow（会触发弹窗），而是：
1. `notifyLoginRequired()` — 只显示横幅通知，bgTab 保持在 bgWindow
2. 用户点击"前往登录" → `promoteAndSwitch()` — 才提升 bgTab 并切换显示
3. 用户点击"跳过" → `skipLogin()` — 直接清理，不提升

### 9.13 Booking 平台特殊处理

Booking 平台与其他 OTA 平台有以下关键差异：

- **酒店标识**：使用 URL slug（如 `intercontinental-beijing-sanlitun`）而非数字 hotelId
- **公网房价获取**：抓取 HTML 页面，解析嵌入的 `b_rooms_available_and_soldout` JSON，非 API 接口
- **后台房价获取**：GraphQL `roomInventoryQuery` 接口，需要 `ses` token（自动从 302 重定向获取）
- **酒店搜索**：GraphQL AutoComplete + 搜索结果页 HTML 正则提取 slug（两步流程）
- **竞品标识存储**：`competitor_platform_ids` 表中 `platform='booking'` 的 `platform_hotel_id` 存 slug 字符串
- **名称匹配**：搜索结果需经过品牌名 + 地理位置词双重校验，防止跨品牌错误匹配
- **Cookie 域名**：公网用 `www.booking.com`，后台用 `admin.booking.com`

### 9.14 Google 登录跨平台支持

`src/main/google-auth-chrome.ts` 的 `findChrome()` 支持 Windows / macOS / Linux 三平台浏览器检测：

| 平台 | 检测路径 |
|------|----------|
| Windows | Program Files / LocalAppData 下的 Chrome 和 Edge |
| macOS | `/Applications/Google Chrome.app/...`、`~/Applications/...`、Edge 同理 |
| Linux | `/usr/bin/google-chrome`、`chromium-browser`、`microsoft-edge` |

`cleanup()` 方法按平台使用不同的进程清理策略：
- Windows：`netstat` + `taskkill` 按端口杀进程树
- macOS：`lsof -ti :port` + `SIGTERM`
- 通用：先尝试 CDP `/json/close` 优雅关闭

### 9.15 房型映射（手动配置模式）

房型映射已从 LLM 自动匹配改为**用户手动配置**。

**配置 UI**：`src/renderer/pages/hotel-admin.html` 中的映射表格，用户为每个统一房型名填写各平台（携程/美团/Trip/Booking）对应的名称。

**匹配逻辑**（Dashboard 查询时实时 JOIN）：
1. 精确匹配：`映射值 = 采集到的 room_name`
2. 包含匹配：`INSTR(映射值, room_name) > 0` 或 `INSTR(room_name, 映射值) > 0`
3. 最长匹配优先：多条匹配时取 `CHAR_LENGTH(platform_room_name)` 最大的
4. 平台前缀匹配：映射表存 `ctrip` 能匹配数据表中的 `ctrip` 和 `ctrip-backend`

**IPC 通道**：`ROOM_MAPPING_GET_ALL`、`ROOM_MAPPING_SAVE`

**已知限制**：当多个房型名存在子串包含关系时（如 "Bed In Guestroom - Double Occupancy" 同时匹配男/女双人间），需要用户填写更精确的区分信息。详见 `docs/房型映射已知问题-2026-05-07.md`。

### 9.16 LLM Provider 自动恢复

`src/shared/llm-config-loader.ts` 实现主/备 provider 自动切换与恢复：

```
主 provider (openrouter) 失败（401/网络错误/5xx）
  → switchToFallback() → 切换到备用 provider (novaiapi)
  → 记录切换时间
  → 5 分钟后下次 API 调用时 tryRecoverPrimary()
    → 切回主 provider 尝试
    → 成功 → 继续用主 provider
    → 失败 → 再次切到备用，再等 5 分钟
```

`isProviderUnavailableError()` 判定范围：401/403/429/5xx、网络超时、连接拒绝、OpenRouter 特定错误。

### 9.17 Dashboard 展示维度

Dashboard 数据面板有独立的平台 tab 维度：

| Tab | 对应 DB platform 值 |
|-----|---------------------|
| 全部 | 不过滤 |
| 携程 | `ctrip-backend`, `ctrip-public` |
| Trip.com | `trip-public` |
| 美团 | `meituan-backend` |
| PMS | `meituan-pms` |
| Booking | `booking-public` |

## 十、关键文件速查

| 需求 | 文件 |
|------|------|
| 应用入口 | `src/main/index.ts` → `HotelAIBrowserApp` |
| 心跳调度 | `src/main/heartbeat/heartbeat-manager.ts` |
| Skill 加载 | `src/main/skill-loader.ts` |
| Skill 执行 | `src/main/skill-executor.ts` |
| Agent 对话 | `src/main/pi-agent-manager.ts` |
| IPC 注册 | `src/main/ipc-handler.ts` |
| 路径解析 | `src/main/path-resolver.ts`（getBasePath / getWritableBasePath / getDataDir / getTasksDir / getLLMConfigPath） |
| 类型定义 | `src/shared/types.ts` |
| preload 桥接 | `src/preload/index.ts` |
| 渲染进程入口 | `src/renderer/app.ts` |
| API 运行时 | `scripts/api-runtime/index.js` |
| 数据入库 | `scripts/data-store/index.js` |
| 数据库操作 | `database/database-manager.ts` |
| Recovery prompt | `agent/prompts/recovery.md` |
| 脚本示例 | `agent/prompts/script-examples.md` |
| 任务配置 | `tasks/schedule.json` |
| Webpack 配置 | `webpack.config.js` |
| 全局样式 | `src/renderer/styles/main.css` |
| 调价桥接入口 | `scripts/smart-price-adjust/index.js` |
| 调价核心逻辑 | `scripts/smart-price-adjust/core.js` |
| 调价登录预检 | `scripts/smart-price-adjust/login-precheck.js` |
| 调价批量编排 | `scripts/smart-price-adjust/batch-runner.js` |
| 调价平台路由 | `scripts/smart-price-adjust/router.js` |
| 调价 Electron bgTab 运行时 | `scripts/smart-price-adjust/shared/electron-runtime.js` |
| 调价 Playwright 加载 | `scripts/smart-price-adjust/shared/require-playwright.js` |
| 登录横幅管理 | `src/main/tab-promotion-manager.ts` |
| 进度记录 | `docs/进度记录-2026-04-21-skill优化与调价接入.md` |
| Booking 酒店搜索 | `scripts/api-booking-hotel-search/index.js` |
| Booking 后台房价 | `scripts/api-booking-backend-price/index.js` |
| 竞品确定性解析 | `src/main/ipc-handler.ts` → `executeCompetitorResolver()` |
| 调价 Electron 模式进度 | `docs/进度记录-2026-04-21-调价Electron模式.md` |
| Google 登录（系统 Chrome） | `src/main/google-auth-chrome.ts` |
| LLM 配置加载与 fallback | `src/shared/llm-config-loader.ts` |
| 房型映射 UI | `src/renderer/pages/hotel-admin.html` → `renderRoomMappingTable()` |
| 房型映射已知问题 | `docs/房型映射已知问题-2026-05-07.md` |
