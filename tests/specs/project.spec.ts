import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Locator, Page } from 'playwright';
import { mainChannels } from '../../src/common/ipc';
import type { FileCheck } from '../../src/common/projects';
import type { PageResult, Row } from '../../src/common/data';
import { makeSampleDatabase } from '../databases';
import { invokeMain, sendMain } from '../ipc';
import { test, expect, beforeAll, afterAll, getApp } from '../fixtures';

test.beforeAll(beforeAll);
test.afterAll(afterAll);

const files = mkdtempSync(join(tmpdir(), 'darudb-studio-project-'));

test.afterAll(() => rmSync(files, { recursive: true, force: true }));

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

// The columns of the sample's users, in the order the grid draws them
const USER_COLUMNS = [
  'id',
  'name',
  'email',
  'age',
  'score',
  'tags',
  'team',
  'address',
  'active',
  'avatar',
];

/* The grid of the tab in front of the first group */
const visibleGrid = (page: Page): Locator =>
  page.locator('[role="tabpanel"]:not([hidden]) [role="grid"]').first();

const cell = (page: Page, row: number, column: string): Locator =>
  visibleGrid(page).locator(`[data-row="${row}"] [data-col="${USER_COLUMNS.indexOf(column)}"]`);

const selectionText = (page: Page) => page.getByTestId('status-selection');

/* The objects of `users` the filter finds, read from the file through the window */
const readUsers = async (page: Page, filter = ''): Promise<Row[]> => {
  const result = await invokeMain<PageResult>(page, mainChannels.readPage, {
    collection: 'users',
    filter,
    sort: [],
    offset: 0,
    limit: 1000,
  });

  if (result.status !== 'ok') {
    throw new Error(result.message);
  }

  return result.rows;
};

/* Creates a project on a fresh sample file and opens it in `page` */
const openSample = async (page: Page, name: string, users = 500): Promise<string> => {
  const path = makeSampleDatabase(files, `${name}.darudb`, { users });

  await invokeMain(page, mainChannels.saveProject, { name, filePath: path });
  await page.reload();
  await page
    .getByTestId('project-item')
    .filter({ hasText: name })
    .getByTestId('btn-open-project')
    .click();
  await expect(page.getByTestId('project-screen')).toBeVisible();

  return path;
};

const openUsers = async (page: Page): Promise<void> => {
  await page.getByTestId('tree-collection').filter({ hasText: 'users' }).click();
  await expect(visibleGrid(page)).toHaveAttribute('aria-label', 'users');
};

const closeProject = async (page: Page): Promise<void> => {
  await page.getByTestId('btn-close-project').click();
  await expect(page.getByTestId('project-list')).toBeVisible();
};

const setEditMode = async (page: Page, mode: 'At once' | 'When submitted'): Promise<void> => {
  await page.getByTestId('btn-settings').click();

  const dialog = page.getByTestId('settings-dialog');

  await dialog.getByTestId('settings-edit-mode').getByText(mode).click();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
};

test('The project screen shows the schema and every object', async ({ page, util }) => {
  try {
    await openSample(page, 'Shop');

    const collections = page.getByTestId('tree-collection');

    await expect(collections).toHaveCount(2);
    await expect(collections.filter({ hasText: 'users' })).toContainText('500');
    // The first collection opens on its own
    await expect(page.getByTestId('tab').first()).toHaveText('teams');
    await expect(visibleGrid(page).locator('[role="row"][data-row]')).toHaveCount(2);

    await openUsers(page);
    await expect(page.getByTestId('object-count').filter({ visible: true })).toHaveText(
      '500 objects',
    );
    await expect(cell(page, 0, 'name')).toHaveText('user 1');
    await expect(cell(page, 0, 'avatar')).toHaveText('ca fe 01');
    await expect(cell(page, 1, 'email')).toHaveText('user2@example.com');
    await util.captureScreenshot(page, 'project-users');

    // The last row is read when the grid gets there, pages after the first
    await cell(page, 0, 'name').click();
    await page.keyboard.press(`${MOD}+ArrowDown`);
    await expect(cell(page, 499, 'name')).toHaveText('user 500');
  } catch (error) {
    throw await util.onTestError(error);
  }
});

test('The grid sorts by its headers and filters with the query language', async ({
  page,
  util,
}) => {
  try {
    const header = visibleGrid(page).getByRole('columnheader', { name: /^age/ });

    await header.getByRole('button').click();
    await expect(header).toHaveAttribute('aria-sort', 'ascending');
    await expect(cell(page, 0, 'age')).toHaveText('20');
    await header.getByRole('button').click();
    await expect(header).toHaveAttribute('aria-sort', 'descending');
    await expect(cell(page, 0, 'age')).toHaveText('69');
    await header.getByRole('button').click();
    await expect(header).not.toHaveAttribute('aria-sort', /./);

    const filter = page.getByTestId('filter-input').filter({ visible: true });

    await filter.fill('age >= 65');
    await filter.press('Enter');
    await expect(page.getByTestId('object-count').filter({ visible: true })).toHaveText(
      '50 objects',
    );

    await filter.fill('age >=');
    await filter.press('Enter');
    await expect(page.getByTestId('filter-error')).toContainText('expected a value');

    await filter.fill('');
    await filter.press('Enter');
    await expect(page.getByTestId('object-count').filter({ visible: true })).toHaveText(
      '500 objects',
    );
  } catch (error) {
    throw await util.onTestError(error);
  }
});

test('Rows are selected with the mouse and the keyboard', async ({ page, util }) => {
  try {
    await cell(page, 0, 'name').click();
    await expect(selectionText(page)).toHaveText('1 of 500 selected');
    await cell(page, 4, 'name').click({ modifiers: ['Shift'] });
    await expect(selectionText(page)).toHaveText('5 of 500 selected');
    await cell(page, 7, 'name').click({ modifiers: [MOD as 'Meta' | 'Control'] });
    await expect(selectionText(page)).toHaveText('6 of 500 selected');

    // A drag across rows selects them
    const from = await cell(page, 2, 'email').boundingBox();
    const to = await cell(page, 6, 'email').boundingBox();

    await page.mouse.move(from!.x + 5, from!.y + 5);
    await page.mouse.down();
    await page.mouse.move(to!.x + 5, to!.y + 5, { steps: 5 });
    await page.mouse.up();
    await expect(selectionText(page)).toHaveText('5 of 500 selected');

    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Shift+ArrowDown');
    await expect(selectionText(page)).toHaveText('7 of 500 selected');
    await page.keyboard.press(`${MOD}+a`);
    await expect(selectionText(page)).toHaveText('500 of 500 selected');
    await util.captureScreenshot(page, 'project-selection');
    await page.keyboard.press('Escape');
    await expect(selectionText(page)).toHaveText('0 of 500 selected');
  } catch (error) {
    throw await util.onTestError(error);
  }
});

test('A cell is edited in place and written at once', async ({ page, util }) => {
  try {
    await cell(page, 0, 'name').dblclick();
    await page.getByTestId('cell-editor').fill('Ada');
    await page.getByTestId('cell-editor').press('Enter');
    await expect(page.getByTestId('status-message')).toHaveText('Saved.');
    await expect(cell(page, 0, 'name')).toHaveText('Ada');
    expect((await readUsers(page, 'id == 1'))[0].name).toBe('Ada');

    // Typing over a cell starts editing it
    await cell(page, 0, 'age').click();
    await page.keyboard.type('42');
    await page.keyboard.press('Enter');
    await expect(cell(page, 0, 'age')).toHaveText('42');

    // A value that does not fit the field is not kept
    await page.keyboard.type('x');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('cell-editor')).toHaveAttribute('aria-invalid', 'true');
    await page.keyboard.press('Escape');
    await expect(cell(page, 0, 'age')).toHaveText('42');

    // A bool flips with the space bar
    await cell(page, 1, 'active').click();
    await expect(cell(page, 1, 'active')).toHaveText('false');
    await page.keyboard.press(' ');
    await expect(cell(page, 1, 'active')).toHaveText('true');

    // An optional field is set to null from the context menu
    await cell(page, 1, 'email').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Set to Null' }).click();
    await expect(cell(page, 1, 'email')).toHaveText('null');
    expect((await readUsers(page, 'id == 2'))[0]).toMatchObject({ active: true, email: null });
  } catch (error) {
    throw await util.onTestError(error);
  }
});

test('Lists and embedded objects open in place and in a dialog', async ({ page, util }) => {
  try {
    await cell(page, 0, 'tags').getByRole('button', { name: 'Expand' }).click();
    await expect(cell(page, 0, 'tags')).toContainText('[0]');
    await cell(page, 0, 'address').getByRole('button', { name: 'Expand' }).click();
    await expect(cell(page, 0, 'address')).toContainText('city');
    await util.captureScreenshot(page, 'project-nested');

    await cell(page, 0, 'address').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'View Value…' }).click();

    const dialog = page.getByTestId('value-dialog');

    await expect(dialog.getByRole('rowheader', { name: 'city' })).toBeVisible();
    await expect(dialog).toContainText('Busan');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  } catch (error) {
    throw await util.onTestError(error);
  }
});

test('The object dialog edits a whole object, and adds one', async ({ page, util }) => {
  try {
    await cell(page, 2, 'name').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Edit Object…' }).click();

    const dialog = page.getByTestId('object-dialog');

    await dialog.getByTestId('object-field-age').fill('33');
    await dialog.getByTestId('object-field-tags').fill('[1]');
    await dialog.getByTestId('btn-save-object').click();
    await expect(dialog).toContainText('expected a string');

    await dialog.getByTestId('object-field-tags').fill('["a", "b"]');
    await util.captureScreenshot(page, 'project-object-dialog');
    await dialog.getByTestId('btn-save-object').click();
    await expect(dialog).toBeHidden();
    expect((await readUsers(page, 'id == 3'))[0]).toMatchObject({ age: 33, tags: ['a', 'b'] });

    await page.getByTestId('btn-add-object').click();
    await page.getByTestId('object-dialog').getByTestId('object-field-name').fill('New person');
    await page.getByTestId('object-dialog').getByTestId('btn-save-object').click();
    await expect(page.getByTestId('object-dialog')).toBeHidden();
    await expect(page.getByTestId('object-count').filter({ visible: true })).toHaveText(
      '501 objects',
    );
    expect(await readUsers(page, 'name == "New person"')).toHaveLength(1);
  } catch (error) {
    throw await util.onTestError(error);
  }
});

test('Deleting objects asks first', async ({ page, util }) => {
  try {
    await cell(page, 0, 'name').click();
    await cell(page, 2, 'name').click({ modifiers: ['Shift'] });
    await page.keyboard.press('Delete');
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByTestId('object-count').filter({ visible: true })).toHaveText(
      '498 objects',
    );
    expect(await readUsers(page, 'id <= 3')).toHaveLength(0);
  } catch (error) {
    throw await util.onTestError(error);
  }
});

test('Edits wait for a submit when the settings say so', async ({ page, util }) => {
  try {
    await setEditMode(page, 'When submitted');
    await expect(page.getByTestId('status-pending')).toHaveText('0 changes to submit');

    await cell(page, 0, 'name').dblclick();
    await page.getByTestId('cell-editor').fill('Held');
    await page.getByTestId('cell-editor').press('Enter');
    await expect(cell(page, 0, 'name')).toHaveText('Held');
    await expect(cell(page, 0, 'name')).toHaveClass(/grid__cell--changed/);
    await expect(page.getByTestId('status-pending')).toHaveText('1 change to submit');
    // Nothing reached the file yet
    expect(await readUsers(page, 'name == "Held"')).toHaveLength(0);

    await cell(page, 1, 'name').click();
    await page.keyboard.press('Delete');
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByTestId('btn-submit')).toHaveText('Submit 2 Changes');
    await util.captureScreenshot(page, 'project-held');

    await page.getByTestId('btn-submit').click();
    await expect(page.getByTestId('status-message')).toHaveText('Submitted 2 changes.');
    await expect(page.getByTestId('status-pending')).toHaveText('0 changes to submit');
    expect(await readUsers(page, 'name == "Held"')).toHaveLength(1);
    await expect(page.getByTestId('object-count').filter({ visible: true })).toHaveText(
      '497 objects',
    );

    // Held edits can be dropped instead
    await cell(page, 0, 'name').dblclick();
    await page.getByTestId('cell-editor').fill('Dropped');
    await page.getByTestId('cell-editor').press('Enter');
    await page.getByTestId('btn-discard').click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Discard' }).click();
    await expect(cell(page, 0, 'name')).toHaveText('Held');

    // A new object waits at the top until it is submitted
    await page.getByTestId('btn-add-object').click();
    await page.getByTestId('object-dialog').getByTestId('object-field-name').fill('Waiting');
    await page.getByTestId('object-dialog').getByTestId('btn-save-object').click();
    await expect(cell(page, 0, 'name')).toHaveText('Waiting');
    expect(await readUsers(page, 'name == "Waiting"')).toHaveLength(0);
    await sendMain(page, mainChannels.invokeMenuEntry, 'database.submit');
    await expect(page.getByTestId('status-pending')).toHaveText('0 changes to submit');
    expect(await readUsers(page, 'name == "Waiting"')).toHaveLength(1);

    await setEditMode(page, 'At once');
  } catch (error) {
    throw await util.onTestError(error);
  }
});

test('A query runs in a tab of its own', async ({ page, util }) => {
  try {
    await page.getByTestId('btn-new-query').click();

    const query = page.getByTestId('query-tab').filter({ visible: true });

    await query.getByTestId('query-text').fill('age >= 65 SORT BY age DESC LIMIT 3');
    await query.getByTestId('btn-run-query').click();
    await expect(query.getByTestId('query-summary')).toContainText('3 objects in');
    await expect(query.getByTestId('query-grid').locator('[role="row"][data-row]')).toHaveCount(3);
    await util.captureScreenshot(page, 'project-query');

    await query.getByTestId('query-text').fill('age >=');
    await query.getByTestId('query-text').press(`${MOD}+Enter`);
    await expect(query.getByTestId('query-error')).toContainText('expected a value');
  } catch (error) {
    throw await util.onTestError(error);
  }
});

test('Tabs split into groups, move between them and merge back', async ({ page, util }) => {
  try {
    const groups = page.getByTestId('tab-group');
    const tab = (name: string) => page.getByTestId('tab').filter({ hasText: name });

    await expect(groups).toHaveCount(1);
    await tab('users').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Split to the Right' }).click();
    await expect(groups).toHaveCount(2);
    await expect(groups.nth(1).getByTestId('tab')).toHaveText(['users']);
    await util.captureScreenshot(page, 'project-split');

    // A tab dragged to the other strip moves there
    await tab('teams').dragTo(groups.nth(1).getByTestId('tab').first());
    await expect(groups.nth(1).getByTestId('tab')).toHaveText(['teams', 'users']);

    await tab('users').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Merge into the Group on the Left' }).click();
    await expect(groups).toHaveCount(1);
  } catch (error) {
    throw await util.onTestError(error);
  }
});

test('The tools check, compact and back up the file', async ({ page, util }) => {
  try {
    await page.getByTestId('btn-tools').click();
    await page.getByTestId('tool-check').getByRole('button', { name: 'Check' }).click();
    await expect(page.getByTestId('check-report')).toContainText('No problems');
    await page.getByTestId('tool-compact').getByRole('button', { name: 'Compact' }).click();
    await expect(page.getByTestId('compact-report')).toContainText('The file went from');

    const backup = join(files, 'shop-backup.darudb');

    // The save dialog answers with a path, as if the user picked it
    await getApp().evaluate(({ dialog }, picked) => {
      dialog.showSaveDialog = (async () => ({
        canceled: false,
        filePath: picked,
      })) as unknown as typeof dialog.showSaveDialog;
    }, backup);
    await page.getByTestId('tool-backup').getByRole('button', { name: 'Back Up…' }).click();
    await expect(page.getByTestId('backup-report')).toContainText(backup);
    expect(existsSync(backup)).toBe(true);
    expect(await invokeMain<FileCheck>(page, mainChannels.checkDatabaseFile, backup)).toMatchObject(
      { status: 'ok' },
    );
    await util.captureScreenshot(page, 'project-tools');
  } catch (error) {
    throw await util.onTestError(error);
  }
});

test('The menu works on the project in the window', async ({ page, util }) => {
  try {
    const tabs = page.getByTestId('tab');
    const before = await tabs.count();

    await sendMain(page, mainChannels.invokeMenuEntry, 'database.new-query');
    await expect(tabs).toHaveCount(before + 1);

    await sendMain(page, mainChannels.invokeMenuEntry, 'database.check');
    await expect(page.getByTestId('check-report')).toBeVisible();

    await sendMain(page, mainChannels.invokeMenuEntry, 'file.close-project');
    await expect(page.getByTestId('project-list')).toBeVisible();
  } catch (error) {
    throw await util.onTestError(error);
  }
});

test('Closing a project with held edits asks first', async ({ page, util }) => {
  try {
    await page
      .getByTestId('project-item')
      .filter({ hasText: 'Shop' })
      .getByTestId('btn-open-project')
      .click();
    await openUsers(page);
    await setEditMode(page, 'When submitted');
    await cell(page, 0, 'name').dblclick();
    await page.getByTestId('cell-editor').fill('Never');
    await page.getByTestId('cell-editor').press('Enter');

    // The window refuses to unload while edits are held, which makes closing it ask
    const refusesUnload = () =>
      page.evaluate(() => {
        const event = new Event('beforeunload', { cancelable: true });

        window.dispatchEvent(event);

        return event.defaultPrevented;
      });

    expect(await refusesUnload()).toBe(true);

    await page.getByTestId('btn-close-project').click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByTestId('project-screen')).toBeVisible();

    await page.getByTestId('btn-close-project').click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Discard' }).click();
    await expect(page.getByTestId('project-list')).toBeVisible();
    expect(await refusesUnload()).toBe(false);
    await setEditMode(page, 'At once');
    await closeProject(page).catch(() => undefined);
  } catch (error) {
    throw await util.onTestError(error);
  }
});
