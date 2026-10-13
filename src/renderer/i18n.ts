import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
// The language list itself is shared with the main process, see `common/locales`
import { fallbackLanguage, supportedLanguages, type SupportedLanguage } from '@/common/locales';

import de from '@/renderer/locales/de/common.json';
import en from '@/renderer/locales/en/common.json';
import fr from '@/renderer/locales/fr/common.json';
import ja from '@/renderer/locales/ja/common.json';
import ko from '@/renderer/locales/ko/common.json';

/*
 * Translations are bundled rather than fetched at runtime. Every language
 * together is a few kilobytes, and the app reads them from disk, so a request
 * per language only bought a first render with the raw keys in it.
 *
 * Typing every entry as `typeof en` makes a missing or misspelled key a build
 * error, so the languages cannot drift apart.
 * */
const resources: Record<SupportedLanguage, { common: typeof en }> = {
  de: { common: de },
  en: { common: en },
  fr: { common: fr },
  ja: { common: ja },
  ko: { common: ko },
};

/*
 * Starts on the language the user picked, which the main process keeps in the
 * settings file. Without one, the detector asks the system locale, and caches
 * nothing in browser storage: the choice is the main process's to keep.
 * */
export const initI18n = async (language: SupportedLanguage | null): Promise<void> => {
  await i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
      resources,
      lng: language ?? undefined,
      ns: ['common'],
      supportedLngs: supportedLanguages,
      load: 'languageOnly',
      defaultNS: 'common',
      fallbackNS: 'common',
      fallbackLng: fallbackLanguage,
      detection: {
        order: ['navigator'],
        caches: [],
      },
      interpolation: {
        escapeValue: false,
      },
    });
};

export default i18n;
