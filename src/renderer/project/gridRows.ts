import { keyOf, keyText, type Key, type Row, type SchemaCollection } from '@/common/data';
import type { GridRow } from '@/renderer/components/grid/DataGrid';
import type { PendingView } from '@/renderer/project/pending';

const NOTHING_CHANGED: ReadonlySet<string> = new Set();

/* An object read from the file, with the edits held for it applied */
export const savedRow = (collection: SchemaCollection, row: Row, view: PendingView): GridRow => {
  const key = keyOf(collection, row);
  const name = keyText(key);
  const updated = view.updated.get(name);

  if (view.deleted.has(name)) {
    return { values: row, target: { key }, state: 'deleted', changed: NOTHING_CHANGED };
  }

  if (updated) {
    return {
      values: { ...row, ...updated },
      target: { key },
      state: 'changed',
      changed: new Set(Object.keys(updated)),
    };
  }

  return { values: row, target: { key }, state: 'saved', changed: NOTHING_CHANGED };
};

/* An object that waits to be inserted, shown before the ones in the file */
export const newRow = ({ id, object }: { id: string; object: Row }): GridRow => ({
  values: object,
  target: { insertId: id },
  state: 'new',
  changed: new Set(Object.keys(object)),
});

/* The rows of a grid, made from what the file holds and from the inserts held */
export interface RowMaker {
  saved: (row: Row) => GridRow;
  inserted: (entry: PendingView['inserted'][number]) => GridRow;
}

/*
 * Makes the rows a grid draws, each once for as long as the held edits stay
 * the same, so a row that did not change is the same object from one draw to
 * the next, and the grid leaves it as it is drawn
 * */
export const rowMaker = (collection: SchemaCollection, view: PendingView): RowMaker => {
  const made = new WeakMap<object, GridRow>();
  const once = (source: object, make: () => GridRow): GridRow => {
    let row = made.get(source);

    if (row === undefined) {
      row = make();
      made.set(source, row);
    }

    return row;
  };

  return {
    saved: (row) => once(row, () => savedRow(collection, row, view)),
    inserted: (entry) => once(entry, () => newRow(entry)),
  };
};

/* The keys of the rows that are in the file, leaving out the ones still to be inserted */
export const keysOf = (rows: readonly GridRow[]): Key[] =>
  rows.flatMap((row) => ('key' in row.target ? [row.target.key] : []));
