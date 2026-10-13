import { useEffect, useId, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { FolderOpen } from 'lucide-react';
import { PlAlert, PlButton, PlCheckbox, PlModal, PlTextField, usePlConfirm } from 'plass-ui';
import { fileStem } from '@/renderer/format';
import { mainChannels } from '@/common/ipc';
import {
  PROJECT_NAME_MAX_LENGTH,
  type ChosenFile,
  type FileCheck,
  type Project,
  type ProjectDraft,
} from '@/common/projects';

interface ProjectDialogProps {
  /* The project to edit, or none to create one */
  project?: Project;
  onClose: () => void;
}

const isEncrypted = (check: FileCheck | null): boolean =>
  check?.status === 'needs-password' ||
  check?.status === 'wrong-password' ||
  (check?.status === 'ok' && check.encrypted);

/*
 * Creates a project, or edits one: its name, the database file it opens, and
 * the file's password if the user wants it remembered.
 *
 * A file the user picks is checked at once, and one that is not a DaruDB
 * database is not kept. The file a project already points at is checked too,
 * but only to say what it is: a project may keep a file that is gone for now.
 * A password is tried on the file before it is saved, so a wrong one is never
 * remembered.
 * */
export default function ProjectDialog({ project = undefined, onClose }: ProjectDialogProps) {
  const [t] = useTranslation();
  const confirm = usePlConfirm();
  const formId = useId();
  const editing = project !== undefined;

  const [name, setName] = useState(project?.name ?? '');
  const [nameError, setNameError] = useState<string | null>(null);
  const [file, setFile] = useState<ChosenFile | null>(
    project ? { path: project.filePath, check: { status: 'missing' } } : null,
  );
  // Until the check of the current file answers, nothing is said about it
  const [checked, setChecked] = useState(!editing);
  const [fileError, setFileError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [forgetPassword, setForgetPassword] = useState(false);
  const [canRemember, setCanRemember] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    void window.mainApi.invoke(mainChannels.canRememberPasswords).then(setCanRemember);

    if (project) {
      void window.mainApi.invoke(mainChannels.checkDatabaseFile, project.filePath).then((check) => {
        setFile({ path: project.filePath, check });
        setChecked(true);
      });
    }
  }, [project]);

  const fileProblem = (check: FileCheck): string | null => {
    switch (check.status) {
      case 'not-database':
        return t('project-dialog.not-database');
      case 'missing':
        return t('project-dialog.file-missing');
      case 'error':
        return t('project-dialog.file-error', { message: check.message });
      default:
        return null;
    }
  };

  const describeFile = (check: FileCheck): string | null => {
    if (check.status === 'ok') {
      return [
        check.encrypted
          ? t('project-dialog.file-encrypted')
          : t('project-dialog.file-ok', { version: check.formatVersion }),
        check.needsUpgrade ? t('project-dialog.file-upgrade') : '',
      ]
        .filter(Boolean)
        .join(' ');
    }

    return isEncrypted(check) ? t('project-dialog.file-encrypted') : null;
  };

  const handleBrowse = async (): Promise<void> => {
    const chosen = await window.mainApi.invoke(
      mainChannels.chooseDatabaseFile,
      t('project-dialog.choose-title'),
    );

    if (!chosen) {
      return;
    }

    const problem = fileProblem(chosen.check);

    // A file that is not a database is not kept, so it cannot be saved by mistake
    if (problem) {
      setFile(null);
      setFileError(problem);

      return;
    }

    setFile(chosen);
    setChecked(true);
    setFileError(null);
    setPasswordError(null);

    if (name.trim() === '') {
      setName(fileStem(chosen.path).slice(0, PROJECT_NAME_MAX_LENGTH));
      setNameError(null);
    }
  };

  const validName = (): string | null => {
    const trimmed = name.trim();

    if (trimmed === '') {
      setNameError(t('project-dialog.name-required'));

      return null;
    }

    if (trimmed.length > PROJECT_NAME_MAX_LENGTH) {
      setNameError(t('project-dialog.name-too-long', { count: PROJECT_NAME_MAX_LENGTH }));

      return null;
    }

    return trimmed;
  };

  const handleSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();

    const trimmedName = validName();

    if (!file) {
      setFileError(t('project-dialog.file-required'));
    }

    if (trimmedName === null || !file) {
      return;
    }

    setSaving(true);
    setSaveError(null);

    try {
      // A password is only worth keeping for a file that asks for one, and only
      // once it is known to open it
      const keepsPassword = password !== '' && isEncrypted(file.check);

      if (keepsPassword) {
        const check = await window.mainApi.invoke(
          mainChannels.checkDatabaseFile,
          file.path,
          password,
        );

        if (check.status === 'wrong-password') {
          setPasswordError(t('project-dialog.wrong-password'));

          return;
        }
      }

      const draft: ProjectDraft = {
        ...(project ? { id: project.id } : {}),
        name: trimmedName,
        filePath: file.path,
        ...(keepsPassword ? { password } : forgetPassword ? { password: null } : {}),
      };

      await window.mainApi.invoke(mainChannels.saveProject, draft);
      onClose();
    } catch (error) {
      setSaveError(
        t('project-dialog.save-failed', {
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (): Promise<void> => {
    if (!project) {
      return;
    }

    const confirmed = await confirm.confirm({
      title: t('project-dialog.delete-title', { name: project.name }),
      description:
        project.sourcePath === null
          ? t('project-dialog.delete-text')
          : t('project-dialog.delete-copy-text'),
      confirmLabel: t('project-dialog.delete'),
      color: 'danger',
      initialFocus: 'cancel',
    });

    if (!confirmed) {
      return;
    }

    try {
      await window.mainApi.invoke(mainChannels.deleteProject, project.id);
      onClose();
    } catch (error) {
      setSaveError(
        t('project-dialog.save-failed', {
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  };

  // A file known to be plain needs no password; one that is gone may still have one
  const passwordUseless = checked && file?.check.status === 'ok' && !file.check.encrypted;
  // Another file in place of the working copy the app made leaves the copy with nothing to point at
  const replacesCopy =
    project !== undefined &&
    project.sourcePath !== null &&
    file !== null &&
    file.path !== project.filePath;
  const fileDescription = [
    file && checked ? (fileProblem(file.check) ?? describeFile(file.check)) : null,
    replacesCopy ? t('project-dialog.copy-replaced') : null,
  ]
    .filter(Boolean)
    .join(' ');
  const passwordDescription = (() => {
    if (!canRemember) {
      return t('project-dialog.no-keystore');
    }

    if (passwordUseless) {
      return t('project-dialog.not-encrypted');
    }

    return project?.hasPassword && !forgetPassword
      ? t('project-dialog.password-kept')
      : t('project-dialog.password-hint');
  })();

  return (
    <PlModal
      data-testid="project-dialog"
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      title={editing ? t('project-dialog.edit-title') : t('project-dialog.create-title')}
      width={520}
      actions={
        <div className="dialog-actions">
          {editing && (
            <PlButton
              data-testid="btn-delete-project"
              className="dialog-actions__start"
              variant="ghost"
              color="danger"
              onClick={() => void handleDelete()}
            >
              {t('project-dialog.delete')}
            </PlButton>
          )}
          <PlButton variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </PlButton>
          <PlButton data-testid="btn-save-project" type="submit" form={formId} loading={saving}>
            {editing ? t('project-dialog.save') : t('project-dialog.create')}
          </PlButton>
        </div>
      }
    >
      <form
        id={formId}
        className="project-form"
        noValidate
        onSubmit={(event) => void handleSubmit(event)}
      >
        <PlTextField
          data-testid="project-name"
          fullWidth
          required
          // The dialog is opened to type a name, so the name field takes the focus
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          label={t('project-dialog.name')}
          value={name}
          maxLength={PROJECT_NAME_MAX_LENGTH}
          error={nameError}
          invalid={nameError !== null}
          onChange={(event) => {
            setName(event.target.value);
            setNameError(null);
          }}
        />
        <PlTextField
          data-testid="project-file"
          className="project-form__file"
          fullWidth
          readOnly
          label={t('project-dialog.file')}
          placeholder={t('project-dialog.file-placeholder')}
          value={file?.path ?? ''}
          title={file?.path}
          description={fileError === null ? fileDescription : undefined}
          error={fileError}
          invalid={fileError !== null}
          // The field only shows the path, so a click on it opens the picker too
          onClick={() => void handleBrowse()}
          endIcon={
            <PlButton
              data-testid="btn-browse-file"
              size="xs"
              variant="glass"
              startIcon={<FolderOpen />}
              onClick={(event) => {
                // The field around the button opens the picker on its own click
                event.stopPropagation();
                void handleBrowse();
              }}
            >
              {t('project-dialog.browse')}
            </PlButton>
          }
        />
        <PlTextField
          data-testid="project-password"
          fullWidth
          type="password"
          autoComplete="off"
          label={t('project-dialog.password')}
          value={password}
          disabled={!canRemember || passwordUseless || forgetPassword}
          description={passwordError === null ? passwordDescription : undefined}
          error={passwordError}
          invalid={passwordError !== null}
          onChange={(event) => {
            setPassword(event.target.value);
            setPasswordError(null);
          }}
        />
        {project?.hasPassword && (
          <PlCheckbox
            data-testid="project-forget-password"
            size="sm"
            label={t('project-dialog.forget-password')}
            checked={forgetPassword}
            onCheckedChange={(checkedValue) => {
              setForgetPassword(checkedValue);
              setPassword('');
            }}
          />
        )}
        {saveError && (
          <PlAlert color="danger" variant="glass" size="sm">
            {saveError}
          </PlAlert>
        )}
      </form>
    </PlModal>
  );
}
