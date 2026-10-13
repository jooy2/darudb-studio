import { rename, rm } from 'fs/promises';
import { basename, dirname, extname, join } from 'path';
import { BrowserWindow, dialog } from 'electron';
import { Database } from 'darudb';
import { PROJECT_NAME_MAX_LENGTH, type Project } from '@/common/projects';
import type { RescueReport, ToolResult } from '@/common/data';
import { translate } from '@/common/translations';
import { getLanguage } from './appearance';
import { errorOf } from './files';
import { getProject, rememberedPassword, rememberPassword, saveProject } from './projects';
import { canRememberSecrets } from './secrets';
import {
  isProjectOpen,
  openProjectOf,
  sessionOf,
  setSessionPassword,
  withFileAlone,
} from './sessions';

/*
 * The tools that do more than read the file: rescuing what a damaged file
 * still holds into a new one, and changing the password of an encrypted file.
 *
 * A rescue reads the file page by page, skipping the damaged ones, and needs
 * the file alone, so the window's handle closes for it and opens again after.
 * The new file is added as a project of its own, under the same password, and
 * the damaged file is left as it is.
 * */

const failed = (error: unknown) => ({ status: 'error' as const, ...errorOf(error) });

/* Asks where the rescued file goes, beside the damaged one by default */
const chooseRescuePath = async (
  window: BrowserWindow | null,
  from: string,
  title: string,
): Promise<string | null> => {
  const extension = extname(from) || '.darudb';
  const options = {
    title,
    defaultPath: join(dirname(from), `${basename(from, extname(from))}-rescued${extension}`),
  };
  const chosen = window
    ? await dialog.showSaveDialog(window, options)
    : await dialog.showSaveDialog(options);

  return chosen.canceled || !chosen.filePath ? null : chosen.filePath;
};

/*
 * Rescues `from` into `target`. A rescue never replaces a file, so it is
 * written beside the one the user chose to replace, and moved over it once it
 * is whole.
 * */
const salvage = async (from: string, target: string, password: string | undefined) => {
  const partial = join(dirname(target), `.${basename(target)}.${Date.now()}.partial`);

  try {
    const report = await Database.salvageAsync(from, partial, password ? { password } : {});

    await rename(partial, target);

    return report;
  } catch (error) {
    await rm(partial, { force: true });
    throw error;
  }
};

/* Adds the rescued file as a project, under the password of the file it came from */
const addRescued = async (
  original: Project,
  path: string,
  password: string | undefined,
): Promise<Project> => {
  const name = translate(getLanguage(), 'tools.rescued-name', { name: original.name });

  return saveProject({
    name: name.slice(0, PROJECT_NAME_MAX_LENGTH),
    filePath: path,
    // Remembered only where the damaged file's was, and the system can keep it
    ...(original.hasPassword && password && canRememberSecrets() ? { password } : {}),
  });
};

const reportOf = (
  report: Awaited<ReturnType<typeof salvage>>,
  path: string,
  project: Project,
  reopened: boolean,
): RescueReport => ({
  path,
  whole: report.whole,
  pagesDamaged: report.pagesDamaged,
  objectsDropped: report.objectsDropped,
  valuesLost: report.valuesLost,
  entriesRecovered: report.entriesRecovered,
  project,
  reopened,
});

/* Rescues the file of the project `window` has open */
export const rescueOpenProject = async (
  window: BrowserWindow,
  title: string,
): Promise<ToolResult<RescueReport>> => {
  try {
    const session = await sessionOf(window);

    if (!session) {
      return { status: 'error', code: 'NO_PROJECT', message: 'the window has no project open' };
    }

    const target = await chooseRescuePath(window, session.database.path, title);

    if (!target) {
      return { status: 'cancelled' };
    }

    const { value, reopened } = await withFileAlone(window, (path, password) =>
      salvage(path, target, password).then((report) => ({ report, password })),
    );
    const project = await addRescued(session.project, target, value.password);

    return { status: 'ok', report: reportOf(value.report, target, project, reopened) };
  } catch (error) {
    return failed(error);
  }
};

/*
 * Rescues the file of a project no window has open, as when the file is too
 * damaged to open. `password` is tried instead of the remembered one.
 * */
export const rescueProject = async (
  window: BrowserWindow | null,
  projectId: unknown,
  password: unknown,
  title: string,
): Promise<ToolResult<RescueReport>> => {
  try {
    const project = Number.isSafeInteger(projectId) ? await getProject(projectId as number) : null;

    if (!project) {
      return { status: 'error', code: 'NOT_FOUND', message: 'the project no longer exists' };
    }

    if (isProjectOpen(project.id)) {
      return { status: 'error', code: 'BUSY', message: 'a window has the project open' };
    }

    const given = typeof password === 'string' && password !== '' ? password : undefined;
    const tried = given ?? (await rememberedPassword(project.id)) ?? undefined;
    const target = await chooseRescuePath(window, project.filePath, title);

    if (!target) {
      return { status: 'cancelled' };
    }

    const report = await salvage(project.filePath, target, tried);
    const rescued = await addRescued(project, target, tried);

    return { status: 'ok', report: reportOf(report, target, rescued, false) };
  } catch (error) {
    return failed(error);
  }
};

/*
 * Changes the password of the encrypted file `window` has open. A password
 * the project remembers is replaced with the new one.
 * */
export const changePassword = async (
  window: BrowserWindow,
  password: unknown,
): Promise<ToolResult<{ remembered: boolean }>> => {
  try {
    const open = openProjectOf(window);

    if (!open) {
      return { status: 'error', code: 'NO_PROJECT', message: 'the window has no project open' };
    }

    if (typeof password !== 'string' || password === '') {
      return { status: 'error', code: 'INVALID_ARGUMENT', message: 'a password is not empty' };
    }

    if (!open.database.isEncrypted) {
      return { status: 'error', code: 'INVALID_ARGUMENT', message: 'the file is not encrypted' };
    }

    await open.database.setPasswordAsync(password);
    setSessionPassword(window, password);

    const project = await getProject(open.projectId);
    const remembered = Boolean(project?.hasPassword) && canRememberSecrets();

    if (project && remembered) {
      await rememberPassword(project.id, password);
    }

    return { status: 'ok', report: { remembered } };
  } catch (error) {
    return failed(error);
  }
};
