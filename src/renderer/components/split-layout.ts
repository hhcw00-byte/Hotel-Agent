/**
 * Split Layout Manager - 分屏布局管理器
 * 
 * 职责：
 * - 管理左右面板的布局
 * - 处理分隔条拖拽
 * - 维护最小宽度约束
 * - 持久化布局状态
 * - 通知主进程更新WebContentsView边界
 */

/**
 * 布局配置接口
 */
interface LayoutConfig {
  leftPanelWidth: number;
  rightPanelWidth: number;
  minPanelWidth: number;
  resizerWidth: number;
}

/**
 * 布局状态接口
 */
interface LayoutState {
  leftWidth: number;
  rightWidth: number;
  isResizing: boolean;
}

/**
 * 分屏布局管理器类
 */
export class SplitLayoutManager {
  private leftPanel: HTMLElement;
  private rightPanel: HTMLElement;
  private resizer: HTMLElement;
  private config: LayoutConfig;
  private state: LayoutState;
  private startX: number = 0;
  private startLeftWidth: number = 0;
  private startRightWidth: number = 0;
  
  // 回调函数
  private onLayoutChange?: (bounds: { x: number; y: number; width: number; height: number }) => void;

  /**
   * 构造函数
   */
  constructor(
    leftPanel: HTMLElement,
    rightPanel: HTMLElement,
    resizer: HTMLElement,
    config?: Partial<LayoutConfig>
  ) {
    this.leftPanel = leftPanel;
    this.rightPanel = rightPanel;
    this.resizer = resizer;
    
    // 默认配置
    this.config = {
      leftPanelWidth: 800,
      rightPanelWidth: 400,
      minPanelWidth: 300,
      resizerWidth: 8,
      ...config
    };
    
    // 初始化状态
    this.state = {
      leftWidth: this.config.leftPanelWidth,
      rightWidth: this.config.rightPanelWidth,
      isResizing: false
    };
    
    this.initialize();
  }

  /**
   * 初始化布局管理器
   */
  private initialize(): void {
    console.log('Initializing SplitLayoutManager...');
    
    // 加载保存的布局状态
    this.loadLayoutState();
    
    // 如果没有保存的状态，或者保存的状态与当前窗口大小不匹配，重置为默认布局
    const totalWidth = window.innerWidth - this.config.resizerWidth;
    const currentTotal = this.state.leftWidth + this.state.rightWidth;
    
    if (Math.abs(currentTotal - totalWidth) > 50) {
      console.log('Saved layout does not match window size, resetting...');
      this.resetToDefaultLayout();
    } else {
      // 应用初始布局
      this.applyLayout();
      // 通知主进程初始bounds
      this.notifyLayoutChange();
    }
    
    // 绑定事件处理器
    this.bindEvents();
    
    console.log('SplitLayoutManager initialized');
  }

  /**
   * 绑定事件处理器
   */
  private bindEvents(): void {
    // 鼠标按下开始拖拽
    this.resizer.addEventListener('mousedown', this.handleMouseDown.bind(this));
    
    // 鼠标移动
    document.addEventListener('mousemove', this.handleMouseMove.bind(this));
    
    // 鼠标释放结束拖拽
    document.addEventListener('mouseup', this.handleMouseUp.bind(this));
    
    // 窗口大小改变
    window.addEventListener('resize', this.handleWindowResize.bind(this));
  }

  /**
   * 处理鼠标按下事件
   */
  private handleMouseDown(e: MouseEvent): void {
    e.preventDefault();
    
    this.state.isResizing = true;
    this.startX = e.clientX;
    this.startLeftWidth = this.leftPanel.offsetWidth;
    this.startRightWidth = this.rightPanel.offsetWidth;
    
    // 设置拖拽样式
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    this.resizer.classList.add('resizing');

    // 拖拽期间隐藏 BrowserView，防止原生窗口层吞掉鼠标事件
    if (this.onLayoutChange) {
      this.onLayoutChange({ x: 0, y: 0, width: 0, height: 0 });
    }
    
    console.log('Started resizing', {
      startX: this.startX,
      startLeftWidth: this.startLeftWidth,
      startRightWidth: this.startRightWidth
    });
  }

  /**
   * 处理鼠标移动事件
   */
  private handleMouseMove(e: MouseEvent): void {
    if (!this.state.isResizing) {
      return;
    }
    
    e.preventDefault();
    
    // 计算新的宽度
    const deltaX = e.clientX - this.startX;
    const newLeftWidth = this.startLeftWidth + deltaX;
    const newRightWidth = this.startRightWidth - deltaX;
    
    // 应用最小宽度约束
    if (this.isValidLayout(newLeftWidth, newRightWidth)) {
      this.state.leftWidth = newLeftWidth;
      this.state.rightWidth = newRightWidth;
      this.applyLayout();
      // 拖拽期间不更新 BrowserView bounds（已隐藏），mouseUp 时恢复
    }
  }

  /**
   * 处理鼠标释放事件
   */
  private handleMouseUp(): void {
    if (!this.state.isResizing) {
      return;
    }
    
    this.state.isResizing = false;
    
    // 恢复样式
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    this.resizer.classList.remove('resizing');
    
    // 保存布局状态
    this.saveLayoutState();

    // 拖拽结束，恢复 BrowserView 到新位置
    this.notifyLayoutChange();
    
    console.log('Stopped resizing', {
      leftWidth: this.state.leftWidth,
      rightWidth: this.state.rightWidth
    });
  }

  /**
   * 处理窗口大小改变事件
   */
  private handleWindowResize(): void {
    console.log('Window resized, adjusting layout...');
    
    const totalWidth = window.innerWidth - this.config.resizerWidth;
    const currentTotal = this.state.leftWidth + this.state.rightWidth;
    
    // 如果当前总宽度与窗口宽度不匹配，按比例调整
    if (Math.abs(currentTotal - totalWidth) > 10) {
      const ratio = this.state.leftWidth / currentTotal;
      const newLeftWidth = totalWidth * ratio;
      const newRightWidth = totalWidth * (1 - ratio);
      
      // 确保满足最小宽度约束
      if (this.isValidLayout(newLeftWidth, newRightWidth)) {
        this.state.leftWidth = newLeftWidth;
        this.state.rightWidth = newRightWidth;
        this.applyLayout();
        this.notifyLayoutChange();
      } else {
        // 如果不满足约束，使用默认比例
        this.resetToDefaultLayout();
      }
    }
  }

  /**
   * 验证布局是否有效
   */
  private isValidLayout(leftWidth: number, rightWidth: number): boolean {
    const totalWidth = window.innerWidth - this.config.resizerWidth;
    const minWidth = this.config.minPanelWidth;
    
    // 检查最小宽度约束
    if (leftWidth < minWidth || rightWidth < minWidth) {
      return false;
    }
    
    // 检查总宽度是否合理
    const sum = leftWidth + rightWidth;
    if (Math.abs(sum - totalWidth) > 50) {
      return false;
    }
    
    return true;
  }

  /**
   * 应用布局
   */
  private applyLayout(): void {
    // 安全检查：右侧面板不应超过窗口宽度的 50%
    // 如果超过，说明状态被意外篡改，重置为默认比例
    const totalWidth = window.innerWidth - this.config.resizerWidth;
    if (this.state.rightWidth > totalWidth * 0.5) {
      console.warn('applyLayout: rightWidth exceeds 50% of window, resetting layout', {
        rightWidth: this.state.rightWidth,
        totalWidth,
        threshold: totalWidth * 0.5
      });
      this.state.leftWidth = Math.floor(totalWidth * 0.8);
      this.state.rightWidth = Math.floor(totalWidth * 0.2);
    }

    // 设置左侧面板宽度 - 使用更强制的flex属性
    this.leftPanel.style.flex = `0 0 ${this.state.leftWidth}px`;
    this.leftPanel.style.width = `${this.state.leftWidth}px`;
    this.leftPanel.style.minWidth = `${this.state.leftWidth}px`;
    this.leftPanel.style.maxWidth = `${this.state.leftWidth}px`;

    // 设置右侧面板宽度 - 使用更强制的flex属性
    this.rightPanel.style.flex = `0 0 ${this.state.rightWidth}px`;
    this.rightPanel.style.width = `${this.state.rightWidth}px`;
    this.rightPanel.style.minWidth = `${this.state.rightWidth}px`;
    this.rightPanel.style.maxWidth = `${this.state.rightWidth}px`;

    // 同步导航栏控件宽度与左侧面板对齐
    const navControls = document.getElementById('navControls');
    if (navControls) {
      navControls.style.width = `${this.state.leftWidth}px`;
    }

    // 强制重新计算布局
    this.leftPanel.offsetHeight; // 触发reflow
    
    console.log('Layout applied', {
      leftWidth: this.state.leftWidth,
      rightWidth: this.state.rightWidth,
      actualLeftWidth: this.leftPanel.offsetWidth,
      actualRightWidth: this.rightPanel.offsetWidth,
      windowWidth: window.innerWidth
    });
  }

  /**
   * 通知布局改变
   */
  private notifyLayoutChange(): void {
    if (!this.onLayoutChange) {
      return;
    }

    // 获取全局顶栏高度
    const topBar = document.querySelector('.top-bar') as HTMLElement;
    const topBarHeight = topBar ? topBar.offsetHeight : 0;

    // 书签栏在 left-panel 内部，BrowserView 需要在书签栏下方
    const bookmarkBar = document.getElementById('bookmarkBar') as HTMLElement;
    const bookmarkBarHeight = bookmarkBar ? bookmarkBar.offsetHeight : 0;

    // 获取leftPanel的实际渲染位置和尺寸
    const leftPanelRect = this.leftPanel.getBoundingClientRect();

    const bounds = {
      x: Math.floor(leftPanelRect.left),
      y: Math.floor(topBarHeight + bookmarkBarHeight),
      width: Math.floor(leftPanelRect.width),
      height: Math.floor(window.innerHeight - topBarHeight - bookmarkBarHeight)
    };
    
    console.log('SplitLayoutManager: Notifying layout change', {
      bounds,
      windowSize: { width: window.innerWidth, height: window.innerHeight },
      leftPanelRect: {
        left: leftPanelRect.left,
        top: leftPanelRect.top,
        width: leftPanelRect.width,
        height: leftPanelRect.height
      },
      leftPanelWidth: this.state.leftWidth,
      rightPanelWidth: this.state.rightWidth
    });
    
    this.onLayoutChange(bounds);
  }

  /**
   * 设置布局改变回调
   */
  setOnLayoutChange(callback: (bounds: { x: number; y: number; width: number; height: number }) => void): void {
    this.onLayoutChange = callback;
    // 立即同步当前布局到 BrowserView（构造函数中的 notifyLayoutChange 因 callback 未设置而跳过）
    this.notifyLayoutChange();
  }

  /**
   * 保存布局状态到localStorage
   */
  private saveLayoutState(): void {
    try {
      const state = {
        version: 3,
        leftWidth: this.state.leftWidth,
        rightWidth: this.state.rightWidth,
        timestamp: Date.now()
      };
      
      localStorage.setItem('splitLayoutState', JSON.stringify(state));
      console.log('Layout state saved', state);
    } catch (error) {
      console.error('Failed to save layout state:', error);
    }
  }

  /**
   * 从localStorage加载布局状态
   */
  private loadLayoutState(): void {
    try {
      const saved = localStorage.getItem('splitLayoutState');
      if (!saved) {
        console.log('No saved layout state found, using defaults');
        return;
      }
      
      const state = JSON.parse(saved);
      
      // 检查版本，如果没有版本号或版本过旧，清除旧数据
      if (!state.version || state.version < 3) {
        console.log('Old layout version detected, clearing...');
        localStorage.removeItem('splitLayoutState');
        return;
      }
      
      // 验证加载的状态
      if (this.isValidLayout(state.leftWidth, state.rightWidth)) {
        this.state.leftWidth = state.leftWidth;
        this.state.rightWidth = state.rightWidth;
        console.log('Layout state loaded', state);
      } else {
        console.log('Saved layout state is invalid, using defaults');
      }
    } catch (error) {
      console.error('Failed to load layout state:', error);
    }
  }

  /**
   * 重置为默认布局
   */
  resetToDefaultLayout(): void {
    const totalWidth = window.innerWidth - this.config.resizerWidth;
    
    // 使用4:1的比例（左侧占80%，右侧占20%）
    this.state.leftWidth = Math.floor(totalWidth * 0.80);
    this.state.rightWidth = Math.floor(totalWidth * 0.20);
    
    // 确保满足最小宽度约束
    if (this.state.rightWidth < this.config.minPanelWidth) {
      this.state.rightWidth = this.config.minPanelWidth;
      this.state.leftWidth = totalWidth - this.state.rightWidth;
    }
    
    if (this.state.leftWidth < this.config.minPanelWidth) {
      this.state.leftWidth = this.config.minPanelWidth;
      this.state.rightWidth = totalWidth - this.state.leftWidth;
    }
    
    this.applyLayout();
    this.saveLayoutState();
    this.notifyLayoutChange();
    
    console.log('Reset to default layout', {
      leftWidth: this.state.leftWidth,
      rightWidth: this.state.rightWidth
    });
  }

  /**
   * 设置左侧面板宽度
   */
  setLeftPanelWidth(width: number): void {
    const totalWidth = window.innerWidth - this.config.resizerWidth;
    const newRightWidth = totalWidth - width;
    
    if (this.isValidLayout(width, newRightWidth)) {
      this.state.leftWidth = width;
      this.state.rightWidth = newRightWidth;
      this.applyLayout();
      this.saveLayoutState();
      this.notifyLayoutChange();
    } else {
      console.warn('Invalid panel width:', width);
    }
  }

  /**
   * 设置右侧面板宽度
   */
  setRightPanelWidth(width: number): void {
    const totalWidth = window.innerWidth - this.config.resizerWidth;
    const newLeftWidth = totalWidth - width;
    
    if (this.isValidLayout(newLeftWidth, width)) {
      this.state.leftWidth = newLeftWidth;
      this.state.rightWidth = width;
      this.applyLayout();
      this.saveLayoutState();
      this.notifyLayoutChange();
    } else {
      console.warn('Invalid panel width:', width);
    }
  }

  /**
   * 获取当前布局状态
   */
  getLayoutState(): LayoutState {
    return { ...this.state };
  }

  /**
   * 获取左侧面板宽度
   */
  getLeftPanelWidth(): number {
    return this.state.leftWidth;
  }

  /**
   * 获取右侧面板宽度
   */
  getRightPanelWidth(): number {
    return this.state.rightWidth;
  }

  /**
   * 销毁布局管理器
   */
  destroy(): void {
    console.log('Destroying SplitLayoutManager...');
    
    // 移除事件监听器
    window.removeEventListener('resize', this.handleWindowResize.bind(this));
    
    // 保存最终状态
    this.saveLayoutState();
    
    console.log('SplitLayoutManager destroyed');
  }
}
