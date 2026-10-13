import { mkdir, stat } from 'fs/promises';
import { basename, extname, join } from 'path';
import { BrowserWindow } from 'electron';
import { Database, FORMAT_VERSION } from 'darudb';
import {
  upgradeChoices,
  type DatabaseInfo,
  type OpenRequest,
  type OpenResult,
  type Project,
  type Session,
  type UpgradeChoice,
} from '@/common/projects';
import { isHiddenRun } from './constants';
import { schemaOf } from './data';
import { errorOf } from './files';
import {
  getProject,
  markOpened,
  rememberedPassword,
  rememberPassword,
  pointAtWorkingCopy,
  workingCopiesPath,
} from './projects';
import { canRememberSecrets } from './secrets';

/*
 * The projects the windows have open: one per window at most, and never one
 * project in two windows, since two screens editing the same objects would
 * each show what the other overwrote.
 *
 * The database handle lives here, in the main process, and a window reaches
 * it only through the channels in `IPCs.ts`. It closes with the project, with
 * the window, or when the app quits.
 * */

interface OpenProject {
  projectId: number;
  database: Database;
}

/* By the id of the window that has the project open */
const sessions = new Map<number, OpenProject>();

/* The windows whose closing already closes their project */
const watchedWindows = new WeakSet<BrowserWindow>();

/* The project `window` has open, with its database handle */
export const openProjectOf = (window: BrowserWindow | null): OpenProject | null =>
  (window && sessions.get(window.id)) ?? null;

/* Whether a window has the project open */
export const isProjectOpen = (projectId: number): boolean =>
  [...sessions.values()].some((session) => session.projectId === projectId);

const windowOfProject = (projectId: number): BrowserWindow | null => {
  for (const [windowId, session] of sessions) {
    if (session.projectId === projectId) {
      return BrowserWindow.fromId(windowId);
    }
  }

  return null;
};

const infoOf = async (database: Database): Promise<DatabaseInfo> => ({
  path: database.path,
  encrypted: database.isEncrypted,
  formatVersion: database.formatVersion,
  pageSize: database.pageSize,
  schemaVersion: database.schemaVersion,
  fileSize: (await stat(database.path)).size,
});

/* What the renderer sent, checked: a project id, and the options as the contract types them */
const checkRequest = (request: OpenRequest): OpenRequest => {
  const { projectId, password, rememberPassword: remember, upgrade } = request ?? {};

  if (!Number.isSafeInteger(projectId)) {
    throw new Error('a project is opened by its id');
  }

  if (password !== undefined && typeof password !== 'string') {
    throw new Error('a password is a string');
  }

  if (upgrade !== undefined && !upgradeChoices.includes(upgrade)) {
    throw new Error(`an upgrade is one of ${upgradeChoices.join(', ')}`);
  }

  return { projectId, password, rememberPassword: remember === true, upgrade };
};

const openFile = (path: string, password: string | undefined, upgradeFormat: boolean) =>
  Database.openAsync(path, {
    create: false,
    upgradeFormat,
    ...(password ? { password } : {}),
  });

/*
 * A path in the working copies folder for a copy of `project`'s file, named
 * after it. A backup never replaces a file, so the name is one nothing has.
 * */
const workingCopyPath = (project: Project): string => {
  const extension = extname(project.filePath) || '.darudb';
  const stem = basename(project.filePath, extname(project.filePath)).replace(/[^\w.-]+/g, '_');

  return join(workingCopiesPath(), `${stem}-${project.id}-${Date.now()}${extension}`);
};

/*
 * Writes a copy of `database`, the project's file, into the working copies
 * folder, raises the copy to the newest format version and points the project
 * at it. The original is closed and left as it was. Resolves with the copy.
 * */
const openOnWorkingCopy = async (
  project: Project,
  database: Database,
  password: string | undefined,
): Promise<Database> => {
  const copyPath = workingCopyPath(project);

  await mkdir(workingCopiesPath(), { recursive: true });
  // The same password opens the copy
  await database.backupAsync(copyPath);
  await database.closeAsync();

  const copy = await openFile(copyPath, password, true);

  await pointAtWorkingCopy(project.id, copyPath, project.filePath);

  return copy;
};

const raise = async (
  project: Project,
  database: Database,
  password: string | undefined,
  upgrade: UpgradeChoice,
): Promise<Database> => {
  if (upgrade === 'copy') {
    return openOnWorkingCopy(project, database, password);
  }

  await database.upgradeFormatAsync();

  return database;
};

/* Brings `window` forward, as a click on a project open in it asks */
const bringForward = (window: BrowserWindow): void => {
  if (window.isMinimized()) {
    window.restore();
  }

  // A test run never puts a window on the screen
  if (!isHiddenRun) {
    window.show();
    window.focus();
  }
};

/* Closes the project `window` has open, if it has one */
export const closeProject = async (window: BrowserWindow | null): Promise<boolean> => {
  const session = openProjectOf(window);

  if (!window || !session) {
    return false;
  }

  sessions.delete(window.id);

  try {
    await session.database.closeAsync();
  } catch (error) {
    console.error(`Failed to close the database of project ${session.projectId}:`, error);
  }

  return true;
};

/* Closes every open project, as the app quits */
export const closeAllProjects = async (): Promise<void> => {
  const open = [...sessions.values()];

  sessions.clear();
  await Promise.allSettled(open.map((session) => session.database.closeAsync()));
};

/*
 * Opens the project `request` names in `window`, closing the one the window
 * had open, if any. See `OpenResult` for what it can end in short of opening:
 * each of those leaves the window and the file as they were.
 * */
export const openProject = async (
  window: BrowserWindow,
  untrustedRequest: OpenRequest,
): Promise<OpenResult> => {
  const request = checkRequest(untrustedRequest);
  const project = await getProject(request.projectId);

  if (!project) {
    return { status: 'error', code: 'NOT_FOUND', message: 'the project no longer exists' };
  }

  const holder = windowOfProject(project.id);

  if (holder && holder !== window) {
    bringForward(holder);

    return { status: 'open-elsewhere' };
  }

  if (holder === window) {
    const { database } = openProjectOf(window)!;

    return {
      status: 'opened',
      project,
      database: await infoOf(database),
      schema: schemaOf(database),
    };
  }

  // A password typed now is tried instead of the remembered one
  const password = request.password ?? (await rememberedPassword(project.id)) ?? undefined;
  let database: Database;

  try {
    database = await openFile(project.filePath, password, false);
  } catch (error) {
    const { code, message } = errorOf(error);

    switch (code) {
      case 'NOT_FOUND':
        return { status: 'missing' };
      case 'KEY_REQUIRED':
        return { status: 'needs-password', retry: false };
      case 'WRONG_KEY':
        return { status: 'needs-password', retry: true };
      case 'NOT_A_DATABASE':
        return { status: 'not-database' };
      default:
        return { status: 'error', code, message };
    }
  }

  try {
    if (database.formatVersion < FORMAT_VERSION) {
      if (request.upgrade === undefined) {
        const { formatVersion } = database;

        await database.closeAsync();

        return { status: 'needs-upgrade', formatVersion, newestVersion: FORMAT_VERSION };
      }

      database = await raise(project, database, password, request.upgrade);
    }

    if (request.password !== undefined && request.rememberPassword && canRememberSecrets()) {
      await rememberPassword(project.id, request.password);
    }

    await closeProject(window);
    sessions.set(window.id, { projectId: project.id, database });

    if (!watchedWindows.has(window)) {
      watchedWindows.add(window);
      window.on('closed', () => {
        const session = sessions.get(window.id);

        sessions.delete(window.id);
        void session?.database.closeAsync().catch((error: unknown) => {
          console.error('Failed to close a database with its window:', error);
        });
      });
    }

    await markOpened(project.id);

    return {
      status: 'opened',
      project: (await getProject(project.id)) ?? project,
      database: await infoOf(database),
      schema: schemaOf(database),
    };
  } catch (error) {
    await database.closeAsync().catch(() => undefined);

    return { status: 'error', ...errorOf(error) };
  }
};

/* The project `window` has open, as its screen shows it, or `null` */
export const sessionOf = async (window: BrowserWindow | null): Promise<Session | null> => {
  const open = openProjectOf(window);

  if (!open) {
    return null;
  }

  const project = await getProject(open.projectId);

  return project
    ? { project, database: await infoOf(open.database), schema: schemaOf(open.database) }
    : null;
};
