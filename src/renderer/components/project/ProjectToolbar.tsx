import { useTranslation } from 'react-i18next';
import { Check, Plus, RefreshCw, Search, Undo2, Wrench } from 'lucide-react';
import { PlButton, PlToolbar, usePlConfirm } from 'plass-ui';
import { useMenuModel } from '@/renderer/components/menu/MenuModelContext';
import useEditTexts from '@/renderer/components/project/useEditTexts';
import {
  openQuery,
  openTools,
  pendingChanged,
  refreshProject,
  statusChanged,
  submitPending,
} from '@/renderer/store/slices/projectSlice';
import { useAppDispatch, useAppSelector } from '@/renderer/store/hooks';
import { acceleratorLabel } from '@/common/menu';

interface ProjectToolbarProps {
  /* The collection of the tab in front, which the new object and the new query go to */
  collection: string | null;
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
export default function ProjectToolbar({ collection, onAddObject }: ProjectToolbarProps) {
  const [t] = useTranslation();
  const dispatch = useAppDispatch();
  const texts = useEditTexts();
  const discard = useDiscard();
  const { platform } = useMenuModel();
  const pending = useAppSelector((state) => state.project.pending);
  const editMode = useAppSelector((state) => state.settings.editMode);
  const shortcut = (accelerator: string): string => acceleratorLabel(accelerator, platform);

  return (
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
  );
}
