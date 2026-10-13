/*
 * The application menu, shared by the three processes.
 *
 * The main process builds the native menu from it, the menu bar of macOS and
 * the one behind the accelerators elsewhere, and a window draws its own menu
 * bar from the same entries, so the two never list different items. The
 * entries follow Electron's default menu, menu for menu and item for item,
 * with the app's own items added among them.
 *
 * An entry does one of two things: a `role`, which Electron knows how to do
 * itself, or a `command` of this app, which the main process does or hands to
 * the window it is for. Labels are keys of the `menu` group of the
 * translations, so the native menu and the window's say the same words.
 *
 * See `src/common/ipc.ts` for what may live in this folder.
 * */

/* What an entry can ask Electron to do, as its menu roles name it */
export type MenuRole =
  | 'about'
  | 'services'
  | 'hide'
  | 'hideOthers'
  | 'unhide'
  | 'quit'
  | 'undo'
  | 'redo'
  | 'cut'
  | 'copy'
  | 'paste'
  | 'pasteAndMatchStyle'
  | 'delete'
  | 'selectAll'
  | 'startSpeaking'
  | 'stopSpeaking'
  | 'reload'
  | 'forceReload'
  | 'toggleDevTools'
  | 'resetZoom'
  | 'zoomIn'
  | 'zoomOut'
  | 'togglefullscreen'
  | 'minimize'
  | 'zoom'
  | 'front'
  | 'close'
  | 'window';

/* What an entry can ask the app to do */
export const appCommands = [
  'new-window',
  'new-project',
  'settings',
  'close-project',
  'refresh',
  'new-query',
  'check',
  'compact',
  'backup',
  'submit',
  'discard',
  'open-website',
  'open-repository',
  'show-notices',
] as const;

export type AppCommand = (typeof appCommands)[number];

export const isAppCommand = (value: unknown): value is AppCommand =>
  appCommands.includes(value as AppCommand);

export interface MenuEntry {
  /* Stable and unique, such as `edit.copy`: how a window names the entry it clicked */
  id: string;
  /*
   * A key of the `menu` group of the translations, whose `{{name}}` is the
   * app's name. The app menu of macOS has none: its title is the app's name.
   * */
  label?: string;
  role?: MenuRole;
  command?: AppCommand;
  /* In Electron's accelerator syntax, such as `CmdOrCtrl+Shift+N` */
  accelerator?: string;
  separator?: boolean;
  submenu?: MenuEntry[];
  /* Only in the native menu, as the services of macOS: a window cannot draw them */
  nativeOnly?: boolean;
  /* Usable only while the window shows a project */
  needsProject?: boolean;
}

/* The platforms the menu differs between */
export type MenuPlatform = 'mac' | 'other';

const separator = (id: string): MenuEntry => ({ id, separator: true });

/*
 * The menu for `platform`. `development` adds the items of a development
 * build, which reload the page and open the developer tools.
 * */
export const buildMenu = (platform: MenuPlatform, development: boolean): MenuEntry[] => {
  const mac = platform === 'mac';
  const menus: MenuEntry[] = [];

  if (mac) {
    // The app menu is titled with the product's name, which is not translated
    menus.push({
      id: 'app',
      submenu: [
        { id: 'app.about', label: 'menu.about', role: 'about' },
        separator('app.separator-about'),
        { id: 'app.settings', label: 'menu.settings', command: 'settings', accelerator: 'Cmd+,' },
        separator('app.separator-settings'),
        { id: 'app.services', label: 'menu.services', role: 'services', nativeOnly: true },
        separator('app.separator-services'),
        { id: 'app.hide', label: 'menu.hide', role: 'hide', accelerator: 'Cmd+H' },
        {
          id: 'app.hide-others',
          label: 'menu.hide-others',
          role: 'hideOthers',
          accelerator: 'Cmd+Alt+H',
        },
        { id: 'app.unhide', label: 'menu.show-all', role: 'unhide' },
        separator('app.separator-quit'),
        { id: 'app.quit', label: 'menu.quit', role: 'quit', accelerator: 'Cmd+Q' },
      ],
    });
  }

  menus.push({
    id: 'file',
    label: 'menu.file',
    submenu: [
      {
        id: 'file.new-window',
        label: 'menu.new-window',
        command: 'new-window',
        accelerator: 'CmdOrCtrl+Shift+N',
      },
      {
        id: 'file.new-project',
        label: 'menu.new-project',
        command: 'new-project',
        accelerator: 'CmdOrCtrl+N',
      },
      separator('file.separator-project'),
      {
        id: 'file.close-project',
        label: 'menu.close-project',
        command: 'close-project',
        accelerator: 'CmdOrCtrl+Shift+W',
        needsProject: true,
      },
      separator('file.separator-window'),
      ...(mac
        ? [
            {
              id: 'file.close',
              label: 'menu.close-window',
              role: 'close',
              accelerator: 'Cmd+W',
            } as const,
          ]
        : [
            {
              id: 'file.settings',
              label: 'menu.settings',
              command: 'settings',
              accelerator: 'Ctrl+,',
            } as const,
            separator('file.separator-quit'),
            { id: 'file.quit', label: 'menu.quit', role: 'quit', accelerator: 'Ctrl+Q' } as const,
          ]),
    ],
  });

  menus.push({
    id: 'edit',
    label: 'menu.edit',
    submenu: [
      { id: 'edit.undo', label: 'menu.undo', role: 'undo', accelerator: 'CmdOrCtrl+Z' },
      {
        id: 'edit.redo',
        label: 'menu.redo',
        role: 'redo',
        accelerator: mac ? 'Shift+Cmd+Z' : 'Ctrl+Y',
      },
      separator('edit.separator-clipboard'),
      { id: 'edit.cut', label: 'menu.cut', role: 'cut', accelerator: 'CmdOrCtrl+X' },
      { id: 'edit.copy', label: 'menu.copy', role: 'copy', accelerator: 'CmdOrCtrl+C' },
      { id: 'edit.paste', label: 'menu.paste', role: 'paste', accelerator: 'CmdOrCtrl+V' },
      ...(mac
        ? [
            {
              id: 'edit.paste-and-match-style',
              label: 'menu.paste-and-match-style',
              role: 'pasteAndMatchStyle',
              accelerator: 'Shift+Cmd+V',
            } as const,
            { id: 'edit.delete', label: 'menu.delete', role: 'delete' } as const,
            {
              id: 'edit.select-all',
              label: 'menu.select-all',
              role: 'selectAll',
              accelerator: 'Cmd+A',
            } as const,
            separator('edit.separator-speech'),
            {
              id: 'edit.speech',
              label: 'menu.speech',
              nativeOnly: true,
              submenu: [
                {
                  id: 'edit.start-speaking',
                  label: 'menu.start-speaking',
                  role: 'startSpeaking',
                } as const,
                {
                  id: 'edit.stop-speaking',
                  label: 'menu.stop-speaking',
                  role: 'stopSpeaking',
                } as const,
              ],
            },
          ]
        : [
            { id: 'edit.delete', label: 'menu.delete', role: 'delete' } as const,
            separator('edit.separator-select'),
            {
              id: 'edit.select-all',
              label: 'menu.select-all',
              role: 'selectAll',
              accelerator: 'Ctrl+A',
            } as const,
          ]),
    ],
  });

  menus.push({
    id: 'view',
    label: 'menu.view',
    submenu: [
      ...(development
        ? [
            {
              id: 'view.reload',
              label: 'menu.reload',
              role: 'reload',
              accelerator: 'CmdOrCtrl+R',
            } as const,
            {
              id: 'view.force-reload',
              label: 'menu.force-reload',
              role: 'forceReload',
              accelerator: 'Shift+CmdOrCtrl+R',
            } as const,
            {
              id: 'view.toggle-dev-tools',
              label: 'menu.toggle-dev-tools',
              role: 'toggleDevTools',
              accelerator: mac ? 'Alt+Cmd+I' : 'Ctrl+Shift+I',
            } as const,
            separator('view.separator-zoom'),
          ]
        : []),
      {
        id: 'view.reset-zoom',
        label: 'menu.actual-size',
        role: 'resetZoom',
        accelerator: 'CmdOrCtrl+0',
      },
      { id: 'view.zoom-in', label: 'menu.zoom-in', role: 'zoomIn', accelerator: 'CmdOrCtrl+Plus' },
      { id: 'view.zoom-out', label: 'menu.zoom-out', role: 'zoomOut', accelerator: 'CmdOrCtrl+-' },
      separator('view.separator-full-screen'),
      {
        id: 'view.full-screen',
        label: 'menu.toggle-full-screen',
        role: 'togglefullscreen',
        accelerator: mac ? 'Ctrl+Cmd+F' : 'F11',
      },
    ],
  });

  menus.push({
    id: 'database',
    label: 'menu.database',
    submenu: [
      {
        id: 'database.refresh',
        label: 'menu.refresh',
        command: 'refresh',
        accelerator: 'F5',
        needsProject: true,
      },
      {
        id: 'database.new-query',
        label: 'menu.new-query',
        command: 'new-query',
        accelerator: 'CmdOrCtrl+T',
        needsProject: true,
      },
      separator('database.separator-changes'),
      {
        id: 'database.submit',
        label: 'menu.submit',
        command: 'submit',
        accelerator: 'CmdOrCtrl+S',
        needsProject: true,
      },
      { id: 'database.discard', label: 'menu.discard', command: 'discard', needsProject: true },
      separator('database.separator-tools'),
      { id: 'database.check', label: 'menu.check', command: 'check', needsProject: true },
      { id: 'database.compact', label: 'menu.compact', command: 'compact', needsProject: true },
      { id: 'database.backup', label: 'menu.backup', command: 'backup', needsProject: true },
    ],
  });

  menus.push({
    id: 'window',
    label: 'menu.window',
    ...(mac ? { role: 'window' as const } : {}),
    submenu: [
      {
        id: 'window.minimize',
        label: 'menu.minimize',
        role: 'minimize',
        accelerator: 'CmdOrCtrl+M',
      },
      ...(mac
        ? [
            { id: 'window.zoom', label: 'menu.zoom', role: 'zoom' } as const,
            separator('window.separator-front'),
            { id: 'window.front', label: 'menu.bring-all-to-front', role: 'front' } as const,
          ]
        : [
            {
              id: 'window.close',
              label: 'menu.close-window',
              role: 'close',
              accelerator: 'Ctrl+W',
            } as const,
          ]),
    ],
  });

  menus.push({
    id: 'help',
    label: 'menu.help',
    submenu: [
      { id: 'help.website', label: 'menu.website', command: 'open-website' },
      { id: 'help.repository', label: 'menu.repository', command: 'open-repository' },
      separator('help.separator-notices'),
      { id: 'help.notices', label: 'menu.notices', command: 'show-notices' },
      ...(mac
        ? []
        : [
            separator('help.separator-about'),
            { id: 'help.about', label: 'menu.about', role: 'about' } as const,
          ]),
    ],
  });

  return menus;
};

/* Every entry of `menus`, submenus included */
export const menuEntries = (menus: readonly MenuEntry[]): MenuEntry[] =>
  menus.flatMap((entry) => [entry, ...menuEntries(entry.submenu ?? [])]);

/*
 * `menus` without the entries only the native menu has, as a window draws
 * them. A separator left with nothing to separate goes too: one at either end
 * of a menu, or one right after another.
 * */
export const drawnMenu = (menus: readonly MenuEntry[]): MenuEntry[] => {
  const drawn: MenuEntry[] = [];

  for (const entry of menus) {
    const afterSeparator = drawn.length === 0 || drawn.at(-1)?.separator === true;

    if (entry.nativeOnly || (entry.separator && afterSeparator)) {
      continue;
    }

    drawn.push(entry.submenu ? { ...entry, submenu: drawnMenu(entry.submenu) } : entry);
  }

  if (drawn.at(-1)?.separator) {
    drawn.pop();
  }

  return drawn;
};

/*
 * `accelerator` as a menu shows it on `platform`: `⇧⌘N` on macOS, `Ctrl+Shift+N`
 * elsewhere.
 * */
export const acceleratorLabel = (accelerator: string, platform: MenuPlatform): string => {
  const keys = accelerator.split('+').map((key) => (key === '' ? '+' : key));
  const mac = platform === 'mac';
  const names: Record<string, string> = mac
    ? {
        CmdOrCtrl: '⌘',
        Cmd: '⌘',
        Command: '⌘',
        Ctrl: '⌃',
        Control: '⌃',
        Alt: '⌥',
        Option: '⌥',
        Shift: '⇧',
        Plus: '+',
      }
    : {
        CmdOrCtrl: 'Ctrl',
        Cmd: 'Ctrl',
        Command: 'Ctrl',
        Control: 'Ctrl',
        Option: 'Alt',
        Plus: '+',
      };
  const shown = keys.map((key) => names[key] ?? key);

  return mac ? shown.join('') : shown.join('+');
};

/* The URLs the help menu opens */
export const WEBSITE_URL = 'https://darudb.cdget.com';
export const REPOSITORY_URL = 'https://github.com/jooy2/darudb';
