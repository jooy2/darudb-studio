import { collection, schema, t } from 'darudb';
import type { DatabaseSchema, FieldType, SchemaCollection, SchemaField } from '@/common/data';

/*
 * A schema as plain data, the way the app reads it, made into the declaration
 * the `darudb` package opens a file with: the same calls a program makes, as
 * `schemaToTypeScript` writes them out.
 *
 * The builders are typed for a schema written by hand, so they are called
 * here through the few methods they all share.
 * */

/* What every field builder answers to, as far as a declaration made here calls it */
interface Builder {
  primaryKey(): Builder;
  optional(): Builder;
  default(value: unknown): Builder;
  cascade(): Builder;
  index(): Builder;
  unique(): Builder;
}

type Builders = Record<string, (...args: unknown[]) => Builder>;

const builders = t as unknown as Builders;

/* What a field is marked with besides its type: the key, or an index of its own */
interface FieldMarks {
  primaryKey: boolean;
  index: 'index' | 'unique' | null;
}

const NO_MARKS: FieldMarks = { primaryKey: false, index: null };

const fieldsOf = (
  fields: readonly SchemaField[],
  marksOf: (field: SchemaField) => FieldMarks,
): Record<string, Builder> =>
  Object.fromEntries(fields.map((field) => [field.name, fieldOf(field, marksOf(field))]));

/*
 * The builder of `type`. An int whose default is a `bigint` is declared as
 * one, which the file keeps the same way and reads as a `bigint`.
 * */
const builderOf = (type: FieldType, fallback?: unknown): Builder => {
  switch (type.kind) {
    case 'link':
      return builders.link(type.collection);
    case 'list':
      return builders.list(builderOf(type.element));
    case 'object':
      return builders.object(fieldsOf(type.fields, () => NO_MARKS));
    case 'int':
      return typeof fallback === 'bigint' ? builders.bigint() : builders.int();
    default:
      return builders[type.kind]();
  }
};

/*
 * The field, in the order a program writes its calls: the key first, since
 * only a type a key can be has `primaryKey`, and an index last.
 * */
const fieldOf = (field: SchemaField, marks: FieldMarks): Builder => {
  let built = builderOf(field.type, field.default);

  if (marks.primaryKey) {
    built = built.primaryKey();
  }

  if (field.optional) {
    built = built.optional();
  }

  if (field.default !== undefined) {
    built = built.default(field.default);
  }

  if (field.cascade) {
    built = built.cascade();
  }

  if (marks.index) {
    built = built[marks.index]();
  }

  return built;
};

/* An index on one field of the collection is marked on the field; the rest go in the options */
const collectionOf = (declared: SchemaCollection) => {
  const own = new Map<string, FieldMarks['index']>();
  const others: { fields: [string, ...string[]]; unique: boolean }[] = [];

  for (const index of declared.indexes) {
    const [first, ...rest] = index.fields;
    const onField = rest.length === 0 && declared.fields.some((field) => field.name === first);

    if (onField && own.get(first) !== 'unique') {
      own.set(first, index.unique ? 'unique' : 'index');
    } else if (!onField) {
      others.push({ fields: [first, ...rest], unique: index.unique });
    }
  }

  const fields = fieldsOf(declared.fields, (field) => ({
    primaryKey: !declared.autoIncrement && field.name === declared.key,
    index: own.get(field.name) ?? null,
  }));

  return others.length === 0
    ? collection(fields as never)
    : collection(fields as never, { indexes: others } as never);
};

/* `declared` as the schema the `darudb` package opens a file with */
export const declareSchema = (declared: DatabaseSchema) =>
  schema(
    declared.version,
    Object.fromEntries(
      declared.collections.map((each) => [each.name, collectionOf(each)]),
    ) as Record<string, ReturnType<typeof collection>>,
  );
