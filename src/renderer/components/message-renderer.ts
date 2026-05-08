/**
 * Message Renderer - 消息渲染器
 * 
 * 职责：
 * - 渲染Markdown格式的消息
 * - 代码块语法高亮
 * - HTML清理和安全处理
 * - 用户/助手消息样式区分
 * 
 * 注意：当前实现不依赖外部库（marked.js, highlight.js）
 * 提供基础的Markdown渲染功能
 * 如需完整功能，可以后续集成这些库
 */

/**
 * 消息渲染配置接口
 */
interface MessageRendererConfig {
  enableMarkdown?: boolean;
  enableCodeHighlight?: boolean;
  sanitizeHtml?: boolean;
  maxCodeBlockLines?: number;
}

/**
 * 消息渲染器类
 */
export class MessageRenderer {
  private config: MessageRendererConfig;

  /**
   * 构造函数
   */
  constructor(config?: MessageRendererConfig) {
    this.config = {
      enableMarkdown: true,
      enableCodeHighlight: true,
      sanitizeHtml: true,
      maxCodeBlockLines: 100,
      ...config
    };
  }

  /**
   * 渲染消息内容
   */
  render(content: string, role: 'user' | 'assistant'): string {
    if (!this.config.enableMarkdown) {
      return this.escapeHtml(content);
    }
    
    // 清理HTML
    let rendered = this.config.sanitizeHtml ? this.escapeHtml(content) : content;
    
    // 渲染Markdown元素
    rendered = this.renderCodeBlocks(rendered);
    rendered = this.renderInlineCode(rendered);
    rendered = this.renderBold(rendered);
    rendered = this.renderItalic(rendered);
    rendered = this.renderLinks(rendered);
    rendered = this.renderLists(rendered);
    rendered = this.renderLineBreaks(rendered);
    
    return rendered;
  }

  /**
   * 渲染代码块
   */
  private renderCodeBlocks(content: string): string {
    // 匹配 ```language\ncode\n```
    const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
    
    return content.replace(codeBlockRegex, (match, language, code) => {
      const lang = language || 'text';
      const escapedCode = code.trim();
      
      // 限制代码块行数
      const lines = escapedCode.split('\n');
      const displayCode = lines.length > this.config.maxCodeBlockLines!
        ? lines.slice(0, this.config.maxCodeBlockLines!).join('\n') + '\n...(truncated)'
        : escapedCode;
      
      return `<pre class="code-block" data-language="${lang}"><code>${displayCode}</code></pre>`;
    });
  }

  /**
   * 渲染行内代码
   */
  private renderInlineCode(content: string): string {
    // 匹配 `code`
    return content.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
  }

  /**
   * 渲染粗体
   */
  private renderBold(content: string): string {
    // 匹配 **text** 或 __text__
    return content.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
                  .replace(/__([^_]+)__/g, '<strong>$1</strong>');
  }

  /**
   * 渲染斜体
   */
  private renderItalic(content: string): string {
    // 匹配 *text* 或 _text_ (但不匹配 ** 或 __)
    return content.replace(/(?<!\*)\*(?!\*)([^*]+)\*(?!\*)/g, '<em>$1</em>')
                  .replace(/(?<!_)_(?!_)([^_]+)_(?!_)/g, '<em>$1</em>');
  }

  /**
   * 渲染链接
   */
  private renderLinks(content: string): string {
    // 匹配 [text](url)
    const markdownLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    content = content.replace(markdownLinkRegex, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    
    // 匹配纯URL
    const urlRegex = /(https?:\/\/[^\s<]+)/g;
    content = content.replace(urlRegex, (url) => {
      // 避免重复渲染已经在<a>标签中的URL
      return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`;
    });
    
    return content;
  }

  /**
   * 渲染列表
   */
  private renderLists(content: string): string {
    // 匹配无序列表 - item 或 * item
    const lines = content.split('\n');
    let inList = false;
    let result: string[] = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const unorderedMatch = line.match(/^[\s]*[-*]\s+(.+)$/);
      const orderedMatch = line.match(/^[\s]*\d+\.\s+(.+)$/);
      
      if (unorderedMatch) {
        if (!inList) {
          result.push('<ul>');
          inList = true;
        }
        result.push(`<li>${unorderedMatch[1]}</li>`);
      } else if (orderedMatch) {
        if (!inList) {
          result.push('<ol>');
          inList = true;
        }
        result.push(`<li>${orderedMatch[1]}</li>`);
      } else {
        if (inList) {
          // 检查是ul还是ol
          const lastList = result[result.length - 1];
          if (lastList && !lastList.startsWith('<li>')) {
            result.push(lastList.includes('<ul>') ? '</ul>' : '</ol>');
            inList = false;
          }
        }
        result.push(line);
      }
    }
    
    if (inList) {
      result.push('</ul>');
    }
    
    return result.join('\n');
  }

  /**
   * 渲染换行
   */
  private renderLineBreaks(content: string): string {
    // 将连续的换行转换为段落
    return content.replace(/\n\n+/g, '</p><p>')
                  .replace(/\n/g, '<br>');
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
   * 清理HTML（移除危险标签和属性）
   */
  sanitize(html: string): string {
    // 创建临时元素
    const temp = document.createElement('div');
    temp.innerHTML = html;
    
    // 移除script标签
    const scripts = temp.querySelectorAll('script');
    scripts.forEach(script => script.remove());
    
    // 移除危险属性
    const allElements = temp.querySelectorAll('*');
    allElements.forEach(element => {
      // 移除事件处理器属性
      Array.from(element.attributes).forEach(attr => {
        if (attr.name.startsWith('on')) {
          element.removeAttribute(attr.name);
        }
      });
      
      // 移除javascript: 链接
      if (element.getAttribute('href')?.startsWith('javascript:')) {
        element.removeAttribute('href');
      }
    });
    
    return temp.innerHTML;
  }

  /**
   * 渲染完整消息（包含头部和内容）
   */
  renderMessage(
    role: 'user' | 'assistant',
    content: string,
    timestamp: number,
    showTimestamp: boolean = true
  ): string {
    const timeString = new Date(timestamp).toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit'
    });
    
    const renderedContent = this.render(content, role);
    
    return `
      <div class="message ${role}">
        <div class="message-header">
          <div class="message-avatar">${role === 'user' ? '👤' : '🤖'}</div>
          <div class="message-info">
            <div class="message-role">${role === 'user' ? '你' : 'AI助手'}</div>
            ${showTimestamp ? `<div class="message-time">${timeString}</div>` : ''}
          </div>
        </div>
        <div class="message-content">${renderedContent}</div>
      </div>
    `;
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<MessageRendererConfig>): void {
    this.config = {
      ...this.config,
      ...config
    };
  }

  /**
   * 获取配置
   */
  getConfig(): MessageRendererConfig {
    return { ...this.config };
  }
}

/**
 * 创建默认消息渲染器实例
 */
export function createDefaultRenderer(): MessageRenderer {
  return new MessageRenderer({
    enableMarkdown: true,
    enableCodeHighlight: true,
    sanitizeHtml: true,
    maxCodeBlockLines: 100
  });
}
