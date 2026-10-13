import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PlButton } from 'plass-ui';
import AppHeader from '@/renderer/components/AppHeader';
import useMenuCommands from '@/renderer/hooks/useMenuCommands';
import LoadingScreen from '@/renderer/screens/LoadingScreen';
import { APP_NAME } from '@/renderer/constants';
import { formatBytes } from '@/renderer/format';
import { mainChannels } from '@/common/ipc';
import type { Session } from '@/common/projects';

/*
 * The project a window has open. The window asks the main process which one
 * it is rather than trusting the route, so a window without one, or with
 * another, goes back to the list.
 * */
export default function ProjectScreen() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [t, i18n] = useTranslation();
  const [session, setSession] = useState<Session | null>(null);
  const language = i18n.resolvedLanguage ?? 'en';

  useEffect(() => {
    let current = true;

    void window.mainApi.invoke(mainChannels.requestSession).then((found) => {
      if (!current) {
        return;
      }

      if (found && String(found.project.id) === id) {
        setSession(found);
        document.title = `${found.project.name} - ${APP_NAME}`;
      } else {
        navigate('/', { replace: true });
      }
    });

    return () => {
      current = false;
    };
  }, [id, navigate]);

  const close = useCallback(async (): Promise<void> => {
    await window.mainApi.invoke(mainChannels.closeProject);
    navigate('/');
  }, [navigate]);

  useMenuCommands({
    'close-project': () => void close(),
  });

  if (!session) {
    return <LoadingScreen status={t('loading.opening', { name: '' })} />;
  }

  const { project, database } = session;

  return (
    <div className="app">
      <AppHeader
        title={project.name}
        showsProject
        actions={
          <PlButton
            data-testid="btn-close-project"
            size="sm"
            variant="ghost"
            onClick={() => void close()}
          >
            {t('project.close')}
          </PlButton>
        }
      />
      <main className="project-screen" data-testid="project-screen">
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
          <dd>{database.schemaVersion ?? t('project.no-schema')}</dd>
          <dt>{t('project.encrypted')}</dt>
          <dd data-testid="project-encrypted">
            {database.encrypted ? t('project.encrypted') : t('project.not-encrypted')}
          </dd>
        </dl>
      </main>
    </div>
  );
}
