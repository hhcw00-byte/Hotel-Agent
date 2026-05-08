/**
 * Hotel AI Browser - 渲染进程主脚本
 * 
 * 职责：
 * - 初始化UI组件
 * - 处理用户交互
 * - 与主进程通信
 * - 管理应用状态
 */

import { SplitLayoutManager } from './components/split-layout';
import { WebControls } from './components/web-controls';
import { ChatPanel } from './components/chat-panel';
import { ErrorDialog, showError } from './components/error-dialog';
import { LoginNotificationBanner } from './components/login-notification-banner';
import { LoginAlertDialog } from './components/login-alert-dialog';
import { LoginPage } from './components/login-page';
import { i18n } from './i18n';

// 全局状态
let layoutManager: SplitLayoutManager | null = null;
let webControls: WebControls | null = null;
let chatPanel: ChatPanel | null = null;
let loginBanner: LoginNotificationBanner | null = null;
let errorDialog: ErrorDialog | null = null;
let loginPage: LoginPage | null = null;

/**
 * 更新用户显示名称并显示 userInfo
 */
function updateUserDisplay(displayName: string): void {
  const userInfo = document.getElementById('userInfo');
  const userDisplayName = document.getElementById('userDisplayName');
  if (userInfo) userInfo.style.display = '';
  if (userDisplayName) userDisplayName.textContent = displayName;
}

/**
 * 隐藏用户信息区域
 */
function hideUserDisplay(): void {
  const userInfo = document.getElementById('userInfo');
  if (userInfo) userInfo.style.display = 'none';
}

/**
 * 初始化退出登录按钮
 */
function initializeLogoutButton(): void {
  const logoutBtn = document.getElementById('logoutBtn');
  if (!logoutBtn) return;

  logoutBtn.addEventListener('click', async () => {
    try {
      await window.electronAPI.auth.logout();
    } catch (error) {
      console.error('Failed to logout:', error);
    }
  });

  console.log('Logout button initialized');
}

/**
 * 初始化登录状态提示弹窗
 */
function initializeLoginAlert(): void {
  const chatMessages = document.getElementById('chatMessages');
  if (!chatMessages) return;
  const loginAlert = new LoginAlertDialog(chatMessages);
  window.electronAPI.login.onStatusAlert((event: { platforms: string[] }) => {
    loginAlert.show(event.platforms);
  });
  console.log('Login alert initialized');
}

/**
 * 初始化主页面业务组件
 */
function initializeMainPageComponents(): void {
  initializeWebControls();
  initializeChatPanel();
  initializeLayoutManager();
  initializeErrorDialog();
  initializeMenuHandlers();
  initializeTabBar();
  initializeControlPanel();
  initializeThemeToggle();
  initializeI18n();
  initializeLoginBanner();
  initializeLogoutButton();
  initializeLoginAlert();
}

/**
 * 初始化应用程序
 */
async function initializeApp(): Promise<void> {
  console.log('Initializing renderer application...');
  
  // 检查Electron API是否可用
  if (!window.electronAPI) {
    console.error('Electron API is not available');
    alert(i18n.t('error.initFailed'));
    return;
  }
  
  console.log('Electron API is available');

  // 创建登录页面并渲染到 loginContainer
  const loginContainer = document.getElementById('loginContainer');
  const mainContainer = document.getElementById('mainContainer');

  if (loginContainer) {
    loginPage = new LoginPage(loginContainer);
    await loginPage.render();

    // 登录成功回调：隐藏登录页，显示主页面，初始化业务组件
    loginPage.onLoginSuccess = (user) => {
      if (loginContainer) loginContainer.style.display = 'none';
      if (mainContainer) mainContainer.style.display = '';

      // 更新用户显示名称并显示 userInfo
      if (user) {
        updateUserDisplay(user.displayName);
      }

      // 等一帧让 DOM 重排完成（mainContainer 从 display:none 变为可见后需要重排），
      // 再初始化 SplitLayoutManager 等组件，否则读取到的元素尺寸为 0
      requestAnimationFrame(() => {
        // 初始化主页面组件（仅在首次登录成功时）
        if (!webControls) {
          initializeMainPageComponents();
          loadAppData();
        }
        // 触发 resize 让 SplitLayoutManager 重新计算 BrowserView bounds
        window.dispatchEvent(new Event('resize'));
      });
    };
  }

  // 监听 auth:on-state-change 事件（处理登出时的页面切换）
  if (window.electronAPI.auth?.onStateChange) {
    window.electronAPI.auth.onStateChange((user) => {
      if (!user) {
        // 登出：隐藏主页面，显示登录页面
        if (mainContainer) mainContainer.style.display = 'none';
        if (loginContainer) {
          loginContainer.style.display = '';
          // 重新渲染登录页面
          if (loginPage) {
            loginPage.render();
          }
        }
        // 清空聊天面板（防止切换用户后显示旧用户的对话记录）
        if (chatPanel) {
          chatPanel.clearMessages();
        }
        // 隐藏用户信息
        hideUserDisplay();
      } else {
        // 收到用户信息时更新显示
        updateUserDisplay(user.displayName);
        // 重新加载新用户的会话记录
        loadLastSessionMessages();
      }
    });
  }

  // 检查是否已经自动登录成功（主进程在创建窗口前已完成自动登录）
  try {
    const currentUser = await window.electronAPI.auth.getCurrentUser();
    if (currentUser) {
      // 已自动登录：隐藏登录页，显示主页面
      if (loginContainer) loginContainer.style.display = 'none';
      if (mainContainer) mainContainer.style.display = '';
      updateUserDisplay(currentUser.displayName);

      // 等一帧让 DOM 重排完成后再初始化组件
      requestAnimationFrame(() => {
        initializeMainPageComponents();
        loadAppData();
        window.dispatchEvent(new Event('resize'));
      });
      console.log('Auto-login detected, showing main page');
      return;
    }
  } catch (error) {
    console.error('Failed to check current user:', error);
  }

  // 未登录：登录页面已显示，等待用户操作
  console.log('No active session, showing login page');
}

/**
 * 加载应用数据（配置、设备ID等）
 */
async function loadAppData(): Promise<void> {
  // 加载配置
  try {
    const config = await window.electronAPI.config.get();
    console.log('Configuration loaded:', config);
  } catch (error) {
    console.error('Failed to load configuration:', error);
  }
  
  console.log('Application initialized successfully');
}

/**
 * 初始化网页控制组件
 */
function initializeWebControls(): void {
  // 创建WebControls实例
  webControls = new WebControls({
    defaultSearchEngine: 'https://www.google.com/search?q=',
    autoHideError: true,
    errorDisplayDuration: 3000
  });
  
  // 设置导航状态改变回调
  webControls.setOnNavigationStateChange((state) => {
    console.log('Navigation state changed:', state);
    updateStarState();
  });
  
  console.log('Web controls initialized with WebControls class');

  // 书签栏
  initBookmarkBar();

  // 浏览器页面加载错误 → 友好提示
  window.electronAPI.webView.onLoadError((error) => {
    console.error('Page load error:', error);
    if (webControls) {
      webControls.showError(friendlyPageError(error.errorCode, error.errorDescription, error.url));
    }
  });
}

/**
 * 初始化AI对话面板
 */
function initializeChatPanel(): void {
  // 创建ChatPanel实例
  chatPanel = new ChatPanel({
    maxInputHeight: 120,
    autoScroll: true,
    showTimestamp: true
  });
  
  // 设置消息发送回调（非流式，作为 fallback）
  chatPanel.setOnMessageSend(async (message) => {
    try {
      const response = await window.electronAPI.piAgent.sendMessage(message);
      return response;
    } catch (error) {
      throw error;
    }
  });

  // 设置流式消息回调
  chatPanel.setOnMessageStream(
    async (message) => {
      return await window.electronAPI.piAgent.streamMessage(message);
    },
    (handler) => {
      return window.electronAPI.piAgent.onStreamChunk(handler);
    },
  );
  
  // 设置清空历史回调
  chatPanel.setOnClearHistory(async () => {
    try {
      await window.electronAPI.piAgent.clearHistory();
    } catch (error) {
      throw error;
    }
  });

  // 新建对话
  chatPanel.setOnNewSession(async () => {
    try {
      const sessionId = crypto.randomUUID();
      await window.electronAPI.piAgent.newSession(sessionId);
      if (chatPanel) {
        chatPanel.clearMessages();
      }
    } catch (error) {
      console.error('Failed to create new session:', error);
    }
  });

  // 监听从控制后台切换会话的事件 → 加载历史消息到对话面板
  window.electronAPI.sessions.onSwitch((data) => {
    if (chatPanel && data.messages) {
      chatPanel.clearMessages();
      for (const msg of data.messages) {
        chatPanel.addMessage({
          id: String(msg.id || Date.now()),
          role: msg.role === 'user' ? 'user' : 'assistant',
          content: msg.content,
          timestamp: msg.timestamp || Date.now()
        });
      }
    }
  });
  
  // 设置错误回调 — 友好化 Agent 错误信息
  chatPanel.setOnError((error) => {
    console.error('ChatPanel error:', error);
    showError(friendlyErrorMessage(error));
  });
  
  console.log('Chat panel initialized with ChatPanel class');

  // 启动时加载最近会话的历史消息到 UI
  loadLastSessionMessages();
}

async function loadLastSessionMessages(): Promise<void> {
  try {
    const sessions = await window.electronAPI.sessions.list();
    if (sessions.length > 0) {
      const lastSession = sessions[0]; // 按 updated_at DESC 排序
      const result = await window.electronAPI.piAgent.switchSession(lastSession.id);
      if (chatPanel && result.messages && result.messages.length > 0) {
        for (const msg of result.messages) {
          chatPanel.addMessage({
            id: String(msg.id || Date.now()),
            role: msg.role === 'user' ? 'user' : 'assistant',
            content: msg.content,
            timestamp: msg.timestamp || Date.now()
          });
        }
      }
    }
  } catch (error) {
    console.error('Failed to load last session:', error);
  }
}

/**
 * 初始化布局管理器
 */
function initializeLayoutManager(): void {
  const leftPanel = document.getElementById('leftPanel');
  const rightPanel = document.getElementById('rightPanel');
  const resizer = document.getElementById('resizer');
  
  if (!leftPanel || !rightPanel || !resizer) {
    console.error('Layout elements not found');
    return;
  }
  
  // 创建布局管理器
  layoutManager = new SplitLayoutManager(
    leftPanel as HTMLElement,
    rightPanel as HTMLElement,
    resizer as HTMLElement,
    {
      minPanelWidth: 300,
      resizerWidth: 8
    }
  );
  
  // 设置布局改变回调
  layoutManager.setOnLayoutChange(async (bounds) => {
    try {
      await window.electronAPI.layout.updateBounds(bounds);
      console.log('WebContentsView bounds updated', bounds);
    } catch (error) {
      console.error('Failed to update WebContentsView bounds:', error);
    }
  });
  
  console.log('Layout manager initialized');
}

/**
 * 初始化控制后台按钮
 */
function initializeControlPanel(): void {
  const controlPanelBtn = document.getElementById('controlPanelBtn');
  if (!controlPanelBtn) {
    console.error('Control panel button not found');
    return;
  }

  controlPanelBtn.addEventListener('click', async () => {
    try {
      const pagesPath = await window.electronAPI.app.getPagesPath();
      await window.electronAPI.tabs.create(pagesPath + '/hotel-admin.html');
    } catch (error) {
      console.error('Failed to open control panel:', error);
    }
  });

  console.log('Control panel button initialized');
}

/**
 * 主题切换：light ↔ dark
 */
function initializeThemeToggle(): void {
  const btn = document.getElementById('themeToggleBtn');
  if (!btn) return;

  type ThemeMode = 'light' | 'dark';

  function applyTheme(mode: ThemeMode): void {
    document.documentElement.setAttribute('data-theme', mode);
    document.documentElement.setAttribute('data-theme-mode', mode);
    localStorage.setItem('theme-mode', mode);
    btn!.title = i18n.t(mode === 'light' ? 'theme.light' : 'theme.dark');
  }

  // 初始化
  const saved = localStorage.getItem('theme-mode') as ThemeMode | null;
  applyTheme(saved === 'dark' ? 'dark' : 'light');

  // 点击切换
  btn.addEventListener('click', () => {
    const current = localStorage.getItem('theme-mode') as ThemeMode;
    applyTheme(current === 'light' ? 'dark' : 'light');
  });

  console.log('Theme toggle initialized');
}

/**
 * 初始化国际化（语言切换）
 */
function initializeI18n(): void {
  // 初始化 i18n（从 localStorage 恢复语言偏好）
  i18n.init();

  // 绑定语言切换按钮
  const langToggleBtn = document.getElementById('langToggleBtn');
  if (langToggleBtn) {
    langToggleBtn.addEventListener('click', () => {
      i18n.toggleLanguage();
      // 同步更新主题切换按钮的 title（因为 theme toggle 的 title 是动态设置的）
      const themeBtn = document.getElementById('themeToggleBtn');
      if (themeBtn) {
        const mode = localStorage.getItem('theme-mode') || 'light';
        themeBtn.title = i18n.t(mode === 'light' ? 'theme.light' : 'theme.dark');
      }
    });
  }

  console.log('I18n initialized');

  // 时区选择器
  const tzSelect = document.getElementById('tzSelect') as HTMLSelectElement;
  if (tzSelect) {
    const savedTz = localStorage.getItem('app-timezone') || 'Asia/Shanghai';
    tzSelect.value = savedTz;
    tzSelect.addEventListener('change', () => {
      localStorage.setItem('app-timezone', tzSelect.value);
      // 通知主进程
      window.electronAPI.config.setTimezone?.(tzSelect.value).catch(() => {});
    });
  }
}

/**
 * 初始化登录通知横幅
 */
function initializeLoginBanner(): void {
  const container = document.getElementById('loginBannerContainer');
  if (!container) return;

  loginBanner = new LoginNotificationBanner(container);

  window.electronAPI.login.onRequired((event) => {
    loginBanner?.addNotification({
      id: event.id, siteUrl: event.siteUrl, siteDomain: event.siteDomain,
      siteTitle: event.siteTitle, timestamp: Date.now(),
    });
  });

  loginBanner.setOnGoToLogin((id) => window.electronAPI.login.action({ id, action: 'go_to_login' }));
  loginBanner.setOnLoginDone((id) => window.electronAPI.login.action({ id, action: 'done' }));
  loginBanner.setOnSkipLogin((id) => window.electronAPI.login.action({ id, action: 'skip' }));

  window.electronAPI.login.onDismissed(({ id }) => loginBanner?.removeNotification(id));

  console.log('Login notification banner initialized');
}

/**
 * 初始化错误对话框
 */
function initializeErrorDialog(): void {
  // 错误提示已改为 toast 风格，无需预初始化
  errorDialog = new ErrorDialog();
  
  console.log('Error dialog initialized');
  
  // 设置全局错误处理
  window.addEventListener('error', (event) => {
    console.error('Global error:', event.error);
  });
  
  window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection:', event.reason);
  });
}

/**
 * 初始化菜单事件处理
 */
function initializeMenuHandlers(): void {
  // 监听菜单事件
  window.electronAPI.ipcRenderer.on('menu:show-about', (_event: any, message: string) => {
    console.log('Menu: Show about requested');
    alert(message);
  });
  
  console.log('Menu handlers initialized');
}

/**
 * 初始化标签栏
 */
function initializeTabBar(): void {
  const tabList = document.getElementById('tabList');
  const newTabBtn = document.getElementById('newTabBtn');

  if (!tabList || !newTabBtn) {
    console.error('Tab bar elements not found');
    return;
  }

  // 新建标签页按钮
  newTabBtn.addEventListener('click', async () => {
    try {
      const result = await window.electronAPI.tabs.create();
      renderTabs(result.tabs, result.activeTabId);
    } catch (error) {
      console.error('Failed to create tab:', error);
    }
  });

  // 监听标签页更新事件（来自主进程）
  window.electronAPI.tabs.onUpdate((data) => {
    renderTabs(data.tabs, data.activeTabId);
    // 更新URL栏为活跃标签页的URL
    if (data.activeTabId && webControls) {
      const activeTab = data.tabs.find((t: any) => t.id === data.activeTabId);
      if (activeTab && activeTab.url && activeTab.url !== 'about:blank') {
        webControls.setUrl(activeTab.url);
      }
      // 不再清空地址栏：URL 为空时保持当前显示的 URL
      updateStarState();
    }
  });

  // 初始加载标签页列表
  window.electronAPI.tabs.list().then((data) => {
    renderTabs(data.tabs, data.activeTabId);
  }).catch((error) => {
    console.error('Failed to load tab list:', error);
  });

  console.log('Tab bar initialized');
}

/**
 * 渲染标签页列表
 */
/** 上一次渲染的标签页 ID 列表（用于判断是否需要全量重建） */
let lastRenderedTabIds: string[] = [];

/**
 * 渲染标签页列表
 * 优化：如果标签页数量和顺序没变，只更新标题和 active 状态（避免闪烁）
 */
function renderTabs(tabs: any[], activeTabId: string | null): void {
  const tabList = document.getElementById('tabList');
  if (!tabList) return;

  const allTabs = tabs; // 包含普通 + 爬虫
  const currentIds = allTabs.map((t: any) => t.id + (t.isCrawler ? ':c' : ''));

  // 如果标签页数量/顺序/类型没变，走增量更新（只改标题和 active）
  if (currentIds.length === lastRenderedTabIds.length &&
      currentIds.every((id: string, i: number) => id === lastRenderedTabIds[i])) {
    // 增量更新：只改变化的部分
    for (const tab of allTabs) {
      const tabEl = tabList.querySelector(`[data-tab-id="${tab.id}"]`) as HTMLElement;
      if (!tabEl) continue;
      // 更新 active 状态
      const shouldBeActive = tab.id === activeTabId;
      if (shouldBeActive && !tabEl.classList.contains('active')) {
        tabEl.classList.add('active');
      } else if (!shouldBeActive && tabEl.classList.contains('active')) {
        tabEl.classList.remove('active');
      }
      // 更新标题
      const titleSpan = tabEl.querySelector('.tab-title') as HTMLElement;
      if (titleSpan) {
        const newTitle = tab.title || i18n.t('tab.new');
        if (titleSpan.textContent !== newTitle) {
          titleSpan.textContent = newTitle;
        }
        if (titleSpan.title !== (tab.url || '')) {
          titleSpan.title = tab.url || '';
        }
      }
      // 重新绑定 click 事件（避免闭包捕获旧的 activeTabId 导致点击无响应）
      if (!tab.isCrawler) {
        const newTabEl = tabEl.cloneNode(true) as HTMLElement;
        tabEl.parentNode?.replaceChild(newTabEl, tabEl);
        const currentTab = tab;
        newTabEl.addEventListener('click', async (e) => {
          if ((e.target as HTMLElement).closest('.tab-close-btn')) return;
          if (currentTab.id === activeTabId) return;
          try {
            const result = await window.electronAPI.tabs.switch(currentTab.id);
            renderTabs(result.tabs, result.activeTabId);
            if (webControls) {
              if (currentTab.url && currentTab.url !== 'about:blank') {
                webControls.setUrl(currentTab.url);
              }
              updateStarState();
            }
          } catch (error) {
            console.error('Failed to switch tab:', error);
          }
        });
        // 重新绑定关闭按钮
        const closeBtn = newTabEl.querySelector('.tab-close-btn');
        if (closeBtn) {
          closeBtn.addEventListener('click', async (e) => {
            (e as Event).stopPropagation();
            try {
              const result = await window.electronAPI.tabs.close(currentTab.id);
              renderTabs(result.tabs, result.activeTabId);
            } catch (error) {
              console.error('Failed to close tab:', error);
            }
          });
        }
      }
    }
    return;
  }

  // 全量重建（标签页数量或顺序变了）
  lastRenderedTabIds = currentIds;
  tabList.innerHTML = '';

  // 分离普通标签和爬虫标签
  const normalTabs = tabs.filter((t: any) => !t.isCrawler);
  const crawlerTabs = tabs.filter((t: any) => t.isCrawler);

  for (const tab of normalTabs) {
    const tabEl = document.createElement('div');
    tabEl.className = 'tab-item' + (tab.id === activeTabId ? ' active' : '');
    tabEl.dataset.tabId = tab.id;

    const titleSpan = document.createElement('span');
    titleSpan.className = 'tab-title';
    titleSpan.textContent = tab.title || i18n.t('tab.new');
    titleSpan.title = tab.url || '';

    tabEl.appendChild(titleSpan);

    // 只有多于1个标签页时才显示关闭按钮
    if (normalTabs.length > 1) {
      const closeBtn = document.createElement('button');
      closeBtn.className = 'tab-close-btn';
      closeBtn.title = i18n.t('nav.closeTab');
      closeBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
      closeBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          const result = await window.electronAPI.tabs.close(tab.id);
          renderTabs(result.tabs, result.activeTabId);
        } catch (error) {
          console.error('Failed to close tab:', error);
        }
      });
      tabEl.appendChild(closeBtn);
    }

    // 点击切换标签页
    tabEl.addEventListener('click', async () => {
      if (tab.id === activeTabId) return;
      try {
        const result = await window.electronAPI.tabs.switch(tab.id);
        renderTabs(result.tabs, result.activeTabId);
        // 更新URL栏
        if (webControls) {
          if (tab.url && tab.url !== 'about:blank') {
            webControls.setUrl(tab.url);
          }
          updateStarState();
        }
        // 隐藏占位符（如果标签页已有URL）
        const placeholder = document.querySelector('.webview-placeholder') as HTMLElement;
        if (placeholder && tab.url) {
          placeholder.style.display = 'none';
        }
      } catch (error) {
        console.error('Failed to switch tab:', error);
      }
    });

    tabList.appendChild(tabEl);
  }

  // 渲染爬虫标签页（带分隔线和特殊样式）
  if (crawlerTabs.length > 0) {
    const separator = document.createElement('div');
    separator.className = 'tab-group-separator';
    tabList.appendChild(separator);

    for (const tab of crawlerTabs) {
      const tabEl = document.createElement('div');
      tabEl.className = 'tab-item crawler-tab';
      tabEl.dataset.tabId = tab.id;

      const iconSpan = document.createElement('span');
      iconSpan.className = 'tab-crawler-icon';
      iconSpan.textContent = '\uD83E\uDD16';
      tabEl.appendChild(iconSpan);

      const titleSpan = document.createElement('span');
      titleSpan.className = 'tab-title';
      titleSpan.textContent = tab.title || i18n.t('tab.new');
      titleSpan.title = tab.url || '';
      tabEl.appendChild(titleSpan);

      // 爬虫标签页始终显示关闭按钮
      const closeBtn = document.createElement('button');
      closeBtn.className = 'tab-close-btn';
      closeBtn.title = i18n.t('nav.closeTab');
      closeBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
      closeBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          const result = await window.electronAPI.tabs.close(tab.id);
          renderTabs(result.tabs, result.activeTabId);
        } catch (error) {
          console.error('Failed to close tab:', error);
        }
      });
      tabEl.appendChild(closeBtn);

      // 爬虫标签页点击无反应（不切换）
      tabList.appendChild(tabEl);
    }
  }
}

// 当DOM加载完成时初始化应用
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeApp);
} else {
  initializeApp();
}

// ── 书签栏 ──

interface Bookmark { title: string; url: string; }

const BOOKMARK_KEY = 'hotel-agent-bookmarks-v2';
const DEFAULT_BOOKMARKS: Bookmark[] = [
  { title: 'Ctrip', url: 'https://www.ctrip.com/' },
  { title: 'Ctrip Ebooking', url: 'https://ebooking.ctrip.com/login/index?targetPath=%2Fhome%2Fmainland%3FmicroJump%3Dtrue' },
  { title: 'Meituan Ebooking', url: 'https://me.meituan.com/ebooking/merchant/ebIframe?iUrl=%2Febooking%2Fnew-workbench%2Findex.html%23%2F' },
  { title: 'Trip.com', url: 'https://us.trip.com/?locale=en-US&curr=USD' },
  { title: 'Booking.com', url: 'https://www.booking.com/index.zh-cn.html?aid=304142&label=gen173nr-10CAEoggI46AdIM1gEaMkBiAEBmAEzuAEXyAEM2AED6AEB-AEBiAIBqAIBuALe8MLPBsACAdICJDMxZTA5MWM4LTY4ZWEtNDAzYy1hMTNmLTE3NWU3MDk0ZTRjM9gCAeACAQ' },
  { title: 'Booking Extranet', url: 'https://admin.booking.com/hotel/hoteladmin/extranet_ng/manage/start.html?hotel_id=15994510&t=1777281757&lang=zh&ses=5863734acda803ae06507507846ab0aa&mobile_extranet=' },
];

function loadBookmarks(): Bookmark[] {
  try {
    const raw = localStorage.getItem(BOOKMARK_KEY);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return [...DEFAULT_BOOKMARKS];
}

function saveBookmarks(bookmarks: Bookmark[]): void {
  localStorage.setItem(BOOKMARK_KEY, JSON.stringify(bookmarks));
}

function renderBookmarks(): void {
  const container = document.getElementById('bookmarkItems');
  if (!container) return;
  container.innerHTML = '';
  const bookmarks = loadBookmarks();
  bookmarks.forEach((bm, i) => {
    const item = document.createElement('span');
    item.className = 'bookmark-item';
    item.innerHTML = `<span class="bookmark-label">${escapeHtml(bm.title)}</span><span class="bookmark-remove" data-index="${i}">✕</span>`;
    item.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).classList.contains('bookmark-remove')) return;
      if (webControls) webControls.navigate(bm.url);
    });
    container.appendChild(item);
  });
  // 删除按钮
  container.querySelectorAll('.bookmark-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt((btn as HTMLElement).dataset.index || '-1', 10);
      if (idx >= 0) {
        const bms = loadBookmarks();
        bms.splice(idx, 1);
        saveBookmarks(bms);
        renderBookmarks();
        updateStarState();
      }
    });
  });
}

function initBookmarkBar(): void {
  renderBookmarks();
  const starBtn = document.getElementById('bookmarkStarBtn');
  if (starBtn) {
    starBtn.addEventListener('click', () => {
      const url = webControls?.getCurrentUrl();
      if (!url || url === 'about:blank') return;
      const bookmarks = loadBookmarks();
      const idx = bookmarks.findIndex(b => b.url === url);
      if (idx >= 0) {
        // 已收藏 → 取消收藏
        bookmarks.splice(idx, 1);
      } else {
        // 未收藏 → 添加
        let title: string;
        try { title = new URL(url).hostname.replace('www.', ''); } catch { title = url; }
        bookmarks.push({ title, url });
      }
      saveBookmarks(bookmarks);
      renderBookmarks();
      updateStarState();
    });
  }
}

function updateStarState(): void {
  const starBtn = document.getElementById('bookmarkStarBtn');
  if (!starBtn) return;
  const url = webControls?.getCurrentUrl() || '';
  const isBookmarked = url && loadBookmarks().some(b => b.url === url);
  starBtn.classList.toggle('active', !!isBookmarked);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── 错误信息友好化 ──

function friendlyPageError(errorCode: number, errorDescription: string, url: string): string {
  const desc = (errorDescription || '').toUpperCase();
  if (desc.includes('NAME_NOT_RESOLVED') || desc.includes('ENOTFOUND')) return `无法找到网站 ${new URL(url).hostname || url}，请检查网址`;
  if (desc.includes('CONNECTION_REFUSED') || desc.includes('ECONNREFUSED')) return '网站拒绝了连接，请稍后重试';
  if (desc.includes('TIMED_OUT') || desc.includes('ETIMEDOUT')) return '连接超时，请检查网络';
  if (desc.includes('INTERNET_DISCONNECTED')) return '网络已断开，请检查网络连接';
  if (desc.includes('SSL') || desc.includes('CERT')) return '安全连接失败';
  if (errorCode === -6) return '文件未找到';
  if (errorCode === -7) return '连接超时，请检查网络';
  if (errorCode === -2) return '页面加载失败，请刷新重试';
  return `页面加载失败（${errorDescription || errorCode}）`;
}

function friendlyErrorMessage(raw: string): string {
  const s = raw || '';

  // LLM/OpenAI-compatible provider authentication problems.
  if (/401/i.test(s) && /user not found|authentication|unauthorized/i.test(s)) {
    return '模型账号认证失败：请检查 llm-config 中的 API Key、baseURL 和模型服务账号是否匹配。';
  }

  // 任务迭代超限
  if (s.includes('Too many tool call iterations')) return '任务太复杂，一次处理不完。请把问题拆分一下，分步来问我。';

  // 内容过滤
  if (s.includes('content_filter')) return '这个问题我没法直接回答，换个方式问我试试。';

  // 所有模型/API相关问题统一提示
  if (s.includes('403') || s.includes('401') || s.includes('429') ||
      s.includes('500') || s.includes('502') || s.includes('503') ||
      s.includes('API key') || s.includes('api key') || s.includes('quota') ||
      s.includes('billing') || s.includes('credit') || s.includes('rate limit') ||
      s.includes('Rate limit') || s.includes('rate_limit') || s.includes('Unauthorized') ||
      s.includes('unauthorized') || s.includes('not available in your') ||
      s.includes('model is not available') || s.includes('Provider returned error') ||
      s.includes('Service Unavailable') || s.includes('Bad Gateway') ||
      s.includes('Internal Server Error')) return '模型不可用';

  // 网络问题
  if (s.includes('ECONNREFUSED') || s.includes('ENOTFOUND') || s.includes('ECONNRESET') ||
      s.includes('ENETUNREACH') || s.includes('network') || s.includes('Network')) return '网络异常，请检查网络连接后重试。';
  if (s.includes('ETIMEDOUT') || s.includes('timeout') || s.includes('Timeout') || s.includes('timed out')) return '请求超时，请检查网络连接后重试。';

  // Agent 未就绪
  if (s.includes('not initialized') || s.includes('not ready')) return 'AI 助手尚未就绪，请稍等片刻再试。';

  // 无响应内容
  if (s.includes('No content in API response')) return 'AI 没有返回内容，请重试一次。';

  // 通用兜底
  return s.length > 80 ? s.substring(0, 80) + '...' : s;
}
