import { isAbsolute } from 'path';
import { BrowserWindow, dialog, type OpenDialogOptions } from 'electron';
import { Database, FORMAT_VERSION } from 'darudb';
import type { ChosenFile, FileCheck } from '@/common/projects';

/*
 * Looking at database files the user points the app at: the open dialog, and
 * a check that a file is a DaruDB database and what opening it would take.
 *
 * A check opens the file the way the project screen will, without creating
 * it, without raising its format version and without a schema, and closes it
 * again at once, so it changes nothing in the file. A file may carry any
 * extension, so the check, not the name, decides whether it is a database.
 * */

/* The engine's error codes, mapped to what a check reports */
const statusOfCode: Record<string, FileCheck['status']> = {
  NOT_FOUND: 'missing',
  KEY_REQUIRED: 'needs-password',
  WRONG_KEY: 'wrong-password',
  NOT_A_DATABASE: 'not-database',
};

/* The `code` and `message` of what the engine threw */
export const errorOf = (error: unknown): { code: string; message: string } => ({
  code:
    typeof (error as { code?: unknown }).code === 'string'
      ? (error as { code: string }).code
      : 'INTERNAL',
  message: error instanceof Error ? error.message : String(error),
});

/*
 * Whether the file at `path` is a DaruDB database, and what opening it takes.
 * `password` is tried when it is given; without it, an encrypted file reports
 * that it needs one.
 * */
export const checkDatabaseFile = async (path: string, password?: string): Promise<FileCheck> => {
  if (typeof path !== 'string' || !isAbsolute(path)) {
    return { status: 'error', code: 'INVALID_ARGUMENT', message: 'the path is not absolute' };
  }

  let database: Database | null = null;

  try {
    database = await Database.openAsync(path, {
      create: false,
      upgradeFormat: false,
      ...(password ? { password } : {}),
    });

    return {
      status: 'ok',
      encrypted: database.isEncrypted,
      formatVersion: database.formatVersion,
      needsUpgrade: database.formatVersion < FORMAT_VERSION,
    };
  } catch (error) {
    const { code, message } = errorOf(error);
    const status = statusOfCode[code];

    if (status === undefined) {
      return { status: 'error', code, message };
    }

    return { status } as FileCheck;
  } finally {
    await database?.closeAsync().catch((error: unknown) => {
      console.warn(`Failed to close "${path}" after checking it:`, error);
    });
  }
};

/*
 * Shows the open dialog over `window` and checks the file the user picks.
 * Resolves with `null` when the dialog is cancelled. Every file can be picked,
 * since a database may carry any extension; the check says whether it is one.
 * */
export const chooseDatabaseFile = async (
  window: BrowserWindow | null,
  title: string,
): Promise<ChosenFile | null> => {
  const options: OpenDialogOptions = {
    title,
    properties: ['openFile'],
    filters: [
      { name: 'DaruDB', extensions: ['darudb'] },
      { name: '*', extensions: ['*'] },
    ],
  };
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options);
  const [path] = result.filePaths;

  if (result.canceled || path === undefined) {
    return null;
  }

  return { path, check: await checkDatabaseFile(path) };
};
