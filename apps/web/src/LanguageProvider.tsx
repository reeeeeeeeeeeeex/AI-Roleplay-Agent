import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import { getLocale, saveLocale, subscribeLocale, type Locale } from './i18n.js';

const LanguageContext = createContext<{ locale: Locale; saveLanguage: (locale: Locale) => void }>({ locale: 'zh-CN', saveLanguage: saveLocale });

export function LanguageProvider({ children }: { children: ReactNode }) {
  const locale = useSyncExternalStore(subscribeLocale, getLocale);
  return <LanguageContext.Provider value={{ locale, saveLanguage: saveLocale }}>{children}</LanguageContext.Provider>;
}
export const useLanguage = () => useContext(LanguageContext);
