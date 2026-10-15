import { createWriteStream, type WriteStream } from 'fs';
import { readFile, rename, rm, stat } from 'fs/promises';
import { once } from 'events';
import { basename, dirname, extname, join } from 'path';
import { app, BrowserWindow, dialog } from 'electron';
import type { Database } from 'darudb';
import {
  importModes,
  type Change,
  type ExportRequest,
  type ImportMode,
  type ImportResult,
  type Key,
  type Row,
  type ToolResult,
  type TransferReport,
} from '@/common/data';
import { CSV_START } from '@/common/csv';
import {
  csvHeader,
  csvRow,
  jsonRow,
  rowsFromCsv,
  rowsFromJson,
  transferColumns,
  transferFormats,
  type TransferColumn,
  type TransferFormat,
} from '@/common/transfer';
import { collectionOf, InvalidRequest, schemaOf, viewQuery, writeChanges } from './data';
import { errorOf } from './files';

/*
 * Exporting a collection's objects to a JSON or a CSV file, and importing
 * them from one, as `common/transfer.ts` writes and reads them.
 *
 * An export reads its objects in one read transaction, so they come from one
 * commit, and streams them to a file beside the one the user chose, which
 * takes its place once it is whole. An import reads the whole file, checks
 * every record against the schema, and writes them in one transaction, so a
 * file is written whole or not at all.
 * */

// The objects an export reads at a time. A sorted page skips the objects
// before it each time, so fewer, larger pages export a sorted view of 100,000
// objects about four times as fast, while one page still holds little.
const EXPORT_PAGE = 5000;

// The largest file an import reads, which it holds in memory whole
const MAX_IMPORT_BYTES = 256 * 1024 * 1024;

const failed = (error: unknown) => ({ status: 'error' as const, ...errorOf(error) });

/* Writes `text` to `stream`, waiting while the stream's buffer is full */
const write = async (stream: WriteStream, text: string): Promise<void> => {
  if (!stream.write(text)) {
    await once(stream, 'drain');
  }
};

/* Reads every object `request` names, a page at a time, and hands each page on */
const readObjects = async (
  database: Database,
  request: ExportRequest,
  each: (rows: Row[]) => Promise<void>,
): Promise<number> => {
  const collection = collectionOf(database, request.collection);
  const { source } = request;

  return database.readAsync(async (txn) => {
    const objects = txn.collection(collection.name);

    if (source?.kind === 'keys') {
      if (!Array.isArray(source.keys)) {
        throw new InvalidRequest('an export names its objects by their keys');
      }

      // Asked for together, which the engine answers in one trip to the thread pool
      const found = (await Promise.all(
        (source.keys as Key[]).map((key) => objects.get(key)),
      )) as (Row | null)[];
      const rows = found.filter((row): row is Row => row !== null);

      await each(rows);

      return rows.length;
    }

    if (source?.kind === 'query') {
      if (typeof source.text !== 'string') {
        throw new InvalidRequest('a query is text');
      }

      // A query may hold a limit of its own, so it is read whole
      const rows = (await objects.find(source.text)) as Row[];

      await each(rows);

      return rows.length;
    }

    const text = viewQuery(collection, source?.filter, source?.sort);
    let count = 0;

    for (let offset = 0; ; offset += EXPORT_PAGE) {
      const rows = (await objects.find(
        `${text} LIMIT ${EXPORT_PAGE} OFFSET ${offset}`.trim(),
      )) as Row[];

      await each(rows);
      count += rows.length;

      if (rows.length < EXPORT_PAGE) {
        return count;
      }
    }
  });
};

/* Writes the objects `request` names to `path` in `format` */
const writeExport = async (
  database: Database,
  request: ExportRequest,
  columns: TransferColumn[],
  format: TransferFormat,
  path: string,
): Promise<number> => {
  const stream = createWriteStream(path, { encoding: 'utf8' });
  let first = true;

  try {
    await write(stream, format === 'json' ? '[' : `${CSV_START}${csvHeader(columns)}\r\n`);

    const count = await readObjects(database, request, async (rows) => {
      for (const row of rows) {
        if (format === 'json') {
          await write(stream, `${first ? '\n  ' : ',\n  '}${jsonRow(row, columns)}`);
        } else {
          await write(stream, `${csvRow(row, columns)}\r\n`);
        }

        first = false;
      }
    });

    if (format === 'json') {
      await write(stream, first ? ']\n' : '\n]\n');
    }

    stream.end();
    await once(stream, 'finish');

    return count;
  } catch (error) {
    stream.destroy();
    throw error;
  }
};

/*
 * Writes the objects `request` names to a file the user picks in the save
 * dialog, titled `title`, and resolves with how many it wrote.
 * */
export const exportObjects = async (
  database: Database,
  window: BrowserWindow | null,
  request: ExportRequest,
  title: string,
): Promise<ToolResult<TransferReport>> => {
  try {
    const collection = collectionOf(database, request?.collection);
    const format = request.format;

    if (!transferFormats.includes(format)) {
      throw new InvalidRequest(`an export is one of ${transferFormats.join(', ')}`);
    }

    const options = {
      title,
      defaultPath: join(app.getPath('documents'), `${collection.name}.${format}`),
      filters: [{ name: format.toUpperCase(), extensions: [format] }],
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
      const count = await writeExport(
        database,
        request,
        transferColumns(collection),
        format,
        partial,
      );

      await rename(partial, target);

      return { status: 'ok', report: { path: target, count } };
    } catch (error) {
      await rm(partial, { force: true });
      throw error;
    }
  } catch (error) {
    return failed(error);
  }
};

/*
 * Reads the objects of a file the user picks in the open dialog, titled
 * `title`, into a collection, as `mode` says, in one transaction. A file with
 * a record that does not fit the collection writes nothing.
 * */
export const importObjects = async (
  database: Database,
  window: BrowserWindow | null,
  collectionName: unknown,
  mode: unknown,
  title: string,
): Promise<ImportResult> => {
  try {
    const collection = collectionOf(database, collectionName);

    if (!importModes.includes(mode as ImportMode)) {
      throw new InvalidRequest(`an import is one of ${importModes.join(', ')}`);
    }

    const options = {
      title,
      properties: ['openFile' as const],
      filters: [
        { name: 'JSON, CSV', extensions: ['json', 'csv'] },
        { name: '*', extensions: ['*'] },
      ],
    };
    const chosen = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    const [path] = chosen.filePaths;

    if (chosen.canceled || path === undefined) {
      return { status: 'cancelled' };
    }

    if ((await stat(path)).size > MAX_IMPORT_BYTES) {
      throw new InvalidRequest(`a file to import holds at most ${MAX_IMPORT_BYTES} bytes`);
    }

    const text = await readFile(path, 'utf8');
    // The extension says which; without one, a JSON file starts with its array
    const csv =
      extname(path).toLowerCase() === '.csv' ||
      (extname(path).toLowerCase() !== '.json' && !text.trimStart().startsWith('['));
    const collections = schemaOf(database)?.collections ?? [];
    const { rows, problems } = csv
      ? rowsFromCsv(text, collection, collections)
      : rowsFromJson(text, collection, collections);

    if (problems.length > 0) {
      return { status: 'invalid', path, problems };
    }

    if (rows.length === 0) {
      throw new InvalidRequest('the file holds no objects');
    }

    const changes = rows.map((object): Change => ({
      kind: mode as ImportMode,
      collection: collection.name,
      object,
    }));
    const result = await writeChanges(database, changes);

    if (result.status === 'error') {
      return {
        status: 'error',
        code: result.code,
        // The record the engine refused, numbered as the problems are
        message: result.index === null ? result.message : `${result.index + 1}: ${result.message}`,
      };
    }

    return { status: 'ok', report: { path, count: rows.length } };
  } catch (error) {
    return failed(error);
  }
};
