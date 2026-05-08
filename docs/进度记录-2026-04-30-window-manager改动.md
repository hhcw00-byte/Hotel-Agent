# window-manager.ts 改动记录（2026-04-30）

## 目标

让一键改价（smart-price-adjust）在 Electron 后台模式下正常工作。核心问题：携程/美团等平台的日期选择器在 `show:false` 窗口中 `dispatchEvent` 不正常工作，必须用 `show:true` 窗口。但爬虫 bgTab 需要保持 `show:false` 不干扰用户。

## 方案

通过 `sessionId` 前缀路由：
- `price-adjust-*` → `priceAdjustWindow`（show:true，调价专用）
- 其他所有 sessionId → `bgWindow`（show:false，爬虫/登录检测等）

## 本次修改的文件

**仅修改了 `src/main/window-manager.ts`**

---

## 修改详情

### 1. 新增属性：`priceAdjustWindow`

```typescript
// 调价专用窗口（show:true，独立于爬虫 bgWindow）
// 携程/美团等平台的日期选择器在 show:false 窗口中 dispatchEvent 不正常工作
// 调价任务通过 sessionId 前缀 price-adjust- 路由到此窗口
private priceAdjustWindow: BrowserWindow | null = null;
```

### 2. 新增方法：`getOrCreatePriceAdjustWindow()`

```typescript
private getOrCreatePriceAdjustWindow(): BrowserWindow {
  if (this.priceAdjustWindow && !this.priceAdjustWindow.isDestroyed()) {
    return this.priceAdjustWindow;
  }

  this.priceAdjustWindow = new BrowserWindow({
    show: true,
    width: 1280,
    height: 800,
    skipTaskbar: true,
    title: 'Price Adjust',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    }
  });

  console.log('WindowManager: Price adjust window created (show:true)');
  return this.priceAdjustWindow;
}
```

### 3. 新增方法：`maybeClosePriceAdjustWindow()`

```typescript
private maybeClosePriceAdjustWindow(): void {
  // 检查 bgTabs 中是否还有 price-adjust- 前缀的 session
  let hasPriceAdjustTabs = false;
  for (const [, entry] of this.bgTabs) {
    if (entry.sessionId && entry.sessionId.startsWith('price-adjust-')) {
      hasPriceAdjustTabs = true;
      break;
    }
  }
  if (!hasPriceAdjustTabs && this.priceAdjustWindow && !this.priceAdjustWindow.isDestroyed()) {
    this.priceAdjustWindow.destroy();
    this.priceAdjustWindow = null;
    console.log('WindowManager: Price adjust window closed (no price-adjust tabs)');
  }
}
```

### 4. 修改方法：`createBgTab()`

**改动点**：方法开头加入路由判断

```typescript
// 原来：
const bgWin = this.getOrCreateBgWindow();

// 改为：
const isPriceAdjust = sessionId && sessionId.startsWith('price-adjust-');
const bgWin = isPriceAdjust ? this.getOrCreatePriceAdjustWindow() : this.getOrCreateBgWindow();
```

**改动点**：方法内部 window.open 拦截器中，子标签页也走同样路由

```typescript
// 原来：
const bgW = this.getOrCreateBgWindow();

// 改为：
const bgW = isPriceAdjust ? this.getOrCreatePriceAdjustWindow() : this.getOrCreateBgWindow();
```

**改动点**：注释更新

```typescript
// 原来：
// 挂到独立隐藏窗口（show:false），与 mainWindow 完全隔离

// 改为：
// 挂到对应窗口：调价走 priceAdjustWindow(show:true)，爬虫走 bgWindow(show:false)
```

### 5. 修改方法：`destroyBgTab()`

**改动点**：根据 sessionId 前缀从正确的窗口移除 BrowserView

```typescript
// 原来：
if (this.bgWindow && !this.bgWindow.isDestroyed()) {
  this.bgWindow.removeBrowserView(entry.view);
}
// ...
this.maybeCloseBgWindow();

// 改为：
const isPriceAdjust = entry.sessionId && entry.sessionId.startsWith('price-adjust-');
if (isPriceAdjust) {
  if (this.priceAdjustWindow && !this.priceAdjustWindow.isDestroyed()) {
    this.priceAdjustWindow.removeBrowserView(entry.view);
  }
} else {
  if (this.bgWindow && !this.bgWindow.isDestroyed()) {
    this.bgWindow.removeBrowserView(entry.view);
  }
}
// ...
if (isPriceAdjust) {
  this.maybeClosePriceAdjustWindow();
} else {
  this.maybeCloseBgWindow();
}
```

### 6. 修改方法：`destroyAllBgTabs()`

**改动点**：遍历时按每个 tab 的 sessionId 判断从哪个窗口移除

```typescript
// 原来：
if (this.bgWindow && !this.bgWindow.isDestroyed()) {
  this.bgWindow.removeBrowserView(entry.view);
}
// ...
this.maybeCloseBgWindow();

// 改为：
const isPriceAdjust = entry.sessionId && entry.sessionId.startsWith('price-adjust-');
if (isPriceAdjust) {
  if (this.priceAdjustWindow && !this.priceAdjustWindow.isDestroyed()) {
    this.priceAdjustWindow.removeBrowserView(entry.view);
  }
} else {
  if (this.bgWindow && !this.bgWindow.isDestroyed()) {
    this.bgWindow.removeBrowserView(entry.view);
  }
}
// ...
this.maybeCloseBgWindow();
this.maybeClosePriceAdjustWindow();
```

### 7. 修改方法：`destroyBgTabsBySession()`

**改动点**：同 destroyAllBgTabs，按 sessionId 前缀从正确窗口移除，结束后关闭不再需要的窗口

```typescript
// 新增：
const isPriceAdjustSession = sessionId.startsWith('price-adjust-');

// 循环内每个 tab：
const isPriceAdjust = entry.sessionId && entry.sessionId.startsWith('price-adjust-');
if (isPriceAdjust) {
  if (this.priceAdjustWindow && !this.priceAdjustWindow.isDestroyed()) {
    this.priceAdjustWindow.removeBrowserView(entry.view);
  }
} else {
  if (this.bgWindow && !this.bgWindow.isDestroyed()) {
    this.bgWindow.removeBrowserView(entry.view);
  }
}

// 循环后：
if (isPriceAdjustSession) {
  this.maybeClosePriceAdjustWindow();
} else {
  this.maybeCloseBgWindow();
}
```

### 8. 修改方法：`cleanup()`

**改动点**：新增销毁 priceAdjustWindow

```typescript
// 在 bgWindow 清理之后新增：
if (this.priceAdjustWindow && !this.priceAdjustWindow.isDestroyed()) {
  try { this.priceAdjustWindow.destroy(); } catch {}
  this.priceAdjustWindow = null;
}
```

### 9. 修复残留断裂注释

上次编辑中断留下了一个不完整的 JSDoc 注释块：

```typescript
// 删除了这行残留注释：
/**
 * 获取或创建调价专用窗口（show:true，独立于 bgWindow）
```

这行注释缺少 `*/` 结尾，紧接着就是 `injectAntiDetectionScripts` 的 JSDoc，导致注释块断裂。已删除。

---

## 未修改的方法（无需改动的原因）

| 方法 | 原因 |
|------|------|
| `getOrCreateBgWindow()` | 爬虫专用，不变 |
| `maybeCloseBgWindow()` | 爬虫专用，不变 |
| `promoteBgTabToFront()` | 登录提升功能，只用于爬虫 bgTab，不涉及调价 |
| `demoteTabToBg()` | 同上，降级回 bgWindow |
| IPC handler (`create_bg_tab`) | 调用 `this.createBgTab(url, bgSessionId)`，路由逻辑已在 `createBgTab` 内部处理，无需改 IPC handler |

## sessionId 前缀路由表

| sessionId 前缀 | 来源 | 目标窗口 | show |
|----------------|------|----------|------|
| `price-adjust-` | smart-price-adjust/index.js | priceAdjustWindow | true |
| `login-check-` | login-check/index.js | bgWindow | false |
| `recovery-` | 爬虫恢复任务 | bgWindow | false |
| 其他 | 普通爬虫任务 | bgWindow | false |

## 当前问题

调价功能在本次修改后报 exit code 1（脚本执行失败），但由于无法读取最新的诊断文件，具体错误原因尚未确认。需要用户提供诊断文件内容或错误日志来排查。

可能的原因：
1. 应用未重新编译（window-manager.ts 是 TypeScript，需要编译后才能生效）
2. priceAdjustWindow 的 show:true 窗口可能触发了 Google Auth 拦截器
3. 其他运行时错误
