import {
  app,
  BrowserWindow,
  Menu,
  type MenuItemConstructorOptions,
  type WebContents,
} from 'electron';
import {
  buildMenu,
  drawnMenu,
  menuEntries,
  REPOSITORY_URL,
  WEBSITE_URL,
  type AppCommand,
  type MenuEntry,
  type MenuPlatform,
  type MenuRole,
} from '@/common/menu';
import { rendererChannels } from '@/common/ipc';
import { translate } from '@/common/translations';
import { isDevEnv } from './constants';
import { getLanguage } from './appearance';
import { openExternalLink } from './security';
import WindowManager from './WindowManager';

/*
 * The application menu: the native one, built from `common/menu`, and what
 * clicking an entry of the menu bar a window draws does.
 *
 * A click in either menu goes through `run`, so a window's menu bar does what
 * the native menu does: a role through the window's web contents or the app,
 * and a command of this app either here or in the window it is for.
 * */

const APP_NAME = 'DaruDB Studio';

const platform: MenuPlatform = process.platform === 'darwin' ? 'mac' : 'other';

/* What each window shows, for the entries that need a project */
const projectWindows = new Set<number>();

/*
 * The pages that listen for menu commands, by the id of their web contents,
 * and the commands that wait for a page that does not listen yet: one that is
 * still loading, as a window the command itself opened.
 * */
const listeningPages = new Set<number>();
const waitingCommands = new Map<number, AppCommand[]>();

const sendCommand = (contents: WebContents, command: AppCommand): void => {
  if (listeningPages.has(contents.id)) {
    contents.send(rendererChannels.menuCommand, command);

    return;
  }

  waitingCommands.set(contents.id, [...(waitingCommands.get(contents.id) ?? []), command]);
};

/*
 * Does `role` for `window`, as Electron's own menu item would. The native menu
 * hands its roles to Electron; this is for the menu bar a window draws.
 * */
const runRole = (role: MenuRole, window: BrowserWindow | null): void => {
  const contents: WebContents | undefined = window?.webContents;

  switch (role) {
    case 'about':
      app.showAboutPanel();
      return;
    case 'hide':
      app.hide();
      return;
    case 'hideOthers':
      Menu.sendActionToFirstResponder('hideOtherApplications:');
      return;
    case 'unhide':
      Menu.sendActionToFirstResponder('unhideAllApplications:');
      return;
    case 'front':
      Menu.sendActionToFirstResponder('arrangeInFront:');
      return;
    case 'quit':
      app.quit();
      return;
    case 'undo':
      contents?.undo();
      return;
    case 'redo':
      contents?.redo();
      return;
    case 'cut':
      contents?.cut();
      return;
    case 'copy':
      contents?.copy();
      return;
    case 'paste':
      contents?.paste();
      return;
    case 'pasteAndMatchStyle':
      contents?.pasteAndMatchStyle();
      return;
    case 'delete':
      contents?.delete();
      return;
    case 'selectAll':
      contents?.selectAll();
      return;
    case 'reload':
      contents?.reload();
      return;
    case 'forceReload':
      contents?.reloadIgnoringCache();
      return;
    case 'resetZoom':
      contents?.setZoomLevel(0);
      return;
    case 'zoomIn':
      contents?.setZoomLevel(contents.getZoomLevel() + 0.5);
      return;
    case 'zoomOut':
      contents?.setZoomLevel(contents.getZoomLevel() - 0.5);
      return;
    case 'togglefullscreen':
      window?.setFullScreen(!window.isFullScreen());
      return;
    case 'minimize':
      window?.minimize();
      return;
    case 'zoom':
      if (window?.isMaximized()) {
        window.unmaximize();
      } else {
        window?.maximize();
      }
      return;
    case 'close':
      window?.close();
      return;
    default:
      // The services, speech and window menus are the system's, and only the
      // native menu has them
      return;
  }
};

/*
 * Does `command` for `window`: here when it concerns the app, and in the
 * window when it concerns what the window shows.
 * */
const runCommand = async (command: AppCommand, window: BrowserWindow | null): Promise<void> => {
  switch (command) {
    case 'new-window':
      await WindowManager.create('/', window);
      return;
    case 'new-project': {
      // A window showing a project keeps it: the new one is made in a window of
      // its own, as it is when no window is open
      const keepsWindow = window !== null && !projectWindows.has(window.id);
      const target = keepsWindow ? window : await WindowManager.create('/', window);

      if (target && !target.isDestroyed()) {
        sendCommand(target.webContents, command);
      }

      return;
    }
    case 'open-website':
      await openExternalLink(WEBSITE_URL);
      return;
    case 'open-repository':
      await openExternalLink(REPOSITORY_URL);
      return;
    default: {
      // Without a window, as on macOS with every window closed, one opens and
      // the command waits for its page rather than being lost
      const target = window ?? (await WindowManager.create());

      if (target && !target.isDestroyed()) {
        sendCommand(target.webContents, command);
      }
    }
  }
};

const run = (entry: MenuEntry, window: BrowserWindow | null): void => {
  if (entry.role) {
    runRole(entry.role, window);
  } else if (entry.command) {
    void runCommand(entry.command, window);
  }
};

const label = (entry: MenuEntry): string =>
  entry.label ? translate(getLanguage(), entry.label, { name: APP_NAME }) : APP_NAME;

/* `entries` as Electron's menu template, in the language the user picked */
const templateOf = (
  entries: readonly MenuEntry[],
  focused: BrowserWindow | null,
): MenuItemConstructorOptions[] =>
  entries.map((entry): MenuItemConstructorOptions => {
    if (entry.separator) {
      return { id: entry.id, type: 'separator' };
    }

    const item: MenuItemConstructorOptions = {
      id: entry.id,
      label: label(entry),
      ...(entry.accelerator ? { accelerator: entry.accelerator } : {}),
      ...(entry.needsProject
        ? { enabled: focused !== null && projectWindows.has(focused.id) }
        : {}),
    };

    if (entry.submenu) {
      // `window` and `services` are roles of a whole menu that the system fills
      return {
        ...item,
        ...(entry.role === 'window' || entry.role === 'services' ? { role: entry.role } : {}),
        submenu: templateOf(entry.submenu, focused),
      };
    }

    if (entry.role) {
      // A role the native menu does itself, with the app's own label. The
      // macOS app menu titled with the app's name is the system's to fill.
      return { ...item, role: entry.role };
    }

    return {
      ...item,
      click: (_menuItem, browserWindow) => {
        run(entry, browserWindow instanceof BrowserWindow ? browserWindow : null);
      },
    };
  });

export default class AppMenu {
  static #menus: MenuEntry[] = [];

  /*
   * Builds the native menu, and rebuilds it as the focus moves between
   * windows, whose entries for a project differ.
   * */
  static initialize(): void {
    AppMenu.#menus = buildMenu(platform, isDevEnv);

    app.setAboutPanelOptions({
      applicationName: APP_NAME,
      applicationVersion: app.getVersion(),
      copyright: `© ${new Date().getFullYear()} CDGet`,
    });
    app.on('browser-window-focus', () => AppMenu.refresh());
    app.on('browser-window-created', (_event, window) => {
      const contentsId = window.webContents.id;

      window.on('closed', () => {
        projectWindows.delete(window.id);
        listeningPages.delete(contentsId);
        waitingCommands.delete(contentsId);
      });
      // A page that goes away, as on a reload, stops listening until the next
      // one says it does. A move between routes stays in the same page.
      window.webContents.on('did-start-navigation', ({ isMainFrame, isSameDocument }) => {
        if (isMainFrame && !isSameDocument) {
          listeningPages.delete(contentsId);
        }
      });
    });
    AppMenu.refresh();
  }

  /* The entries a window draws its menu bar from, without the system's own */
  static entries(): MenuEntry[] {
    return drawnMenu(AppMenu.#menus);
  }

  /*
   * Does what the entry `id` does, for `window`, as a click in the menu bar a
   * window draws asks. An unknown id, or an entry the system owns, does
   * nothing.
   * */
  static invoke(id: unknown, window: BrowserWindow | null): void {
    const entry = menuEntries(AppMenu.entries()).find((each) => each.id === id);

    if (!entry || entry.separator || entry.submenu) {
      console.warn(`Ignored a click on an unknown menu entry: ${String(id)}`);

      return;
    }

    if (entry.needsProject && !(window && projectWindows.has(window.id))) {
      return;
    }

    run(entry, window);
  }

  /* Sends the commands that waited for the page of `contents`, and the next ones as they come */
  static listen(contents: WebContents): void {
    listeningPages.add(contents.id);

    const waiting = waitingCommands.get(contents.id) ?? [];

    waitingCommands.delete(contents.id);
    waiting.forEach((command) => sendCommand(contents, command));
  }

  /* Records whether `window` shows a project, which enables the entries that need one */
  static setShowsProject(window: BrowserWindow | null, showsProject: boolean): void {
    if (!window) {
      return;
    }

    if (showsProject) {
      projectWindows.add(window.id);
    } else {
      projectWindows.delete(window.id);
    }

    AppMenu.refresh();
  }

  /* Builds the native menu again, for the language and the focused window of now */
  static refresh(): void {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate(templateOf(AppMenu.#menus, BrowserWindow.getFocusedWindow())),
    );
  }
}
