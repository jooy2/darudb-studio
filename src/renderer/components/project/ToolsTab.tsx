import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { HardDriveDownload, Shrink, ShieldCheck } from 'lucide-react';
import { PlAlert, PlButton } from 'plass-ui';
import { formatBytes } from '@/renderer/format';
import { runTool, type Tool } from '@/renderer/store/slices/projectSlice';
import { useAppDispatch, useAppSelector } from '@/renderer/store/hooks';
import type { ToolResult } from '@/common/data';

function ToolCard({
  icon,
  title,
  text,
  action,
  busy,
  onRun,
  children,
  testId,
}: {
  icon: ReactNode;
  title: string;
  text: string;
  action: string;
  busy: boolean;
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
      <PlButton size="sm" variant="glass" loading={busy} onClick={onRun}>
        {action}
      </PlButton>
    </section>
  );
}

/*
 * The file's tools: the integrity check, compaction and a backup, each with
 * what it found or did the last time it ran, and what is known of the file.
 * The menu runs them too, through the same thunk, which brings this tab
 * forward.
 * */
export default function ToolsTab() {
  const [t, i18n] = useTranslation();
  const dispatch = useAppDispatch();
  const database = useAppSelector((state) => state.project.session?.database);
  const schemaVersion = useAppSelector((state) => state.project.session?.schema?.version ?? null);
  const reports = useAppSelector((state) => state.project.toolReports);
  const busy = useAppSelector((state) => state.project.runningTool);
  const language = i18n.resolvedLanguage ?? 'en';
  const number = (value: number): string => new Intl.NumberFormat(language).format(value);

  const run = (tool: Tool): void => {
    void dispatch(
      runTool(tool, t('tools.backup-title'), (path) => t('tools.backup-done', { path })),
    );
  };

  const failure = (result: ToolResult<unknown> | null): ReactNode =>
    result?.status === 'error' ? (
      <PlAlert color="danger" variant="glass" size="sm">
        {result.message}
      </PlAlert>
    ) : null;

  const { check, compact, backup } = reports;

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
              <ul className="tool__problems">
                {check.report.problems.slice(0, 50).map((problem, index) => (
                  <li key={`${index}-${problem.page}`}>
                    {problem.page === null ? '' : `#${problem.page} `}
                    {problem.tree ? `${problem.tree}: ` : ''}
                    {problem.message}
                  </li>
                ))}
              </ul>
            )}
          </PlAlert>
        )}
        {failure(check)}
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
        onRun={() => run('backup')}
      >
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
