/*
 * CSV as RFC 4180 writes it: fields separated by commas, a field holding a
 * comma, a quote or a line break wrapped in quotes, and a quote inside one
 * doubled. Lines end with CRLF, and the text starts with a byte order mark,
 * which is how a spreadsheet knows to read it as UTF-8.
 *
 * See `src/common/ipc.ts` for what may live in this folder.
 * */

const BOM = '﻿';

const field = (text: string): string =>
  /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;

/* A line of CSV, without its line break */
export const csvLine = (fields: readonly string[]): string => fields.map(field).join(',');

/* A whole CSV text: the header, then a line for each row */
export const toCsv = (header: readonly string[], rows: readonly (readonly string[])[]): string =>
  `${BOM}${[header, ...rows].map(csvLine).join('\r\n')}\r\n`;

/* The text a CSV file starts with, before its lines */
export const CSV_START = BOM;

/*
 * The rows of a CSV text, each a list of its fields, the header included.
 * A byte order mark is skipped, and so is a last empty line. Throws on a
 * quote that is not closed, with the line it opened on.
 * */
export const parseCsv = (text: string): string[][] => {
  const source = text.startsWith(BOM) ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let quoted = false;
  let line = 1;
  let quoteLine = 0;

  for (let at = 0; at < source.length; at += 1) {
    const char = source[at];

    if (quoted) {
      if (char === '"') {
        if (source[at + 1] === '"') {
          value += '"';
          at += 1;
        } else {
          quoted = false;
        }
      } else {
        if (char === '\n') {
          line += 1;
        }

        value += char;
      }
    } else if (char === '"' && value === '') {
      quoted = true;
      quoteLine = line;
    } else if (char === ',') {
      row.push(value);
      value = '';
    } else if (char === '\n' || char === '\r') {
      // CRLF ends one line, not two
      if (char === '\r' && source[at + 1] === '\n') {
        at += 1;
      }

      row.push(value);
      rows.push(row);
      row = [];
      value = '';
      line += 1;
    } else {
      value += char;
    }
  }

  if (quoted) {
    throw new Error(`line ${quoteLine}: a quoted field is not closed`);
  }

  if (value !== '' || row.length > 0) {
    row.push(value);
    rows.push(row);
  }

  return rows;
};
