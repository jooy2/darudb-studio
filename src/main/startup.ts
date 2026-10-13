import { mkdir, rm, stat, writeFile } from 'fs/promises';
import { join } from 'path';
import { app } from 'electron';

/*
 * Opening the app as the user logs in to the system, as the setting
 * `openAtLogin` asks: a login item on macOS and Windows, an entry in the XDG
 * autostart folder on Linux.
 *
 * Only a packaged app is registered. A development or test run keeps the
 * setting and leaves the system alone, since what it would register is a bare
 * Electron binary, and a test must not change the machine it runs on.
 * */

const APP_NAME = 'DaruDB Studio';

/*
 * What the system starts: the portable Windows build and the AppImage run
 * from a copy of themselves unpacked elsewhere, and name the file the user
 * has in these variables.
 * */
const launcher = (): string =>
  process.env.PORTABLE_EXECUTABLE_FILE ?? process.env.APPIMAGE ?? process.execPath;

// ~/.config/autostart, or wherever `XDG_CONFIG_HOME` says
const autostartFile = (): string =>
  join(app.getPath('appData'), 'autostart', `${app.getName()}.desktop`);

/* `path` as the `Exec` key of a desktop entry takes it, quoted, with what the quotes do not keep escaped */
const execOf = (path: string): string => `"${path.replace(/["`$\\]/g, (char) => `\\${char}`)}"`;

/*
 * Whether this installation of the app can be opened at login. A Store build
 * of Windows and a snap of Linux are each boxed in by their store, which keeps
 * an app from registering itself.
 * */
export const canOpenAtLogin = (): boolean => {
  switch (process.platform) {
    case 'darwin':
      return !process.mas;
    case 'win32':
      return !process.windowsStore;
    case 'linux':
      return process.env.SNAP === undefined;
    default:
      return false;
  }
};

/* Whether the system opens the app at login now, or `null` when this run does not ask it */
export const systemOpensAtLogin = async (): Promise<boolean | null> => {
  if (!app.isPackaged || !canOpenAtLogin()) {
    return null;
  }

  if (process.platform === 'linux') {
    return stat(autostartFile()).then(
      () => true,
      () => false,
    );
  }

  return app.getLoginItemSettings({ path: launcher() }).openAtLogin;
};

/*
 * Has the system open the app at login, or no longer, and resolves with
 * whether it does now: what was asked, unless the system refused it.
 * */
export const setOpenAtLogin = async (open: boolean): Promise<boolean> => {
  if (!app.isPackaged || !canOpenAtLogin()) {
    return open;
  }

  try {
    if (process.platform === 'linux') {
      if (open) {
        await mkdir(join(app.getPath('appData'), 'autostart'), { recursive: true });
        await writeFile(
          autostartFile(),
          [
            '[Desktop Entry]',
            'Type=Application',
            `Name=${APP_NAME}`,
            `Exec=${execOf(launcher())}`,
            'X-GNOME-Autostart-enabled=true',
            '',
          ].join('\n'),
        );
      } else {
        await rm(autostartFile(), { force: true });
      }
    } else {
      app.setLoginItemSettings({ openAtLogin: open, path: launcher() });
    }
  } catch (error) {
    console.error('Failed to change whether the app opens at login:', error);
  }

  return (await systemOpensAtLogin()) ?? open;
};
