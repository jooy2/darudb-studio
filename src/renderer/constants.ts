/*
 * Values the renderer modules share.
 *
 * This is renderer process only, unlike `src/common`: it describes the web page
 * the app runs in, which neither the main process nor the preload script has.
 * */

// The color scheme the operating system asks for. The browser engine reports it
// directly, so the theme needs no round trip to the main process.
export const SYSTEM_DARK_THEME_QUERY = '(prefers-color-scheme: dark)';

// A product name, so it is the same in every language and kept out of the
// translation files
export const APP_NAME = 'DaruDB Studio';
