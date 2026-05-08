/**
 * Core type definitions for AI-Driven Web Crawler
 */

// ============================================================================
// Crawler Parameters and Results
// ============================================================================

export interface CrawlerParams {
  operation: 'fetch_data' | 'list_tabs' | 'switch_tab' | 'extract_current';
  browserPort?: number;
  tabKeyword?: string;
  target?: string;
  extractionGoal?: string;
  navigationHint?: string;
  maxSteps?: number;
  maxExpandSteps?: number;
  /** Background mode: create a hidden page and navigate to this URL instead of reusing the visible tab */
  startUrl?: string;
  /** If true, run in background (hidden page, no bringToFront, no Electron tab switch) */
  background?: boolean;
  /** Session ID for concurrent crawling isolation (e.g., "meituan-room-status-1710000000000") */
  sessionId?: string;
  /** If true, enable API interception mode — capture HTTP API candidates during navigation */
  interceptApis?: boolean;
}

export interface CrawlerResult {
  success: boolean;
  data?: ExtractedData;
  navigationPath: NavigationStep[];
  screenshots: string[];
  stats: {
    totalSteps: number;
    duration: number;
    confidence: number;
  };
  error?: ErrorInfo;
  /** API candidates discovered during navigation (only when interceptApis=true) */
  apiCandidates?: APICandidate[];
}

// ============================================================================
// Navigation Types
// ============================================================================

export interface NavigationStep {
  step: number;
  screenshot: string; // URL path
  analysis: NavigationAnalysis;
  action: {
    type: string;
    target?: string;
    result: string;
  };
  urlBefore: string;
  urlAfter: string;
  timestamp: number;
}

export interface NavigationAnalysis {
  reached: boolean;
  confidence: number;
  reasoning: string;
  nextAction?: {
    type: 'click' | 'scroll' | 'wait' | 'input' | 'select_date' | 'click_near' | 'not_found';
    elementText?: string;
    direction?: 'up' | 'down';
    waitTime?: number;
    inputText?: string;
    inputPlaceholder?: string;
    dateText?: string;
    dateFieldType?: 'checkin' | 'checkout';
    nearText?: string;    // anchor text near the target (e.g. hotel name)
    nearAction?: string;  // the button/link text to click near that anchor (e.g. "查看详情")
  };
}

export interface NavigationContext {
  target: string;
  hint?: string;
  history: NavigationStep[];
  currentUrl: string;
}

// ============================================================================
// Data Extraction Types
// ============================================================================

export interface ExtractedData {
  data: any;
  confidence: number;
  strategy: 'dom_screenshot' | 'dom_only' | 'local_review_dom' | 'network_json' | 'screenshot_only';
  raw?: {
    dom?: string;
    tables?: TableData[];
    network?: any[];
  };
}

export interface ExtractionContext {
  goal: string;
  screenshot?: Buffer;   // 单张（兼容旧调用）
  screenshots?: Buffer[]; // 多张视口截图（滚动采集）
  domContent?: DOMContent;
  networkData?: any[];
}

export interface DOMContent {
  text: string[];
  tables: TableData[];
  dataAttributes: Record<string, string>[];
  semanticAttributes: SemanticAttribute[];
  selectOptions: SelectOption[];
}

export interface TableData {
  headers: string[];
  rows: string[][];
}

export interface SemanticAttribute {
  tag: string;
  attribute: string;
  value: string;
}

export interface SelectOption {
  value: string;
  text: string;
  selected: boolean;
}

// ============================================================================
// Page Analysis Types
// ============================================================================

export interface CompletenessCheck {
  isComplete: boolean;
  expandableElements: ExpandableElement[];
  confidence: number;
}

export interface ExpandableElement {
  type: 'button' | 'accordion' | 'pagination' | 'infinite_scroll';
  text: string;
  action: 'click' | 'scroll';
}

// ============================================================================
// Browser and Click Types
// ============================================================================

export interface TabInfo {
  id: string;
  title: string;
  url: string;
  active: boolean;
}

export interface ClickResult {
  success: boolean;
  urlChanged: boolean;
  elementFound: boolean;
  strategy: string;
  attempts: number;
}

export interface InputResult {
  success: boolean;
  elementFound: boolean;
  strategy: string;
  inputValue: string;
}

export interface ElementScore {
  element: any; // Playwright ElementHandle
  score: number;
  reason: string;
}

// ============================================================================
// Network Monitoring Types
// ============================================================================

export interface CapturedRequest {
  url: string;
  method: string;
  response: any;
  timestamp: number;
}

export interface EnhancedCapturedRequest {
  url: string;
  method: string;
  requestHeaders: Record<string, string>;
  requestBody?: string;
  response: any;
  responseHeaders: Record<string, string>;
  statusCode: number;
  contentType: string;
  responseSize: number;
  timestamp: number;
}

export interface APICandidate {
  url: string;
  method: string;
  requestHeaders: Record<string, string>;
  requestBody?: string;
  responsePreview: string;
  responseSchema: string;
  responseSize: number;
  contentType: string;
  statusCode: number;
}

// ============================================================================
// Screenshot Types
// ============================================================================

export interface ScreenshotOptions {
  quality?: number;
  maxSize?: number;
  format?: 'jpeg' | 'png';
  fullPage?: boolean;
}

export interface ScreenshotMetadata {
  step: number;
  label: string;
  timestamp: number;
  size: number;
  compressed: boolean;
}

// ============================================================================
// LLM/Agent Types
// ============================================================================

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string | MessageContent[];
}

export interface MessageContent {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: {
    url: string;
  };
}

export interface LLMResponse {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface CallOptions {
  temperature?: number;
  maxTokens?: number;
  timeout?: number;
  /** Override max retries for this specific call (default: config.max_retries) */
  maxRetries?: number;
}

// ============================================================================
// Error and Progress Types
// ============================================================================

export interface ErrorInfo {
  code: string;
  message: string;
  suggestions?: string[];
  details?: Record<string, any>;
}

export interface ProgressEvent {
  phase: 'connecting' | 'navigating' | 'expanding' | 'extracting' | 'complete';
  step?: number;
  totalSteps?: number;
  message: string;
  screenshot?: string;
  data?: any;
}

export type ProgressCallback = (event: ProgressEvent) => void;
