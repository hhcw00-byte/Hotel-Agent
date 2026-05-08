/**
 * Configuration type definitions for AI-Driven Web Crawler
 */

// ============================================================================
// Main Configuration
// ============================================================================

export interface AppConfig {
  browser: BrowserConfig;
  llm: LLMConfig;
  crawler: CrawlerConfig;
  extraction: ExtractionConfig;
}

// ============================================================================
// Browser Configuration
// ============================================================================

export interface BrowserConfig {
  default_port: number;
  timeout: number;
  headless: boolean;
}

// ============================================================================
// LLM Configuration
// ============================================================================

export interface LLMConfig {
  provider: 'openai' | 'anthropic' | 'google' | 'agent';
  api_key: string;
  base_url?: string;
  model: string;
  timeout: number;
  max_retries: number;
}

// ============================================================================
// Crawler Configuration
// ============================================================================

export interface CrawlerConfig {
  max_navigation_steps: number;
  max_expand_steps: number;
  screenshot_quality: number;
  screenshot_max_size: number;
  wait_after_action: number;
}

// ============================================================================
// Extraction Configuration
// ============================================================================

export interface ExtractionConfig {
  max_dom_size: number;
  include_network_data: boolean;
  confidence_threshold: number;
}
