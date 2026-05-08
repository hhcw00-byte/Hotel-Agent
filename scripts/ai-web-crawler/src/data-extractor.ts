/**
 * Data Extractor
 * Four-layer extraction strategy with priority fallback.
 * Mirrors the reference project's data_extractor.py.
 */

import { AgentClient } from './agent-client';
import { ExtractedData, ExtractionContext, Message, DOMContent } from './types';
import { LLMConfig } from './config-types';
import { ScreenshotManager } from './screenshot-manager';

export class DataExtractor {
  private agentClient: AgentClient;

  constructor(llmConfig: LLMConfig) {
    this.agentClient = new AgentClient(llmConfig);
  }

  /**
   * Extract data using four-layer strategy
   * Priority order (matching Python reference):
   * 1. DOM + Screenshot fusion (most accurate)
   * 2. DOM only (medium accuracy and speed)
   * 3. Network JSON (fast but may not be relevant)
   * 4. Screenshot only (last resort)
   */
  async extract(context: ExtractionContext): Promise<ExtractedData> {
    const strategies = [
      () => this.tryLocalReviewDOM(context),      // 评价/消息页：无 LLM 时也能提取可见内容
      () => this.tryDOMScreenshotFusion(context), // 优先：最准确
      () => this.tryDOMOnly(context),             // 次优：中等速度和准确度
      () => this.tryNetworkJSON(context),         // 备选：快但可能不相关
      () => this.tryScreenshotOnly(context),      // 兜底：最慢
    ];

    const strategyNames = ['local_review_dom', 'dom_screenshot_fusion', 'dom_only', 'network_json', 'screenshot_only'];

    for (let i = 0; i < strategies.length; i++) {
      const name = strategyNames[i] ?? `strategy_${i}`;
      try {
        console.error(`[extractor] 尝试策略: ${name}`);
        const result = await strategies[i]();
        if (result && result.data !== null) {
          console.error(`[extractor] 策略成功: ${name}`);
          return result;
        }
        console.error(`[extractor] 策略返回空结果，降级: ${name}`);
      } catch (err: any) {
        console.error(`[extractor] 策略异常，降级: ${name} → ${err?.message ?? err}`);
        continue;
      }
    }

    return {
      data: null,
      confidence: 0.0,
      strategy: 'dom_screenshot',
      raw: {},
    };
  }

  /**
   * Local extractor for OTA review pages. This keeps smart-reply usable when
   * no LLM API key is configured, and avoids falling back to API count-only data.
   */
  private async tryLocalReviewDOM(context: ExtractionContext): Promise<ExtractedData | null> {
    if (!context.domContent || !this.isReviewGoal(context.goal)) return null;

    const lines = context.domContent.text
      .flatMap(text => text.split(/\n+/))
      .map(text => text.replace(/\s+/g, ' ').trim())
      .filter(Boolean);

    const reviews = this.extractCtripReviewItems(lines);
    if (reviews.length === 0) return null;

    return {
      data: reviews,
      confidence: 0.82,
      strategy: 'local_review_dom',
      raw: { dom: lines.join('\n').slice(0, 12000) },
    };
  }

  private isReviewGoal(goal: string): boolean {
    return /评价|点评|评论|评语|差评|好评|回复|消息|IM/i.test(goal);
  }

  private extractCtripReviewItems(lines: string[]): any[] {
    const reviews: any[] = [];
    const dateLine = /^\d{4}年\d{1,2}月$/;
    const publishLine = /^发表于[:：]\s*(.+)$/;
    const scoreLine = /^(\d(?:\.\d)?)(超棒|很好|不错|一般|较差|差|分)?$/;
    const dimensionLine = /^(设施|卫生|环境|服务)\s*(\d(?:\.\d)?)$/;
    const ignorePrefixes = [
      '反馈异常点评',
      '此点评不计入点评分数',
      '选取规则详见',
      '回复',
    ];

    for (let i = 0; i < lines.length - 5; i++) {
      const user = lines[i];
      if (!user || user.length > 40 || dateLine.test(user)) continue;
      if (!dateLine.test(lines[i + 1])) continue;

      const roomName = lines[i + 2] || '';
      let cursor = i + 3;
      if (lines[cursor] === '反馈异常点评') cursor++;

      const scoreMatch = lines[cursor]?.match(scoreLine);
      if (!scoreMatch) continue;

      const item: any = {
        user,
        stayMonth: lines[i + 1],
        roomName,
        rating: Number(scoreMatch[1]),
        ratingText: scoreMatch[2] || undefined,
        dimensions: {},
        content: '',
        publishedAt: '',
        replyStatus: 'unknown',
      };
      cursor++;

      while (cursor < lines.length) {
        const dimMatch = lines[cursor].match(dimensionLine);
        if (!dimMatch) break;
        item.dimensions[dimMatch[1]] = Number(dimMatch[2]);
        cursor++;
      }

      const contentParts: string[] = [];
      while (cursor < lines.length) {
        const line = lines[cursor];
        const published = line.match(publishLine);
        if (published) {
          item.publishedAt = published[1];
          break;
        }
        if (!ignorePrefixes.some(prefix => line.startsWith(prefix))) {
          contentParts.push(line);
        }
        cursor++;
      }

      item.content = contentParts.join(' ').trim();
      if (!item.content || !item.publishedAt) continue;

      const duplicate = reviews.some(existing =>
        existing.user === item.user
        && existing.publishedAt === item.publishedAt
        && existing.content === item.content
      );
      if (!duplicate) reviews.push(item);

      i = Math.max(i, cursor);
    }

    return reviews.slice(0, 30);
  }

  /**
   * Strategy 1: DOM + Screenshot fusion (highest priority)
   * Supports multiple viewport screenshots collected during scrolling.
   */
  private async tryDOMScreenshotFusion(context: ExtractionContext): Promise<ExtractedData | null> {
    // Collect all available screenshots (multi-shot takes priority over single)
    const allShots: Buffer[] = context.screenshots && context.screenshots.length > 0
      ? context.screenshots
      : context.screenshot ? [context.screenshot] : [];

    if (allShots.length === 0 || !context.domContent) return null;

    const domContext = this.buildDOMContext(context.domContent);

    // Compress all screenshots and build image content blocks
    const imageBlocks: { type: 'image_url'; image_url: { url: string } }[] = [];
    for (const shot of allShots) {
      const compressed = await ScreenshotManager.compressForLLM(shot);
      imageBlocks.push({ type: 'image_url', image_url: { url: this.agentClient.encodeImage(compressed, 'image/jpeg') } });
    }

    const shotDesc = allShots.length > 1
      ? `以下 ${allShots.length} 张截图是页面从上到下滚动过程中依次截取的视口截图，合起来覆盖完整页面内容。`
      : '以下是页面截图。';

    const prompt = `你是一个数据提取专家。请结合页面截图和DOM文本，提取"${context.goal}"相关的完整结构化数据。

${shotDesc}

${domContext}

**重要提示：**
1. 多张截图按顺序覆盖页面不同区域，请综合所有截图提取数据，不要遗漏任何一张中的内容
2. DOM文本是页面的结构化内容，与截图互补
3. 页面可能有侧边栏、筛选栏、汇总统计区域，这些区域的数据同样重要
4. 如果页面包含汇总/统计信息（如总数、可用数、各状态数量），务必完整提取
5. 不要编造数据，只提取页面中实际存在的信息
6. 用精简的 JSON 结构组织数据

返回 JSON（只返回 JSON，不要加 markdown 代码块）：
{"extracted_data": [...], "summary": "简要说明提取到了什么", "confidence": 0.0-1.0}`;

    const messages: Message[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          ...imageBlocks,
        ],
      },
    ];

    console.error(`[extractor] fusion: ${allShots.length} 张截图，发送给 LLM...`);
    // fusion 含多张图片，给更长的超时（图片越多越慢，最少90秒）
    const fusionTimeout = Math.max(90000, allShots.length * 30000);
    const response = await this.agentClient.call(messages, { maxTokens: 16384, temperature: 0, timeout: fusionTimeout });
    console.error(`[extractor] fusion LLM 原始返回（前500字）: ${response.content.slice(0, 500)}`);
    const parsed = this.parseJSON(response.content);
    console.error(`[extractor] fusion JSON 解析结果: parsed=${!!parsed}, has_extracted_data=${parsed ? parsed.extracted_data !== undefined : false}`);

    if (!parsed || parsed.extracted_data === undefined) return null;

    return {
      data: parsed.extracted_data,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.9,
      strategy: 'dom_screenshot',
      raw: {},
    };
  }

  /**
   * Strategy 2: DOM only
   */
  private async tryDOMOnly(context: ExtractionContext): Promise<ExtractedData | null> {
    if (!context.domContent) return null;

    const domContext = this.buildDOMContext(context.domContent);

    const prompt = `你是一个数据提取专家。请从以下网页内容中提取"${context.goal}"相关的结构化数据。

${domContext}

**要求：**
1. 只提取与"${context.goal}"直接相关的数据
2. 不要编造数据，只提取页面中实际存在的信息
3. 用合理的 JSON 结构组织数据，尽量精简字段名和值
4. 如果页面中没有相关数据，返回空列表

返回 JSON（只返回 JSON，不要加 markdown 代码块）：
{"extracted_data": [...], "summary": "简要说明提取到了什么", "confidence": 0.0-1.0}`;

    const messages: Message[] = [
      { role: 'user', content: prompt },
    ];

    const response = await this.agentClient.call(messages, { maxTokens: 4096, temperature: 0 });
    const parsed = this.parseJSON(response.content);

    if (!parsed || parsed.extracted_data === undefined) return null;

    return {
      data: parsed.extracted_data,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.7,
      strategy: 'dom_only',
      raw: {},
    };
  }

  /**
   * Strategy 3: Network JSON (direct API data)
   * Fast and accurate when available, but lower priority than DOM strategies
   * to ensure we get the most relevant data
   */
  private async tryNetworkJSON(context: ExtractionContext): Promise<ExtractedData | null> {
    if (!context.networkData || context.networkData.length === 0) return null;

    // Collect all meaningful JSON responses (> 50 chars)
    const meaningful: any[] = [];
    for (const item of context.networkData) {
      const size = JSON.stringify(item).length;
      if (size > 50) {
        meaningful.push(item);
      }
    }

    if (meaningful.length === 0) return null;

    // If merged data is reasonably small, combine all; otherwise take the largest
    const MAX_MERGED_SIZE = 100_000; // 100KB
    const mergedStr = JSON.stringify(meaningful);

    let data: any;
    if (mergedStr.length <= MAX_MERGED_SIZE) {
      data = meaningful.length === 1 ? meaningful[0] : meaningful;
    } else {
      // Fallback: pick the largest single response
      let best: any = null;
      let bestSize = 0;
      for (const item of meaningful) {
        const size = JSON.stringify(item).length;
        if (size > bestSize) {
          best = item;
          bestSize = size;
        }
      }
      data = best;
    }

    // Simplify data to reduce LLM processing time
    const simplified = this.simplifyNetworkData(data, context.goal);
    const simplifiedSize = JSON.stringify(simplified).length;
    const originalSize = JSON.stringify(data).length;

    console.log(`[DataExtractor] Network JSON strategy - Original: ${originalSize} bytes, Simplified: ${simplifiedSize} bytes (${Math.round((1 - simplifiedSize/originalSize) * 100)}% reduction)`);

    return {
      data: simplified,
      confidence: 0.9,  // API 数据准确，但优先级降低
      strategy: 'network_json',
      raw: {},
    };
  }


  /**
   * Strategy 4: Screenshot only (last resort)
   */
  private async tryScreenshotOnly(context: ExtractionContext): Promise<ExtractedData | null> {
    if (!context.screenshot) return null;

    const prompt = `请分析这个页面截图，提取"${context.goal}"相关的数据。

**规则：**
1. 只提取截图中实际可见的数据，不要编造
2. 看不清的字段设为 null
3. 用合理的 JSON 结构组织数据

返回 JSON（只返回 JSON，不要加 markdown 代码块）：
{"extracted_data": [...], "summary": "简要说明", "confidence": 0.0-1.0}`;

    // Compress screenshot before sending to LLM
    const compressed = await ScreenshotManager.compressForLLM(context.screenshot);
    const imageUrl = this.agentClient.encodeImage(compressed, 'image/jpeg');
    const messages: Message[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: imageUrl } },
        ],
      },
    ];

    const response = await this.agentClient.call(messages, { maxTokens: 4096, temperature: 0 });
    const parsed = this.parseJSON(response.content);

    if (!parsed || parsed.extracted_data === undefined) return null;

    return {
      data: parsed.extracted_data,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
      strategy: 'screenshot_only',
      raw: {},
    };
  }

  /**
   * Build DOM context string for LLM prompt — mirrors data_extractor.py
   */
  private buildDOMContext(dom: DOMContent): string {
    const parts: string[] = [];

    if (dom.text.length > 0) {
      // Send up to 8000 chars of joined text
      const joined = dom.text.join('\n');
      parts.push(`【页面DOM文本】\n${joined.substring(0, 8000)}`);
    }

    if (dom.tables.length > 0) {
      for (let i = 0; i < Math.min(dom.tables.length, 3); i++) {
        const table = dom.tables[i];
        const headerLine = table.headers.length > 0 ? table.headers.join(' | ') + '\n' : '';
        const rowLines = table.rows.slice(0, 30).map(r => r.join(' | ')).join('\n');
        parts.push(`【表格 ${i + 1}】\n${headerLine}${rowLines}`);
      }
    }

    if (dom.dataAttributes.length > 0) {
      const attrsStr = JSON.stringify(dom.dataAttributes.slice(0, 20), null, 1);
      parts.push(`【数据属性】\n${attrsStr}`);
    }

    return parts.length > 0 ? parts.join('\n\n') : '（页面内容为空）';
  }

  /**
   * Parse JSON from LLM response — handles markdown fences, think tags, truncation
   */
  private parseJSON(text: string): any | null {
    const originalLength = text.length;
    // Strip <think>...</think>
    text = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    // Strip markdown fences
    text = text.replace(/^```(?:json)?\s*/m, '').replace(/\s*```$/m, '').trim();
    // Find first JSON object if text doesn't start with {
    if (!text.startsWith('{')) {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) text = match[0];
    }

    console.error(`[extractor] JSON解析：原始长度=${originalLength}, 清理后长度=${text.length}`);

    try {
      return JSON.parse(text);
    } catch (err: any) {
      console.error(`[extractor] JSON解析失败: ${err.message}, 尝试修复...`);
      // Attempt to repair truncated JSON
      const repaired = this.repairTruncatedJSON(text);
      if (repaired) {
        console.error(`[extractor] JSON修复成功`);
        return repaired;
      }
      console.error(`[extractor] JSON修复失败，返回null`);
      return null;
    }
  }

  private repairTruncatedJSON(text: string): any | null {
    if (!text || !text.startsWith('{')) return null;

    for (let trim = 0; trim < Math.min(200, text.length); trim++) {
      let candidate = trim === 0 ? text : text.slice(0, -trim);
      candidate = candidate.trimEnd();
      // Remove trailing incomplete string or comma
      candidate = candidate.replace(/[,:\s]*"[^"]*$/, '');
      candidate = candidate.replace(/,\s*$/, '');

      const openBraces = (candidate.match(/{/g) || []).length - (candidate.match(/}/g) || []).length;
      const openBrackets = (candidate.match(/\[/g) || []).length - (candidate.match(/]/g) || []).length;
      if (openBraces < 0 || openBrackets < 0) continue;

      const closing = ']'.repeat(openBrackets) + '}'.repeat(openBraces);
      try {
        const result = JSON.parse(candidate + closing);
        if (typeof result === 'object') return result;
      } catch {
        continue;
      }
    }
    return null;
  }

  /**
   * Simplify network data by detecting and keeping only essential fields
   * Reduces data size by 80-90% while preserving key information
   */
  private simplifyNetworkData(data: any, goal: string): any {
    if (!data || typeof data !== 'object') {
      return data;
    }

    // If data is an array, simplify each item
    if (Array.isArray(data)) {
      // Detect essential fields from first few items
      const essentialFields = this.detectEssentialFields(data, goal);

      // Keep only essential fields for each item
      return data.map(item => this.keepEssentialFields(item, essentialFields));
    }

    // If data is an object with array properties, simplify those arrays
    const simplified: any = {};
    for (const [key, value] of Object.entries(data)) {
      if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object') {
        const essentialFields = this.detectEssentialFields(value, goal);
        simplified[key] = value.map(item => this.keepEssentialFields(item, essentialFields));
      } else {
        simplified[key] = value;
      }
    }

    return simplified;
  }

  /**
   * Detect essential fields based on patterns and extraction goal
   * Returns a set of field names that should be kept
   */
  private detectEssentialFields(items: any[], goal: string): Set<string> {
    if (items.length === 0) return new Set();

    const essential = new Set<string>();
    const sampleSize = Math.min(5, items.length);
    const samples = items.slice(0, sampleSize);

    // Common essential field patterns
    const essentialPatterns = [
      /^(id|ID|_id)$/i,
      /name/i,
      /title/i,
      /type/i,
      /status/i,
      /state/i,
      /price/i,
      /amount/i,
      /count/i,
      /number/i,
      /date/i,
      /time/i,
      /url/i,
      /code/i,
    ];

    // Goal-specific patterns (extract keywords from goal)
    const goalKeywords = goal.toLowerCase().match(/[\u4e00-\u9fa5a-z]+/g) || [];
    const goalPatterns = goalKeywords.map(kw => new RegExp(kw, 'i'));

    // Analyze fields from samples
    const fieldStats = new Map<string, { count: number; hasValue: number; avgLength: number }>();

    for (const item of samples) {
      if (typeof item !== 'object' || item === null) continue;

      for (const [key, value] of Object.entries(item)) {
        if (!fieldStats.has(key)) {
          fieldStats.set(key, { count: 0, hasValue: 0, avgLength: 0 });
        }
        const stats = fieldStats.get(key)!;
        stats.count++;

        if (value !== null && value !== undefined && value !== '') {
          stats.hasValue++;
          const strValue = typeof value === 'string' ? value : JSON.stringify(value);
          stats.avgLength += strValue.length;
        }
      }
    }

    // Calculate average lengths
    for (const [key, stats] of fieldStats.entries()) {
      if (stats.hasValue > 0) {
        stats.avgLength = Math.round(stats.avgLength / stats.hasValue);
      }
    }

    // Select essential fields based on multiple criteria
    for (const [key, stats] of fieldStats.entries()) {
      // Skip if field is rarely populated
      if (stats.hasValue < sampleSize * 0.3) continue;

      // Skip if field contains very long text (likely descriptions)
      if (stats.avgLength > 200) continue;

      // Include if matches essential patterns
      if (essentialPatterns.some(pattern => pattern.test(key))) {
        essential.add(key);
        continue;
      }

      // Include if matches goal keywords
      if (goalPatterns.some(pattern => pattern.test(key))) {
        essential.add(key);
        continue;
      }

      // Include if field name is short and well-populated
      if (key.length <= 15 && stats.hasValue === sampleSize) {
        essential.add(key);
      }
    }

    // Limit to max 15 fields to prevent data explosion
    if (essential.size > 15) {
      // Prioritize fields by importance score
      const scored = Array.from(essential).map(key => {
        const stats = fieldStats.get(key)!;
        let score = 0;

        // Higher score for well-populated fields
        score += (stats.hasValue / sampleSize) * 10;

        // Higher score for essential patterns
        if (essentialPatterns.some(p => p.test(key))) score += 20;

        // Higher score for goal-related fields
        if (goalPatterns.some(p => p.test(key))) score += 15;

        // Lower score for longer field names (often less important)
        score -= key.length * 0.5;

        return { key, score };
      });

      scored.sort((a, b) => b.score - a.score);
      return new Set(scored.slice(0, 15).map(s => s.key));
    }

    // If no essential fields detected, keep first 10 fields
    if (essential.size === 0 && items.length > 0) {
      const firstItem = items[0];
      if (typeof firstItem === 'object' && firstItem !== null) {
        const keys = Object.keys(firstItem).slice(0, 10);
        return new Set(keys);
      }
    }

    return essential;
  }

  /**
   * Keep only essential fields from an object
   */
  private keepEssentialFields(item: any, essentialFields: Set<string>): any {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return item;
    }

    const simplified: any = {};
    for (const key of essentialFields) {
      if (key in item) {
        simplified[key] = item[key];
      }
    }

    return simplified;
  }
}
