import { BrowserWindow, dialog, screen, type Rectangle } from 'electron';
import { translate } from '@/common/translations';
import {
  appIndexFile,
  devServerUrl,
  isDevEnv,
  isHiddenRun,
  sharedWebPreferences,
  windowOptions,
} from './constants';
import { isAllowedWindowPath, registerWindowSecurity } from './security';
import {
  getBackgroundColor,
  getLanguage,
  getTitleBarOverlay,
  TITLE_BAR_HEIGHT,
} from './appearance';
import { resumeWorkspace, setRestore, trackWindow, type SavedWindow } from './workspace';
import type { WindowState } from '@/common/workspace';

/*
 * The app's windows.
 *
 * Every window is the same: it opens on the project list, and can open one
 * project. None of them is the main one, so closing any of them leaves the
 * others as they were, and the app quits when the last one closes, except on
 * macOS, where it stays in the Dock and `activate` opens a new one.
 * */
export default class WindowManager {
  static #opened = 0;

  /*
   * Opens a window on the renderer route `path`, placed down and to the right
   * of `opener` when there is one, or where `restore` was when the app last
   * quit, showing what it showed. `shows` opens a project in the window, as a
   * restored one would. Resolves with the window, or with `null`
   * when the request was refused: a route that is not one of the app's, or
   * too many windows already.
   * */
  static async create(
    path = '/',
    opener?: BrowserWindow | null,
    restore?: SavedWindow,
    shows?: WindowState,
  ): Promise<BrowserWindow | null> {
    if (!isAllowedWindowPath(path)) {
      console.warn(`Blocked a window open with an unsupported route: ${path}`);

      return null;
    }

    if (BrowserWindow.getAllWindows().length >= windowOptions.maxWindows) {
      console.warn(`Reached the maximum number of windows (${windowOptions.maxWindows}).`);

      return null;
    }

    const first = WindowManager.#opened === 0;
    const window = new BrowserWindow({
      width: windowOptions.width,
      height: windowOptions.height,
      minWidth: windowOptions.minWidth,
      minHeight: windowOptions.minHeight,
      // Kept hidden until the first paint is ready, which avoids a white flash
      show: false,
      backgroundColor: getBackgroundColor(),
      // The page draws the title bar: the header of every screen is the bar
      // the window is dragged by, and the system's own buttons sit in it, the
      // traffic lights of macOS at its left, the buttons of Windows and Linux
      // at its right. The page reads where they are from the window controls
      // overlay, see `.app-header` in `screens.css`.
      titleBarStyle: 'hidden',
      ...(process.platform === 'darwin'
        ? { titleBarOverlay: true, trafficLightPosition: { x: 16, y: (TITLE_BAR_HEIGHT - 16) / 2 } }
        : { titleBarOverlay: getTitleBarOverlay() }),
      webPreferences: sharedWebPreferences,
      ...(restore
        ? WindowManager.#restoredBounds(restore.bounds)
        : WindowManager.#cascadeBounds(opener)),
    });

    WindowManager.#opened += 1;
    trackWindow(window);

    // What the window opens once its page asks: a restored window's project and
    // tabs, or the project it was opened for
    const state =
      shows ?? (restore ? { projectId: restore.projectId, layout: restore.layout } : null);

    if (state) {
      setRestore(window.webContents, state);
    }

    // The window draws its own menu bar from the same menu, so the native one
    // is hidden on Windows and Linux, as a window without a frame has no room
    // for it anyway; its accelerators still work. The macOS menu bar belongs
    // to the system and stays.
    if (process.platform !== 'darwin') {
      window.setMenuBarVisibility(false);
    }

    // A page that holds edits for a submit asks before it goes, by refusing to
    // unload; Electron leaves the question to the app. A test run puts no
    // dialog on the screen, and lets the page go.
    window.webContents.on('will-prevent-unload', (event) => {
      if (isHiddenRun) {
        event.preventDefault();

        return;
      }

      const language = getLanguage();
      const choice = dialog.showMessageBoxSync(window, {
        type: 'warning',
        buttons: [translate(language, 'unload.leave'), translate(language, 'common.cancel')],
        defaultId: 1,
        cancelId: 1,
        message: translate(language, 'unload.title'),
        detail: translate(language, 'unload.text'),
      });

      // Letting the unload go ahead is what closing without the edits takes.
      // Kept open, the window calls off a quit, and the list of open windows
      // follows the windows again.
      if (choice === 0) {
        event.preventDefault();
      } else {
        resumeWorkspace();
      }
    });

    // Never let the renderer navigate away from the application itself.
    // Everything that points somewhere else is handed to the default browser.
    registerWindowSecurity(window);

    window.once('ready-to-show', (): void => {
      // A test run drives the window without ever putting it on the screen
      if (isHiddenRun) {
        return;
      }

      if (isDevEnv && first) {
        window.webContents.openDevTools();
      }

      window.setAlwaysOnTop(true);
      window.show();
      window.focus();
      window.setAlwaysOnTop(false);

      // Both show the window, so a test run, which returned above, never gets here
      if (restore?.maximized) {
        window.maximize();
      }

      if (restore?.fullScreen) {
        window.setFullScreen(true);
      }
    });

    try {
      if (isDevEnv) {
        await window.loadURL(`${devServerUrl}#${path}`);
      } else {
        await window.loadFile(appIndexFile, { hash: path });
      }
    } catch (error) {
      // A load can fail or be aborted, and the window would otherwise stay
      // open showing nothing.
      console.error(`Failed to load the window route "${path}":`, error);

      if (!window.isDestroyed()) {
        window.destroy();
      }

      return null;
    }

    return window;
  }

  /*
   * Where a window the app had open goes again: where it was, when that is
   * still on a display, or at its size where the system puts it, as when the
   * display it was on is gone.
   * */
  static #restoredBounds(bounds: Rectangle): Partial<Rectangle> {
    const width = Math.max(windowOptions.minWidth, Math.round(bounds.width));
    const height = Math.max(windowOptions.minHeight, Math.round(bounds.height));
    // Enough of the window on a display to take hold of it
    const visible = screen.getAllDisplays().some(({ workArea }) => {
      const across =
        Math.min(bounds.x + width, workArea.x + workArea.width) - Math.max(bounds.x, workArea.x);
      const down =
        Math.min(bounds.y + height, workArea.y + workArea.height) - Math.max(bounds.y, workArea.y);

      return across >= 120 && down >= 60;
    });

    return visible
      ? { x: Math.round(bounds.x), y: Math.round(bounds.y), width, height }
      : { width, height };
  }

  /*
   * Offsets a new window from the one that opened it, then keeps it inside the
   * work area of the display that window sits on. Without the clamp a long
   * cascade would walk windows off the bottom right of the screen.
   * */
  static #cascadeBounds(
    opener?: BrowserWindow | null,
  ): { x: number; y: number } | Record<string, never> {
    if (!opener || opener.isDestroyed()) {
      return {};
    }

    const bounds = opener.getBounds();
    const { workArea } = screen.getDisplayMatching(bounds);
    const { cascadeOffset, width, height } = windowOptions;

    return {
      x: Math.max(
        workArea.x,
        Math.min(workArea.x + workArea.width - width, bounds.x + cascadeOffset.x),
      ),
      y: Math.max(
        workArea.y,
        Math.min(workArea.y + workArea.height - height, bounds.y + cascadeOffset.y),
      ),
    };
  }
}
