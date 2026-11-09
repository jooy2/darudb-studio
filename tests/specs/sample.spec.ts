import { existsSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Database } from 'darudb';
import type { Page } from 'playwright';
import { test, expect, beforeAll, afterAll, getUserDataPath, relaunchApp } from '../fixtures';
import { closeProject } from '../actions';

test.beforeAll(beforeAll);
test.afterAll(afterAll);

const samplesFolder = (): string => join(getUserDataPath(), 'samples');

const sampleFiles = (): string[] =>
  existsSync(samplesFolder()) ? readdirSync(samplesFolder()).sort() : [];

const openSample = async (page: Page): Promise<void> => {
  await page.getByTestId('btn-open-sample').click();
  await expect(page.getByTestId('project-screen')).toBeVisible();
};

test('The sample opens at once, on a file of its own in the app folder', async ({ page, util }) => {
  try {
    await openSample(page);

    const tree = page.getByTestId('tree-collection');

    await expect(tree).toHaveCount(5);

    for (const name of ['categories', 'customers', 'orders', 'products', 'reviews']) {
      await expect(tree.filter({ hasText: name })).toHaveCount(1);
    }

    await util.captureScreenshot(page, 'sample-project');

    const [file] = sampleFiles();

    expect(file).toMatch(/^sample-\d+-\d+\.darudb$/);

    // Read by another process, as any program would
    const database = Database.open(join(samplesFolder(), file), { create: false });

    try {
      database.read((txn) => {
        expect(txn.collection('categories').count()).toBe(8);
        expect(txn.collection('products').count()).toBe(160);
        expect(txn.collection('customers').count()).toBe(400);
        expect(txn.collection('orders').count()).toBe(2000);
        expect(txn.collection('reviews').count()).toBe(1200);
        // A payment id past what a double holds exactly
        expect(typeof txn.collection('orders').find('status == "delivered"')[0].paymentId).toBe(
          'bigint',
        );
        // Dates, an optional one among them, and an index on two fields
        const [delivered] = txn.collection('orders').find('status == "delivered"');

        expect(delivered.placedAt).toBeInstanceOf(Date);
        expect((delivered.shippedAt as Date).getTime()).toBeGreaterThan(
          (delivered.placedAt as Date).getTime(),
        );
        expect(txn.collection('orders').find('status == "pending"')[0].shippedAt).toBeNull();
      });

      expect(
        database.storedSchema?.collections
          .find((collection) => collection.name === 'orders')
          ?.indexes.some((index) => index.fields.join() === 'status,placedAt'),
      ).toBe(true);
    } finally {
      database.close();
    }

    await closeProject(page);
  } catch (error) {
    throw await util.onTestError(error);
  }
});

test('Every sample is a new file, and the samples go when the app quits', async ({ util }) => {
  try {
    let page = await relaunchApp();

    // The one of the test before went as that run quit
    expect(sampleFiles()).toEqual([]);
    await expect(page.getByTestId('project-item')).toHaveCount(0);

    await openSample(page);
    await closeProject(page);
    await expect(page.getByTestId('project-item')).toHaveText([/Sample, deleted on quit/]);
    await util.captureScreenshot(page, 'sample-listed');

    await openSample(page);
    await closeProject(page);
    await expect(page.getByTestId('project-item')).toHaveCount(2);
    expect(sampleFiles()).toHaveLength(2);

    // One left behind by a run that is gone, and a file the app did not write
    page = await relaunchApp(() => {
      writeFileSync(join(samplesFolder(), 'sample-4194301-1.darudb'), 'left behind');
      writeFileSync(join(samplesFolder(), 'notes.txt'), 'not a sample');
    });

    await expect(page.getByTestId('projects-empty')).toBeVisible();
    expect(sampleFiles()).toEqual(['notes.txt']);
  } catch (error) {
    throw await util.onTestError(error);
  }
});
