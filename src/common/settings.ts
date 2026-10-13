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

/* How the window draws its own menu bar: every menu in a row, or all of them behind one button */
export const menuBarStyles = ['inline', 'collapsed'] as const;

export type MenuBarStyle = (typeof menuBarStyles)[number];

/*
 * When an edit to an object reaches the file: at once, or only when the user
 * submits every edit made since, from the toolbar.
 * */
export const editModes = ['immediate', 'submit'] as const;

export type EditMode = (typeof editModes)[number];

export interface AppSettings {
  /* `null` while the user has not picked a theme, which means the operating system decides */
  darkTheme: boolean | null;
  /* `null` while the user has not picked a language, which means the system locale decides */
  language: SupportedLanguage | null;
  menuBarStyle: MenuBarStyle;
  editMode: EditMode;
}

export const defaultSettings: AppSettings = {
  darkTheme: null,
  language: null,
  menuBarStyle: 'inline',
  editMode: 'immediate',
};

export const isSupportedLanguage = (value: unknown): value is SupportedLanguage =>
  supportedLanguages.includes(value as SupportedLanguage);

export const isMenuBarStyle = (value: unknown): value is MenuBarStyle =>
  menuBarStyles.includes(value as MenuBarStyle);

export const isEditMode = (value: unknown): value is EditMode =>
  editModes.includes(value as EditMode);
