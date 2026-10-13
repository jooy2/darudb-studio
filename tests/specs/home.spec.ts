import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Page } from 'playwright';
import { mainChannels } from '../../src/common/ipc';
import type { FileCheck, Project } from '../../src/common/projects';
import type { AppSettings } from '../../src/common/settings';
import { makeNotADatabase, makeSampleDatabase } from '../databases';
import { invokeMain, sendMain } from '../ipc';
import { test, expect, beforeAll, afterAll, getApp, getUserDataPath } from '../fixtures';

test.beforeAll(beforeAll);
test.afterAll(afterAll);

const files = mkdtempSync(join(tmpdir(), 'darudb-studio-home-'));

test.afterAll(() => rmSync(files, { recursive: true, force: true }));

const PASSWORD = 'correct horse';

/*
 * Makes the next open dialog answer with `path`, as if the user picked it.
 * The real dialog would put a window on the screen.
 * */
const pickFile = (path: string) =>
  getApp().evaluate(({ dialog }, picked) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [picked],
    })) as unknown as typeof dialog.showOpenDialog;
  }, path);

const projectItem = (target: Page, name: string) =>
  target.getByTestId('project-item').filter({ hasText: name });

const openProject = (target: Page, name: string) =>
  projectItem(target, name).getByTestId('btn-open-project').click();

const createProject = async (
  target: Page,
  path: string,
  name: string,
  password?: string,
): Promise<void> => {
  await target.getByTestId('btn-new-project').first().click();

  const dialog = target.getByTestId('project-dialog');

  await pickFile(path);
  await dialog.getByTestId('btn-browse-file').click();
  await expect(dialog.getByTestId('project-file')).toHaveValue(path);
  await dialog.getByTestId('project-name').fill(name);

  if (password) {
    await dialog.getByTestId('project-password').fill(password);
  }

  await dialog.getByTestId('btn-save-project').click();
  await expect(dialog).toBeHidden();
  await expect(projectItem(target, name)).toBeVisible();
};

/* Brings the tools tab forward, which lists what is known of the file */
const showFacts = (target: Page) => target.getByTestId('btn-tools').click();

const backToList = async (target: Page): Promise<void> => {
  await target.getByTestId('btn-close-project').click();
  await expect(target.getByTestId('project-list')).toBeVisible();
};

test('A window starts on the loading screen, then shows the projects', async ({ page, util }) => {
  try {
    const opened = getApp().waitForEvent('window');

    await invokeMain(page, mainChannels.openWindow, '/');

    const window = await opened;

    await expect(window.getByTestId('loading-screen')).toBeVisible();
    await expect(window.getByTestId('projects-empty')).toBeVisible();
    await expect(window.getByTestId('loading-screen')).toBeHidden();
    await util.captureScreenshot(window, 'home-empty');

    const closed = window.waitForEvent('close');

    await invokeMain(window, mainChannels.closeWindow).catch(() => undefined);
    await closed;
  } catch (error) {
    throw await util.onTestError(error);
  }
});

test('A file that is not a database is not kept', async ({ page, util }) => {
  try {
    await page.getByTestId('btn-new-project').first().click();

    const dialog = page.getByTestId('project-dialog');

    await expect(dialog.getByTestId('project-name')).toBeFocused();
    await pickFile(makeNotADatabase(files));
    await dialog.getByTestId('btn-browse-file').click();
    await expect(dialog).toContainText('This file is not a DaruDB database');
    await expect(dialog.getByTestId('project-file')).toHaveValue('');

    // Saving without a name or a file says what is missing
    await dialog.getByTestId('btn-save-project').click();
    await expect(dialog).toContainText('Give the project a name.');
    await expect(dialog).toContainText('Choose the database file the project opens.');

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  } catch (error) {
    throw await util.onTestError(error);
  }
});

test('A password is tried before it is remembered', async ({ page, util }) => {
  try {
    const secret = makeSampleDatabase(files, 'vault.db', { password: PASSWORD });

    await page.getByTestId('btn-new-project').first().click();

    const dialog = page.getByTestId('project-dialog');

    await pickFile(secret);
    await dialog.getByTestId('btn-browse-file').click();
    // The name comes from the file, and the file says it is encrypted
    await expect(dialog.getByTestId('project-name')).toHaveValue('vault');
    await expect(dialog).toContainText('An encrypted DaruDB database.');
    // The key is the file's encryption key, and a project does without one
    await expect(dialog.getByText('Encryption key (optional)')).toBeVisible();

    await dialog.getByTestId('project-password').fill('wrong');
    await dialog.getByTestId('btn-save-project').click();
    await expect(dialog).toContainText('This encryption key does not open the file.');

    await dialog.getByTestId('project-password').fill(PASSWORD);
    await util.captureScreenshot(page, 'project-dialog');
    await dialog.getByTestId('btn-save-project').click();
    await expect(dialog).toBeHidden();
    await expect(projectItem(page, 'vault')).toContainText('Key saved');
  } catch (error) {
    throw await util.onTestError(error);
  }
});

test('A project opens, and closes back to the list', async ({ page, util }) => {
  try {
    await createProject(page, makeSampleDatabase(files, 'plain.darudb'), 'Plain');
    await openProject(page, 'Plain');
    await expect(page.getByTestId('project-screen')).toBeVisible();
    await showFacts(page);
    await expect(page.getByTestId('project-format-version')).toHaveText('6');
    await expect(page.getByTestId('project-encrypted')).toHaveText('Not encrypted');
    expect(await page.evaluate(() => document.title)).toBe('Plain - DaruDB Studio');

    // The menu's entries for a project come alive
    await page.getByTestId('app-menu-bar').getByRole('menuitem', { name: 'File' }).click();
    await expect(page.getByRole('menuitem', { name: /Close Project/ })).toBeEnabled();
    await page.keyboard.press('Escape');

    await util.captureScreenshot(page, 'project-screen');
    await backToList(page);

    // The project opened last comes first
    await expect(page.getByTestId('project-item').first()).toContainText('Plain');
    await expect(projectItem(page, 'Plain')).toContainText('Opened');
  } catch (error) {
    throw await util.onTestError(error);
  }
});

test('An encrypted file asks for its password once it is not remembered', async ({
  page,
  util,
}) => {
  try {
    // The remembered password opens it at once
    await openProject(page, 'vault');
    await showFacts(page);
    await expect(page.getByTestId('project-encrypted')).toHaveText('Encrypted');
    await backToList(page);

    const [vault] = (await invokeMain<Project[]>(page, mainChannels.listProjects)).filter(
      (project) => project.name === 'vault',
    );

    await invokeMain(page, mainChannels.saveProject, {
      id: vault.id,
      name: vault.name,
      filePath: vault.filePath,
      password: null,
    });
    await page.reload();

    await openProject(page, 'vault');

    const dialog = page.getByTestId('password-dialog');

    await expect(dialog.getByTestId('open-password')).toBeFocused();
    await dialog.getByTestId('open-password').fill('wrong');
    await dialog.getByTestId('btn-open-with-password').click();
    await expect(dialog).toContainText('This encryption key does not open the file.');
    await expect(dialog.getByTestId('open-password')).toHaveValue('');

    await dialog.getByTestId('open-password').fill(PASSWORD);
    await dialog.getByTestId('open-remember-password').click();
    await util.captureScreenshot(page, 'password-dialog');
    await dialog.getByTestId('btn-open-with-password').click();
    await expect(page.getByTestId('project-screen')).toBeVisible();
    await backToList(page);
    await expect(projectItem(page, 'vault')).toContainText('Key saved');
  } catch (error) {
    throw await util.onTestError(error);
  }
});

test('A file in an older format opens on a copy, or raised in place', async ({ page, util }) => {
  try {
    const kept = makeSampleDatabase(files, 'kept.darudb', { olderFormat: true });
    const raised = makeSampleDatabase(files, 'raised.darudb', { olderFormat: true });
    const check = (path: string) =>
      invokeMain<FileCheck>(page, mainChannels.checkDatabaseFile, path);

    expect(await check(kept)).toMatchObject({ formatVersion: 5, needsUpgrade: true });

    await createProject(page, kept, 'Kept');
    await openProject(page, 'Kept');

    const dialog = page.getByTestId('upgrade-dialog');

    await expect(dialog).toContainText('format version 5');
    await util.captureScreenshot(page, 'upgrade-dialog');
    await dialog.getByTestId('btn-upgrade-copy').click();
    await showFacts(page);
    await expect(page.getByTestId('project-format-version')).toHaveText('6');
    // The copy lives in the app's own folder, and the original is untouched
    await expect(page.getByTestId('project-path')).toContainText(
      join(getUserDataPath(), 'databases'),
    );
    expect(await check(kept)).toMatchObject({ formatVersion: 5 });
    await backToList(page);
    await expect(projectItem(page, 'Kept')).toContainText('Working copy');

    await createProject(page, raised, 'Raised');
    await openProject(page, 'Raised');
    await page.getByTestId('upgrade-dialog').getByTestId('btn-upgrade-original').click();
    await showFacts(page);
    await expect(page.getByTestId('project-path')).toHaveText(raised);
    expect(await check(raised)).toMatchObject({ formatVersion: 6, needsUpgrade: false });
    await backToList(page);

    // Deleting the project deletes the copy the app made, and only that
    const [project] = (await invokeMain<Project[]>(page, mainChannels.listProjects)).filter(
      (each) => each.name === 'Kept',
    );

    await projectItem(page, 'Kept').getByTestId('btn-edit-project').click();
    await page.getByTestId('project-dialog').getByTestId('btn-delete-project').click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete Project' }).click();
    await expect(projectItem(page, 'Kept')).toHaveCount(0);
    expect(existsSync(project.filePath)).toBe(false);
    expect(existsSync(kept)).toBe(true);
  } catch (error) {
    throw await util.onTestError(error);
  }
});

test('A project whose file is gone offers to be deleted', async ({ page, util }) => {
  try {
    const doomed = makeSampleDatabase(files, 'doomed.darudb');

    await createProject(page, doomed, 'Doomed');
    rmSync(doomed);
    await page.reload();
    await expect(projectItem(page, 'Doomed')).toContainText('File not found');
    await util.captureScreenshot(page, 'home-missing');

    await openProject(page, 'Doomed');

    const dialog = page.getByTestId('missing-dialog');

    await expect(dialog).toContainText(doomed);
    await dialog.getByTestId('btn-delete-missing').click();
    await expect(dialog).toBeHidden();
    await expect(projectItem(page, 'Doomed')).toHaveCount(0);
  } catch (error) {
    throw await util.onTestError(error);
  }
});

test('A project opens in one window at a time', async ({ page, util }) => {
  try {
    const opened = getApp().waitForEvent('window');

    await invokeMain(page, mainChannels.openWindow, '/');

    const other = await opened;

    await openProject(page, 'Plain');
    await expect(page.getByTestId('project-screen')).toBeVisible();

    await openProject(other, 'Plain');
    await expect(other.getByText('Plain is open in another window')).toBeVisible();
    await expect(other.getByTestId('project-list')).toBeVisible();

    // Nor is it changed or deleted from there while it is open
    const [plain] = (await invokeMain<Project[]>(other, mainChannels.listProjects)).filter(
      (project) => project.name === 'Plain',
    );

    await expect(invokeMain(other, mainChannels.deleteProject, plain.id)).rejects.toThrow(/open/);

    const closed = other.waitForEvent('close');

    await invokeMain(other, mainChannels.closeWindow).catch(() => undefined);
    await closed;
    await backToList(page);
  } catch (error) {
    throw await util.onTestError(error);
  }
});

test('New Project in a window showing a project opens another window', async ({ page, util }) => {
  try {
    await openProject(page, 'Plain');
    await expect(page.getByTestId('project-screen')).toBeVisible();

    const opened = getApp().waitForEvent('window');

    await sendMain(page, mainChannels.invokeMenuEntry, 'file.new-project');

    const window = await opened;

    await expect(window.getByTestId('project-dialog')).toBeVisible();
    await expect(page.getByTestId('project-screen')).toBeVisible();

    const closed = window.waitForEvent('close');

    await invokeMain(window, mainChannels.closeWindow).catch(() => undefined);
    await closed;
    await backToList(page);
  } catch (error) {
    throw await util.onTestError(error);
  }
});

test('The list lays out as a grid or as rows', async ({ page, util }) => {
  try {
    await page.getByTestId('project-view').getByText('List').click();
    await expect(page.getByTestId('project-list')).toHaveClass(/project-list--list/);
    await util.captureScreenshot(page, 'home-list');

    expect(await invokeMain<AppSettings>(page, mainChannels.requestSettings)).toMatchObject({
      projectView: 'list',
    });

    await page.getByTestId('project-view').getByText('Grid').click();
    await expect(page.getByTestId('project-list')).toHaveClass(/project-list--grid/);
    await util.captureScreenshot(page, 'home-grid');
  } catch (error) {
    throw await util.onTestError(error);
  }
});

test('The settings dialog changes every window', async ({ page, util }) => {
  try {
    await page.getByTestId('btn-settings').click();

    const dialog = page.getByTestId('settings-dialog');

    await dialog.getByTestId('settings-menu-bar').getByText('One button').click();
    await expect(page.getByTestId('app-menu-button')).toBeVisible();
    await dialog.getByTestId('settings-edit-mode').getByText('When submitted').click();
    await dialog.getByTestId('settings-theme').getByText('Dark').click();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
      .toBe('dark');
    await util.captureScreenshot(page, 'settings-dialog');

    expect(await invokeMain<AppSettings>(page, mainChannels.requestSettings)).toMatchObject({
      menuBarStyle: 'collapsed',
      editMode: 'submit',
      darkTheme: true,
    });

    // Back to the system's theme, which the test sets to light
    await dialog.getByTestId('settings-theme').getByText('System').click();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
      .toBe('light');
    await dialog.getByTestId('settings-menu-bar').getByText('In a row').click();
    await dialog.getByRole('button', { name: 'Close' }).last().click();
    await expect(dialog).toBeHidden();
  } catch (error) {
    throw await util.onTestError(error);
  }
});

test('A menu command waits for the window it opens', async ({ page, util }) => {
  try {
    const opened = getApp().waitForEvent('window');

    // A test run focuses no window, so the native menu opens one for the command
    await getApp().evaluate(({ Menu }) => {
      const menu = Menu.getApplicationMenu();
      const item = menu?.getMenuItemById('app.settings') ?? menu?.getMenuItemById('file.settings');

      item?.click();
    });

    const window = await opened;

    await expect(window.getByTestId('settings-dialog')).toBeVisible();
    await expect(page.getByTestId('settings-dialog')).toBeHidden();

    const closed = window.waitForEvent('close');

    await invokeMain(window, mainChannels.closeWindow).catch(() => undefined);
    await closed;
  } catch (error) {
    throw await util.onTestError(error);
  }
});
