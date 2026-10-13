import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { usePlToast } from 'plass-ui';
import { mainChannels } from '@/common/ipc';
import type { OpenRequest, OpenResult, Project, UpgradeChoice } from '@/common/projects';
import type { WorkspaceLayout } from '@/common/workspace';

/* What opening a project waits on the user for, as a dialog asks it */
export type OpenQuestion =
  | {
      kind: 'password';
      project: Project;
      /* Whether the password tried was wrong: `typed` by the user, or the `saved` one */
      wrong: 'typed' | 'saved' | null;
    }
  | {
      kind: 'upgrade';
      project: Project;
      formatVersion: number;
      newestVersion: number;
      /* The password that opened the file, to open it again with */
      password?: string;
      rememberPassword: boolean;
    }
  | { kind: 'missing'; project: Project };

type OpenOptions = Omit<OpenRequest, 'projectId'>;

/*
 * Opening a project from the list: the request to the main process, and the
 * questions it may come back with, one at a time, until the project opens or
 * the user gives up. The window moves to the project screen once it opens.
 * */
export default function useOpenProject() {
  const navigate = useNavigate();
  const toast = usePlToast();
  const [t] = useTranslation();
  // The project being opened from a click on the list, which the screen shows a loading screen for
  const [opening, setOpening] = useState<Project | null>(null);
  // Whether a dialog's request is on its way, which its buttons show
  const [busy, setBusy] = useState(false);
  const [question, setQuestion] = useState<OpenQuestion | null>(null);
  // The tabs a restored window had, kept through the questions until the project opens
  const restoring = useRef<{ projectId: number; layout: WorkspaceLayout } | null>(null);

  const request = async (project: Project, options: OpenOptions): Promise<OpenResult> => {
    try {
      return await window.mainApi.invoke(mainChannels.openProject, {
        projectId: project.id,
        ...options,
      });
    } catch (error) {
      return {
        status: 'error',
        code: 'INTERNAL',
        message: error instanceof Error ? error.message : String(error),
      };
    }
  };

  const answer = (project: Project, options: OpenOptions, result: OpenResult): void => {
    switch (result.status) {
      case 'opened': {
        const layout =
          restoring.current?.projectId === project.id ? restoring.current.layout : null;

        restoring.current = null;
        setQuestion(null);
        navigate(`/project/${project.id}`, { state: layout ? { layout } : null });

        return;
      }
      case 'open-elsewhere':
        setQuestion(null);
        toast.add({ title: t('home.open-elsewhere', { name: project.name }), color: 'info' });

        return;
      case 'missing':
        setQuestion({ kind: 'missing', project });

        return;
      case 'needs-password': {
        const typed = options.password !== undefined;

        setQuestion({
          kind: 'password',
          project,
          wrong: result.retry ? (typed ? 'typed' : 'saved') : null,
        });

        return;
      }
      case 'needs-upgrade':
        setQuestion({
          kind: 'upgrade',
          project,
          formatVersion: result.formatVersion,
          newestVersion: result.newestVersion,
          password: options.password,
          rememberPassword: options.rememberPassword ?? false,
        });

        return;
      case 'not-database':
        setQuestion(null);
        toast.add({ title: t('home.not-database', { name: project.name }), color: 'danger' });

        return;
      default:
        setQuestion(null);
        toast.add({
          title: t('home.open-failed', { name: project.name, message: result.message }),
          color: 'danger',
        });
    }
  };

  /*
   * Opens `project` from a click on the list, or as the app restores its last
   * windows, with the tabs `layout` lists
   * */
  const open = async (project: Project, layout: WorkspaceLayout | null = null): Promise<void> => {
    restoring.current = layout ? { projectId: project.id, layout } : null;
    setOpening(project);

    const result = await request(project, {});

    // The project screen takes over with a loading screen of its own
    if (result.status !== 'opened') {
      setOpening(null);
    }

    answer(project, {}, result);
  };

  /* Tries again with what a dialog asked for: a password, or how to raise the file */
  const retry = async (project: Project, options: OpenOptions): Promise<void> => {
    setBusy(true);

    try {
      answer(project, options, await request(project, options));
    } finally {
      setBusy(false);
    }
  };

  return {
    opening,
    busy,
    question,
    open,
    dismiss: () => {
      restoring.current = null;
      setQuestion(null);
    },
    withPassword: (project: Project, password: string, rememberPassword: boolean) =>
      retry(project, { password, rememberPassword }),
    withUpgrade: (question: Extract<OpenQuestion, { kind: 'upgrade' }>, upgrade: UpgradeChoice) =>
      retry(question.project, {
        upgrade,
        ...(question.password === undefined
          ? {}
          : { password: question.password, rememberPassword: question.rememberPassword }),
      }),
  };
}
