import type { SupportedLanguage } from './locales';

import de from './messages/de.json';
import en from './messages/en.json';
import fr from './messages/fr.json';
import ja from './messages/ja.json';
import ko from './messages/ko.json';

/*
 * The translated strings, shared by the three processes.
 *
 * The renderer hands them to i18next, and the main process labels the native
 * application menu with them, so a menu item reads the same in the menu bar
 * of the operating system and in the one the window draws. They are bundled
 * rather than fetched: every language together is a few kilobytes.
 *
 * Typing every entry as `typeof en` makes a missing or misspelled key a build
 * error, so the languages cannot drift apart.
 *
 * See `src/common/ipc.ts` for what may live in this folder.
 * */
export type Messages = typeof en;

export const messages: Record<SupportedLanguage, Messages> = { de, en, fr, ja, ko };

/*
 * The message `key` names in `language`, for code that runs without i18next.
 * A key is a group and a name, `menu.file`, as the files nest them.
 * */
export const translate = (language: SupportedLanguage, key: string): string => {
  const [group, name] = key.split('.');
  const value = (messages[language] as Record<string, Record<string, string> | undefined>)[group]?.[
    name
  ];

  return value ?? key;
};
