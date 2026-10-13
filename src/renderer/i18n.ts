import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
// The language list and the strings are shared with the main process, which
// labels the native menu with them, see `common/translations`
import { fallbackLanguage, supportedLanguages, type SupportedLanguage } from '@/common/locales';
import { messages, type Messages } from '@/common/translations';

const resources = Object.fromEntries(
  supportedLanguages.map((language) => [language, { common: messages[language] }]),
) as Record<SupportedLanguage, { common: Messages }>;

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
