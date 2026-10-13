/*
 * The language list, shared by the three processes.
 *
 * Only the renderer displays translated strings today, but the language the
 * user picked is app state, not screen state: a main process menu or dialog has
 * to land on the same one. See `src/common/ipc.ts` for what may live here.
 * */

// Languages that have a matching file in `src/common/messages`.
// Add a new language here after creating its translation file, then import it
// in `src/common/translations.ts`, which is where it enters the bundle.
export const supportedLanguages = ['en', 'de', 'fr', 'ja', 'ko'] as const;

export type SupportedLanguage = (typeof supportedLanguages)[number];

export const fallbackLanguage: SupportedLanguage = 'en';

// Language names are intentionally not translated, so that every entry stays
// readable no matter which language is currently active.
export const languageNames: Record<SupportedLanguage, string> = {
  en: 'English',
  de: 'Deutsch',
  fr: 'Français',
  ja: '日本語',
  ko: '한국어',
};
