/*
 * The objects of an open project, as the main process reads them from the file
 * and a window shows and edits them. Shared by the three processes.
 *
 * Values cross the IPC boundary by structured clone, which keeps what a
 * DaruDB value can be: a `bigint` for an int too large for a number, a
 * `Uint8Array` for bytes, and nested lists and objects.
 *
 * See `src/common/ipc.ts` for what may live in this folder.
 * */

/* A field's type, as the file's schema records it */
export type FieldType =
  | { kind: 'bool' | 'int' | 'float' | 'string' | 'bytes' }
  | { kind: 'link'; collection: string }
  | { kind: 'list'; element: FieldType }
  | { kind: 'object'; fields: SchemaField[] };

export type FieldKind = FieldType['kind'];

export interface SchemaField {
  name: string;
  type: FieldType;
  /* Whether the field may be null */
  optional: boolean;
  /* The value a required field takes when an object leaves it out, if it has one */
  default?: Value;
}

export interface SchemaIndex {
  field: string;
  unique: boolean;
}

export interface SchemaCollection {
  name: string;
  /* The name of the primary key's field: `id` for the auto-increment */
  key: string;
  /* Whether the key is an int the engine assigns, which no field declares */
  autoIncrement: boolean;
  fields: SchemaField[];
  indexes: SchemaIndex[];
}

/* The schema the file holds, which the app reads instead of declaring one */
export interface DatabaseSchema {
  version: number;
  collections: SchemaCollection[];
}

/* A value of a field */
export type Value =
  null | boolean | number | bigint | string | Uint8Array | Value[] | { [field: string]: Value };

/* An object of a collection, by field name, its key included */
export type Row = Record<string, Value>;

/* A primary key: an int, a string or bytes */
export type Key = number | bigint | string | Uint8Array;

export interface SortKey {
  field: string;
  descending: boolean;
}

/* A page of a collection's objects, as the grid asks for it */
export interface PageRequest {
  collection: string;
  /* A filter in the query language, or `''` for every object */
  filter: string;
  sort: SortKey[];
  offset: number;
  limit: number;
}

/*
 * What a request to the file ended in: its result, or the engine's error with
 * its code. A window shows the message rather than catching a rejection,
 * whose text Electron wraps in its own.
 * */
export type Outcome<Result> =
  ({ status: 'ok' } & Result) | { status: 'error'; code: string; message: string };

/* `total` counts every object the filter finds, not only this page */
export type PageResult = Outcome<{ rows: Row[]; total: number }>;

/* How many objects each collection holds */
export type CountsResult = Outcome<{ counts: Record<string, number> }>;

/*
 * A change to one object. The window's edits become these, written at once or
 * when the user submits them, and a batch of them commits in one transaction.
 * */
export type Change =
  | { kind: 'update'; collection: string; key: Key; values: Row }
  | { kind: 'insert'; collection: string; object: Row }
  | { kind: 'delete'; collection: string; key: Key };

/*
 * What writing a batch did: the key of each change's object, the one an
 * insert was given included. On an error nothing of the batch is written, and
 * `index` says which change the engine refused.
 * */
export type WriteResult =
  | { status: 'ok'; keys: Key[] }
  | { status: 'error'; code: string; message: string; index: number | null };

/* A query of the query tab: the whole text, sort and limit included */
export interface QueryRequest {
  collection: string;
  text: string;
}

/*
 * The objects a query found. A query that finds more than the tab can hold is
 * not run: `too-many` says how many it would find, so a `LIMIT` can be added.
 * */
export type QueryResult =
  | Outcome<{ rows: Row[]; elapsedMs: number }>
  | { status: 'too-many'; count: number; limit: number };

/* The most objects the query tab shows at once */
export const QUERY_RESULT_LIMIT = 10000;

/* What the integrity check found */
export interface CheckReport {
  ok: boolean;
  pageCount: number;
  pagesChecked: number;
  objectsChecked: number;
  problems: { page: number | null; tree: string | null; message: string }[];
}

export interface CompactReport {
  bytesBefore: number;
  bytesAfter: number;
}

export interface BackupReport {
  path: string;
  bytes: number;
}

export type ToolResult<Report> = Outcome<{ report: Report }> | { status: 'cancelled' };

/* The primary key of `row` in `collection` */
export const keyOf = (collection: SchemaCollection, row: Row): Key => row[collection.key] as Key;

/* Whether two keys are the same key, bytes compared by their contents */
export const sameKey = (a: Key, b: Key): boolean => {
  if (a instanceof Uint8Array && b instanceof Uint8Array) {
    return a.length === b.length && a.every((byte, index) => byte === b[index]);
  }

  return a === b;
};

/* A key as a string that names it uniquely, for maps and React keys */
export const keyText = (key: Key): string => {
  if (key instanceof Uint8Array) {
    return `b:${Array.from(key, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  }

  return `${typeof key === 'string' ? 's' : 'n'}:${String(key)}`;
};

/*
 * `name` as the query language writes a field: in backticks, which hold any
 * name without a backtick of its own. Returns `null` for one that has one.
 * */
export const quoteField = (name: string): string | null =>
  name.includes('`') ? null : `\`${name}\``;
