import { app, BrowserWindow } from 'electron';

import IPCs from './IPCs';
import AppMenu from './AppMenu';
import WindowManager from './WindowManager';
import { isDevEnv, isHiddenRun, userDataOverride } from './constants';
import { getSettings, loadSettings } from './settings';
import { closeStore, openStore } from './store';
import { closeAllProjects } from './sessions';
import { freezeWorkspace, loadWorkspace } from './workspace';

// How long a quit waits for the app's data file to close. A DaruDB commit is
// atomic, so quitting before a write finishes loses that one change and leaves
// the file intact, which is better than an app that never quits.
const STORE_CLOSE_TIMEOUT_MS = 5000;

let closingStore = false;

// Set before `ready`, so Chromium keeps its own storage in the same folder
if (userDataOverride) {
  app.setPath('userData', userDataOverride);
}

const installDevTron = async () => {
  try {
    const { devtron } = await import('@electron/devtron');
    await devtron.install();
  } catch {
    // Do nothing
  }
};

app.on('ready', async () => {
  if (isHiddenRun) {
    app.dock?.hide();
  }

  if (isDevEnv) {
    await import('./index.dev');
    // Awaited on purpose. Devtron wraps every renderer payload to track it and
    // unwraps it again by patching `ipcMain`, so a handler registered before
    // the patch is in place receives the wrapper object instead of its
    // arguments. `IPCs.initialize()` below has to come second.
    await installDevTron();
  }

  // Read before the first window, which is painted with the stored theme
  await openStore();
  await loadSettings();

  // Initialize IPC Communication. Handlers must be registered only once,
  // otherwise opening another window would attach duplicated listeners.
  IPCs.initialize();
  AppMenu.initialize();

  // The windows the app had open when it last quit, when the settings ask for them
  const restored = getSettings().restoreWorkspace ? await loadWorkspace() : [];

  if (restored.length === 0) {
    await WindowManager.create();
  }

  for (const window of restored) {
    await WindowManager.create('/', null, window);
  }
});

// The windows open now are the ones the next launch opens, so the list of them
// is kept before they close one after another
app.on('before-quit', () => {
  void freezeWorkspace();
});

/*
 * Closes the app's data file and the databases the windows have open, or gives
 * up on them after `STORE_CLOSE_TIMEOUT_MS`. Never rejects, since a quit goes
 * ahead either way.
 * */
const closeStoreBeforeQuit = async (): Promise<void> => {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), STORE_CLOSE_TIMEOUT_MS);
  });

  try {
    const closing = Promise.all([closeAllProjects(), closeStore()]).then(() => 'closed' as const);
    const result = await Promise.race([closing, timeout]);

    if (result === 'timeout') {
      console.warn(
        `The open files did not close within ${STORE_CLOSE_TIMEOUT_MS} ms. Quitting anyway.`,
      );
    }
  } catch (error) {
    console.error('Failed to close the open files:', error);
  } finally {
    clearTimeout(timer);
  }
};

// The files close before the app quits, so a quit does not cut a write short.
// They close once every window has, since a window that holds edits may ask to
// stay open, and so call the quit off. The first quit waits for the close, then
// quits again for real.
app.on('will-quit', (event) => {
  if (closingStore) {
    return;
  }

  event.preventDefault();
  closingStore = true;

  void closeStoreBeforeQuit().then(() => {
    // On the next turn: a quit asked for while Electron still handles the one
    // this handler put off is dropped, as it is when nothing was open to close
    setImmediate(() => app.quit());
  });
});

// Every window is the same, so the app ends with the last of them, except on
// macOS, where an app stays in the Dock until it is quit
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', async () => {
  if (app.isReady() && BrowserWindow.getAllWindows().length === 0) {
    await WindowManager.create();
  }
});
