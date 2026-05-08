/**
 * I18nManager 属性测试（Property-Based Testing）
 *
 * 使用 fast-check 验证以下正确性属性：
 * 1. 语言一致性：setLanguage 后 currentLanguage 始终反映设置值
 * 2. 持久化往返：语言偏好写入 localStorage 后可正确恢复
 * 3. 切换对合性：toggleLanguage 调用两次回到原始语言
 * 4. 翻译完整性：每个翻译 key 在 zh/en 两种语言下都有非空值
 * 5. 缺失 key 回退：不存在的 key 返回 key 本身
 */

import * as fc from 'fast-check';
import { I18nManager, Language } from '../renderer/i18n';

// --- Mock DOM environment ---

const mockStorage: Record<string, string> = {};

beforeEach(() => {
  // Reset storage
  for (const key of Object.keys(mockStorage)) delete mockStorage[key];

  // Mock localStorage
  (global as any).localStorage = {
    getItem: (key: string) => mockStorage[key] ?? null,
    setItem: (key: string, value: string) => { mockStorage[key] = value; },
    removeItem: (key: string) => { delete mockStorage[key]; },
  };

  // Mock document
  (global as any).document = {
    documentElement: { lang: 'zh-CN', setAttribute: () => {} },
    getElementById: () => null,
    querySelectorAll: () => [],
  };

  // Mock window.electronAPI (no-op)
  (global as any).window = {
    electronAPI: {
      config: {
        setLanguage: () => Promise.resolve(),
      },
    },
  };

  // Mock console.warn / console.log to keep output clean
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// Arbitrary for Language type
const languageArb: fc.Arbitrary<Language> = fc.constantFrom('zh' as Language, 'en' as Language);

describe('I18nManager Property-Based Tests', () => {
  // Property 1: Language consistency
  // After calling setLanguage(lang), currentLanguage must equal lang
  test('P1: setLanguage(lang) => currentLanguage === lang', () => {
    fc.assert(
      fc.property(languageArb, (lang) => {
        const mgr = new I18nManager();
        mgr.setLanguage(lang);
        return mgr.currentLanguage === lang;
      }),
      { numRuns: 100 }
    );
  });

  // Property 2: Persistence round-trip
  // setLanguage writes to localStorage; a new instance reading init() restores the same language
  test('P2: persistence round-trip — setLanguage then init recovers same language', () => {
    fc.assert(
      fc.property(languageArb, (lang) => {
        const mgr1 = new I18nManager();
        mgr1.setLanguage(lang);

        const mgr2 = new I18nManager();
        mgr2.init();
        return mgr2.currentLanguage === lang;
      }),
      { numRuns: 100 }
    );
  });

  // Property 3: Toggle involution
  // Toggling twice from any starting language returns to the original language
  test('P3: toggleLanguage is an involution (toggle twice = identity)', () => {
    fc.assert(
      fc.property(languageArb, (lang) => {
        const mgr = new I18nManager();
        mgr.setLanguage(lang);
        mgr.toggleLanguage();
        mgr.toggleLanguage();
        return mgr.currentLanguage === lang;
      }),
      { numRuns: 100 }
    );
  });

  // Property 4: Translation completeness
  // For every key in the translations dict, t(key) returns a non-empty string in both languages
  test('P4: every translation key yields non-empty string in both languages', () => {
    const mgr = new I18nManager();

    // Collect all keys by setting zh and checking which keys return non-key values
    // We test a known set of keys from the translations dict
    const knownKeys = [
      'nav.back', 'nav.forward', 'nav.reload', 'nav.newTab',
      'chat.welcome.title', 'chat.role.user', 'chat.role.assistant',
      'chat.send.error', 'chat.clear.error', 'chat.clear.confirm',
      'copy.text', 'copy.done', 'copy.fail', 'copy.reply', 'copy.code',
      'skill.connecting', 'skill.navigating', 'skill.expanding',
      'skill.extracting', 'skill.processing',
      'tab.new', 'about.title', 'about.ok',
      'error.global', 'error.unhandled', 'error.initFailed',
    ];

    fc.assert(
      fc.property(
        fc.constantFrom(...knownKeys),
        languageArb,
        (key, lang) => {
          mgr.setLanguage(lang);
          const value = mgr.t(key);
          // value should be non-empty and should NOT be the key itself (meaning it was found)
          return value.length > 0 && value !== key;
        }
      ),
      { numRuns: 200 }
    );
  });

  // Property 5: Missing key fallback
  // For any random string that is NOT a valid translation key, t(key) returns the key itself
  test('P5: t(unknownKey) returns the key itself as fallback', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }).filter(s => s.includes('$')), // '$' ensures it won't collide with real keys
        (randomKey) => {
          const mgr = new I18nManager();
          mgr.setLanguage('zh');
          return mgr.t(randomKey) === randomKey;
        }
      ),
      { numRuns: 100 }
    );
  });

  // Property 6: Language sequence consistency
  // After any sequence of setLanguage calls, currentLanguage equals the last one
  test('P6: after a sequence of setLanguage calls, currentLanguage equals the last call', () => {
    fc.assert(
      fc.property(
        fc.array(languageArb, { minLength: 1, maxLength: 20 }),
        (langs) => {
          const mgr = new I18nManager();
          for (const lang of langs) {
            mgr.setLanguage(lang);
          }
          return mgr.currentLanguage === langs[langs.length - 1];
        }
      ),
      { numRuns: 100 }
    );
  });
});
