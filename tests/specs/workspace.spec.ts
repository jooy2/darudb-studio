import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Page } from 'playwright';
import { mainChannels } from '../../src/common/ipc';
import type { AppSettings } from '../../src/common/settings';
import { makeSampleDatabase } from '../databases';
import { invokeMain } from '../ipc';
import { test, expect, beforeAll, afterAll, getApp, relaunchApp } from '../fixtures';

test.beforeAll(beforeAll);
test.afterAll(afterAll);

const files = mkdtempSync(join(tmpdir(), 'darudb-studio-workspace-'));

test.afterAll(() => rmSync(files, { recursive: true, force: true }));

const setRestore = async (page: Page, on: boolean): Promise<void> => {
  await page.getByTestId('btn-settings').click();

  const toggle = page.getByTestId('settings-dialog').getByRole('switch');

  if ((await toggle.getAttribute('aria-checked')) !== String(on)) {
    await toggle.click();
  }

  await expect(toggle).toHaveAttribute('aria-checked', String(on));
  await page.keyboard.press('Escape');
};

const openWindow = async (page: Page): Promise<Page> => {
  const opened = getApp().waitForEvent('window');

  await invokeMain(page, mainChannels.openWindow, '/');

  const window = await opened;

  await expect(
    window.getByTestId('project-list').or(window.getByTestId('projects-empty')),
  ).toBeVisible();

  return window;
};

const closeWindow = async (window: Page): Promise<void> => {
  const closed = window.waitForEvent('close');

  await invokeMain(window, mainChannels.closeWindow).catch(() => undefined);
  await closed;
};

/* The window that shows a project, among the ones open, once one does */
const projectWindow = async (): Promise<Page> => {
  let found: Page | undefined;

  await expect
    .poll(async () => {
      for (const window of getApp().windows()) {
        if ((await window.getByTestId('project-screen').count()) > 0) {
          found = window;

          return true;
        }
      }

      return false;
    })
    .toBe(true);

  return found!;
};

test('The setting is off until the user turns it on', async ({ page, util }) => {
  try {
    expect(
      (await invokeMain<AppSettings>(page, mainChannels.requestSettings)).restoreWorkspace,
    ).toBe(false);
    await setRestore(page, true);
    expect(
      (await invokeMain<AppSettings>(page, mainChannels.requestSettings)).restoreWorkspace,
    ).toBe(true);
  } catch (error) {
    throw await util.onTestError(error);
  }
});

test('The last windows, projects and tabs open again', async ({ page, util }) => {
  try {
    const path = makeSampleDatabase(files, 'Kept.darudb', { users: 50 });

    await invokeMain(page, mainChannels.saveProject, { name: 'Kept', filePath: path });
    await page.reload();
    await page.getByTestId('project-item').getByTestId('btn-open-project').click();
    await page.getByTestId('tree-collection').filter({ hasText: 'users' }).click();

    const filter = page.getByTestId('filter-input').filter({ visible: true });

    await filter.fill('age >= 60');
    await filter.press('Enter');
    await page.getByTestId('tab').filter({ hasText: 'users' }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Split to the Right' }).click();
    await expect(page.getByTestId('tab-group')).toHaveCount(2);

    // A second window, on the list
    await openWindow(page);

    await relaunchApp();
    await expect.poll(() => getApp().windows().length).toBe(2);

    const restored = await projectWindow();
    const groups = restored.getByTestId('tab-group');

    await expect(groups).toHaveCount(2);
    await expect(groups.nth(0).getByTestId('tab')).toHaveText(['teams']);
    await expect(groups.nth(1).getByTestId('tab')).toHaveText(['users']);
    await expect(groups.nth(1).getByTestId('filter-input')).toHaveValue('age >= 60');
    await expect(groups.nth(1).getByTestId('object-count')).toHaveText('10 objects');
    await util.captureScreenshot(restored, 'workspace-restored');
  } catch (error) {
    throw await util.onTestError(error);
  }
});

test('A window closed before the app quits does not open again', async ({ util }) => {
  try {
    const [first, second] = getApp().windows();

    // The window on the project goes, and the list stays
    await closeWindow((await first.getByTestId('project-screen').count()) > 0 ? first : second);
    await expect.poll(() => getApp().windows().length).toBe(1);

    const relaunched = await relaunchApp();

    await expect(
      relaunched.getByTestId('project-list').or(relaunched.getByTestId('projects-empty')),
    ).toBeVisible();
    // Long enough for a second window to have opened, had one been kept
    await relaunched.waitForTimeout(500);
    expect(getApp().windows()).toHaveLength(1);
  } catch (error) {
    throw await util.onTestError(error);
  }
});

test('With the setting off, the app starts on one window', async ({ util }) => {
  try {
    const [page] = getApp().windows();

    await openWindow(page);
    await setRestore(page, false);

    const relaunched = await relaunchApp();

    await expect(
      relaunched.getByTestId('project-list').or(relaunched.getByTestId('projects-empty')),
    ).toBeVisible();
    await relaunched.waitForTimeout(500);
    expect(getApp().windows()).toHaveLength(1);
  } catch (error) {
    throw await util.onTestError(error);
  }
});
