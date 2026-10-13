import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { collection, Database, engineVersion, FORMAT_VERSION, schema, t } from 'darudb';

/*
 * `--self-check`: whether this build of the app can load the engine, found out
 * without a window. A packaged app no longer runs as plain Node.js (see the
 * fuses in `buildAssets/builder/config.ts`), so this is how a build is checked
 * once it is packed, the release workflow included: a binary for the wrong
 * platform fails only as it loads.
 *
 * It creates a database in a folder of its own under the system's temporary
 * folder, writes an object, reads it back and deletes the folder. Nothing of
 * the user's is read or written.
 * */

export const selfCheckRequested = process.argv.includes('--self-check');

const checkSchema = schema(1, {
  checks: collection({ name: t.string().primaryKey(), value: t.int() }),
});

/* Runs the check, prints what it found, and resolves with the exit code: 0 when it passed */
export const runSelfCheck = async (): Promise<number> => {
  const folder = await mkdtemp(join(tmpdir(), 'darudb-studio-check-'));

  try {
    const database = await Database.openAsync(join(folder, 'check.darudb'), {
      schema: checkSchema,
    });

    try {
      await database.writeAsync(async (txn) => {
        await txn.collection('checks').insert({ name: 'engine', value: FORMAT_VERSION });
      });

      const read = await database.readAsync((txn) => txn.collection('checks').get('engine'));

      if (read?.value !== FORMAT_VERSION) {
        throw new Error('the object read back is not the one written');
      }
    } finally {
      await database.closeAsync();
    }

    console.log(
      `Self-check passed: DaruDB ${engineVersion()}, format version ${FORMAT_VERSION}, ${process.platform}-${process.arch}`,
    );

    return 0;
  } catch (error) {
    console.error('Self-check failed:', error);

    return 1;
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
};
