import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { expect, test } from '@playwright/test';
import { collection, Database, schema, t } from 'darudb';
import {
  nameProblem,
  planSchemaChange,
  schemaFromStored,
  type SchemaChange,
} from '../../src/common/schema';
import { declareSchema } from '../../src/main/declare';

/*
 * A change of a file's schema as the app makes it: planned as plain data,
 * declared, and run by the engine on a file, whose objects have to come
 * through it as they were.
 * */

const files = mkdtempSync(join(tmpdir(), 'darudb-studio-schema-changes-'));

test.afterAll(() => rmSync(files, { recursive: true, force: true }));

let made = 0;

/* A new file of teams and their members, one with an int past what a number holds */
const makeFile = (): string => {
  const path = join(files, `changes-${(made += 1)}.darudb`);
  const db = Database.open(path, {
    schema: schema(1, {
      teams: collection({ code: t.string().primaryKey(), name: t.string() }),
      members: collection(
        {
          name: t.string().index(),
          big: t.bigint().default(0n),
          team: t.link('teams').optional().index(),
          home: t.object({ city: t.string() }).optional(),
        },
        { indexes: [{ fields: ['home.city'] }, { fields: ['name', 'team'], unique: true }] },
      ),
    }),
  });

  db.write((txn) => {
    txn.collection('teams').insert({ code: 'n', name: 'North' });
    txn
      .collection('members')
      .insertMany([
        { name: 'Ada', big: 2n ** 60n + 7n, team: 'n', home: { city: 'Seoul' } },
        { name: 'Bo' },
      ]);
  });
  db.close();

  return path;
};

/* Makes `change` to the file at `path` as the app does, and resolves with the file opened again */
const apply = (path: string, change: SchemaChange) => {
  const before = Database.open(path);
  const current = schemaFromStored(before.storedSchema)!;

  before.close();

  const planned = planSchemaChange(current, change);

  Database.open(path, {
    schema: declareSchema(planned.schema),
    migrations: [planned.migration],
  }).close();

  return Database.open(path);
};

const membersOf = (db: Database) => db.read((txn) => txn.collection('members').find());

test('A collection is added, renamed with the links to it, and deleted', () => {
  const path = makeFile();
  let db = apply(path, {
    kind: 'add-collection',
    name: 'tags',
    key: { field: 'label', type: 'string' },
  });

  expect(db.storedSchema?.version).toBe(2);
  expect(db.storedSchema?.collections.map((each) => [each.name, each.key])).toEqual([
    ['teams', 'code'],
    ['members', 'id'],
    ['tags', 'label'],
  ]);
  db.close();

  db = apply(path, { kind: 'rename-collection', collection: 'teams', name: 'squads' });

  const read = schemaFromStored(db.storedSchema)!;

  expect(read.collections[1].fields.find((field) => field.name === 'team')?.type).toEqual({
    kind: 'link',
    collection: 'squads',
  });
  expect(membersOf(db)[0]).toMatchObject({ name: 'Ada', big: 2n ** 60n + 7n, team: 'n' });
  db.close();

  // A collection other fields link to stays until they go
  db = Database.open(path);
  expect(() =>
    planSchemaChange(schemaFromStored(db.storedSchema)!, {
      kind: 'delete-collection',
      collection: 'squads',
    }),
  ).toThrow('members.team link to squads: delete them first');
  db.close();

  db = apply(path, { kind: 'delete-collection', collection: 'tags' });
  expect(db.storedSchema?.collections.map((each) => each.name)).toEqual(['squads', 'members']);
  expect(db.storedSchema?.version).toBe(4);
  db.close();
});

test('A field is added, renamed with its indexes, and deleted with them', () => {
  const path = makeFile();
  let db = apply(path, {
    kind: 'add-field',
    collection: 'members',
    field: {
      name: 'joined',
      type: { kind: 'date' },
      optional: false,
      default: new Date('2026-01-01T00:00:00Z'),
      index: 'index',
    },
  });

  expect(membersOf(db).map((each) => each.joined)).toEqual([
    new Date('2026-01-01T00:00:00Z'),
    new Date('2026-01-01T00:00:00Z'),
  ]);
  db.close();

  db = apply(path, { kind: 'rename-field', collection: 'members', field: 'home', name: 'house' });

  expect(db.storedSchema?.collections[1].indexes.map((index) => index.fields.join('+'))).toContain(
    'house.city',
  );
  expect(membersOf(db)[0]).toMatchObject({ house: { city: 'Seoul' }, big: 2n ** 60n + 7n });
  db.close();

  // The key of a collection with one of its own can be renamed, not deleted
  db = apply(path, { kind: 'rename-field', collection: 'teams', field: 'code', name: 'slug' });
  expect(db.storedSchema?.collections[0].key).toBe('slug');

  const read = schemaFromStored(db.storedSchema)!;

  db.close();
  expect(() =>
    planSchemaChange(read, { kind: 'delete-field', collection: 'teams', field: 'slug' }),
  ).toThrow('the key of a collection cannot be deleted');

  // The index on two fields goes with the one it is on
  db = apply(path, { kind: 'delete-field', collection: 'members', field: 'team' });
  expect(db.storedSchema?.collections[1].indexes.map((index) => index.fields.join('+'))).toEqual([
    'name',
    'house.city',
    'joined',
  ]);
  expect(membersOf(db)[0]).not.toHaveProperty('team');
  db.close();
});

test('A change that does not fit is refused before the file is touched', () => {
  const path = makeFile();
  const db = Database.open(path);
  const read = schemaFromStored(db.storedSchema)!;

  db.close();

  expect(() =>
    planSchemaChange(read, { kind: 'add-collection', name: 'teams', key: null }),
  ).toThrow('the name teams is taken');
  expect(() =>
    planSchemaChange(read, { kind: 'rename-field', collection: 'members', field: 'id', name: 'x' }),
  ).toThrow('members has no field called id');
  expect(() =>
    planSchemaChange(read, {
      kind: 'add-field',
      collection: 'members',
      field: { name: 'id', type: { kind: 'string' }, optional: true, index: 'none' },
    }),
  ).toThrow('the name id is taken');
  expect(nameProblem(' padded', [])).not.toBeNull();
  expect(nameProblem('a.b', [])).not.toBeNull();
  expect(nameProblem('이름', [])).toBeNull();

  // A required field with no default for the objects already there: the engine says why
  const planned = planSchemaChange(read, {
    kind: 'add-field',
    collection: 'members',
    field: { name: 'nick', type: { kind: 'string' }, optional: false, index: 'none' },
  });

  expect(() =>
    Database.open(path, {
      schema: declareSchema(planned.schema),
      migrations: [planned.migration],
    }),
  ).toThrow('required without a default');

  const after = Database.open(path);

  expect(after.storedSchema?.version).toBe(1);
  after.close();
});
