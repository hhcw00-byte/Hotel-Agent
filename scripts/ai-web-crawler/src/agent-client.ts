/**
 * Agent Client
 * Integrates with existing PiAgentManager for vision-based LLM calls
 */

import { Message, LLMResponse, CallOptions } from './types';
import { LLMConfig } from './config-types';

export class AgentClient {
  private config: LLMConfig;
  private retryCount: number = 0;

  constructor(config: LLMConfig) {
    this.config = config;
  }

  /**
   * Call LLM with messages (supports vision)
   */
  async call(messages: Message[], options?: CallOptions): Promise<LLMResponse> {
    return this.retryWithBackoff(async () => {
      return await this.callWithTimeout(messages, options);
    }, options?.maxRetries);
  }

  /**
   * Call LLM with timeout.
   * Uses both AbortController (cooperative) AND Promise.race (hard kill)
   * to guarantee we never hang even if fetch ignores the abort signal.
   */
  private async callWithTimeout(messages: Message[], options?: CallOptions): Promise<LLMResponse> {
    const timeout = options?.timeout || this.config.timeout;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    // Hard timeout: Promise.race guarantees we reject even if fetch ignores AbortController
    // Add 5s grace period beyond the AbortController timeout
    const hardTimeout = timeout + 5000;

    const resultPromise = (async () => {
      try {
        return await this.callLLM(messages, options, controller.signal);
      } catch (error: any) {
        if (error?.name === 'AbortError' || controller.signal.aborted) {
          throw new Error(`LLM call timeout (${Math.round(timeout / 1000)}s)`);
        }
        throw error;
      }
    })();

    try {
      return await Promise.race([
        resultPromise,
        new Promise<never>((_, reject) =>
          setTimeout(() => {
            controller.abort();
            reject(new Error(`LLM call hard timeout (${Math.round(hardTimeout / 1000)}s) — fetch did not respond to AbortController`));
          }, hardTimeout)
        ),
      ]);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Actual LLM call implementation
   */
  private async callLLM(messages: Message[], options?: CallOptions, signal?: AbortSignal): Promise<LLMResponse> {
    if (this.config.provider === 'agent' || this.config.provider === 'google') {
      return this.callGeminiAPI(messages, options, signal);
    } else {
      // openai / anthropic / openai-compatible (default)
      return this.callOpenAICompatibleAPI(messages, options, signal);
    }
  }

  /**
   * Call OpenAI-compatible API (supports vision via base64 image_url)
   */
  private async callOpenAICompatibleAPI(messages: Message[], options?: CallOptions, signal?: AbortSignal): Promise<LLMResponse> {
    const apiKey = this.config.api_key;
    const model = this.config.model;
    const baseURL = (this.config.base_url || 'https://api.openai.com/v1').replace(/\/$/, '');

    // Convert to OpenAI message format (already compatible)
    const openaiMessages = messages.map(msg => {
      if (typeof msg.content === 'string') {
        return { role: msg.role, content: msg.content };
      }
      // multi-part: text + image_url
      return {
        role: msg.role,
        content: msg.content.map(part => {
          if (part.type === 'text') return { type: 'text', text: part.text };
          if (part.type === 'image_url') return { type: 'image_url', image_url: part.image_url };
          return part;
        })
      };
    });

    const response = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: openaiMessages,
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.maxTokens ?? 2048,
      }),
      signal,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${response.status} ${error}`);
    }

    const data: any = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('No content in OpenAI API response');
    }

    return {
      content,
      usage: {
        promptTokens: data.usage?.prompt_tokens || 0,
        completionTokens: data.usage?.completion_tokens || 0,
        totalTokens: data.usage?.total_tokens || 0,
      },
    };
  }

  /**
   * Call Gemini API directly (for vision support)
   */
  private async callGeminiAPI(messages: Message[], options?: CallOptions, signal?: AbortSignal): Promise<LLMResponse> {
    const apiKey = this.config.api_key;
    const model = this.config.model;
    const baseURL = this.config.base_url || 'https://generativelanguage.googleapis.com/v1beta';

    // Convert messages to Gemini format
    const contents = this.convertToGeminiFormat(messages);

    // Build request
    const url = `${baseURL}/models/${model}:generateContent?key=${apiKey}`;
    const body = {
      contents,
      generationConfig: {
        temperature: options?.temperature || 0.7,
        maxOutputTokens: options?.maxTokens || 2048,
      },
    };

    // Make request
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Gemini API error: ${response.status} ${error}`);
    }

    const data: any = await response.json();

    // Extract response
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!content) {
      throw new Error('No content in Gemini API response');
    }

    return {
      content,
      usage: {
        promptTokens: data.usageMetadata?.promptTokenCount || 0,
        completionTokens: data.usageMetadata?.candidatesTokenCount || 0,
        totalTokens: data.usageMetadata?.totalTokenCount || 0,
      },
    };
  }

  /**
   * Convert messages to Gemini format
   */
  private convertToGeminiFormat(messages: Message[]): any[] {
    const contents: any[] = [];

    for (const message of messages) {
      const parts: any[] = [];

      if (typeof message.content === 'string') {
        // Simple text message
        parts.push({ text: message.content });
      } else {
        // Multi-part message (text + images)
        for (const part of message.content) {
          if (part.type === 'text' && part.text) {
            parts.push({ text: part.text });
          } else if (part.type === 'image_url' && part.image_url) {
            // Extract base64 data from data URL
            const imageUrl = part.image_url.url;
            if (imageUrl.startsWith('data:')) {
              const match = imageUrl.match(/^data:image\/(\w+);base64,(.+)$/);
              if (match) {
                const [, mimeType, data] = match;
                parts.push({
                  inlineData: {
                    mimeType: `image/${mimeType}`,
                    data,
                  },
                });
              }
            }
          }
        }
      }

      // Map role
      let role = 'user';
      if (message.role === 'assistant') {
        role = 'model';
      }

      contents.push({ role, parts });
    }

    return contents;
  }

  /**
   * Retry with exponential backoff.
   * @param fn - The function to retry
   * @param maxRetriesOverride - Optional override for max retries
   */
  private async retryWithBackoff<T>(fn: () => Promise<T>, maxRetriesOverride?: number): Promise<T> {
    const maxRetries = maxRetriesOverride ?? this.config.max_retries;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        this.retryCount = attempt;
        return await fn();
      } catch (error) {
        lastError = error as Error;
        console.error(`[AgentClient] Attempt ${attempt + 1}/${maxRetries + 1} failed: ${(error as Error).message?.substring(0, 120)}`);

        if (attempt < maxRetries) {
          // Exponential backoff: 1s, 2s, 4s
          const delay = Math.pow(2, attempt) * 1000;
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError || new Error('Retry failed');
  }

  /**
   * Encode image buffer to base64 data URL
   */
  encodeImage(buffer: Buffer, mimeType: string = 'image/jpeg'): string {
    const base64 = buffer.toString('base64');
    return `data:${mimeType};base64,${base64}`;
  }

  /**
   * Get current retry count
   */
  getRetryCount(): number {
    return this.retryCount;
  }
}
