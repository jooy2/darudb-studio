import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  observeElementRect,
  useVirtualizer,
  type Rect,
  type Virtualizer,
} from '@tanstack/react-virtual';
import { ArrowDown, ArrowUp, KeyRound, Zap } from 'lucide-react';
import { PlContextMenu, PlMenuItem, PlMenuSeparator, PlMenuSubmenu } from 'plass-ui';
import { ScalarValue, useCellTexts } from '@/renderer/components/grid/CellValue';
import {
  columnsOf,
  defaultWidth,
  GUTTER_WIDTH,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  type GridColumn,
} from '@/renderer/components/grid/columns';
import GridRowView, {
  GridSpacer,
  type CellEditorActions,
  type EditingCell,
  type ShownColumn,
} from '@/renderer/components/grid/GridRowView';
import {
  between,
  clamp,
  contains,
  EMPTY,
  indexesOf,
  sizeOf,
  toggle,
  union,
  type Ranges,
} from '@/renderer/project/selection';
import {
  isScalarType,
  parseScalar,
  sameValue,
  scalarText,
  toJson,
  typeName,
} from '@/common/values';
import { useMenuModel } from '@/renderer/components/menu/MenuModelContext';
import { acceleratorLabel } from '@/common/menu';
import { transferFormats, type TransferFormat } from '@/common/transfer';
import type { Row, SchemaCollection, SortKey, Value } from '@/common/data';
import type { ObjectTarget } from '@/renderer/store/slices/projectSlice';

/* A row as the grid draws it: the object with the held edits applied */
export interface GridRow {
  values: Row;
  target: ObjectTarget;
  /* `new` waits to be inserted, `changed` has held edits, `deleted` waits to be deleted */
  state: 'saved' | 'new' | 'changed' | 'deleted';
  /* The fields with held edits */
  changed: ReadonlySet<string>;
}

interface DataGridProps {
  collection: SchemaCollection;
  collections: readonly SchemaCollection[];
  rowCount: number;
  rowAt: (index: number) => GridRow | undefined;
  /* Asks for the rows from `start` to `end`, which the grid is about to draw */
  onRangeChange: (start: number, end: number) => void;
  /* Clears the selection when it changes: a new filter, sort or collection */
  resetKey: string;
  sort: readonly SortKey[];
  /* Without it, the headers do not sort */
  onSortChange?: (sort: SortKey[]) => void;
  readOnly?: boolean;
  onEditCell: (row: GridRow, field: string, value: Value) => void;
  onEditObject: (row: GridRow) => void;
  onDeleteRows: (rows: GridRow[]) => void;
  onViewValue: (row: GridRow, column: GridColumn) => void;
  onSelectionChange?: (count: number) => void;
  /*
   * Exports the selected rows, as many as the grid has read; `everything`
   * when every row is selected, which the view itself exports better
   * */
  onExportRows?: (rows: GridRow[], format: TransferFormat, everything: boolean) => void;
  /* The widths of the columns the user set, by field, which the grid starts from */
  widths?: Record<string, number>;
  /* Hands on the widths once a column is resized, to be kept with the tab */
  onWidthsChange?: (widths: Record<string, number>) => void;
  /* What the grid says when it has no rows */
  empty?: ReactNode;
  testId?: string;
}

const ROW_HEIGHT = 24;
// Past this many columns, a row draws only the ones in view, as the grid draws only the rows in view
const COLUMN_WINDOW_AT = 40;
const HEADER_HEIGHT = 30;
// How many rows a page key moves, less than a screen so the last one stays in view
const PAGE_ROWS = 20;
// The most rows a copy takes, so a selection of every row does not stall the window
const COPY_LIMIT = 5000;

type Cell = { row: number; col: number };

/*
 * The size of the grid, as its scroller reports it, leaving out the size of
 * nothing that a grid in a tab behind another has: such a grid keeps the rows
 * and columns it drew, and shows them again at once when its tab is in front
 * */
const observeShownRect = (
  instance: Virtualizer<HTMLDivElement, Element>,
  onChange: (rect: Rect) => void,
) =>
  observeElementRect(instance, (rect) => {
    if (rect.width > 0 || rect.height > 0) {
      onChange(rect);
    }
  });

const isMac = navigator.platform.toLowerCase().includes('mac');
const modKey = (event: { metaKey: boolean; ctrlKey: boolean }): boolean =>
  isMac ? event.metaKey : event.ctrlKey;

/* What a cell or a row is, read from the element a pointer event hit */
const cellAt = (target: EventTarget | null): Partial<Cell> => {
  const hit = target instanceof Element ? target : null;
  const row = hit?.closest<HTMLElement>('[data-row]')?.dataset.row;
  // The cell is between the row and what was hit, so it is looked for from the hit
  const col = hit?.closest<HTMLElement>('[data-col]')?.dataset.col;

  if (row === undefined) {
    return {};
  }

  return { row: Number(row), ...(col === undefined ? {} : { col: Number(col) }) };
};

/*
 * A collection's objects as a table: a row for each object and a column for
 * each field, drawn only where the window shows them, so it holds as many rows
 * as the collection does.
 *
 * Rows are selected the way a desktop table selects them: a click, a click
 * with the platform's modifier to add or take one away, a click with Shift or
 * a drag across rows for a range, and the arrow keys, with Shift to extend.
 * A field of one value is edited in its cell, as in a spreadsheet: Enter, F2,
 * a double click or typing starts, Enter or Tab keeps, Escape drops.
 * */
export default function DataGrid({
  collection,
  collections,
  rowCount,
  rowAt,
  onRangeChange,
  resetKey,
  sort,
  onSortChange = undefined,
  readOnly = false,
  onEditCell,
  onEditObject,
  onDeleteRows,
  onViewValue,
  onSelectionChange = undefined,
  onExportRows = undefined,
  widths: savedWidths = undefined,
  onWidthsChange = undefined,
  empty = null,
  testId = 'data-grid',
}: DataGridProps) {
  const [t] = useTranslation();
  const cellTexts = useCellTexts();
  const { platform } = useMenuModel();
  const scrollRef = useRef<HTMLDivElement>(null);
  const columns = useMemo(() => columnsOf(collection), [collection]);
  const [widths, setWidths] = useState<Record<string, number>>(() => savedWidths ?? {});
  // The widths as of now, which the end of a drag hands on
  const widthsRef = useRef(widths);

  useEffect(() => {
    widthsRef.current = widths;
  }, [widths]);
  const [selection, setSelection] = useState<Ranges>(EMPTY);
  const [anchor, setAnchorState] = useState<number | null>(null);
  // The anchor as of now, for the listener on the window that a drag past the edge reaches
  const anchorRef = useRef<number | null>(null);
  const setAnchor = useCallback((next: number | null): void => {
    anchorRef.current = next;
    setAnchorState(next);
  }, []);
  const [active, setActive] = useState<Cell | null>(null);
  const [editing, setEditingState] = useState<EditingCell | null>(null);
  // What the editor holds as of now. A commit reads it here rather than from the
  // render it was made in, so the blur that follows a commit finds nothing left
  // to commit, and an edit is never kept twice.
  const editingRef = useRef(editing);
  const setEditing = useCallback((next: typeof editing): void => {
    editingRef.current = next;
    setEditingState(next);
  }, []);
  // Open lists and objects, by row, column and the path inside the value
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [menuCell, setMenuCell] = useState<Partial<Cell>>({});
  const dragging = useRef(false);

  const widthOf = (column: GridColumn): number => widths[column.name] ?? defaultWidth(column);
  const totalWidth = GUTTER_WIDTH + columns.reduce((sum, column) => sum + widthOf(column), 0);

  // A new filter, sort or collection is another list of rows
  useEffect(() => {
    setSelection(EMPTY);
    setAnchor(null);
    setActive(null);
    setEditing(null);
    setOpen(new Set());
    // Another list of rows starts at its top
    scrollRef.current?.scrollTo({ top: 0 });
  }, [resetKey, setEditing, setAnchor]);

  // Fewer rows than before, as after a delete, leave no selection past the end
  useEffect(() => {
    setSelection((current) => clamp(current, rowCount));
  }, [rowCount]);

  const selected = sizeOf(selection);

  useEffect(() => {
    onSelectionChange?.(selected);
  }, [selected, onSelectionChange]);

  // TanStack Virtual hands back functions that change from render to render,
  // which the React Compiler cannot memoize, so it leaves this component as it is
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    observeElementRect: observeShownRect,
    estimateSize: () => ROW_HEIGHT,
    // A row's height is read from what the resize observer reports, never from
    // the row as it is attached, which would lay the grid out once more for
    // each row coming into view. Until it reports, a row is as tall as before,
    // and so is a row in a tab behind another, which reports no height at all.
    measureElement: (element, entry, instance) => {
      const box = entry?.borderBoxSize[0];

      if (box && box.blockSize > 0) {
        return Math.round(box.blockSize);
      }

      const key = instance.options.getItemKey(instance.indexFromElement(element));

      return instance.itemSizeCache.get(key) ?? ROW_HEIGHT;
    },
    overscan: 12,
    paddingStart: HEADER_HEIGHT,
    scrollPaddingStart: HEADER_HEIGHT,
  });
  const items = virtualizer.getVirtualItems();

  // A collection with many fields draws the columns in view and a few on either side
  const windowed = columns.length > COLUMN_WINDOW_AT;
  const columnVirtualizer = useVirtualizer({
    horizontal: true,
    count: windowed ? columns.length : 0,
    getScrollElement: () => scrollRef.current,
    observeElementRect: observeShownRect,
    estimateSize: (index) => widthOf(columns[index]),
    overscan: 3,
    paddingStart: GUTTER_WIDTH,
  });

  // The widths it placed the columns by change as the user resizes one
  useEffect(() => {
    columnVirtualizer.measure();
  }, [columnVirtualizer, widths, columns]);

  const columnItems = windowed ? columnVirtualizer.getVirtualItems() : null;
  // The same list while the columns in view stay the same, which a row compares to draw again
  const shownColumns = useMemo<ShownColumn[]>(
    () =>
      columnItems
        ? columnItems.map((item) => ({ column: columns[item.index], col: item.index }))
        : columns.map((column, col) => ({ column, col })),
    [columnItems, columns],
  );
  // What the columns left out take up, so the rows keep their width and the shown ones their place
  const leftPad = columnItems && columnItems.length > 0 ? columnItems[0].start - GUTTER_WIDTH : 0;
  const rightPad =
    columnItems && columnItems.length > 0
      ? totalWidth - (columnItems.at(-1)?.end ?? totalWidth)
      : 0;
  const firstRow = items[0]?.index ?? 0;
  const lastRow = items.at(-1)?.index ?? 0;

  useEffect(() => {
    if (rowCount > 0) {
      onRangeChange(firstRow, lastRow);
    }
  }, [firstRow, lastRow, rowCount, onRangeChange]);

  const focusGrid = (): void => {
    scrollRef.current?.focus({ preventScroll: true });
  };

  /* Moves the active cell, and the selection with it unless `extend` keeps the anchor */
  const moveTo = (row: number, col: number, extend: boolean): void => {
    if (rowCount === 0) {
      return;
    }

    const nextRow = Math.min(Math.max(row, 0), rowCount - 1);
    const nextCol = Math.min(Math.max(col, 0), columns.length - 1);

    setActive({ row: nextRow, col: nextCol });

    if (extend && anchor !== null) {
      setSelection(between(anchor, nextRow));
    } else {
      setSelection(between(nextRow, nextRow));
      setAnchor(nextRow);
    }

    virtualizer.scrollToIndex(nextRow);

    // Bring the column into view, past the row numbers that stay on the left
    const scroller = scrollRef.current;

    if (scroller) {
      const left = GUTTER_WIDTH + columns.slice(0, nextCol).reduce((sum, c) => sum + widthOf(c), 0);
      const right = left + widthOf(columns[nextCol]);

      if (left - GUTTER_WIDTH < scroller.scrollLeft) {
        scroller.scrollLeft = left - GUTTER_WIDTH;
      } else if (right > scroller.scrollLeft + scroller.clientWidth) {
        scroller.scrollLeft = right - scroller.clientWidth;
      }
    }
  };

  const selectedRows = (limit = Number.POSITIVE_INFINITY): GridRow[] =>
    indexesOf(selection, limit).flatMap((index) => rowAt(index) ?? []);

  const canEditCell = (cell: Cell): boolean => {
    const row = rowAt(cell.row);

    return !readOnly && !!row && row.state !== 'deleted' && columns[cell.col].inline;
  };

  const startEditing = (cell: Cell, text?: string): void => {
    const row = rowAt(cell.row);
    const column = columns[cell.col];

    if (!row) {
      return;
    }

    if (!canEditCell(cell)) {
      // A list or an object opens in the value dialog instead
      if (!isScalarType(column.type)) {
        onViewValue(row, column);
      }

      return;
    }

    const value = row.values[column.name] ?? null;

    // A bool flips rather than being typed
    if (column.type.kind === 'bool' && text === undefined) {
      onEditCell(row, column.name, value === null ? true : !value);

      return;
    }

    setEditing({ ...cell, text: text ?? scalarText(value), error: null });
  };

  /* Keeps what the editor holds, if it reads as a value of the field; says why when it does not */
  const commitEditing = (): boolean => {
    const current = editingRef.current;

    if (!current) {
      return true;
    }

    const row = rowAt(current.row);
    const column = columns[current.col];
    const parsed = parseScalar(current.text, column.type, column.optional, collections);

    if (!parsed.ok) {
      setEditing({ ...current, error: parsed.error.message });

      return false;
    }

    if (row && !sameValue(row.values[column.name] ?? null, parsed.value)) {
      onEditCell(row, column.name, parsed.value);
    }

    setEditing(null);

    return true;
  };

  // What the editor of a cell does, as of this draw. The rows are handed the
  // actions below, which read it when they run, so they stay the same object
  // and a row that is not being edited is not drawn again for them.
  const editorActionsRef = useRef<CellEditorActions | null>(null);

  useLayoutEffect(() => {
    editorActionsRef.current = {
      onChange: (text) => {
        const current = editingRef.current;

        if (current) {
          setEditing({ ...current, text, error: null });
        }
      },
      onKeyDown: (event) => {
        const current = editingRef.current;

        event.stopPropagation();

        if (event.key === 'Enter' && commitEditing()) {
          focusGrid();
          event.preventDefault();
        } else if (event.key === 'Tab' && current && commitEditing()) {
          event.preventDefault();
          focusGrid();
          moveTo(current.row, current.col + (event.shiftKey ? -1 : 1), false);
        } else if (event.key === 'Escape') {
          setEditing(null);
          focusGrid();
        }
      },
      onBlur: () => {
        // A value that does not read is dropped rather than kept half typed
        if (!commitEditing()) {
          setEditing(null);
        }
      },
    };
  });

  const editor = useMemo<CellEditorActions>(
    () => ({
      onChange: (text) => editorActionsRef.current?.onChange(text),
      onKeyDown: (event) => editorActionsRef.current?.onKeyDown(event),
      onBlur: () => editorActionsRef.current?.onBlur(),
    }),
    [],
  );

  const copyRows = async (): Promise<void> => {
    const rows = selectedRows(COPY_LIMIT);

    if (rows.length > 0) {
      await navigator.clipboard.writeText(
        toJson(
          rows.map((row) => row.values),
          2,
        ),
      );
    }
  };

  // Copying, by its shortcut or from either menu, is the `copy` event, which
  // goes to the document when the focused element is not a field; while the
  // grid has the focus, the selected rows are what it copies
  const copyRowsRef = useRef<(event: ClipboardEvent) => void>(() => undefined);

  useEffect(() => {
    copyRowsRef.current = (event: ClipboardEvent): void => {
      const scroller = scrollRef.current;

      if (
        !scroller ||
        editingRef.current ||
        !scroller.contains(document.activeElement) ||
        !event.clipboardData
      ) {
        return;
      }

      const rows = selectedRows(COPY_LIMIT);

      if (rows.length === 0) {
        return;
      }

      event.clipboardData.setData(
        'text/plain',
        toJson(
          rows.map((row) => row.values),
          2,
        ),
      );
      event.preventDefault();
    };
  });

  useEffect(() => {
    const copy = (event: ClipboardEvent): void => copyRowsRef.current(event);

    document.addEventListener('copy', copy);

    return () => document.removeEventListener('copy', copy);
  }, []);

  const copyValue = async (cell: Cell): Promise<void> => {
    const value = rowAt(cell.row)?.values[columns[cell.col].name] ?? null;

    await navigator.clipboard.writeText(
      typeof value === 'string'
        ? value
        : isScalarType(columns[cell.col].type)
          ? scalarText(value)
          : toJson(value, 2),
    );
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    // The editor's own keys are handled by the editor
    if (editing) {
      return;
    }

    const cell = active ?? { row: 0, col: 0 };
    const extend = event.shiftKey;
    const mod = modKey(event);
    let handled = true;

    switch (event.key) {
      case 'ArrowDown':
        moveTo(mod ? rowCount - 1 : cell.row + 1, cell.col, extend);
        break;
      case 'ArrowUp':
        moveTo(mod ? 0 : cell.row - 1, cell.col, extend);
        break;
      case 'ArrowRight':
        moveTo(cell.row, mod ? columns.length - 1 : cell.col + 1, false);
        break;
      case 'ArrowLeft':
        moveTo(cell.row, mod ? 0 : cell.col - 1, false);
        break;
      case 'PageDown':
        moveTo(cell.row + PAGE_ROWS, cell.col, extend);
        break;
      case 'PageUp':
        moveTo(cell.row - PAGE_ROWS, cell.col, extend);
        break;
      case 'Home':
        moveTo(mod ? 0 : cell.row, mod ? cell.col : 0, extend && mod);
        break;
      case 'End':
        moveTo(mod ? rowCount - 1 : cell.row, mod ? cell.col : columns.length - 1, extend && mod);
        break;
      case 'Enter':
      case 'F2':
        if (active) {
          startEditing(active);
        }
        break;
      case 'Escape':
        setSelection(EMPTY);
        setAnchor(null);
        break;
      case 'Delete':
      case 'Backspace':
        if (!readOnly && selected > 0) {
          onDeleteRows(selectedRows().filter((row) => row.state !== 'deleted'));
        }
        break;
      case ' ':
        if (active && columns[active.col].type.kind === 'bool') {
          startEditing(active);
        } else {
          handled = false;
        }
        break;
      default:
        if (mod && event.key.toLowerCase() === 'a') {
          setSelection(rowCount > 0 ? between(0, rowCount - 1) : EMPTY);
        } else if (mod && event.key.toLowerCase() === 'e') {
          const row = active ? rowAt(active.row) : undefined;

          if (row && !readOnly && row.state !== 'deleted') {
            onEditObject(row);
          }
        } else if (
          active &&
          event.key.length === 1 &&
          !mod &&
          !event.altKey &&
          canEditCell(active) &&
          columns[active.col].type.kind !== 'bool'
        ) {
          // Typing over a cell starts editing it with what was typed
          startEditing(active, event.key);
        } else {
          handled = false;
        }
    }

    if (handled) {
      event.preventDefault();
    }
  };

  const handleMouseDown = (event: MouseEvent<HTMLDivElement>): void => {
    const { row, col } = cellAt(event.target);

    if (row === undefined || event.button !== 0) {
      return;
    }

    if (editingRef.current && !commitEditing()) {
      return;
    }

    focusGrid();
    setActive({ row, col: col ?? active?.col ?? 0 });

    if (event.shiftKey && anchor !== null) {
      setSelection(modKey(event) ? union(selection, between(anchor, row)) : between(anchor, row));
    } else if (modKey(event)) {
      setSelection(toggle(selection, row));
      setAnchor(row);
    } else {
      setSelection(between(row, row));
      setAnchor(row);
      dragging.current = true;
    }

    // Keeps the browser from selecting the text of the cells while dragging
    event.preventDefault();
  };

  // The row a drag last reached, so moving inside one row selects nothing again
  const dragRow = useRef<number | null>(null);

  const handleMouseMove = (event: MouseEvent<HTMLDivElement>): void => {
    if (!dragging.current || anchor === null) {
      return;
    }

    const { row } = cellAt(event.target);

    if (row !== undefined && row !== dragRow.current) {
      dragRow.current = row;
      setSelection(between(anchor, row));
      setActive((current) => (current ? { ...current, row } : current));
    }
  };

  useEffect(() => {
    const stop = (): void => {
      dragging.current = false;
      dragRow.current = null;
    };

    // A drag past the top or the bottom of the rows scrolls them, and selects
    // up to the row at that edge
    const scrollWhileDragging = (event: globalThis.MouseEvent): void => {
      const scroller = scrollRef.current;
      const from = anchorRef.current;

      if (!dragging.current || !scroller || from === null) {
        return;
      }

      const box = scroller.getBoundingClientRect();
      const top = box.top + HEADER_HEIGHT;
      let y = event.clientY;

      if (y > box.bottom - 4) {
        scroller.scrollTop += Math.min(ROW_HEIGHT * 2, y - box.bottom + 8);
        y = box.bottom - 6;
      } else if (y < top + 4) {
        scroller.scrollTop -= Math.min(ROW_HEIGHT * 2, top - y + 8);
        y = top + 6;
      } else {
        return;
      }

      const x = Math.min(Math.max(event.clientX, box.left + GUTTER_WIDTH + 2), box.right - 4);
      const { row } = cellAt(document.elementFromPoint(x, y));

      if (row !== undefined && row !== dragRow.current) {
        dragRow.current = row;
        setSelection(between(from, row));
        setActive((current) => (current ? { ...current, row } : current));
      }
    };

    window.addEventListener('mouseup', stop);
    window.addEventListener('mousemove', scrollWhileDragging);

    return () => {
      window.removeEventListener('mouseup', stop);
      window.removeEventListener('mousemove', scrollWhileDragging);
    };
  }, []);

  const handleContextMenu = (event: MouseEvent<HTMLDivElement>): void => {
    const cell = cellAt(event.target);

    setMenuCell(cell);

    // A right click on a row outside the selection selects that row
    if (cell.row !== undefined && !contains(selection, cell.row)) {
      setSelection(between(cell.row, cell.row));
      setAnchor(cell.row);
    }

    if (cell.row !== undefined) {
      setActive({ row: cell.row, col: cell.col ?? active?.col ?? 0 });
    }
  };

  const toggleOpen = useCallback((key: string): void => {
    setOpen((current) => {
      const next = new Set(current);

      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }

      return next;
    });
  }, []);

  const handleSort = (column: GridColumn, add: boolean): void => {
    if (!onSortChange || !column.sortable) {
      return;
    }

    const current = sort.find((key) => key.field === column.name);
    // Ascending, then descending, then not sorted by this column
    const next: SortKey | null = !current
      ? { field: column.name, descending: false }
      : !current.descending
        ? { field: column.name, descending: true }
        : null;
    const others = add ? sort.filter((key) => key.field !== column.name) : [];

    onSortChange(next ? [...others, next] : others);
  };

  const startResize = (event: PointerEvent<HTMLSpanElement>, column: GridColumn): void => {
    event.preventDefault();
    event.stopPropagation();

    const handle = event.currentTarget;
    const startX = event.clientX;
    const startWidth = widthOf(column);

    handle.setPointerCapture(event.pointerId);

    // Kept here as well: the last move and the release can come before the
    // grid draws again, which is when the widths it holds catch up
    let width = startWidth;

    const move = (moveEvent: globalThis.PointerEvent): void => {
      width = Math.min(
        MAX_COLUMN_WIDTH,
        Math.max(MIN_COLUMN_WIDTH, startWidth + moveEvent.clientX - startX),
      );

      const resized = width;

      setWidths((current) => ({ ...current, [column.name]: resized }));
    };
    const end = (): void => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);

      if (width !== startWidth) {
        onWidthsChange?.({ ...widthsRef.current, [column.name]: width });
      }
    };

    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  };

  const shortcut = (accelerator: string): string => acceleratorLabel(accelerator, platform);

  const menuRow = menuCell.row === undefined ? undefined : rowAt(menuCell.row);
  const menuColumn = menuCell.col === undefined ? undefined : columns[menuCell.col];
  const menuValue = menuRow && menuColumn ? (menuRow.values[menuColumn.name] ?? null) : null;
  const menuEditable = !readOnly && menuRow !== undefined && menuRow.state !== 'deleted';

  const menu = (
    <>
      {menuColumn && menuRow && (
        <PlMenuItem
          disabled={!canEditCell({ row: menuCell.row!, col: menuCell.col! })}
          shortcut="↩"
          onClick={() => startEditing({ row: menuCell.row!, col: menuCell.col! })}
        >
          {t('grid.edit-cell')}
        </PlMenuItem>
      )}
      <PlMenuItem
        disabled={!menuEditable}
        shortcut={shortcut('CmdOrCtrl+E')}
        onClick={() => menuRow && onEditObject(menuRow)}
      >
        {t('grid.edit-object')}
      </PlMenuItem>
      {menuColumn && menuRow && (
        <PlMenuItem onClick={() => onViewValue(menuRow, menuColumn)}>
          {t('grid.view-value')}
        </PlMenuItem>
      )}
      {menuColumn && menuRow && menuColumn.optional && !menuColumn.isKey && (
        <PlMenuItem
          disabled={!menuEditable || menuValue === null}
          onClick={() => onEditCell(menuRow, menuColumn.name, null)}
        >
          {t('grid.set-null')}
        </PlMenuItem>
      )}
      <PlMenuSeparator />
      {menuColumn && menuRow && (
        <PlMenuItem onClick={() => void copyValue({ row: menuCell.row!, col: menuCell.col! })}>
          {t('grid.copy-value')}
        </PlMenuItem>
      )}
      <PlMenuItem
        disabled={selected === 0}
        shortcut={shortcut('CmdOrCtrl+C')}
        onClick={() => void copyRows()}
      >
        {t('grid.copy-json', { count: selected })}
      </PlMenuItem>
      {onExportRows && (
        <PlMenuSubmenu
          label={t('grid.export-selected', { count: selected })}
          disabled={selected === 0}
        >
          {transferFormats.map((format) => (
            <PlMenuItem
              key={format}
              onClick={() => onExportRows(selectedRows(COPY_LIMIT), format, selected === rowCount)}
            >
              {t(`toolbar.export-${format}`)}
            </PlMenuItem>
          ))}
        </PlMenuSubmenu>
      )}
      {!readOnly && (
        <>
          <PlMenuSeparator />
          <PlMenuItem
            color="danger"
            disabled={selected === 0}
            shortcut="⌫"
            onClick={() => onDeleteRows(selectedRows().filter((row) => row.state !== 'deleted'))}
          >
            {t('grid.delete', { count: selected })}
          </PlMenuItem>
        </>
      )}
    </>
  );

  return (
    // The frame is outside the menu: a class given to `PlContextMenu` goes to
    // its popup, not to the element around the grid
    <div className="grid-frame">
      <PlContextMenu size="sm" content={menu}>
        <div
          ref={scrollRef}
          className="grid"
          data-testid={testId}
          role="grid"
          aria-rowcount={rowCount + 1}
          aria-colcount={columns.length + 1}
          aria-multiselectable="true"
          aria-label={collection.name}
          // A grid is one stop of the Tab key; the arrows move inside it
          tabIndex={0}
          onKeyDown={handleKeyDown}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onDoubleClick={(event) => {
            const { row, col } = cellAt(event.target);

            if (row !== undefined && col !== undefined) {
              startEditing({ row, col });
            }
          }}
          onContextMenu={handleContextMenu}
        >
          <div
            className="grid__canvas"
            style={{ width: totalWidth, height: virtualizer.getTotalSize() }}
          >
            <div
              className="grid__header"
              role="row"
              aria-rowindex={1}
              style={{ width: totalWidth }}
            >
              <div className="grid__corner" role="columnheader" style={{ width: GUTTER_WIDTH }}>
                #
              </div>
              <GridSpacer width={leftPad} />
              {shownColumns.map(({ column, col }) => {
                const sorted = sort.findIndex((key) => key.field === column.name);
                const sortKey = sort[sorted];

                return (
                  <div
                    key={column.name}
                    className="grid__head"
                    role="columnheader"
                    aria-colindex={col + 2}
                    aria-sort={
                      sortKey ? (sortKey.descending ? 'descending' : 'ascending') : undefined
                    }
                    title={`${column.name}: ${typeName(column.type)}${column.optional ? '?' : ''}`}
                    style={{ width: widthOf(column) }}
                  >
                    <button
                      type="button"
                      className="grid__head-button"
                      disabled={!column.sortable || !onSortChange}
                      // Sorting is the mouse's and the Enter key's; the grid keeps the focus
                      tabIndex={-1}
                      onClick={(event) => handleSort(column, event.shiftKey)}
                    >
                      {column.isKey && <KeyRound className="grid__head-icon" aria-hidden="true" />}
                      {!column.isKey && column.index && (
                        <Zap
                          className="grid__head-icon grid__head-icon--index"
                          aria-hidden="true"
                        />
                      )}
                      <span className="grid__head-name">{column.name}</span>
                      <span className="grid__head-type">
                        {typeName(column.type)}
                        {column.optional ? '?' : ''}
                      </span>
                      {sortKey && (
                        <span className="grid__sort">
                          {sortKey.descending ? (
                            <ArrowDown aria-hidden="true" />
                          ) : (
                            <ArrowUp aria-hidden="true" />
                          )}
                          {sort.length > 1 ? sorted + 1 : ''}
                        </span>
                      )}
                    </button>
                    <span
                      className="grid__resize"
                      aria-hidden="true"
                      onPointerDown={(event) => startResize(event, column)}
                      onClick={(event) => event.stopPropagation()}
                      onDoubleClick={(event) => {
                        event.stopPropagation();
                        const { [column.name]: _reset, ...rest } = widths;

                        setWidths(rest);
                        onWidthsChange?.(rest);
                      }}
                    />
                  </div>
                );
              })}
              <GridSpacer width={rightPad} />
            </div>
            {items.map((item) => (
              <GridRowView
                key={item.key}
                index={item.index}
                start={item.start}
                row={rowAt(item.index)}
                columns={shownColumns}
                widths={widths}
                width={totalWidth}
                leftPad={leftPad}
                rightPad={rightPad}
                selected={contains(selection, item.index)}
                activeCol={active?.row === item.index ? active.col : null}
                editing={editing?.row === item.index ? editing : null}
                open={open}
                texts={cellTexts}
                editor={editor}
                onToggle={toggleOpen}
                measure={virtualizer.measureElement}
              />
            ))}
          </div>
          {rowCount === 0 && <div className="grid__empty">{empty}</div>}
        </div>
      </PlContextMenu>
    </div>
  );
}

export { ScalarValue };
