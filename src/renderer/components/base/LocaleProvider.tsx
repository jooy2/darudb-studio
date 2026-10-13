import { ReactNode, useEffect, useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { PlassProvider, type PlassLabels } from 'plass-ui/provider';
import { de, en, fr, ja, ko } from 'plass-ui/locales';
import { fallbackLanguage, type SupportedLanguage } from '@/common/locales';
import { isSupportedLanguage } from '@/common/settings';
import { useAppSelector } from '@/renderer/store/hooks';

// The words Plass UI draws on its own, such as a dialog's close button, in
// every language the app ships
const plassLabels: Record<SupportedLanguage, PlassLabels> = { de, en, fr, ja, ko };

/*
 * Puts the window on the language the settings hold, or the system's while
 * they hold none, and hands it to everything that is not a translated string:
 * the labels and date formats inside Plass UI components, and the `lang`
 * attribute a screen reader picks its voice from.
 * */
export default function LocaleProvider({ children }: { children: ReactNode }) {
  const [, i18n] = useTranslation();
  const chosenLanguage = useAppSelector((state) => state.settings.language);
  // i18next starts on the stored choice, so only a change needs applying
  const appliedLanguage = useRef(chosenLanguage);
  const language = isSupportedLanguage(i18n.resolvedLanguage)
    ? i18n.resolvedLanguage
    : fallbackLanguage;

  useEffect(() => {
    if (appliedLanguage.current === chosenLanguage) {
      return;
    }

    appliedLanguage.current = chosenLanguage;
    // Without a language, i18next asks its detector, which reads the system's
    void i18n.changeLanguage(chosenLanguage ?? undefined);
  }, [chosenLanguage, i18n]);

  useLayoutEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  return (
    <PlassProvider locale={language} labels={plassLabels[language]}>
      {children}
    </PlassProvider>
  );
}
