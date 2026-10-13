import { BrowserWindow, nativeTheme } from 'electron';
import { rendererChannels } from '@/common/ipc';
import { backgroundColors } from '@/common/theme';
import { isSupportedLanguage } from '@/common/settings';
import { getSettings, updateSettings } from './settings';

/*
 * The look the windows share.
 *
 * Every window runs its own copy of the renderer with its own store, so a choice
 * made in one of them reaches the others only if the main process passes it on.
 * The choice is also kept in the settings file, so that the next window, and
 * the next launch, start on the right background instead of flashing another.
 * */

/*
 * Sends a value to every window but the one it came from, which already has it.
 * */
const broadcast = (channel: string, payload: unknown, sender: BrowserWindow | null): void => {
  BrowserWindow.getAllWindows().forEach((browserWindow) => {
    if (browserWindow.isDestroyed() || browserWindow === sender) {
      return;
    }

    browserWindow.webContents.send(channel, payload);
  });
};

export const getBackgroundColor = (): string =>
  (getSettings().darkTheme ?? nativeTheme.shouldUseDarkColors)
    ? backgroundColors.dark
    : backgroundColors.light;

/*
 * Both setters take a value the renderer chose, so each one is checked before it
 * is stored and passed on.
 *
 * A window that hears about a change reports it back as its own, so a value
 * that is already stored ends the round there instead of being written and
 * broadcast again.
 * */
export const setDarkTheme = (value: unknown, sender: BrowserWindow | null): void => {
  if (typeof value !== 'boolean') {
    console.warn(`Ignored a theme that is not a boolean: ${String(value)}`);

    return;
  }

  if (getSettings().darkTheme === value) {
    return;
  }

  updateSettings({ darkTheme: value });
  broadcast(rendererChannels.darkThemeUpdated, value, sender);
};

export const setLanguage = (value: unknown, sender: BrowserWindow | null): void => {
  if (!isSupportedLanguage(value)) {
    console.warn(`Ignored an unsupported language: ${String(value)}`);

    return;
  }

  if (getSettings().language === value) {
    return;
  }

  updateSettings({ language: value });
  broadcast(rendererChannels.languageUpdated, value, sender);
};
