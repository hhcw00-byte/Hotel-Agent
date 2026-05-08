# 新标签页检测问题 - 完整解决方案

## 问题分析

### 根本原因
Playwright 通过 CDP 连接到 Electron 时存在以下问题：
1. **CDP 异步同步延迟**：Electron 创建新标签页后，CDP 协议需要时间同步到 Playwright 客户端
2. **Page 对象不稳定**：CDP 连接下，同一页面可能返回不同的 Page 对象实例
3. **事件监听不可靠**：BrowserContext 的 'page' 事件在 CDP 连接下基本不触发

### 当前实现的问题
- 等待 1.5 秒后尝试在 CDP 中查找新页面，但 CDP 同步可能需要更长时间
- 使用 URL 模糊匹配查找页面，但新页面可能还未出现在 `browser.contexts()[].pages()` 中
- 最终 fallback 到 `this.page = null`，但这会导致后续操作失败

## 解决方案

### 核心策略：CDP 重连 + 强制刷新

**原理**：断开并重新连接 CDP，强制 Playwright 重新枚举所有页面，避开异步同步延迟。

### 实现步骤

1. **收到 Electron 通知**：读取临时文件 `hotel-ai-browser-new-tab.json`
2. **等待页面初始化**：等待 800ms，让 Electron 完成标签页切换和页面初始化
3. **清空连接池**：删除当前端口的连接池缓存
4. **重新连接 CDP**：调用 `this.connect()` 重新建立连接
5. **等待 CDP 同步**：再等待 500ms，让 CDP 完成页面枚举
6. **查找新标签页**：遍历所有页面，找到不在 `urlsBefore` 中的页面
7. **更新 this.page**：将找到的页面设为当前页面

### 优势

- **避开 CDP 延迟**：重连会强制 Playwright 重新获取最新状态
- **避开对象不稳定**：重连后获取的是全新的 Page 对象
- **简单可靠**：不依赖复杂的轮询和对比逻辑
- **用户无感知**：新标签页打开后需要加载时间，重连时间（1-2秒）在可接受范围内

### 兜底方案

如果 Electron 通知文件不存在（极端情况），仍然保留原有的轮询检测逻辑作为兜底。

## 代码修改

修改文件：`scripts/ai-web-crawler/src/browser-controller.ts`

修改方法：`switchToNewTab()`

关键改动：
1. 收到通知后，调用 `BrowserController.connectionPool.delete(this.port)` 清空连接池
2. 调用 `await this.connect(currentPort, 1)` 重新连接
3. 重连后遍历所有页面，找到新标签页
4. 如果找不到，将 `this.page = null`（保持原有 fallback 逻辑）

## 测试建议

1. 测试携程酒店详情页点击（会打开新标签页）
2. 观察日志中的 `[BrowserController] 🔄 新标签页已创建，重新连接 CDP...`
3. 确认重连后能看到新页面：`[BrowserController] 🎯 找到新标签页: ...`
4. 验证爬虫能继续在新标签页中操作

## 备选方案（如果重连方案有问题）

如果 CDP 重连导致其他问题，可以使用以下备选方案：

### 方案 B：增加等待时间 + 多次重试

不重连 CDP，而是：
1. 收到通知后等待 3 秒（而非 1.5 秒）
2. 每隔 500ms 重新扫描一次 `browser.contexts()[].pages()`
3. 最多重试 6 次（共 3 秒）
4. 使用更宽松的 URL 匹配规则（只比较域名和路径）

### 方案 C：Electron 主进程注入标记

在 Electron 主进程中，新标签页加载完成后，注入一个全局标记：
```javascript
view.webContents.executeJavaScript(`window.__NEW_TAB_MARKER__ = '${tabId}';`);
```

爬虫侧通过 CDP 检测这个标记来识别新标签页。

## 总结

推荐使用 **CDP 重连方案**，因为它从根本上解决了 CDP 异步同步延迟的问题，且实现简单可靠。
