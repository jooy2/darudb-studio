import { useCallback, useEffect, useRef, useState } from 'react';
import { mainChannels, rendererChannels } from '@/common/ipc';
import type { Project } from '@/common/projects';

/*
 * The projects, read from the main process as the window starts and again
 * whenever any window creates, changes, deletes or opens one. `null` until
 * the first read answers.
 * */
export default function useProjects(): {
  projects: Project[] | null;
  refresh: () => Promise<void>;
} {
  const [projects, setProjects] = useState<Project[] | null>(null);
  // Reads can overlap, and only the newest one's answer is kept
  const latestRead = useRef(0);

  const refresh = useCallback(async (): Promise<void> => {
    latestRead.current += 1;

    const read = latestRead.current;
    const listed = await window.mainApi.invoke(mainChannels.listProjects);

    if (read === latestRead.current) {
      setProjects(listed);
    }
  }, []);

  useEffect(() => {
    void refresh();

    return window.mainApi.on(rendererChannels.projectsChanged, () => {
      void refresh();
    });
  }, [refresh]);

  return { projects, refresh };
}
