import { keyText, type Change, type Key, type Row } from '@/common/data';

/*
 * The edits a window holds back while the settings ask for edits to wait for
 * a submit. Each edit is a `Change`, kept in the order it was made, so the
 * batch writes them in that order.
 *
 * Edits to one object fold into one change: a second update of it merges into
 * the first, an update of an object that is still to be inserted changes what
 * is inserted, and a delete replaces the updates before it, or drops an insert
 * that was never written.
 * */

export interface PendingEdit {
  /* Unique in the window; for an insert, also the name of its row until it is written */
  id: string;
  change: Change;
}

const objectId = (collection: string, key: Key): string => `${collection}\u0000${keyText(key)}`;

// An object to add goes by the id of its edit, having no key until it is written
const idOf = ({ change }: PendingEdit): string | null =>
  change.kind === 'insert' || change.kind === 'put'
    ? null
    : objectId(change.collection, change.key);

let lastEdit = 0;

const nextId = (): string => {
  lastEdit += 1;

  return `edit-${lastEdit}`;
};

/* `pending` with fields of the object `key` of `collection` changed to `values` */
export const stageUpdate = (
  pending: readonly PendingEdit[],
  collection: string,
  key: Key,
  values: Row,
): PendingEdit[] => {
  const target = objectId(collection, key);
  const index = pending.findIndex((edit) => idOf(edit) === target);

  if (index < 0) {
    return [...pending, { id: nextId(), change: { kind: 'update', collection, key, values } }];
  }

  const found = pending[index];

  // A deleted object is not edited: the grid offers no edit for it
  if (found.change.kind !== 'update') {
    return [...pending];
  }

  return pending.map((edit, at) =>
    at === index && edit.change.kind === 'update'
      ? { ...edit, change: { ...edit.change, values: { ...edit.change.values, ...values } } }
      : edit,
  );
};

/* `pending` with an object to insert, and the id its row goes by until it is written */
export const stageInsert = (
  pending: readonly PendingEdit[],
  collection: string,
  object: Row,
): { pending: PendingEdit[]; id: string } => {
  const id = nextId();

  return { pending: [...pending, { id, change: { kind: 'insert', collection, object } }], id };
};

/* `pending` with fields of the object the insert `id` adds changed to `values` */
export const stageInsertUpdate = (
  pending: readonly PendingEdit[],
  id: string,
  values: Row,
): PendingEdit[] =>
  pending.map((edit) =>
    edit.id === id && edit.change.kind === 'insert'
      ? { ...edit, change: { ...edit.change, object: { ...edit.change.object, ...values } } }
      : edit,
  );

/* `pending` with the object `key` of `collection` deleted, its updates dropped */
export const stageDelete = (
  pending: readonly PendingEdit[],
  collection: string,
  key: Key,
): PendingEdit[] => {
  const target = objectId(collection, key);
  const kept = pending.filter((edit) => idOf(edit) !== target);

  return [...kept, { id: nextId(), change: { kind: 'delete', collection, key } }];
};

/* `pending` without the insert `id`, as deleting a row that was never written does */
export const unstageInsert = (pending: readonly PendingEdit[], id: string): PendingEdit[] =>
  pending.filter((edit) => edit.id !== id);

/* What the pending edits do to one collection's rows, looked up by key as the grid draws them */
export interface PendingView {
  updated: Map<string, Row>;
  deleted: Set<string>;
  /* The objects to insert, oldest first, with the ids their rows go by */
  inserted: { id: string; object: Row }[];
}

export const viewOf = (pending: readonly PendingEdit[], collection: string): PendingView => {
  const view: PendingView = { updated: new Map(), deleted: new Set(), inserted: [] };

  for (const { id, change } of pending) {
    if (change.collection !== collection) {
      continue;
    }

    if (change.kind === 'insert' || change.kind === 'put') {
      view.inserted.push({ id, object: change.object });
    } else if (change.kind === 'update') {
      view.updated.set(keyText(change.key), change.values);
    } else {
      view.deleted.add(keyText(change.key));
    }
  }

  return view;
};

/* The batch the pending edits write, in the order they were made */
export const changesOf = (pending: readonly PendingEdit[]): Change[] =>
  pending.map((edit) => edit.change);
