import { expect, test } from '@playwright/test';
import type { SchemaCollection, SchemaField } from '../../src/common/data';
import {
  changesOf,
  stageDelete,
  stageInsert,
  stageInsertUpdate,
  stageUpdate,
  unstageInsert,
  viewOf,
} from '../../src/renderer/project/pending';
import {
  between,
  clamp,
  contains,
  indexesOf,
  normalize,
  sizeOf,
  toggle,
  union,
} from '../../src/renderer/project/selection';
import {
  fromJsonable,
  parseJson,
  parseJsonValue,
  parseScalar,
  sameValue,
  summarize,
  toJson,
} from '../../src/common/values';
import reducer, {
  closeTab,
  mergeGroup,
  moveTab,
  openCollection,
  openQuery,
  sessionLoaded,
  splitTab,
  type ProjectState,
} from '../../src/renderer/store/slices/projectSlice';
import type { Session } from '../../src/common/projects';

/*
 * The parts of the project screen that are plain functions: how a typed value
 * is read for its field, how held edits fold together, how a selection of
 * rows is kept, and how tabs move between groups. These run without the app.
 * */

const teams: SchemaCollection = {
  name: 'teams',
  key: 'name',
  autoIncrement: false,
  fields: [{ name: 'name', type: { kind: 'string' }, optional: false }],
  indexes: [],
};
const users: SchemaCollection = {
  name: 'users',
  key: 'id',
  autoIncrement: true,
  fields: [
    { name: 'age', type: { kind: 'int' }, optional: false, default: 0 },
    { name: 'team', type: { kind: 'link', collection: 'teams' }, optional: true },
    {
      name: 'address',
      type: {
        kind: 'object',
        fields: [
          { name: 'city', type: { kind: 'string' }, optional: false },
          { name: 'hash', type: { kind: 'bytes' }, optional: true },
        ],
      },
      optional: true,
    },
  ],
  indexes: [],
};
const collections = [teams, users];
const field = (name: string): SchemaField => users.fields.find((each) => each.name === name)!;

test('A typed value is read for the type of its field', () => {
  const read = (
    text: string,
    kind: 'int' | 'float' | 'bool' | 'bytes' | 'string',
    optional = false,
  ) => parseScalar(text, { kind }, optional, collections);

  expect(read('42', 'int')).toEqual({ ok: true, value: 42 });
  // An int too large for a number keeps every digit
  expect(read('9007199254740993', 'int')).toEqual({ ok: true, value: 9007199254740993n });
  expect(read('9223372036854775808', 'int').ok).toBe(false);
  expect(read('4.5', 'int').ok).toBe(false);
  expect(read('-1.5e3', 'float')).toEqual({ ok: true, value: -1500 });
  expect(read('TRUE', 'bool')).toEqual({ ok: true, value: true });
  expect(read('0a 1B', 'bytes')).toEqual({ ok: true, value: new Uint8Array([10, 27]) });
  expect(read('0a1', 'bytes').ok).toBe(false);
  // Empty is null where null is allowed, and the empty string for a required string
  expect(read('', 'int', true)).toEqual({ ok: true, value: null });
  expect(read('', 'int').ok).toBe(false);
  expect(read('', 'string')).toEqual({ ok: true, value: '' });
  // A link is typed as the key of the collection it links to
  expect(parseScalar('north', { kind: 'link', collection: 'teams' }, true, collections)).toEqual({
    ok: true,
    value: 'north',
  });
});

test('Lists and objects are read from JSON, led by their type', () => {
  expect(parseJson('[12345678901234567890]')).toEqual([12345678901234567890n]);
  expect(toJson({ big: 12345678901234567890n, bytes: new Uint8Array([255]) })).toBe(
    '{"big":12345678901234567890,"bytes":"ff"}',
  );
  expect(
    parseJsonValue('{"city": "Seoul", "hash": "00ff"}', field('address'), collections),
  ).toEqual({
    ok: true,
    value: { city: 'Seoul', hash: new Uint8Array([0, 255]) },
  });

  const unknown = parseJsonValue('{"city": "Seoul", "zip": "1"}', field('address'), collections);

  expect(unknown.ok).toBe(false);
  expect(!unknown.ok && unknown.error.message).toBe('address.zip: the object has no such field');
  expect(() => fromJsonable({}, field('address').type, false, collections, 'address')).toThrow(
    'address.city: a value is required',
  );
  expect(parseJsonValue('', field('address'), collections)).toEqual({ ok: true, value: null });
});

test('Values compare by content, and summarize on one line', () => {
  expect(sameValue(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
  expect(sameValue({ a: [1, { b: null }] }, { a: [1, { b: null }] })).toBe(true);
  expect(sameValue({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  expect(sameValue(3, 3n)).toBe(true);
  expect(sameValue(3.5, 3n)).toBe(false);
  expect(summarize('x'.repeat(100), 10)).toBe(`${'x'.repeat(9)}…`);
  expect(summarize(null)).toBe('null');
});

test('Held edits fold into one change per object', () => {
  let pending = stageUpdate([], 'users', 1, { age: 2 });

  pending = stageUpdate(pending, 'users', 1, { team: 'north' });
  expect(changesOf(pending)).toEqual([
    { kind: 'update', collection: 'users', key: 1, values: { age: 2, team: 'north' } },
  ]);

  // A delete takes the place of the updates before it
  pending = stageDelete(pending, 'users', 1);
  expect(changesOf(pending)).toEqual([{ kind: 'delete', collection: 'users', key: 1 }]);

  const inserted = stageInsert(pending, 'users', { age: 5 });

  pending = stageInsertUpdate(inserted.pending, inserted.id, { age: 6 });
  expect(viewOf(pending, 'users')).toMatchObject({
    deleted: new Set(['n:1']),
    inserted: [{ id: inserted.id, object: { age: 6 } }],
  });
  expect(viewOf(pending, 'teams').inserted).toHaveLength(0);

  // An insert never written is dropped rather than deleted
  expect(changesOf(unstageInsert(pending, inserted.id))).toEqual([
    { kind: 'delete', collection: 'users', key: 1 },
  ]);
});

test('A selection keeps its rows as ranges', () => {
  expect(
    normalize([
      [5, 3],
      [1, 1],
      [2, 2],
      [9, 12],
    ]),
  ).toEqual([
    [1, 5],
    [9, 12],
  ]);
  expect(toggle(between(0, 4), 2)).toEqual([
    [0, 1],
    [3, 4],
  ]);
  expect(toggle(toggle(between(0, 4), 2), 2)).toEqual([[0, 4]]);
  expect(union(between(0, 1), between(3, 3))).toEqual([
    [0, 1],
    [3, 3],
  ]);
  expect(contains(between(10, 20), 15)).toBe(true);
  expect(sizeOf(between(0, 999_999))).toBe(1_000_000);
  expect(clamp(between(5, 50), 10)).toEqual([[5, 9]]);
  expect(indexesOf(between(0, 999_999), 3)).toEqual([0, 1, 2]);
});

test('Tabs open, split into groups, move and merge', () => {
  const session: Session = {
    project: {
      id: 1,
      name: 'Shop',
      filePath: '/shop.darudb',
      sourcePath: null,
      hasPassword: false,
      createdAt: 0,
      updatedAt: 0,
      lastOpenedAt: null,
      missing: false,
    },
    database: {
      path: '/shop.darudb',
      encrypted: false,
      formatVersion: 6,
      pageSize: 4096,
      schemaVersion: 1,
      fileSize: 0,
    },
    schema: { version: 1, collections },
  };
  let state: ProjectState = reducer(undefined, sessionLoaded(session));
  const titles = () =>
    state.groups.map((group) =>
      group.tabIds.map((id) => state.tabs[id].collection ?? state.tabs[id].kind),
    );

  // The first collection opens with the project, and opening it again brings it forward
  expect(titles()).toEqual([['teams']]);
  state = reducer(state, openCollection({ collection: 'users' }));
  state = reducer(state, openCollection({ collection: 'teams' }));
  expect(titles()).toEqual([['teams', 'users']]);

  const [teamsTab, usersTab] = state.groups[0].tabIds;

  state = reducer(state, splitTab({ tabId: usersTab }));
  expect(titles()).toEqual([['teams'], ['users']]);
  expect(state.focusedGroupId).toBe(state.groups[1].id);

  // A tab alone in its group does not split from itself
  state = reducer(state, splitTab({ tabId: usersTab }));
  expect(state.groups).toHaveLength(2);

  state = reducer(state, openQuery({ collection: 'users' }));
  expect(titles()).toEqual([['teams'], ['users', 'users']]);

  // Moving the last tab out of a group removes the group
  state = reducer(state, moveTab({ tabId: teamsTab, groupId: state.groups[1].id, index: 0 }));
  expect(titles()).toEqual([['teams', 'users', 'users']]);

  state = reducer(state, splitTab({ tabId: teamsTab, side: 'left' }));
  expect(titles()).toEqual([['teams'], ['users', 'users']]);
  state = reducer(state, mergeGroup(state.groups[1].id));
  expect(titles()).toEqual([['teams', 'users', 'users']]);

  state = reducer(state, closeTab(usersTab));
  expect(titles()).toEqual([['teams', 'users']]);
  expect(Object.keys(state.tabs)).toHaveLength(2);
});
