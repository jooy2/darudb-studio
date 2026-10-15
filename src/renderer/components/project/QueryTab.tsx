import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Play } from 'lucide-react';
import { PlAlert, PlButton, PlSelect, PlTextField, usePlConfirm } from 'plass-ui';
import DataGrid, { type GridRow } from '@/renderer/components/grid/DataGrid';
import ObjectDialog from '@/renderer/components/grid/ObjectDialog';
import ValueDialog from '@/renderer/components/grid/ValueDialog';
import type { GridColumn } from '@/renderer/components/grid/columns';
import { useMenuModel } from '@/renderer/components/menu/MenuModelContext';
import useEditTexts from '@/renderer/components/project/useEditTexts';
import useTransfer from '@/renderer/components/project/useTransfer';
import { keysOf, rowMaker } from '@/renderer/project/gridRows';
import { viewOf } from '@/renderer/project/pending';
import {
  deleteObjects,
  editObject,
  selectionChanged,
  updateTab,
  type WorkspaceTab,
} from '@/renderer/store/slices/projectSlice';
import { useAppDispatch, useAppSelector } from '@/renderer/store/hooks';
import { acceleratorLabel } from '@/common/menu';
import { mainChannels } from '@/common/ipc';
import type { QueryRequest, QueryResult } from '@/common/data';

type TabDialog =
  { kind: 'edit'; row: GridRow } | { kind: 'view'; row: GridRow; column: GridColumn } | null;

/*
 * A query in the query language, written whole, with its sort and its limit,
 * and the objects it finds in a grid that edits them as a collection tab does.
 * A query that ran is run again after every write, so its results stay true.
 * */
export default function QueryTab({ tab, active }: { tab: WorkspaceTab; active: boolean }) {
  const [t, i18n] = useTranslation();
  const dispatch = useAppDispatch();
  const confirm = usePlConfirm();
  const texts = useEditTexts();
  const transfer = useTransfer();
  const { platform } = useMenuModel();
  const collections = useAppSelector((state) => state.project.session?.schema?.collections ?? []);
  const revision = useAppSelector((state) => state.project.revision);
  const pending = useAppSelector((state) => state.project.pending);
  const editMode = useAppSelector((state) => state.settings.editMode);
  const [text, setText] = useState(tab.text);
  // The query the user ran, and a number raised by every run of it, so the same text runs again
  // A restored tab whose query had run starts by running it again
  const [ran, setRan] = useState<{ request: QueryRequest; serial: number } | null>(() =>
    tab.ran && tab.collection
      ? { request: { collection: tab.collection, text: tab.text }, serial: 1 }
      : null,
  );
  const [answer, setAnswer] = useState<{ key: string; result: QueryResult } | null>(null);
  const [dialog, setDialog] = useState<TabDialog>(null);
  // A write raises the revision, which runs the query again, so its results stay true
  const runKey = ran ? `${ran.serial}\u0000${revision}` : null;
  const running = runKey !== null && answer?.key !== runKey;
  const result = answer?.result ?? null;
  const collection = collections.find((each) => each.name === ran?.request.collection);
  const rows = result?.status === 'ok' ? result.rows : [];
  const view = useMemo(() => viewOf(pending, collection?.name ?? ''), [pending, collection]);
  const language = i18n.resolvedLanguage ?? 'en';

  useEffect(() => {
    if (!ran || runKey === null) {
      return undefined;
    }

    let current = true;

    void window.mainApi.invoke(mainChannels.runQuery, ran.request).then((found) => {
      if (current) {
        setAnswer({ key: runKey, result: found });
      }
    });

    return () => {
      current = false;
    };
  }, [ran, runKey]);

  const runText = (): void => {
    if (!tab.collection) {
      return;
    }

    dispatch(updateTab({ tabId: tab.id, changes: { text, ran: true } }));
    setRan((last) => ({
      request: { collection: tab.collection!, text },
      serial: (last?.serial ?? 0) + 1,
    }));
  };

  const made = useMemo(() => (collection ? rowMaker(collection, view) : null), [collection, view]);

  const rowAt = useCallback(
    (index: number): GridRow | undefined =>
      made && rows[index] ? made.saved(rows[index]) : undefined,
    [made, rows],
  );

  const handleSelection = useCallback(
    (count: number) => {
      if (active) {
        dispatch(selectionChanged({ count, total: rows.length }));
      }
    },
    [active, dispatch, rows.length],
  );

  const handleDelete = async (targets: GridRow[]): Promise<void> => {
    if (!collection || targets.length === 0) {
      return;
    }

    const confirmed = await confirm.confirm({
      title: t('grid.delete-title', { count: targets.length }),
      description: editMode === 'submit' ? t('grid.delete-held') : t('grid.delete-now'),
      confirmLabel: t('grid.delete-confirm'),
      color: 'danger',
      initialFocus: 'cancel',
    });

    if (confirmed) {
      await dispatch(
        deleteObjects(
          collection.name,
          targets.map((row) => row.target),
          texts.remove(targets.length),
        ),
      );
    }
  };

  const summary = (() => {
    if (!result) {
      return t('query.not-run');
    }

    if (result.status === 'ok') {
      return t('query.found', {
        count: result.rows.length,
        time: new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(
          result.elapsedMs,
        ),
      });
    }

    return null;
  })();

  return (
    <div className="query-tab" data-testid="query-tab">
      <div className="query-editor">
        <div className="query-editor__bar">
          <div className="query-editor__collection" data-testid="query-collection">
            <PlSelect
              size="sm"
              fullWidth
              label={t('query.collection')}
              labelPlacement="float"
              items={collections.map(({ name }) => ({ value: name, label: name }))}
              value={tab.collection}
              onValueChange={(value) => {
                if (typeof value === 'string') {
                  dispatch(updateTab({ tabId: tab.id, changes: { collection: value } }));
                }
              }}
            />
          </div>
          <span className="query-editor__summary" data-testid="query-summary">
            {summary}
          </span>
          <PlButton
            data-testid="btn-run-query"
            size="sm"
            startIcon={<Play />}
            loading={running}
            disabled={!tab.collection}
            title={acceleratorLabel('CmdOrCtrl+Enter', platform)}
            onClick={runText}
          >
            {t('query.run')}
          </PlButton>
        </div>
        <PlTextField
          data-testid="query-text"
          className="query-editor__text"
          fullWidth
          multiline
          rows={3}
          resize="vertical"
          aria-label={t('query.text')}
          placeholder={t('query.placeholder')}
          value={text}
          spellCheck={false}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              runText();
            }
          }}
        />
        {result?.status === 'error' && (
          <PlAlert color="danger" variant="glass" size="sm" data-testid="query-error">
            {result.message}
          </PlAlert>
        )}
        {result?.status === 'too-many' && (
          <PlAlert color="warning" variant="glass" size="sm" data-testid="query-too-many">
            {t('query.too-many', {
              count: new Intl.NumberFormat(language).format(result.count),
              limit: new Intl.NumberFormat(language).format(result.limit),
            })}
          </PlAlert>
        )}
      </div>
      {collection && result?.status === 'ok' && (
        <DataGrid
          collection={collection}
          collections={collections}
          rowCount={rows.length}
          rowAt={rowAt}
          onRangeChange={() => undefined}
          resetKey={`${ran?.request.collection}\u0000${ran?.request.text}`}
          sort={[]}
          onEditCell={(row, field, value) =>
            void dispatch(editObject(collection.name, row.target, { [field]: value }, texts.edit))
          }
          onEditObject={(row) => setDialog({ kind: 'edit', row })}
          onDeleteRows={(targets) => void handleDelete(targets)}
          onViewValue={(row, column) => setDialog({ kind: 'view', row, column })}
          onSelectionChange={handleSelection}
          widths={tab.widths}
          onWidthsChange={(widths) => dispatch(updateTab({ tabId: tab.id, changes: { widths } }))}
          onExportRows={(selectedRows, format, everything) =>
            ran &&
            void transfer.exportObjects(
              collection.name,
              format,
              everything
                ? { kind: 'query', text: ran.request.text }
                : { kind: 'keys', keys: keysOf(selectedRows) },
            )
          }
          empty={t('query.none')}
          testId="query-grid"
        />
      )}
      {collection && dialog?.kind === 'edit' && (
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
      {collection && dialog?.kind === 'view' && (
        <ValueDialog
          title={dialog.column.name}
          value={dialog.row.values[dialog.column.name] ?? null}
          type={dialog.column.type}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
