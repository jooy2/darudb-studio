import { BrowserWindow } from 'electron';
import { Database } from 'darudb';
import { planSchemaChange, SchemaChangeError, type SchemaChange } from '@/common/schema';
import type { SchemaChangeResult } from '@/common/data';
import { schemaOf } from './data';
import { declareSchema } from './declare';
import { errorOf } from './files';
import { openProjectOf, sessionOf, withFileAlone } from './sessions';

/*
 * Changing the schema of the file a window has open: a collection added,
 * renamed or deleted, or a field of one. See `planSchemaChange` in
 * `src/common/schema.ts` for what each change makes of the schema.
 *
 * The file is closed for the window, opened once with the new schema and its
 * migration, which the engine runs in one transaction, and opened again for
 * the window as it was, without a schema of its own. A change the engine
 * refuses leaves the file as it was.
 * */
export const changeSchema = async (
  window: BrowserWindow,
  change: SchemaChange,
): Promise<SchemaChangeResult> => {
  try {
    const session = openProjectOf(window);

    if (!session) {
      return { status: 'error', code: 'NO_PROJECT', message: 'the window has no project open' };
    }

    const current = schemaOf(session.database);

    if (!current) {
      throw new SchemaChangeError('the file holds no schema to change');
    }

    const planned = planSchemaChange(current, change);
    const declared = declareSchema(planned.schema);

    const { reopened } = await withFileAlone(window, async (path, password) => {
      const migrated = await Database.openAsync(path, {
        create: false,
        upgradeFormat: false,
        schema: declared,
        migrations: [planned.migration],
        ...(password ? { password } : {}),
      });

      await migrated.closeAsync();
    });

    const changed = reopened ? await sessionOf(window) : null;

    return changed
      ? { status: 'ok', session: changed }
      : {
          status: 'error',
          code: 'NOT_REOPENED',
          message: 'the schema changed, but the file did not open again',
        };
  } catch (error) {
    return { status: 'error', ...errorOf(error) };
  }
};
