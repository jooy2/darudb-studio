import { app, BrowserWindow, nativeTheme, type TitleBarOverlay } from 'electron';
import { backgroundColors, foregroundColors } from '@/common/theme';
import { languageOf, type SupportedLanguage } from '@/common/locales';
import { getSettings } from './settings';

/*
 * The look the windows share, as the main process needs it before a page
 * exists: the background a window is painted with, the window's own buttons
 * and the language of the native menu. They follow the settings, and the
 * operating system while the user has made no choice.
 * */

const isDarkTheme = (): boolean => getSettings().darkTheme ?? nativeTheme.shouldUseDarkColors;

export const getBackgroundColor = (): string =>
  isDarkTheme() ? backgroundColors.dark : backgroundColors.light;

/*
 * The height of the header every screen starts with, which is the window's
 * title bar: the page draws it, and the system's own buttons sit in it. It is
 * the 48px row of Plass UI's small header and the line above and below it.
 * */
export const TITLE_BAR_HEIGHT = 50;

/*
 * The buttons Windows and Linux draw over the top right of a window: on
 * nothing of their own, so the header shows through, and in the color of the
 * theme's text.
 * */
export const getTitleBarOverlay = (): TitleBarOverlay => ({
  color: 'rgba(0, 0, 0, 0)',
  symbolColor: isDarkTheme() ? foregroundColors.dark : foregroundColors.light,
  height: TITLE_BAR_HEIGHT,
});

/* Draws the buttons of every window in the theme of now, once it changed */
export const refreshTitleBars = (): void => {
  // The traffic lights of macOS follow the system's appearance by themselves
  if (process.platform === 'darwin') {
    return;
  }

  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.setTitleBarOverlay(getTitleBarOverlay());
    }
  }
};

/*
 * The language the user picked, or the one a window picks without a choice:
 * Chromium's locale, which is what a page reads from `navigator.language`.
 * */
export const getLanguage = (): SupportedLanguage =>
  getSettings().language ?? languageOf([app.getLocale()]);
