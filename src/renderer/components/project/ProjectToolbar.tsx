import { useTranslation } from 'react-i18next';
import { Check, Database, Plus, RefreshCw, Search, Undo2, Wrench } from 'lucide-react';
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
  /* The name of the project, which the bar starts with */
  projectName: string;
  /* The collection of the tab in front, where a new object and a new query go */
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
 * The project's bar: its name, then its buttons, reading everything again, a
 * new query, a new object in the collection in front, and the tools. While
 * edits are held for a submit, a group of its own offers to submit or discard
 * them, with how many there are. Exporting and importing are in the Database
 * menu.
 *
 * In a narrow window the buttons drop their words and keep their icons, whose
 * names a screen reader still reads, and what still does not fit scrolls
 * rather than being cut off, see `.project-toolbar` in `project.css`.
 * */
export default function ProjectToolbar({
  projectName,
  collection,
  onAddObject,
}: ProjectToolbarProps) {
  const [t] = useTranslation();
  const dispatch = useAppDispatch();
  const texts = useEditTexts();
  const discard = useDiscard();
  const { platform } = useMenuModel();
  const pending = useAppSelector((state) => state.project.pending);
  const editMode = useAppSelector((state) => state.settings.editMode);
  // A button's name and its shortcut, as its tooltip, which is all a button without words shows
  const tip = (label: string, accelerator?: string): string =>
    accelerator ? `${label} (${acceleratorLabel(accelerator, platform)})` : label;
  const label = (text: string) => <span className="project-toolbar__label">{text}</span>;

  return (
    <PlToolbar
      className="project-toolbar"
      size="sm"
      density="compact"
      variant="ghost"
      divider
      end={
        <PlButton
          data-testid="btn-tools"
          size="xs"
          variant="ghost"
          startIcon={<Wrench />}
          title={t('toolbar.tools')}
          onClick={() => dispatch(openTools())}
        >
          {label(t('toolbar.tools'))}
        </PlButton>
      }
    >
      <div className="project-toolbar__main">
        <span
          className="project-toolbar__project"
          data-testid="toolbar-project"
          title={projectName}
        >
          <Database aria-hidden="true" />
          <span className="project-toolbar__project-name">{projectName}</span>
        </span>
        <span className="project-toolbar__buttons">
          <PlButton
            size="xs"
            variant="ghost"
            startIcon={<RefreshCw />}
            title={tip(t('toolbar.refresh'), 'F5')}
            onClick={() => void dispatch(refreshProject())}
          >
            {label(t('toolbar.refresh'))}
          </PlButton>
          <PlButton
            data-testid="btn-new-query"
            size="xs"
            variant="ghost"
            startIcon={<Search />}
            title={tip(t('toolbar.new-query'), 'CmdOrCtrl+T')}
            onClick={() => dispatch(openQuery({ collection }))}
          >
            {label(t('toolbar.new-query'))}
          </PlButton>
          <PlButton
            data-testid="btn-add-object"
            size="xs"
            variant="ghost"
            startIcon={<Plus />}
            title={t('toolbar.add-object')}
            disabled={collection === null}
            onClick={() => collection && onAddObject(collection)}
          >
            {label(t('toolbar.add-object'))}
          </PlButton>
        </span>
        {(editMode === 'submit' || pending.length > 0) && (
          <span
            className={`project-toolbar__changes${pending.length > 0 ? ' project-toolbar__changes--held' : ''}`}
            data-testid="pending-changes"
          >
            <PlButton
              data-testid="btn-submit"
              className="project-toolbar__submit"
              size="xs"
              color="primary"
              variant={pending.length > 0 ? 'solid' : 'ghost'}
              startIcon={<Check />}
              disabled={pending.length === 0}
              title={tip(t('toolbar.submit', { count: pending.length }), 'CmdOrCtrl+S')}
              onClick={() =>
                void dispatch(submitPending(texts.submit(pending.length), texts.failed))
              }
            >
              {t('toolbar.submit', { count: pending.length })}
            </PlButton>
            <PlButton
              data-testid="btn-discard"
              size="xs"
              color="danger"
              variant="ghost"
              startIcon={<Undo2 />}
              title={t('toolbar.discard')}
              disabled={pending.length === 0}
              onClick={() => void discard()}
            >
              {label(t('toolbar.discard'))}
            </PlButton>
          </span>
        )}
      </div>
    </PlToolbar>
  );
}
