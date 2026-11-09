import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Locator, Page } from 'playwright';
import { mainChannels } from '../../src/common/ipc';
import type { PageResult, Row } from '../../src/common/data';
import { parseCsv } from '../../src/common/csv';
import { makeEventsDatabase } from '../databases';
import { invokeMain } from '../ipc';
import { test, expect, beforeAll, afterAll, getApp } from '../fixtures';
import { runMenuEntry } from '../actions';

/*
 * A file whose fields hold dates, and whose collection has indexes on more
 * than one field: how the schema tree, the grid, the object dialog, a filter,
 * an export and an import treat them.
 * */

test.beforeAll(beforeAll);
test.afterAll(afterAll);

const files = mkdtempSync(join(tmpdir(), 'darudb-studio-dates-'));

test.afterAll(() => rmSync(files, { recursive: true, force: true }));

// The columns of the events, in the order the grid draws them
const COLUMNS = ['id', 'title', 'at', 'until', 'reminders', 'place', 'schedule'];

const grid = (page: Page): Locator =>
  page.locator('[role="tabpanel"]:not([hidden]) [role="grid"]').first();

const cell = (page: Page, row: number, column: string): Locator =>
  grid(page).locator(`[data-row="${row}"] [data-col="${COLUMNS.indexOf(column)}"]`);

const count = (page: Page) => page.getByTestId('object-count').filter({ visible: true });

/* The objects of `events` the filter finds, read from the file through the window */
const readEvents = async (page: Page, filter = ''): Promise<Row[]> => {
  const result = await invokeMain<PageResult>(page, mainChannels.readPage, {
    collection: 'events',
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

test('The schema tree shows the dates and every index', async ({ page, util }) => {
  try {
    const path = makeEventsDatabase(files, 'events.darudb');

    await invokeMain(page, mainChannels.saveProject, { name: 'Events', filePath: path });
    await page.reload();
    await page.getByTestId('btn-open-project').click();
    await expect(page.getByTestId('project-screen')).toBeVisible();
    // The only collection opens on its own
    await expect(grid(page)).toHaveAttribute('aria-label', 'events');

    const sidebar = page.getByTestId('sidebar');
    const nameOf = (name: string): Locator =>
      page.locator('.tree-field__name', { hasText: new RegExp(`^${name}$`) });
    const field = (name: string): Locator =>
      sidebar.locator('.tree-field').filter({ has: nameOf(name) });

    await sidebar.getByTestId('tree-collection').click();
    await expect(field('at')).toContainText('date');
    await expect(field('at').locator('.tree-field__index')).toHaveAttribute('title', 'Index');
    await expect(field('until')).toContainText('date?');
    await expect(field('reminders')).toContainText('[date]');
    // `title` is unique only together with `place`, so neither is marked
    await expect(field('title').locator('.tree-field__index')).toHaveCount(0);
    await expect(field('place').locator('.tree-field__index')).toHaveCount(0);

    // The index on an embedded field is marked on that field
    await sidebar
      .getByRole('treeitem')
      .filter({ has: nameOf('schedule') })
      .click();
    await expect(field('starts')).toContainText('date');
    await expect(field('starts').locator('.tree-field__index')).toHaveAttribute('title', 'Index');

    // The indexes on two fields follow the fields, under their names
    const indexes = sidebar.getByTestId('tree-index');

    await expect(indexes).toHaveCount(2);
    await expect(indexes.nth(0)).toContainText('place, at');
    await expect(indexes.nth(0)).toContainText('Index');
    await expect(indexes.nth(1)).toContainText('title, place');
    await expect(indexes.nth(1)).toContainText('Unique index');
    await util.captureScreenshot(page, 'dates-schema');

    // A column is marked for an index of its own field alone
    const header = (name: string): Locator =>
      grid(page).getByRole('columnheader', { name: new RegExp(`^${name}`) });

    await expect(header('at').locator('.grid__head-icon--index')).toHaveCount(1);
    await expect(header('title').locator('.grid__head-icon--index')).toHaveCount(0);
    await expect(header('place').locator('.grid__head-icon--index')).toHaveCount(0);
  } catch (error) {
    throw await util.onTestError(error);
  }
});

test('A date shows in UTC, and is typed as RFC 3339 has it', async ({ page, util }) => {
  try {
    await expect(cell(page, 0, 'at')).toHaveText('2026-01-02T03:04:05.678Z');
    // Its tooltip is the same time in the system's time zone
    await expect(cell(page, 0, 'at').locator('.value--date')).toHaveAttribute('title', /2026/);
    await expect(cell(page, 1, 'until')).toHaveText('null');
    await expect(cell(page, 0, 'reminders')).toContainText('2026-01-01T09:00:00.000Z');
    await util.captureScreenshot(page, 'dates-grid');

    // A time with an offset is kept as the instant it names
    await cell(page, 1, 'at').dblclick();
    await expect(page.getByTestId('cell-editor')).toHaveValue('2026-06-01T00:00:00.000Z');
    await page.getByTestId('cell-editor').fill('2026-06-01T18:00:00+09:00');
    await page.getByTestId('cell-editor').press('Enter');
    await expect(page.getByTestId('status-message')).toHaveText('Saved.');
    await expect(cell(page, 1, 'at')).toHaveText('2026-06-01T09:00:00.000Z');
    expect((await readEvents(page, 'id == 2'))[0].at).toEqual(new Date('2026-06-01T09:00:00Z'));

    // A day alone is its midnight in UTC
    await cell(page, 2, 'until').click();
    await page.keyboard.type('2025-12-25');
    await page.keyboard.press('Enter');
    await expect(cell(page, 2, 'until')).toHaveText('2025-12-25T00:00:00.000Z');

    // A day the calendar does not have, or a time with no offset, is not kept
    for (const text of ['2026-02-30', '2026-01-01T10:00:00']) {
      await cell(page, 2, 'at').click();
      await page.keyboard.type(text);
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('cell-editor')).toHaveAttribute('aria-invalid', 'true');
      await expect(page.getByTestId('cell-editor')).toHaveAttribute('title', /a date is a day/);
      await page.keyboard.press('Escape');
    }

    await expect(cell(page, 2, 'at')).toHaveText('2025-12-24T18:30:00.000Z');
  } catch (error) {
    throw await util.onTestError(error);
  }
});

test('Dates sort, and a filter names one with DATE', async ({ page, util }) => {
  try {
    const header = grid(page).getByRole('columnheader', { name: /^at/ });

    await header.getByRole('button').click();
    await expect(header).toHaveAttribute('aria-sort', 'ascending');
    await expect(cell(page, 0, 'title')).toHaveText('retro');
    await expect(cell(page, 2, 'title')).toHaveText('review');
    await header.getByRole('button').click();
    await header.getByRole('button').click();
    await expect(header).not.toHaveAttribute('aria-sort', /./);

    const filter = page.getByTestId('filter-input').filter({ visible: true });

    await filter.fill('at >= DATE "2026-01-01"');
    await filter.press('Enter');
    await expect(count(page)).toHaveText('2 objects');

    await filter.fill('schedule.starts < DATE "2026-01-02T13:00:00+09:00"');
    await filter.press('Enter');
    await expect(count(page)).toHaveText('1 object');
    await expect(cell(page, 0, 'title')).toHaveText('launch');

    await filter.fill('');
    await filter.press('Enter');
    await expect(count(page)).toHaveText('3 objects');
  } catch (error) {
    throw await util.onTestError(error);
  }
});

test('The object dialog takes a date, and a list of them', async ({ page, util }) => {
  try {
    await page.getByTestId('btn-add-object').click();

    const dialog = page.getByTestId('object-dialog');

    await expect(dialog).toContainText('A day, such as 2026-10-30, or a time with its offset');
    await dialog.getByTestId('object-field-title').fill('planning');
    await dialog.getByTestId('object-field-at').fill('2026-13-01');
    await dialog.getByTestId('btn-save-object').click();
    // The error stands in for the hint under the field
    await expect(dialog).toContainText('a date is a day, such as 2026-10-30');

    await dialog.getByTestId('object-field-at').fill('2026-03-01T10:00:00Z');

    const reminders = dialog.getByTestId('object-field-reminders');

    await reminders.getByRole('button', { name: 'Add an Item' }).click();
    await reminders.getByRole('textbox', { name: 'reminders[0]' }).fill('2026-02-28');
    await util.captureScreenshot(page, 'dates-object-dialog');
    await dialog.getByTestId('btn-save-object').click();
    await expect(dialog).toBeHidden();

    expect(await readEvents(page, 'title == "planning"')).toEqual([
      expect.objectContaining({
        at: new Date('2026-03-01T10:00:00Z'),
        reminders: [new Date('2026-02-28T00:00:00Z')],
      }),
    ]);
    await expect(count(page)).toHaveText('4 objects');
  } catch (error) {
    throw await util.onTestError(error);
  }
});

test('Dates go out to CSV and JSON as RFC 3339 text, and come back in', async ({ page, util }) => {
  try {
    const csv = join(files, 'events.csv');

    await saveTo(csv);
    await runMenuEntry(page, 'database.export-csv');
    await expect(page.getByTestId('status-message')).toHaveText(`Exported 4 objects to ${csv}.`);

    const [header, first] = parseCsv(readFileSync(csv, 'utf8'));

    expect(header).toEqual(COLUMNS);
    expect(first).toEqual([
      '1',
      'launch',
      '2026-01-02T03:04:05.678Z',
      '2026-01-02T05:00:00.000Z',
      '["2026-01-01T09:00:00.000Z"]',
      'hall',
      '{"starts":"2026-01-02T03:00:00.000Z","note":null}',
    ]);

    const json = join(files, 'events.json');

    await saveTo(json);
    await runMenuEntry(page, 'database.export-json');
    await expect(page.getByTestId('status-message')).toHaveText(`Exported 4 objects to ${json}.`);
    expect(JSON.parse(readFileSync(json, 'utf8'))[0]).toMatchObject({
      at: '2026-01-02T03:04:05.678Z',
      reminders: ['2026-01-01T09:00:00.000Z'],
      schedule: { starts: '2026-01-02T03:00:00.000Z' },
    });

    // A file with a time that names no offset writes nothing
    const bad = join(files, 'bad.json');

    writeFileSync(bad, JSON.stringify([{ title: 'vague', at: '2026-07-01T12:00:00' }]));
    await openFrom(bad);
    await runMenuEntry(page, 'database.import-insert');
    await expect(page.getByTestId('import-problems')).toContainText('at: expected a date');
    await page.keyboard.press('Escape');

    const good = join(files, 'good.json');

    writeFileSync(
      good,
      JSON.stringify([
        { title: 'imported', at: '2026-07-01T12:00:00+02:00', reminders: ['2026-06-30'] },
      ]),
    );
    await openFrom(good);
    await runMenuEntry(page, 'database.import-insert');
    await expect(page.getByTestId('status-message')).toHaveText(`Imported 1 object from ${good}.`);
    expect(await readEvents(page, 'title == "imported"')).toEqual([
      expect.objectContaining({
        at: new Date('2026-07-01T10:00:00Z'),
        reminders: [new Date('2026-06-30T00:00:00Z')],
      }),
    ]);
    await expect(count(page)).toHaveText('5 objects');
  } catch (error) {
    throw await util.onTestError(error);
  }
});

test('The schema shows as TypeScript or JSON, and saves to a file', async ({ page, util }) => {
  try {
    await page.getByTestId('btn-view-schema').click();

    const dialog = page.getByTestId('schema-dialog');

    await expect(dialog).toContainText('Schema');
    await expect(dialog.getByTestId('schema-text')).toContainText(
      'export const databaseSchema = schema(1, {',
    );
    await expect(dialog.getByTestId('schema-text')).toContainText('at: t.date().index(),');
    await expect(dialog.getByTestId('schema-text')).toContainText(
      "{ fields: ['title', 'place'], unique: true }",
    );
    await util.captureScreenshot(page, 'schema-dialog');

    await dialog.getByText('JSON', { exact: true }).click();
    await expect(dialog.getByTestId('schema-text')).toContainText('"kind": "date"');

    const saved = join(files, 'events.schema.json');

    await saveTo(saved);
    await dialog.getByTestId('btn-save-schema').click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('status-message')).toHaveText(`Saved the schema to ${saved}.`);
    expect(JSON.parse(readFileSync(saved, 'utf8'))).toMatchObject({ version: 1 });

    // One collection, from its menu in the tree
    await page.getByTestId('tree-collection').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'View Schema' }).click();
    await expect(dialog).toContainText('Schema of events');
    await expect(dialog.getByTestId('schema-text')).toContainText(
      'export const events = collection(',
    );
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  } catch (error) {
    throw await util.onTestError(error);
  }
});
