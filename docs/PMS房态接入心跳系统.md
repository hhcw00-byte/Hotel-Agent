# PMS 房态（room-status）接入心跳系统

> 日期：2026-04-08
> 状态：首次全链路 E2E 测试通过（WARN，0 failed）

## 背景

将美团 PMS 房态采集接入心跳自动执行。与现有 price 类任务不同，**PMS 房态是首次执行时脚本不存��的场景**——需要 Agent Recovery 自动爬取 PMS 页面、发现 API、生成脚本和 SKILL.md，后续心跳直接调用脚本。

目标 URL：`https://pms.meituan.com/#qk-workbench`

## 修改文件清单

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `tasks/schedule.json` | 新增条目 | 房态心跳任务配置 |
| `agent/prompts/recovery.md` | 修改 | 支持"Skill not found"首次发现场景 |
| `agent/prompts/api-first-instruction.md` | 修改 | SKILL.md 必须有 YAML front-matter + recovery 场景执行验证 |
| `src/main/pi-agent-manager.ts` | 修改 | tool-calling loop 中动态刷新 tools 列表 |
| `src/main/heartbeat/heartbeat-manager.ts` | 修改 | task.params.startUrl 优先于平台默认 URL |
| `tests/test-agent-self-repair.js` | 新增条目 | TASK_CONFIGS 增加 api-meituan-room-status |

## 各文件改动详情

### 1. `tasks/schedule.json`

新增任务条目：

```json
{
  "id": "api-meituan-room-status",
  "skill": "api-meituan-realtime-status",
  "platform": "meituan",
  "cron": "0 8 * * *",
  "enabled": false,
  "scheduleType": "fixed-time",
  "scheduleConfig": { "times": ["08:00"] },
  "params": {
    "cookieDomain": "pms.meituan.com",
    "startUrl": "https://pms.meituan.com/#qk-workbench",
    "crawlerTarget": "点击左侧菜单【房态预测】，查看今日房态数据"
  }
}
```

新增字段说明：
- `startUrl`：任务级别的起始 URL，供 Agent Recovery 爬虫直接导航使用（覆盖平台默认 URL）
- `crawlerTarget`：爬虫的导航目标描述，告诉爬虫具体要导航到 PMS 的哪个页面

### 2. `agent/prompts/recovery.md`

三处修改：

**错误预判段** — 新增 "Skill not found" 场景：
```
- **Skill not found / 脚本不存在**：首次执行，脚本尚未生成。跳过策略A，直接进入策略B。
```

**铁律段** — 新增唯一例外：
```
**唯一例外**：错误信息为 "Skill not found" 或脚本文件不存在时，策略A无法执行，直接进入策略B。
```

**策略B段** — 三项改进：
- 标题改为"仅当策略A验证失败**或脚本不存在**时"
- `start_url` 改为优先取 `params.startUrl`
- `target` 改为使用 `params.crawlerTarget`
- 第4步拆成4/5/6三步，明确要求执行脚本验证 + data-store 入库

### 3. `agent/prompts/api-first-instruction.md`

两处修改：

**第3步（生成 SKILL.md）** — 增加 YAML front-matter 模板：
```yaml
---
name: api-{platform}-{dataType}
description: 简要描述
script: scripts/api-{platform}-{dataType}/index.js
type: tool
user-invocable: false
parameters:
  cookieDomain:
    type: string
    description: Cookie域名
    required: true
---
```
没有这个 front-matter，SkillManager 无法解析 `script:` 路径，skill 不可执行。

**新增第4步** — recovery 场景的后续操作：
生成脚本后必须继续调用 skill 执行验证 + data-store 入库。

### 4. `src/main/pi-agent-manager.ts`

**关键 bug 修复**：tool-calling loop 中动态刷新 tools 列表。

原代码（约 L476）：
```typescript
// tools 在 L371 构建一次，loop 中不更新
if (tools && tools.length > 0) {
  nextParams.tools = tools;
}
```

修复后：
```typescript
// 每次迭代重新构建 tools，确保中途通过 file-operations 创建的新 skill 能出现在工具列表中
const currentTools = this.buildToolDefinitions();
if (currentTools && currentTools.length > 0) {
  nextParams.tools = currentTools;
  nextParams.tool_choice = 'auto';
}
```

**这是首次创建 skill 场景的核心 bug**：其他平台 skill 已存在，初始 tools 列表里就有它；PMS 是中途创建的，旧 tools 列表里没有，LLM 无法调用。

### 5. `src/main/heartbeat/heartbeat-manager.ts`

`executeAgentRecovery()` 中 `start_url` 选取逻辑改为 task params 优先：

```typescript
// task.params.startUrl 优先（如 PMS 等特定页面），否则回退到平台首页
const startUrl = (task.params as any)?.startUrl || PLATFORM_START_URL[task.platform] || '';
```

原来固定从 `PLATFORM_START_URL['meituan']` = `https://www.meituan.com/` 获取，PMS 需要的是 `https://pms.meituan.com/#qk-workbench`。

### 6. `tests/test-agent-self-repair.js`

TASK_CONFIGS 新增条目：
```javascript
'api-meituan-room-status': { taskId: 'api-meituan-room-status', skill: 'api-meituan-realtime-status' },
```

## 调试过程中发现的问题

| 问题 | 根因 | 修复 |
|------|------|------|
| schedule.json 解析失败导致所有任务丢失 | `crawlerTarget` 值中的中文引号 `""` 破坏 JSON 语法 | 改为方括号 `【】` |
| 爬虫导航到错误页面 | recovery.md 的 `target` 太泛化 | 新增 `crawlerTarget` 参数，精确描述导航目标 |
| Agent 生成脚本后不执行验证 | `api-first-instruction.md` 注入后接管流程，只到第3步就结束 | 增加第4步（recovery 场景执行验证+入库） |
| Agent 无法调用刚创建的 skill | `pi-agent-manager.ts` 的 tools 列表在对话开始时构建一次，loop 中不更新 | 每次迭代重新 `buildToolDefinitions()` |
| SKILL.md 缺少 YAML front-matter | `api-first-instruction.md` 没有提供格式模板 | 第3步增加完整的 front-matter 模板 |

## 首次执行全链路流程

```
heartbeat cron 触发
  → executeTask('api-meituan-room-status')
  → skillManager.executeSkill('api-meituan-realtime-status')
  → 失败："Skill not found"
  → autoFixScript() → false（无脚本文件）
  → executeAgentRecovery()
      → Recovery Agent 读 recovery.md → 匹配 "Skill not found" → 跳过策略A
      → 策略B → ai-web-crawler(start_url=pms.meituan.com/#qk-workbench, target=房态预测, intercept_apis=true)
      → 爬虫导航到房态预测页 → 拦截 API
      → api-first-instruction.md 注入
      → Agent 生成 scripts/api-meituan-realtime-status/index.js
      → Agent 生成 skills/api-meituan-realtime-status/SKILL.md（含 YAML front-matter）
      → reloadAllSkills() 自动触发 → 新 skill 注册
      → buildToolDefinitions() 刷新 → LLM 看到新 tool
      → Agent 调用 api-meituan-realtime-status({ cookieDomain: "pms.meituan.com" })
      → 脚本执行成功 → 数据文件写入 data/api-results/
      → Agent 调用 data-store({ source: "api-meituan-realtime-status" })
      → 入库（注意：目前 ADAPTER_MAP 无此 source 条目，data-store 会报 "No adapter"）
  → verifyRecoveryData() → 验证数据文件存在且有效
  → 标记成功
```

## 待办 / 已知限制

1. **ADAPTER_MAP 未注册**：`scripts/data-store/index.js` 和 `scripts/data-cleaner/index.js` 的 ADAPTER_MAP 中没有 `api-meituan-realtime-status` 条目。首次执行时 data-store 会报 `No adapter for: api-meituan-realtime-status`。需要：
   - 创建 `scripts/data-cleaner/adapters/meituan-realtime-status.js`
   - 在两个 ADAPTER_MAP 中注册

2. **数据库 schema**：房态数据目前写入 `room_snapshots` 表（`availableRooms`, `totalRooms`, `date` 字段），adapter 需要将 PMS 原始响应映射到这个 schema。

3. **测试 WARN**：2 个 warn 来自"基线脚本不存在"和"脚本文件初始不存在"，这是首次创建场景的正常现象，不影响功能。

## 测试命令

```bash
# 从零开始测试（清理已生成文件后）
rm -rf scripts/api-meituan-realtime-status skills/api-meituan-realtime-status
node tests/test-agent-self-repair.js --task=api-meituan-room-status --track=b

# 保留已生成脚本测试（测试后续心跳直接调用）
node tests/test-agent-self-repair.js --task=api-meituan-room-status --track=b --keep-script
```
