import type { Page } from 'playwright';
import { mainChannels } from '../../src/common/ipc';
import { languageOf } from '../../src/common/locales';
import { translate } from '../../src/common/translations';
import type { AppSettings } from '../../src/common/settings';
import { invokeMain, sendMain } from '../ipc';
import { test, expect, beforeAll, afterAll, getApp } from '../fixtures';

test.beforeAll(beforeAll);
test.afterAll(afterAll);

const mac = process.platform === 'darwin';

const openWindow = async (target: Page): Promise<Page> => {
  const opened = getApp().waitForEvent('window');

  await invokeMain(target, mainChannels.openWindow, '/');

  const window = await opened;

  await window.waitForLoadState('load');

  return window;
};

const closeWindow = async (window: Page): Promise<void> => {
  const closed = window.waitForEvent('close');

  // The window is gone before its reply could arrive
  await invokeMain(window, mainChannels.closeWindow).catch(() => undefined);
  await closed;
};

test('The window draws the application menu', async ({ page, util }) => {
  try {
    const bar = page.getByTestId('app-menu-bar');

    await expect(bar).toBeVisible();
    await expect(bar.getByRole('menuitem')).toHaveText([
      ...(mac ? ['DaruDB Studio'] : []),
      'File',
      'Edit',
      'View',
      'Database',
      'Window',
      'Help',
    ]);

    // The entries for a project wait for one
    await bar.getByRole('menuitem', { name: 'Database' }).click();
    await expect(page.getByRole('menuitem', { name: /Refresh Data/ })).toBeDisabled();
    await expect(page.getByRole('menuitem', { name: /Refresh Data/ })).toContainText('F5');
    await util.captureScreenshot(page, 'menu-bar');
    await page.keyboard.press('Escape');
  } catch (error) {
    throw await util.onTestError(error);
  }
});

test('New Window in the menu opens another window', async ({ page, util }) => {
  try {
    const opened = getApp().waitForEvent('window');

    await page.getByTestId('app-menu-bar').getByRole('menuitem', { name: 'File' }).click();
    await page.getByRole('menuitem', { name: /New Window/ }).click();

    const window = await opened;

    await window.waitForLoadState('load');
    await expect(window.getByTestId('app-menu-bar')).toBeVisible();
    await expect.poll(() => getApp().windows().length).toBe(2);

    await closeWindow(window);
    await expect.poll(() => getApp().windows().length).toBe(1);
  } catch (error) {
    throw await util.onTestError(error);
  }
});

test('A click on an entry the menu does not have is ignored', async ({ page, util }) => {
  try {
    await sendMain(page, mainChannels.invokeMenuEntry, 'file.nothing');
    await sendMain(page, mainChannels.invokeMenuEntry, { id: 'file.new-window' });
    // A project entry from a window without a project does nothing either
    await sendMain(page, mainChannels.invokeMenuEntry, 'database.refresh');

    // The main process still answers, and no window was opened
    expect(await invokeMain<AppSettings>(page, mainChannels.requestSettings)).toBeTruthy();
    expect(getApp().windows()).toHaveLength(1);
  } catch (error) {
    throw await util.onTestError(error);
  }
});

test('The menu bar folds behind one button, in every window', async ({ page, util }) => {
  try {
    const other = await openWindow(page);

    // Changed in the other window, which hands it to this one
    await invokeMain(other, mainChannels.updateSettings, { menuBarStyle: 'collapsed' });
    await expect(page.getByTestId('app-menu-bar')).toBeHidden();
    await page.getByTestId('app-menu-button').click();
    await page.getByRole('menuitem', { name: 'Help' }).click();
    await expect(page.getByRole('menuitem', { name: 'DaruDB on GitHub' })).toBeVisible();
    await util.captureScreenshot(page, 'menu-collapsed');
    await page.keyboard.press('Escape');

    await invokeMain(other, mainChannels.updateSettings, { menuBarStyle: 'inline' });
    await expect(page.getByTestId('app-menu-bar')).toBeVisible();
    await closeWindow(other);
  } catch (error) {
    throw await util.onTestError(error);
  }
});

test('The native menu speaks the language the user picked', async ({ page, util }) => {
  try {
    const nativeLabel = () =>
      getApp().evaluate(
        ({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('file.new-window')?.label,
      );

    await invokeMain(page, mainChannels.updateSettings, { language: 'en' });
    await expect.poll(nativeLabel).toBe('New Window');
    await invokeMain(page, mainChannels.updateSettings, { language: 'de' });
    await expect.poll(nativeLabel).toBe('Neues Fenster');

    // Without a choice, the language of the system. The test overrides the
    // locale of the pages only, so the main process still has the machine's.
    const systemLanguage = languageOf([await getApp().evaluate(({ app }) => app.getLocale())]);

    await invokeMain(page, mainChannels.updateSettings, { language: null });
    await expect.poll(nativeLabel).toBe(translate(systemLanguage, 'menu.new-window'));
  } catch (error) {
    throw await util.onTestError(error);
  }
});
