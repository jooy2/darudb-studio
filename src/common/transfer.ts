import { csvLine, parseCsv } from './csv';
import type { FieldType, Row, SchemaCollection, Value } from './data';
import {
  bytesToHex,
  fromJsonable,
  isPlainObject,
  isScalarType,
  parseJson,
  parseScalar,
  toJson,
  ValueError,
} from './values';

/*
 * A collection's objects as the files an export writes and an import reads:
 * JSON, an array of objects with the conventions of `values.ts`, bytes as hex
 * and every digit of a large int kept; and CSV, a column for each field, with
 * a list or an embedded object as JSON in its cell.
 *
 * An import is checked whole, record by record, against the collection's
 * schema before anything is written, so a file with one bad record writes
 * nothing and says which records are wrong.
 *
 * See `src/common/ipc.ts` for what may live in this folder.
 * */

export const transferFormats = ['json', 'csv'] as const;

export type TransferFormat = (typeof transferFormats)[number];

/* A column of an export: the key first, then the fields in the file's order */
export interface TransferColumn {
  name: string;
  type: FieldType;
  optional: boolean;
  /* What the engine fills in when an import leaves the field out */
  filled: boolean;
}

export const transferColumns = (collection: SchemaCollection): TransferColumn[] => {
  const fields = collection.fields.map((field): TransferColumn => ({
    name: field.name,
    type: field.type,
    optional: field.optional,
    filled: field.default !== undefined,
  }));
  const key = fields.find((column) => column.name === collection.key) ?? {
    // The auto-increment key, which no field declares and the engine assigns
    name: collection.key,
    type: { kind: 'int' as const },
    optional: false,
    filled: true,
  };

  return [key, ...fields.filter((column) => column.name !== collection.key)];
};

/* A value as one CSV field: a scalar as it is typed, bytes as hex, a list or an object as JSON */
const csvValue = (value: Value, type: FieldType): string => {
  if (value === null) {
    return '';
  }

  if (value instanceof Uint8Array) {
    return bytesToHex(value);
  }

  return isScalarType(type) ? String(value) : toJson(value);
};

export const csvHeader = (columns: readonly TransferColumn[]): string =>
  csvLine(columns.map((column) => column.name));

export const csvRow = (row: Row, columns: readonly TransferColumn[]): string =>
  csvLine(columns.map((column) => csvValue(row[column.name] ?? null, column.type)));

/* A row as an element of a JSON export, its fields in the columns' order */
export const jsonRow = (row: Row, columns: readonly TransferColumn[]): string =>
  toJson(Object.fromEntries(columns.map((column) => [column.name, row[column.name] ?? null])));

/*
 * What is wrong with one record of an import, by its number from 1: the
 * element of a JSON array, or the line of a CSV file after its header that
 * holds something
 * */
export interface ImportProblem {
  record: number;
  message: string;
}

export interface ImportedRows {
  rows: Row[];
  problems: ImportProblem[];
}

// The most problems an import lists, so a file wrong throughout stays readable
const MAX_PROBLEMS = 50;

/*
 * Reads `given`, a record's fields by name, as a row: a field left out is
 * left to the engine when it has a default, is the auto-increment key, or may
 * be null, and is missing otherwise.
 * */
const rowOf = (given: Map<string, () => Value>, columns: readonly TransferColumn[]): Row => {
  const known = new Set(columns.map((column) => column.name));
  const unknown = [...given.keys()].find((name) => !known.has(name));

  if (unknown !== undefined) {
    throw new ValueError(unknown, 'the collection has no such field');
  }

  const row: Row = {};

  for (const column of columns) {
    const read = given.get(column.name);

    if (read) {
      row[column.name] = read();
    } else if (!column.filled && !column.optional) {
      throw new ValueError(column.name, 'a value is required');
    }
  }

  return row;
};

const collect = (records: readonly (() => Row)[], firstNumber: number): ImportedRows => {
  const rows: Row[] = [];
  const problems: ImportProblem[] = [];

  records.forEach((read, index) => {
    try {
      rows.push(read());
    } catch (error) {
      if (problems.length < MAX_PROBLEMS) {
        problems.push({
          record: index + firstNumber,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  });

  return { rows, problems };
};

/* A JSON text, an array of objects, as rows of `collection`, numbered from 1 */
export const rowsFromJson = (
  text: string,
  collection: SchemaCollection,
  collections: readonly SchemaCollection[],
): ImportedRows => {
  const data = parseJson(text);

  if (!Array.isArray(data)) {
    throw new Error('a JSON import is an array of objects');
  }

  const columns = transferColumns(collection);
  const byName = new Map(columns.map((column) => [column.name, column]));

  return collect(
    data.map((item) => () => {
      if (!isPlainObject(item)) {
        throw new ValueError('', 'an object is expected');
      }

      return rowOf(
        new Map(
          Object.entries(item).map(([name, value]) => {
            const column = byName.get(name);

            return [
              name,
              () =>
                column
                  ? fromJsonable(value, column.type, column.optional, collections, name)
                  : null,
            ];
          }),
        ),
        columns,
      );
    }),
    1,
  );
};

/*
 * A CSV text, with the field names in its first line, as rows of
 * `collection`. An empty cell leaves a field out, so
 * it takes its default or null; a list or an object is JSON in its cell.
 * */
export const rowsFromCsv = (
  text: string,
  collection: SchemaCollection,
  collections: readonly SchemaCollection[],
): ImportedRows => {
  const [header, ...lines] = parseCsv(text);

  if (!header) {
    throw new Error('a CSV import starts with a line of field names');
  }

  const columns = transferColumns(collection);
  const byName = new Map(columns.map((column) => [column.name, column]));
  const repeated = header.find((name, at) => header.indexOf(name) !== at);

  if (repeated !== undefined) {
    throw new Error(`the field ${repeated} has two columns`);
  }

  return collect(
    lines
      // A line with nothing in it is not a record
      .filter((cells) => cells.some((cell) => cell !== ''))
      .map((cells) => () => {
        if (cells.length !== header.length) {
          throw new ValueError('', `the line has ${cells.length} fields, not ${header.length}`);
        }

        return rowOf(
          new Map(
            header.flatMap((name, at) => {
              const column = byName.get(name);
              const cell = cells[at];

              if (column && cell === '' && (column.filled || column.optional)) {
                return [];
              }

              const read = (): Value => {
                if (!column) {
                  return null;
                }

                const parsed = isScalarType(column.type)
                  ? parseScalar(cell, column.type, column.optional, collections, name)
                  : {
                      ok: true as const,
                      value: fromJsonable(
                        parseJson(cell),
                        column.type,
                        column.optional,
                        collections,
                        name,
                      ),
                    };

                if (!parsed.ok) {
                  throw parsed.error;
                }

                return parsed.value;
              };

              return [[name, read] as const];
            }),
          ),
          columns,
        );
      }),
    1,
  );
};
