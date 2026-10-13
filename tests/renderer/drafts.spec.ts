import { expect, test } from '@playwright/test';
import type { FieldType, SchemaCollection } from '../../src/common/data';
import {
  emptyDraft,
  fitsForm,
  fromDraft,
  MAX_FORM_ITEMS,
  toDraft,
} from '../../src/renderer/project/drafts';

/* The form a list or an embedded object is edited in, read back as a value */

const address: FieldType = {
  kind: 'object',
  fields: [
    { name: 'city', type: { kind: 'string' }, optional: false },
    { name: 'zip', type: { kind: 'string' }, optional: true },
    { name: 'floors', type: { kind: 'list', element: { kind: 'int' } }, optional: false },
  ],
};
const collections: SchemaCollection[] = [];

test('A value goes through the form and comes back the same', () => {
  const value = { city: 'Seoul', zip: null, floors: [1, 2, 9007199254740993n] };
  const draft = toDraft(value, address);

  expect(draft).toMatchObject({
    kind: 'object',
    fields: {
      zip: { isNull: true },
      floors: { kind: 'list', items: [{ text: '1' }, { text: '2' }, { text: '9007199254740993' }] },
    },
  });
  expect(fromDraft(draft, address, false, collections, 'address')).toEqual(value);
});

test('A part that does not fit is named by its path', () => {
  const draft = toDraft({ city: 'Seoul', zip: null, floors: [1] }, address);

  if (draft.kind !== 'object' || draft.fields.floors.kind !== 'list') {
    throw new Error('unexpected draft');
  }

  draft.fields.floors.items.push({ kind: 'scalar', text: 'two', isNull: false });
  expect(() => fromDraft(draft, address, false, collections, 'address')).toThrow(
    'address.floors[1]: an int is a whole number',
  );

  draft.fields.city = { ...draft.fields.city, isNull: true };
  expect(() => fromDraft(draft, address, false, collections, 'address')).toThrow(
    'address.city: a value is required',
  );
});

test('A new item starts empty, and a long list does not fit the form', () => {
  expect(emptyDraft({ kind: 'bool' })).toEqual({ kind: 'scalar', text: 'false', isNull: false });
  expect(emptyDraft(address)).toMatchObject({ kind: 'object', fields: { floors: { items: [] } } });

  const long = toDraft(
    Array.from({ length: MAX_FORM_ITEMS + 1 }, (_, index) => index),
    { kind: 'list', element: { kind: 'int' } },
  );

  expect(fitsForm(long)).toBe(false);
});
