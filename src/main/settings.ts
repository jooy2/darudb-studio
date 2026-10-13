import {
  defaultSettings,
  isEditMode,
  isMenuBarStyle,
  isProjectView,
  isSupportedLanguage,
  type AppSettings,
} from '@/common/settings';
import { getStore, queueWrite } from './store';

/*
 * The settings, kept in the `settings` collection of the app's data file (see
 * `store.ts`). They are read into memory once the file is open, and every
 * change is written through to the file in the background.
 * */

type SettingName = keyof AppSettings;

/*
 * The file is written by this app, but it sits in a folder the user can reach,
 * so what comes back from it is checked like any other input. A value that
 * fails the check is read as the default.
 * */
const settingValidators: { [Name in SettingName]: (value: unknown) => boolean } = {
  darkTheme: (value) => typeof value === 'boolean',
  language: isSupportedLanguage,
  menuBarStyle: isMenuBarStyle,
  editMode: isEditMode,
  projectView: isProjectView,
  restoreWorkspace: (value) => typeof value === 'boolean',
};

let settings: AppSettings = { ...defaultSettings };

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

/*
 * Reads every setting from the open data file. Called once, before the first
 * window, so that window starts on the stored theme and language. Without an
 * open file the settings stay the defaults.
 * */
export const loadSettings = async (): Promise<AppSettings> => {
  const store = getStore();

  if (!store) {
    return settings;
  }

  try {
    const storedSettings = await store.readAsync((txn) => txn.collection('settings').find());
    const storedValues = new Map(storedSettings.map(({ name, value }) => [name, value]));

    settings = {
      darkTheme: readSetting(storedValues, 'darkTheme'),
      language: readSetting(storedValues, 'language'),
      menuBarStyle: readSetting(storedValues, 'menuBarStyle'),
      editMode: readSetting(storedValues, 'editMode'),
      projectView: readSetting(storedValues, 'projectView'),
      restoreWorkspace: readSetting(storedValues, 'restoreWorkspace'),
    };
  } catch (error) {
    console.error('Failed to read the settings. Running on the defaults:', error);
  }

  return settings;
};

export const getSettings = (): AppSettings => settings;

/*
 * Keeps only the changes that are valid settings, so that what a renderer
 * sends never reaches the file unchecked. `null` is valid for the theme and
 * the language, and hands the choice back to the operating system.
 * */
export const validSettingChanges = (changes: unknown): Partial<AppSettings> => {
  if (typeof changes !== 'object' || changes === null) {
    return {};
  }

  const valid: Partial<AppSettings> = {};

  for (const name of Object.keys(settingValidators) as SettingName[]) {
    const value = (changes as Record<string, unknown>)[name];
    const clears = value === null && (name === 'darkTheme' || name === 'language');

    if (value !== undefined && (clears || settingValidators[name](value))) {
      Object.assign(valid, { [name]: value });
    }
  }

  return valid;
};

/*
 * Applies the change in memory at once and writes it to the file in the
 * background. `null` removes a setting, which hands the choice back to the
 * operating system.
 * */
export const updateSettings = (changes: Partial<AppSettings>): void => {
  const changedEntries = Object.entries(changes).filter(([, value]) => value !== undefined);

  if (changedEntries.length === 0) {
    return;
  }

  settings = { ...settings, ...Object.fromEntries(changedEntries) };

  if (!getStore()) {
    return;
  }

  queueWrite((store) =>
    store.writeAsync(async (txn) => {
      const settingsCollection = txn.collection('settings');

      for (const [name, value] of changedEntries) {
        if (value === null) {
          await settingsCollection.delete(name);
        } else {
          await settingsCollection.put({ name, value: JSON.stringify(value) });
        }
      }
    }),
  ).catch((error: unknown) => {
    console.error('Failed to save the settings:', error);
  });
};
