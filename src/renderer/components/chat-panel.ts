/**
 * Chat Panel - AI对话面板组件
 *
 * 职责：
 * - 管理消息列表
 * - 处理消息输入
 * - 发送消息到AI
 * - 清空对话历史
 * - 显示打字指示器
 * - 自动滚动到底部
 */

import { marked } from 'marked';
import hljs from 'highlight.js';
import { i18n } from '../i18n';

/**
 * 消息接口
 */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

/**
 * 对话面板配置接口
 */
interface ChatPanelConfig {
  maxInputHeight?: number;
  autoScroll?: boolean;
  showTimestamp?: boolean;
}

/**
 * 对话面板类
 */
export class ChatPanel {
  // DOM元素
  private chatMessages: HTMLElement;
  private chatInput: HTMLTextAreaElement;
  private sendBtn: HTMLButtonElement;
  private clearChatBtn: HTMLButtonElement;
  private historyBtn: HTMLButtonElement | null;
  private historyPopover: HTMLElement | null;
  private historyCloseBtn: HTMLButtonElement | null;
  private historyList: HTMLElement | null;

  // 状态
  private messages: ChatMessage[] = [];
  private isProcessing: boolean = false;
  private progressCleanup: (() => void) | null = null;

  // 配置
  private config: ChatPanelConfig;

  // 回调函数
  private onMessageSend?: (message: string) => Promise<string>;
  private onMessageStream?: (message: string) => Promise<string>;
  private onClearHistory?: () => Promise<void>;
  private onError?: (error: string) => void;

  /**
   * 构造函数
   */
  constructor(config?: ChatPanelConfig) {
    this.config = {
      maxInputHeight: 120,
      autoScroll: true,
      showTimestamp: true,
      ...config
    };

    // Configure marked for safe Markdown rendering
    marked.setOptions({
      breaks: true,
      gfm: true,
      highlight: (code: string, lang: string) => {
        if (lang && hljs.getLanguage(lang)) {
          try { return hljs.highlight(code, { language: lang }).value; } catch {}
        }
        return hljs.highlightAuto(code).value;
      },
    } as any);

    // 获取DOM元素
    this.chatMessages = document.getElementById('chatMessages') as HTMLElement;
    this.chatInput = document.getElementById('chatInput') as HTMLTextAreaElement;
    this.sendBtn = document.getElementById('sendBtn') as HTMLButtonElement;
    this.clearChatBtn = document.getElementById('clearChatBtn') as HTMLButtonElement;
    this.historyBtn = document.getElementById('chatHistoryBtn') as HTMLButtonElement | null;
    this.historyPopover = document.getElementById('chatHistoryPopover');
    this.historyCloseBtn = document.getElementById('chatHistoryClose') as HTMLButtonElement | null;
    this.historyList = document.getElementById('chatHistoryList');

    this.initialize();
  }

  /**
   * 初始化组件
   */
  private initialize(): void {
    console.log('Initializing ChatPanel...');
    
    // 验证DOM元素
    if (!this.validateElements()) {
      console.error('ChatPanel: Required elements not found');
      return;
    }
    
    // 绑定事件
    this.bindEvents();

    // 监听技能执行进度事件
    this.bindProgressListener();

    console.log('ChatPanel initialized');
  }

  /**
   * 验证DOM元素
   */
  private validateElements(): boolean {
    return !!(
      this.chatMessages &&
      this.chatInput &&
      this.sendBtn &&
      this.clearChatBtn
    );
  }

  /**
   * 绑定事件
   */
  private bindEvents(): void {
    // 输入框自动调整高度
    this.chatInput.addEventListener('input', () => {
      this.adjustInputHeight();
      this.updateSendButton();
    });
    
    // Enter键发送消息（Shift+Enter换行）
    this.chatInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });
    
    // 发送按钮
    this.sendBtn.addEventListener('click', () => {
      this.sendMessage();
    });
    
    // 新建对话按钮（复用原清空按钮的 DOM 元素）
    this.clearChatBtn.addEventListener('click', () => {
      if (this.onNewSession) {
        this.onNewSession();
      }
    });
    // 更新按钮提示
    this.clearChatBtn.title = '新建对话';

    this.historyBtn?.addEventListener('click', () => {
      this.toggleHistoryPopover();
    });

    this.historyCloseBtn?.addEventListener('click', () => {
      this.closeHistoryPopover();
    });

    document.addEventListener('click', (e) => {
      if (!this.historyPopover?.classList.contains('open')) return;
      const target = e.target as Node;
      if (this.historyPopover.contains(target) || this.historyBtn?.contains(target)) return;
      this.closeHistoryPopover();
    });

    // 拦截聊天消息中的链接点击，在新标签页中打开而不是覆盖当前页面
    this.chatMessages.addEventListener('click', (e) => {
      const anchor = (e.target as HTMLElement).closest('a[href]') as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;
      e.preventDefault();
      e.stopPropagation();
      if (window.electronAPI?.tabs?.create) {
        window.electronAPI.tabs.create(href).catch(() => {
          window.open(href, '_blank');
        });
      } else {
        window.open(href, '_blank');
      }
    });
  }

  private onNewSession?: () => void;

  private async toggleHistoryPopover(): Promise<void> {
    if (!this.historyPopover || !this.historyBtn) return;
    if (this.historyPopover.classList.contains('open')) {
      this.closeHistoryPopover();
      return;
    }
    this.historyPopover.classList.add('open');
    this.historyPopover.setAttribute('aria-hidden', 'false');
    this.historyBtn.classList.add('active');
    await this.renderHistoryList();
  }

  private closeHistoryPopover(): void {
    this.historyPopover?.classList.remove('open');
    this.historyPopover?.setAttribute('aria-hidden', 'true');
    this.historyBtn?.classList.remove('active');
  }

  private async renderHistoryList(): Promise<void> {
    if (!this.historyList) return;
    const sessionsApi = window.electronAPI?.sessions;
    if (!sessionsApi) {
      this.historyList.innerHTML = `<div class="chat-history-empty">${this.escapeHtml(i18n.t('chat.history.empty'))}</div>`;
      return;
    }

    this.historyList.innerHTML = `<div class="chat-history-loading">${this.escapeHtml(i18n.t('chat.history.loading'))}</div>`;

    try {
      const sessions = await sessionsApi.list();
      if (!sessions || sessions.length === 0) {
        this.historyList.innerHTML = `<div class="chat-history-empty">${this.escapeHtml(i18n.t('chat.history.empty'))}</div>`;
        return;
      }

      this.historyList.innerHTML = sessions.map((session: any) => {
        const id = this.escapeHtml(String(session.id || ''));
        const title = this.escapeHtml(session.title || '新对话');
        const time = this.escapeHtml(this.formatSessionTime(session.updated_at));
        return `
          <div class="chat-history-item">
            <button class="chat-history-main" type="button" data-session-id="${id}">
              <span class="chat-history-title">${title}</span>
              <span class="chat-history-time">${time}</span>
            </button>
            <button class="chat-history-delete" type="button" data-session-id="${id}">${this.escapeHtml(i18n.t('chat.history.delete'))}</button>
          </div>
        `;
      }).join('');

      this.historyList.querySelectorAll<HTMLButtonElement>('.chat-history-main').forEach((btn) => {
        btn.addEventListener('click', () => this.switchToHistorySession(btn.dataset.sessionId || ''));
      });

      this.historyList.querySelectorAll<HTMLButtonElement>('.chat-history-delete').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.deleteHistorySession(btn.dataset.sessionId || '');
        });
      });
    } catch (error) {
      console.error('ChatPanel: Failed to load history sessions:', error);
      this.historyList.innerHTML = `<div class="chat-history-empty">${this.escapeHtml(i18n.t('chat.history.load.error'))}</div>`;
    }
  }

  private async switchToHistorySession(sessionId: string): Promise<void> {
    if (!sessionId) return;
    try {
      const result = await window.electronAPI.piAgent.switchSession(sessionId);
      this.clearMessages();
      if (result.messages && result.messages.length > 0) {
        for (const msg of result.messages) {
          this.addMessage({
            id: String(msg.id || this.generateId()),
            role: msg.role === 'user' ? 'user' : 'assistant',
            content: msg.content || '',
            timestamp: msg.timestamp || Date.now()
          });
        }
      }
      this.closeHistoryPopover();
    } catch (error) {
      console.error('ChatPanel: Failed to switch history session:', error);
      this.onError?.(i18n.t('chat.history.switch.error'));
    }
  }

  private async deleteHistorySession(sessionId: string): Promise<void> {
    if (!sessionId) return;
    let confirmed = false;
    try {
      confirmed = await window.electronAPI.dialog.confirm(i18n.t('chat.history.delete.confirm'));
    } catch {
      confirmed = confirm(i18n.t('chat.history.delete.confirm'));
    }
    if (!confirmed) return;

    try {
      await window.electronAPI.sessions.delete(sessionId);
      await this.renderHistoryList();
    } catch (error) {
      console.error('ChatPanel: Failed to delete history session:', error);
      this.onError?.(i18n.t('chat.history.delete.error'));
    }
  }

  private formatSessionTime(value: string | number | Date | null | undefined): string {
    if (!value) return '';
    try {
      return new Date(value).toLocaleString(i18n.currentLanguage === 'en' ? 'en-US' : 'zh-CN');
    } catch {
      return '';
    }
  }

  /**
   * 调整输入框高度
   */
  private adjustInputHeight(): void {
    this.chatInput.style.height = 'auto';
    const newHeight = Math.min(this.chatInput.scrollHeight, this.config.maxInputHeight!);
    this.chatInput.style.height = newHeight + 'px';
  }

  /**
   * 更新发送按钮状态
   */
  private updateSendButton(): void {
    const hasContent = this.chatInput.value.trim().length > 0;
    this.sendBtn.disabled = !hasContent || this.isProcessing;
  }

  /**
   * 发送消息
   */
  async sendMessage(): Promise<void> {
    const message = this.chatInput.value.trim();
    
    if (message.length === 0 || this.isProcessing) {
      return;
    }
    
    console.log('ChatPanel: Sending message:', message);
    
    // 设置处理状态
    this.isProcessing = true;
    this.updateSendButton();
    
    // 清空输入框
    this.chatInput.value = '';
    this.chatInput.style.height = 'auto';
    
    // 添加用户消息
    this.addMessage({
      id: this.generateId(),
      role: 'user',
      content: message,
      timestamp: Date.now()
    });
    
    // 显示打字指示器
    this.showTypingIndicator();
    
    try {
      // 优先走流式，没有流式回调则走原逻辑
      if (this.onMessageStream) {
        await this.sendMessageStream(message);
      } else if (this.onMessageSend) {
        const response = await this.onMessageSend(message);
        
        // 隐藏打字指示器和进度面板
        this.hideTypingIndicator();
        this.hideSkillProgress();

        // 添加AI响应
        this.addMessage({
          id: this.generateId(),
          role: 'assistant',
          content: response,
          timestamp: Date.now()
        });
        
        console.log('ChatPanel: Message sent successfully');
      } else {
        throw new Error('No message send handler configured');
      }
    } catch (error) {
      console.error('ChatPanel: Failed to send message:', error);
      this.hideTypingIndicator();
      this.hideSkillProgress();
      
      if (this.onError) {
        this.onError(i18n.t('chat.send.error') + (error instanceof Error ? error.message : String(error)));
      }
    } finally {
      this.isProcessing = false;
      this.updateSendButton();
    }
  }

  /**
   * 添加消息
   */
  addMessage(message: ChatMessage): void {
    // 移除欢迎消息
    this.removeWelcomeMessage();
    
    // 添加到消息列表
    this.messages.push(message);
    
    // 渲染消息
    this.renderMessage(message);
    
    // 自动滚动
    if (this.config.autoScroll) {
      this.scrollToBottom();
    }
  }

  /**
   * 渲染消息
   */
  private renderMessage(message: ChatMessage): void {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${message.role}`;
    messageDiv.dataset.messageId = message.id;

    const timeString = this.formatTime(message.timestamp);

    // User messages: plain text; Assistant messages: render Markdown
    const contentHtml = message.role === 'assistant'
      ? (marked.parse(message.content) as string)
      : this.escapeHtml(message.content);

    messageDiv.innerHTML = `
      <div class="message-header">
        <div class="message-avatar">${message.role === 'user' ? '👤' : '🤖'}</div>
        <div class="message-info">
          <div class="message-role">${message.role === 'user' ? i18n.t('chat.role.user') : i18n.t('chat.role.assistant')}</div>
          ${this.config.showTimestamp ? `<div class="message-time">${timeString}</div>` : ''}
        </div>
      </div>
      <div class="message-content${message.role === 'assistant' ? ' markdown-body' : ''}">${contentHtml}</div>
    `;

    this.chatMessages.appendChild(messageDiv);

    // 为 AI 消息添加复制按钮
    if (message.role === 'assistant') {
      this.addCopyButtonsToMessage(messageDiv);
    }
  }

  /**
   * 为消息中的特定内容添加复制按钮
   */
  private addCopyButtonsToMessage(messageDiv: HTMLElement): void {
    // 1. 为代码块添加复制按钮
    const codeBlocks = messageDiv.querySelectorAll('pre code');
    codeBlocks.forEach((codeBlock) => {
      const pre = codeBlock.parentElement as HTMLPreElement;
      if (pre && !pre.querySelector('.copy-button')) {
        this.addCopyButton(pre, codeBlock.textContent || '', 'code');
      }
    });

    // 2. 检测"回复建议："、"回复参考："、"建议回复"等标记
    this.addReplyReferenceCopyButton(messageDiv);

    // 3. 为符合回复模式的段落添加复制按钮（作为兜底）
    const paragraphs = messageDiv.querySelectorAll('p');
    paragraphs.forEach((p) => {
      // 跳过已经处理过的段落
      if (p.closest('.reply-content-wrapper')) {
        return;
      }

      const text = p.textContent || '';
      
      // 检测是否是回复内容
      if (this.isReplyContent(text)) {
        const wrapper = document.createElement('div');
        wrapper.className = 'reply-content-wrapper';
        p.parentNode?.insertBefore(wrapper, p);
        wrapper.appendChild(p);
        this.addCopyButton(wrapper, text, 'reply');
      }
    });
  }

  /**
   * 判断是否是回复内容
   */
  private isReplyContent(text: string): boolean {
    // 检测常见的回复开头
    const replyPatterns = [
      /^您好[！!。，,\s]/,
      /^尊敬的/,
      /^亲爱的/,
      /^非常抱歉/,
      /^感谢您的反馈/,
      /^看到您的评价/
    ];

    // 至少 30 个字符，且匹配回复模式
    return text.length >= 30 && replyPatterns.some(pattern => pattern.test(text));
  }

  /**
   * 为"回复参考："、"回复建议："后的内容添加复制按钮
   */
  private addReplyReferenceCopyButton(messageDiv: HTMLElement): void {
    const content = messageDiv.querySelector('.message-content');
    if (!content) return;

    // 查找包含回复标记的元素
    const replyKeywords = [
      '回复参考：',
      '回复参考:',
      '回复建议：',
      '回复建议:',
      '建议回复：',
      '建议回复:',
      '回复文案：',
      '回复文案:'
    ];

    // 遍历所有文本节点和元素
    const walker = document.createTreeWalker(
      content,
      NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
      null
    );

    let node: Node | null;
    let foundKeyword = false;
    let keywordElement: HTMLElement | null = null;

    while (node = walker.nextNode()) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent || '';
        const hasKeyword = replyKeywords.some(keyword => text.includes(keyword));
        
        if (hasKeyword) {
          foundKeyword = true;
          keywordElement = node.parentElement as HTMLElement;
          console.log('[ChatPanel] Found reply keyword in:', text);
          break;
        }
      }
    }

    if (!foundKeyword || !keywordElement) {
      console.log('[ChatPanel] No reply keyword found');
      return;
    }

    // 查找关键词后的所有回复内容段落
    let nextElement = keywordElement.nextElementSibling;
    
    // 如果关键词在段落内部，查找该段落后的下一个元素
    if (!nextElement) {
      let parent = keywordElement.parentElement;
      while (parent && parent !== content) {
        nextElement = parent.nextElementSibling;
        if (nextElement) break;
        parent = parent.parentElement;
      }
    }

    // 跳过空元素和分割线
    while (nextElement && (!nextElement.textContent?.trim() || nextElement.tagName === 'HR')) {
      nextElement = nextElement.nextElementSibling;
    }

    if (!nextElement || !nextElement.textContent) {
      console.log('[ChatPanel] No valid reply content found after keyword');
      return;
    }

    // 收集关键词后的所有连续回复段落（直到遇到下一个标题、分割线或新的评价块）
    const replyElements: Element[] = [];
    let current: Element | null = nextElement;
    while (current) {
      const tag = current.tagName;
      // 遇到标题、分割线、或新的评价标记时停止
      if (tag === 'HR' || tag === 'H1' || tag === 'H2' || tag === 'H3' || tag === 'H4') break;
      // 遇到包含下一条评价关键词的元素时停止
      const text = current.textContent || '';
      if (replyElements.length > 0 && /^(###?\s|评价\s*\d|用户[：:]|原始评价[：:])/.test(text.trim())) break;

      if (text.trim()) {
        replyElements.push(current);
      }
      current = current.nextElementSibling;
    }

    if (replyElements.length > 0) {
      // 合并所有回复段落的文本
      const replyText = replyElements.map(el => el.textContent?.trim()).filter(Boolean).join('\n');
      
      // 验证是否是有效的回复内容（至少 20 个字符）
      if (replyText.length >= 20) {
        console.log('[ChatPanel] Found reply content:', replyText.substring(0, 50) + '...');
        
        // 用 wrapper 包裹所有回复段落
        const firstEl = replyElements[0];
        if (!firstEl.querySelector('.copy-button') && !firstEl.closest('.reply-content-wrapper')) {
          const wrapper = document.createElement('div');
          wrapper.className = 'reply-content-wrapper';
          firstEl.parentNode?.insertBefore(wrapper, firstEl);
          for (const el of replyElements) {
            wrapper.appendChild(el);
          }
          this.addCopyButton(wrapper, replyText, 'reply');
          console.log('[ChatPanel] Added copy button for reply content');
        }
      }
    } else {
      console.log('[ChatPanel] No valid reply content found after keyword');
    }
  }

  /**
   * 添加复制按钮
   */
  private addCopyButton(container: HTMLElement, textToCopy: string, type: 'code' | 'reply'): void {
    const button = document.createElement('button');
    button.className = `copy-button copy-button-${type}`;
    button.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M5.5 4.5V2.5C5.5 1.94772 5.94772 1.5 6.5 1.5H13.5C14.0523 1.5 14.5 1.94772 14.5 2.5V9.5C14.5 10.0523 14.0523 10.5 13.5 10.5H11.5" stroke="currentColor" stroke-width="1.5"/>
        <rect x="1.5" y="5.5" width="8" height="8" rx="1" stroke="currentColor" stroke-width="1.5"/>
      </svg>
      <span class="copy-text">${i18n.t('copy.text')}</span>
    `;
    button.title = type === 'reply' ? i18n.t('copy.reply') : i18n.t('copy.code');

    button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(textToCopy);
        
        // 显示成功反馈
        button.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M3 8L6.5 11.5L13 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span class="copy-text">${i18n.t('copy.done')}</span>
        `;
        button.classList.add('copied');

        // 2秒后恢复
        setTimeout(() => {
          button.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M5.5 4.5V2.5C5.5 1.94772 5.94772 1.5 6.5 1.5H13.5C14.0523 1.5 14.5 1.94772 14.5 2.5V9.5C14.5 10.0523 14.0523 10.5 13.5 10.5H11.5" stroke="currentColor" stroke-width="1.5"/>
              <rect x="1.5" y="5.5" width="8" height="8" rx="1" stroke="currentColor" stroke-width="1.5"/>
            </svg>
            <span class="copy-text">${i18n.t('copy.text')}</span>
          `;
          button.classList.remove('copied');
        }, 2000);
      } catch (err) {
        console.error('Failed to copy text:', err);
        button.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
          <span class="copy-text">${i18n.t('copy.fail')}</span>
        `;
        
        setTimeout(() => {
          button.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M5.5 4.5V2.5C5.5 1.94772 5.94772 1.5 6.5 1.5H13.5C14.0523 1.5 14.5 1.94772 14.5 2.5V9.5C14.5 10.0523 14.0523 10.5 13.5 10.5H11.5" stroke="currentColor" stroke-width="1.5"/>
              <rect x="1.5" y="5.5" width="8" height="8" rx="1" stroke="currentColor" stroke-width="1.5"/>
            </svg>
            <span class="copy-text">${i18n.t('copy.text')}</span>
          `;
        }, 2000);
      }
    });

    container.style.position = 'relative';
    container.appendChild(button);
  }

  /**
   * 移除欢迎消息
   */
  private removeWelcomeMessage(): void {
    const welcomeMessage = this.chatMessages.querySelector('.welcome-message');
    if (welcomeMessage) {
      welcomeMessage.remove();
    }
  }

  /**
   * 显示打字指示器
   */
  private showTypingIndicator(): void {
    // 移除已存在的指示器
    this.hideTypingIndicator();
    
    const typingDiv = document.createElement('div');
    typingDiv.className = 'typing-indicator';
    typingDiv.id = 'typingIndicator';
    typingDiv.innerHTML = `
      <div class="message-avatar">🤖</div>
      <div class="typing-content">
        <span class="typing-spinner"></span>
        <span class="typing-text">AI 正在处理</span>
        <span class="typing-dots" aria-hidden="true">
          <span class="typing-dot"></span>
          <span class="typing-dot"></span>
          <span class="typing-dot"></span>
        </span>
      </div>
    `;
    
    this.chatMessages.appendChild(typingDiv);
    
    if (this.config.autoScroll) {
      this.scrollToBottom();
    }
  }

  /**
   * 隐藏打字指示器
   */
  private hideTypingIndicator(): void {
    const typingIndicator = document.getElementById('typingIndicator');
    if (typingIndicator) {
      typingIndicator.remove();
    }
  }

  /**
   * 滚动到底部
   */
  private scrollToBottom(): void {
    this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
  }

  /**
   * 清空对话历史
   */
  async clearHistory(): Promise<void> {
    // 使用主进程的 dialog.showMessageBox 替代渲染进程的 confirm()
    // 原生 confirm() 在 Electron 中会导致 BrowserView 抢占焦点，
    // 使得主窗口 webContents（右侧面板）无法接收输入事件
    let confirmed = false;
    try {
      confirmed = await window.electronAPI.dialog.confirm(
        i18n.t('chat.clear.confirm')
      );
    } catch {
      // fallback: 如果 IPC 不可用，使用原生 confirm
      confirmed = confirm(i18n.t('chat.clear.confirm'));
    }

    if (!confirmed) {
      return;
    }
    
    console.log('ChatPanel: Clearing history');
    
    try {
      // 调用回调清空历史
      if (this.onClearHistory) {
        await this.onClearHistory();
      }
      
      // 清空本地消息
      this.messages = [];
      
      // 重置UI
      this.resetUI();
      
      console.log('ChatPanel: History cleared');
    } catch (error) {
      console.error('ChatPanel: Failed to clear history:', error);
      
      if (this.onError) {
        this.onError(i18n.t('chat.clear.error'));
      }
    }
  }

  /**
   * 重置UI
   */
  private resetUI(): void {
    // 重置处理状态（防止清空时正在处理消息导致输入框卡死）
    this.isProcessing = false;

    // 重置消息区域
    this.chatMessages.innerHTML = `
      <div class="welcome-message">
        <div class="welcome-icon">🤖</div>
        <h3>${i18n.t('chat.welcome.title')}</h3>
        <p>${i18n.t('chat.welcome.desc')}</p>
        <p class="welcome-hint">${i18n.t('chat.welcome.hint')}</p>
      </div>
    `;

    // 重置输入框状态
    this.chatInput.value = '';
    this.chatInput.disabled = false;
    this.chatInput.style.height = 'auto';
    this.updateSendButton();

    // 通过 IPC 让主进程把焦点拉回主窗口的 webContents
    // 这是解决 BrowserView 焦点抢占的关键步骤
    const input = this.chatInput;
    const restoreFocus = async () => {
      try {
        await window.electronAPI.focus.mainWebContents();
      } catch {
        window.focus();
      }
      input.disabled = false;
      input.focus();
    };
    setTimeout(restoreFocus, 50);
    setTimeout(restoreFocus, 300);
  }

  /**
   * 格式化时间
   */
  private formatTime(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('zh-CN', { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  }

  /**
   * 转义HTML
   */
  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * 生成ID
   */
  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  /**
   * 设置消息发送回调
   */
  setOnMessageSend(callback: (message: string) => Promise<string>): void {
    this.onMessageSend = callback;
  }

  /**
   * 设置流式消息回调
   * callback: 发起流式请求，返回完整文本（chunk 通过 onStreamChunk 推送）
   * onStreamChunk: 每个 chunk 到达时的回调
   */
  setOnMessageStream(
    callback: (message: string) => Promise<string>,
    onStreamChunk: (handler: (chunk: string) => void) => () => void,
  ): void {
    this.onMessageStream = callback;
    this._streamChunkRegistrar = onStreamChunk;
  }

  private _streamChunkRegistrar?: (handler: (chunk: string) => void) => () => void;

  /**
   * 流式发送消息：等待首个 chunk 后再创建 assistant 气泡，避免空白回复框
   */
  private async sendMessageStream(message: string): Promise<void> {
    const msgId = this.generateId();
    let messageDiv: HTMLDivElement | null = null;
    let contentEl: HTMLElement | null = null;
    let fullText = '';

    const ensureAssistantMessage = (): HTMLElement => {
      if (contentEl) return contentEl;

      this.hideTypingIndicator();
      messageDiv = document.createElement('div');
      messageDiv.className = 'message assistant';
      messageDiv.dataset.messageId = msgId;
      messageDiv.innerHTML = `
        <div class="message-header">
          <div class="message-avatar">🤖</div>
          <div class="message-info">
            <div class="message-role">${i18n.t('chat.role.assistant')}</div>
            ${this.config.showTimestamp ? `<div class="message-time">${this.formatTime(Date.now())}</div>` : ''}
          </div>
        </div>
        <div class="message-content markdown-body"></div>
      `;
      this.removeWelcomeMessage();
      this.chatMessages.appendChild(messageDiv);
      contentEl = messageDiv.querySelector('.message-content') as HTMLElement;
      return contentEl;
    };

    // 注册 chunk 监听
    const cleanup = this._streamChunkRegistrar!((chunk: string) => {
      fullText += chunk;
      const target = ensureAssistantMessage();
      // 增量渲染：用 marked 重新渲染完整文本（marked 很快，不会卡）
      target.innerHTML = marked.parse(fullText) as string;
      if (this.config.autoScroll) {
        this.scrollToBottom();
      }
    });

    try {
      const response = await this.onMessageStream!(message);
      // 流结束，用最终完整文本做一次最终渲染（确保一致性）
      fullText = response;
      if (fullText.trim()) {
        const target = ensureAssistantMessage();
        target.innerHTML = marked.parse(fullText) as string;
        this.addCopyButtonsToMessage(messageDiv!);
      } else {
        this.hideTypingIndicator();
      }

      // 记录到 messages 数组
      this.messages.push({ id: msgId, role: 'assistant', content: response, timestamp: Date.now() });

      this.hideSkillProgress();
      console.log('ChatPanel: Stream message completed');
    } finally {
      cleanup();
    }
  }

  /**
   * 设置清空历史回调
   */
  setOnClearHistory(callback: () => Promise<void>): void {
    this.onClearHistory = callback;
  }

  setOnNewSession(callback: () => void): void {
    this.onNewSession = callback;
  }

  /** 清空 UI 消息（不触发回调，供外部新建会话时调用） */
  clearMessages(): void {
    this.messages = [];
    this.resetUI();
  }

  /**
   * 设置错误回调
   */
  setOnError(callback: (error: string) => void): void {
    this.onError = callback;
  }

  /**
   * 获取消息列表
   */
  getMessages(): ChatMessage[] {
    return [...this.messages];
  }

  /**
   * 获取消息数量
   */
  getMessageCount(): number {
    return this.messages.length;
  }

  /**
   * 启用/禁用输入
   */
  setEnabled(enabled: boolean): void {
    this.chatInput.disabled = !enabled;
    this.sendBtn.disabled = !enabled;
    this.clearChatBtn.disabled = !enabled;
  }

  /**
   * 获取处理状态
   */
  isProcessingMessage(): boolean {
    return this.isProcessing;
  }

  /**
   * 监听技能执行进度事件
   */
  private bindProgressListener(): void {
    if (typeof window !== 'undefined' && (window as any).electronAPI?.piAgent?.onProgress) {
      this.progressCleanup = (window as any).electronAPI.piAgent.onProgress((event: any) => {
        this.showSkillProgress(event);
      });
    }
  }

  /**
   * 显示技能执行进度面板
   */
  private showSkillProgress(event: any): void {
    // 移除已有进度面板
    this.hideSkillProgress();

    const progressDiv = document.createElement('div');
    progressDiv.className = 'skill-progress';
    progressDiv.id = 'skillProgress';

    const phaseLabels: Record<string, string> = {
      connecting: i18n.t('skill.connecting'),
      navigating: i18n.t('skill.navigating'),
      expanding: i18n.t('skill.expanding'),
      extracting: i18n.t('skill.extracting'),
    };

    const phaseText = phaseLabels[event.phase] || event.phase || i18n.t('skill.processing');
    const stepInfo = event.step && event.totalSteps ? ` (${event.step}/${event.totalSteps})` : '';
    const message = event.message || '';
    const url = event.data?.url || '';

    let screenshotHtml = '';
    if (event.screenshot) {
      screenshotHtml = `<img class="skill-progress-screenshot" src="data:image/jpeg;base64,${event.screenshot}" alt="页面截图" />`;
    }

    progressDiv.innerHTML = `
      <div class="skill-progress-header">
        <span class="skill-progress-phase">${phaseText}${stepInfo}</span>
        <span class="skill-progress-spinner"></span>
      </div>
      ${screenshotHtml}
      ${url ? `<div class="skill-progress-url" title="${this.escapeHtml(url)}">${this.escapeHtml(url)}</div>` : ''}
      ${message ? `<div class="skill-progress-message">${this.escapeHtml(message)}</div>` : ''}
    `;

    // 插入到 typing indicator 之前或消息列表末尾
    const typingIndicator = document.getElementById('typingIndicator');
    if (typingIndicator) {
      this.chatMessages.insertBefore(progressDiv, typingIndicator);
    } else {
      this.chatMessages.appendChild(progressDiv);
    }

    if (this.config.autoScroll) {
      this.scrollToBottom();
    }
  }

  /**
   * 隐藏技能执行进度面板
   */
  private hideSkillProgress(): void {
    const progressEl = document.getElementById('skillProgress');
    if (progressEl) {
      progressEl.remove();
    }
  }

  /**
   * 销毁组件
   */
  destroy(): void {
    console.log('Destroying ChatPanel...');

    // 清理进度监听器
    if (this.progressCleanup) {
      this.progressCleanup();
      this.progressCleanup = null;
    }

    // 清理状态
    this.messages = [];
    this.isProcessing = false;

    console.log('ChatPanel destroyed');
  }
}
