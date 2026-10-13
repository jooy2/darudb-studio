import { join } from 'path';
import { app } from 'electron';
import { collection, Database, schema, t } from 'darudb';

/*
 * The app's own data file, `studio.darudb` in the user data folder, and the
 * one handle to it. The settings and the projects are collections of it, and
 * `settings.ts` and `projects.ts` read and write them.
 *
 * The file is opened once, in the main process: a renderer is sandboxed and
 * cannot load the native addon. A file that cannot be opened is left alone
 * rather than replaced. The app then runs on the defaults and keeps nothing,
 * which is better than losing whatever the file holds.
 *
 * Writes run one after another on the thread pool, so the main process never
 * waits for the disk, and closing the file waits for the last one.
 * */

const STORE_FILE_NAME = 'studio.darudb';

/*
 * Version 2 added the projects, and version 3 the state the app leaves
 * behind. Adding a collection is a change the engine makes by itself when the
 * version rises, so it needs no migration.
 * */
const storeSchema = schema(3, {
  // One object per setting, keyed by its name, with its value as JSON. A
  // setting added later needs a name and a validator, not a new version.
  settings: collection({
    name: t.string().primaryKey(),
    value: t.string(),
  }),
  projects: collection({
    name: t.string(),
    filePath: t.string(),
    sourcePath: t.string().optional(),
    // Encrypted with the operating system's keystore, see `secrets.ts`
    password: t.bytes().optional(),
    createdAt: t.int(),
    updatedAt: t.int(),
    lastOpenedAt: t.int().optional(),
  }),
  // What the app was doing rather than what the user chose, such as the
  // windows it had open, one object per kind, with its value as JSON
  state: collection({
    name: t.string().primaryKey(),
    value: t.string(),
  }),
});

export type StoreDatabase = Database<typeof storeSchema>;

let database: StoreDatabase | null = null;
let pendingWrite: Promise<void> = Promise.resolve();

const storeFilePath = (): string => join(app.getPath('userData'), STORE_FILE_NAME);

/*
 * Opens the file, creating it the first time and migrating it from an older
 * version. Resolves with the database, or `null` when the file cannot be
 * opened, which is logged.
 * */
export const openStore = async (): Promise<StoreDatabase | null> => {
  try {
    database = await Database.openAsync(storeFilePath(), { schema: storeSchema });
  } catch (error) {
    console.error('Failed to open the app data file. Running on the defaults:', error);

    database = null;
  }

  return database;
};

/* The open file, or `null` when it could not be opened or has closed */
export const getStore = (): StoreDatabase | null => database;

/*
 * Runs `write` on the open file after the writes before it, and resolves or
 * rejects with its outcome. A failed write does not stop the ones queued
 * after it. Without an open file it rejects at once.
 * */
export const queueWrite = (write: (store: StoreDatabase) => Promise<void>): Promise<void> => {
  const opened = database;

  if (!opened) {
    return Promise.reject(new Error('the app data file is not open'));
  }

  const result = pendingWrite.then(() => write(opened));

  pendingWrite = result.catch(() => undefined);

  return result;
};

/*
 * Waits for the writes still running, then closes the file.
 * */
export const closeStore = async (): Promise<void> => {
  const opened = database;

  if (!opened) {
    return;
  }

  database = null;

  await pendingWrite;
  await opened.closeAsync();
};
