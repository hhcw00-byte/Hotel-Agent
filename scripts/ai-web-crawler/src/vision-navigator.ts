/**
 * Vision Navigator
 * Uses multimodal LLM to analyze page screenshots and decide navigation strategy.
 * Maintains a multi-turn conversation so the model has full context of past actions.
 */

import { AgentClient } from './agent-client';
import { NavigationAnalysis, NavigationContext, CompletenessCheck, Message, MessageContent } from './types';
import { LLMConfig } from './config-types';
import { ScreenshotManager } from './screenshot-manager';

// ----------------------------------------------------------------
// System prompt — mirrors the reference project's NAV_SYSTEM_PROMPT
// ----------------------------------------------------------------
const NAV_SYSTEM_PROMPT = `你是一个网页视觉分析和导航专家。你的任务是通过分析页面截图，一步步导航到用户指定的目标页面。

每一轮你会收到当前页面的截图，你需要判断是否已到达目标，如果没到则给出下一步操作。

**判断"到达"的原则（严格遵守）：**
- "到达"意味着页面的【主内容区域】正在展示目标功能的详细数据、列表、表格或操作界面
- 以下情况【不算到达】：
  · 页面是首页/仪表盘/概览页，目标只是其中一个统计卡片或摘要模块
  · 目标只出现在侧边栏菜单、顶部导航栏中，但主内容是其他功能
  · 已进入目标相关页面，但主内容区域是空的，而有其他子标签页可能包含数据
  · **🚨 搜索结果列表页（显示多个酒店/商品的列表）不算到达，必须点击进入具体的详情页**
  · **🚨 如果 navigation_hint 中明确要求"进入详情页"，则搜索结果页绝对不算到达**
- 以下情况【算到达】：
  · 页面主内容区域完全是目标的专属界面，且有实际数据可供提取
  · **酒店/商品详情页：显示单个酒店/商品的完整信息（房型、价格、评价等）**

**可选操作：**
- click: 点击元素（element_text 可以是以下任意一种）：
  · 页面上实际显示的文字（一字不差）
  · 元素的 aria-label 属性值（适用于纯图标按钮）
  · 元素的 CSS class 名（如 "nav-icon-home"，适用于无文字无aria-label的图标）
  · SVG 图标的 selector 值（如 "icon-dashboard"，去掉 # 号）
- input: 在输入框中输入文字（需要指定 input_placeholder 和 input_text）：
  · input_placeholder: 输入框的占位符文字（如"请输入酒店名称"）或 aria-label
  · input_text: 要输入的内容（如"如家酒店"）
- scroll: 滚动页面（指定 scroll_direction: down 或 up）
- wait: 等待页面加载
- not_found: 找不到任何相关入口

**JSON 格式要求（严格遵守）：**

🚨 CRITICAL: reason 字段长度限制 🚨
- **reason 必须 ≤20 个汉字（或 ≤40 个英文字符）**
- 超过此长度会导致 JSON 解析失败，整个导航会中断
- 使用简短、精炼的描述，例如："点击菜单"、"未找到目标"、"页面已到达"

其他格式要求：
- reason 字段必须使用英文双引号包裹
- reason 内容不能包含换行符、双引号、反斜杠等特殊字符
- 如果 reason 中需要引用文字，使用单引号或不加引号
- confidence 字段必须是0.0到1.0之间的数字，不能省略

错误示例（会导致解析失败）：
{"reached": false, "action": "not_found", "reason": "多次点击评价管理菜单及子菜单均无响应主内容区仍为工作台可能需要其他方式进入", "confidence":
问题：reason太长（超过20字），导致输出被截断

正确示例：
{"reached": false, "action": "not_found", "reason": "多次点击无效", "confidence": 0.0}

**如何使用 selector：**
当 DOM 元素列表显示 selector="xxx" 格式时：
1. 这是图标元素的唯一标识符（通常是 SVG 图标）
2. 直接将引号中的值作为 element_text 返回，例如：
   - DOM 显示：selector="icon-example" (floating-icon)
   - 你应返回："element_text": "icon-example"
3. 不要返回 selector= 前缀，不要返回引号
4. 不要返回 position fallback 的 selector（如 "icon-中部右侧"），这些是无效的
5. reason 字段中不要使用引号，避免 JSON 解析错误

**点击目标选择优先级（严格遵守）：**
1. 🥇 最优先：如果需要搜索才能到达目标，必须先在输入框输入内容，再点击搜索按钮
2. 🥈 其次：导航菜单栏、侧边栏中的菜单项/链接（nav-menu 类型）
3. 标签页切换按钮
4. DOM 列表中 floating-icon 类型的 selector（右侧悬浮图标）
5. 避免点击统计卡片、数据摘要区域中的标题文字
6. 不要选择 position fallback 的 selector（如 "icon-中部右侧"、"icon-顶部右侧"）

**搜索场景特殊规则（重要）：**

如果目标需要搜索特定内容（如酒店名称、地点等），必须按以下顺序操作：
1. 第一步：**检查是否需要切换标签页** — 如果 DOM 列表中有"酒店"、"火车票"等标签，且目标与该标签相关，必须先点击该标签
2. 第二步：在搜索输入框输入目标关键词（使用 input 操作）
3. 第三步：点击搜索按钮（使用 click 操作）
4. 第四步：等待搜索结果加载

🚫 绝对不要在输入框为空时点击搜索按钮

**⚠️ 标签页切换规则（非常重要）：**
- 如果 DOM 导航列表中出现"机票"、"酒店"、"火车票"等标签，说明页面有多个业务标签
- 如果你的目标是"搜索酒店"，但当前可能在"机票"标签，**必须先点击"酒店"标签**
- 标签切换后，页面会显示对应的搜索表单，此时才能进行输入操作
- 判断依据：如果 input 操作失败（找不到输入框或输入框不可见），检查 DOM 列表中是否有相关标签未点击

**搜索框选择优先级（严格遵守）：**

页面上通常有多个搜索框，必须按以下优先级选择：

1. 🥇 **最优先：页面主体区域（屏幕中部）的专用搜索框**
   - 通常是页面中央的大型搜索表单，专门用于搜索酒店/目的地
   - 例如：飞猪、携程、美团等OTA平台首页中间的搜索区域
   - 这类搜索框通常有"关键词"、"酒店名称"、"位置/品牌/酒店"等占位符
   - 搜索结果更精准，直接定位到目标酒店

2. 🥈 **次选：顶部导航栏的全局搜索框**
   - 位于页面最顶部的搜索框（通常有"目的地/酒店/景点/签证等"占位符）
   - 仅在页面中部没有专用搜索框时才使用
   - 这类搜索框是全站搜索，结果可能不够精准

3. 🚫 **避免：侧边栏、筛选栏中的搜索框**
   - 这些通常是在已有结果列表中进行二次筛选，不适合初始搜索

如果看到"目的地"、"酒店名称"、"关键词"、"位置/品牌/酒店"等输入框，且 navigation_hint 中提到需要输入内容，必须先执行 input 操作。

**⚠️ 重要：DOM 输入框列表中的 "text输入框" 说明该输入框没有 placeholder，需要根据位置判断用途：**
- 位置在"中部左侧"的 text输入框 → 通常是"目的地/城市"输入框
- 位置在"中部中部"的 text输入框 → 通常是"关键词/酒店名称"输入框（优先使用）
- 位置在"顶部中部"且有明确 placeholder 的 → 全局搜索框（最后才用）

**输入框选择错误重试规则（重要）：**

问题场景：页面上可能有多个搜索输入框，例如公网酒店预订页面通常有：
- "目的地"输入框：用于输入城市、地区
- "酒店名称"/"关键词"输入框：用于输入具体酒店名称（优先使用）
- 顶部全局搜索框：全站搜索（最后才用）

重试逻辑：如果在某个输入框输入内容后，点击搜索按钮没有得到预期结果（如搜索结果为空、页面无变化），说明可能选择了错误的输入框。

此时应该：
1. 仔细观察截图，查找页面上的其他输入框
2. 尝试在另一个输入框中输入相同的内容
3. 再次点击搜索按钮

常见错误：
- 在"目的地"输入框输入了酒店名称 → 应该使用"酒店名称"输入框
- 在"关键词搜索"输入框输入了地点 → 应该使用"地点"输入框

判断标准：
- 如果搜索后页面显示"未找到结果"、"无匹配项"等提示
- 如果搜索后页面完全没有变化
- 如果搜索结果明显不符合预期

→ 立即尝试页面上的其他输入框

**子菜单处理规则（重要）：**

- 如果点击某个菜单项后，DOM 列表中出现了该菜单的子项，说明菜单已展开
- 此时应该点击子菜单项进入具体页面，而不是继续点击父菜单
- 判断方法：如果DOM列表中同一个名称出现多次，且位置不同，优先点击更靠近内容区域的那个

**重要：你可以看到之前所有步骤的截图和操作结果，请利用这些上下文避免重复操作，做出更准确的判断。**

返回 JSON 格式（只返回 JSON，不要加 markdown 代码块）：

🚨 重要：reason 字段必须 ≤20 汉字，使用简短描述！

已到达：{"reached": true, "reason": "页面已到达", "confidence": 0.9}
点击：{"reached": false, "action": "click", "element_text": "文字", "reason": "点击菜单", "confidence": 0.8}
靠近某元素点击：{"reached": false, "action": "click_near", "near_text": "者行孙三里屯", "near_action": "查看详情", "reason": "点击目标酒店详情", "confidence": 0.9}
输入：{"reached": false, "action": "input", "input_placeholder": "占位符", "input_text": "内容", "reason": "输入搜索词", "confidence": 0.8}
滚动：{"reached": false, "action": "scroll", "scroll_direction": "down", "reason": "查看更多", "confidence": 0.7}
等待：{"reached": false, "action": "wait", "reason": "等待加载", "confidence": 0.6}
选日期：{"reached": false, "action": "select_date", "date_text": "2026-03-18", "date_field_type": "checkin", "reason": "选入住日期", "confidence": 0.8}
找不到：{"reached": false, "action": "not_found", "reason": "未找到入口", "confidence": 0.0}

**搜索结果列表中点击特定酒店（重要）：**
- **🚨 关键规则：搜索结果列表页不是目标页面，必须点击进入详情页**
- 当搜索结果列表中有多个酒店，且每个酒店都有"查看详情"按钮时，必须使用 click_near 操作
- near_text 填写目标酒店名称（或名称的关键词），near_action 填写要点击的按钮文字（如"查看详情"）
- 不要用普通 click 点击"查看详情"，那样会点到第一个结果而不是目标酒店
- **判断标准：如果页面显示多个酒店卡片/列表项，说明这是搜索结果页，必须继续点击进入详情**
- **只有当页面主内容区域显示单个酒店的完整信息（房型列表、价格、设施、评价等）时，才算到达**

**日历选日期规则（重要）：**
- 当页面弹出日历控件（显示月份和日期格子）时，使用 select_date 操作
- date_text 必须填写完整日期，格式为 "YYYY-MM-DD"，如 "2026-03-18"、"2026-04-05"
- 🚨 不要只填日期数字（如 "9"、"15"），必须包含年月日，否则会点错月份的日期
- 根据日历上显示的年月信息确定完整日期，例如日历显示"2026年3月"，要选18号，则填 "2026-03-18"
- date_field_type 填写 "checkin"（入住）或 "checkout"（离店）
- 不要用 click 操作点击日期数字，必须用 select_date
- 如果日历未弹出，先用 click 点击"入住日期"或"离店日期"输入框触发日历`;

export class VisionNavigator {
  private agentClient: AgentClient;
  private navMessages: Message[] = [];
  private navInitialized = false;

  constructor(llmConfig: LLMConfig) {
    this.agentClient = new AgentClient(llmConfig);
  }

  // ----------------------------------------------------------------
  // Session management
  // ----------------------------------------------------------------

  resetNavigation(): void {
    this.navMessages = [];
    this.navInitialized = false;
  }

  private initNavigation(target: string, hint?: string, extractionGoal?: string): void {
    let systemContent = NAV_SYSTEM_PROMPT + `\n\n**本次导航目标：${target}**`;
    if (hint) systemContent += `\n额外提示：${hint}`;
    if (extractionGoal) systemContent += `\n最终数据提取目标：${extractionGoal}`;

    this.navMessages = [{ role: 'system', content: systemContent }];
    this.navInitialized = true;
  }

  /**
   * Append feedback about the last action (text-only, no screenshot).
   * Call this AFTER executing the action and BEFORE the next analyzePage call.
   */
  addStepFeedback(actionTaken: string, success: boolean, newUrl: string = '', extraInfo: string = ''): void {
    const parts: string[] = [];
    parts.push(success ? `操作执行成功：${actionTaken}` : `操作执行失败：${actionTaken}`);
    if (newUrl) parts.push(`当前页面URL: ${newUrl}`);
    if (extraInfo) parts.push(extraInfo);

    this.navMessages.push({ role: 'user', content: parts.join('\n') });
  }

  // ----------------------------------------------------------------
  // Core analysis — multi-turn conversation
  // ----------------------------------------------------------------

  /** Maximum number of screenshots to keep as images in history.
   *  Older screenshots are replaced with "[截图已省略]" text to save tokens. */
  private static readonly MAX_HISTORY_IMAGES = 2;

  async analyzePage(
    screenshot: Buffer,
    context: NavigationContext,
    domHints?: string,
  ): Promise<NavigationAnalysis> {
    if (!this.navInitialized) {
      this.initNavigation(context.target, context.hint);
    }

    // Compress screenshot for LLM (resize to max 1280px, quality 60)
    const compressed = await ScreenshotManager.compressForLLM(screenshot);
    const imageUrl = this.agentClient.encodeImage(compressed, 'image/jpeg');
    const stepNumber = this.navMessages.filter(m => m.role === 'assistant').length + 1;
    
    let stepText = `第${stepNumber}步：这是当前页面截图，请分析是否已到达目标，如果没到请给出下一步操作。`;
    
    // 🔥 强调navigation_hint的要求
    if (context.hint && context.hint.includes('详情页')) {
      stepText += `\n\n🚨 **关键要求：** ${context.hint}\n**判断标准：只有进入详情页（显示单个酒店的完整信息）才算到达，搜索结果列表页不算到达！**`;
    }
    
    // Add DOM hints if provided
    if (domHints) {
      stepText += `\n\n**页面上检测到的可交互元素：**\n${domHints}\n\n**重要：**\n- 点击左侧菜单项时，将 element_text 设为菜单文字\n- 点击内容区标签页时，将 element_text 设为标签文字（如"同行分析"）\n- 点击图标元素时，将 selector 值（引号中的内容）作为 element_text 返回`;
    }

    // Before appending new screenshot, evict oldest screenshots beyond limit.
    // This prevents token explosion from accumulated base64 images.
    this.evictOldScreenshots();

    // Append current screenshot as user message
    this.navMessages.push({
      role: 'user',
      content: [
        { type: 'text', text: stepText },
        { type: 'image_url', image_url: { url: imageUrl } },
      ],
    });

    try {
      const response = await this.agentClient.call(this.navMessages, { maxTokens: 4096, temperature: 0 });

      // Append assistant reply to maintain context
      this.navMessages.push({ role: 'assistant', content: response.content });

      return this.parseNavResponse(response.content);
    } catch (error) {
      return {
        reached: false,
        confidence: 0,
        reasoning: `分析失败: ${error}`,
        nextAction: { type: 'not_found' },
      };
    }
  }

  /**
   * Evict old screenshots from navMessages history.
   * Keeps only the most recent MAX_HISTORY_IMAGES screenshots as images,
   * replacing older ones with a text placeholder to save LLM tokens.
   */
  private evictOldScreenshots(): void {
    // Find all user messages that contain image_url parts (indices in navMessages)
    const imageMessageIndices: number[] = [];
    for (let i = 0; i < this.navMessages.length; i++) {
      const msg = this.navMessages[i];
      if (msg.role === 'user' && Array.isArray(msg.content)) {
        const hasImage = (msg.content as MessageContent[]).some(p => p.type === 'image_url');
        if (hasImage) {
          imageMessageIndices.push(i);
        }
      }
    }

    // If we have more image messages than the limit, replace oldest ones
    const excess = imageMessageIndices.length - VisionNavigator.MAX_HISTORY_IMAGES;
    if (excess > 0) {
      for (let k = 0; k < excess; k++) {
        const idx = imageMessageIndices[k];
        const msg = this.navMessages[idx];
        if (Array.isArray(msg.content)) {
          // Extract text parts and drop image parts
          const textParts = (msg.content as MessageContent[])
            .filter(p => p.type === 'text')
            .map(p => p.text || '');
          const combinedText = textParts.join('\n') + '\n[截图已省略，请参考后续截图判断]';
          this.navMessages[idx] = { role: 'user', content: combinedText };
        }
      }
    }
  }

  // ----------------------------------------------------------------
  // Coordinate fallback — ask Gemini to locate an element by vision
  // Called when DOM-based click fails (element not found in DOM)
  // ----------------------------------------------------------------

  /**
   * Ask the LLM to find the pixel coordinate of a target element in a
   * **viewport** screenshot (fullPage=false).  Returns {x, y} in viewport
   * pixels, or null if the element cannot be located.
   *
   * This is a one-shot request that does NOT touch the nav conversation
   * history, so it never pollutes the navigation context.
   */
  async askForCoordinate(
    viewportScreenshot: Buffer,
    targetText: string,
  ): Promise<{ x: number; y: number } | null> {
    const prompt =
      `页面上有一个元素，文字或描述为："${targetText}"。\n` +
      `请在截图中找到它，返回它中心点的像素坐标。\n\n` +
      `规则：\n` +
      `- 截图是浏览器 viewport 的截图（非全页面），坐标从左上角 (0,0) 开始\n` +
      `- 只返回 JSON，不要加任何说明文字或 markdown 代码块\n` +
      `- 找到了：{"x": 123, "y": 456, "confidence": 0.9}\n` +
      `- 找不到：{"x": null, "y": null, "confidence": 0.0}`;

    const compressed = await ScreenshotManager.compressForLLM(viewportScreenshot);
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

    try {
      const response = await this.agentClient.call(messages, { maxTokens: 512, temperature: 0 });
      const json = this.extractJson(response.content);
      const parsed = JSON.parse(json);

      if (
        typeof parsed.x === 'number' &&
        typeof parsed.y === 'number' &&
        parsed.x > 0 &&
        parsed.y > 0
      ) {
        console.error(
          `[coord-fallback] Gemini located "${targetText}" at (${parsed.x}, ${parsed.y}) confidence=${parsed.confidence}`,
        );
        return { x: Math.round(parsed.x), y: Math.round(parsed.y) };
      }

      console.error(`[coord-fallback] Gemini could not locate "${targetText}" in screenshot`);
      return null;
    } catch (error) {
      console.error(`[coord-fallback] Failed to get coordinate from Gemini:`, error);
      return null;
    }
  }

  // ----------------------------------------------------------------
  // Page completeness check (independent — does not use nav context)
  // ----------------------------------------------------------------

  async checkCompleteness(screenshot: Buffer): Promise<CompletenessCheck> {
    const prompt = `你是一个网页内容完整性分析专家。请分析这个页面截图，判断页面内容是否已完整展示。

🔥🔥🔥 **房价日历检测规则（最高优先级）：**

**第一步：识别页面类型**
- 仔细观察截图，是否看到"房价日历"、"价格日历"、"房量日历"等标题？
- 是否看到左侧有房型名称列表（如"豪华静谧单人间"、"小町轻经济房"、"标准双人间"等）？
- 是否看到右侧有日期表格（显示日期如"1日"、"2日"等）？

**第二步：检查房型展开状态**
如果是房价日历页面，必须检查：
1. 左侧房型名称旁边是否有箭头图标（▶ 表示折叠，▼ 表示展开）
2. 右侧日历表格中，每个房型对应的行是否显示了具体价格数字（如"¥299"、"588"等）
3. **关键判断：如果只看到房型名称，但日历区域没有对应的价格数字，说明该房型是折叠状态**

**第三步：返回结果**
- 如果所有房型都已展开（日历中可以看到每个房型的价格数字）→ isComplete=true
- 如果有任何房型未展开（只有名称，没有价格）→ isComplete=false，并列出所有未展开的房型名称

**其他检查要点：**
1. 是否有"展示更多"、"加载更多"、"查看全部"、"展开"、"更多"等可展开按钮
2. 是否有折叠的下拉菜单、手风琴面板、折叠列表需要展开
3. 是否有分页器显示还有更多页的数据未加载
4. 是否有需要向下滚动才能看到的内容

返回 JSON（只返回 JSON，不要加 markdown 代码块）：

内容完整：{"isComplete": true, "confidence": 0.9, "expandableElements": []}
需要展开房型：{"isComplete": false, "confidence": 0.9, "expandableElements": [{"type": "accordion", "text": "豪华静谧单人间", "action": "click"}, {"type": "accordion", "text": "小町轻经济房", "action": "click"}]}
需要点击按钮：{"isComplete": false, "confidence": 0.8, "expandableElements": [{"type": "button", "text": "按钮文字", "action": "click"}]}
需要滚动：{"isComplete": false, "confidence": 0.8, "expandableElements": [{"type": "scroll", "text": "向下滚动", "action": "scroll"}]}`;

    // Compress screenshot for LLM
    const compressed = await ScreenshotManager.compressForLLM(screenshot);
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

    try {
      const response = await this.agentClient.call(messages, { maxTokens: 512, temperature: 0 });
      return this.parseCompletenessResponse(response.content);
    } catch (error) {
      return { isComplete: true, confidence: 0.5, expandableElements: [] };
    }
  }

  // ----------------------------------------------------------------
  // Parsers
  // ----------------------------------------------------------------

  private parseNavResponse(content: string): NavigationAnalysis {
    try {
      const json = this.extractJson(content);
      const parsed = JSON.parse(json);

      const reached = parsed.reached === true;
      const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0.5;

      if (reached) {
        return { reached: true, confidence, reasoning: parsed.reason || '' };
      }

      const action = parsed.action || 'not_found';
      return {
        reached: false,
        confidence,
        reasoning: parsed.reason || '',
        nextAction: {
          type: action === 'click' ? 'click'
              : action === 'input' ? 'input'
              : action === 'scroll' ? 'scroll'
              : action === 'wait'  ? 'wait'
              : action === 'select_date' ? 'select_date'
              : action === 'click_near' ? 'click_near'
              : 'not_found',
          elementText: parsed.element_text,
          direction: parsed.scroll_direction as 'up' | 'down' | undefined,
          inputText: parsed.input_text,
          inputPlaceholder: parsed.input_placeholder,
          dateText: parsed.date_text,
          dateFieldType: parsed.date_field_type,
          nearText: parsed.near_text,
          nearAction: parsed.near_action,
        },
      };
    } catch (error) {
      return {
        reached: false,
        confidence: 0,
        reasoning: `解析失败: ${error} | 原始: ${content.slice(0, 200)}`,
        nextAction: { type: 'not_found' },
      };
    }
  }

  private parseCompletenessResponse(content: string): CompletenessCheck {
    try {
      const json = this.extractJson(content);
      const parsed = JSON.parse(json);
      return {
        isComplete: parsed.isComplete !== false,
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.8,
        expandableElements: parsed.expandableElements || [],
      };
    } catch {
      return { isComplete: true, confidence: 0.5, expandableElements: [] };
    }
  }

  private extractJson(text: string): string {
    // Strip <think>...</think> tags (some models)
    text = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    // Strip markdown code fences
    text = text.replace(/^```(?:json)?\s*/m, '').replace(/\s*```$/m, '').trim();

    // If doesn't start with {, try to find the first JSON object
    if (!text.startsWith('{')) {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        text = match[0];
      } else {
        // No complete JSON object found, try to find opening brace
        const braceIdx = text.indexOf('{');
        if (braceIdx !== -1) {
          text = text.substring(braceIdx);
        }
      }
    }

    // Remove any trailing text after the last }
    const lastBrace = text.lastIndexOf('}');
    if (lastBrace !== -1 && lastBrace < text.length - 1) {
      text = text.substring(0, lastBrace + 1);
    }

    // If already valid JSON, return immediately
    try {
      JSON.parse(text);
      return text;
    } catch (e) {
      // Continue with repair
    }

    // 🔥 Truncated JSON repair: try progressive fixes, verify each with JSON.parse
    // Strategy 1: Append } (truncated after a complete value, e.g. ..."confidence": 0.9)
    try {
      JSON.parse(text + '}');
      return text + '}';
    } catch (e) {}

    // Strategy 2: Close an unterminated string value, then close object
    // e.g. "reason": "some text  →  "reason": "some text"}
    try {
      JSON.parse(text + '"}');
      return text + '"}';
    } catch (e) {}

    // Strategy 3: Remove the last incomplete key-value pair by truncating at the last comma
    // Walk the string to find comma positions outside of string literals
    const commaPositions: number[] = [];
    let inString = false;
    let escaped = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (!inString && ch === ',') {
        commaPositions.push(i);
      }
    }

    // Try removing from the last comma backwards until we get valid JSON
    for (let i = commaPositions.length - 1; i >= 0; i--) {
      const truncated = text.substring(0, commaPositions[i]) + '}';
      try {
        JSON.parse(truncated);
        return truncated;
      } catch (e) {}
    }

    // Nothing worked, return original text and let JSON.parse handle the error
    return text;
  }
}
