import { keyOf, keyText, type Row, type SchemaCollection } from '@/common/data';
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
