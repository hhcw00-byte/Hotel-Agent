# 心跳机制使用说明

## 快速开始

### 1. 配置任务

编辑 `tasks/schedule.json`，启用需要的任务：

```json
{
  "tasks": [
    {
      "id": "backend-pricing",
      "skill": "backend-pricing",
      "cron": "0 8 * * *",
      "params": {
        "background": true
      },
      "enabled": true,  // 改为 true 启用
      "description": "每天早上8点采集后台价格数据"
    }
  ]
}
```

### 2. 启动应用

```bash
npm run dev
npm start
```

应用启动后，心跳管理器会自动：
- 加载任务配置
- 为每个启用的任务创建定时器
- 到时间自动执行 SKILL

### 3. 查看日志

执行日志保存在 `tasks/.history/` 目录：

```bash
# 查看今天的执行日志
cat tasks/.history/2026-03-13.jsonl
```

每行是一个 JSON 对象：
```json
{"taskId":"backend-pricing","startTime":1710302400000,"endTime":1710302450000,"duration":50000,"success":true}
```

## Cron 表达式说明

格式：`分 时 日 月 周`

### 常用示例

```
0 8 * * *          每天 8:00
0 */2 * * *        每 2 小时
0 10,14,18 * * *   每天 10:00, 14:00, 18:00
*/30 * * * *       每 30 分钟
0 0 * * 0          每周日 0:00
0 9-17 * * 1-5     工作日 9:00-17:00 每小时
```

### 在线工具

- https://crontab.guru/ - Cron 表达式生成器

## 任务配置字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | ✅ | 任务唯一标识 |
| skill | string | ✅ | SKILL 名称（backend-pricing, competitive-intel, public-pricing, room-status）|
| cron | string | ✅ | Cron 表达式 |
| params | object | ✅ | SKILL 参数（必须包含 background: true）|
| enabled | boolean | ✅ | 是否启用（true/false）|
| description | string | ❌ | 任务描述（可选）|

## 手动测试

### 方法 1：修改 Cron 表达式

将任务的 cron 改为 1 分钟后执行：

```json
{
  "id": "test-task",
  "skill": "backend-pricing",
  "cron": "*/1 * * * *",  // 每分钟执行
  "params": {
    "background": true
  },
  "enabled": true
}
```

### 方法 2：通过代码手动触发

在主进程中添加测试代码：

```typescript
// 手动执行任务
if (this.heartbeatManager) {
  await this.heartbeatManager.executeTaskManually('backend-pricing');
}
```

## 故障排查

### 1. 任务没有执行

检查：
- `enabled` 是否为 `true`
- Cron 表达式是否正确
- 查看应用日志：`logs/app.log`

### 2. SKILL 不存在

确保 SKILL 已经创建并注册：
- 检查 `scripts/` 目录下是否有对应的 SKILL 文件夹
- 查看 Skill Manager 日志

### 3. 静默爬虫失败

确保：
- `params` 中包含 `background: true`
- `startUrl` 参数正确（如果 SKILL 需要）
- 浏览器 CDP 端口 9222 可用

## 日志位置

- **应用日志**：`logs/app.log`
- **执行历史**：`tasks/.history/YYYY-MM-DD.jsonl`

## 重新加载配置

修改 `schedule.json` 后，需要重启应用才能生效。

未来版本会支持热重载：
```typescript
// 重新加载配置（未来功能）
await heartbeatManager.reload();
```

## 注意事项

1. **时区**：所有时间使用 `Asia/Shanghai` 时区
2. **并发**：多个任务同时到期时会串行执行
3. **失败处理**：任务失败会记录日志，但不会重试（MVP 版本）
4. **资源占用**：静默爬虫会占用内存，建议合理安排任务频率

## 下一步优化

- [ ] 添加 IPC 接口，支持前端管理任务
- [ ] 添加重试机制
- [ ] 添加任务执行统计
- [ ] 支持热重载配置
- [ ] 添加任务依赖关系
- [ ] 添加执行失败通知

---

**版本**: MVP v1.0
**最后更新**: 2026-03-13
