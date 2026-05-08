# Hotel AI Browser

酒店行业AI浏览器 - 基于Electron和Pi Coding Agent的智能浏览器应用

## 功能特性


- 🖥️ **分屏布局**：左侧网页浏览，右侧AI助手对话
- 🤖 **AI助手集成**：基于pi-coding-agent的智能对话助手
- 🌐 **网页浏览**：完整的浏览器功能（导航、前进、后退、刷新）
- ⚙️ **灵活配置**：支持多种AI模型提供商（Anthropic、OpenAI、Google等）
- 🔒 **安全设计**：遵循Electron安全最佳实践
- 🎨 **友好界面**：简洁直观的用户界面

## 技术栈

- **框架**: Electron 28+
- **语言**: TypeScript
- **AI引擎**: pi-coding-agent
- **构建工具**: Webpack
- **测试框架**: Jest + fast-check
- **代码规范**: ESLint + TypeScript

## 项目结构

```
hotel-ai-browser/
├── src/
│   ├── main/              # 主进程代码
│   │   ├── index.ts       # 应用程序入口
│   │   ├── window-manager.ts
│   │   ├── ipc-handler.ts
│   │   ├── pi-agent-manager.ts
│   │   ├── config-manager.ts
│   │   ├── logger.ts
│   │   └── menu.ts
│   ├── renderer/          # 渲染进程代码
│   │   ├── index.html
│   │   ├── app.ts
│   │   ├── components/
│   │   │   ├── split-layout.ts
│   │   │   ├── web-controls.ts
│   │   │   ├── chat-panel.ts
│   │   │   └── message-renderer.ts
│   │   └── styles/
│   │       └── main.css
│   ├── preload/           # 预加载脚本
│   │   └── index.ts
│   └── shared/            # 共享代码
│       ├── types.ts
│       ├── constants.ts
│       └── utils.ts
├── dist/                  # 编译输出
├── release/               # 打包输出
├── .kiro/                 # 规范文档
│   └── specs/
│       └── hotel-ai-browser/
│           ├── requirements.md
│           ├── design.md
│           └── tasks.md
├── package.json
├── tsconfig.json
├── webpack.config.js
├── jest.config.js
└── README.md
```

## 开发指南

### 环境要求

- Node.js 22+
- npm 或 pnpm
- Windows 操作系统

### 安装依赖

```bash
npm install
```

### 开发模式

```bash
# 编译代码（监听模式）
npm run dev

# 在另一个终端启动应用
npm start
```

### 构建生产版本

```bash
# 编译代码
npm run build

# 打包应用
npm run package
```

### 运行测试

```bash
# 运行所有测试
npm test

# 监听模式
npm run test:watch
```

### 代码检查

```bash
npm run lint
```

## 配置说明

首次运行时，应用会提示配置AI模型的API密钥。支持以下提供商：

- **Anthropic** (Claude)
- **OpenAI** (GPT)
- **Google** (Gemini)
- **Azure OpenAI**
- **Ollama** (本地模型)

配置文件存储在用户数据目录中，包含敏感信息请妥善保管。

## 使用说明

1. **启动应用**：运行编译后的应用程序
2. **配置API**：首次使用时配置AI模型API密钥
3. **浏览网页**：在左侧面板输入URL进行浏览
4. **AI对话**：在右侧面板与AI助手交互
5. **调整布局**：拖动中间分隔条调整左右面板大小

## 开发路线图

### Phase 1: 核心功能 ✅ (当前阶段)
- [x] Electron应用架构
- [x] 分屏布局
- [x] 网页浏览功能
- [x] Pi Agent集成
- [x] AI对话界面
- [x] 配置管理

### Phase 2: 浏览器自动化 (计划中)
- [ ] Playwright集成
- [ ] 自动化脚本编辑器
- [ ] 录制和回放功能
- [ ] 酒店业务流程自动化

## 安全性

本应用遵循Electron安全最佳实践：

- ✅ Context Isolation 已启用
- ✅ Node Integration 已禁用
- ✅ 使用 Context Bridge 安全暴露API
- ✅ Content Security Policy 已配置
- ✅ API密钥安全存储

## 许可证

MIT License

## 贡献

欢迎提交Issue和Pull Request！

## 联系方式

如有问题或建议，请通过Issue联系我们。
