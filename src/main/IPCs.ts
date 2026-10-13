import { readFile } from 'fs/promises';
import { BrowserWindow, IpcMainEvent, IpcMainInvokeEvent, ipcMain } from 'electron';
import {
  mainChannels,
  rendererChannels,
  type MainChannel,
  type MainChannelArgs,
  type MainChannelResult,
} from '@/common/ipc';
import { openExternalLink } from './security';
import { refreshTitleBars } from './appearance';
import { noticesFile } from './constants';
import { reportWindowState, takeRestore } from './workspace';
import { changePassword, rescueOpenProject, rescueProject } from './tools';
import { exportObjects, importObjects } from './transfer';
import { createSampleProject } from './sample';
import WindowManager from './WindowManager';
import AppMenu from './AppMenu';
import { getSettings, updateSettings, validSettingChanges } from './settings';
import { deleteProject, getProject, listProjects, saveProject } from './projects';
import { checkDatabaseFile, chooseDatabaseFile } from './files';
import { canRememberSecrets } from './secrets';
import { canOpenAtLogin, setOpenAtLogin } from './startup';
import { closeProject, isProjectOpen, openProject, openProjectOf, sessionOf } from './sessions';
import {
  backupDatabase,
  checkDatabase,
  compactDatabase,
  countObjects,
  readPage,
  runQuery,
  writeChanges,
} from './data';

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

    // The stored preferences, which a window reads before its first render
    handle(mainChannels.requestSettings, () => getSettings());

    // A change of the preferences a window makes. Only the valid ones are
    // kept, and every other window hears of them, each running its own copy of
    // the renderer with its own store.
    handle(mainChannels.updateSettings, async (event, changes) => {
      const valid = validSettingChanges(changes);

      // Kept as the system took it, which may refuse
      if (valid.openAtLogin !== undefined) {
        valid.openAtLogin = await setOpenAtLogin(valid.openAtLogin);
      }

      updateSettings(valid);

      // The native menu is labelled in the language too
      if (valid.language !== undefined) {
        AppMenu.refresh();
      }

      // And the window's own buttons are drawn in the theme
      if (valid.darkTheme !== undefined) {
        refreshTitleBars();
      }

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
      if (typeof draft?.id === 'number' && isProjectOpen(draft.id)) {
        const current = await getProject(draft.id);

        if (current && current.filePath !== draft.filePath) {
          throw new Error('the file of a project cannot change while a window has it open');
        }
      }

      const project = await saveProject(draft);

      broadcast(rendererChannels.projectsChanged, BrowserWindow.fromWebContents(event.sender));

      return project;
    });

    handle(mainChannels.deleteProject, async (event, id) => {
      if (isProjectOpen(id)) {
        throw new Error('a project cannot be deleted while a window has it open');
      }

      await deleteProject(id);
      broadcast(rendererChannels.projectsChanged, BrowserWindow.fromWebContents(event.sender));
    });

    handle(mainChannels.createSampleProject, async (event) => {
      const project = await createSampleProject();

      broadcast(rendererChannels.projectsChanged, BrowserWindow.fromWebContents(event.sender));

      return project;
    });

    handle(mainChannels.chooseDatabaseFile, (event, title) =>
      chooseDatabaseFile(BrowserWindow.fromWebContents(event.sender), String(title)),
    );

    handle(mainChannels.checkDatabaseFile, (event, path, password) =>
      checkDatabaseFile(path, typeof password === 'string' ? password : undefined),
    );

    handle(mainChannels.canRememberPasswords, () => canRememberSecrets());

    handle(mainChannels.canOpenAtLogin, () => canOpenAtLogin());

    // A window opens one project at a time, and the menu's project entries
    // follow what the window has open. Opening one reorders the list.
    handle(mainChannels.openProject, async (event, request) => {
      const window = BrowserWindow.fromWebContents(event.sender);

      if (!window) {
        return { status: 'error', code: 'INTERNAL', message: 'the window is gone' };
      }

      const result = await openProject(window, request);

      if (result.status === 'opened') {
        AppMenu.setShowsProject(window, true);
        broadcast(rendererChannels.projectsChanged, window);
      }

      return result;
    });

    handle(mainChannels.closeProject, async (event) => {
      const window = BrowserWindow.fromWebContents(event.sender);
      const closed = await closeProject(window);

      AppMenu.setShowsProject(window, false);

      return closed;
    });

    handle(mainChannels.requestNotices, () => readFile(noticesFile, 'utf8').catch(() => null));

    on(mainChannels.reportWindowState, (event, state) => {
      reportWindowState(BrowserWindow.fromWebContents(event.sender), state);
    });

    handle(mainChannels.takeWindowRestore, (event) => takeRestore(event.sender));

    handle(mainChannels.requestSession, (event) =>
      sessionOf(BrowserWindow.fromWebContents(event.sender)),
    );

    // The objects of the project the window has open. Each one names no
    // project: it is always the sender's own, which a window cannot change.
    const databaseOf = (event: IpcMainInvokeEvent) =>
      openProjectOf(BrowserWindow.fromWebContents(event.sender))?.database ?? null;
    const noProject = {
      status: 'error',
      code: 'NO_PROJECT',
      message: 'the window has no project open',
    } as const;

    handle(mainChannels.countObjects, (event) => {
      const database = databaseOf(event);

      return database ? countObjects(database) : noProject;
    });

    handle(mainChannels.readPage, (event, request) => {
      const database = databaseOf(event);

      return database ? readPage(database, request) : noProject;
    });

    handle(mainChannels.writeChanges, (event, changes) => {
      const database = databaseOf(event);

      return database ? writeChanges(database, changes) : { ...noProject, index: null };
    });

    handle(mainChannels.runQuery, (event, request) => {
      const database = databaseOf(event);

      return database ? runQuery(database, request) : noProject;
    });

    handle(mainChannels.checkDatabase, (event) => {
      const database = databaseOf(event);

      return database ? checkDatabase(database) : noProject;
    });

    handle(mainChannels.compactDatabase, (event) => {
      const database = databaseOf(event);

      return database ? compactDatabase(database) : noProject;
    });

    handle(mainChannels.backupDatabase, (event, title, password) => {
      const database = databaseOf(event);

      return database
        ? backupDatabase(
            database,
            BrowserWindow.fromWebContents(event.sender),
            String(title),
            password,
          )
        : noProject;
    });

    // A rescue closes the window's file and opens it again, and adds a project
    handle(mainChannels.rescueDatabase, async (event, title) => {
      const window = BrowserWindow.fromWebContents(event.sender);

      if (!window) {
        return noProject;
      }

      const result = await rescueOpenProject(window, String(title));

      if (result.status === 'ok') {
        AppMenu.setShowsProject(window, result.report.reopened);
        broadcast(rendererChannels.projectsChanged, null);
      }

      return result;
    });

    handle(mainChannels.rescueProject, async (event, projectId, password, title) => {
      const result = await rescueProject(
        BrowserWindow.fromWebContents(event.sender),
        projectId,
        password,
        String(title),
      );

      if (result.status === 'ok') {
        broadcast(rendererChannels.projectsChanged, BrowserWindow.fromWebContents(event.sender));
      }

      return result;
    });

    handle(mainChannels.exportObjects, (event, request, title) => {
      const database = databaseOf(event);

      return database
        ? exportObjects(
            database,
            BrowserWindow.fromWebContents(event.sender),
            request,
            String(title),
          )
        : noProject;
    });

    handle(mainChannels.importObjects, (event, collection, mode, title) => {
      const database = databaseOf(event);

      return database
        ? importObjects(
            database,
            BrowserWindow.fromWebContents(event.sender),
            collection,
            mode,
            String(title),
          )
        : noProject;
    });

    handle(mainChannels.changePassword, (event, password) => {
      const window = BrowserWindow.fromWebContents(event.sender);

      return window ? changePassword(window, password) : noProject;
    });

    handle(mainChannels.openProjectWindow, async (event, projectId) => {
      if (!Number.isSafeInteger(projectId)) {
        return false;
      }

      const window = await WindowManager.create(
        '/',
        BrowserWindow.fromWebContents(event.sender),
        undefined,
        {
          projectId,
          layout: null,
        },
      );

      return window !== null;
    });
  }
}
