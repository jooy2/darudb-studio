import { spawn, spawnSync } from 'child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { createRequire } from 'module';
import { join } from 'path';
import type { Page } from 'playwright';
import pkg from '../../package.json' with { type: 'json' };
import { mainChannels } from '../../src/common/ipc';
import type { AppSettings } from '../../src/common/settings';
import { invokeMain } from '../ipc';
import {
  test,
  expect,
  beforeAll,
  afterAll,
  getApp,
  getUserDataPath,
  relaunchApp,
} from '../fixtures';

test.beforeAll(beforeAll);
test.afterAll(afterAll);

// The settings file, as `src/main/settings.ts` names it
const SETTINGS_FILE_NAME = 'studio.darudb';

// The `electron` package resolves to the path of its binary
const electronBinary = createRequire(join(process.cwd(), 'package.json'))('electron') as string;
// A CI runner has no setuid sandbox helper, as the launches in `fixtures.ts` know
const sandbox = process.env.CI === 'true' ? ['--no-sandbox'] : [];

const getTheme = (target: Page) => target.evaluate(() => document.documentElement.dataset.theme);

const getBackgroundColor = (target: Page) =>
  target.evaluate(() => getComputedStyle(document.body).backgroundImage);

/* Picks a language in the settings dialog, and closes it again */
const selectLanguage = async (target: Page, languageName: string): Promise<void> => {
  await target.getByTestId('btn-settings').click();
  await target.getByTestId('settings-language').getByRole('combobox').click();
  await target.getByRole('option', { name: languageName }).click();
  await target.keyboard.press('Escape');
  await expect(target.getByTestId('settings-dialog')).toBeHidden();
};

test('Document element check', async ({ page, util }) => {
  try {
    await expect(
      page.getByTestId('main-logo').first(),
      'Confirm main logo is visible',
    ).toBeVisible();
    await expect(
      page.getByTestId('btn-change-theme').first(),
      'Confirm change theme is visible',
    ).toBeVisible();
    await expect(
      page.getByTestId('app-version'),
      'Confirm the version comes from package.json',
    ).toHaveText(`Version ${pkg.version}`);

    await util.captureScreenshot(page, 'result');
  } catch (error) {
    throw await util.onTestError(error);
  }
});

test('The header is the title bar the window is dragged by', async ({ page, util }) => {
  try {
    const bar = await page.evaluate(() => {
      const header = document.querySelector('.app-header') as HTMLElement;
      const style = getComputedStyle(header);
      const overlay = (
        navigator as Navigator & {
          windowControlsOverlay?: { visible: boolean; getTitlebarAreaRect: () => DOMRect };
        }
      ).windowControlsOverlay;
      const area = overlay?.getTitlebarAreaRect();
      const button = document.querySelector('[data-testid="btn-settings"]') as HTMLElement;

      return {
        overlay: overlay?.visible ?? false,
        start: parseFloat(style.paddingInlineStart),
        end: parseFloat(style.paddingInlineEnd),
        areaStart: area?.x ?? 0,
        areaEnd: window.innerWidth - (area ? area.x + area.width : window.innerWidth),
        header: style.getPropertyValue('-webkit-app-region'),
        button: getComputedStyle(button).getPropertyValue('-webkit-app-region'),
      };
    });

    // The window has no frame of its own, and the system's buttons sit in the header
    expect(bar.overlay).toBe(true);
    expect(bar.header).toBe('drag');
    expect(bar.button).toBe('no-drag');
    // The header leaves their room free, at whichever end they are
    expect(bar.start).toBeCloseTo(bar.areaStart, 0);
    expect(bar.end).toBeCloseTo(bar.areaEnd, 0);

    // Linux lays its buttons out once a window is on the screen, which a test's never is
    if (process.platform !== 'linux') {
      expect(bar.start + bar.end).toBeGreaterThan(0);
    }
    // The logo alone, without the app's name beside it
    await expect(page.getByTestId('main-logo')).not.toContainText('DaruDB Studio');
  } catch (error) {
    throw await util.onTestError(error);
  }
});

test('Theme and language reach every window', async ({ page, util }) => {
  try {
    const openedWindow = getApp().waitForEvent('window');

    await invokeMain(page, mainChannels.openWindow, '/');

    const childWindow = await openedWindow;

    await childWindow.waitForLoadState('load');
    await expect(childWindow.getByTestId('app-version')).toBeVisible();

    // Every window keeps its own store, so this only holds while the main
    // process passes the choice on
    const themeBefore = await getTheme(page);

    await page.getByTestId('btn-change-theme').click();
    await expect.poll(() => getTheme(page)).not.toBe(themeBefore);
    await expect
      .poll(() => getTheme(childWindow), {
        message: 'Confirm the theme change reached the other window',
      })
      .toBe(await getTheme(page));
    await expect.poll(() => getBackgroundColor(childWindow)).toBe(await getBackgroundColor(page));

    await selectLanguage(page, '한국어');
    await expect(
      childWindow.getByTestId('app-version'),
      'Confirm the language change reached the other window',
    ).toHaveText(`버전 ${pkg.version}`);

    const closedWindow = childWindow.waitForEvent('close');

    // The window is gone before its reply could arrive, so the reply is not
    // waited for. The window count below is what checks the close.
    await invokeMain(childWindow, mainChannels.closeWindow).catch(() => undefined);
    await closedWindow;
    await expect.poll(() => getApp().windows().length).toBe(1);
  } catch (error) {
    throw await util.onTestError(error);
  }
});

test('Theme and language are kept in the settings file between launches', async ({
  page,
  util,
}) => {
  try {
    // Set from here rather than inherited from the test above, so the test
    // holds on its own
    if ((await getTheme(page)) !== 'dark') {
      await page.getByTestId('btn-change-theme').click();
    }

    await expect.poll(() => getTheme(page)).toBe('dark');
    await selectLanguage(page, '日本語');
    await expect(page.getByTestId('app-version')).toHaveText(`バージョン ${pkg.version}`);

    const relaunchedPage = await relaunchApp();

    expect(
      existsSync(join(getUserDataPath(), SETTINGS_FILE_NAME)),
      'Confirm the settings are kept in a DaruDB file',
    ).toBe(true);
    await expect(
      relaunchedPage.getByTestId('app-version'),
      'Confirm the language survived the restart',
    ).toHaveText(`バージョン ${pkg.version}`);
    expect(await getTheme(relaunchedPage), 'Confirm the theme survived the restart').toBe('dark');
    expect(
      await relaunchedPage.evaluate(() => localStorage.length),
      'Confirm nothing is kept in browser storage',
    ).toBe(0);

    await util.captureScreenshot(relaunchedPage, 'result-dark');
  } catch (error) {
    throw await util.onTestError(error);
  }
});

test('A settings file that cannot be read is left alone', async ({ util }) => {
  try {
    const settingsFilePath = join(getUserDataPath(), SETTINGS_FILE_NAME);
    const damagedContent = 'not a DaruDB file';

    const relaunchedPage = await relaunchApp(() => {
      writeFileSync(settingsFilePath, damagedContent);
    });

    // The app starts on the defaults: the light theme the test asks the system
    // for, and the English the test sets as the system locale
    await expect(relaunchedPage.getByTestId('app-version')).toHaveText(`Version ${pkg.version}`);
    expect(await getTheme(relaunchedPage)).toBe('light');

    // A choice made now is kept for this run only, and the file is not replaced
    await relaunchedPage.getByTestId('btn-change-theme').click();
    await expect.poll(() => getTheme(relaunchedPage)).toBe('dark');
    expect(
      readFileSync(settingsFilePath, 'utf8'),
      'Confirm the damaged file was not overwritten',
    ).toBe(damagedContent);
  } catch (error) {
    throw await util.onTestError(error);
  }
});

test('The app draws with the GPU, or without it from its next start', async ({ util }) => {
  try {
    // A settings file of its own, since the test before left one that cannot be read
    const page = await relaunchApp(() => {
      rmSync(join(getUserDataPath(), SETTINGS_FILE_NAME), { force: true });
    });
    const accelerated = () => getApp().evaluate(({ app }) => app.isHardwareAccelerationEnabled());
    const stored = async (target: Page) =>
      (await invokeMain<AppSettings>(target, mainChannels.requestSettings)).hardwareAcceleration;
    const toggle = (target: Page) =>
      target
        .getByTestId('settings-dialog')
        .getByRole('switch', { name: 'Use hardware acceleration (recommended)' });

    expect(await accelerated()).toBe(true);

    await page.getByTestId('btn-settings').click();
    await expect(toggle(page)).toHaveAttribute('aria-checked', 'true');
    await util.captureScreenshot(page, 'settings-system');
    await toggle(page).click();
    await expect(toggle(page)).toHaveAttribute('aria-checked', 'false');
    await page.keyboard.press('Escape');
    await expect.poll(() => stored(page)).toBe(false);
    // Only from the next start
    expect(await accelerated()).toBe(true);

    let relaunched = await relaunchApp();

    expect(await accelerated()).toBe(false);

    await relaunched.getByTestId('btn-settings').click();
    await toggle(relaunched).click();
    await expect(toggle(relaunched)).toHaveAttribute('aria-checked', 'true');
    await relaunched.keyboard.press('Escape');
    await expect.poll(() => stored(relaunched)).toBe(true);

    relaunched = await relaunchApp();
    expect(await accelerated()).toBe(true);
    await expect(relaunched.getByTestId('main-logo')).toBeVisible();
  } catch (error) {
    throw await util.onTestError(error);
  }
});

test('Opening at login is kept, and a test run leaves the system alone', async ({ page, util }) => {
  try {
    const before = await getApp().evaluate(({ app }) => app.getLoginItemSettings().openAtLogin);
    const toggle = page
      .getByTestId('settings-dialog')
      .getByRole('switch', { name: 'Open the app when the system starts' });

    await page.getByTestId('btn-settings').click();
    await expect(toggle).toBeEnabled();
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await expect
      .poll(
        async () => (await invokeMain<AppSettings>(page, mainChannels.requestSettings)).openAtLogin,
      )
      .toBe(true);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await page.keyboard.press('Escape');

    expect(await getApp().evaluate(({ app }) => app.getLoginItemSettings().openAtLogin)).toBe(
      before,
    );
  } catch (error) {
    throw await util.onTestError(error);
  }
});

test('A second start opens a window in the running app, and ends', async ({ page, util }) => {
  try {
    const before = getApp().windows().length;
    const opened = getApp().waitForEvent('window');
    // Started as the app is, on the same user data folder
    const second = spawn(electronBinary, [pkg.main, ...sandbox], {
      env: {
        ...process.env,
        NODE_ENV: 'production',
        DARUDB_STUDIO_HIDDEN: '1',
        DARUDB_STUDIO_USER_DATA: getUserDataPath(),
      },
      stdio: 'ignore',
    });
    const exitCode = await new Promise<number | null>((resolve) => {
      second.once('exit', resolve);
    });

    expect(exitCode).toBe(0);

    const window = await opened;

    await window.waitForLoadState('load');
    await expect(window.getByTestId('main-logo')).toBeVisible();
    expect(getApp().windows()).toHaveLength(before + 1);

    const closed = window.waitForEvent('close');

    await invokeMain(window, mainChannels.closeWindow).catch(() => undefined);
    await closed;
    // The first window is as it was
    await expect(page.getByTestId('main-logo')).toBeVisible();
  } catch (error) {
    throw await util.onTestError(error);
  }
});

test('The self-check loads the engine without a window', async ({ util }) => {
  try {
    const run = spawnSync(electronBinary, [pkg.main, '--self-check', ...sandbox], {
      encoding: 'utf8',
      timeout: 60_000,
      env: { ...process.env, NODE_ENV: 'production', DARUDB_STUDIO_HIDDEN: '1' },
    });

    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain('Self-check passed');
  } catch (error) {
    throw await util.onTestError(error);
  }
});
