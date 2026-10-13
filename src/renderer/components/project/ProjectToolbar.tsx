import { useTranslation } from 'react-i18next';
import { Check, Download, Plus, RefreshCw, Search, Undo2, Upload, Wrench } from 'lucide-react';
import { PlButton, PlMenu, PlMenuItem, PlToolbar, usePlConfirm } from 'plass-ui';
import ImportProblemsDialog from '@/renderer/components/project/ImportProblemsDialog';
import useTransfer from '@/renderer/components/project/useTransfer';
import { useMenuModel } from '@/renderer/components/menu/MenuModelContext';
import useEditTexts from '@/renderer/components/project/useEditTexts';
import {
  openQuery,
  openTools,
  pendingChanged,
  refreshProject,
  statusChanged,
  submitPending,
  type WorkspaceTab,
} from '@/renderer/store/slices/projectSlice';
import { useAppDispatch, useAppSelector } from '@/renderer/store/hooks';
import { acceleratorLabel } from '@/common/menu';
import { importModes, type ExportSource } from '@/common/data';
import { transferFormats } from '@/common/transfer';

interface ProjectToolbarProps {
  /*
   * The tab in front: its collection is where a new object, a new query and an
   * import go, and what it shows is what an export writes
   * */
  tab: WorkspaceTab | null;
  onAddObject: (collection: string) => void;
}

/* Asks before the held edits are dropped, and drops them */
export const useDiscard = () => {
  const [t] = useTranslation();
  const dispatch = useAppDispatch();
  const confirm = usePlConfirm();
  const pending = useAppSelector((state) => state.project.pending);

  return async (): Promise<boolean> => {
    if (pending.length === 0) {
      return true;
    }

    const confirmed = await confirm.confirm({
      title: t('toolbar.discard-title', { count: pending.length }),
      description: t('toolbar.discard-text'),
      confirmLabel: t('toolbar.discard'),
      color: 'danger',
      initialFocus: 'cancel',
    });

    if (confirmed) {
      dispatch(pendingChanged([]));
      dispatch(statusChanged({ text: t('status.discarded'), tone: 'info' }));
    }

    return confirmed;
  };
};

/*
 * The project's buttons: reading everything again, a new query, a new object
 * in the collection in front, and the tools. While edits are held for a
 * submit, it offers to submit or discard them, with how many there are.
 * */
export default function ProjectToolbar({ tab, onAddObject }: ProjectToolbarProps) {
  const [t] = useTranslation();
  const dispatch = useAppDispatch();
  const texts = useEditTexts();
  const discard = useDiscard();
  const { platform } = useMenuModel();
  const pending = useAppSelector((state) => state.project.pending);
  const editMode = useAppSelector((state) => state.settings.editMode);
  const shortcut = (accelerator: string): string => acceleratorLabel(accelerator, platform);
  const transfer = useTransfer();
  const collection = tab?.collection ?? null;
  // A collection tab exports what it shows, and a query tab what its query finds
  const exportSource: ExportSource | null =
    tab?.kind === 'collection'
      ? { kind: 'view', filter: tab.filter, sort: tab.sort }
      : tab?.kind === 'query' && tab.text.trim() !== ''
        ? { kind: 'query', text: tab.text }
        : null;

  return (
    <>
      <PlToolbar
        className="project-toolbar"
        size="sm"
        density="compact"
        variant="ghost"
        divider
        start={
          <>
            <PlButton
              size="sm"
              variant="ghost"
              startIcon={<RefreshCw />}
              title={shortcut('F5')}
              onClick={() => void dispatch(refreshProject())}
            >
              {t('toolbar.refresh')}
            </PlButton>
            <PlButton
              data-testid="btn-new-query"
              size="sm"
              variant="ghost"
              startIcon={<Search />}
              title={shortcut('CmdOrCtrl+T')}
              onClick={() => dispatch(openQuery({ collection }))}
            >
              {t('toolbar.new-query')}
            </PlButton>
            <PlButton
              data-testid="btn-add-object"
              size="sm"
              variant="ghost"
              startIcon={<Plus />}
              disabled={collection === null}
              onClick={() => collection && onAddObject(collection)}
            >
              {t('toolbar.add-object')}
            </PlButton>
            <PlMenu
              size="sm"
              disabled={collection === null || exportSource === null || transfer.busy}
              trigger={
                <PlButton
                  data-testid="btn-export"
                  size="sm"
                  variant="ghost"
                  startIcon={<Download />}
                  disabled={collection === null || exportSource === null}
                >
                  {t('toolbar.export')}
                </PlButton>
              }
            >
              {transferFormats.map((format) => (
                <PlMenuItem
                  key={format}
                  onClick={() =>
                    collection &&
                    exportSource &&
                    void transfer.exportObjects(collection, format, exportSource)
                  }
                >
                  {t(`toolbar.export-${format}`)}
                </PlMenuItem>
              ))}
            </PlMenu>
            <PlMenu
              size="sm"
              disabled={tab?.kind !== 'collection' || transfer.busy}
              trigger={
                <PlButton
                  data-testid="btn-import"
                  size="sm"
                  variant="ghost"
                  startIcon={<Upload />}
                  disabled={tab?.kind !== 'collection'}
                >
                  {t('toolbar.import')}
                </PlButton>
              }
            >
              {importModes.map((mode) => (
                <PlMenuItem
                  key={mode}
                  description={t(`toolbar.import-${mode}-text`)}
                  onClick={() => collection && void transfer.importObjects(collection, mode)}
                >
                  {t(`toolbar.import-${mode}`)}
                </PlMenuItem>
              ))}
            </PlMenu>
            {(editMode === 'submit' || pending.length > 0) && (
              <span className="project-toolbar__changes">
                <PlButton
                  data-testid="btn-submit"
                  size="sm"
                  color="primary"
                  variant={pending.length > 0 ? 'solid' : 'ghost'}
                  startIcon={<Check />}
                  disabled={pending.length === 0}
                  title={shortcut('CmdOrCtrl+S')}
                  onClick={() =>
                    void dispatch(submitPending(texts.submit(pending.length), texts.failed))
                  }
                >
                  {t('toolbar.submit', { count: pending.length })}
                </PlButton>
                <PlButton
                  data-testid="btn-discard"
                  size="sm"
                  variant="ghost"
                  startIcon={<Undo2 />}
                  disabled={pending.length === 0}
                  onClick={() => void discard()}
                >
                  {t('toolbar.discard')}
                </PlButton>
              </span>
            )}
          </>
        }
        end={
          <PlButton
            data-testid="btn-tools"
            size="sm"
            variant="ghost"
            startIcon={<Wrench />}
            onClick={() => dispatch(openTools())}
          >
            {t('toolbar.tools')}
          </PlButton>
        }
      />
      {transfer.refused && (
        <ImportProblemsDialog refused={transfer.refused} onClose={transfer.dismissRefused} />
      )}
    </>
  );
}
