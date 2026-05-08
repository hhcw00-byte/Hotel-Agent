# 标签页切换同步问题修复

## 问题描述

**场景**：数据提取完成后，Electron 自动切换到下一个标签页，但爬虫的 CDP 连接仍停留在旧标签页上。

**现象**：
- 用户输入：`本店：住小叮三里屯 竞品：者行孙三里屯 帮我获取一下公网价格`
- 爬虫成功提取第一个酒店（住小叮）的数据
- Electron 自动切换到第二个标签页（者行孙）
- 爬虫的 `this.page` 引用仍指向第一个标签页
- 后续操作失败，爬虫卡死

## 根本原因

1. **Electron 主动切换标签页**（非点击链接触发）时，只改变了 BrowserView 的显示
2. **爬虫的 CDP 连接不知道这个切换**，`this.page` 仍然指向旧标签页
3. `getPage()` 方法只在 `this.page === null` 时才重新获取，但此时 `this.page` 不是 null，只是指向了错误的页面

## 解决方案

### 核心策略：IPC 通知 + 清空引用

**原理**：Electron 切换标签页时，通过临时文件通知爬虫，爬虫清空 `this.page` 引用，强制下次 `getPage()` 时重新获取当前活动页面。

### 实现步骤

#### 1. Electron 端：通知爬虫标签页已切换

**文件**：`src/main/window-manager.ts`

**修改位置**：`switchTab()` 方法

```typescript
switchTab(tabId: string): void {
  // ... 原有切换逻辑 ...

  this.notifyTabUpdate();
  console.log('WindowManager: Switched to tab:', tabId);

  // 🔥 通知爬虫标签页已切换（让爬虫清空 page 引用）
  this.notifyCrawlerTabSwitch(tabId);
}
```

**新增方法**：`notifyCrawlerTabSwitch()`

```typescript
private notifyCrawlerTabSwitch(tabId: string): void {
  try {
    const view = this.tabs.get(tabId);
    if (!view) return;

    const url = view.webContents.getURL();
    const tempDir = os.tmpdir();
    const notifyFile = path.join(tempDir, 'hotel-ai-browser-tab-switched.json');

    const notification = {
      action: 'tab_switched',
      tabId,
      url,
      timestamp: Date.now()
    };

    fs.writeFileSync(notifyFile, JSON.stringify(notification, null, 2));
    console.log('WindowManager: Notified crawler of tab switch:', tabId, url);
  } catch (error) {
    console.error('WindowManager: Failed to notify crawler of tab switch:', error);
  }
}
```

#### 2. 爬虫端：检测通知并清空引用

**文件**：`scripts/ai-web-crawler/src/browser-controller.ts`

**修改位置**：`getPage()` 方法

```typescript
getPage(): Page | null {
  // 🔥 检查 Electron 是否通知了标签页切换
  this.checkElectronTabSwitch();

  // 如果已经有 page，直接返回
  if (this.page) {
    return this.page;
  }

  // ... 原有延迟获取逻辑 ...
}
```

**新增方法**：`checkElectronTabSwitch()`

```typescript
private checkElectronTabSwitch(): void {
  try {
    const fs = require('fs');
    const path = require('path');
    const os = require('os');
    const tempDir = os.tmpdir();
    const notifyFile = path.join(tempDir, 'hotel-ai-browser-tab-switched.json');

    if (fs.existsSync(notifyFile)) {
      const notification = JSON.parse(fs.readFileSync(notifyFile, 'utf-8'));
      console.log(`[BrowserController] 📢 收到 Electron 标签页切换通知: ${notification.url}`);
      fs.unlinkSync(notifyFile); // 立即删除，避免重复处理

      // 清空 page 引用，强制下次 getPage() 重新获取
      console.log(`[BrowserController] 清空 page 引用，将在下次调用时重新获取当前活动页面`);
      this.page = null;
    }
  } catch (error) {
    // 静默失败，不影响正常流程
  }
}
```

## 工作流程

1. **Electron 切换标签页**：调用 `switchTab(tabId)`
2. **写入通知文件**：`hotel-ai-browser-tab-switched.json`
3. **爬虫调用 getPage()**：每次获取页面前先检查通知文件
4. **检测到通知**：清空 `this.page = null`，删除通知文件
5. **重新获取页面**：`getPage()` 继续执行，从 CDP 获取当前活动页面
6. **更新引用**：`this.page` 指向新标签页

## 优势

- **轻量级**：只在需要时检查文件，无性能开销
- **可靠性高**：基于文件系统的 IPC，不依赖事件监听
- **无侵入性**：不影响现有的新标签页检测逻辑（点击链接打开新标签）
- **自动同步**：每次 `getPage()` 都会自动检查，无需手动调用

## 测试建议

1. 测试多酒店数据提取场景：
   - 输入：`本店：酒店A 竞品：酒店B 帮我获取一下公网价格`
   - 验证：提取完酒店A后，能自动切换到酒店B并继续提取

2. 观察日志输出：
   - Electron 端：`WindowManager: Notified crawler of tab switch: tab-xxx`
   - 爬虫端：`📢 收到 Electron 标签页切换通知: https://...`
   - 爬虫端：`清空 page 引用，将在下次调用时重新获取当前活动页面`

3. 验证不影响现有功能：
   - 点击链接打开新标签页（使用 `switchToNewTab()` 方法）
   - 手动切换标签页（使用 `switchTab()` 方法）

## 相关文档

- 新标签页检测方案：`docs/NEW_TAB_DETECTION_SOLUTION.md`
- 代码清理总结：`docs/NEW_TAB_CLEANUP_SUMMARY.md`
