import type { DatabaseSchema, FieldType, SchemaCollection, SchemaField, Value } from './data';
import { dateText, toJson } from './values';

/*
 * A file's schema, read from what the engine says of it, and written out as
 * the code a program declares it with, or as plain data.
 *
 * `schemaFromStored` turns `Database.storedSchema` into the plain data a
 * window gets. `schemaToTypeScript` writes it as a declaration with the
 * `schema`, `collection` and `t` of the `darudb` package, which opens the same
 * file the way it is: a program can start from it. `schemaToJson` writes the
 * same data a window has.
 *
 * See `src/common/ipc.ts` for what may live in this folder. The `darudb`
 * package is not imported here, not even for its types, so the shape this
 * reads is written out below.
 * */

export const schemaFormats = ['ts', 'json'] as const;

export type SchemaFormat = (typeof schemaFormats)[number];

/* `Database.storedSchema`, as far as this reads it */
interface StoredType {
  kind: string;
  collection?: string;
  element?: StoredType;
  fields?: StoredField[];
}

interface StoredField {
  name: string;
  type: StoredType;
  optional: boolean;
  cascade?: boolean;
  default?: unknown;
}

interface StoredSchema {
  version: number;
  collections: {
    name: string;
    key: string;
    autoIncrement: boolean;
    fields: StoredField[];
    indexes: { fields: readonly string[]; unique: boolean }[];
  }[];
}

const typeOf = (stored: StoredType): FieldType => {
  switch (stored.kind) {
    case 'link':
      return { kind: 'link', collection: String(stored.collection) };
    case 'list':
      return { kind: 'list', element: typeOf(stored.element ?? { kind: 'string' }) };
    case 'object':
      return { kind: 'object', fields: (stored.fields ?? []).map(fieldOf) };
    default:
      return { kind: stored.kind as 'bool' | 'int' | 'float' | 'string' | 'bytes' | 'date' };
  }
};

const fieldOf = (stored: StoredField): SchemaField => ({
  name: stored.name,
  type: typeOf(stored.type),
  optional: stored.optional,
  ...(stored.cascade ? { cascade: true } : {}),
  ...('default' in stored ? { default: stored.default as Value } : {}),
});

/* The schema a file holds as plain data, which crosses to a window by structured clone */
export const schemaFromStored = (stored: unknown): DatabaseSchema | null => {
  if (!stored) {
    return null;
  }

  const { version, collections } = stored as StoredSchema;

  return {
    version,
    collections: collections.map((collection): SchemaCollection => ({
      name: collection.name,
      key: collection.key,
      autoIncrement: collection.autoIncrement,
      fields: collection.fields.map(fieldOf),
      indexes: collection.indexes.map(({ fields, unique }) => ({ fields: [...fields], unique })),
    })),
  };
};

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/* `text` as a string literal in single quotes, as the import line above it is written */
const quote = (text: string): string =>
  `'${JSON.stringify(text).slice(1, -1).replaceAll('\\"', '"').replaceAll("'", "\\'")}'`;

/* `name` as a key of an object literal: as it is, or quoted when it is not a name JavaScript takes */
const propertyKey = (name: string): string => (IDENTIFIER.test(name) ? name : quote(name));

/* `name` as a variable: what JavaScript cannot take in a name becomes `_` */
const variableName = (name: string): string => {
  const cleaned = name.replace(/[^\w$]/g, '_');

  return /^\d/.test(cleaned) ? `_${cleaned}` : cleaned || '_';
};

/* `value` as a JavaScript literal that makes it again */
const literal = (value: Value): string => {
  if (value === null) {
    return 'null';
  }

  if (typeof value === 'bigint') {
    return `${value}n`;
  }

  if (typeof value === 'string') {
    return quote(value);
  }

  if (typeof value !== 'object') {
    return String(value);
  }

  if (value instanceof Date) {
    return `new Date(${quote(dateText(value))})`;
  }

  if (value instanceof Uint8Array) {
    return `new Uint8Array([${Array.from(value).join(', ')}])`;
  }

  if (Array.isArray(value)) {
    return `[${value.map(literal).join(', ')}]`;
  }

  const entries = Object.entries(value);

  return entries.length === 0
    ? '{}'
    : `{ ${entries.map(([name, each]) => `${propertyKey(name)}: ${literal(each)}`).join(', ')} }`;
};

/* What a field is marked with besides its type: the key, or an index of its own */
interface FieldMarks {
  primaryKey: boolean;
  index: 'index' | 'unique' | null;
}

const NO_MARKS: FieldMarks = { primaryKey: false, index: null };

/* The builder of `type`, such as `t.list(t.string())` */
const builderOf = (type: FieldType, indent: string): string => {
  switch (type.kind) {
    case 'link':
      return `t.link(${quote(type.collection)})`;
    case 'list':
      return `t.list(${builderOf(type.element, indent)})`;
    case 'object':
      return `t.object(${fieldsOf(type.fields, indent, () => NO_MARKS)})`;
    default:
      return `t.${type.kind}()`;
  }
};

/*
 * The calls after a field's builder. The key comes first, since only a type
 * a key can be has `primaryKey`, and an index last, as every builder has it.
 * */
const modifiersOf = (field: SchemaField, marks: FieldMarks): string =>
  [
    marks.primaryKey ? '.primaryKey()' : '',
    field.optional ? '.optional()' : '',
    field.default === undefined ? '' : `.default(${literal(field.default)})`,
    field.cascade ? '.cascade()' : '',
    marks.index ? `.${marks.index}()` : '',
  ].join('');

/* `fields` as the object a `collection` or a `t.object` takes, at `indent` */
const fieldsOf = (
  fields: readonly SchemaField[],
  indent: string,
  marksOf: (field: SchemaField) => FieldMarks,
): string => {
  if (fields.length === 0) {
    return '{}';
  }

  const inner = `${indent}  `;
  const lines = fields.map(
    (field) =>
      `${inner}${propertyKey(field.name)}: ${builderOf(field.type, inner)}${modifiersOf(field, marksOf(field))},`,
  );

  return `{\n${lines.join('\n')}\n${indent}}`;
};

/* `collection` as the call that declares it, at `indent` */
const collectionCall = (collection: SchemaCollection, indent: string): string => {
  const own = new Map<string, FieldMarks['index']>();
  const others: SchemaCollection['indexes'] = [];

  // An index on one field of the collection is marked on the field; one on
  // an embedded field, or on several, goes in the options
  for (const index of collection.indexes) {
    const [first] = index.fields;
    const onField =
      index.fields.length === 1 && collection.fields.some((field) => field.name === first);

    if (onField && own.get(first) !== 'unique') {
      own.set(first, index.unique ? 'unique' : 'index');
    } else if (!onField) {
      others.push(index);
    }
  }

  const marksOf = (field: SchemaField): FieldMarks => ({
    primaryKey: !collection.autoIncrement && field.name === collection.key,
    index: own.get(field.name) ?? null,
  });

  if (others.length === 0) {
    return `collection(${fieldsOf(collection.fields, indent, marksOf)})`;
  }

  // The fields and the options each on lines of their own, one level in
  const inner = `${indent}  `;
  const indexes = others
    .map(
      (index) =>
        `{ fields: [${index.fields.map(quote).join(', ')}]${
          index.unique ? ', unique: true' : ''
        } }`,
    )
    .join(', ');

  return `collection(\n${inner}${fieldsOf(collection.fields, inner, marksOf)},\n${inner}{ indexes: [${indexes}] },\n${indent})`;
};

// What the file cannot say: whether a program reads an int as a number or a bigint
const INT_NOTE =
  '// An int field is declared with `t.int()`, which reads a number; declare one\n' +
  '// whose values pass 2^53 with `t.bigint()`, which reads a bigint.';

/*
 * `schema` as TypeScript: the whole of it, or the one collection `only`
 * names, as a declaration of its own.
 * */
export const schemaToTypeScript = (schema: DatabaseSchema, only?: string): string => {
  if (only !== undefined) {
    const collection = schema.collections.find((each) => each.name === only);

    if (!collection) {
      return '';
    }

    return [
      "import { collection, t } from 'darudb';",
      '',
      INT_NOTE,
      `export const ${variableName(collection.name)} = ${collectionCall(collection, '')};`,
      '',
    ].join('\n');
  }

  const collections = schema.collections.map(
    (collection) => `  ${propertyKey(collection.name)}: ${collectionCall(collection, '  ')},`,
  );

  return [
    "import { collection, schema, t } from 'darudb';",
    '',
    INT_NOTE,
    `export const databaseSchema = schema(${schema.version}, {`,
    ...collections,
    '});',
    '',
  ].join('\n');
};

/* `schema` as JSON: the whole of it, or the one collection `only` names */
export const schemaToJson = (schema: DatabaseSchema, only?: string): string => {
  const data =
    only === undefined ? schema : (schema.collections.find((each) => each.name === only) ?? null);

  return `${toJson(data as unknown as Value, 2)}\n`;
};
