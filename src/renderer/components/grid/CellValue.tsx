import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { bytesToHex, isBytes, isPlainObject, summarize } from '@/common/values';
import type { FieldType, Value } from '@/common/data';

/*
 * One value, drawn in the colour of its type: numbers, booleans, bytes, links
 * and null each have their own, so a column reads at a glance. A list or an
 * embedded object shows a short summary, and opens in place, one level at a
 * time, as a list of its items or a table of its fields.
 *
 * A grid draws hundreds of these, so they take the words they show from
 * `CellTexts`, made once for the grid, rather than each asking for them.
 * */

/* The words the values show, in the window's language */
export interface CellTexts {
  expand: string;
  collapse: string;
  emptyString: string;
  noBytes: string;
  items: (count: number) => string;
  fields: (count: number) => string;
  bytes: (count: number) => string;
}

/* `make`, kept for each count it was asked for, since a grid asks for the same few again and again */
const byCount = (make: (count: number) => string): ((count: number) => string) => {
  const made = new Map<number, string>();

  return (count) => {
    let text = made.get(count);

    if (text === undefined) {
      text = make(count);
      made.set(count, text);
    }

    return text;
  };
};

/* The words of the values, the same object until the language changes */
export const useCellTexts = (): CellTexts => {
  const [t] = useTranslation();

  return useMemo(
    () => ({
      expand: t('grid.expand'),
      collapse: t('grid.collapse'),
      emptyString: t('grid.empty-string'),
      noBytes: t('grid.no-bytes'),
      items: byCount((count) => t('grid.items', { count })),
      fields: byCount((count) => t('grid.fields', { count })),
      bytes: byCount((count) => t('grid.bytes', { count })),
    }),
    [t],
  );
};

// The summaries of the lists and objects drawn so far, by the value. A value
// read from the file is never changed in place, and an edit makes a new one.
const summaries = new WeakMap<object, string>();

const summaryOf = (value: object): string => {
  let summary = summaries.get(value);

  if (summary === undefined) {
    summary = summarize(value as Value, 60);
    summaries.set(value, summary);
  }

  return summary;
};

const elementType = (type: FieldType | null): FieldType | null =>
  type?.kind === 'list' ? type.element : null;

const fieldType = (type: FieldType | null, name: string): FieldType | null =>
  type?.kind === 'object' ? (type.fields.find((field) => field.name === name)?.type ?? null) : null;

/* The class that colours a value of `type`, or of what the value is when the type is unknown */
const toneOf = (value: Value, type: FieldType | null): string => {
  if (value === null) {
    return 'value--null';
  }

  if (type?.kind === 'link') {
    return 'value--link';
  }

  if (typeof value === 'boolean') {
    return 'value--bool';
  }

  if (typeof value === 'number' || typeof value === 'bigint') {
    return 'value--number';
  }

  if (isBytes(value)) {
    return 'value--bytes';
  }

  if (Array.isArray(value) || isPlainObject(value)) {
    return 'value--nested';
  }

  return 'value--string';
};

interface ScalarValueProps {
  value: Value;
  type: FieldType | null;
  texts: CellTexts;
}

/* A value of one piece, on one line */
export function ScalarValue({ value, type, texts }: ScalarValueProps) {
  const tone = toneOf(value, type);

  if (value === null) {
    return <span className={`value ${tone}`}>null</span>;
  }

  if (isBytes(value)) {
    return (
      <span className={`value ${tone}`} title={texts.bytes(value.length)}>
        {value.length === 0 ? texts.noBytes : bytesToHex(value.subarray(0, 24), true)}
        {value.length > 24 ? ' …' : ''}
      </span>
    );
  }

  if (typeof value === 'string' && value === '') {
    return <span className="value value--empty">{texts.emptyString}</span>;
  }

  return (
    <span className={`value ${tone}`}>
      {type?.kind === 'link' ? '→ ' : ''}
      {String(value)}
    </span>
  );
}

interface NestedValueProps {
  value: Value;
  type: FieldType | null;
  /* The paths of the nested values that are open, such as `0` or `address.lines` */
  open: ReadonlySet<string>;
  path: string;
  onToggle: (path: string) => void;
  texts: CellTexts;
}

/* The items of a list, or the fields of an object, under the summary that opens them */
function NestedItems({ value, type, open, path, onToggle, texts }: NestedValueProps) {
  const entries: [string, Value, FieldType | null][] = Array.isArray(value)
    ? value.map((item, index) => [String(index), item, elementType(type)])
    : Object.entries(value as Record<string, Value>).map(([name, item]) => [
        name,
        item,
        fieldType(type, name),
      ]);

  return (
    <dl className={Array.isArray(value) ? 'nested nested--list' : 'nested nested--object'}>
      {entries.map(([name, item, itemType]) => (
        <div className="nested__entry" key={name}>
          <dt className="nested__name">{Array.isArray(value) ? `[${name}]` : name}</dt>
          <dd className="nested__value">
            <NestedValue
              value={item}
              type={itemType}
              open={open}
              path={path ? `${path}.${name}` : name}
              onToggle={onToggle}
              texts={texts}
            />
          </dd>
        </div>
      ))}
    </dl>
  );
}

/* A value of any shape: a scalar as it is, a list or an object with its toggle */
export function NestedValue({ value, type, open, path, onToggle, texts }: NestedValueProps) {
  if (!Array.isArray(value) && !isPlainObject(value)) {
    return <ScalarValue value={value} type={type} texts={texts} />;
  }

  const expanded = open.has(path);
  const size = Array.isArray(value) ? value.length : Object.keys(value).length;
  const label = Array.isArray(value) ? texts.items(size) : texts.fields(size);

  return (
    <span className="nested-value">
      <button
        type="button"
        className="nested-value__toggle"
        aria-expanded={expanded}
        aria-label={expanded ? texts.collapse : texts.expand}
        disabled={size === 0}
        // The row's own handlers select and edit; this click only opens the value
        onMouseDown={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onToggle(path);
        }}
      >
        {expanded ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
      </button>
      <span className="value value--nested" title={label}>
        {Array.isArray(value) ? `[${size}]` : `{${size}}`} {expanded ? '' : summaryOf(value)}
      </span>
      {expanded && (
        <NestedItems
          value={value}
          type={type}
          open={open}
          path={path}
          onToggle={onToggle}
          texts={texts}
        />
      )}
    </span>
  );
}
