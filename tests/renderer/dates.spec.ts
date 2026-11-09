import { expect, test } from '@playwright/test';
import type { FieldType, SchemaCollection } from '../../src/common/data';
import {
  csvRow,
  jsonRow,
  rowsFromCsv,
  rowsFromJson,
  transferColumns,
} from '../../src/common/transfer';
import {
  dateText,
  fromJsonable,
  isPlainObject,
  parseDate,
  parseJson,
  parseScalar,
  sameValue,
  scalarText,
  summarize,
  toJson,
} from '../../src/common/values';
import { fromDraft, toDraft } from '../../src/renderer/project/drafts';

/*
 * Dates as the app shows them and reads them back: RFC 3339 text in UTC, the
 * way the query language's `DATE "…"` names them.
 * */

const date: FieldType = { kind: 'date' };
const events: SchemaCollection = {
  name: 'events',
  key: 'id',
  autoIncrement: true,
  fields: [
    { name: 'title', type: { kind: 'string' }, optional: false },
    { name: 'at', type: date, optional: false },
    { name: 'until', type: date, optional: true },
    { name: 'reminders', type: { kind: 'list', element: date }, optional: false, default: [] },
  ],
  indexes: [{ fields: ['at'], unique: false }],
};
const collections = [events];

test('A date is read from RFC 3339 text, and only from a day of the calendar', () => {
  expect(parseDate('2026-10-30')).toEqual(new Date('2026-10-30T00:00:00Z'));
  expect(parseDate('2026-10-30T12:00:00Z')).toEqual(new Date('2026-10-30T12:00:00Z'));
  // An offset from UTC names the same instant in UTC
  expect(parseDate('2026-10-30T21:00:00+09:00')).toEqual(new Date('2026-10-30T12:00:00Z'));
  expect(parseDate('2026-10-30t04:30:00-07:30')).toEqual(new Date('2026-10-30T12:00:00Z'));
  // Digits past the millisecond are dropped, as the engine drops them
  expect(parseDate('2026-10-30T12:00:00.123999Z')?.getTime()).toBe(
    Date.UTC(2026, 9, 30, 12, 0, 0, 123),
  );
  expect(parseDate('2026-10-30T12:00:00.5Z')?.getUTCMilliseconds()).toBe(500);
  // A year before 100 is that year, not one of the 1900s
  expect(parseDate('0042-01-01')?.getUTCFullYear()).toBe(42);
  // The extended year `toISOString` writes past 9999 reads back
  expect(parseDate('+012026-01-01')?.getUTCFullYear()).toBe(12026);

  for (const text of [
    '',
    '2026-02-30',
    '2026-13-01',
    '2026-00-10',
    '2026-10-30T12:00:00',
    '2026-10-30 12:00:00Z',
    '2026-10-30T24:00:00Z',
    '2026-10-30T12:60:00Z',
    '2026-10-30T12:00:60Z',
    '2026-10-30T12:00Z',
    '2026-10-30T12:00:00+24:00',
    '26-10-30',
    '-000000-01-01',
    '+275761-01-01',
    'yesterday',
  ]) {
    expect(parseDate(text), text).toBeNull();
  }
});

test('A date is typed, shown and compared as the instant it names', () => {
  const at = new Date('2026-01-02T03:04:05.678Z');

  expect(dateText(at)).toBe('2026-01-02T03:04:05.678Z');
  expect(scalarText(at)).toBe('2026-01-02T03:04:05.678Z');
  expect(summarize(at)).toBe('2026-01-02T03:04:05.678Z');
  expect(dateText(new Date(Date.UTC(12026, 0, 1)))).toBe('+012026-01-01T00:00:00.000Z');
  expect(parseDate(dateText(new Date(-8.64e15)))).toEqual(new Date(-8.64e15));
  // A date is a value of one piece, not an object of no fields
  expect(isPlainObject(at)).toBe(false);

  expect(parseScalar(' 2026-01-02T12:04:05.678+09:00 ', date, false, collections)).toEqual({
    ok: true,
    value: at,
  });
  expect(parseScalar('', date, true, collections)).toEqual({ ok: true, value: null });

  const refused = parseScalar('2026-02-30', date, false, collections, 'at');

  expect(refused.ok).toBe(false);
  expect(!refused.ok && refused.error.message).toMatch(/^at: a date is a day/);

  expect(sameValue(at, new Date(at.getTime()))).toBe(true);
  expect(sameValue(at, new Date(at.getTime() + 1))).toBe(false);
  expect(sameValue([at], [new Date(at.getTime())])).toBe(true);
  expect(sameValue(at, dateText(at))).toBe(false);
});

test('A date in a list or an object goes through JSON and the form unchanged', () => {
  const reminders: FieldType = { kind: 'list', element: date };
  const value = [new Date('2026-01-01T09:00:00Z'), new Date('1969-07-20T20:17:40Z')];
  const text = toJson(value);

  expect(text).toBe('["2026-01-01T09:00:00.000Z","1969-07-20T20:17:40.000Z"]');
  expect(fromJsonable(parseJson(text), reminders, false, collections)).toEqual(value);
  expect(() => fromJsonable([1767258000000], reminders, false, collections, 'reminders')).toThrow(
    'reminders[0]: expected a date',
  );

  // A default the schema gives is a `Date` already
  const schedule: FieldType = {
    kind: 'object',
    fields: [{ name: 'starts', type: date, optional: false, default: new Date(0) }],
  };

  expect(fromJsonable({}, schedule, false, collections)).toEqual({ starts: new Date(0) });

  const draft = toDraft(value, reminders);

  expect(draft).toMatchObject({ items: [{ text: '2026-01-01T09:00:00.000Z' }, {}] });
  expect(fromDraft(draft, reminders, false, collections, 'reminders')).toEqual(value);
});

test('A date goes out to CSV and JSON as RFC 3339 text, and comes back in', () => {
  const columns = transferColumns(events);
  const row = {
    id: 1,
    title: 'launch',
    at: new Date('2026-01-02T03:04:05.678Z'),
    until: null,
    reminders: [new Date('2026-01-01T09:00:00Z')],
  };

  expect(csvRow(row, columns)).toBe(
    '1,launch,2026-01-02T03:04:05.678Z,,"[""2026-01-01T09:00:00.000Z""]"',
  );
  expect(JSON.parse(jsonRow(row, columns))).toEqual({
    id: 1,
    title: 'launch',
    at: '2026-01-02T03:04:05.678Z',
    until: null,
    reminders: ['2026-01-01T09:00:00.000Z'],
  });

  expect(
    rowsFromCsv(
      'title,at,until,reminders\r\nlaunch,2026-01-02T12:04:05.678+09:00,,"[""2026-01-01""]"\r\n',
      events,
      collections,
    ),
  ).toEqual({
    rows: [
      {
        title: 'launch',
        at: new Date('2026-01-02T03:04:05.678Z'),
        reminders: [new Date('2026-01-01T00:00:00Z')],
      },
    ],
    problems: [],
  });
  expect(
    rowsFromJson(
      JSON.stringify([{ title: 'late', at: '2026-01-02', until: '2026-01-03T00:00:00Z' }]),
      events,
      collections,
    ).rows,
  ).toEqual([
    {
      title: 'late',
      at: new Date('2026-01-02T00:00:00Z'),
      until: new Date('2026-01-03T00:00:00Z'),
    },
  ]);
  expect(
    rowsFromJson(JSON.stringify([{ title: 'wrong', at: 'soon' }]), events, collections).problems,
  ).toEqual([{ record: 1, message: 'at: expected a date as text, such as 2026-10-30T12:00:00Z' }]);
});
