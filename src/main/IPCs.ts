import { BrowserWindow, IpcMainEvent, IpcMainInvokeEvent, ipcMain } from 'electron';
import {
  mainChannels,
  rendererChannels,
  type MainChannel,
  type MainChannelArgs,
  type MainChannelResult,
} from '@/common/ipc';
import { openExternalLink } from './security';
import WindowManager from './WindowManager';
import AppMenu from './AppMenu';
import { setDarkTheme, setLanguage } from './appearance';
import { getSettings, updateSettings, validSettingChanges } from './settings';
import { deleteProject, listProjects, saveProject } from './projects';
import { checkDatabaseFile, chooseDatabaseFile } from './files';
import { canRememberSecrets } from './secrets';

/*
 * Sends `channel` to every window but `sender`, which already knows.
 * */
const broadcast = <Args extends unknown[]>(
  channel: string,
  sender: BrowserWindow | null,
  ...args: Args
): void => {
  BrowserWindow.getAllWindows().forEach((browserWindow) => {
    if (!browserWindow.isDestroyed() && browserWindow !== sender) {
      browserWindow.webContents.send(channel, ...args);
    }
  });
};

/*
 * `ipcMain.on` and `ipcMain.handle`, checked against the contract in
 * `common/ipc`. A handler that reads its arguments wrongly, or answers with the
 * wrong type, is a build error here rather than something the renderer runs
 * into.
 * */
const on = <Channel extends MainChannel>(
  channel: Channel,
  listener: (event: IpcMainEvent, ...args: MainChannelArgs<Channel>) => void,
): void => {
  ipcMain.on(channel, listener);
};

const handle = <Channel extends MainChannel>(
  channel: Channel,
  handler: (
    event: IpcMainInvokeEvent,
    ...args: MainChannelArgs<Channel>
  ) => MainChannelResult<Channel> | Promise<MainChannelResult<Channel>>,
): void => {
  ipcMain.handle(channel, handler);
};

/*
 * IPC Communications
 * */
export default class IPCs {
  static initialize(): void {
    // Open url via web browser
    on(mainChannels.openExternalLink, async (event, url) => {
      await openExternalLink(url);
    });

    // A window keeps its own store, so an explicit theme or language choice is
    // reported here and handed to the windows that are already open
    on(mainChannels.setDarkTheme, (event, darkTheme) => {
      setDarkTheme(darkTheme, BrowserWindow.fromWebContents(event.sender));
    });

    // The native menu is labelled in the language too
    on(mainChannels.setLanguage, (event, language) => {
      setLanguage(language, BrowserWindow.fromWebContents(event.sender));
      AppMenu.refresh();
    });

    // Open a renderer route in a window of its own. Returns the id of the new
    // window, or `null` when the request was refused (window limit reached,
    // route not allowed)
    handle(mainChannels.openWindow, async (event, path) => {
      const window = await WindowManager.create(path, BrowserWindow.fromWebContents(event.sender));

      return window?.id ?? null;
    });

    // Close the window the request came from
    handle(mainChannels.closeWindow, (event) => {
      const window = BrowserWindow.fromWebContents(event.sender);

      window?.close();

      return window !== null;
    });

    // What a window draws its menu bar from, and the clicks on it
    handle(mainChannels.requestMenu, () => ({
      entries: AppMenu.entries(),
      platform: process.platform === 'darwin' ? 'mac' : 'other',
    }));

    on(mainChannels.invokeMenuEntry, (event, id) => {
      AppMenu.invoke(id, BrowserWindow.fromWebContents(event.sender));
    });

    on(mainChannels.listenMenuCommands, (event) => {
      AppMenu.listen(event.sender);
    });

    on(mainChannels.setShowsProject, (event, showsProject) => {
      AppMenu.setShowsProject(BrowserWindow.fromWebContents(event.sender), showsProject === true);
    });

    // The stored preferences, which a window reads before its first render
    handle(mainChannels.requestSettings, () => getSettings());

    // A change of the preferences a window's settings dialog makes. Only the
    // valid ones are kept, and every other window hears of them.
    handle(mainChannels.updateSettings, (event, changes) => {
      updateSettings(validSettingChanges(changes));

      const settings = getSettings();

      broadcast(
        rendererChannels.settingsUpdated,
        BrowserWindow.fromWebContents(event.sender),
        settings,
      );

      return settings;
    });

    handle(mainChannels.listProjects, () => listProjects());

    // Every window shows the list, so a change in one reaches the others
    handle(mainChannels.saveProject, async (event, draft) => {
      const project = await saveProject(draft);

      broadcast(rendererChannels.projectsChanged, BrowserWindow.fromWebContents(event.sender));

      return project;
    });

    handle(mainChannels.deleteProject, async (event, id) => {
      await deleteProject(id);
      broadcast(rendererChannels.projectsChanged, BrowserWindow.fromWebContents(event.sender));
    });

    handle(mainChannels.chooseDatabaseFile, (event, title) =>
      chooseDatabaseFile(BrowserWindow.fromWebContents(event.sender), String(title)),
    );

    handle(mainChannels.checkDatabaseFile, (event, path, password) =>
      checkDatabaseFile(path, typeof password === 'string' ? password : undefined),
    );

    handle(mainChannels.canRememberPasswords, () => canRememberSecrets());
  }
}
