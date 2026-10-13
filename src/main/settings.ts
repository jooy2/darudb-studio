import { join } from 'path';
import { app } from 'electron';
import { collection, Database, schema, t } from 'darudb';
import { defaultSettings, isSupportedLanguage, type AppSettings } from '@/common/settings';

/*
 * The app's own data, kept in a DaruDB file in the user data folder.
 *
 * The file is opened once, in the main process: a renderer is sandboxed and
 * cannot load the native addon, so windows read the settings over IPC. They
 * are read into memory when the app starts, and every change is written
 * through to the file in the background.
 *
 * A file that cannot be opened is left alone rather than replaced. The app then
 * runs on the defaults and keeps nothing, which is better than losing whatever
 * the file holds.
 * */

const SETTINGS_FILE_NAME = 'studio.darudb';

// One object per setting, keyed by its name. A setting added later needs a new
// name and a validator below, not a schema version and a migration.
const studioSchema = schema(1, {
  settings: collection({
    name: t.string().primaryKey(),
    // The value as JSON, checked against `settingValidators` when it is read
    value: t.string(),
  }),
});

type SettingName = keyof AppSettings;

/*
 * The file is written by this app, but it sits in a folder the user can reach,
 * so what comes back from it is checked like any other input. A value that
 * fails the check is read as the default.
 * */
const settingValidators: { [Name in SettingName]: (value: unknown) => boolean } = {
  darkTheme: (value) => typeof value === 'boolean',
  language: isSupportedLanguage,
};

let database: Database<typeof studioSchema> | null = null;
let settings: AppSettings = { ...defaultSettings };
// Writes run one after another, and closing the file waits for the last one
let pendingWrite: Promise<void> = Promise.resolve();

const readSetting = <Name extends SettingName>(
  storedValues: Map<string, string>,
  name: Name,
): AppSettings[Name] => {
  const storedValue = storedValues.get(name);

  if (storedValue === undefined) {
    return defaultSettings[name];
  }

  try {
    const parsed: unknown = JSON.parse(storedValue);

    if (settingValidators[name](parsed)) {
      return parsed as AppSettings[Name];
    }
  } catch {
    // Read as the default, like any other value that fails the check
  }

  console.warn(`Ignored an invalid stored setting: ${name}`);

  return defaultSettings[name];
};

const getSettingsFilePath = (): string => join(app.getPath('userData'), SETTINGS_FILE_NAME);

/*
 * Opens the file and reads every setting from it. Called once, before the first
 * window, so that window starts on the stored theme and language.
 * */
export const openSettings = async (): Promise<AppSettings> => {
  let openedDatabase: Database<typeof studioSchema> | null = null;

  try {
    openedDatabase = await Database.openAsync(getSettingsFilePath(), { schema: studioSchema });

    const storedSettings = await openedDatabase.readAsync((txn) =>
      txn.collection('settings').find(),
    );
    const storedValues = new Map(storedSettings.map(({ name, value }) => [name, value]));

    settings = {
      darkTheme: readSetting(storedValues, 'darkTheme'),
      language: readSetting(storedValues, 'language'),
    };
    database = openedDatabase;
  } catch (error) {
    console.error('Failed to open the settings file. Running on the defaults:', error);

    // A file that opened but could not be read is not written to either
    await openedDatabase?.closeAsync().catch(() => undefined);
  }

  return settings;
};

export const getSettings = (): AppSettings => settings;

/*
 * Applies the change in memory at once and writes it to the file in the
 * background. `null` removes a setting, which hands the choice back to the
 * operating system.
 * */
export const updateSettings = (changes: Partial<AppSettings>): void => {
  const changedEntries = Object.entries(changes).filter(([, value]) => value !== undefined);

  settings = { ...settings, ...Object.fromEntries(changedEntries) };

  const openedDatabase = database;

  if (!openedDatabase || changedEntries.length === 0) {
    return;
  }

  pendingWrite = pendingWrite
    .then(() =>
      openedDatabase.writeAsync(async (txn) => {
        const settingsCollection = txn.collection('settings');

        for (const [name, value] of changedEntries) {
          if (value === null) {
            await settingsCollection.delete(name);
          } else {
            await settingsCollection.put({ name, value: JSON.stringify(value) });
          }
        }
      }),
    )
    .then(
      () => undefined,
      (error: unknown) => {
        console.error('Failed to save the settings:', error);
      },
    );
};

/*
 * Waits for the writes still running, then closes the file.
 * */
export const closeSettings = async (): Promise<void> => {
  const openedDatabase = database;

  if (!openedDatabase) {
    return;
  }

  database = null;

  await pendingWrite;
  await openedDatabase.closeAsync();
};
