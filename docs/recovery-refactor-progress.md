# Recovery 链路重构进度文档

## 背景

心跳机制通过 API skill 定时抓取各平台酒店数据，数据通过 adapter.js 清洗后由 data-store 入库 MySQL。当 API skill 执行失败时，触发 `executeAgentRecovery()` 让 LLM Agent 自动修复。

原始问题：recovery Agent 收到的 prompt 是一个"万能模板"（`agent/prompts/recovery.md`），不管什么错误类型都注入全部内容（爬虫使用说明、APIRuntime 规范、策略A/B、脚本示例等），导致 Agent 被无关内容干扰产生幻觉，修复成功率低。

## 已完成的改动

### 1. Recovery 链路拆分为策略分发 + 子Agent架构

**文件：`src/main/heartbeat/heartbeat-manager.ts`**

- `executeAgentRecovery()` 改为：代码根据错误类型判断策略 → 创建子Agent加载对应 prompt → 策略B失败自动升级策略A
- 新增 `runRecoveryAgent()` 方法：创建/销毁子Agent的独立生命周期管理
- `buildRecoveryPrompt()` 改为接收 `strategy: 'a' | 'b'` 参数，加载 base + 对应策略文件

**策略判断逻辑（代码硬判断，不依赖 LLM）：**
- `Skill not found` / `Script not found` / `Cannot find module` / `HTTP 403/401/404` → 策略A（爬虫重建）
- 其他（`data-store failed`、`Adapter` 错误、空数据等）→ 策略B（本地修复）
- 策略B执行后 `verifyRecoveryData()` 失败 → 自动升级到策略A

### 2. Prompt 文件拆分

**新增文件：**
- `agent/prompts/recovery-base.md` — 公共部分：角色定义、错误信息、重试限制、任务参数、hotelId、startUrl
- `agent/prompts/recovery-strategy-a.md` — 爬虫重建：爬虫环境说明、执行步骤、APIRuntime 规范、平台特殊规则、`{{previousAttempt}}` 占位符（接收策略B的诊断摘要）
- `agent/prompts/recovery-strategy-b.md` — 本地修复：明确禁止调爬虫、读脚本/修adapter步骤、adapter 输出格式

**保留不动：**
- `agent/prompts/recovery.md` — 原始完整模板，作为文档保留，不再被代码加载

### 3. Agent 上下文精简（`src/main/pi-agent-manager.ts`）

- **tool name normalization**：Gemini 模型把 `ai-web-crawler`（连字符）叫成 `ai_web_crawler`（下划线），在 `executeToolCalls()` 中加了自动转换
- **recovery 模式移除 `load_skill` 工具**：recovery prompt 已包含完整指令，`load_skill` 只会浪费迭代次数并膨胀上下文
- **recovery 模式精简 `getSkillsForAI()`**：system prompt 中的 skill 列表从完整描述改为只列名字，跳过 `skills-usage-rules.md` 注入

### 4. 空响应检测增强（`isEmptyAPIResponse`）

新增错误响应壳检测：当 `data.data` 只有错误码字段（如 `htlSpiderActionErrorCode`、`code`）没有业务数据字段（如 `room`、`price`、`inventory`）时，判定为空响应，触发策略B→A升级。

### 5. 心跳任务配置统一（`tasks/schedule.json`）

给 3 个公网任务补齐了 `startUrl` 和 `crawlerTarget`：
- `api-ctrip-public`：`startUrl: https://hotels.ctrip.com/`
- `api-trip-public`：`startUrl: https://www.trip.com/`
- `api-booking-public`：`startUrl: https://www.booking.com/`

### 6. startUrl 注入到 prompt

`recovery-base.md` 中新增 `{{startUrl}}` 占位符，`buildRecoveryPrompt()` 中从 `task.params.startUrl` 或 `PLATFORM_START_URL` 映射表获取值注入。`recovery-strategy-a.md` 中明确要求 Agent 使用 prompt 里给的 start_url，禁止自行推断。

## 测试结果

### 通过的场景

| 场景 | 策略 | 结果 |
|------|------|------|
| ctrip-public adapter 缺失 | B | 4步完成，无幻觉，7条记录入库 ✅ |
| ctrip-public index.js 缺失 | A | 爬虫导航成功，API拦截25个候选，脚本生成正确 ✅ |
| meituan-room-status 策略A | A | 爬虫导航到PMS房态预测页，217条记录入库 ✅ |
| trip-public 策略B→A升级 | B→A | 策略B检测到空响应壳，正确升级到策略A ✅ |
| ctrip-backend adapter 缺失 | B | Agent 参照示例写出正确格式的 index.js ✅ |

### 改进效果对比

| 指标 | 改动前 | 改动后 |
|------|--------|--------|
| system prompt (skills-for-ai) | 836 chars | 182 chars |
| user message (策略B场景) | 15805 chars（含大量无关内容） | 4903-8202 chars（精准内容） |
| adapter缺失修复迭代次数 | 30次（耗尽上限，失败） | 4-6次（成功） |
| Agent 幻觉调爬虫 | 频繁（策略B场景调了3-4次） | 0次 |
| load_skill 浪费调用 | 3-4次/recovery | 0次 |

## 未解决的问题

### 问题1：Trip.com 爬虫落在美国站（us.trip.com）

**现象**：`schedule.json` 配置 `startUrl: https://www.trip.com/`，但爬虫实际导航到 `us.trip.com/?locale=en-us`。拦截到的 API 都是 `us.trip.com` 域名，没有房价 API（`getHotelRoomListOversea`）。

**影响**：Agent 生成的脚本虽然正确使用了 `www.trip.com` 域名和 `zh-CN` locale（参照了 script-examples），但 cookie 是 `us.trip.com` 的，请求 `www.trip.com` 时返回 `htlSpiderActionErrorCode: 203`（反爬）。

**根因**：`www.trip.com` 会根据 IP 地理位置自动 302 重定向到 `us.trip.com`。爬虫的 background 模式下 BrowserView 跟随了重定向。

**待解决方向**：
- 方案A：在爬虫导航前设置 cookie `ibu_lang=zh` 或通过 URL 参数 `?locale=zh-cn` 强制中文站
- 方案B：`schedule.json` 的 `startUrl` 改为 `https://www.trip.com/?locale=zh-cn`
- 方案C：在 `recovery-strategy-a.md` 的平台特殊规则中提醒 Agent 生成脚本时必须用 `www.trip.com` 域名（已有，但 cookie 问题仍需解决）

### 问题2：Ctrip-backend（ebooking）cookie 过期

**现象**：`getRoomInventoryInfo` API 返回 `code: 400, Initial Parameter Error`。Agent 写的脚本格式正确（参照了 script-examples），但 ebooking 需要登录态。

**影响**：策略B修复脚本后验证失败，升级到策略A，但策略A的爬虫也需要 ebooking 登录态才能拦截到有效 API。

**根因**：ebooking 是后台管理系统，cookie 有效期短，需要用户定期在内置浏览器中登录刷新。

**待解决方向**：
- 短期：用户手动在内置浏览器访问 `ebooking.ctrip.com` 登录
- 长期：实现 cookie 过期检测 + 自动提醒用户登录的机制

### 问题3：爬虫 background 模式 CDP 连接不稳定

**现象**：`connectBackground` 的 Step 3（page event）经常超时，需要 fallback 到 domain 搜索。偶尔 domain 搜索也找不到正确页面（连接到了应用自身的 renderer 页面）。

**根因**：Playwright `connectOverCDP` 连接到 Electron 后，新创建的 BrowserView 的 page 不一定会触发 Playwright 的 `page` 事件。连接池复用旧连接时，旧连接的 contexts/pages 列表是过时的。

**待解决方向**：
- 在 `connectBackground` 的 Step 1 中，清除连接池强制创建新连接（已分析过，不会影响并发——每个爬虫是独立子进程，pool 是进程内 static 变量）
- 需要先确认不会影响其他爬虫链路再实施

## 文件改动清单

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `src/main/heartbeat/heartbeat-manager.ts` | 修改 | 策略分发、子Agent架构、startUrl注入、isEmptyAPIResponse增强 |
| `src/main/pi-agent-manager.ts` | 修改 | tool name normalization、recovery模式精简 |
| `agent/prompts/recovery-base.md` | 新增 | 公共prompt模板 |
| `agent/prompts/recovery-strategy-a.md` | 新增 | 爬虫重建策略prompt |
| `agent/prompts/recovery-strategy-b.md` | 新增 | 本地修复策略prompt |
| `tasks/schedule.json` | 修改 | 补齐公网任务的startUrl/crawlerTarget |
| `scripts/api-ctrip-backend-price/index.js` | 被Agent重写 | 策略B Agent参照示例重写（格式正确，但cookie过期导致400） |
| `scripts/api-ctrip-backend-price/adapter.js` | 被Agent重写 | 策略B Agent重写 |
| `scripts/api-trip-public-price/index.js` | 被Agent重写 | 策略A Agent参照示例重写（格式正确，locale正确） |
| `scripts/api-trip-public-price/adapter.js` | 被Agent重写 | 策略A Agent重写 |
| `agent/prompts/recovery.md` | 未改动 | 原始完整模板，保留作为文档参考 |

## 下一步工作优先级

1. **解决 Trip.com 美国站重定向问题** — 最简单的方式是改 `schedule.json` 的 startUrl 加 locale 参数，或在爬虫层面处理重定向
2. **解决爬虫 CDP 连接不稳定问题** — 在 `connectBackground` 中清除连接池
3. **验证 ebooking cookie 刷新后 ctrip-backend 链路是否正常** — 需要用户登录后重新测试
4. **Booking.com 链路测试** — 尚未测试
