import { ReactNode, useLayoutEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { PlassProvider, type PlassLabels } from 'plass-ui/provider';
import { de, en, fr, ja, ko } from 'plass-ui/locales';
import { fallbackLanguage, type SupportedLanguage } from '@/common/locales';
import { isSupportedLanguage } from '@/common/settings';

// The words Plass UI draws on its own, such as a dialog's close button, in
// every language the app ships
const plassLabels: Record<SupportedLanguage, PlassLabels> = { de, en, fr, ja, ko };

/*
 * Hands the app's language to everything that is not a translated string: the
 * labels and date formats inside Plass UI components, and the `lang` attribute
 * a screen reader picks its voice from.
 * */
export default function LocaleProvider({ children }: { children: ReactNode }) {
  const [, i18n] = useTranslation();
  const language = isSupportedLanguage(i18n.resolvedLanguage)
    ? i18n.resolvedLanguage
    : fallbackLanguage;

  useLayoutEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  return (
    <PlassProvider locale={language} labels={plassLabels[language]}>
      {children}
    </PlassProvider>
  );
}
