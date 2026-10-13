import type { FieldType, SchemaCollection } from '@/common/data';

/* A column of a grid: one field of the collection, its key first */
export interface GridColumn {
  name: string;
  type: FieldType;
  optional: boolean;
  isKey: boolean;
  /* Whether the field has an index, and whether that index is unique */
  index: 'unique' | 'plain' | null;
  /* Whether the engine can sort by it: a field of one value */
  sortable: boolean;
  /* Whether its cells are edited in place: a field of one value that is not the key */
  inline: boolean;
}

// A width that fits the values of each type at a glance, in pixels
const DEFAULT_WIDTHS: Record<FieldType['kind'], number> = {
  bool: 72,
  int: 96,
  float: 104,
  string: 180,
  bytes: 140,
  link: 120,
  list: 170,
  object: 190,
};

export const MIN_COLUMN_WIDTH = 48;

export const MAX_COLUMN_WIDTH = 900;

export const defaultWidth = (column: GridColumn): number =>
  column.isKey ? Math.min(DEFAULT_WIDTHS[column.type.kind], 140) : DEFAULT_WIDTHS[column.type.kind];

/* The columns of `collection`: its key, then its fields in the file's order */
export const columnsOf = (collection: SchemaCollection): GridColumn[] => {
  const indexOf = (name: string): GridColumn['index'] => {
    const found = collection.indexes.find((index) => index.field === name);

    if (!found) {
      return null;
    }

    return found.unique ? 'unique' : 'plain';
  };
  const columns = collection.fields.map((field): GridColumn => {
    const scalar = field.type.kind !== 'list' && field.type.kind !== 'object';
    const isKey = field.name === collection.key;

    return {
      name: field.name,
      type: field.type,
      optional: field.optional,
      isKey,
      index: indexOf(field.name),
      sortable: scalar,
      inline: scalar && !isKey,
    };
  });
  const key: GridColumn = columns.find((column) => column.isKey) ?? {
    // The auto-increment key, which no field declares
    name: collection.key,
    type: { kind: 'int' },
    optional: false,
    isKey: true,
    index: 'unique',
    sortable: true,
    inline: false,
  };

  return [key, ...columns.filter((column) => !column.isKey)];
};
