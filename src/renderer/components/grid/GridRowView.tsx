import { memo, type KeyboardEvent } from 'react';
import { NestedValue, type CellTexts } from '@/renderer/components/grid/CellValue';
import { defaultWidth, GUTTER_WIDTH, type GridColumn } from '@/renderer/components/grid/columns';
import type { GridRow } from '@/renderer/components/grid/DataGrid';
import { keyText } from '@/common/data';

/*
 * One row of a grid. A grid draws its rows again only where something about
 * them changed, so scrolling draws the rows that come into view, and a click
 * the rows it selects, rather than every row in view each time.
 * */

/* A column a row draws, and its place among all the columns of the grid */
export interface ShownColumn {
  column: GridColumn;
  col: number;
}

/* The cell being edited: where it is, what its editor holds, and why that does not read */
export interface EditingCell {
  row: number;
  col: number;
  text: string;
  error: string | null;
}

/* What the editor of a cell does as the user types, keeps or leaves; the same from draw to draw */
export interface CellEditorActions {
  onChange: (text: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onBlur: () => void;
}

/* What names a row's object across reads: its key, or the insert that waits to add it */
export const identityOf = (row: GridRow): string =>
  'key' in row.target ? keyText(row.target.key) : row.target.insertId;

/* The room the columns left out take, so the ones drawn keep their place */
export function GridSpacer({ width }: { width: number }) {
  return width > 0 ? <div className="grid__spacer" aria-hidden="true" style={{ width }} /> : null;
}

interface GridRowViewProps {
  index: number;
  /* Where the row starts, in pixels from the top of the grid */
  start: number;
  /* `undefined` while its page is being read */
  row: GridRow | undefined;
  columns: readonly ShownColumn[];
  widths: Readonly<Record<string, number>>;
  width: number;
  leftPad: number;
  rightPad: number;
  selected: boolean;
  /* The column of the active cell, when it is in this row */
  activeCol: number | null;
  /* The cell being edited, when it is in this row */
  editing: EditingCell | null;
  open: ReadonlySet<string>;
  texts: CellTexts;
  editor: CellEditorActions;
  onToggle: (path: string) => void;
  measure: (node: HTMLDivElement | null) => void;
}

function GridRowView({
  index,
  start,
  row,
  columns,
  widths,
  width,
  leftPad,
  rightPad,
  selected,
  activeCol,
  editing,
  open,
  texts,
  editor,
  onToggle,
  measure,
}: GridRowViewProps) {
  return (
    <div
      ref={measure}
      data-index={index}
      data-row={index}
      className={[
        'grid__row',
        index % 2 === 1 ? 'grid__row--odd' : '',
        selected ? 'grid__row--selected' : '',
        row ? `grid__row--${row.state}` : 'grid__row--loading',
      ].join(' ')}
      role="row"
      aria-rowindex={index + 2}
      aria-selected={selected}
      style={{ width, transform: `translateY(${start}px)` }}
    >
      <div className="grid__gutter" role="rowheader" style={{ width: GUTTER_WIDTH }}>
        {index + 1}
      </div>
      <GridSpacer width={leftPad} />
      {columns.map(({ column, col }) => {
        const isEditing = editing?.col === col;
        const value = row ? (row.values[column.name] ?? null) : undefined;
        const changed = row?.changed.has(column.name) ?? false;

        return (
          <div
            key={column.name}
            data-col={col}
            className={[
              'grid__cell',
              column.type.kind === 'int' || column.type.kind === 'float'
                ? 'grid__cell--number'
                : '',
              activeCol === col ? 'grid__cell--active' : '',
              changed ? 'grid__cell--changed' : '',
              isEditing ? 'grid__cell--editing' : '',
            ].join(' ')}
            role="gridcell"
            aria-colindex={col + 2}
            aria-selected={selected}
            style={{ width: widths[column.name] ?? defaultWidth(column) }}
          >
            {isEditing && editing ? (
              <input
                className="grid__editor"
                data-testid="cell-editor"
                aria-label={column.name}
                aria-invalid={editing.error !== null}
                title={editing.error ?? undefined}
                // Opened by the user to type into, so it takes the focus
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
                value={editing.text}
                placeholder={column.optional ? 'null' : ''}
                onChange={(event) => editor.onChange(event.target.value)}
                onMouseDown={(event) => event.stopPropagation()}
                onKeyDown={editor.onKeyDown}
                onBlur={editor.onBlur}
              />
            ) : value === undefined || !row ? (
              <span className="grid__placeholder" />
            ) : (
              <NestedValue
                value={value}
                type={column.type}
                open={open}
                // By the object rather than its place, which a delete or a sort changes
                path={`${identityOf(row)}:${column.name}`}
                onToggle={onToggle}
                texts={texts}
              />
            )}
          </div>
        );
      })}
      <GridSpacer width={rightPad} />
    </div>
  );
}

export default memo(GridRowView);
