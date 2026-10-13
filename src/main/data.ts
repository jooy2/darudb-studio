import { rename, rm } from 'fs/promises';
import { basename, dirname, extname, join } from 'path';
import { BrowserWindow, dialog } from 'electron';
import type { Database } from 'darudb';
import {
  QUERY_RESULT_LIMIT,
  quoteField,
  type BackupReport,
  type Change,
  type CheckReport,
  type CompactReport,
  type CountsResult,
  type DatabaseSchema,
  type FieldType,
  type Key,
  type PageRequest,
  type PageResult,
  type QueryRequest,
  type QueryResult,
  type Row,
  type SchemaCollection,
  type SchemaField,
  type ToolResult,
  type Value,
  type WriteResult,
} from '@/common/data';
import { errorOf } from './files';

/*
 * What a window does with the objects of the project it has open: read a page
 * of a collection, run a query, write a batch of changes, and the tools that
 * check, compact and back up the file.
 *
 * Everything here runs on the database handle `sessions.ts` keeps, through
 * the asynchronous API, so a long read never holds up the main process. What
 * a window sends is checked first: the collection has to be in the file's
 * schema, a field the grid sorts by has to be one it can sort by, and a page
 * stays within `MAX_PAGE_SIZE`.
 * */

// The most objects one page of the grid reads
const MAX_PAGE_SIZE = 1000;

/* A request that cannot be run as it is, which a window gets back as an `INVALID_ARGUMENT` */
class InvalidRequest extends Error {
  code = 'INVALID_ARGUMENT';
}

const failed = (error: unknown) => ({ status: 'error' as const, ...errorOf(error) });

/* The schema's types as plain data, which crosses to a window by structured clone */
const typeOf = (type: unknown): FieldType => {
  const stored = type as {
    kind: string;
    collection?: string;
    element?: unknown;
    fields?: unknown[];
  };

  switch (stored.kind) {
    case 'link':
      return { kind: 'link', collection: String(stored.collection) };
    case 'list':
      return { kind: 'list', element: typeOf(stored.element) };
    case 'object':
      return { kind: 'object', fields: (stored.fields ?? []).map(fieldOf) };
    default:
      return { kind: stored.kind as 'bool' | 'int' | 'float' | 'string' | 'bytes' };
  }
};

const fieldOf = (field: unknown): SchemaField => {
  const stored = field as { name: string; type: unknown; optional: boolean; default?: unknown };

  return {
    name: stored.name,
    type: typeOf(stored.type),
    optional: stored.optional,
    ...('default' in stored ? { default: stored.default as Value } : {}),
  };
};

/* The schema the file holds, or `null` for a file that holds none */
export const schemaOf = (database: Database): DatabaseSchema | null => {
  const stored = database.storedSchema;

  if (!stored) {
    return null;
  }

  return {
    version: stored.version,
    collections: stored.collections.map((collection) => ({
      name: collection.name,
      key: collection.key,
      autoIncrement: collection.autoIncrement,
      fields: collection.fields.map(fieldOf),
      indexes: collection.indexes.map(({ field, unique }) => ({ field, unique })),
    })),
  };
};

const collectionOf = (database: Database, name: unknown): SchemaCollection => {
  const collection = schemaOf(database)?.collections.find((each) => each.name === name);

  if (!collection) {
    throw new InvalidRequest(`the file has no collection called ${String(name)}`);
  }

  return collection;
};

/* Whether the grid can sort `collection` by `field`: the key, or a field of one value */
const isSortable = (collection: SchemaCollection, field: string): boolean => {
  if (collection.autoIncrement && field === collection.key) {
    return true;
  }

  const kind = collection.fields.find((each) => each.name === field)?.type.kind;

  return kind !== undefined && kind !== 'list' && kind !== 'object';
};

const isCount = (value: unknown, max = Number.MAX_SAFE_INTEGER): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= max;

/* The text of the query a page of the grid runs: its filter, its sort and its window */
const pageQuery = (collection: SchemaCollection, request: PageRequest): string => {
  const { filter, sort, offset, limit } = request;

  if (typeof filter !== 'string' || !Array.isArray(sort)) {
    throw new InvalidRequest('a page has a filter and a sort');
  }

  if (!isCount(offset) || !isCount(limit, MAX_PAGE_SIZE)) {
    throw new InvalidRequest(
      `a page starts at 0 or later and holds up to ${MAX_PAGE_SIZE} objects`,
    );
  }

  const order = sort.map(({ field, descending }) => {
    const quoted = typeof field === 'string' ? quoteField(field) : null;

    if (!quoted || !isSortable(collection, field)) {
      throw new InvalidRequest(`the objects cannot be sorted by ${String(field)}`);
    }

    return descending ? `${quoted} DESC` : quoted;
  });

  return [
    filter.trim(),
    order.length > 0 ? `SORT BY ${order.join(', ')}` : '',
    `LIMIT ${limit}`,
    `OFFSET ${offset}`,
  ]
    .filter(Boolean)
    .join(' ');
};

/* How many objects each collection of the file holds */
export const countObjects = async (database: Database): Promise<CountsResult> => {
  try {
    const schema = schemaOf(database);
    const counts = await database.readAsync(async (txn) => {
      const entries = await Promise.all(
        (schema?.collections ?? []).map(
          async ({ name }) => [name, Number(await txn.collection(name).count(''))] as const,
        ),
      );

      return Object.fromEntries(entries);
    });

    return { status: 'ok', counts };
  } catch (error) {
    return failed(error);
  }
};

/*
 * A page of a collection's objects, and how many objects its filter finds in
 * all, both read in one transaction, so the two agree.
 * */
export const readPage = async (database: Database, request: PageRequest): Promise<PageResult> => {
  try {
    const collection = collectionOf(database, request?.collection);
    const text = pageQuery(collection, request);

    return await database.readAsync(async (txn) => {
      const objects = txn.collection(collection.name);
      const rows = (await objects.find(text)) as Row[];
      const total = Number(await objects.count(request.filter.trim()));

      return { status: 'ok' as const, rows, total };
    });
  } catch (error) {
    return failed(error);
  }
};

/*
 * Runs a query of the query tab, its text whole. It counts first, and a query
 * that would find more than `QUERY_RESULT_LIMIT` objects is not run.
 * */
export const runQuery = async (database: Database, request: QueryRequest): Promise<QueryResult> => {
  try {
    const collection = collectionOf(database, request?.collection);

    if (typeof request.text !== 'string') {
      throw new InvalidRequest('a query is text');
    }

    const started = performance.now();

    return await database.readAsync(async (txn) => {
      const objects = txn.collection(collection.name);
      const count = Number(await objects.count(request.text));

      if (count > QUERY_RESULT_LIMIT) {
        return { status: 'too-many' as const, count, limit: QUERY_RESULT_LIMIT };
      }

      const rows = (await objects.find(request.text)) as Row[];

      return { status: 'ok' as const, rows, elapsedMs: performance.now() - started };
    });
  } catch (error) {
    return failed(error);
  }
};

const isKey = (value: unknown): value is Key =>
  typeof value === 'string' ||
  typeof value === 'bigint' ||
  value instanceof Uint8Array ||
  Number.isSafeInteger(value);

const isRow = (value: unknown): value is Row =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  !(value instanceof Uint8Array);

/* `change`, checked against what a change may be, before any of the batch is written */
const checkChange = (database: Database, change: Change): Change => {
  const collection = collectionOf(database, change?.collection);

  switch (change.kind) {
    case 'update':
      if (!isKey(change.key) || !isRow(change.values)) {
        throw new InvalidRequest('an update names an object by its key, and gives fields');
      }

      // A key is what names the object, so changing it is a delete and an insert
      if (collection.key in change.values) {
        throw new InvalidRequest('the primary key of an object does not change');
      }

      return change;
    case 'insert':
      if (!isRow(change.object)) {
        throw new InvalidRequest('an insert gives an object');
      }

      return change;
    case 'delete':
      if (!isKey(change.key)) {
        throw new InvalidRequest('a delete names an object by its key');
      }

      return change;
    default:
      throw new InvalidRequest('a change is an update, an insert or a delete');
  }
};

/* The error of the change at `index`, which stops the batch */
class ChangeFailed extends Error {
  constructor(
    readonly index: number,
    readonly cause: unknown,
  ) {
    super(errorOf(cause).message);
  }
}

/*
 * Writes `changes` in one transaction, in order, and resolves with the key of
 * each one's object. The first change the engine refuses aborts the batch, and
 * so does an update of an object that is no longer there.
 * */
export const writeChanges = async (database: Database, changes: Change[]): Promise<WriteResult> => {
  if (!Array.isArray(changes) || changes.length === 0) {
    return { status: 'error', code: 'INVALID_ARGUMENT', message: 'nothing to write', index: null };
  }

  let checked: Change[];

  try {
    checked = changes.map((change) => checkChange(database, change));
  } catch (error) {
    return { status: 'error', ...errorOf(error), index: null };
  }

  try {
    const keys = await database.writeAsync(async (txn) => {
      const written: Key[] = [];

      for (const [index, change] of checked.entries()) {
        const objects = txn.collection(change.collection);

        try {
          if (change.kind === 'insert') {
            written.push((await objects.insert(change.object)) as Key);
          } else if (change.kind === 'update') {
            if (!(await objects.update(change.key, change.values))) {
              throw Object.assign(new Error('the object is no longer in the file'), {
                code: 'NOT_FOUND',
              });
            }

            written.push(change.key);
          } else {
            await objects.delete(change.key);
            written.push(change.key);
          }
        } catch (error) {
          throw new ChangeFailed(index, error);
        }
      }

      return written;
    });

    return { status: 'ok', keys };
  } catch (error) {
    if (error instanceof ChangeFailed) {
      return { status: 'error', ...errorOf(error.cause), index: error.index };
    }

    return { status: 'error', ...errorOf(error), index: null };
  }
};

/* Reads every page of the file, as the integrity check of the tools tab */
export const checkDatabase = async (database: Database): Promise<ToolResult<CheckReport>> => {
  try {
    const report = await database.checkAsync();

    return {
      status: 'ok',
      report: {
        ok: report.ok,
        pageCount: report.pageCount,
        pagesChecked: report.pagesChecked,
        objectsChecked: report.objectsChecked,
        problems: report.problems.map(({ page, tree, message }) => ({ page, tree, message })),
      },
    };
  } catch (error) {
    return failed(error);
  }
};

export const compactDatabase = async (database: Database): Promise<ToolResult<CompactReport>> => {
  try {
    const { bytesBefore, bytesAfter } = await database.compactAsync();

    return { status: 'ok', report: { bytesBefore, bytesAfter } };
  } catch (error) {
    return failed(error);
  }
};

/*
 * Writes a copy of the file where the user picks in the save dialog, under the
 * same password, or under `password` when one is given. A backup never replaces a file, so it is written beside the
 * one the user chose to replace, and moved over it once it is whole.
 * */
export const backupDatabase = async (
  database: Database,
  window: BrowserWindow | null,
  title: string,
  password?: unknown,
): Promise<ToolResult<BackupReport>> => {
  const extension = extname(database.path) || '.darudb';
  const options = {
    title,
    defaultPath: join(
      dirname(database.path),
      `${basename(database.path, extname(database.path))}-backup${extension}`,
    ),
  };
  const chosen = window
    ? await dialog.showSaveDialog(window, options)
    : await dialog.showSaveDialog(options);

  if (chosen.canceled || !chosen.filePath) {
    return { status: 'cancelled' };
  }

  const target = chosen.filePath;
  const partial = join(dirname(target), `.${basename(target)}.${Date.now()}.partial`);

  try {
    // A password of its own encrypts the copy under a new key, a plain file's included
    const { bytes } = await database.backupAsync(
      partial,
      typeof password === 'string' && password !== '' ? { password } : undefined,
    );

    await rename(partial, target);

    return { status: 'ok', report: { path: target, bytes } };
  } catch (error) {
    await rm(partial, { force: true });

    return failed(error);
  }
};
