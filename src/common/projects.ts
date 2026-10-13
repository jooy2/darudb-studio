/*
 * Projects and the database files they point at, shared by the three
 * processes.
 *
 * A project is a name the user gives a DaruDB file, the file's path, and,
 * when the user asked for it, the file's password, which the main process
 * keeps encrypted with the operating system's keystore and never hands to a
 * renderer. See `src/main/projects.ts`.
 *
 * See `src/common/ipc.ts` for what may live in this folder.
 * */

import type { DatabaseSchema } from './data';

export interface Project {
  id: number;
  name: string;
  /* The database file the project opens */
  filePath: string;
  /*
   * The file the project's working copy was made from, when the project works
   * on a copy the app made to raise its format version, and `null` otherwise
   * */
  sourcePath: string | null;
  /* Whether a password is remembered for the file */
  hasPassword: boolean;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number | null;
  /* Whether the file was missing from its path when the projects were listed */
  missing: boolean;
  /*
   * Whether the file is a sample database the app wrote, which it deletes,
   * with the project, as it quits
   * */
  sample: boolean;
}

/* What the project dialog saves: a new project without `id`, or a change to one with it */
export interface ProjectDraft {
  id?: number;
  name: string;
  filePath: string;
  /* A password to remember, `null` to forget the remembered one, or absent to keep it as it is */
  password?: string | null;
}

/* The longest name a project may have, in characters */
export const PROJECT_NAME_MAX_LENGTH = 120;

/*
 * What looking at a database file found, without opening it for good.
 *
 * - `ok`: a DaruDB file that opened, with what the project screen and the
 *   upgrade dialog need to know of it.
 * - `needs-password` and `wrong-password`: an encrypted DaruDB file, opened
 *   without its password or with the wrong one.
 * - `not-database`: a file that is not a DaruDB database.
 * - `missing`: nothing at the path.
 * - `error`: anything else, with the engine's code and message.
 * */
export type FileCheck =
  | {
      status: 'ok';
      encrypted: boolean;
      formatVersion: number;
      /* Whether the app's engine would raise the file to a newer format version */
      needsUpgrade: boolean;
    }
  | { status: 'needs-password' }
  | { status: 'wrong-password' }
  | { status: 'not-database' }
  | { status: 'missing' }
  | { status: 'error'; code: string; message: string };

/* A file the user picked in the open dialog, with what looking at it found */
export interface ChosenFile {
  path: string;
  check: FileCheck;
}

/* How a file in an older format version opens, once the user chose */
export const upgradeChoices = ['copy', 'original'] as const;

export type UpgradeChoice = (typeof upgradeChoices)[number];

/* What a window asks for when it opens a project */
export interface OpenRequest {
  projectId: number;
  /* A password typed for this open, tried instead of the remembered one */
  password?: string;
  /* Whether to remember `password` for the next open */
  rememberPassword?: boolean;
  /*
   * How to open a file in an older format version: on a working copy the app
   * makes and raises, or on the file itself, raised in place
   * */
  upgrade?: UpgradeChoice;
}

/* What the project screen shows of the file a window has open */
export interface DatabaseInfo {
  path: string;
  encrypted: boolean;
  formatVersion: number;
  pageSize: number;
  /* The schema version the file holds, or `null` without a schema */
  schemaVersion: number | null;
  /* The size of the file, in bytes, when it was opened */
  fileSize: number;
}

/* A project open in a window, its file, and the schema the file holds */
export interface Session {
  project: Project;
  database: DatabaseInfo;
  /* `null` for a file that holds no schema, whose objects cannot be read */
  schema: DatabaseSchema | null;
}

/*
 * What asking to open a project ended in.
 *
 * - `opened`: the window has the project open now.
 * - `open-elsewhere`: another window has it open, and was brought forward.
 * - `needs-password`: the file is encrypted, and no password was given or
 *   remembered, or, with `retry`, the one tried does not open it.
 * - `needs-upgrade`: the file is in an older format version, and the user is
 *   to choose how to open it, see `OpenRequest.upgrade`.
 * - `damaged`: the engine found the file damaged as it opened it, which a
 *   rescue into a new file may still recover from.
 * - `missing`, `not-database` and `error`: as a `FileCheck` says them.
 * */
export type OpenResult =
  | ({ status: 'opened' } & Session)
  | { status: 'open-elsewhere' }
  | { status: 'needs-password'; retry: boolean }
  | { status: 'needs-upgrade'; formatVersion: number; newestVersion: number }
  | { status: 'missing' }
  | { status: 'not-database' }
  | { status: 'damaged'; message: string }
  | { status: 'error'; code: string; message: string };
