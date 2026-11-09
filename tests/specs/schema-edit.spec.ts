import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Locator, Page } from 'playwright';
import { Database } from 'darudb';
import { mainChannels } from '../../src/common/ipc';
import { makeSampleDatabase, sampleSchema } from '../databases';
import { invokeMain } from '../ipc';
import { closeProject } from '../actions';
import { test, expect, beforeAll, afterAll, getApp } from '../fixtures';

/*
 * Changing the schema of the file a project has open, from the schema tree:
 * collections and fields added, renamed and deleted, each one version up,
 * and a program that declares the version before refused afterwards.
 * */

test.beforeAll(beforeAll);
test.afterAll(afterAll);

const files = mkdtempSync(join(tmpdir(), 'darudb-studio-schema-edit-'));

test.afterAll(() => rmSync(files, { recursive: true, force: true }));

let path = '';

const sidebar = (page: Page): Locator => page.getByTestId('sidebar');

const collectionNode = (page: Page, name: string): Locator =>
  sidebar(page)
    .getByTestId('tree-collection')
    .filter({ hasText: new RegExp(`^${name}\\d`) });

const fieldNode = (page: Page, name: string): Locator =>
  sidebar(page).locator(`.tree-field[data-field="${name}"]`);

const dialog = (page: Page): Locator => page.getByTestId('schema-edit-dialog');

/* Picks `item` from the menu of `node` in the schema tree */
const fromMenu = async (page: Page, node: Locator, item: string): Promise<void> => {
  await node.click({ button: 'right' });
  await page.getByRole('menuitem', { name: item }).click();
  await expect(dialog(page)).toBeVisible();
};

/* Makes the change the dialog holds, and waits for it */
const apply = async (page: Page, version: number): Promise<void> => {
  await dialog(page).getByTestId('btn-apply-schema').click();
  await expect(dialog(page)).toBeHidden();
  await expect(page.getByTestId('status-message')).toHaveText(
    `Changed the schema to version ${version}.`,
  );
  await expect(sidebar(page)).toContainText(`Schema v${version}`);
};

/* Makes the next save dialog answer with `target`, as if the user picked it */
const saveTo = (target: string) =>
  getApp().evaluate(({ dialog: dialogs }, picked) => {
    dialogs.showSaveDialog = (async () => ({
      canceled: false,
      filePath: picked,
    })) as unknown as typeof dialogs.showSaveDialog;
  }, target);

test('A collection is added, after a backup the dialog offers', async ({ page, util }) => {
  try {
    path = makeSampleDatabase(files, 'shop.darudb', { users: 5 });
    await invokeMain(page, mainChannels.saveProject, { name: 'Shop', filePath: path });
    await page.reload();
    await page.getByTestId('btn-open-project').click();
    await expect(page.getByTestId('project-screen')).toBeVisible();

    await page.getByTestId('btn-new-collection').click();
    await expect(dialog(page).getByTestId('schema-edit-warning')).toContainText(
      'from 1 to 2. A program that declares version 1 can no longer open the file',
    );

    // A name the file has already is refused before anything is asked of it
    await dialog(page).getByTestId('schema-edit-name').fill('teams');
    await dialog(page).getByTestId('btn-apply-schema').click();
    await expect(dialog(page)).toContainText('the name teams is taken');

    await dialog(page).getByTestId('schema-edit-name').fill('tags');
    await dialog(page).getByTestId('schema-edit-key').getByRole('radio').nth(1).click();
    await dialog(page).getByTestId('schema-edit-key-field').fill('label');
    await dialog(page).getByTestId('schema-edit-backup').click();
    await util.captureScreenshot(page, 'schema-edit-collection');

    const backup = join(files, 'before-tags.darudb');

    await saveTo(backup);
    await apply(page, 2);
    expect(existsSync(backup)).toBe(true);
    await expect(collectionNode(page, 'tags')).toBeVisible();
  } catch (error) {
    throw await util.onTestError(error);
  }
});

test('A field is added with a default, and renamed with the tabs that show it', async ({
  page,
  util,
}) => {
  try {
    await collectionNode(page, 'users').click();
    await fromMenu(page, collectionNode(page, 'users'), 'Add Field…');
    await dialog(page).getByTestId('schema-edit-name').fill('nickname');
    await dialog(page).getByTestId('schema-edit-optional').click();

    // The objects already there need a value of a field that may not be null
    await dialog(page).getByTestId('btn-apply-schema').click();
    await expect(dialog(page)).toContainText('The 5 objects already there need a value');
    await dialog(page).getByTestId('schema-edit-default').fill('none');
    await util.captureScreenshot(page, 'schema-edit-field');
    await apply(page, 3);

    const grid = page.locator('[role="tabpanel"]:not([hidden]) [role="grid"]').first();

    await expect(grid.getByRole('columnheader', { name: /^nickname/ })).toBeVisible();
    await expect(grid.locator('[data-row="0"]')).toContainText('none');

    // A sort by the field follows it to its new name
    await grid
      .getByRole('columnheader', { name: /^email/ })
      .getByRole('button')
      .click();
    await expect(grid.getByRole('columnheader', { name: /^email/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
    await fromMenu(page, fieldNode(page, 'email'), 'Rename Field…');
    await dialog(page).getByTestId('schema-edit-name').fill('mail');
    await apply(page, 4);
    await expect(grid.getByRole('columnheader', { name: /^mail/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
  } catch (error) {
    throw await util.onTestError(error);
  }
});

test('A collection is renamed with its links, and deleted once nothing links to it', async ({
  page,
  util,
}) => {
  try {
    await collectionNode(page, 'teams').click();
    await fromMenu(page, collectionNode(page, 'teams'), 'Rename Collection…');
    await dialog(page).getByTestId('schema-edit-name').fill('squads');
    await apply(page, 5);
    await expect(page.getByTestId('tab').filter({ hasText: 'squads' })).toBeVisible();
    await expect(fieldNode(page, 'team')).toContainText('→ squads');

    // A link to it stops the delete, and the file stays as it was
    await fromMenu(page, collectionNode(page, 'squads'), 'Delete Collection…');
    await expect(dialog(page)).toContainText('squads is deleted with its 2 objects');
    await dialog(page).getByTestId('btn-apply-schema').click();
    await expect(dialog(page).getByTestId('schema-edit-failure')).toContainText(
      'users.team link to squads: delete them first',
    );
    await page.keyboard.press('Escape');

    await fromMenu(page, fieldNode(page, 'team'), 'Delete Field…');
    await expect(dialog(page)).toContainText('team is deleted from the 5 objects of users');
    await apply(page, 6);
    await fromMenu(page, collectionNode(page, 'squads'), 'Delete Collection…');
    await apply(page, 7);
    await expect(collectionNode(page, 'squads')).toBeHidden();
    // Its tab went with it
    await expect(page.getByTestId('tab').filter({ hasText: 'squads' })).toBeHidden();
  } catch (error) {
    throw await util.onTestError(error);
  }
});

test('A change waits for held edits, and the old schema no longer opens the file', async ({
  page,
  util,
}) => {
  try {
    await page.getByTestId('btn-settings').click();
    await page.getByTestId('settings-edit-mode').getByText('When submitted').click();
    await page.keyboard.press('Escape');

    const grid = page.locator('[role="tabpanel"]:not([hidden]) [role="grid"]').first();

    await collectionNode(page, 'users').click();
    await grid.locator('[data-row="0"] [data-col="1"]').dblclick();
    await page.getByTestId('cell-editor').fill('Held');
    await page.getByTestId('cell-editor').press('Enter');

    await fromMenu(page, collectionNode(page, 'users'), 'Rename Collection…');
    await expect(dialog(page)).toContainText('Submit or discard the change you hold first.');
    await expect(dialog(page).getByTestId('btn-apply-schema')).toBeDisabled();
    await page.keyboard.press('Escape');

    await page.getByTestId('btn-discard').click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Discard' }).click();
    await page.getByTestId('btn-settings').click();
    await page.getByTestId('settings-edit-mode').getByText('At once').click();
    await page.keyboard.press('Escape');
    await closeProject(page);

    // A program that still declares version 1 is refused, one with no schema reads version 7
    expect(() => Database.open(path, { schema: sampleSchema, create: false })).toThrow(
      'the file holds schema version 7, newer than the version 1 declared',
    );

    const db = Database.open(path, { create: false });

    expect(db.storedSchema?.collections.map((each) => each.name)).toEqual(['users', 'tags']);
    db.close();
  } catch (error) {
    throw await util.onTestError(error);
  }
});
