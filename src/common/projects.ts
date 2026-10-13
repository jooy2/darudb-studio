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
