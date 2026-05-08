/**
 * Error Codes and Error Handling
 */

export const ErrorCodes = {
  // Browser errors (1001-1999)
  BROWSER_CONNECTION_FAILED: '1001',
  BROWSER_NOT_FOUND: '1002',
  PAGE_TIMEOUT: '1003',
  TAB_NOT_FOUND: '1004',

  // Navigation errors (2001-2999)
  MAX_STEPS_EXCEEDED: '2001',
  TARGET_NOT_FOUND: '2002',
  NAVIGATION_FAILED: '2003',
  ELEMENT_NOT_FOUND: '2004',

  // LLM errors (3001-3999)
  LLM_API_FAILED: '3001',
  LLM_TIMEOUT: '3002',
  LLM_INVALID_RESPONSE: '3003',
  LLM_PARSE_ERROR: '3004',

  // Data extraction errors (4001-4999)
  EXTRACTION_FAILED: '4001',
  VALIDATION_FAILED: '4002',
  INCOMPLETE_DATA: '4003',

  // Configuration errors (5001-5999)
  INVALID_PARAMETERS: '5001',
  CONFIG_ERROR: '5002',
  CLEANUP_FAILED: '5003',
};

export const ErrorMessages: Record<string, string> = {
  [ErrorCodes.BROWSER_CONNECTION_FAILED]: 'Failed to connect to browser',
  [ErrorCodes.BROWSER_NOT_FOUND]: 'Browser not found on specified port',
  [ErrorCodes.PAGE_TIMEOUT]: 'Page load timeout',
  [ErrorCodes.TAB_NOT_FOUND]: 'Tab not found with specified keyword',
  
  [ErrorCodes.MAX_STEPS_EXCEEDED]: 'Maximum navigation steps exceeded',
  [ErrorCodes.TARGET_NOT_FOUND]: 'Target page not found',
  [ErrorCodes.NAVIGATION_FAILED]: 'Navigation failed',
  [ErrorCodes.ELEMENT_NOT_FOUND]: 'Element not found on page',
  
  [ErrorCodes.LLM_API_FAILED]: 'LLM API call failed',
  [ErrorCodes.LLM_TIMEOUT]: 'LLM API timeout',
  [ErrorCodes.LLM_INVALID_RESPONSE]: 'Invalid LLM response',
  [ErrorCodes.LLM_PARSE_ERROR]: 'Failed to parse LLM response',
  
  [ErrorCodes.EXTRACTION_FAILED]: 'Data extraction failed',
  [ErrorCodes.VALIDATION_FAILED]: 'Data validation failed',
  [ErrorCodes.INCOMPLETE_DATA]: 'Incomplete data extracted',
  
  [ErrorCodes.INVALID_PARAMETERS]: 'Invalid parameters',
  [ErrorCodes.CONFIG_ERROR]: 'Configuration error',
  [ErrorCodes.CLEANUP_FAILED]: 'Cleanup failed',
};

export const ErrorSuggestions: Record<string, string[]> = {
  [ErrorCodes.BROWSER_CONNECTION_FAILED]: [
    'Ensure browser is running with remote debugging enabled',
    'Check if port is correct (default: 9222)',
    'Try: chrome.exe --remote-debugging-port=9222',
  ],
  [ErrorCodes.TAB_NOT_FOUND]: [
    'Check if tab keyword matches any open tab title or URL',
    'Try using a more specific keyword',
    'List all tabs first to see available options',
  ],
  [ErrorCodes.MAX_STEPS_EXCEEDED]: [
    'Increase maxSteps parameter',
    'Provide more specific navigationHint',
    'Check if target page is reachable',
  ],
  [ErrorCodes.LLM_API_FAILED]: [
    'Check API key is valid',
    'Verify network connection',
    'Check API rate limits',
  ],
};

export function formatError(code: string, details?: Record<string, any>): {
  code: string;
  message: string;
  suggestions?: string[];
  details?: Record<string, any>;
} {
  return {
    code,
    message: ErrorMessages[code] || 'Unknown error',
    suggestions: ErrorSuggestions[code],
    details,
  };
}
