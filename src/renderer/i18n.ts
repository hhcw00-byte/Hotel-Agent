/**
 * I18nManager - 国际化管理器
 * 
 * 职责：
 * - 管理中英文翻译字典
 * - 根据当前语言替换 DOM 文本
 * - 持久化语言偏好到 localStorage
 * - 通过 IPC 通知主进程语言变更
 */

export type Language = 'zh' | 'en';

interface TranslationEntry {
  zh: string;
  en: string;
}

interface TranslationDict {
  [key: string]: TranslationEntry;
}

const translations: TranslationDict = {
  // nav-row 按钮
  'nav.back': { zh: '后退', en: 'Back' },
  'nav.forward': { zh: '前进', en: 'Forward' },
  'nav.reload': { zh: '刷新', en: 'Reload' },
  'nav.newTab': { zh: '新建标签页', en: 'New Tab' },
  'nav.themeToggle': { zh: '切换主题', en: 'Toggle Theme' },
  'nav.controlPanel': { zh: '控制后台', en: 'Control Panel' },
  'nav.closeTab': { zh: '关闭标签页', en: 'Close Tab' },

  // URL 栏
  'url.placeholder': { zh: '输入网址或搜索...', en: 'Enter URL or search...' },

  // 左侧面板
  'placeholder.title': { zh: '欢迎使用 Hotel-Agent', en: 'Welcome to Hotel-Agent' },
  'placeholder.subtitle': { zh: '在上方输入网址开始浏览', en: 'Enter a URL above to start browsing' },

  // 右侧聊天面板
  'chat.welcome.title': { zh: '你好！我是你的AI助手', en: "Hello! I'm your AI assistant" },
  'chat.welcome.desc': { zh: '我可以帮助你浏览网页、回答问题、提供建议。', en: 'I can help you browse the web, answer questions, and provide suggestions.' },
  'chat.welcome.hint': { zh: '在下方输入框中输入消息开始对话', en: 'Type a message below to start a conversation' },
  'chat.input.placeholder': { zh: '输入消息...', en: 'Type a message...' },
  'chat.input.hint': { zh: '按 Enter 发送，Shift + Enter 换行', en: 'Press Enter to send, Shift + Enter for new line' },
  'chat.clear.confirm': { zh: '确定要清空所有对话记录吗？', en: 'Are you sure you want to clear all messages?' },
  'chat.clear.title': { zh: '清空对话', en: 'Clear Chat' },
  'chat.history.title': { zh: '历史记录', en: 'History' },
  'chat.history.close': { zh: '关闭', en: 'Close' },
  'chat.history.loading': { zh: '加载中...', en: 'Loading...' },
  'chat.history.empty': { zh: '暂无会话记录', en: 'No chat sessions' },
  'chat.history.delete': { zh: '删除', en: 'Delete' },
  'chat.history.delete.confirm': { zh: '确定删除该会话？', en: 'Delete this session?' },
  'chat.history.switch.error': { zh: '切换会话失败', en: 'Failed to switch session' },
  'chat.history.load.error': { zh: '加载历史记录失败', en: 'Failed to load history' },
  'chat.history.delete.error': { zh: '删除会话失败', en: 'Failed to delete session' },
  'chat.role.user': { zh: '你', en: 'You' },
  'chat.role.assistant': { zh: 'AI助手', en: 'AI Assistant' },
  'chat.send.error': { zh: '发送消息失败：', en: 'Failed to send message: ' },
  'chat.clear.error': { zh: '清空对话失败', en: 'Failed to clear chat' },

  // 复制按钮
  'copy.text': { zh: '复制', en: 'Copy' },
  'copy.done': { zh: '已复制', en: 'Copied' },
  'copy.fail': { zh: '失败', en: 'Failed' },
  'copy.reply': { zh: '复制回复内容', en: 'Copy reply' },
  'copy.code': { zh: '复制代码', en: 'Copy code' },

  // 错误消息
  'error.invalidUrl': { zh: '请输入有效的网址', en: 'Please enter a valid URL' },
  'error.loadFailed': { zh: '无法加载页面：', en: 'Failed to load page: ' },
  'error.goBack': { zh: '无法后退', en: 'Cannot go back' },
  'error.goForward': { zh: '无法前进', en: 'Cannot go forward' },
  'error.reload': { zh: '无法刷新页面', en: 'Cannot reload page' },
  'error.initFailed': { zh: '应用程序初始化失败：无法连接到主进程', en: 'App initialization failed: Cannot connect to main process' },

  // 技能进度
  'skill.connecting': { zh: '思考中', en: 'Thinking' },
  'skill.navigating': { zh: '导航中', en: 'Navigating' },
  'skill.expanding': { zh: '展开内容', en: 'Expanding' },
  'skill.extracting': { zh: '提取数据', en: 'Extracting' },
  'skill.processing': { zh: '处理中', en: 'Processing' },

  // 主题切换
  'theme.light': { zh: '当前：亮色主题（点击切换）', en: 'Current: Light theme (click to toggle)' },
  'theme.dark': { zh: '当前：暗色主题（点击切换）', en: 'Current: Dark theme (click to toggle)' },

  // 关于对话框
  'about.title': { zh: '关于 Hotel-Agent', en: 'About Hotel-Agent' },
  'about.ok': { zh: '确定', en: 'OK' },

  // 全局错误
  'error.global': { zh: '应用程序遇到了一个错误', en: 'The application encountered an error' },
  'error.unhandled': { zh: '应用程序遇到了一个未处理的错误', en: 'The application encountered an unhandled error' },

  // 标签页
  'tab.new': { zh: '新标签页', en: 'New Tab' },
};

const STORAGE_KEY = 'app-language';

/**
 * I18nManager 类
 */
export class I18nManager {
  private _currentLanguage: Language = 'zh';

  get currentLanguage(): Language {
    return this._currentLanguage;
  }

  /**
   * 初始化：从 localStorage 恢复语言偏好，应用到 DOM，通知主进程
   */
  init(): void {
    const saved = localStorage.getItem(STORAGE_KEY);
    const lang: Language = saved === 'en' ? 'en' : 'zh';
    this._currentLanguage = lang;
    this.applyToDOM();
    this.updateToggleButton(lang);
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';

    // 通知主进程当前语言（确保启动时同步）
    this.notifyMainProcess(lang);

    console.log(`I18nManager initialized: language=${lang}`);
  }

  /**
   * 设置语言
   */
  setLanguage(lang: Language): void {
    this._currentLanguage = lang;
    this.applyToDOM();
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch (e) {
      console.warn('I18n: Failed to persist language to localStorage', e);
    }
    this.updateToggleButton(lang);
    this.notifyMainProcess(lang);
  }

  /**
   * 切换语言
   */
  toggleLanguage(): void {
    const newLang: Language = this._currentLanguage === 'zh' ? 'en' : 'zh';
    this.setLanguage(newLang);
  }

  /**
   * 获取翻译文本，key 不存在时返回 key 本身
   */
  t(key: string): string {
    const entry = translations[key];
    if (!entry) {
      console.warn(`I18n: Missing translation key "${key}"`);
      return key;
    }
    return entry[this._currentLanguage];
  }

  /**
   * 遍历 DOM，替换所有带 data-i18n 属性的元素文本
   */
  applyToDOM(): void {
    // textContent
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (key && translations[key]) {
        el.textContent = translations[key][this._currentLanguage];
      }
    });

    // placeholder
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      if (key && translations[key]) {
        (el as HTMLInputElement).placeholder = translations[key][this._currentLanguage];
      }
    });

    // title
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
      const key = el.getAttribute('data-i18n-title');
      if (key && translations[key]) {
        (el as HTMLElement).title = translations[key][this._currentLanguage];
      }
    });
  }

  /**
   * 更新语言切换按钮的显示状态
   */
  updateToggleButton(lang: Language): void {
    const zhSpan = document.getElementById('langZh');
    const enSpan = document.getElementById('langEn');
    if (zhSpan && enSpan) {
      zhSpan.classList.toggle('active', lang === 'zh');
      enSpan.classList.toggle('active', lang === 'en');
    }
  }

  /**
   * 通知主进程语言变更
   */
  private notifyMainProcess(lang: Language): void {
    if (window.electronAPI?.config?.setLanguage) {
      window.electronAPI.config.setLanguage(lang).catch(err => {
        console.warn('I18n: Failed to notify main process', err);
      });
    }
  }
}

/** 全局单例 */
export const i18n = new I18nManager();
