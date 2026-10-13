import { access, rm } from 'fs/promises';
import { isAbsolute, join, relative } from 'path';
import { app } from 'electron';
import { PROJECT_NAME_MAX_LENGTH, type Project, type ProjectDraft } from '@/common/projects';
import { getStore, queueWrite } from './store';
import { canRememberSecrets, openSecret, sealSecret } from './secrets';

/*
 * The projects, kept in the `projects` collection of the app's data file (see
 * `store.ts`). A project is read from the file each time it is asked for,
 * since several windows change the list, and the list is small.
 *
 * What a renderer sends is checked here before it is stored: a name within
 * bounds, and an absolute path. A remembered password is sealed by
 * `secrets.ts` and never handed back to a renderer.
 * */

/* A project as the file holds it */
interface StoredProject {
  id: number;
  name: string;
  filePath: string;
  sourcePath: string | null;
  password: Uint8Array | null;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number | null;
}

/*
 * The folder the app keeps the working copies it makes in, inside the user
 * data folder. A project's file inside it is the app's to delete with the
 * project; any other file is the user's and is never deleted.
 * */
export const workingCopiesPath = (): string => join(app.getPath('userData'), 'databases');

const isWorkingCopy = (path: string): boolean => {
  const inside = relative(workingCopiesPath(), path);

  return inside !== '' && !inside.startsWith('..') && !isAbsolute(inside);
};

const exists = async (path: string): Promise<boolean> => {
  try {
    await access(path);

    return true;
  } catch {
    return false;
  }
};

const projectOf = async (stored: StoredProject): Promise<Project> => ({
  id: stored.id,
  name: stored.name,
  filePath: stored.filePath,
  sourcePath: stored.sourcePath,
  hasPassword: stored.password !== null,
  createdAt: stored.createdAt,
  updatedAt: stored.updatedAt,
  lastOpenedAt: stored.lastOpenedAt,
  missing: !(await exists(stored.filePath)),
});

const storeOrFail = () => {
  const store = getStore();

  if (!store) {
    throw new Error('the app data file is not open, so projects cannot be kept');
  }

  return store;
};

const storedProject = async (id: number): Promise<StoredProject | null> => {
  const found = await storeOrFail().readAsync((txn) => txn.collection('projects').get(id));

  return (found as StoredProject | null) ?? null;
};

/* Every project, the most recently opened first, then the newest */
export const listProjects = async (): Promise<Project[]> => {
  const store = getStore();

  if (!store) {
    return [];
  }

  const stored = (await store.readAsync((txn) =>
    txn.collection('projects').find(),
  )) as StoredProject[];

  stored.sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0) || b.createdAt - a.createdAt);

  return Promise.all(stored.map(projectOf));
};

export const getProject = async (id: number): Promise<Project | null> => {
  const stored = await storedProject(id);

  return stored ? projectOf(stored) : null;
};

/* Throws when `draft` cannot be stored, with what is wrong */
const checkDraft = (draft: ProjectDraft): { name: string; filePath: string } => {
  const name = typeof draft?.name === 'string' ? draft.name.trim() : '';

  if (name === '' || name.length > PROJECT_NAME_MAX_LENGTH) {
    throw new Error(`a project's name has 1 to ${PROJECT_NAME_MAX_LENGTH} characters`);
  }

  if (typeof draft.filePath !== 'string' || !isAbsolute(draft.filePath)) {
    throw new Error("a project's file is an absolute path");
  }

  if (
    draft.password !== undefined &&
    draft.password !== null &&
    typeof draft.password !== 'string'
  ) {
    throw new Error('a password is a string');
  }

  return { name, filePath: draft.filePath };
};

/* The sealed form of what the draft says about the password: kept, replaced or forgotten */
const passwordOf = (
  draft: ProjectDraft,
  kept: Uint8Array | null,
): Uint8Array | null | undefined => {
  if (draft.password === undefined) {
    return kept;
  }

  if (draft.password === null || draft.password === '') {
    return null;
  }

  if (!canRememberSecrets()) {
    throw new Error('this system has no keystore to keep a password in');
  }

  return sealSecret(draft.password);
};

/*
 * Creates the project `draft` describes, or changes the one its `id` names,
 * and resolves with it. A file changed to another one leaves the working copy
 * it replaces behind as the user's.
 * */
export const saveProject = async (draft: ProjectDraft): Promise<Project> => {
  const { name, filePath } = checkDraft(draft);
  const now = Date.now();
  let saved: StoredProject;

  if (draft.id === undefined) {
    saved = {
      id: 0,
      name,
      filePath,
      sourcePath: null,
      password: passwordOf(draft, null) ?? null,
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: null,
    };

    await queueWrite((store) =>
      store.writeAsync(async (txn) => {
        const { id: _id, ...fields } = saved;

        saved.id = Number(await txn.collection('projects').insert(fields));
      }),
    );
  } else {
    const current = await storedProject(draft.id);

    if (!current) {
      throw new Error('the project no longer exists');
    }

    const fileChanged = current.filePath !== filePath;

    saved = {
      ...current,
      name,
      filePath,
      // A file the user picks again is not the copy the app made any more
      sourcePath: fileChanged ? null : current.sourcePath,
      password: passwordOf(draft, current.password) ?? null,
      updatedAt: now,
    };

    await queueWrite((store) =>
      store.writeAsync(async (txn) => {
        await txn.collection('projects').put(saved);
      }),
    );
  }

  return projectOf(saved);
};

/*
 * Deletes the project, and the working copy the app made for it, which lives
 * in the app's data folder. A file the user picked stays where it is.
 * */
export const deleteProject = async (id: number): Promise<void> => {
  const current = await storedProject(id);

  if (!current) {
    return;
  }

  await queueWrite((store) =>
    store.writeAsync(async (txn) => {
      await txn.collection('projects').delete(id);
    }),
  );

  if (current.sourcePath !== null && isWorkingCopy(current.filePath)) {
    await rm(current.filePath, { force: true });
  }
};

/* The remembered password of the project, or `null` without one or when it cannot be read */
export const rememberedPassword = async (id: number): Promise<string | null> => {
  const stored = await storedProject(id);

  return stored?.password ? openSecret(stored.password) : null;
};

/* Remembers `password` for the project, or forgets the remembered one with `null` */
export const rememberPassword = async (id: number, password: string | null): Promise<void> => {
  const current = await storedProject(id);

  if (!current) {
    return;
  }

  const sealed = password === null ? null : sealSecret(password);

  await queueWrite((store) =>
    store.writeAsync(async (txn) => {
      await txn.collection('projects').update(id, { password: sealed, updatedAt: Date.now() });
    }),
  );
};

/* Records that the project was opened, which orders the list */
export const markOpened = async (id: number): Promise<void> => {
  await queueWrite((store) =>
    store.writeAsync(async (txn) => {
      await txn.collection('projects').update(id, { lastOpenedAt: Date.now() });
    }),
  );
};

/*
 * Points the project at `copyPath`, a working copy of `sourcePath` the app
 * made, so that it opens the copy from now on.
 * */
export const useWorkingCopy = async (
  id: number,
  copyPath: string,
  sourcePath: string,
): Promise<void> => {
  await queueWrite((store) =>
    store.writeAsync(async (txn) => {
      await txn
        .collection('projects')
        .update(id, { filePath: copyPath, sourcePath, updatedAt: Date.now() });
    }),
  );
};
