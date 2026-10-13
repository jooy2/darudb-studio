import { supportedLanguages, type SupportedLanguage } from './locales';

/*
 * The preferences the app keeps between launches, shared by the three
 * processes.
 *
 * The main process stores them in the app's own DaruDB file and hands them to
 * a window before its first render, so the renderer never reads them from
 * browser storage. See `src/main/settings.ts`.
 *
 * See `src/common/ipc.ts` for what may live in this folder.
 * */
export interface AppSettings {
  /* `null` while the user has not picked a theme, which means the operating system decides */
  darkTheme: boolean | null;
  /* `null` while the user has not picked a language, which means the system locale decides */
  language: SupportedLanguage | null;
}

export const defaultSettings: AppSettings = {
  darkTheme: null,
  language: null,
};

export const isSupportedLanguage = (value: unknown): value is SupportedLanguage =>
  supportedLanguages.includes(value as SupportedLanguage);
