import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { expect, test } from '@playwright/test';
import { collection, Database, schema, t } from 'darudb';
import { schemaFromStored, schemaToJson, schemaToTypeScript } from '../../src/common/schema';
import { parseJson } from '../../src/common/values';

/*
 * A file's schema written out as the code a program declares it with. The
 * code is run, and the file it opens has to hold the same schema again.
 * */

const files = mkdtempSync(join(tmpdir(), 'darudb-studio-schema-'));

test.afterAll(() => rmSync(files, { recursive: true, force: true }));

// Every kind of field, mark and index a declaration can have
const everything = schema(3, {
  teams: collection({ code: t.string().primaryKey(), name: t.string().unique() }),
  members: collection(
    {
      name: t.string().index(),
      team: t.link('teams').optional().cascade().index(),
      level: t.int().default(1),
      score: t.float().optional(),
      active: t.bool().default(true),
      badge: t.bytes().default(new Uint8Array([1, 2, 255])),
      since: t.date().default(new Date('2026-01-02T03:04:05.678Z')),
      until: t.date().optional(),
      tags: t.list(t.string()).default([]),
      friends: t.list(t.link('members')).optional(),
      home: t.object({ city: t.string(), zip: t.string().optional() }).optional(),
      visits: t.list(t.object({ at: t.date(), note: t.string().optional() })).default([]),
    },
    {
      indexes: [
        { fields: ['home.city'] },
        { fields: ['team', 'level'] },
        { fields: ['name', 'since'], unique: true },
      ],
    },
  ),
});

/* The schema of a new file opened with `declared`, as the app reads it */
const storedWith = (name: string, declared: unknown) => {
  const db = Database.open(join(files, name), {
    schema: declared as typeof everything,
  });

  try {
    return schemaFromStored(db.storedSchema);
  } finally {
    db.close();
  }
};

/* Runs the code `schemaToTypeScript` wrote, and resolves with what it exports */
const run = (code: string): unknown =>
  new Function(
    'collection',
    'schema',
    't',
    code
      .replace(/^import .*$/m, '')
      .replace(/^export const \w+ = /m, 'return ')
      .replace(/;\s*$/, ''),
  )(collection, schema, t);

test('The TypeScript of a schema declares the same schema again', () => {
  const read = storedWith('original.darudb', everything)!;
  const code = schemaToTypeScript(read);

  expect(code).toContain("import { collection, schema, t } from 'darudb';");
  expect(code).toContain('export const databaseSchema = schema(3, {');
  expect(code).toContain('code: t.string().primaryKey(),');
  expect(code).toContain("team: t.link('teams').optional().cascade().index(),");
  expect(code).toContain('badge: t.bytes().default(new Uint8Array([1, 2, 255])),');
  expect(code).toContain("since: t.date().default(new Date('2026-01-02T03:04:05.678Z')),");
  expect(code).toContain(
    "{ indexes: [{ fields: ['home.city'] }, { fields: ['team', 'level'] }, { fields: ['name', 'since'], unique: true }] },",
  );

  expect(storedWith('again.darudb', run(code))).toEqual(read);
});

test('One collection is written as a declaration of its own', () => {
  const read = storedWith('one.darudb', everything)!;
  const code = schemaToTypeScript(read, 'teams');

  expect(code).toContain("import { collection, t } from 'darudb';");
  expect(code).toContain('export const teams = collection({');
  expect(code).not.toContain('members');
  expect(schemaToTypeScript(read, 'nothing')).toBe('');

  // As JSON, the same data a window has, a date and bytes as the app writes them
  const json = parseJson(schemaToJson(read)) as { collections: { fields: unknown[] }[] };

  expect(json.collections[1].fields).toContainEqual(
    expect.objectContaining({ name: 'since', default: '2026-01-02T03:04:05.678Z' }),
  );
  expect(JSON.parse(schemaToJson(read, 'teams'))).toMatchObject({ name: 'teams', key: 'code' });
});
