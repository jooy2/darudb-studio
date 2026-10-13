import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PlButton, PlPane, PlPanes } from 'plass-ui';
import AppHeader from '@/renderer/components/AppHeader';
import ObjectDialog from '@/renderer/components/grid/ObjectDialog';
import ProjectToolbar, { useDiscard } from '@/renderer/components/project/ProjectToolbar';
import SchemaTree from '@/renderer/components/project/SchemaTree';
import StatusBar from '@/renderer/components/project/StatusBar';
import useEditTexts from '@/renderer/components/project/useEditTexts';
import Workspace from '@/renderer/components/project/Workspace';
import useMenuCommands from '@/renderer/hooks/useMenuCommands';
import LoadingScreen from '@/renderer/screens/LoadingScreen';
import {
  insertObject,
  loadCounts,
  openQuery,
  refreshProject,
  runTool,
  sessionClosed,
  sessionLoaded,
  submitPending,
  type Tool,
  type WorkspaceTab,
} from '@/renderer/store/slices/projectSlice';
import { useAppDispatch, useAppSelector } from '@/renderer/store/hooks';
import { APP_NAME } from '@/renderer/constants';
import { mainChannels } from '@/common/ipc';

/* The steps of opening the project screen, as its loading screen counts them */
type Step = 'session' | 'counts' | 'ready';

const STEPS: Step[] = ['session', 'counts', 'ready'];

/*
 * The project a window has open: the schema on the left, the tabs on the
 * right, a toolbar above and a status bar below.
 *
 * The window asks the main process which project it has open rather than
 * trusting the route, so a window without one, or with another, goes back to
 * the list.
 * */
export default function ProjectScreen() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [t] = useTranslation();
  const dispatch = useAppDispatch();
  const texts = useEditTexts();
  const discard = useDiscard();
  const session = useAppSelector((state) => state.project.session);
  const pending = useAppSelector((state) => state.project.pending);
  const activeCollection = useAppSelector((state) => {
    const { groups, focusedGroupId, tabs } = state.project;
    const group = groups.find((each) => each.id === focusedGroupId);
    const tab: WorkspaceTab | undefined = group?.activeTabId ? tabs[group.activeTabId] : undefined;

    return tab?.collection ?? null;
  });
  const [step, setStep] = useState<Step>('session');
  const [adding, setAdding] = useState<string | null>(null);

  useEffect(() => {
    let current = true;

    const load = async (): Promise<void> => {
      const found = await window.mainApi.invoke(mainChannels.requestSession);

      if (!current) {
        return;
      }

      if (!found || String(found.project.id) !== id) {
        navigate('/', { replace: true });

        return;
      }

      document.title = `${found.project.name} - ${APP_NAME}`;
      dispatch(sessionLoaded(found));
      setStep('counts');
      await dispatch(loadCounts());

      if (current) {
        setStep('ready');
      }
    };

    void load();

    return () => {
      current = false;
      dispatch(sessionClosed());
    };
  }, [id, navigate, dispatch]);

  // Edits held for a submit would go with the window, so closing it asks first:
  // the page refuses to unload, and the main process asks the user
  useEffect(() => {
    if (pending.length === 0) {
      return undefined;
    }

    const hold = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
    };

    window.addEventListener('beforeunload', hold);

    return () => window.removeEventListener('beforeunload', hold);
  }, [pending.length]);

  const close = useCallback(async (): Promise<void> => {
    // Held edits are lost with the project, so the user says so first
    if (!(await discard())) {
      return;
    }

    await window.mainApi.invoke(mainChannels.closeProject);
    navigate('/');
  }, [discard, navigate]);

  const runToolFromMenu = (tool: Tool): void => {
    void dispatch(
      runTool(tool, t('tools.backup-title'), (path) => t('tools.backup-done', { path })),
    );
  };

  const submit = (): void => {
    void dispatch(submitPending(texts.submit(pending.length), texts.failed));
  };

  useMenuCommands({
    'close-project': () => void close(),
    refresh: () => void dispatch(refreshProject()),
    'new-query': () => dispatch(openQuery({ collection: activeCollection })),
    submit,
    discard: () => void discard(),
    check: () => runToolFromMenu('check'),
    compact: () => runToolFromMenu('compact'),
    backup: () => runToolFromMenu('backup'),
  });

  if (!session || step !== 'ready') {
    return (
      <LoadingScreen
        status={step === 'session' ? t('loading.session') : t('loading.counts')}
        progress={(STEPS.indexOf(step) + 1) / (STEPS.length + 1)}
      />
    );
  }

  const { project, schema } = session;
  const addingTo = schema?.collections.find((collection) => collection.name === adding);

  return (
    <div className="app project-app">
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
      <ProjectToolbar collection={activeCollection} onAddObject={setAdding} />
      <main className="project-screen" data-testid="project-screen">
        <PlPanes
          className="project-panes"
          orientation="horizontal"
          resizable
          label={t('project.layout')}
        >
          <PlPane defaultSize="240px" minSize="160px" maxSize="480px">
            <SchemaTree onAddObject={setAdding} />
          </PlPane>
          <PlPane>
            <Workspace />
          </PlPane>
        </PlPanes>
      </main>
      <StatusBar />
      {addingTo && schema && (
        <ObjectDialog
          collection={addingTo}
          collections={schema.collections}
          onClose={() => setAdding(null)}
          onSubmit={(values) => dispatch(insertObject(addingTo.name, values, texts.insert))}
        />
      )}
    </div>
  );
}
