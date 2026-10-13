import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CopyCheck, FileExclamationPoint, FileX, LockKeyhole, CircleArrowUp } from 'lucide-react';
import { PlAlert, PlButton, PlCheckbox, PlModal, PlTextField } from 'plass-ui';
import type { OpenQuestion } from '@/renderer/hooks/useOpenProject';
import { mainChannels } from '@/common/ipc';
import type { Project, UpgradeChoice } from '@/common/projects';

interface OpenDialogsProps {
  question: OpenQuestion | null;
  busy: boolean;
  onDismiss: () => void;
  onPassword: (project: Project, password: string, remember: boolean) => void;
  onUpgrade: (question: Extract<OpenQuestion, { kind: 'upgrade' }>, upgrade: UpgradeChoice) => void;
  onDelete: (project: Project) => void;
  onRescue: (project: Project) => void;
  /* Opens the project a rescue added */
  onOpen: (project: Project) => void;
}

const closeWith =
  (onDismiss: () => void) =>
  (open: boolean): void => {
    if (!open) {
      onDismiss();
    }
  };

function PasswordDialog({
  question,
  busy,
  onDismiss,
  onPassword,
}: {
  question: Extract<OpenQuestion, { kind: 'password' }>;
  busy: boolean;
  onDismiss: () => void;
  onPassword: OpenDialogsProps['onPassword'];
}) {
  const [t] = useTranslation();
  const formId = useId();
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [canRemember, setCanRemember] = useState(false);
  const { project, wrong } = question;

  useEffect(() => {
    void window.mainApi.invoke(mainChannels.canRememberPasswords).then(setCanRemember);
  }, []);

  const error = (() => {
    if (wrong === 'typed') {
      return t('open-dialog.password-wrong');
    }

    return wrong === 'saved' ? t('open-dialog.password-wrong-saved') : null;
  })();

  return (
    <PlModal
      data-testid="password-dialog"
      open
      onOpenChange={closeWith(onDismiss)}
      title={t('open-dialog.password-title', { name: project.name })}
      description={t('open-dialog.password-text', { name: project.name })}
      width={440}
      actions={
        <div className="dialog-actions">
          <PlButton variant="ghost" onClick={onDismiss}>
            {t('common.cancel')}
          </PlButton>
          <PlButton
            data-testid="btn-open-with-password"
            type="submit"
            form={formId}
            loading={busy}
            disabled={password === ''}
          >
            {t('open-dialog.open')}
          </PlButton>
        </div>
      }
    >
      <form
        id={formId}
        className="project-form"
        onSubmit={(event) => {
          event.preventDefault();

          if (password !== '') {
            onPassword(project, password, remember && canRemember);
            // Cleared, so a wrong one is typed afresh rather than corrected
            setPassword('');
          }
        }}
      >
        <PlTextField
          data-testid="open-password"
          fullWidth
          // The dialog asks for this one thing, so its field takes the focus
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          type="password"
          autoComplete="off"
          label={t('open-dialog.password')}
          startIcon={<LockKeyhole />}
          value={password}
          error={error}
          invalid={error !== null}
          onChange={(event) => setPassword(event.target.value)}
        />
        <PlCheckbox
          data-testid="open-remember-password"
          size="sm"
          label={t('open-dialog.password-remember')}
          description={canRemember ? undefined : t('project-dialog.no-keystore')}
          disabled={!canRemember}
          checked={remember && canRemember}
          onCheckedChange={setRemember}
        />
      </form>
    </PlModal>
  );
}

/*
 * The questions opening a project asks: the password of an encrypted file,
 * how to open a file in an older format version, and what to do about a
 * project whose file is gone. One at a time, as `useOpenProject` asks them.
 * */
export default function OpenDialogs({
  question,
  busy,
  onDismiss,
  onPassword,
  onUpgrade,
  onDelete,
  onRescue,
  onOpen,
}: OpenDialogsProps) {
  const [t] = useTranslation();

  if (question?.kind === 'password') {
    return (
      <PasswordDialog
        question={question}
        busy={busy}
        onDismiss={onDismiss}
        onPassword={onPassword}
      />
    );
  }

  if (question?.kind === 'upgrade') {
    const { project, formatVersion, newestVersion } = question;

    return (
      <PlModal
        data-testid="upgrade-dialog"
        open
        onOpenChange={closeWith(onDismiss)}
        title={t('open-dialog.upgrade-title')}
        description={t('open-dialog.upgrade-text', {
          name: project.name,
          from: formatVersion,
          to: newestVersion,
        })}
        width={520}
        actions={
          <PlButton variant="ghost" onClick={onDismiss}>
            {t('common.cancel')}
          </PlButton>
        }
      >
        <div className="choices">
          <button
            type="button"
            className="choice"
            data-testid="btn-upgrade-copy"
            disabled={busy}
            onClick={() => onUpgrade(question, 'copy')}
          >
            <CopyCheck className="choice__icon" aria-hidden="true" />
            <span className="choice__title">{t('open-dialog.upgrade-copy')}</span>
            <span className="choice__text">{t('open-dialog.upgrade-copy-text')}</span>
          </button>
          <button
            type="button"
            className="choice"
            data-testid="btn-upgrade-original"
            disabled={busy}
            onClick={() => onUpgrade(question, 'original')}
          >
            <CircleArrowUp className="choice__icon" aria-hidden="true" />
            <span className="choice__title">{t('open-dialog.upgrade-original')}</span>
            <span className="choice__text">{t('open-dialog.upgrade-original-text')}</span>
          </button>
        </div>
      </PlModal>
    );
  }

  if (question?.kind === 'damaged') {
    const { project, message } = question;

    return (
      <PlModal
        data-testid="damaged-dialog"
        open
        onOpenChange={closeWith(onDismiss)}
        title={t('open-dialog.damaged-title', { name: project.name })}
        width={520}
        actions={
          <div className="dialog-actions">
            <PlButton variant="ghost" onClick={onDismiss}>
              {t('common.cancel')}
            </PlButton>
            <PlButton data-testid="btn-rescue" loading={busy} onClick={() => onRescue(project)}>
              {t('tools.rescue')}
            </PlButton>
          </div>
        }
      >
        <div className="notice">
          <FileExclamationPoint className="notice__icon" aria-hidden="true" />
          <div className="notice__text">
            <p className="notice__line">{t('open-dialog.damaged-text')}</p>
            <p className="notice__line notice__detail">{message}</p>
          </div>
        </div>
      </PlModal>
    );
  }

  if (question?.kind === 'rescued') {
    const { report } = question;

    return (
      <PlModal
        data-testid="rescued-dialog"
        open
        onOpenChange={closeWith(onDismiss)}
        title={t('open-dialog.rescued-title')}
        width={520}
        actions={
          <div className="dialog-actions">
            <PlButton variant="ghost" onClick={onDismiss}>
              {t('common.close')}
            </PlButton>
            <PlButton data-testid="btn-open-rescued" onClick={() => onOpen(report.project)}>
              {t('tools.rescue-open')}
            </PlButton>
          </div>
        }
      >
        <PlAlert color={report.whole ? 'success' : 'warning'} variant="glass" size="sm">
          {report.whole
            ? t('tools.rescue-whole', { path: report.path })
            : t('tools.rescue-partial', {
                path: report.path,
                pages: report.pagesDamaged,
                objects: report.objectsDropped,
                values: report.valuesLost,
              })}
        </PlAlert>
      </PlModal>
    );
  }

  if (question?.kind === 'missing') {
    const { project } = question;

    return (
      <PlModal
        data-testid="missing-dialog"
        open
        onOpenChange={closeWith(onDismiss)}
        title={t('open-dialog.missing-title', { name: project.name })}
        width={480}
        actions={
          <div className="dialog-actions">
            <PlButton variant="ghost" onClick={onDismiss}>
              {t('common.cancel')}
            </PlButton>
            <PlButton
              data-testid="btn-delete-missing"
              color="danger"
              onClick={() => onDelete(project)}
            >
              {t('open-dialog.missing-delete')}
            </PlButton>
          </div>
        }
      >
        <div className="notice">
          <FileX className="notice__icon" aria-hidden="true" />
          <p className="notice__text">
            {t('open-dialog.missing-text', { path: project.filePath })}
          </p>
        </div>
      </PlModal>
    );
  }

  return null;
}
