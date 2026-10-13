import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { mainChannels } from '../../src/common/ipc';
import type { FileCheck, Project } from '../../src/common/projects';
import type { AppSettings } from '../../src/common/settings';
import { makeNotADatabase, makeSampleDatabase } from '../databases';
import { invokeMain } from '../ipc';
import { test, expect, beforeAll, afterAll, relaunchApp } from '../fixtures';

test.beforeAll(beforeAll);
test.afterAll(afterAll);

// A folder for the database files these tests point projects at
const files = mkdtempSync(join(tmpdir(), 'darudb-studio-files-'));

test.afterAll(() => rmSync(files, { recursive: true, force: true }));

test('A database file is checked without being changed', async ({ page, util }) => {
  try {
    const plain = makeSampleDatabase(files, 'plain.darudb');
    const secret = makeSampleDatabase(files, 'secret.anything', { password: 'correct horse' });
    const other = makeNotADatabase(files);
    const check = (path: string, password?: string) =>
      invokeMain<FileCheck>(page, mainChannels.checkDatabaseFile, path, password);

    expect(await check(plain)).toEqual({
      status: 'ok',
      encrypted: false,
      formatVersion: 6,
      needsUpgrade: false,
    });
    // Any extension: the check, not the name, says what a file is
    expect(await check(secret)).toEqual({ status: 'needs-password' });
    expect(await check(secret, 'wrong')).toEqual({ status: 'wrong-password' });
    expect(await check(secret, 'correct horse')).toMatchObject({ status: 'ok', encrypted: true });
    expect(await check(other)).toEqual({ status: 'not-database' });
    expect(await check(join(files, 'nowhere.darudb'))).toEqual({ status: 'missing' });
    expect(await check('relative/path.darudb')).toMatchObject({ status: 'error' });
  } catch (error) {
    throw await util.onTestError(error);
  }
});

test('Projects are kept, and their passwords stay in the main process', async ({ page, util }) => {
  try {
    const plain = makeSampleDatabase(files, 'kept.darudb');
    const list = () => invokeMain<Project[]>(page, mainChannels.listProjects);
    const created = await invokeMain<Project>(page, mainChannels.saveProject, {
      name: '  Sales  ',
      filePath: plain,
      password: 'correct horse',
    });

    expect(created).toMatchObject({
      name: 'Sales',
      filePath: plain,
      sourcePath: null,
      hasPassword: true,
      missing: false,
    });
    expect(JSON.stringify(await list())).not.toContain('correct horse');

    // Keeping the password unless told otherwise, then forgetting it
    const renamed = await invokeMain<Project>(page, mainChannels.saveProject, {
      id: created.id,
      name: 'Sales 2026',
      filePath: plain,
    });

    expect(renamed).toMatchObject({ id: created.id, name: 'Sales 2026', hasPassword: true });
    expect(
      await invokeMain<Project>(page, mainChannels.saveProject, {
        id: created.id,
        name: 'Sales 2026',
        filePath: plain,
        password: null,
      }),
    ).toMatchObject({ hasPassword: false });

    // A project whose file is gone says so
    const gone = await invokeMain<Project>(page, mainChannels.saveProject, {
      name: 'Gone',
      filePath: join(files, 'gone.darudb'),
    });

    expect(gone.missing).toBe(true);
    await expect(
      invokeMain(page, mainChannels.saveProject, { name: '', filePath: plain }),
    ).rejects.toThrow(/name/);
    await expect(
      invokeMain(page, mainChannels.saveProject, { name: 'Relative', filePath: 'a.darudb' }),
    ).rejects.toThrow(/absolute/);

    await invokeMain(page, mainChannels.deleteProject, gone.id);

    const relaunched = await relaunchApp();
    const kept = await invokeMain<Project[]>(relaunched, mainChannels.listProjects);

    expect(kept.map((project) => project.name)).toEqual(['Sales 2026']);
  } catch (error) {
    throw await util.onTestError(error);
  }
});

test('The new settings are checked and kept', async ({ page, util }) => {
  try {
    const updated = await invokeMain<AppSettings>(page, mainChannels.updateSettings, {
      menuBarStyle: 'collapsed',
      editMode: 'submit',
      // Not settings, or not valid ones: dropped
      menuBar: 'inline',
      language: 'xx',
    });

    expect(updated).toMatchObject({ menuBarStyle: 'collapsed', editMode: 'submit' });
    expect(updated).not.toHaveProperty('menuBar');

    const relaunched = await relaunchApp();

    expect(await invokeMain<AppSettings>(relaunched, mainChannels.requestSettings)).toMatchObject({
      menuBarStyle: 'collapsed',
      editMode: 'submit',
    });
  } catch (error) {
    throw await util.onTestError(error);
  }
});
