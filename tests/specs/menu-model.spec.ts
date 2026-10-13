import { expect, test } from '@playwright/test';
import {
  acceleratorLabel,
  buildMenu,
  drawnMenu,
  menuEntries,
  type MenuEntry,
  type MenuPlatform,
} from '../../src/common/menu';
import { messages } from '../../src/common/translations';

/*
 * The menu is data shared by the native menu and the one a window draws, so
 * these run without the app.
 * */

const builds: { platform: MenuPlatform; development: boolean }[] = [
  { platform: 'mac', development: false },
  { platform: 'mac', development: true },
  { platform: 'other', development: false },
  { platform: 'other', development: true },
];

for (const { platform, development } of builds) {
  test(`The ${platform} menu${development ? ' of a development build' : ''} is well formed`, () => {
    const entries = menuEntries(buildMenu(platform, development));
    const ids = entries.map((entry) => entry.id);
    const accelerators = entries.flatMap((entry) => entry.accelerator ?? []);

    expect(new Set(ids).size, 'Every id is unique').toBe(ids.length);
    expect(new Set(accelerators).size, 'No two entries share a shortcut').toBe(accelerators.length);

    for (const entry of entries) {
      expect(
        entry.separator || entry.submenu || entry.role || entry.command,
        `${entry.id} does something`,
      ).toBeTruthy();
    }

    expect(ids.includes('view.reload')).toBe(development);
    // No entry opens the developer tools, and opening or closing a window is in the Window menu
    expect(entries.some((entry) => entry.role === ('toggleDevTools' as string))).toBe(false);
    expect(ids).toEqual(expect.arrayContaining(['window.new-window', 'window.close']));
    expect(ids.includes('app.about')).toBe(platform === 'mac');
    expect(ids.includes('help.about')).toBe(platform !== 'mac');
  });
}

test('Every menu label is translated into every language', () => {
  const labels = new Set(
    builds.flatMap(({ platform, development }) =>
      menuEntries(buildMenu(platform, development)).flatMap((entry) => entry.label ?? []),
    ),
  );

  for (const [language, groups] of Object.entries(messages)) {
    for (const label of labels) {
      const [group, name] = label.split('.');

      expect(
        (groups as Record<string, Record<string, string>>)[group]?.[name],
        `${label} in ${language}`,
      ).toBeTruthy();
    }
  }
});

test('A window draws the menu without the entries only the system has', () => {
  const ids = (entries: MenuEntry[]) => entries.map((entry) => entry.id);
  const mac = drawnMenu(buildMenu('mac', false));
  const app = mac.find((entry) => entry.id === 'app')!;

  expect(menuEntries(mac).some((entry) => entry.nativeOnly)).toBe(false);
  // The separator around the services goes with them, and no two are left in a row
  expect(ids(app.submenu!)).toEqual([
    'app.about',
    'app.separator-about',
    'app.settings',
    'app.separator-settings',
    'app.hide',
    'app.hide-others',
    'app.unhide',
    'app.separator-quit',
    'app.quit',
  ]);
  expect(
    drawnMenu([
      { id: 'a', separator: true },
      { id: 'b', command: 'refresh' },
      { id: 'c', separator: true },
      { id: 'd', command: 'check', nativeOnly: true },
      { id: 'e', separator: true },
    ]).map((entry) => entry.id),
    'No separator is left at either end',
  ).toEqual(['b']);
});

test('Shortcuts are written the way each platform writes them', () => {
  expect(acceleratorLabel('CmdOrCtrl+Shift+N', 'mac')).toBe('⌘⇧N');
  expect(acceleratorLabel('CmdOrCtrl+Shift+N', 'other')).toBe('Ctrl+Shift+N');
  expect(acceleratorLabel('CmdOrCtrl+Plus', 'other')).toBe('Ctrl++');
  expect(acceleratorLabel('Cmd+Alt+H', 'mac')).toBe('⌘⌥H');
  expect(acceleratorLabel('F5', 'other')).toBe('F5');
});
