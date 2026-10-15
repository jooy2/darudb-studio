import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Database, FlaskConical, LayoutGrid, List, Plus } from 'lucide-react';
import {
  PlButton,
  PlEmpty,
  PlSegment,
  PlSegmentedButton,
  PlTypography,
  usePlToast,
} from 'plass-ui';
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
// once still shows it rather than flashing it. A window coming back to the list
// from a project shows the list it read before at once instead.
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
  const toast = usePlToast();
  // Whether the sample database is being written, before it opens
  const [preparingSample, setPreparingSample] = useState(false);
  // The project dialog: open on a project to edit, or on none to create one
  const [editing, setEditing] = useState<{ project?: Project } | null>(null);
  const [shownLongEnough, setShownLongEnough] = useState(projects !== null);

  // The opener of the latest render, for the restore below, which runs once
  const openerRef = useRef(opener);

  useEffect(() => {
    openerRef.current = opener;
  });

  useEffect(() => {
    document.title = APP_NAME;
    // The list never has a project open behind it, whichever way the window got here
    void window.mainApi.invoke(mainChannels.closeProject);
    window.mainApi.send(mainChannels.reportWindowState, { projectId: null, layout: null });

    const timer = setTimeout(() => setShownLongEnough(true), MIN_LOADING_MS);
    let current = true;

    // A window the app restores opens the project it had, as a click would
    const restore = async (): Promise<void> => {
      const state = await window.mainApi.invoke(mainChannels.takeWindowRestore);

      if (!current || !state || state.projectId === null) {
        return;
      }

      const listed = await window.mainApi.invoke(mainChannels.listProjects);
      const project = listed.find((each) => each.id === state.projectId);

      if (current && project) {
        await openerRef.current.open(project, state.layout);
      }
    };

    void restore();

    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, []);

  useMenuCommands({
    'new-project': () => setEditing({}),
  });

  // Main tells every other window of a change, and this one reads the list again itself
  const handleDialogClosed = (): void => {
    setEditing(null);
    void refresh();
  };

  // A sample written fresh into the app's folder, and opened at once
  const handleOpenSample = async (): Promise<void> => {
    setPreparingSample(true);

    let project: Project;

    try {
      project = await window.mainApi.invoke(mainChannels.createSampleProject);
    } catch (error) {
      toast.add({
        title: t('home.sample-failed', {
          message: error instanceof Error ? error.message : String(error),
        }),
        color: 'danger',
      });

      return;
    } finally {
      setPreparingSample(false);
    }

    await opener.open(project);
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

  if (preparingSample) {
    return <LoadingScreen status={t('loading.sample')} />;
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
              <PlButton
                data-testid="btn-open-sample"
                size="sm"
                variant="glass"
                startIcon={<FlaskConical />}
                onClick={() => void handleOpenSample()}
              >
                {t('home.open-sample')}
              </PlButton>
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
        onRescue={(project) => void opener.rescue(project)}
        onOpen={(project) => {
          opener.dismiss();
          void opener.open(project);
        }}
      />
    </div>
  );
}
