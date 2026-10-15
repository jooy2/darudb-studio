import { useCallback, useEffect, useRef, useState } from 'react';
import { mainChannels, rendererChannels } from '@/common/ipc';
import type { Project } from '@/common/projects';

// The list as this window last read it, which a screen coming back to the
// list shows at once while it reads the list again
let lastRead: Project[] | null = null;

/*
 * The projects, read from the main process as the window starts and again
 * whenever any window creates, changes, deletes or opens one. `null` until
 * the first read of the window answers.
 * */
export default function useProjects(): {
  projects: Project[] | null;
  refresh: () => Promise<void>;
} {
  const [projects, setProjects] = useState<Project[] | null>(lastRead);
  // Reads can overlap, and only the newest one's answer is kept
  const latestRead = useRef(0);

  const refresh = useCallback(async (): Promise<void> => {
    latestRead.current += 1;

    const read = latestRead.current;
    const listed = await window.mainApi.invoke(mainChannels.listProjects);

    if (read === latestRead.current) {
      lastRead = listed;
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
