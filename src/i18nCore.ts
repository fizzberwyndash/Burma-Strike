import { commonTranslations } from './locales/common';
import { gameplayPatterns, gameplayTranslations } from './locales/gameplay';
import { multiplayerTranslations } from './locales/multiplayer';

export type Language = 'en' | 'my';
export type TranslationVariables = Record<string, string | number>;

// A null prototype keeps unknown source phrases such as "constructor" safe.
const dictionary: Readonly<Record<string, string>> = Object.freeze(Object.assign(
  Object.create(null) as Record<string, string>, commonTranslations, gameplayTranslations, multiplayerTranslations,
));

/** Pure text translation. English source copy remains a safe fallback for unknown keys. */
export function translate(source: string, language: Language, variables: TranslationVariables = {}): string {
  let phrase = language === 'my' ? dictionary[source] : source;
  let values = variables;
  if (language === 'my' && phrase === undefined) {
    for (const entry of gameplayPatterns) {
      const match = entry.pattern.exec(source);
      if (!match) continue;
      phrase = dictionary[entry.key] ?? entry.key;
      values = { ...variables };
      entry.names.forEach((name, index) => { values[name] = translate(match[index + 1] ?? '', language); });
      break;
    }
  }
  return (phrase ?? source).replace(/\{(\w+)\}/g, (placeholder, key: string) =>
    Object.hasOwn(values, key) ? String(values[key]) : placeholder,
  );
}
