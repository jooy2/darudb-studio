import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { HardDriveDownload, KeyRound, LifeBuoy, Shrink, ShieldCheck } from 'lucide-react';
import { PlAlert, PlButton, PlCheckbox, PlTextField } from 'plass-ui';
import useToolTexts from '@/renderer/components/project/useToolTexts';
import { formatBytes } from '@/renderer/format';
import { runTool, type Tool } from '@/renderer/store/slices/projectSlice';
import { useAppDispatch, useAppSelector } from '@/renderer/store/hooks';
import { mainChannels } from '@/common/ipc';
import type { ToolResult } from '@/common/data';

function ToolCard({
  icon,
  title,
  text,
  action,
  busy,
  disabled = false,
  onRun,
  children,
  testId,
}: {
  icon: ReactNode;
  title: string;
  text: string;
  action: string;
  busy: boolean;
  disabled?: boolean;
  onRun: () => void;
  children: ReactNode;
  testId: string;
}) {
  return (
    <section className="tool" data-testid={testId}>
      <span className="tool__icon" aria-hidden="true">
        {icon}
      </span>
      <div className="tool__body">
        <h3 className="tool__title">{title}</h3>
        <p className="tool__text">{text}</p>
        {children}
      </div>
      <PlButton size="sm" variant="glass" loading={busy} disabled={disabled} onClick={onRun}>
        {action}
      </PlButton>
    </section>
  );
}

/*
 * The file's tools: the integrity check, compaction, a backup, a rescue of a
 * damaged file and, for an encrypted file, a new password, each with what it
 * found or did the last time it ran, and what is known of the file. The menu
 * runs the first three too, through the same thunk, which brings this tab
 * forward.
 * */
export default function ToolsTab() {
  const [t, i18n] = useTranslation();
  const dispatch = useAppDispatch();
  const texts = useToolTexts();
  const database = useAppSelector((state) => state.project.session?.database);
  const schemaVersion = useAppSelector((state) => state.project.session?.schema?.version ?? null);
  const reports = useAppSelector((state) => state.project.toolReports);
  const busy = useAppSelector((state) => state.project.runningTool);
  const [encryptCopy, setEncryptCopy] = useState(false);
  const [copyPassword, setCopyPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [repeated, setRepeated] = useState('');
  const language = i18n.resolvedLanguage ?? 'en';
  const number = (value: number): string => new Intl.NumberFormat(language).format(value);

  const run = (tool: Tool, password?: string): void => {
    void dispatch(runTool(tool, texts, password));
  };

  const failure = (result: ToolResult<unknown> | null): ReactNode =>
    result?.status === 'error' ? (
      <PlAlert color="danger" variant="glass" size="sm">
        {result.message}
      </PlAlert>
    ) : null;

  const { check, compact, backup, rescue, password } = reports;
  const passwordsDiffer = repeated !== '' && repeated !== newPassword;

  return (
    <div className="tools-tab" data-testid="tools-tab">
      <ToolCard
        testId="tool-check"
        icon={<ShieldCheck />}
        title={t('tools.check-title')}
        text={t('tools.check-text')}
        action={t('tools.check')}
        busy={busy === 'check'}
        onRun={() => run('check')}
      >
        {check?.status === 'ok' && (
          <PlAlert
            color={check.report.ok ? 'success' : 'danger'}
            variant="glass"
            size="sm"
            data-testid="check-report"
          >
            {check.report.ok
              ? t('tools.check-ok', {
                  pages: number(check.report.pagesChecked),
                  objects: number(check.report.objectsChecked),
                })
              : t('tools.check-problems', { count: check.report.problems.length })}
            {!check.report.ok && (
              <>
                <ul className="tool__problems">
                  {check.report.problems.slice(0, 50).map((problem, index) => (
                    <li key={`${index}-${problem.page}`}>
                      {problem.page === null ? '' : `#${problem.page} `}
                      {problem.tree ? `${problem.tree}: ` : ''}
                      {problem.message}
                    </li>
                  ))}
                </ul>
                <p className="tool__hint">{t('tools.check-rescue')}</p>
              </>
            )}
          </PlAlert>
        )}
        {failure(check)}
      </ToolCard>
      <ToolCard
        testId="tool-rescue"
        icon={<LifeBuoy />}
        title={t('tools.rescue-title')}
        text={t('tools.rescue-text')}
        action={t('tools.rescue')}
        busy={busy === 'rescue'}
        onRun={() => run('rescue')}
      >
        {rescue?.status === 'ok' && (
          <PlAlert
            color={rescue.report.whole ? 'success' : 'warning'}
            variant="glass"
            size="sm"
            data-testid="rescue-report"
            action={
              <PlButton
                size="sm"
                variant="ghost"
                onClick={() =>
                  void window.mainApi.invoke(
                    mainChannels.openProjectWindow,
                    rescue.report.project.id,
                  )
                }
              >
                {t('tools.rescue-open')}
              </PlButton>
            }
          >
            {rescue.report.whole
              ? t('tools.rescue-whole', { path: rescue.report.path })
              : t('tools.rescue-partial', {
                  path: rescue.report.path,
                  pages: number(rescue.report.pagesDamaged),
                  objects: number(rescue.report.objectsDropped),
                  values: number(rescue.report.valuesLost),
                })}
            {!rescue.report.reopened && <p className="tool__hint">{t('tools.rescue-closed')}</p>}
          </PlAlert>
        )}
        {failure(rescue)}
      </ToolCard>
      <ToolCard
        testId="tool-compact"
        icon={<Shrink />}
        title={t('tools.compact-title')}
        text={t('tools.compact-text')}
        action={t('tools.compact')}
        busy={busy === 'compact'}
        onRun={() => run('compact')}
      >
        {compact?.status === 'ok' && (
          <PlAlert color="success" variant="glass" size="sm" data-testid="compact-report">
            {t('tools.compact-done', {
              before: formatBytes(compact.report.bytesBefore, language),
              after: formatBytes(compact.report.bytesAfter, language),
            })}
          </PlAlert>
        )}
        {failure(compact)}
      </ToolCard>
      <ToolCard
        testId="tool-backup"
        icon={<HardDriveDownload />}
        title={t('tools.backup-title')}
        text={t('tools.backup-text')}
        action={t('tools.backup')}
        busy={busy === 'backup'}
        disabled={encryptCopy && copyPassword === ''}
        onRun={() => run('backup', encryptCopy ? copyPassword : undefined)}
      >
        <PlCheckbox
          data-testid="backup-encrypt"
          size="sm"
          label={t('tools.backup-encrypt')}
          checked={encryptCopy}
          onCheckedChange={setEncryptCopy}
        />
        {encryptCopy && (
          <PlTextField
            data-testid="backup-password"
            size="sm"
            type="password"
            autoComplete="new-password"
            label={t('tools.backup-password')}
            value={copyPassword}
            onChange={(event) => setCopyPassword(event.target.value)}
          />
        )}
        {backup?.status === 'ok' && (
          <PlAlert color="success" variant="glass" size="sm" data-testid="backup-report">
            {t('tools.backup-written', {
              path: backup.report.path,
              size: formatBytes(backup.report.bytes, language),
            })}
          </PlAlert>
        )}
        {failure(backup)}
      </ToolCard>
      {database?.encrypted && (
        <ToolCard
          testId="tool-password"
          icon={<KeyRound />}
          title={t('tools.password-title')}
          text={t('tools.password-text')}
          action={t('tools.password-change')}
          busy={busy === 'password'}
          disabled={newPassword === '' || repeated !== newPassword}
          onRun={() => {
            run('password', newPassword);
            setNewPassword('');
            setRepeated('');
          }}
        >
          <div className="tool__fields">
            <PlTextField
              data-testid="new-password"
              size="sm"
              type="password"
              autoComplete="new-password"
              label={t('tools.password-new')}
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
            <PlTextField
              data-testid="repeat-password"
              size="sm"
              type="password"
              autoComplete="new-password"
              label={t('tools.password-repeat')}
              value={repeated}
              error={passwordsDiffer ? t('tools.password-differs') : undefined}
              invalid={passwordsDiffer}
              onChange={(event) => setRepeated(event.target.value)}
            />
          </div>
          {password?.status === 'ok' && (
            <PlAlert color="success" variant="glass" size="sm" data-testid="password-report">
              {password.report.remembered
                ? t('tools.password-remembered')
                : t('tools.password-done')}
            </PlAlert>
          )}
          {failure(password)}
        </ToolCard>
      )}
      {database && (
        <section className="tool tool--facts">
          <div className="tool__body">
            <h3 className="tool__title">{t('tools.file')}</h3>
            <dl className="facts">
              <dt>{t('project.file')}</dt>
              <dd data-testid="project-path">{database.path}</dd>
              <dt>{t('project.file-size')}</dt>
              <dd>{formatBytes(database.fileSize, language)}</dd>
              <dt>{t('project.format-version')}</dt>
              <dd data-testid="project-format-version">{database.formatVersion}</dd>
              <dt>{t('project.page-size')}</dt>
              <dd>{formatBytes(database.pageSize, language)}</dd>
              <dt>{t('project.schema-version')}</dt>
              <dd>{schemaVersion ?? t('project.no-schema')}</dd>
              <dt>{t('project.encrypted')}</dt>
              <dd data-testid="project-encrypted">
                {database.encrypted ? t('project.encrypted') : t('project.not-encrypted')}
              </dd>
            </dl>
          </div>
        </section>
      )}
    </div>
  );
}
