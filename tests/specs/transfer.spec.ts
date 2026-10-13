import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Page } from 'playwright';
import { mainChannels } from '../../src/common/ipc';
import type { PageResult, Row } from '../../src/common/data';
import { parseCsv } from '../../src/common/csv';
import { makeSampleDatabase } from '../databases';
import { invokeMain } from '../ipc';
import { test, expect, beforeAll, afterAll, getApp } from '../fixtures';

test.beforeAll(beforeAll);
test.afterAll(afterAll);

const files = mkdtempSync(join(tmpdir(), 'darudb-studio-transfer-'));

test.afterAll(() => rmSync(files, { recursive: true, force: true }));

/* Makes the next save dialog answer with `path`, as if the user picked it */
const saveTo = (path: string) =>
  getApp().evaluate(({ dialog }, picked) => {
    dialog.showSaveDialog = (async () => ({
      canceled: false,
      filePath: picked,
    })) as unknown as typeof dialog.showSaveDialog;
  }, path);

/* Makes the next open dialog answer with `path` */
const openFrom = (path: string) =>
  getApp().evaluate(({ dialog }, picked) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [picked],
    })) as unknown as typeof dialog.showOpenDialog;
  }, path);

const users = async (page: Page, filter = ''): Promise<Row[]> => {
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

const toolbarMenu = async (page: Page, button: string, item: RegExp): Promise<void> => {
  await page.getByTestId(button).click();
  await page.getByRole('menuitem', { name: item }).click();
};

const count = (page: Page) => page.getByTestId('object-count').filter({ visible: true });

test('A collection exports what its tab shows, as CSV and as JSON', async ({ page, util }) => {
  try {
    const path = makeSampleDatabase(files, 'shop.darudb', { users: 30 });

    await invokeMain(page, mainChannels.saveProject, { name: 'Shop', filePath: path });
    await page.reload();
    await page.getByTestId('btn-open-project').click();
    await page.getByTestId('tree-collection').filter({ hasText: 'users' }).click();

    const filter = page.getByTestId('filter-input').filter({ visible: true });

    await filter.fill('age >= 40');
    await filter.press('Enter');
    await expect(count(page)).toHaveText('10 objects');

    const csv = join(files, 'users.csv');

    await saveTo(csv);
    await toolbarMenu(page, 'btn-export', /As CSV/);
    await expect(page.getByTestId('status-message')).toHaveText(`Exported 10 objects to ${csv}.`);

    const [header, ...lines] = parseCsv(readFileSync(csv, 'utf8'));

    expect(header).toEqual([
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
    ]);
    expect(lines).toHaveLength(10);

    const json = join(files, 'users.json');

    await saveTo(json);
    await toolbarMenu(page, 'btn-export', /As JSON/);
    // The message of this export, not the one before, which says the same count
    await expect(page.getByTestId('status-message')).toHaveText(`Exported 10 objects to ${json}.`);
    expect(JSON.parse(readFileSync(json, 'utf8'))).toHaveLength(10);

    // The selected rows alone, from the grid's context menu
    const grid = page.locator('[role="tabpanel"]:not([hidden]) [role="grid"]').first();

    await grid.locator('[data-row="0"] [data-col="1"]').click();
    await grid.locator('[data-row="1"] [data-col="1"]').click({ modifiers: ['Shift'] });
    await grid.locator('[data-row="1"] [data-col="1"]').click({ button: 'right' });

    const selected = join(files, 'selected.json');

    await saveTo(selected);
    await page.getByRole('menuitem', { name: 'Export 2 Selected Objects' }).click();
    await page.getByRole('menuitem', { name: /As JSON/ }).click();
    await expect(page.getByTestId('status-message')).toContainText('Exported 2 objects');
    expect(JSON.parse(readFileSync(selected, 'utf8'))).toHaveLength(2);
  } catch (error) {
    throw await util.onTestError(error);
  }
});

test('An import writes every record, or none when one does not fit', async ({ page, util }) => {
  try {
    const filter = page.getByTestId('filter-input').filter({ visible: true });

    await filter.fill('');
    await filter.press('Enter');
    await expect(count(page)).toHaveText('30 objects');

    // One record that does not fit stops the whole file
    const bad = join(files, 'bad.json');

    writeFileSync(bad, JSON.stringify([{ name: 'Fine' }, { name: 'Wrong', age: 'old' }]));
    await openFrom(bad);
    await toolbarMenu(page, 'btn-import', /^Add the Objects/);

    const problems = page.getByTestId('import-problems');

    await expect(problems).toContainText('Record 2');
    await expect(problems).toContainText('age: expected a whole number');
    await util.captureScreenshot(page, 'import-problems');
    await page.keyboard.press('Escape');
    expect(await users(page, 'name == "Fine"')).toHaveLength(0);

    const good = join(files, 'good.csv');

    writeFileSync(good, 'name,age,tags\r\nNew one,41,"[""x""]"\r\nNew two,,\r\n');
    await openFrom(good);
    await toolbarMenu(page, 'btn-import', /^Add the Objects/);
    await expect(page.getByTestId('status-message')).toHaveText(`Imported 2 objects from ${good}.`);
    await expect(count(page)).toHaveText('32 objects');
    expect(await users(page, 'name == "New one"')).toEqual([
      expect.objectContaining({ age: 41, tags: ['x'] }),
    ]);

    // Replacing by key changes the object with that key
    const replace = join(files, 'replace.json');

    writeFileSync(replace, JSON.stringify([{ id: 1, name: 'Replaced', age: 99 }]));
    await openFrom(replace);
    await toolbarMenu(page, 'btn-import', /^Add or Replace by Key/);
    await expect(page.getByTestId('status-message')).toContainText('Imported 1 object');
    expect(await users(page, 'id == 1')).toEqual([
      expect.objectContaining({ name: 'Replaced', age: 99 }),
    ]);
    await expect(count(page)).toHaveText('32 objects');
  } catch (error) {
    throw await util.onTestError(error);
  }
});
