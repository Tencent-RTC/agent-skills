// Locale selection for the first-use continuation notice.
// Published projections currently cover Chinese and English. Explicit locale
// metadata wins, then the user's Prompt script, then the host locale.

import noticeSpec from './continuation-notice.js';

export const DEFAULT_NOTICE_LOCALE = 'en-US';
export const SUPPORTED_NOTICE_LOCALES = Object.freeze(['zh-CN', 'en-US']);

const LOCALE_ALIASES = Object.freeze({
  zh: 'zh-CN', 'zh-cn': 'zh-CN', 'zh-hans': 'zh-CN', 'zh-sg': 'zh-CN',
  en: 'en-US', 'en-us': 'en-US', 'en-gb': 'en-US', 'en-au': 'en-US',
});

export function normalizeNoticeLocale(value) {
  if (typeof value !== 'string') return null;
  const key = value.trim().toLowerCase().replace(/_/g, '-');
  return LOCALE_ALIASES[key] || (SUPPORTED_NOTICE_LOCALES.includes(value) ? value : null);
}

function localeFromEnvironment(env = process.env) {
  const raw = env?.LC_ALL || env?.LC_MESSAGES || env?.LANG || env?.LANGUAGE;
  return normalizeNoticeLocale(raw?.split('.')[0]?.split(':')[0]) || null;
}

export function detectNoticeLocale(text, env = process.env, explicit = null) {
  const requested = normalizeNoticeLocale(explicit);
  if (requested) return requested;
  if (typeof text === 'string') {
    if (/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Cyrillic}]/u.test(text)) {
      return DEFAULT_NOTICE_LOCALE;
    }
    if (/\p{Script=Han}/u.test(text)) return 'zh-CN';
    if (/[A-Za-z]/u.test(text)) return 'en-US';
  }
  return localeFromEnvironment(env) || DEFAULT_NOTICE_LOCALE;
}

export function noticeForLocale(locale) {
  const normalized = normalizeNoticeLocale(locale) || DEFAULT_NOTICE_LOCALE;
  const localized = noticeSpec.locales?.[normalized];
  return localized ? { ...noticeSpec, ...localized, locale: normalized } : { ...noticeSpec, locale: normalized };
}

export function noticeTextForLocale(locale) {
  const notice = noticeForLocale(locale);
  return `${notice.body}\n\n${notice.allow_label}    ${notice.deny_label}`;
}

export function isNoticeReplayText(text) {
  if (typeof text !== 'string') return false;
  return SUPPORTED_NOTICE_LOCALES.some((locale) => text === noticeTextForLocale(locale));
}

export function choiceFromLocalizedText(text) {
  if (typeof text !== 'string') return null;
  const normalized = text.trim().replace(/[。.!！?？\s]+$/u, '');
  for (const locale of SUPPORTED_NOTICE_LOCALES) {
    const notice = noticeForLocale(locale);
    if (normalized === notice.allow_label) return 'allowed';
    if (normalized === notice.deny_label) return 'denied';
  }
  return null;
}
