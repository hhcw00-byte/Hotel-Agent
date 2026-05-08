# 心跳自维护闭环测试进度 (2026-04-15)

## 一、测试目标

验证完整的自维护闭环流程：
1. **Search 自维护**：用户添加竞品 → Agent 调爬虫拦截搜索 API → 生成脚本 → 查询 hotelId → 写入数据库
2. **心跳 Recovery**：心跳执行 → Skill not found → Agent 调爬虫拦截 API → 生成脚本 → 执行验证 → data-store 入库
3. **多平台并发**：ctrip / trip / meituan 三个平台同时 recovery，爬虫并行工作

## 二、已修复的 Bug

### 1. 爬虫 expandPage 在 interceptApis 模式下破坏已拦截数据
- **文件**：`scripts/ai-web-crawler/src/crawler-orchestrator.ts`
- **问题**：搜索 API 拦截成功后，expand 阶段把"搜索"按钮当成可展开元素点击，导致页面跳转
- **修复**：`interceptApis` 模式下跳过 `expandPage()`

### 2. `scripts/api-runtime.js` 残留文件劫持 require 路径
- **问题**：`require('../api-runtime')` 优先匹配到旧版 `scripts/api-runtime.js` 而非 `scripts/api-runtime/index.js`
- **修复**：删除 `scripts/api-runtime.js`

### 3. Agent 生成的脚本不会自动执行
- **文件**：`agent/prompts/api-first-instruction.md`、`agent/prompts/recovery.md`
- **问题**：Agent 用 `module.exports = { run }` 模式，脚本被 spawn 执行时什么都不发生
- **修复**：在规范文档中加入强制脚本骨架和禁止写法清单

### 4. Memory 系统竞品数据污染 Agent 上下文
- **文件**：`src/main/pi-agent-manager.ts`、`src/main/ipc-handler.ts`、`src/main/heartbeat/heartbeat-manager.ts`
- **问题**：`hotels.json` 中的旧竞品"者行孙三里屯"被注入到 Agent system prompt，导致 Agent 搜索错误的竞品
- **修复**：本店和竞品信息统一从数据库读取（`hotel_config` 表 + `competitors` 表），废弃 Memory 系统的酒店数据功能
- 删除 `data/memory/hotels.json` 和 `data/memory/hotels.backup.json`

### 5. 竞品解析 Agent 未加载策略文档
- **文件**：`src/main/ipc-handler.ts`
- **问题**：`executeCompetitorResolver` 的 prompt 不够明确，Agent 跳过 `load_skill(competitor-hotelid-resolver)` 直接调用搜索工具
- **修复**：prompt 改为明确的两步指令，要求先加载策略文档再执行

### 6. 爬虫 CDP 并发连接超时
- **文件**：`scripts/ai-web-crawler/src/browser-controller.ts`
- **问题**：多个爬虫子进程同时 `connectOverCDP`，Playwright 初始化阶段互相阻塞导致超时
- **修复**：
  - 文件信号量（semaphore）限制同时活跃的 CDP 连接数为 2
  - `connectOverCDP` 超时从 5s 增加到 15s
  - 重试间隔加随机抖动
  - 信号量在进程退出和 `closeBackgroundPage` 时自动释放

### 7. `buildRecoveryPrompt` 从 Memory 读本店名
- **文件**：`src/main/heartbeat/heartbeat-manager.ts`
- **问题**：直接读 `hotels.json` 文件获取本店名，Memory 废弃后文件不存在
- **修复**：改为从数据库 `hotel_config` 表异步读取，方法签名改为 async

## 三、测试结果

### Search 自维护流程 ✅
- 爬虫成功拦截到 `soa2/30668/search` API
- Agent 正确识别搜索建议 API 并生成三件套（index.js + adapter.js + SKILL.md）
- 脚本执行成功，返回酒店搜索结果
- `database-operations batch_set_competitor_platform_ids` 批量写入 hotelId

### 心跳 Recovery 并发测试

| 平台 | 爬虫连接 | 导航 | API 拦截 | 脚本生成 | 脚本执行 | 数据质量 | 入库 |
|------|---------|------|---------|---------|---------|---------|------|
| meituan (房态) | ✅ | ✅ PMS 房态预测页 | ✅ 25 candidates | ✅ 符合规范 | ✅ 248 条记录 | ✅ 完整 | ✅ |
| trip (公网价) | ✅ | ✅ 酒店详情页 | ✅ 25 candidates | ✅ 符合规范 | ✅ 11 条记录 | ✅ 完整 | ✅ |
| ctrip (公网价) | ✅ | ✅ 酒店详情页 | ✅ 25 candidates | ✅ 符合规范 | ⚠️ 空数据 | ❌ errorCode 203 | ❌ |

### 并发机制
- 信号量限制 2 个并发 CDP 连接，第 3 个等待前两个中的一个完成
- meituan + ctrip 先并行，trip 等 slot 后启动
- 三个爬虫最终都成功完成导航和 API 拦截

## 四、待解决问题

### 1. 携程公网价反爬检测（errorCode 203）
- `htlSpiderActionErrorCode: 203` — 携程识别出非正常用户请求
- 可能原因：脚本中硬编码的 `cid`/`vid` 值已过期，或缺少某些反爬 header
- 需要对比浏览器真实请求和脚本请求的差异

### 2. Agent 脚本修复能力不足
- 搜索 API 返回空数据时，Agent 不读脚本排查问题，直接调爬虫重新拦截
- `competitor-hotelid-resolver/SKILL.md` 已加修复流程指导，但 Agent 不一定遵循
- 后续优化方向：在 recovery.md 中强化"先读脚本修复"的指令

### 3. data-store 入库验证
- meituan 和 trip 的 data-store 被调用了，但需要确认数据库中实际写入了多少条
- ctrip 因数据为空，入库 0 条

### 4. 心跳正常执行路径未测试
- 当前测试的是 "Skill not found → Recovery" 路径
- 脚本已生成后的正常心跳执行（直接调脚本 → data-store 入库）还需要再跑一轮验证

## 五、关键文件变更索引

| 文件 | 变更 |
|------|------|
| `scripts/ai-web-crawler/src/crawler-orchestrator.ts` | interceptApis 模式跳过 expandPage |
| `scripts/ai-web-crawler/src/browser-controller.ts` | CDP 信号量并发控制、connectBackground 重写 |
| `agent/prompts/api-first-instruction.md` | 强制脚本骨架、禁止写法清单 |
| `agent/prompts/recovery.md` | 脚本执行模式说明 |
| `src/main/pi-agent-manager.ts` | 本店/竞品从数据库读取，废弃 Memory 依赖 |
| `src/main/ipc-handler.ts` | 竞品解析 prompt 优化、Memory 禁用移除 |
| `src/main/heartbeat/heartbeat-manager.ts` | buildRecoveryPrompt async 化、bg tab 清理 |
| `skills/competitor-hotelid-resolver/SKILL.md` | 清除已验证 API 记录、加 Step 4 修复流程 |
| `scripts/api-ctrip-hotel-search/index.js` | 手动修正参数解析和 try-catch |

## 六、Agent 生成的新文件

| 文件 | 来源 | 状态 |
|------|------|------|
| `scripts/api-meituan-realtime-status/` (index.js + adapter.js) | Agent recovery 生成 | ✅ 可用 |
| `skills/api-meituan-realtime-status/SKILL.md` | Agent recovery 生成 | ✅ 可用 |
| `scripts/api-trip-public-price/` (index.js + adapter.js) | Agent recovery 生成 | ✅ 可用 |
| `skills/api-trip-public-price/SKILL.md` | Agent recovery 生成 | ✅ 可用 |
| `scripts/api-ctrip-public-price/` (index.js + adapter.js) | Agent recovery 生成 | ⚠️ 脚本正确但被反爬拦截 |
| `skills/api-ctrip-public-price/SKILL.md` | Agent recovery 生成 | ✅ 可用 |
| `scripts/api-ctrip-hotel-search/` (index.js + adapter.js) | Agent + 手动修正 | ✅ 可用 |
| `skills/api-ctrip-hotel-search/SKILL.md` | Agent 生成 | ✅ 可用 |
