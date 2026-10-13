import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { Page } from 'playwright';
import pkg from '../../package.json' with { type: 'json' };
import { mainChannels } from '../../src/common/ipc';
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

const getTheme = (target: Page) => target.evaluate(() => document.documentElement.dataset.theme);

const getBackgroundColor = (target: Page) =>
  target.evaluate(() => getComputedStyle(document.body).backgroundImage);

const selectLanguage = async (target: Page, languageName: string): Promise<void> => {
  await target.getByTestId('select-language').getByRole('combobox').click();
  await target.getByRole('option', { name: languageName }).click();
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
