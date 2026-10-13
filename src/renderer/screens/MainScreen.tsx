import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Database, LayoutGrid, List, Plus } from 'lucide-react';
import { PlButton, PlEmpty, PlSegment, PlSegmentedButton, PlTypography } from 'plass-ui';
import AppHeader from '@/renderer/components/AppHeader';
import OpenDialogs from '@/renderer/components/projects/OpenDialogs';
import ProjectDialog from '@/renderer/components/projects/ProjectDialog';
import ProjectList from '@/renderer/components/projects/ProjectList';
import WelcomeCard from '@/renderer/components/projects/WelcomeCard';
import useMenuCommands from '@/renderer/hooks/useMenuCommands';
import useOpenProject from '@/renderer/hooks/useOpenProject';
import useProjects from '@/renderer/hooks/useProjects';
import LoadingScreen from '@/renderer/screens/LoadingScreen';
import { changeSettings } from '@/renderer/store/slices/settingsSlice';
import { useAppDispatch, useAppSelector } from '@/renderer/store/hooks';
import { APP_NAME } from '@/renderer/constants';
import { mainChannels } from '@/common/ipc';
import type { Project } from '@/common/projects';
import { isProjectView } from '@/common/settings';

// How long the loading screen stays at the least, so a window that is ready at
// once still shows it rather than flashing it
const MIN_LOADING_MS = 600;

/*
 * The screen a window opens on: a welcome, and the projects, which a click
 * opens. Projects are created and edited in a dialog over it.
 * */
export default function MainScreen() {
  const [t] = useTranslation();
  const dispatch = useAppDispatch();
  const view = useAppSelector((state) => state.settings.projectView);
  const { projects, refresh } = useProjects();
  const opener = useOpenProject();
  // The project dialog: open on a project to edit, or on none to create one
  const [editing, setEditing] = useState<{ project?: Project } | null>(null);
  const [shownLongEnough, setShownLongEnough] = useState(false);

  useEffect(() => {
    document.title = APP_NAME;
    // The list never has a project open behind it, whichever way the window got here
    void window.mainApi.invoke(mainChannels.closeProject);

    const timer = setTimeout(() => setShownLongEnough(true), MIN_LOADING_MS);

    return () => clearTimeout(timer);
  }, []);

  useMenuCommands({
    'new-project': () => setEditing({}),
  });

  // Main tells every other window of a change, and this one reads the list again itself
  const handleDialogClosed = (): void => {
    setEditing(null);
    void refresh();
  };

  const handleDeleteMissing = async (project: Project): Promise<void> => {
    await window.mainApi.invoke(mainChannels.deleteProject, project.id);
    opener.dismiss();
    await refresh();
  };

  if (projects === null || !shownLongEnough) {
    return (
      <LoadingScreen
        status={projects === null ? t('loading.projects') : t('loading.ready')}
        progress={projects === null ? null : 1}
      />
    );
  }

  if (opener.opening) {
    return <LoadingScreen status={t('loading.opening', { name: opener.opening.name })} />;
  }

  const newProjectButton = (
    <PlButton
      data-testid="btn-new-project"
      size="sm"
      startIcon={<Plus />}
      onClick={() => setEditing({})}
    >
      {t('home.new-project')}
    </PlButton>
  );

  return (
    <div className="app">
      <AppHeader />
      <main className="home">
        <div className="home__inner">
          <WelcomeCard />
          <section className="projects" aria-labelledby="projects-title">
            <div className="projects__bar">
              <PlTypography id="projects-title" level="h2" className="projects__title">
                {t('home.projects')}
              </PlTypography>
              <span className="projects__count" data-testid="project-count">
                {projects.length}
              </span>
              <span className="projects__spacer" />
              {projects.length > 0 && (
                <PlSegmentedButton
                  data-testid="project-view"
                  size="sm"
                  aria-label={t('home.view')}
                  value={view}
                  onValueChange={(value) => {
                    if (isProjectView(value)) {
                      void dispatch(changeSettings({ projectView: value }));
                    }
                  }}
                >
                  <PlSegment value="grid" startIcon={<LayoutGrid />}>
                    {t('home.view-grid')}
                  </PlSegment>
                  <PlSegment value="list" startIcon={<List />}>
                    {t('home.view-list')}
                  </PlSegment>
                </PlSegmentedButton>
              )}
              {newProjectButton}
            </div>
            {projects.length === 0 ? (
              <PlEmpty
                className="projects__empty"
                data-testid="projects-empty"
                icon={<Database />}
                title={t('home.empty-title')}
                description={t('home.empty-text')}
              />
            ) : (
              <ProjectList
                projects={projects}
                view={view}
                onOpen={(project) => void opener.open(project)}
                onEdit={(project) => setEditing({ project })}
              />
            )}
          </section>
        </div>
      </main>
      {editing && <ProjectDialog project={editing.project} onClose={handleDialogClosed} />}
      <OpenDialogs
        question={opener.question}
        busy={opener.busy}
        onDismiss={opener.dismiss}
        onPassword={(project, password, remember) =>
          void opener.withPassword(project, password, remember)
        }
        onUpgrade={(question, upgrade) => void opener.withUpgrade(question, upgrade)}
        onDelete={(project) => void handleDeleteMissing(project)}
      />
    </div>
  );
}
