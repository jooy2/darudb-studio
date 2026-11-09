import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PlPane, PlPanes } from 'plass-ui';
import AppHeader from '@/renderer/components/AppHeader';
import ObjectDialog from '@/renderer/components/grid/ObjectDialog';
import ImportProblemsDialog from '@/renderer/components/project/ImportProblemsDialog';
import ProjectToolbar, { useDiscard } from '@/renderer/components/project/ProjectToolbar';
import SchemaDialog from '@/renderer/components/project/SchemaDialog';
import SchemaTree from '@/renderer/components/project/SchemaTree';
import StatusBar from '@/renderer/components/project/StatusBar';
import useEditTexts from '@/renderer/components/project/useEditTexts';
import useToolTexts from '@/renderer/components/project/useToolTexts';
import useTransfer from '@/renderer/components/project/useTransfer';
import Workspace from '@/renderer/components/project/Workspace';
import useMenuCommands from '@/renderer/hooks/useMenuCommands';
import LoadingScreen from '@/renderer/screens/LoadingScreen';
import {
  insertObject,
  layoutRestored,
  sidebarResized,
  loadCounts,
  openQuery,
  refreshProject,
  runTool,
  selectLayout,
  sessionClosed,
  sessionLoaded,
  statusChanged,
  submitPending,
  type Tool,
  type WorkspaceTab,
} from '@/renderer/store/slices/projectSlice';
import { useAppDispatch, useAppSelector } from '@/renderer/store/hooks';
import { APP_NAME } from '@/renderer/constants';
import { mainChannels } from '@/common/ipc';
import { isWorkspaceLayout } from '@/common/workspace';
import type { ExportSource, ImportMode } from '@/common/data';
import type { TransferFormat } from '@/common/transfer';

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
  const toolTexts = useToolTexts();
  const discard = useDiscard();
  const session = useAppSelector((state) => state.project.session);
  const pending = useAppSelector((state) => state.project.pending);
  const activeTab = useAppSelector((state): WorkspaceTab | null => {
    const { groups, focusedGroupId, tabs } = state.project;
    const group = groups.find((each) => each.id === focusedGroupId);

    return (group?.activeTabId ? tabs[group.activeTabId] : undefined) ?? null;
  });
  const activeCollection = activeTab?.collection ?? null;
  const layout = useAppSelector(selectLayout);
  const sidebarSize = useAppSelector((state) => state.project.sidebarSize);
  const location = useLocation();
  // The tabs a restored window had, handed over by the list as it opened the project
  const restoredLayout = useRef((location.state as { layout?: unknown } | null)?.layout);
  const [step, setStep] = useState<Step>('session');
  const [adding, setAdding] = useState<string | null>(null);
  // The schema shown in its dialog: the whole of it, or one collection
  const [schemaShown, setSchemaShown] = useState<{ only: string | null } | null>(null);
  const transfer = useTransfer();

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

      if (isWorkspaceLayout(restoredLayout.current)) {
        dispatch(layoutRestored(restoredLayout.current));
      }

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

  // What the window shows, for the next launch to open again
  const projectId = session?.project.id ?? null;

  useEffect(() => {
    if (projectId !== null) {
      window.mainApi.send(mainChannels.reportWindowState, { projectId, layout });
    }
  }, [projectId, layout]);

  const close = useCallback(async (): Promise<void> => {
    // Held edits are lost with the project, so the user says so first
    if (!(await discard())) {
      return;
    }

    await window.mainApi.invoke(mainChannels.closeProject);
    navigate('/');
  }, [discard, navigate]);

  const runToolFromMenu = (tool: Tool): void => {
    void dispatch(runTool(tool, toolTexts));
  };

  const submit = (): void => {
    void dispatch(submitPending(texts.submit(pending.length), texts.failed));
  };

  /*
   * Exports what the tab in front shows: a collection tab its view, a query
   * tab what its query finds. A tab of neither says so in the status bar.
   * */
  const exportFromMenu = (format: TransferFormat): void => {
    const source: ExportSource | null =
      activeTab?.kind === 'collection'
        ? { kind: 'view', filter: activeTab.filter, sort: activeTab.sort }
        : activeTab?.kind === 'query' && activeTab.text.trim() !== ''
          ? { kind: 'query', text: activeTab.text }
          : null;

    if (!activeCollection || !source) {
      dispatch(statusChanged({ text: t('status.export-needs-tab'), tone: 'info' }));
    } else if (!transfer.busy) {
      void transfer.exportObjects(activeCollection, format, source);
    }
  };

  /* Imports into the collection of the collection tab in front */
  const importFromMenu = (mode: ImportMode): void => {
    if (activeTab?.kind !== 'collection' || !activeCollection) {
      dispatch(statusChanged({ text: t('status.import-needs-tab'), tone: 'info' }));
    } else if (!transfer.busy) {
      void transfer.importObjects(activeCollection, mode);
    }
  };

  useMenuCommands({
    'close-project': () => void close(),
    refresh: () => void dispatch(refreshProject()),
    'new-query': () => dispatch(openQuery({ collection: activeCollection })),
    'export-csv': () => exportFromMenu('csv'),
    'export-json': () => exportFromMenu('json'),
    'import-insert': () => importFromMenu('insert'),
    'import-put': () => importFromMenu('put'),
    'show-schema': () => setSchemaShown({ only: null }),
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
      <AppHeader showsProject />
      <ProjectToolbar
        projectName={project.name}
        collection={activeCollection}
        onAddObject={setAdding}
      />
      <main className="project-screen" data-testid="project-screen">
        <PlPanes
          className="project-panes"
          orientation="horizontal"
          resizable
          label={t('project.layout')}
          onResizeEnd={([sidebar]) => dispatch(sidebarResized(sidebar))}
        >
          <PlPane defaultSize={sidebarSize ?? '240px'} minSize="160px" maxSize="480px">
            <SchemaTree onAddObject={setAdding} onViewSchema={(only) => setSchemaShown({ only })} />
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
      {schemaShown && schema && (
        <SchemaDialog
          schema={schema}
          only={schemaShown.only}
          onClose={() => setSchemaShown(null)}
        />
      )}
      {transfer.refused && (
        <ImportProblemsDialog refused={transfer.refused} onClose={transfer.dismissRefused} />
      )}
    </div>
  );
}
