import { expect, test } from '@playwright/test';
import { parseCsv, toCsv } from '../../src/common/csv';
import type { SchemaCollection } from '../../src/common/data';
import {
  csvHeader,
  csvRow,
  jsonRow,
  rowsFromCsv,
  rowsFromJson,
  transferColumns,
} from '../../src/common/transfer';

/*
 * The files an export writes and an import reads, as plain functions: CSV as
 * RFC 4180 has it, and records read against a collection's schema.
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
    { name: 'name', type: { kind: 'string' }, optional: false },
    { name: 'age', type: { kind: 'int' }, optional: false, default: 0 },
    { name: 'tags', type: { kind: 'list', element: { kind: 'string' } }, optional: true },
    { name: 'avatar', type: { kind: 'bytes' }, optional: true },
    { name: 'team', type: { kind: 'link', collection: 'teams' }, optional: true },
  ],
  indexes: [],
};
const collections = [teams, users];
const columns = transferColumns(users);

test('CSV quotes what it has to, and reads back what it wrote', () => {
  const text = toCsv(
    ['a', 'b'],
    [
      ['plain', 'with, comma'],
      ['say "hi"', 'two\nlines'],
    ],
  );

  expect(text.startsWith('﻿a,b\r\n')).toBe(true);
  expect(text).toContain('"with, comma"');
  expect(text).toContain('"say ""hi"""');
  expect(parseCsv(text)).toEqual([
    ['a', 'b'],
    ['plain', 'with, comma'],
    ['say "hi"', 'two\nlines'],
  ]);
  expect(() => parseCsv('a\n"open')).toThrow('line 2');
});

test('An export writes the key first, and every value as its file can hold it', () => {
  const row = {
    id: 9007199254740993n,
    name: 'Ada, Lovelace',
    age: 36,
    tags: ['a', 'b'],
    avatar: new Uint8Array([0xca, 0xfe]),
    team: null,
  };

  expect(columns.map((column) => column.name)).toEqual([
    'id',
    'name',
    'age',
    'tags',
    'avatar',
    'team',
  ]);
  expect(csvHeader(columns)).toBe('id,name,age,tags,avatar,team');
  expect(csvRow(row, columns)).toBe('9007199254740993,"Ada, Lovelace",36,"[""a"",""b""]",cafe,');
  expect(jsonRow(row, columns)).toBe(
    '{"id":9007199254740993,"name":"Ada, Lovelace","age":36,"tags":["a","b"],"avatar":"cafe","team":null}',
  );
});

test('A JSON import reads records against the schema, and says which do not fit', () => {
  const read = rowsFromJson(
    JSON.stringify([
      { name: 'Ada', tags: ['x'], avatar: '00ff', team: 'north' },
      { id: 7, name: 'Bo', age: 3 },
      { name: 'Cy', age: 1.5 },
      { age: 2 },
      { name: 'Di', shoe: 44 },
      'not an object',
    ]),
    users,
    collections,
  );

  expect(read.rows).toEqual([
    { name: 'Ada', tags: ['x'], avatar: new Uint8Array([0, 255]), team: 'north' },
    { id: 7, name: 'Bo', age: 3 },
  ]);
  expect(read.problems).toEqual([
    { record: 3, message: 'age: expected a whole number' },
    { record: 4, message: 'name: a value is required' },
    { record: 5, message: 'shoe: the collection has no such field' },
    { record: 6, message: 'an object is expected' },
  ]);
  expect(() => rowsFromJson('{}', users, collections)).toThrow('array');
});

test('A CSV import reads cells by their column, an empty one taking its default', () => {
  const read = rowsFromCsv(
    'name,age,tags,team\r\nAda,,"[""x""]",north\r\nBo,4,,\r\n\r\nCy,old,,\r\nDi,1\r\n',
    users,
    collections,
  );

  expect(read.rows).toEqual([
    { name: 'Ada', tags: ['x'], team: 'north' },
    { name: 'Bo', age: 4 },
  ]);
  expect(read.problems).toEqual([
    { record: 3, message: 'age: an int is a whole number' },
    { record: 4, message: 'the line has 2 fields, not 4' },
  ]);
  expect(() => rowsFromCsv('name,name\r\n', users, collections)).toThrow('two columns');
});
