import { app, type WebPreferences } from 'electron';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { debug } from '../../package.json';

/*
 * Values the main process modules share.
 *
 * This is main process only, unlike `src/common`: it reaches for Node.js
 * builtins and resolves paths inside the packaged app, neither of which the
 * renderer can do.
 * */

export const isDevEnv = process.env.NODE_ENV === 'development';

// `vite-plugin-electron` injects the address the dev server actually bound to.
// The value in `package.json` is only a fallback for a manually started server.
export const devServerUrl = process.env.VITE_DEV_SERVER_URL || debug.env.VITE_DEV_SERVER_URL;

/*
 * Switches for the end-to-end tests. They are read from the environment of an
 * unpackaged build only, so a released app cannot be steered by them.
 *
 * `DARUDB_STUDIO_HIDDEN=1` keeps every window off the screen and, on macOS, the
 * app out of the Dock, so a test run does not take the screen or the focus from
 * whoever started it. Playwright drives the hidden windows all the same.
 * `DARUDB_STUDIO_USER_DATA` moves the user data folder, the settings file
 * included, so a run starts from a folder of its own.
 * */
export const isHiddenRun = !app.isPackaged && process.env.DARUDB_STUDIO_HIDDEN === '1';
export const userDataOverride = app.isPackaged ? undefined : process.env.DARUDB_STUDIO_USER_DATA;

const currentDirName = dirname(fileURLToPath(import.meta.url));

// Both are resolved from `dist/main`, where this file ends up after the build
export const preloadFile = join(currentDirName, '../preload/index.js');
export const appIndexFile = join(currentDirName, '../index.html');
// Written by `buildAssets/notices/write.mjs` after the build, so a development
// run has it only once the app was built
export const noticesFile = join(currentDirName, '../THIRD_PARTY_NOTICES.txt');

/*
 * Applied to every window, so the main window and the ones `WindowManager`
 * opens cannot drift apart on what their renderer is allowed to do.
 * */
export const sharedWebPreferences: WebPreferences = {
  nodeIntegration: false,
  contextIsolation: true,
  // Already the default since Electron 20. Stated because an unprivileged
  // renderer is a decision this template makes, not one it wants to inherit.
  sandbox: true,
  // Nothing in the app takes free text, and the spellchecker downloads a
  // dictionary per language the first time it runs.
  spellcheck: false,
  // A hidden window is throttled like one in the background, which would slow
  // down the timers and frames a test waits on
  backgroundThrottling: !isHiddenRun,
  devTools: isDevEnv,
  preload: preloadFile,
};

/* ------------------------------------------------------
 * Windows
 * ------------------------------------------------------ */

export interface WindowOptions {
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
  maxWindows: number;
  cascadeOffset: { x: number; y: number };
}

// Size and placement of every window `WindowManager` opens
export const windowOptions: WindowOptions = {
  width: 1280,
  height: 800,
  // The project screen's sidebar, toolbar and table need this much room
  minWidth: 880,
  minHeight: 560,
  // Upper bound on windows open at the same time, which keeps a runaway
  // shortcut from opening hundreds
  maxWindows: 20,
  // Each window is placed down and to the right of the one that opened it
  cascadeOffset: { x: 32, y: 32 },
};
