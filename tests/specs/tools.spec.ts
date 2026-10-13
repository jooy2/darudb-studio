import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Page } from 'playwright';
import { mainChannels } from '../../src/common/ipc';
import type { FileCheck, Project } from '../../src/common/projects';
import { makeDamagedDatabase, makeSampleDatabase } from '../databases';
import { invokeMain } from '../ipc';
import { test, expect, beforeAll, afterAll, getApp } from '../fixtures';

test.beforeAll(beforeAll);
test.afterAll(afterAll);

const files = mkdtempSync(join(tmpdir(), 'darudb-studio-tools-'));

test.afterAll(() => rmSync(files, { recursive: true, force: true }));

const PASSWORD = 'correct horse';

/* Makes the next save dialog answer with `path`, as if the user picked it */
const saveTo = (path: string) =>
  getApp().evaluate(({ dialog }, picked) => {
    dialog.showSaveDialog = (async () => ({
      canceled: false,
      filePath: picked,
    })) as unknown as typeof dialog.showSaveDialog;
  }, path);

const check = (page: Page, path: string, password?: string) =>
  invokeMain<FileCheck>(page, mainChannels.checkDatabaseFile, path, password);

const openProject = async (page: Page, name: string): Promise<void> => {
  await page.reload();
  await page
    .getByTestId('project-item')
    .filter({ hasText: name })
    .getByTestId('btn-open-project')
    .click();
};

const closeProject = async (page: Page): Promise<void> => {
  await page.getByTestId('btn-close-project').click();
  await expect(page.getByTestId('project-list')).toBeVisible();
};

test('A file too damaged to open is rescued into a new project', async ({ page, util }) => {
  try {
    // The rescued project is named in the main process, whose system language
    // the test does not set, unlike the page's
    await invokeMain(page, mainChannels.updateSettings, { language: 'en' });

    const damaged = makeDamagedDatabase(files, 'header.darudb', 'header');
    const rescued = join(files, 'header-rescued.darudb');

    await invokeMain(page, mainChannels.saveProject, { name: 'Header', filePath: damaged });
    await openProject(page, 'Header');

    const dialog = page.getByTestId('damaged-dialog');

    await expect(dialog).toBeVisible();
    await util.captureScreenshot(page, 'damaged-dialog');
    await saveTo(rescued);
    await dialog.getByTestId('btn-rescue').click();

    const report = page.getByTestId('rescued-dialog');

    await expect(report).toContainText(rescued);
    await report.getByTestId('btn-open-rescued').click();
    await expect(page.getByTestId('project-screen')).toBeVisible();
    await page.getByTestId('tree-collection').filter({ hasText: 'users' }).click();
    await expect(page.getByTestId('object-count').filter({ visible: true })).toHaveText(
      '300 objects',
    );
    expect(existsSync(damaged)).toBe(true);
    await closeProject(page);
    await expect(
      page.getByTestId('project-item').filter({ hasText: 'Header (rescued)' }),
    ).toBeVisible();
  } catch (error) {
    throw await util.onTestError(error);
  }
});

test('The tools rescue the damaged file a window has open', async ({ page, util }) => {
  try {
    const damaged = makeDamagedDatabase(files, 'objects.darudb', 'objects');
    const rescued = join(files, 'objects-rescued.darudb');

    await invokeMain(page, mainChannels.saveProject, { name: 'Objects', filePath: damaged });
    await openProject(page, 'Objects');
    await expect(page.getByTestId('project-screen')).toBeVisible();
    await page.getByTestId('btn-tools').click();
    await page.getByTestId('tool-check').getByRole('button', { name: 'Check' }).click();
    await expect(page.getByTestId('check-report')).toContainText('rescue');

    await saveTo(rescued);
    await page.getByTestId('tool-rescue').getByRole('button', { name: 'Rescue…' }).click();
    await expect(page.getByTestId('rescue-report')).toContainText('damaged pages were skipped');
    await util.captureScreenshot(page, 'rescue-report');

    // The window keeps its project, open again on the damaged file
    await expect(page.getByTestId('project-screen')).toBeVisible();

    const opened = getApp().waitForEvent('window');

    await page
      .getByTestId('rescue-report')
      .getByRole('button', { name: 'Open the Rescued Project' })
      .click();

    const other = await opened;

    await expect(other.getByTestId('project-screen')).toBeVisible();
    expect(await check(page, rescued)).toMatchObject({ status: 'ok' });

    const closed = other.waitForEvent('close');

    await invokeMain(other, mainChannels.closeWindow).catch(() => undefined);
    await closed;
    await closeProject(page);
  } catch (error) {
    throw await util.onTestError(error);
  }
});

test('The password of an encrypted file changes, and the project remembers it', async ({
  page,
  util,
}) => {
  try {
    const path = makeSampleDatabase(files, 'secret.darudb', { password: PASSWORD });
    const project = await invokeMain<Project>(page, mainChannels.saveProject, {
      name: 'Secret',
      filePath: path,
      password: PASSWORD,
    });

    expect(project.hasPassword).toBe(true);
    await openProject(page, 'Secret');
    await page.getByTestId('btn-tools').click();

    const tool = page.getByTestId('tool-password');

    await tool.getByTestId('new-password').fill('battery staple');
    await tool.getByTestId('repeat-password').fill('battery');
    await expect(tool.getByRole('button', { name: 'Change' })).toBeDisabled();
    await tool.getByTestId('repeat-password').fill('battery staple');
    await tool.getByRole('button', { name: 'Change' }).click();
    await expect(page.getByTestId('password-report')).toContainText('remembers the new one');
    await closeProject(page);

    expect(await check(page, path, PASSWORD)).toEqual({ status: 'wrong-password' });
    expect(await check(page, path, 'battery staple')).toMatchObject({ status: 'ok' });

    // The remembered password is the new one, so the project opens at once
    await openProject(page, 'Secret');
    await expect(page.getByTestId('project-screen')).toBeVisible();
    await closeProject(page);
  } catch (error) {
    throw await util.onTestError(error);
  }
});

test('A backup may be encrypted with a password of its own', async ({ page, util }) => {
  try {
    const path = makeSampleDatabase(files, 'plain.darudb');
    const copy = join(files, 'plain-encrypted.darudb');

    await invokeMain(page, mainChannels.saveProject, { name: 'Plain', filePath: path });
    await openProject(page, 'Plain');
    await page.getByTestId('btn-tools').click();
    // A plain file has no password to change
    await expect(page.getByTestId('tool-password')).toHaveCount(0);

    const tool = page.getByTestId('tool-backup');

    await tool.getByTestId('backup-encrypt').click();
    await expect(tool.getByRole('button', { name: 'Back Up…' })).toBeDisabled();
    await tool.getByTestId('backup-password').fill(PASSWORD);
    await saveTo(copy);
    await tool.getByRole('button', { name: 'Back Up…' }).click();
    await expect(page.getByTestId('backup-report')).toContainText(copy);

    expect(await check(page, copy)).toEqual({ status: 'needs-password' });
    expect(await check(page, copy, PASSWORD)).toMatchObject({ status: 'ok', encrypted: true });
    await closeProject(page);
  } catch (error) {
    throw await util.onTestError(error);
  }
});
