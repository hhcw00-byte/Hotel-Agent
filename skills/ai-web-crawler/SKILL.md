---
name: ai-web-crawler
description: API发现工具。通过视觉导航到达目标页面，拦截页面的HTTP API请求，返回候选API列表。爬虫的目标不是提取页面数据，而是发现页面背后的数据API接口。支持list_tabs(列出标签页)、switch_tab(切换标签页)、fetch_data(导航到目标页面并拦截API)。这是访问用户浏览器的唯一工具。
script: scripts/ai-web-crawler/dist/index.js
type: tool
user-invocable: false
allowed-tools: []
parameters:
  operation:
    type: string
    description: "操作类型：fetch_data(导航到目标页面并拦截API请求)、list_tabs(列出所有标签页)、switch_tab(切换到指定标签页)、extract_current(不导航，直接提取当前页面内容)"
    required: true
    enum: [fetch_data, list_tabs, switch_tab, extract_current]
  tab_keyword:
    type: string
    description: |
      浏览器标签页匹配关键词，用于自动切换到目标标签页。匹配标题或URL中包含的文字，如"美团"、"taobao"、"booking"。
      
      **重要规则：**
      - 在 switch_tab 操作中为必填参数
      - 在 fetch_data 操作中，如果浏览器有多个标签页打开，则必须提供此参数以明确要操作的标签页
      - 建议在 fetch_data 前先调用 list_tabs 查看可用标签页，然后根据目标选择正确的 tab_keyword
    required: false
  target:
    type: string
    description: 导航目标页面描述，如"房态管理"、"商品价格"、"订单列表"、"用户评价"。仅在 fetch_data 操作中使用。
    required: false
  extraction_goal:
    type: string
    description: 数据提取目标描述，如"商品价格和库存"、"用户评价和评分"、"近7天订单数据"。不填则默认与 target 相同。仅在 fetch_data 操作中使用。
    required: false
  navigation_hint:
    type: string
    description: 导航提示，帮助更快找到目标页面。仅在 fetch_data 操作中使用。
    required: false
  browser_port:
    type: number
    description: 浏览器调试端口，默认 9222
    required: false
  max_steps:
    type: number
    description: 最大导航步数，默认 20。仅在 fetch_data 操作中使用。
    required: false
  max_expand_steps:
    type: number
    description: 最大内容展开步数，默认 3。仅在 fetch_data 操作中使用。
    required: false
  intercept_apis:
    type: boolean
    description: |
      是否启用API拦截模式。启用后，爬虫在导航过程中会拦截所有HTTP API请求，经过三层技术过滤后返回候选API列表。
      
      **返回结果中会额外包含 `apiCandidates` 字段：**
      每个候选API包含：url、method、requestHeaders、requestBody、responsePreview（前500字符）、responseSize、contentType、statusCode。
      
      **使用场景：** 当你需要发现某个页面背后的数据API时使用。发现API后，可以通过 file-operations 工具生成HTTP请求脚本，后续直接调API获取数据，无需再走页面爬取。
      
      仅在 fetch_data 操作中使用，默认 false。
    required: false
---

# API 发现工具

通过 Playwright 浏览器自动化 + 多模态大模型视觉导航，自动导航到任意网站的目标页面，拦截页面加载过程中的所有 HTTP API 请求，返回候选 API 列表。

**核心定位：爬虫的目标不是提取页面数据，而是发现页面背后的数据 API 接口。**

发现 API 后，由 Agent 通过 `file-operations` 工具生成 HTTP 请求脚本，后续直接调 API 获取数据。

## 核心功能

### 1. list_tabs - 列出标签页
列出当前浏览器中所有打开的标签页。

### 2. switch_tab - 切换标签页
切换到指定的标签页。

### 3. extract_current - 提取当前页面内容
不导航，直接提取用户当前打开页面的内容。适用于用户已手动打开目标页面的场景（如评价页、消息页）。

```json
{
  "operation": "extract_current",
  "extraction_goal": "提取页面中所有可见的评价内容"
}
```

如果有多个标签页，需要指定 `tab_keyword` 明确要提取哪个标签页。

### 4. fetch_data - 导航到目标页面并拦截 API
通过视觉导航到达目标页面，同时拦截所有 HTTP API 请求。返回结果中包含：
- `data`：DOM 提取的页面数据（仅供参考，不作为最终数据源）
- `apiCandidates`：拦截到的候选 API 列表（**这才是核心输出**）

**⚠️ 重要：fetch_data 必须始终带 `intercept_apis: true`。返回结果中重点关注 `apiCandidates` 字段，忽略 `data` 字段。**

**调用示例：**
```json
{
  "operation": "fetch_data",
  "tab_keyword": "me.meituan.com",
  "target": "产品管理 > 房价房量日历",
  "intercept_apis": true
}
```

**返回的 apiCandidates 示例：**
```json
[
  {
    "url": "https://me.meituan.com/api/gw/v1/product/goods/queryPriceInventoryStatusInfo",
    "method": "POST",
    "requestHeaders": { "Content-Type": "application/json", ... },
    "requestBody": "{\"partnerId\":4919541}",
    "responsePreview": "{\"code\":0,\"data\":{\"rooms\":[...",
    "responseSize": 25274,
    "contentType": "application/json",
    "statusCode": 200
  }
]
```

**如何选择目标 API：**
- 根据当前任务目标，分析每个API的url路径和responsePreview内容，选择与任务最相关的API
- URL 路径包含业务关键词（price、inventory、room、order 等）优先
- `statusCode` 为 200
- `method` 为 POST 的通常是数据查询接口
- 不要盲目选择responseSize最大的，要根据responsePreview判断数据是否匹配任务目标

## 参数说明

**tab_keyword（标签页匹配关键词）：**
- 同时匹配标签页的标题和URL（不区分大小写）
- 当同一平台有多个系统时，使用URL片段精确区分（如 `me.meituan.com` vs `pms.meituan.com`）
- 建议先调用 `list_tabs` 查看可用标签页，再选择合适的关键词

**target（导航目标）：**
- 描述要访问的页面，如"评价管理"、"房态管理"、"订单列表"

**extraction_goal（提取目标）：**
- 描述要提取的数据，如"未回复的客户评价"、"今日房态数据"
- 不填则默认与target相同

**navigation_hint（导航提示）：**
- 可选，帮助爬虫更快找到目标页面的提示信息
- 对于需要搜索的场景（如搜索酒店名称），在此参数中明确说明要搜索的内容

## 搜索场景使用指南

当目标页面需要通过搜索才能到达时（如外网查询竞品酒店价格），请遵循以下规则：

### 基本搜索流程

在 `navigation_hint` 中明确说明需要搜索的内容，爬虫会自动：
1. 识别页面上的搜索输入框
2. 在输入框中输入指定内容
3. 点击搜索按钮
4. 等待搜索结果加载

**示例：**
```json
{
  "operation": "fetch_data",
  "tab_keyword": "ctrip",
  "target": "酒店详情页",
  "extraction_goal": "提取XX酒店的房价信息",
  "navigation_hint": "需要搜索酒店。在搜索框输入'XX酒店'，点击搜索后进入该酒店详情页。"
}
```

### 多个搜索框的处理

**问题场景：**
外网酒店预订页面通常有多个搜索输入框，例如：
- "目的地"输入框：用于输入城市、地区
- "酒店名称"输入框：用于输入具体酒店名称

**解决方案：**
如果第一次搜索没有结果（选错了输入框），爬虫会自动：
1. 识别页面上的其他输入框
2. 在另一个输入框中重新输入相同内容
3. 再次点击搜索按钮

**最佳实践：**
在 `navigation_hint` 中明确指定应该使用哪个输入框：

```json
{
  "navigation_hint": "需要搜索酒店名称。优先使用'酒店名称'输入框（而不是'目的地'输入框），输入'XX酒店'，点击搜索。"
}
```

### 常见搜索场景

**场景1：搜索竞品酒店**
```json
{
  "operation": "fetch_data",
  "tab_keyword": "ctrip",
  "target": "酒店详情页",
  "extraction_goal": "提取孙团结湖店的房价",
  "navigation_hint": "在搜索框输入'孙团结湖店'，点击搜索后进入该酒店详情页。如果有多个输入框，优先使用'酒店名称'输入框。"
}
```

**场景2：搜索区域内酒店**
```json
{
  "operation": "fetch_data",
  "tab_keyword": "meituan",
  "target": "酒店搜索结果列表",
  "extraction_goal": "提取朝阳区商圈内同档次酒店的价格",
  "navigation_hint": "在搜索框输入'北京朝阳区酒店'，筛选条件选择'四星级'，获取搜索结果列表。"
}
```

### 搜索失败排查

如果搜索操作失败，可能的原因：
1. **输入框识别错误**：页面有多个输入框，选择了错误的输入框
   - 解决：在 `navigation_hint` 中明确指定输入框类型
2. **搜索按钮未点击**：输入内容后没有触发搜索
   - 解决：确保 `navigation_hint` 中提到"点击搜索"
3. **搜索结果加载慢**：搜索后页面还在加载
   - 解决：爬虫会自动等待，无需额外处理

## API 拦截模式（intercept_apis）

当 `intercept_apis=true` 时，爬虫在导航到目标页面的过程中会拦截所有HTTP请求，经过技术过滤后返回候选API列表。

### 使用流程

1. 调用 `fetch_data` 并设置 `intercept_apis: true`
2. 爬虫正常导航到目标页面，同时在后台拦截所有HTTP API请求
3. 返回结果中除了正常的提取数据外，还包含 `apiCandidates` 字段
4. 分析候选API列表，根据URL和响应预览判断哪个API包含目标数据
5. 使用 `file-operations` 工具生成HTTP请求脚本和对应的SKILL.md
6. 后续直接调用生成的API脚本获取数据，无需再走页面爬取

### 调用示例

```json
{
  "operation": "fetch_data",
  "tab_keyword": "me.meituan.com",
  "target": "房价管理",
  "extraction_goal": "提取房价数据",
  "intercept_apis": true
}
```

### 返回结果示例

```json
{
  "success": true,
  "data": { ... },
  "apiCandidates": [
    {
      "url": "https://me.meituan.com/api/room/price/list",
      "method": "POST",
      "requestHeaders": { "Content-Type": "application/json", ... },
      "requestBody": "{\"hotelId\":12345}",
      "responsePreview": "{\"code\":0,\"data\":{\"rooms\":[{\"name\":\"豪华大床房\",\"price\":399...",
      "responseSize": 4523,
      "contentType": "application/json",
      "statusCode": 200
    }
  ]
}
```

### API脚本生成规范

发现有价值的API后，使用 `file-operations` 工具生成脚本：

1. **脚本文件**：`scripts/api-{platform}-{dataType}/index.js`
   - 使用 `require('../api-runtime')` 导入运行时库
   - Cookie 通过 `runtime.getCookies()` 获取（运行时自动注入，不要硬编码）
   - 请求头从拦截结果中提取，作为模板写入脚本
   - 输出使用 `runtime.output(data)` 或 `runtime.outputError(code, msg)`

2. **SKILL.md文件**：`skills/api-{platform}-{dataType}/SKILL.md`
   - 包含 name、description、script路径、type、parameters
   - description 中说明数据来源平台和数据类型
   - `cookieDomain` 参数必须声明（系统用它注入Cookie）
   - parameters 中只声明脚本里通过 `params.xxx` 实际读取的字段，禁止声明脚本未使用的参数
   - 正文包含「使用方法」段落：说明这是可直接调用的API工具，load_skill后直接调用并传入 cookieDomain 即可获取数据
   - 正文包含「API失效时的恢复」段落：记录 `tab_keyword` 和 `target`（用于API失效时重新发现）

3. **生成后调用 `reloadAllSkills`**（SkillManager会自动热加载新skill）
