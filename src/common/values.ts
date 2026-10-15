import type { FieldType, Key, SchemaCollection, SchemaField, Value } from './data';

/*
 * Values as the project screen shows them and reads them back from what the
 * user types: in a cell, in the object dialog, and as JSON for lists and
 * embedded objects. The main process writes and reads the files of an export
 * and an import with the same functions, see `transfer.ts`.
 *
 * JSON alone cannot carry every DaruDB value, so the conversion is led by the
 * field's type: bytes are written as hex, an int too large for a number keeps
 * every digit, and a link is the linked object's key. Anything that does not
 * fit the type is refused with the path to the part that is wrong.
 * */

/* A value the user typed that does not fit its field, with where and why */
export class ValueError extends Error {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(path ? `${path}: ${message}` : message);
  }
}

/* What the user typed, read for `field`: the value, or a `ValueError` */
export type Parsed = { ok: true; value: Value } | { ok: false; error: ValueError };

export const isBytes = (value: unknown): value is Uint8Array => value instanceof Uint8Array;

export const isPlainObject = (value: unknown): value is { [field: string]: Value } =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && !isBytes(value);

/* Bytes as pairs of hex digits, separated by spaces when `spaced` */
export const bytesToHex = (bytes: Uint8Array, spaced = false): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(spaced ? ' ' : '');

/* Hex digits, with or without spaces between the pairs, as bytes; `null` for anything else */
export const hexToBytes = (text: string): Uint8Array | null => {
  const digits = text.replace(/\s+/g, '');

  if (digits.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(digits)) {
    return null;
  }

  return Uint8Array.from({ length: digits.length / 2 }, (_, index) =>
    parseInt(digits.slice(index * 2, index * 2 + 2), 16),
  );
};

/* The type a link's value has: the key of the collection it links to */
export const linkKeyType = (
  collections: readonly SchemaCollection[],
  target: string,
): FieldType => {
  const linked = collections.find((collection) => collection.name === target);

  if (!linked || linked.autoIncrement) {
    return { kind: 'int' };
  }

  return linked.fields.find((field) => field.name === linked.key)?.type ?? { kind: 'string' };
};

const parseInt64 = (text: string, path: string): Value => {
  if (!/^-?\d+$/.test(text)) {
    throw new ValueError(path, 'an int is a whole number');
  }

  const big = BigInt(text);

  if (big < -(2n ** 63n) || big >= 2n ** 63n) {
    throw new ValueError(path, 'an int fits in 64 bits');
  }

  // A number where it holds the value exactly, as the engine reads it back
  return Number.isSafeInteger(Number(big)) ? Number(big) : big;
};

/*
 * What the user typed in a cell or a field, as a value of `type`. Empty text
 * is null for an optional field; for a required string it is the empty string.
 * */
export const parseScalar = (
  text: string,
  type: FieldType,
  optional: boolean,
  collections: readonly SchemaCollection[],
  path = '',
): Parsed => {
  try {
    const trimmed = text.trim();

    if (trimmed === '' && (optional || type.kind !== 'string')) {
      if (!optional) {
        throw new ValueError(path, 'a value is required');
      }

      return { ok: true, value: null };
    }

    switch (type.kind) {
      case 'string':
        return { ok: true, value: text };
      case 'int':
        return { ok: true, value: parseInt64(trimmed, path) };
      case 'float': {
        const value = Number(trimmed);

        if (!Number.isFinite(value)) {
          throw new ValueError(path, 'a float is a finite number');
        }

        return { ok: true, value };
      }
      case 'bool':
        if (/^(true|1)$/i.test(trimmed)) {
          return { ok: true, value: true };
        }

        if (/^(false|0)$/i.test(trimmed)) {
          return { ok: true, value: false };
        }

        throw new ValueError(path, 'a bool is true or false');
      case 'bytes': {
        const bytes = hexToBytes(trimmed);

        if (!bytes) {
          throw new ValueError(path, 'bytes are written as pairs of hex digits');
        }

        return { ok: true, value: bytes };
      }
      case 'link':
        return parseScalar(
          text,
          linkKeyType(collections, type.collection),
          optional,
          collections,
          path,
        );
      default:
        throw new ValueError(path, 'a list or an object is edited as JSON');
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof ValueError ? error : new ValueError(path, String(error)),
    };
  }
};

/* A scalar as a cell's editor starts on: what typing it back gives the same value */
export const scalarText = (value: Value): string => {
  if (value === null) {
    return '';
  }

  if (isBytes(value)) {
    return bytesToHex(value, true);
  }

  return String(value);
};

/* Whether a field of `type` is edited in its cell, rather than as JSON */
export const isScalarType = (type: FieldType): boolean =>
  type.kind !== 'list' && type.kind !== 'object';

/*
 * `value` as JSON text can hold it, for `type`: bytes as hex, a link as its
 * key, and a `bigint` kept as a `bigint`, which `stringify` below writes with
 * every digit.
 * */
const jsonable = (value: Value): unknown => {
  if (isBytes(value)) {
    return bytesToHex(value);
  }

  if (Array.isArray(value)) {
    return value.map(jsonable);
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([field, each]) => [field, jsonable(each)]),
    );
  }

  return value;
};

/*
 * `value` as JSON, indented when `indent` is given. A `bigint` is written as a
 * number with every digit, which JSON allows and `parseJson` reads back exactly.
 * */
// A word no value holds, made as the module loads, which the digits of a `bigint` replace
// once the text is written, and the pattern that finds it, compiled once
const BIGINT_MARKER = `bigint-${Math.random().toString(36).slice(2)}:`;
const BIGINT_PATTERN = new RegExp(`"${BIGINT_MARKER}(-?\\d+)"`, 'g');

export const toJson = (value: Value, indent?: number): string => {
  let hasBigint = false;
  const text = JSON.stringify(
    jsonable(value),
    (_key, each: unknown) => {
      if (typeof each !== 'bigint') {
        return each;
      }

      hasBigint = true;

      return `${BIGINT_MARKER}${each}`;
    },
    indent,
  );

  // Most values hold no `bigint`, and their text is not searched
  return hasBigint ? text.replace(BIGINT_PATTERN, '$1') : text;
};

type JsonReviver = (key: string, value: unknown, context?: { source?: string }) => unknown;

/*
 * JSON text as plain data, with an integer too large for a number read as a
 * `bigint` from its digits, which the reviver's source text gives.
 * */
export const parseJson = (text: string): unknown =>
  JSON.parse(text, ((_key, value, context) =>
    typeof value === 'number' &&
    Number.isInteger(value) &&
    !Number.isSafeInteger(value) &&
    context?.source &&
    /^-?\d+$/.test(context.source)
      ? BigInt(context.source)
      : value) as JsonReviver as Parameters<typeof JSON.parse>[1]);

/*
 * `data`, parsed from JSON, as a value of `type`, checked part by part. `path`
 * names where in the value the check is, for the error it may throw.
 * */
export const fromJsonable = (
  data: unknown,
  type: FieldType,
  optional: boolean,
  collections: readonly SchemaCollection[],
  path = '',
): Value => {
  if (data === null || data === undefined) {
    if (!optional) {
      throw new ValueError(path, 'a value is required');
    }

    return null;
  }

  switch (type.kind) {
    case 'bool':
      if (typeof data !== 'boolean') {
        throw new ValueError(path, 'expected true or false');
      }

      return data;
    case 'int':
      if (typeof data === 'bigint') {
        return parseInt64(String(data), path);
      }

      if (typeof data !== 'number' || !Number.isInteger(data)) {
        throw new ValueError(path, 'expected a whole number');
      }

      return data;
    case 'float':
      if (typeof data !== 'number' && typeof data !== 'bigint') {
        throw new ValueError(path, 'expected a number');
      }

      return Number(data);
    case 'string':
      if (typeof data !== 'string') {
        throw new ValueError(path, 'expected a string');
      }

      return data;
    case 'bytes': {
      const bytes = typeof data === 'string' ? hexToBytes(data) : null;

      if (!bytes) {
        throw new ValueError(path, 'expected bytes as a string of hex digits');
      }

      return bytes;
    }
    case 'link':
      return fromJsonable(
        data,
        linkKeyType(collections, type.collection),
        optional,
        collections,
        path,
      );
    case 'list':
      if (!Array.isArray(data)) {
        throw new ValueError(path, 'expected a list');
      }

      return data.map((item, index) =>
        fromJsonable(item, type.element, false, collections, `${path}[${index}]`),
      );
    case 'object': {
      if (typeof data !== 'object' || Array.isArray(data)) {
        throw new ValueError(path, 'expected an object');
      }

      const given = data as Record<string, unknown>;
      const known = new Set(type.fields.map((field) => field.name));
      const unknown = Object.keys(given).find((name) => !known.has(name));

      if (unknown !== undefined) {
        throw new ValueError(path ? `${path}.${unknown}` : unknown, 'the object has no such field');
      }

      return Object.fromEntries(
        type.fields.map((field) => [
          field.name,
          fromJsonable(
            given[field.name] ?? (field.default === undefined ? null : field.default),
            field.type,
            field.optional,
            collections,
            path ? `${path}.${field.name}` : field.name,
          ),
        ]),
      );
    }
    default:
      throw new ValueError(path, 'unknown type');
  }
};

/* JSON the user typed for a list or an object field, read as its value */
export const parseJsonValue = (
  text: string,
  field: SchemaField,
  collections: readonly SchemaCollection[],
): Parsed => {
  try {
    if (text.trim() === '') {
      return {
        ok: true,
        value: fromJsonable(null, field.type, field.optional, collections, field.name),
      };
    }

    return {
      ok: true,
      value: fromJsonable(parseJson(text), field.type, field.optional, collections, field.name),
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof ValueError
          ? error
          : new ValueError(field.name, error instanceof Error ? error.message : String(error)),
    };
  }
};

/* Whether two values are the same, bytes and nested values compared by content */
export const sameValue = (a: Value, b: Value): boolean => {
  if (isBytes(a) && isBytes(b)) {
    return a.length === b.length && a.every((byte, index) => byte === b[index]);
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => sameValue(item, b[index]));
  }

  if (isPlainObject(a) && isPlainObject(b)) {
    const names = Object.keys(a);

    return (
      names.length === Object.keys(b).length &&
      names.every((name) => name in b && sameValue(a[name], b[name]))
    );
  }

  // A number and a bigint of the same integer are the same int
  if (typeof a === 'bigint' || typeof b === 'bigint') {
    const integral = (each: Value): each is number | bigint =>
      typeof each === 'bigint' || Number.isInteger(each);

    return integral(a) && integral(b) && BigInt(a) === BigInt(b);
  }

  return Object.is(a, b);
};

/* A short line for a value in a cell, a tooltip or a status line */
export const summarize = (value: Value, limit = 80): string => {
  let text: string;

  if (value === null) {
    text = 'null';
  } else if (isBytes(value)) {
    text = bytesToHex(value.subarray(0, 32), true) + (value.length > 32 ? ' …' : '');
  } else if (Array.isArray(value) || isPlainObject(value)) {
    text = toJson(value);
  } else {
    text = String(value);
  }

  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
};

/* The key as the status line and the dialogs name an object */
export const keyLabel = (key: Key): string => summarize(key, 40);

/* A name for a field's type, as the sidebar and the column headers write it */
export const typeName = (type: FieldType): string => {
  switch (type.kind) {
    case 'link':
      return `→ ${type.collection}`;
    case 'list':
      return `[${typeName(type.element)}]`;
    case 'object':
      return '{…}';
    default:
      return type.kind;
  }
};
