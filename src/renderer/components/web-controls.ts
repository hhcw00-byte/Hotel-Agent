/**
 * Web Controls - 网页控制组件
 * 
 * 职责：
 * - 管理URL输入和导航
 * - 处理后退、前进、刷新操作
 * - 显示加载状态
 * - 显示错误消息
 * - 与主进程通信控制WebContentsView
 */

/**
 * 导航状态接口
 */
export interface NavigationState {
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
  url: string;
}

/**
 * 网页控制配置接口
 */
interface WebControlsConfig {
  defaultSearchEngine?: string;
  autoHideError?: boolean;
  errorDisplayDuration?: number;
}

/**
 * 网页控制类
 */
export class WebControls {
  // DOM元素
  private backBtn: HTMLButtonElement;
  private forwardBtn: HTMLButtonElement;
  private reloadBtn: HTMLButtonElement;
  private urlInput: HTMLInputElement;
  private goBtn: HTMLButtonElement;
  private loadingIndicator: HTMLElement;
  private errorMessage: HTMLElement;
  private errorText: HTMLElement;
  
  // 状态
  private currentUrl: string = '';
  private isLoading: boolean = false;
  private navigationState: NavigationState = {
    canGoBack: false,
    canGoForward: false,
    isLoading: false,
    url: ''
  };
  
  // 配置
  private config: WebControlsConfig;
  
  // 回调函数
  private onNavigationStateChange?: (state: NavigationState) => void;

  /**
   * 构造函数
   */
  constructor(config?: WebControlsConfig) {
    this.config = {
      defaultSearchEngine: 'https://www.google.com/search?q=',
      autoHideError: true,
      errorDisplayDuration: 3000,
      ...config
    };
    
    // 获取DOM元素
    this.backBtn = document.getElementById('backBtn') as HTMLButtonElement;
    this.forwardBtn = document.getElementById('forwardBtn') as HTMLButtonElement;
    this.reloadBtn = document.getElementById('reloadBtn') as HTMLButtonElement;
    this.urlInput = document.getElementById('urlInput') as HTMLInputElement;
    this.goBtn = document.getElementById('goBtn') as HTMLButtonElement;
    this.loadingIndicator = document.getElementById('loadingIndicator') as HTMLElement;
    this.errorMessage = document.getElementById('errorMessage') as HTMLElement;
    this.errorText = document.getElementById('errorText') as HTMLElement;
    
    this.initialize();
  }

  /**
   * 初始化组件
   */
  private initialize(): void {
    console.log('Initializing WebControls...');
    
    // 验证DOM元素
    if (!this.validateElements()) {
      console.error('WebControls: Required elements not found');
      return;
    }
    
    // 绑定事件
    this.bindEvents();
    
    // 初始化状态
    this.updateNavigationButtons();
    
    console.log('WebControls initialized');
  }

  /**
   * 验证DOM元素
   */
  private validateElements(): boolean {
    return !!(
      this.backBtn &&
      this.forwardBtn &&
      this.reloadBtn &&
      this.urlInput &&
      this.goBtn &&
      this.loadingIndicator &&
      this.errorMessage &&
      this.errorText
    );
  }

  /**
   * 绑定事件
   */
  private bindEvents(): void {
    // 后退按钮
    this.backBtn.addEventListener('click', () => this.goBack());
    
    // 前进按钮
    this.forwardBtn.addEventListener('click', () => this.goForward());
    
    // 刷新按钮
    this.reloadBtn.addEventListener('click', () => this.reload());
    
    // URL输入框 - Enter键导航
    this.urlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.navigate(this.urlInput.value);
      }
    });
    
    // URL输入框 - 获得焦点时全选
    this.urlInput.addEventListener('focus', () => {
      this.urlInput.select();
    });
    
    // Go按钮
    this.goBtn.addEventListener('click', () => {
      this.navigate(this.urlInput.value);
    });
  }

  /**
   * 导航到指定URL
   */
  async navigate(input: string): Promise<void> {
    if (!input || input.trim().length === 0) {
      this.showError('请输入有效的网址');
      return;
    }
    
    // 处理URL
    const url = this.processUrl(input.trim());
    
    console.log('WebControls: Navigating to:', url);
    
    try {
      this.setLoading(true);
      
      // 通过IPC调用主进程导航
      await window.electronAPI.webView.navigate(url);
      
      this.currentUrl = url;
      this.urlInput.value = url;
      
      // 隐藏占位符
      this.hidePlaceholder();
      
      // 更新导航状态
      this.updateNavigationState({
        url,
        isLoading: false,
        canGoBack: true,
        canGoForward: false
      });
      
      console.log('WebControls: Navigation successful');
    } catch (error) {
      console.error('WebControls: Navigation failed:', error);
      this.showError('无法加载页面：' + (error instanceof Error ? error.message : String(error)));
    } finally {
      this.setLoading(false);
    }
  }

  /**
   * 处理URL
   */
  private processUrl(input: string): string {
    // 如果已经是完整URL，直接返回
    if (input.startsWith('http://') || input.startsWith('https://')) {
      return input;
    }
    
    // 如果是localhost或IP地址
    if (input.startsWith('localhost') || /^\d+\.\d+\.\d+\.\d+/.test(input)) {
      return 'http://' + input;
    }
    
    // 如果看起来像域名（包含点且不包含空格）
    if (input.includes('.') && !input.includes(' ')) {
      return 'https://' + input;
    }
    
    // 否则作为搜索查询
    return this.config.defaultSearchEngine + encodeURIComponent(input);
  }

  /**
   * 后退
   */
  async goBack(): Promise<void> {
    if (!this.navigationState.canGoBack) {
      return;
    }
    
    console.log('WebControls: Going back');
    
    try {
      await window.electronAPI.webView.goBack();
      this.updateNavigationButtons();
    } catch (error) {
      console.error('WebControls: Go back failed:', error);
      this.showError('无法后退');
    }
  }

  /**
   * 前进
   */
  async goForward(): Promise<void> {
    if (!this.navigationState.canGoForward) {
      return;
    }
    
    console.log('WebControls: Going forward');
    
    try {
      await window.electronAPI.webView.goForward();
      this.updateNavigationButtons();
    } catch (error) {
      console.error('WebControls: Go forward failed:', error);
      this.showError('无法前进');
    }
  }

  /**
   * 刷新
   */
  async reload(): Promise<void> {
    console.log('WebControls: Reloading');
    
    try {
      this.setLoading(true);
      await window.electronAPI.webView.reload();
    } catch (error) {
      console.error('WebControls: Reload failed:', error);
      this.showError('无法刷新页面');
    } finally {
      this.setLoading(false);
    }
  }

  /**
   * 设置加载状态
   */
  private setLoading(loading: boolean): void {
    this.isLoading = loading;
    
    if (loading) {
      this.loadingIndicator.classList.add('active');
      this.reloadBtn.disabled = true;
    } else {
      this.loadingIndicator.classList.remove('active');
      this.reloadBtn.disabled = false;
    }
    
    this.updateNavigationState({
      ...this.navigationState,
      isLoading: loading
    });
  }

  /**
   * 更新导航按钮状态
   */
  private updateNavigationButtons(): void {
    this.backBtn.disabled = !this.navigationState.canGoBack;
    this.forwardBtn.disabled = !this.navigationState.canGoForward;
  }

  /**
   * 更新导航状态
   */
  private updateNavigationState(state: Partial<NavigationState>): void {
    this.navigationState = {
      ...this.navigationState,
      ...state
    };
    
    this.updateNavigationButtons();
    
    // 触发回调
    if (this.onNavigationStateChange) {
      this.onNavigationStateChange(this.navigationState);
    }
  }

  /**
   * 显示错误消息
   */
  showError(message: string): void {
    console.error('WebControls: Error:', message);
    
    this.errorText.textContent = message;
    this.errorMessage.style.display = 'block';
    
    // 自动隐藏
    if (this.config.autoHideError) {
      setTimeout(() => {
        this.hideError();
      }, this.config.errorDisplayDuration);
    }
  }

  /**
   * 隐藏错误消息
   */
  hideError(): void {
    this.errorMessage.style.display = 'none';
  }

  /**
   * 隐藏占位符
   */
  private hidePlaceholder(): void {
    const placeholder = document.querySelector('.webview-placeholder') as HTMLElement;
    if (placeholder) {
      placeholder.style.display = 'none';
    }
  }

  /**
   * 显示占位符
   */
  showPlaceholder(): void {
    const placeholder = document.querySelector('.webview-placeholder') as HTMLElement;
    if (placeholder) {
      placeholder.style.display = 'flex';
    }
  }

  /**
   * 设置导航状态改变回调
   */
  setOnNavigationStateChange(callback: (state: NavigationState) => void): void {
    this.onNavigationStateChange = callback;
  }

  /**
   * 获取当前URL
   */
  getCurrentUrl(): string {
    return this.currentUrl;
  }

  /**
   * 设置URL（不导航）
   */
  setUrl(url: string): void {
    this.currentUrl = url;
    this.urlInput.value = url;
  }

  /**
   * 获取导航状态
   */
  getNavigationState(): NavigationState {
    return { ...this.navigationState };
  }

  /**
   * 更新导航状态（从外部）
   */
  updateState(state: Partial<NavigationState>): void {
    this.updateNavigationState(state);
    
    // 更新URL输入框
    if (state.url) {
      this.setUrl(state.url);
    }
  }

  /**
   * 启用/禁用控件
   */
  setEnabled(enabled: boolean): void {
    this.backBtn.disabled = !enabled || !this.navigationState.canGoBack;
    this.forwardBtn.disabled = !enabled || !this.navigationState.canGoForward;
    this.reloadBtn.disabled = !enabled;
    this.urlInput.disabled = !enabled;
    this.goBtn.disabled = !enabled;
  }

  /**
   * 清空URL
   */
  clearUrl(): void {
    this.currentUrl = '';
    this.urlInput.value = '';
    this.showPlaceholder();
  }

  /**
   * 销毁组件
   */
  destroy(): void {
    console.log('Destroying WebControls...');
    
    // 清理事件监听器会在垃圾回收时自动处理
    // 这里只需要清理状态
    this.currentUrl = '';
    this.isLoading = false;
    
    console.log('WebControls destroyed');
  }
}
