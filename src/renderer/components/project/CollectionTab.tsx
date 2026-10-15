import { useCallback, useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ListFilter, X } from 'lucide-react';
import { PlButton, PlEmpty, PlIconButton, PlTextField, usePlConfirm } from 'plass-ui';
import DataGrid, { type GridRow } from '@/renderer/components/grid/DataGrid';
import ObjectDialog from '@/renderer/components/grid/ObjectDialog';
import ValueDialog from '@/renderer/components/grid/ValueDialog';
import type { GridColumn } from '@/renderer/components/grid/columns';
import useEditTexts from '@/renderer/components/project/useEditTexts';
import useTransfer from '@/renderer/components/project/useTransfer';
import { keysOf, rowMaker } from '@/renderer/project/gridRows';
import { viewOf } from '@/renderer/project/pending';
import usePagedRows from '@/renderer/project/usePagedRows';
import { keyLabel } from '@/common/values';
import {
  deleteObjects,
  editObject,
  selectionChanged,
  updateTab,
  type WorkspaceTab,
} from '@/renderer/store/slices/projectSlice';
import { useAppDispatch, useAppSelector } from '@/renderer/store/hooks';
import type { Key, SchemaCollection, SortKey } from '@/common/data';

type TabDialog =
  { kind: 'edit'; row: GridRow } | { kind: 'view'; row: GridRow; column: GridColumn } | null;

/* How a dialog names an object: by its key, or as a new one */
const titleOf = (collection: SchemaCollection, row: GridRow, newLabel: string): string =>
  'key' in row.target ? `${collection.name} ${keyLabel(row.target.key as Key)}` : newLabel;

/*
 * One collection in a tab: a filter over the grid of its objects. Edits to
 * the grid go through the project's thunks, which write them at once or hold
 * them for a submit, and the objects held to be inserted come first.
 * */
export default function CollectionTab({ tab, active }: { tab: WorkspaceTab; active: boolean }) {
  const [t] = useTranslation();
  const dispatch = useAppDispatch();
  const confirm = usePlConfirm();
  const texts = useEditTexts();
  const transfer = useTransfer();
  const collections = useAppSelector((state) => state.project.session?.schema?.collections ?? []);
  const revision = useAppSelector((state) => state.project.revision);
  const pending = useAppSelector((state) => state.project.pending);
  const editMode = useAppSelector((state) => state.settings.editMode);
  const collection = collections.find((each) => each.name === tab.collection);
  const [filterText, setFilterText] = useState(tab.filter);
  const [dialog, setDialog] = useState<TabDialog>(null);

  const paged = usePagedRows(
    collection
      ? { collection: collection.name, filter: tab.filter, sort: tab.sort, revision }
      : null,
  );
  const view = useMemo(() => viewOf(pending, collection?.name ?? ''), [pending, collection]);
  const held = view.inserted.length;
  const rowCount = held + (paged.total ?? 0);
  const { rowAt: pagedRowAt, load } = paged;

  const made = useMemo(() => (collection ? rowMaker(collection, view) : null), [collection, view]);

  const rowAt = useCallback(
    (index: number): GridRow | undefined => {
      if (index < held) {
        return made?.inserted(view.inserted[index]);
      }

      const row = pagedRowAt(index - held);

      return row && made ? made.saved(row) : undefined;
    },
    [held, view, pagedRowAt, made],
  );

  const handleRangeChange = useCallback(
    (start: number, end: number) => load(start - held, end - held),
    [load, held],
  );

  const handleSelection = useCallback(
    (count: number) => {
      if (active) {
        dispatch(selectionChanged({ count, total: rowCount }));
      }
    },
    [active, dispatch, rowCount],
  );

  if (!collection) {
    return (
      <PlEmpty
        className="tab-empty"
        title={t('workspace.collection-gone', { name: tab.collection ?? '' })}
      />
    );
  }

  const applyFilter = (event: FormEvent): void => {
    event.preventDefault();
    dispatch(updateTab({ tabId: tab.id, changes: { filter: filterText.trim() } }));
  };

  const clearFilter = (): void => {
    setFilterText('');
    dispatch(updateTab({ tabId: tab.id, changes: { filter: '' } }));
  };

  const handleDelete = async (rows: GridRow[]): Promise<void> => {
    if (rows.length === 0) {
      return;
    }

    const confirmed = await confirm.confirm({
      title: t('grid.delete-title', { count: rows.length }),
      description: editMode === 'submit' ? t('grid.delete-held') : t('grid.delete-now'),
      confirmLabel: t('grid.delete-confirm'),
      color: 'danger',
      initialFocus: 'cancel',
    });

    if (confirmed) {
      await dispatch(
        deleteObjects(
          collection.name,
          rows.map((row) => row.target),
          texts.remove(rows.length),
        ),
      );
    }
  };

  return (
    <div className="collection-tab" data-testid="collection-tab">
      <form className="filter-bar" onSubmit={applyFilter}>
        <PlTextField
          data-testid="filter-input"
          className="filter-bar__field"
          size="sm"
          fullWidth
          aria-label={t('workspace.filter')}
          placeholder={t('workspace.filter-placeholder')}
          startIcon={<ListFilter />}
          value={filterText}
          spellCheck={false}
          invalid={paged.error !== null}
          onChange={(event) => setFilterText(event.target.value)}
        />
        {tab.filter !== '' && (
          <PlIconButton
            size="sm"
            variant="ghost"
            label={t('workspace.clear-filter')}
            icon={<X />}
            onClick={clearFilter}
          />
        )}
        <PlButton data-testid="btn-apply-filter" type="submit" size="sm" variant="glass">
          {t('workspace.apply-filter')}
        </PlButton>
        <span className="filter-bar__count" data-testid="object-count">
          {paged.total === null
            ? t('workspace.counting')
            : t('workspace.objects', { count: paged.total })}
        </span>
      </form>
      {paged.error && (
        <p className="filter-bar__error" role="alert" data-testid="filter-error">
          {paged.error}
        </p>
      )}
      <DataGrid
        collection={collection}
        collections={collections}
        rowCount={rowCount}
        rowAt={rowAt}
        onRangeChange={handleRangeChange}
        resetKey={`${collection.name}\u0000${tab.filter}\u0000${JSON.stringify(tab.sort)}`}
        sort={tab.sort}
        onSortChange={(sort: SortKey[]) =>
          dispatch(updateTab({ tabId: tab.id, changes: { sort } }))
        }
        onEditCell={(row, field, value) =>
          void dispatch(editObject(collection.name, row.target, { [field]: value }, texts.edit))
        }
        onEditObject={(row) => setDialog({ kind: 'edit', row })}
        onDeleteRows={(rows) => void handleDelete(rows)}
        onViewValue={(row, column) => setDialog({ kind: 'view', row, column })}
        onSelectionChange={handleSelection}
        widths={tab.widths}
        onWidthsChange={(widths) => dispatch(updateTab({ tabId: tab.id, changes: { widths } }))}
        onExportRows={(rows, format, everything) =>
          void transfer.exportObjects(
            collection.name,
            format,
            everything
              ? { kind: 'view', filter: tab.filter, sort: tab.sort }
              : { kind: 'keys', keys: keysOf(rows) },
          )
        }
        empty={
          paged.total === null
            ? null
            : tab.filter
              ? t('workspace.no-match')
              : t('workspace.no-objects')
        }
      />
      {dialog?.kind === 'edit' && (
        <ObjectDialog
          collection={collection}
          collections={collections}
          row={dialog.row}
          onClose={() => setDialog(null)}
          onSubmit={(values) =>
            dispatch(editObject(collection.name, dialog.row.target, values, texts.edit))
          }
        />
      )}
      {dialog?.kind === 'view' && (
        <ValueDialog
          title={`${titleOf(collection, dialog.row, t('grid.new-object'))} · ${dialog.column.name}`}
          value={dialog.row.values[dialog.column.name] ?? null}
          type={dialog.column.type}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
