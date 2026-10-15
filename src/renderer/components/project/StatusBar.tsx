import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Lock, LockOpen } from 'lucide-react';
import { formatBytes, splitPath } from '@/renderer/format';
import { useAppSelector } from '@/renderer/store/hooks';

/*
 * The line along the bottom of the project screen: the file, what the grid in
 * front has selected, the edits held for a submit, and what the last action
 * did. The message is a live region, so a screen reader hears it.
 * */
function StatusBar() {
  const [t, i18n] = useTranslation();
  const database = useAppSelector((state) => state.project.session?.database);
  const selection = useAppSelector((state) => state.project.selection);
  const pending = useAppSelector((state) => state.project.pending.length);
  const status = useAppSelector((state) => state.project.status);
  const editMode = useAppSelector((state) => state.settings.editMode);
  const language = i18n.resolvedLanguage ?? 'en';
  const number = (value: number): string => new Intl.NumberFormat(language).format(value);

  return (
    <footer className="status-bar" data-testid="status-bar">
      {database && (
        <span className="status-bar__file" title={database.path}>
          {database.encrypted ? (
            <Lock aria-label={t('project.encrypted')} />
          ) : (
            <LockOpen aria-label={t('project.not-encrypted')} />
          )}
          {splitPath(database.path).name}
          <span className="status-bar__muted">
            {t('status.format', { version: database.formatVersion })} ·{' '}
            {formatBytes(database.fileSize, language)}
          </span>
        </span>
      )}
      {selection && (
        <span className="status-bar__selection" data-testid="status-selection">
          {t('status.selection', { count: selection.count, total: number(selection.total) })}
        </span>
      )}
      <span
        className={`status-bar__message status-bar__message--${status?.tone ?? 'info'}`}
        role="status"
        data-testid="status-message"
      >
        {status?.text ?? ''}
      </span>
      <span className="status-bar__mode" data-testid="status-pending">
        {editMode === 'submit' || pending > 0
          ? t('status.pending', { count: pending })
          : t('status.immediate')}
      </span>
    </footer>
  );
}

// It reads what it shows from the store, and its parent draws again for the tab in front
export default memo(StatusBar);
