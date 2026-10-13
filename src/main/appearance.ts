import { app, nativeTheme } from 'electron';
import { backgroundColors } from '@/common/theme';
import { languageOf, type SupportedLanguage } from '@/common/locales';
import { getSettings } from './settings';

/*
 * The look the windows share, as the main process needs it before a page
 * exists: the background a window is painted with, and the language of the
 * native menu. Both follow the settings, and the operating system while the
 * user has made no choice.
 * */

export const getBackgroundColor = (): string =>
  (getSettings().darkTheme ?? nativeTheme.shouldUseDarkColors)
    ? backgroundColors.dark
    : backgroundColors.light;

/*
 * The language the user picked, or the one a window picks without a choice:
 * Chromium's locale, which is what a page reads from `navigator.language`.
 * */
export const getLanguage = (): SupportedLanguage =>
  getSettings().language ?? languageOf([app.getLocale()]);
