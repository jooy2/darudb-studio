import { app, BrowserWindow } from 'electron';

import IPCs from './IPCs';
import WindowManager from './WindowManager';
import {
  appIndexFile,
  devServerUrl,
  isDevEnv,
  isHiddenRun,
  sharedWebPreferences,
  userDataOverride,
} from './constants';
import { registerWindowSecurity } from './security';
import { getBackgroundColor } from './appearance';
import { closeSettings, openSettings } from './settings';

// How long a quit waits for the settings file to close. A DaruDB commit is
// atomic, so quitting before a write finishes loses that one change and leaves
// the file intact, which is better than an app that never quits.
const SETTINGS_CLOSE_TIMEOUT_MS = 5000;

let mainWindow: BrowserWindow;
let closingSettings = false;

// Set before `ready`, so Chromium keeps its own storage in the same folder
if (userDataOverride) {
  app.setPath('userData', userDataOverride);
}

const exitApp = (): void => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.hide();
    mainWindow.destroy();
  }
  app.quit();
};

const installDevTron = async () => {
  try {
    const { devtron } = await import('@electron/devtron');
    await devtron.install();
  } catch {
    // Do nothing
  }
};

const createWindow = async () => {
  mainWindow = new BrowserWindow({
    width: 1160,
    height: 600,
    // Keep the window hidden until the first paint is ready to avoid a white flash
    show: false,
    backgroundColor: getBackgroundColor(),
    webPreferences: sharedWebPreferences,
  });

  // `BrowserWindow.setMenu` is only supported on Windows and Linux. The macOS
  // application menu is left untouched so that standard shortcuts such as
  // Cmd+Q and Cmd+C keep working.
  if (process.platform !== 'darwin') {
    mainWindow.setMenu(null);
  }

  mainWindow.on('close', (event): void => {
    // Windows opened on top of this one go with it, so that the app is never
    // left running with windows the user cannot get back to the main one from.
    WindowManager.closeAll();

    // On macOS it is conventional to keep the app running after the window is
    // closed, so the default behavior is kept and `activate` re-creates it.
    if (process.platform === 'darwin') {
      return;
    }

    event.preventDefault();
    exitApp();
  });

  // Never let the renderer navigate away from the application itself.
  // Everything that points somewhere else is handed to the default browser.
  registerWindowSecurity(mainWindow);

  mainWindow.once('ready-to-show', (): void => {
    // A test run drives the window without ever putting it on the screen
    if (isHiddenRun) {
      return;
    }

    // Opened here rather than on `did-frame-finish-load`, which fires again for
    // every frame the page loads and on every reload.
    if (isDevEnv) {
      mainWindow.webContents.openDevTools();
    }

    mainWindow.setAlwaysOnTop(true);
    mainWindow.show();
    mainWindow.focus();
    mainWindow.setAlwaysOnTop(false);
  });

  if (isDevEnv) {
    await mainWindow.loadURL(devServerUrl);
  } else {
    await mainWindow.loadFile(appIndexFile);
  }
};

app.on('ready', async () => {
  if (isHiddenRun) {
    app.dock?.hide();
  }

  // Disable special menus on macOS by uncommenting the following, if necessary
  /*
  if (process.platform === 'darwin') {
    systemPreferences.setUserDefault('NSDisabledDictationMenuItem', 'boolean', true);
    systemPreferences.setUserDefault('NSDisabledCharacterPaletteMenuItem', 'boolean', true);
  }
  */

  if (isDevEnv) {
    await import('./index.dev');
    // Awaited on purpose. Devtron wraps every renderer payload to track it and
    // unwraps it again by patching `ipcMain`, so a handler registered before
    // the patch is in place receives the wrapper object instead of its
    // arguments. `IPCs.initialize()` below has to come second.
    await installDevTron();
  }

  // Read before the first window, which is painted with the stored theme
  await openSettings();

  // Initialize IPC Communication. Handlers must be registered only once,
  // otherwise re-creating the window would attach duplicated listeners.
  IPCs.initialize();

  await createWindow();
});

/*
 * Closes the settings file, or gives up on it after
 * `SETTINGS_CLOSE_TIMEOUT_MS`. Never rejects, since a quit goes ahead either way.
 * */
const closeSettingsBeforeQuit = async (): Promise<void> => {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), SETTINGS_CLOSE_TIMEOUT_MS);
  });

  try {
    const result = await Promise.race([closeSettings().then(() => 'closed' as const), timeout]);

    if (result === 'timeout') {
      console.warn(
        `The settings file did not close within ${SETTINGS_CLOSE_TIMEOUT_MS} ms. Quitting anyway.`,
      );
    }
  } catch (error) {
    console.error('Failed to close the settings file:', error);
  } finally {
    clearTimeout(timer);
  }
};

// The settings file closes before the app quits, so a quit does not cut a write
// short. The first quit waits for the close, then quits again for real.
app.on('before-quit', (event) => {
  if (closingSettings) {
    return;
  }

  event.preventDefault();
  closingSettings = true;

  void closeSettingsBeforeQuit().then(() => {
    app.quit();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    await createWindow();
  }
});
