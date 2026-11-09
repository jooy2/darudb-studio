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

/*
 * Changing the schema
 *
 * The app declares no schema of its own, so a change is made the way a
 * program would make it: the file is opened once with the schema as it is,
 * changed, one version up, and a migration that says what was renamed and
 * what went. `planSchemaChange` works out both as plain data, and the main
 * process turns the schema into a declaration and runs it, see
 * `src/main/schemaChanges.ts`.
 *
 * A program that declares the version before can no longer open the file
 * afterwards: the engine refuses it with `SCHEMA_TOO_NEW` until it declares
 * the new one. The screens say so before they ask for a change.
 * */

/* A field to add to a collection */
export interface NewField {
  name: string;
  type: FieldType;
  optional: boolean;
  /* What the objects already there take, and a new one that leaves the field out */
  default?: Value;
  index: 'none' | 'index' | 'unique';
}

/* The types a key of its own can be; without one, the key is the auto-increment `id` */
export const keyKinds = ['string', 'int', 'bytes'] as const;

export type KeyKind = (typeof keyKinds)[number];

export type SchemaChange =
  | { kind: 'add-collection'; name: string; key: { field: string; type: KeyKind } | null }
  | { kind: 'rename-collection'; collection: string; name: string }
  | { kind: 'delete-collection'; collection: string }
  | { kind: 'add-field'; collection: string; field: NewField }
  | { kind: 'rename-field'; collection: string; field: string; name: string }
  | { kind: 'delete-field'; collection: string; field: string };

/* What the engine is told besides the new schema, as its `Migration` names it */
export interface SchemaMigration {
  version: number;
  renameCollections?: [string, string][];
  renameFields?: [string, string, string][];
  deleteCollections?: string[];
}

/* A change that cannot be made as it is asked, with why */
export class SchemaChangeError extends Error {
  code = 'INVALID_ARGUMENT';
}

// The auto-increment key's name, which no field of a collection without a key of its own takes
const AUTO_KEY = 'id';

/*
 * Why `name` cannot name a collection or a field, or `null` when it can. A
 * backtick is what the query language quotes a name with, and a dot what it
 * reaches into an embedded object with, so neither can be in one.
 * */
export const nameProblem = (name: string, taken: readonly string[]): string | null => {
  if (name.trim() === '' || name !== name.trim()) {
    return 'a name is not empty, and does not start or end with a space';
  }

  if (name.includes('`') || name.includes('.')) {
    return 'a name has no backtick and no dot';
  }

  if (taken.includes(name)) {
    return `the name ${name} is taken`;
  }

  return null;
};

const fail = (message: string): never => {
  throw new SchemaChangeError(message);
};

const checkName = (name: unknown, taken: readonly string[]): string => {
  if (typeof name !== 'string') {
    return fail('a name is text');
  }

  const problem = nameProblem(name, taken);

  return problem === null ? name : fail(problem);
};

/* `type` with every link to `from` linking to `to` instead */
const relinked = (type: FieldType, from: string, to: string): FieldType => {
  switch (type.kind) {
    case 'link':
      return type.collection === from ? { kind: 'link', collection: to } : type;
    case 'list':
      return { kind: 'list', element: relinked(type.element, from, to) };
    case 'object':
      return {
        kind: 'object',
        fields: type.fields.map((field) => ({ ...field, type: relinked(field.type, from, to) })),
      };
    default:
      return type;
  }
};

/* Whether `type` links to `target`, in a list or an embedded object too */
const linksTo = (type: FieldType, target: string): boolean => {
  switch (type.kind) {
    case 'link':
      return type.collection === target;
    case 'list':
      return linksTo(type.element, target);
    case 'object':
      return type.fields.some((field) => linksTo(field.type, target));
    default:
      return false;
  }
};

/* Whether the index path `path` is the field `field`, or a path into it */
const onField = (path: string, field: string): boolean =>
  path === field || path.startsWith(`${field}.`);

/* The field types a new field can have: one value, a link, or a list of either */
export const isNewFieldType = (type: FieldType): boolean =>
  type.kind === 'list'
    ? type.element.kind !== 'list' && type.element.kind !== 'object'
    : type.kind !== 'object';

/*
 * The schema `change` makes of `schema`, one version up, and the migration
 * that goes with it. Throws a `SchemaChangeError` for a change that does not
 * fit the schema: a name that is taken, a collection or a field that is not
 * there, or a collection that other fields still link to.
 * */
export const planSchemaChange = (
  schema: DatabaseSchema,
  change: SchemaChange,
): { schema: DatabaseSchema; migration: SchemaMigration } => {
  const version = schema.version + 1;
  const names = schema.collections.map((collection) => collection.name);
  const collectionNamed = (name: unknown): SchemaCollection =>
    schema.collections.find((collection) => collection.name === name) ??
    fail(`the file has no collection called ${String(name)}`);
  const replace = (collections: SchemaCollection[]): DatabaseSchema => ({ version, collections });

  switch (change?.kind) {
    case 'add-collection': {
      const name = checkName(change.name, names);
      const key = change.key;

      if (key !== null && !keyKinds.includes(key?.type)) {
        return fail(`a key is one of ${keyKinds.join(', ')}`);
      }

      const keyField = key === null ? null : checkName(key.field, []);

      return {
        schema: replace([
          ...schema.collections,
          {
            name,
            key: keyField ?? AUTO_KEY,
            autoIncrement: keyField === null,
            fields:
              keyField === null || key === null
                ? []
                : [{ name: keyField, type: { kind: key.type }, optional: false }],
            indexes: [],
          },
        ]),
        migration: { version },
      };
    }
    case 'rename-collection': {
      const from = collectionNamed(change.collection).name;
      const to = checkName(change.name, names);

      return {
        schema: replace(
          schema.collections.map((collection) => ({
            ...collection,
            name: collection.name === from ? to : collection.name,
            fields: collection.fields.map((field) => ({
              ...field,
              type: relinked(field.type, from, to),
            })),
          })),
        ),
        migration: { version, renameCollections: [[from, to]] },
      };
    }
    case 'delete-collection': {
      const gone = collectionNamed(change.collection).name;
      const linking = schema.collections
        .filter((collection) => collection.name !== gone)
        .flatMap((collection) =>
          collection.fields
            .filter((field) => linksTo(field.type, gone))
            .map((field) => `${collection.name}.${field.name}`),
        );

      if (linking.length > 0) {
        return fail(`${linking.join(', ')} link to ${gone}: delete them first`);
      }

      return {
        schema: replace(schema.collections.filter((collection) => collection.name !== gone)),
        migration: { version, deleteCollections: [gone] },
      };
    }
    case 'add-field': {
      const collection = collectionNamed(change.collection);
      const field = change.field;
      const taken = [
        ...collection.fields.map((each) => each.name),
        ...(collection.autoIncrement ? [AUTO_KEY] : []),
      ];
      const name = checkName(field?.name, taken);

      if (!field.type || !isNewFieldType(field.type)) {
        return fail('a new field holds one value, a link, or a list of either');
      }

      if (
        field.type.kind === 'link' ||
        (field.type.kind === 'list' && field.type.element.kind === 'link')
      ) {
        const target = field.type.kind === 'link' ? field.type : field.type.element;

        collectionNamed((target as { collection: string }).collection);
      }

      const indexed = field.index !== 'none' && field.type.kind !== 'list';

      return {
        schema: replace(
          schema.collections.map((each) =>
            each.name === collection.name
              ? {
                  ...each,
                  fields: [
                    ...each.fields,
                    {
                      name,
                      type: field.type,
                      optional: field.optional === true,
                      ...(field.default === undefined ? {} : { default: field.default }),
                    },
                  ],
                  indexes: indexed
                    ? [...each.indexes, { fields: [name], unique: field.index === 'unique' }]
                    : each.indexes,
                }
              : each,
          ),
        ),
        migration: { version },
      };
    }
    case 'rename-field': {
      const collection = collectionNamed(change.collection);
      const from =
        collection.fields.find((field) => field.name === change.field)?.name ??
        fail(`${collection.name} has no field called ${String(change.field)}`);
      const to = checkName(change.name, [
        ...collection.fields.map((field) => field.name),
        ...(collection.autoIncrement ? [AUTO_KEY] : []),
      ]);
      const renamePath = (path: string): string =>
        onField(path, from) ? `${to}${path.slice(from.length)}` : path;

      return {
        schema: replace(
          schema.collections.map((each) =>
            each.name === collection.name
              ? {
                  ...each,
                  key: each.key === from ? to : each.key,
                  fields: each.fields.map((field) =>
                    field.name === from ? { ...field, name: to } : field,
                  ),
                  indexes: each.indexes.map((index) => ({
                    ...index,
                    fields: index.fields.map(renamePath),
                  })),
                }
              : each,
          ),
        ),
        migration: { version, renameFields: [[collection.name, from, to]] },
      };
    }
    case 'delete-field': {
      const collection = collectionNamed(change.collection);
      const gone =
        collection.fields.find((field) => field.name === change.field)?.name ??
        fail(`${collection.name} has no field called ${String(change.field)}`);

      if (!collection.autoIncrement && collection.key === gone) {
        return fail('the key of a collection cannot be deleted');
      }

      return {
        schema: replace(
          schema.collections.map((each) =>
            each.name === collection.name
              ? {
                  ...each,
                  fields: each.fields.filter((field) => field.name !== gone),
                  // An index on the field goes with it, one on several fields too
                  indexes: each.indexes.filter(
                    (index) => !index.fields.some((path) => onField(path, gone)),
                  ),
                }
              : each,
          ),
        ),
        migration: { version },
      };
    }
    default:
      return fail('a schema change is one this app knows');
  }
};
