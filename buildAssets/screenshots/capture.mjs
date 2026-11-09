/*
 * Captures the screenshots in `.github/screenshots` from the built app, in
 * English. Nothing runs it on its own: run `npm run screenshots` when the
 * screenshots should change, or
 * `node buildAssets/screenshots/capture.mjs <name> ...` after `npm run build:pre`
 * for some of them alone, such as `query-tab`.
 *
 * The app starts as the end-to-end tests start it, off the screen and on a user
 * data folder of its own, and opens the sample database and two small files
 * made here. The project list and the tools tab show where a file is, so that
 * folder and the files are in a folder of a fixed and neutral name,
 * `/tmp/darudb-demo`, or `darudb-demo` in the public folder on Windows, rather
 * than in the user's own temporary folder. It is deleted at the end.
 *
 * A screenshot holds the page alone, without the buttons the system draws over
 * the title bar. The room the header keeps for them, the traffic lights of
 * macOS at its start, would show as an empty band, so the header is given none
 * here, and starts at the left edge as it does on Windows and Linux.
 *
 * Each image is 1280 by 800 CSS pixels. `pngquant` and `oxipng`, where they are
 * on the PATH, make it several times smaller and strip its metadata; without
 * them it is written as Chromium encodes it.
 */

import { spawnSync } from 'child_process';
import { mkdirSync, rmSync } from 'fs';
import { createRequire } from 'module';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { createJiti } from 'jiti';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const { _electron: electron } = require('playwright');
const { Database, collection, schema, t } = require('darudb');
const electronPath = require('electron');
const { mainChannels } = await createJiti(import.meta.url).import('../../src/common/ipc.ts');

const outputDir = join(projectRoot, '.github', 'screenshots');
const demoDir =
  process.platform === 'win32'
    ? join(process.env.PUBLIC ?? 'C:\\Users\\Public', 'darudb-demo')
    : '/tmp/darudb-demo';
const WIDTH = 1280;
const HEIGHT = 800;

const SHOTS = [
  'project-list',
  'collection-grid',
  'object-dialog',
  'schema-dialog',
  'query-tab',
  'tools-tab',
  'split-groups',
  'dark-theme',
];
const requested = process.argv.slice(2);
const unknown = requested.filter((name) => !SHOTS.includes(name));

if (unknown.length > 0) {
  console.error(`Unknown screenshots: ${unknown.join(', ')}. Known: ${SHOTS.join(', ')}.`);
  process.exit(1);
}

const wanted = requested.length > 0 ? requested : SHOTS;

const hasTool = (name) =>
  spawnSync(name, ['--version'], { stdio: 'ignore', shell: process.platform === 'win32' })
    .status === 0;
const compressors = { pngquant: hasTool('pngquant'), oxipng: hasTool('oxipng') };

// Dates a fixed time apart from one day, so the files are the same on every run
const DAY = 24 * 60 * 60 * 1000;
const BASE_DATE = Date.UTC(2026, 9, 1);

/* A small file of books, for the project list */
const makeBookshelf = () => {
  const path = join(demoDir, 'bookshelf.darudb');
  const db = Database.open(path, {
    schema: schema(1, {
      books: collection({
        title: t.string().index(),
        author: t.string().index(),
        year: t.int(),
        rating: t.int().optional(),
        read: t.bool().default(false),
        tags: t.list(t.string()).optional(),
        addedAt: t.date().index(),
      }),
    }),
  });

  try {
    db.write((txn) => {
      txn.collection('books').insertMany(
        Array.from({ length: 42 }, (_, index) => ({
          title: `Book ${index + 1}`,
          author: `Author ${(index % 9) + 1}`,
          year: 1990 + (index % 30),
          rating: index % 4 === 0 ? null : (index % 5) + 1,
          read: index % 3 === 0,
          tags: index % 2 === 0 ? ['fiction'] : ['essay'],
          addedAt: new Date(BASE_DATE - index * DAY),
        })),
      );
    });
  } finally {
    db.close();
  }

  return path;
};

/* A small file of tasks, for the project list */
const makeTasks = () => {
  const path = join(demoDir, 'tasks.darudb');
  const db = Database.open(path, {
    schema: schema(1, {
      projects: collection({ name: t.string().primaryKey(), color: t.string().optional() }),
      tasks: collection({
        title: t.string(),
        project: t.link('projects').index(),
        done: t.bool().default(false).index(),
        priority: t.int().default(0),
        due: t.date().optional(),
      }),
    }),
  });

  try {
    db.write((txn) => {
      txn.collection('projects').insertMany([
        { name: 'home', color: 'green' },
        { name: 'work', color: 'blue' },
      ]);
      txn.collection('tasks').insertMany(
        Array.from({ length: 120 }, (_, index) => ({
          title: `Task ${index + 1}`,
          project: index % 2 === 0 ? 'home' : 'work',
          done: index % 4 === 0,
          priority: index % 3,
          due: index % 5 === 0 ? null : new Date(BASE_DATE + index * DAY),
        })),
      );
    });
  } finally {
    db.close();
  }

  return path;
};

const sleep = (ms) =>
  new Promise((done) => {
    setTimeout(done, ms);
  });

/* Makes the PNG at `path` smaller with the tools there are */
const compress = (path) => {
  if (compressors.pngquant) {
    spawnSync(
      'pngquant',
      ['--quality=80-95', '--speed', '1', '--strip', '--force', '--output', path, path],
      { stdio: 'inherit' },
    );
  }

  if (compressors.oxipng) {
    spawnSync('oxipng', ['-q', '-o', '4', '--strip', 'all', path], { stdio: 'inherit' });
  }
};

rmSync(demoDir, { recursive: true, force: true });
mkdirSync(join(demoDir, '.studio'), { recursive: true });
mkdirSync(outputDir, { recursive: true });

const app = await electron.launch({
  executablePath: electronPath,
  args: [join(projectRoot, 'dist/main/index.js'), '--lang=en-US'],
  cwd: projectRoot,
  locale: 'en-US',
  colorScheme: 'light',
  env: {
    ...process.env,
    NODE_ENV: 'production',
    DARUDB_STUDIO_HIDDEN: '1',
    DARUDB_STUDIO_USER_DATA: join(demoDir, '.studio'),
  },
});

try {
  const page = await app.firstWindow();

  await page.waitForLoadState('load');
  page.on('pageerror', (error) => console.error(error));

  const invoke = (channel, ...args) =>
    page.evaluate(
      ({ evaluatedChannel, evaluatedArgs }) =>
        window.mainApi.invoke(evaluatedChannel, ...evaluatedArgs),
      { evaluatedChannel: channel, evaluatedArgs: args },
    );
  const send = (channel, ...args) =>
    page.evaluate(
      ({ evaluatedChannel, evaluatedArgs }) => {
        window.mainApi.send(evaluatedChannel, ...evaluatedArgs);
      },
      { evaluatedChannel: channel, evaluatedArgs: args },
    );

  // No room for the system's buttons, which a screenshot does not hold; see `.app-header`
  const dropTitleBarRoom = () =>
    page.addStyleTag({
      content: '.app-header { padding-inline: 0 !important; }',
    });

  const resize = () =>
    app.evaluate(
      ({ BrowserWindow }, size) => {
        for (const window of BrowserWindow.getAllWindows()) {
          const { x, y } = window.getBounds();

          window.setBounds({ x, y, ...size });
        }
      },
      { width: WIDTH, height: HEIGHT },
    );

  const shot = async (name) => {
    if (!wanted.includes(name)) {
      return;
    }

    // Away from anything that answers to a hover, and past the transitions
    await page.mouse.move(WIDTH - 4, HEIGHT / 2);
    await sleep(600);

    const path = join(outputDir, `${name}.png`);

    await page.screenshot({ path, scale: 'css', animations: 'disabled' });
    compress(path);
    console.log(`Captured ${name}.png`);
  };

  const tree = (name) => page.getByTestId('tree-collection').filter({ hasText: name });
  const treeItem = (name) => page.getByRole('treeitem').filter({ has: tree(name) }).first();
  const tab = (name) => page.getByTestId('tab').filter({ hasText: name });
  const cell = (row, column) =>
    page
      .locator(`[role="row"][data-row="${row}"]`)
      .filter({ visible: true })
      .locator(`[data-col="${column}"]`);
  const blur = () => page.evaluate(() => document.activeElement?.blur());

  const drag = async (handle, by) => {
    const box = await handle.boundingBox();
    const y = box.y + box.height / 2;

    await page.mouse.move(box.x + box.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + by, y, { steps: 8 });
    await page.mouse.up();
  };

  const widen = (name, by) =>
    drag(
      page
        .getByRole('columnheader', { name: new RegExp(`^${name}`) })
        .filter({ visible: true })
        .first()
        .locator('.grid__resize'),
      by,
    );

  // A click on a collection opens its tab and expands it, and a second one folds it again
  const collapse = async (name) => {
    if ((await treeItem(name).getAttribute('aria-expanded')) === 'true') {
      await tree(name).click();
    }
  };

  // English, the light theme and the projects as cards, whatever the system has
  await invoke(mainChannels.updateSettings, {
    language: 'en',
    darkTheme: false,
    projectView: 'grid',
  });
  await invoke(mainChannels.saveProject, { name: 'Tasks', filePath: makeTasks() });
  await invoke(mainChannels.saveProject, { name: 'Bookshelf', filePath: makeBookshelf() });
  await resize();
  await page.reload();
  await page.waitForLoadState('load');
  await dropTitleBarRoom();

  // The sample, opened once and closed, so the list holds it with the others
  await page.getByTestId('btn-open-sample').click();
  await page.getByTestId('project-screen').waitFor();
  await send(mainChannels.invokeMenuEntry, 'file.close-project');
  await page.getByTestId('project-list').waitFor();
  await shot('project-list');

  await page
    .getByTestId('project-item')
    .filter({ hasText: 'Sample' })
    .getByTestId('btn-open-project')
    .click();
  await page.getByTestId('project-screen').waitFor();
  await resize();

  // The products, with their fields in a wider sidebar and three rows selected
  await drag(page.locator('.project-panes').getByRole('separator').first(), 60);

  for (const name of ['customers', 'orders', 'products']) {
    await tree(name).click();
  }

  for (const name of ['customers', 'orders']) {
    await collapse(name);
  }

  await tab('products').click();
  await sleep(300);
  await widen('sku', -40);
  await widen('name', 70);
  await widen('category', 40);
  await cell(3, 2).click();
  await cell(5, 2).click({ modifiers: ['Shift'] });
  await blur();
  await shot('collection-grid');

  // A product in the object dialog, at its list and embedded object
  await cell(7, 2).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Edit Object…' }).click();
  await page.getByTestId('object-dialog').waitFor();
  await page
    .getByTestId('object-field-tags')
    .first()
    .evaluate((element) => element.scrollIntoView({ block: 'start' }));
  await shot('object-dialog');
  await page.keyboard.press('Escape');
  await page.getByTestId('object-dialog').waitFor({ state: 'hidden' });

  // The schema, as TypeScript
  await page.getByTestId('btn-view-schema').click();
  await page.getByTestId('schema-dialog').waitFor();
  await shot('schema-dialog');
  await page.keyboard.press('Escape');
  await page.getByTestId('schema-dialog').waitFor({ state: 'hidden' });

  // A query on the orders, with their fields and index in the tree
  await collapse('products');
  await tree('orders').click();
  await tab('orders').click();
  await page.getByTestId('btn-new-query').click();

  const query = page.getByTestId('query-tab').filter({ visible: true });

  await query
    .getByTestId('query-text')
    .fill('status == "delivered" AND total >= 500 SORT BY total DESC LIMIT 50');
  await query.getByTestId('btn-run-query').click();
  await query.getByTestId('query-summary').filter({ hasText: 'objects' }).waitFor();
  await blur();
  await shot('query-tab');

  // The tools, after a check and a compaction
  await page.getByTestId('btn-tools').click();
  await page.getByTestId('tool-check').getByRole('button', { name: 'Check' }).click();
  await page.getByTestId('check-report').waitFor();
  await page.getByTestId('tool-compact').getByRole('button', { name: 'Compact' }).click();
  await page.getByTestId('compact-report').waitFor();
  await blur();
  await shot('tools-tab');

  // The products and the shipped orders in two groups side by side
  for (const name of ['Query 1', 'Tools']) {
    await tab(name).getByRole('button').last().click();
  }

  await tab('products').click();
  await tab('orders').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Split to the Right' }).click();

  const filter = page
    .getByTestId('tab-group')
    .nth(1)
    .getByTestId('filter-input')
    .filter({ visible: true });

  await filter.fill('status == "shipped"');
  await filter.press('Enter');
  await sleep(500);
  await blur();
  await shot('split-groups');

  // The same in the dark theme, picked in the settings as a user picks it
  await page.getByTestId('btn-settings').click();
  await page
    .getByTestId('settings-dialog')
    .getByTestId('settings-theme')
    .getByRole('radio')
    .nth(2)
    .click();
  await page.keyboard.press('Escape');
  await page.getByTestId('settings-dialog').waitFor({ state: 'hidden' });
  await blur();
  await shot('dark-theme');
} finally {
  await app.close();
  rmSync(demoDir, { recursive: true, force: true });
}

if (!compressors.pngquant || !compressors.oxipng) {
  console.log(
    'pngquant or oxipng is not on the PATH, so the screenshots were not made as small as they could be.',
  );
}
