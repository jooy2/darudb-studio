import { BrowserWindow, type Rectangle, type WebContents } from 'electron';
import { isWindowState, type WindowState } from '@/common/workspace';
import { getStore, queueWrite } from './store';

/*
 * The windows the app has open, kept in the app's data file as they change,
 * so the next launch can open them again when the settings ask for it.
 *
 * Each window reports what it shows, and its place on the screen is read
 * from its own events. The list is written a moment after the last change,
 * and at once when the app quits.
 *
 * The windows that close while the app quits stay on the list: they are the
 * ones the user left open. So does the last window to close, which on Windows
 * and Linux is how the app is quit. Any other window that closes leaves it,
 * from the moment its close goes ahead: the app may begin to quit before the
 * window is gone, and it is not one the user left open.
 * */

/* A window as the next launch opens it */
export interface SavedWindow extends WindowState {
  bounds: Rectangle;
  maximized: boolean;
  fullScreen: boolean;
}

const WORKSPACE = 'workspace';

// How long a change waits before the list is written, so a resize writes once
const SAVE_DELAY_MS = 800;

/* The ids of the windows on the list, in the order they opened */
let order: number[] = [];
const states = new Map<number, WindowState>();
const places = new Map<number, Pick<SavedWindow, 'bounds' | 'maximized' | 'fullScreen'>>();
/* The windows that closed last and stay on the list, until another one opens */
const keptClosed = new Set<number>();
/* The windows the user closed outside a quit, which may still be going as it begins */
const closing = new Set<number>();
/* What each window is to open, by the id of its web contents, until it asks */
const restores = new Map<number, WindowState>();

let quitting = false;
let timer: ReturnType<typeof setTimeout> | undefined;

const snapshot = (): SavedWindow[] => {
  // A window still closing stays on the list only when no other is open, as
  // the last window to close does
  const open = order.filter((id) => !closing.has(id));

  return (open.length > 0 ? open : order).flatMap((id) => {
    const place = places.get(id);

    return place ? [{ ...place, ...(states.get(id) ?? { projectId: null, layout: null }) }] : [];
  });
};

/* Writes the list now, after the writes before it */
export const saveWorkspace = async (): Promise<void> => {
  clearTimeout(timer);
  timer = undefined;

  if (!getStore()) {
    return;
  }

  const value = JSON.stringify({ windows: snapshot() });

  await queueWrite((store) =>
    store.writeAsync(async (txn) => {
      await txn.collection('state').put({ name: WORKSPACE, value });
    }),
  ).catch((error: unknown) => {
    console.error('Failed to keep the open windows:', error);
  });
};

const changed = (): void => {
  if (quitting) {
    return;
  }

  clearTimeout(timer);
  timer = setTimeout(() => void saveWorkspace(), SAVE_DELAY_MS);
};

const forget = (id: number): void => {
  order = order.filter((each) => each !== id);
  states.delete(id);
  places.delete(id);
  closing.delete(id);
};

/* Puts `window` on the list, and follows it until it closes */
export const trackWindow = (window: BrowserWindow): void => {
  const { id } = window;

  // A window opening after the last one closed starts the list over
  keptClosed.forEach(forget);
  keptClosed.clear();
  order.push(id);

  const measure = (): void => {
    if (window.isDestroyed()) {
      return;
    }

    places.set(id, {
      bounds: window.getNormalBounds(),
      maximized: window.isMaximized(),
      fullScreen: window.isFullScreen(),
    });
    changed();
  };

  measure();

  window.on('resize', measure);
  window.on('move', measure);
  window.on('maximize', measure);
  window.on('unmaximize', measure);
  window.on('enter-full-screen', measure);
  window.on('leave-full-screen', measure);

  window.on('close', () => {
    if (!quitting) {
      closing.add(id);
    }
  });

  window.on('closed', () => {
    if (quitting) {
      return;
    }

    closing.delete(id);

    const others = order.filter((each) => each !== id && !keptClosed.has(each));

    if (others.length === 0) {
      keptClosed.add(id);
      void saveWorkspace();

      return;
    }

    forget(id);
    changed();
  });
};

/* Records what `window` shows, as the window reports it */
export const reportWindowState = (window: BrowserWindow | null, state: unknown): void => {
  if (!window || quitting || !order.includes(window.id) || !isWindowState(state)) {
    return;
  }

  states.set(window.id, { projectId: state.projectId, layout: state.layout });
  changed();
};

/*
 * Stops following the windows, which close as the app quits, and writes the
 * list as it stands. `resumeWorkspace` follows them again when a window
 * calls the quit off, or its own close.
 * */
export const freezeWorkspace = (): Promise<void> => {
  quitting = true;

  return saveWorkspace();
};

export const resumeWorkspace = (window: BrowserWindow): void => {
  quitting = false;
  closing.delete(window.id);
};

/* The windows the app had open when it last quit, read from the data file */
export const loadWorkspace = async (): Promise<SavedWindow[]> => {
  const store = getStore();

  if (!store) {
    return [];
  }

  try {
    const stored = await store.readAsync((txn) => txn.collection('state').get(WORKSPACE));
    const parsed: unknown = stored ? JSON.parse(stored.value) : null;
    const windows = (parsed as { windows?: unknown } | null)?.windows;

    if (!Array.isArray(windows)) {
      return [];
    }

    // The file is the user's to reach, so a window that does not read is left out
    return windows.filter((each): each is SavedWindow => {
      const bounds = (each as Partial<SavedWindow> | null)?.bounds;

      return (
        isWindowState(each) &&
        typeof bounds === 'object' &&
        bounds !== null &&
        [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) &&
        typeof (each as SavedWindow).maximized === 'boolean' &&
        typeof (each as SavedWindow).fullScreen === 'boolean'
      );
    });
  } catch (error) {
    console.error('Failed to read the windows the app had open:', error);

    return [];
  }
};

/* Leaves what the window of `contents` is to open, for it to ask once its page loads */
export const setRestore = (contents: WebContents, state: WindowState): void => {
  restores.set(contents.id, state);
  contents.once('destroyed', () => restores.delete(contents.id));
};

/* What the window of `contents` is to open, once: a later ask gets nothing */
export const takeRestore = (contents: WebContents): WindowState | null => {
  const state = restores.get(contents.id) ?? null;

  restores.delete(contents.id);

  return state;
};
