import { createContext, useCallback, useContext, useEffect } from 'react';
import type { ReactNode } from 'react';
import { translate } from './i18nCore';
import type { Language, TranslationVariables as Variables } from './i18nCore';
export { translate } from './i18nCore';
export type { Language, TranslationVariables } from './i18nCore';

const I18nContext = createContext<{ language: Language; t: (source: string, variables?: Variables) => string }>({ language: 'en', t: source => source });

export function I18nProvider({ language, children }: { language: Language; children: ReactNode }) {
  const t = useCallback((source: string, variables?: Variables) => translate(source, language, variables), [language]);
  useEffect(() => { document.documentElement.lang = language; }, [language]);
  return <I18nContext.Provider value={{ language, t }}>{children}</I18nContext.Provider>;
}

export function useI18n() { return useContext(I18nContext); }
