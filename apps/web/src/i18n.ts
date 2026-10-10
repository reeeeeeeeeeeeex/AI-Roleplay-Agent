import { english } from './i18n-messages.js';
import { formatUiText, type UiText } from '@new-ai-chat/contracts/client';

export type Locale = 'zh-CN' | 'en';
export type MessageKey = keyof typeof english;
const chineseOverrides: Partial<Record<MessageKey, string>> = { '关闭窗口': '关闭' };
export const languageStorageKey = 'interface-language';
const listeners = new Set<() => void>();

export function readLocale(): Locale {
  try { return localStorage.getItem(languageStorageKey) === 'en' ? 'en' : 'zh-CN'; }
  catch { return 'zh-CN'; }
}
let locale = readLocale();
export const getLocale = () => locale;
export const subscribeLocale = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export function saveLocale(value: Locale): void {
  // Persist first: unavailable storage must not silently change the active language.
  localStorage.setItem(languageStorageKey, value);
  locale = value;
  document.documentElement.lang = value;
  listeners.forEach(listener => listener());
}

export function translate(language: Locale, key: MessageKey, ...values: unknown[]): string {
  const template = language === 'en' ? english[key] : chineseOverrides[key] ?? key;
  return template.replace(/\{(\d+)\}/g, (match, index: string) => {
    const value = values[Number(index)];
    return value == null ? match : typeof value === 'number' ? new Intl.NumberFormat(language).format(value) : String(value);
  });
}
export const t = (key: MessageKey, ...values: unknown[]) => translate(locale, key, ...values);
export const formatNumber = (value: number, options?: Intl.NumberFormatOptions) => new Intl.NumberFormat(locale, options).format(value);
export const formatDate = (value: string) => new Date(value).toLocaleString(locale);
export const diagnosticText = (text: UiText | undefined | null, original: string): string => text ? formatUiText(text, locale === 'en' ? 'en' : 'zh', original) : original;
