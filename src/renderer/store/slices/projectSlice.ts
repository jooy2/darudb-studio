import { createSelector, createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import type { AppThunk, RootState } from '@/renderer/store';
import {
  changesOf,
  stageDelete,
  stageInsert,
  stageInsertUpdate,
  stageUpdate,
  unstageInsert,
  type PendingEdit,
} from '@/renderer/project/pending';
import { mainChannels } from '@/common/ipc';
import type {
  BackupReport,
  Change,
  CheckReport,
  CompactReport,
  Key,
  Row,
  SortKey,
  ToolResult,
} from '@/common/data';
import type { Session } from '@/common/projects';
import type { TabKind, WorkspaceLayout } from '@/common/workspace';

/*
 * The project a window has open, as its screen works on it: the file's schema
 * and counts, the tabs and the groups they are split into, and the edits held
 * back for a submit.
 * */

export type { TabKind };

export interface WorkspaceTab {
  id: string;
  kind: TabKind;
  /* The collection a collection tab shows, or a query tab runs on */
  collection: string | null;
  /* A query tab's number, as its title gives it */
  number: number;
  /* A collection tab's filter, in the query language */
  filter: string;
  sort: SortKey[];
  /* A query tab's text */
  text: string;
}

/* Tabs shown side by side: a strip of them, and the one in front */
export interface TabGroup {
  id: string;
  tabIds: string[];
  activeTabId: string | null;
}

export type StatusTone = 'info' | 'success' | 'danger';

export interface StatusMessage {
  text: string;
  tone: StatusTone;
}

export type Tool = 'check' | 'compact' | 'backup';

/* What each tool found or did the last time it ran */
export interface ToolReports {
  check: ToolResult<CheckReport> | null;
  compact: ToolResult<CompactReport> | null;
  backup: ToolResult<BackupReport> | null;
}

/* An object of a grid, by its key, or by the id of the insert that waits to add it */
export type ObjectTarget = { key: Key } | { insertId: string };

// At most this many groups side by side, which keeps each wide enough for a grid
export const MAX_GROUPS = 4;

export interface ProjectState {
  session: Session | null;
  counts: Record<string, number>;
  tabs: Record<string, WorkspaceTab>;
  groups: TabGroup[];
  focusedGroupId: string | null;
  pending: PendingEdit[];
  /* Raised by every write and refresh, which the grids read again on */
  revision: number;
  lastId: number;
  lastQuery: number;
  status: StatusMessage | null;
  /* What the focused grid has selected, for the status bar */
  selection: { count: number; total: number } | null;
  toolReports: ToolReports;
  /* The tool that is running, which its button shows */
  runningTool: Tool | null;
}

/* A state with nothing open, made anew each time, since a reducer fills in its parts */
const emptyState = (): ProjectState => ({
  session: null,
  counts: {},
  tabs: {},
  groups: [],
  focusedGroupId: null,
  pending: [],
  revision: 0,
  lastId: 0,
  lastQuery: 0,
  status: null,
  selection: null,
  toolReports: { check: null, compact: null, backup: null },
  runningTool: null,
});

const newId = (state: ProjectState, prefix: string): string => {
  state.lastId += 1;

  return `${prefix}-${state.lastId}`;
};

const groupOfTab = (state: ProjectState, tabId: string): TabGroup | undefined =>
  state.groups.find((group) => group.tabIds.includes(tabId));

const focusedGroup = (state: ProjectState): TabGroup => {
  const found = state.groups.find((group) => group.id === state.focusedGroupId);

  if (found) {
    return found;
  }

  if (state.groups.length > 0) {
    return state.groups[0];
  }

  const group: TabGroup = { id: newId(state, 'group'), tabIds: [], activeTabId: null };

  state.groups.push(group);
  state.focusedGroupId = group.id;

  return group;
};

/* Puts `tab` in front of the focused group, or of a new group to the right */
const addTab = (state: ProjectState, tab: WorkspaceTab, inNewGroup = false): void => {
  state.tabs[tab.id] = tab;

  let group = focusedGroup(state);

  if (inNewGroup && state.groups.length < MAX_GROUPS && group.tabIds.length > 0) {
    const created: TabGroup = { id: newId(state, 'group'), tabIds: [], activeTabId: null };

    state.groups.splice(state.groups.indexOf(group) + 1, 0, created);
    group = created;
  }

  const at = group.activeTabId ? group.tabIds.indexOf(group.activeTabId) + 1 : group.tabIds.length;

  group.tabIds.splice(at, 0, tab.id);
  group.activeTabId = tab.id;
  state.focusedGroupId = group.id;
};

const activate = (state: ProjectState, tabId: string): void => {
  const group = groupOfTab(state, tabId);

  if (group) {
    group.activeTabId = tabId;
    state.focusedGroupId = group.id;
  }
};

/* Takes `tabId` out of its group, and the group out of the row once it is empty */
const detach = (state: ProjectState, tabId: string): void => {
  const group = groupOfTab(state, tabId);

  if (!group) {
    return;
  }

  const index = group.tabIds.indexOf(tabId);

  group.tabIds.splice(index, 1);

  if (group.activeTabId === tabId) {
    group.activeTabId = group.tabIds[Math.min(index, group.tabIds.length - 1)] ?? null;
  }

  if (group.tabIds.length === 0 && state.groups.length > 1) {
    const at = state.groups.indexOf(group);

    state.groups.splice(at, 1);

    if (state.focusedGroupId === group.id) {
      state.focusedGroupId = state.groups[Math.max(0, at - 1)].id;
    }
  }
};

const collectionTab = (state: ProjectState, collection: string): WorkspaceTab => ({
  id: newId(state, 'tab'),
  kind: 'collection',
  collection,
  number: 0,
  filter: '',
  sort: [],
  text: '',
});

export const projectSlice = createSlice({
  name: 'project',
  initialState: emptyState(),
  reducers: {
    /* A project opened in the window: its first collection opens in a tab */
    sessionLoaded: (_state, action: PayloadAction<Session>) => {
      const state: ProjectState = { ...emptyState(), session: action.payload };
      const [first] = action.payload.schema?.collections ?? [];

      if (first) {
        addTab(state, collectionTab(state, first.name));
      }

      return state;
    },
    sessionClosed: () => emptyState(),
    /*
     * Opens the tabs a saved layout lists, in place of the ones the project
     * opened with. A tab of a collection the file no longer has is left out,
     * and a layout with nothing left keeps the tabs as they are.
     * */
    layoutRestored: (state, action: PayloadAction<WorkspaceLayout>) => {
      const known = new Set(state.session?.schema?.collections.map(({ name }) => name) ?? []);
      const tabs: Record<string, WorkspaceTab> = {};
      const groups: TabGroup[] = [];
      let queries = 0;

      for (const saved of action.payload.groups.slice(0, MAX_GROUPS)) {
        const group: TabGroup = { id: newId(state, 'group'), tabIds: [], activeTabId: null };

        saved.tabs.forEach((tab, at) => {
          // A query tab may have had no collection chosen yet
          const fits =
            tab.kind === 'tools' ||
            (tab.collection === null ? tab.kind === 'query' : known.has(tab.collection));

          if (!fits) {
            return;
          }

          const id = newId(state, 'tab');

          if (tab.kind === 'query') {
            queries += 1;
          }

          tabs[id] = {
            id,
            kind: tab.kind,
            collection: tab.kind === 'tools' ? null : tab.collection,
            number: tab.kind === 'query' ? queries : 0,
            filter: tab.filter,
            sort: tab.sort,
            text: tab.text,
          };
          group.tabIds.push(id);

          if (at === saved.active || group.activeTabId === null) {
            group.activeTabId = id;
          }
        });

        if (group.tabIds.length > 0) {
          groups.push(group);
        }
      }

      if (groups.length === 0) {
        return;
      }

      state.tabs = tabs;
      state.groups = groups;
      state.focusedGroupId = groups[Math.min(action.payload.focusedGroup, groups.length - 1)].id;
      state.lastQuery = queries;
    },
    sessionUpdated: (state, action: PayloadAction<Session>) => {
      state.session = action.payload;
    },
    countsLoaded: (state, action: PayloadAction<Record<string, number>>) => {
      state.counts = action.payload;
    },
    /* Brings the collection's tab forward, or opens one, in a new group when asked */
    openCollection: (
      state,
      action: PayloadAction<{ collection: string; inNewGroup?: boolean }>,
    ) => {
      const { collection, inNewGroup = false } = action.payload;
      const open = Object.values(state.tabs).find(
        (tab) => tab.kind === 'collection' && tab.collection === collection,
      );

      if (open && !inNewGroup) {
        activate(state, open.id);

        return;
      }

      addTab(state, collectionTab(state, collection), inNewGroup);
    },
    openQuery: (state, action: PayloadAction<{ collection: string | null }>) => {
      state.lastQuery += 1;
      addTab(state, {
        id: newId(state, 'tab'),
        kind: 'query',
        collection: action.payload.collection,
        number: state.lastQuery,
        filter: '',
        sort: [],
        text: '',
      });
    },
    openTools: (state) => {
      const open = Object.values(state.tabs).find((tab) => tab.kind === 'tools');

      if (open) {
        activate(state, open.id);
      } else {
        addTab(state, {
          id: newId(state, 'tab'),
          kind: 'tools',
          collection: null,
          number: 0,
          filter: '',
          sort: [],
          text: '',
        });
      }
    },
    toolStarted: (state, action: PayloadAction<Tool>) => {
      state.runningTool = action.payload;
    },
    toolFinished: (
      state,
      action: PayloadAction<
        | { tool: 'check'; result: ToolReports['check'] }
        | { tool: 'compact'; result: ToolReports['compact'] }
        | { tool: 'backup'; result: ToolReports['backup'] }
      >,
    ) => {
      const { tool, result } = action.payload;

      state.runningTool = null;
      Object.assign(state.toolReports, { [tool]: result });
    },
    activateTab: (state, action: PayloadAction<string>) => {
      activate(state, action.payload);
    },
    focusGroup: (state, action: PayloadAction<string>) => {
      if (state.groups.some((group) => group.id === action.payload)) {
        state.focusedGroupId = action.payload;
      }
    },
    closeTab: (state, action: PayloadAction<string>) => {
      detach(state, action.payload);
      delete state.tabs[action.payload];
    },
    closeOtherTabs: (state, action: PayloadAction<string>) => {
      const group = groupOfTab(state, action.payload);

      group?.tabIds
        .filter((id) => id !== action.payload)
        .forEach((id) => {
          detach(state, id);
          delete state.tabs[id];
        });
    },
    /* Moves a tab into another group, at `index` or at the end: a merge when its group empties */
    moveTab: (state, action: PayloadAction<{ tabId: string; groupId: string; index?: number }>) => {
      const { tabId, groupId, index } = action.payload;
      const source = groupOfTab(state, tabId);
      const target = state.groups.find((group) => group.id === groupId);

      if (!source || !target) {
        return;
      }

      const sourceIndex = source.tabIds.indexOf(tabId);
      let at = index ?? target.tabIds.length;

      // Moving within one strip, the gap the tab leaves shifts the ones after it
      if (source === target && sourceIndex < at) {
        at -= 1;
      }

      detach(state, tabId);
      at = Math.min(Math.max(at, 0), target.tabIds.length);
      target.tabIds.splice(at, 0, tabId);
      target.activeTabId = tabId;
      state.focusedGroupId = target.id;
    },
    /*
     * Moves a tab into a new group beside `groupId`, its own by default, to the
     * right or the left. A tab alone in its group does not split from itself.
     * */
    splitTab: (
      state,
      action: PayloadAction<{ tabId: string; groupId?: string; side?: 'left' | 'right' }>,
    ) => {
      const { tabId, side = 'right' } = action.payload;
      const source = groupOfTab(state, tabId);
      const beside = state.groups.find(
        (group) => group.id === (action.payload.groupId ?? source?.id),
      );

      if (!source || !beside || state.groups.length >= MAX_GROUPS) {
        return;
      }

      if (beside === source && source.tabIds.length < 2) {
        return;
      }

      const group: TabGroup = { id: newId(state, 'group'), tabIds: [], activeTabId: null };

      detach(state, tabId);
      state.groups.splice(state.groups.indexOf(beside) + (side === 'right' ? 1 : 0), 0, group);
      group.tabIds.push(tabId);
      group.activeTabId = tabId;
      state.focusedGroupId = group.id;
    },
    /* Moves every tab of the group into the one to its left, which ends the split */
    mergeGroup: (state, action: PayloadAction<string>) => {
      const at = state.groups.findIndex((group) => group.id === action.payload);

      if (at < 0 || state.groups.length < 2) {
        return;
      }

      const [group] = state.groups.splice(at, 1);
      const into = state.groups[Math.max(0, at - 1)];

      into.tabIds.push(...group.tabIds);
      into.activeTabId = group.activeTabId ?? into.activeTabId;
      state.focusedGroupId = into.id;
    },
    updateTab: (
      state,
      action: PayloadAction<{
        tabId: string;
        changes: Partial<Pick<WorkspaceTab, 'filter' | 'sort' | 'text' | 'collection'>>;
      }>,
    ) => {
      const tab = state.tabs[action.payload.tabId];

      if (tab) {
        Object.assign(tab, action.payload.changes);
      }
    },
    pendingChanged: (state, action: PayloadAction<PendingEdit[]>) => {
      state.pending = action.payload;
    },
    revisionRaised: (state) => {
      state.revision += 1;
    },
    statusChanged: (state, action: PayloadAction<StatusMessage | null>) => {
      state.status = action.payload;
    },
    selectionChanged: (state, action: PayloadAction<{ count: number; total: number } | null>) => {
      state.selection = action.payload;
    },
  },
});

export const {
  sessionLoaded,
  sessionClosed,
  layoutRestored,
  sessionUpdated,
  countsLoaded,
  openCollection,
  openQuery,
  openTools,
  toolStarted,
  toolFinished,
  activateTab,
  focusGroup,
  closeTab,
  closeOtherTabs,
  moveTab,
  splitTab,
  mergeGroup,
  updateTab,
  pendingChanged,
  revisionRaised,
  statusChanged,
  selectionChanged,
} = projectSlice.actions;

/* The tab groups as the next launch opens them again, the same object while they stay the same */
export const selectLayout = createSelector(
  [
    (state: RootState) => state.project.groups,
    (state: RootState) => state.project.tabs,
    (state: RootState) => state.project.focusedGroupId,
  ],
  (groups, tabs, focusedGroupId): WorkspaceLayout => ({
    groups: groups.map((group) => ({
      tabs: group.tabIds.flatMap((id) => {
        const tab = tabs[id];

        return tab
          ? [
              {
                kind: tab.kind,
                collection: tab.collection,
                filter: tab.filter,
                sort: tab.sort,
                text: tab.text,
              },
            ]
          : [];
      }),
      active: Math.max(0, group.activeTabId ? group.tabIds.indexOf(group.activeTabId) : 0),
    })),
    focusedGroup: Math.max(
      0,
      groups.findIndex((group) => group.id === focusedGroupId),
    ),
  }),
);

/* Reads the counts of every collection again */
export const loadCounts = (): AppThunk<Promise<void>> => async (dispatch) => {
  const result = await window.mainApi.invoke(mainChannels.countObjects);

  if (result.status === 'ok') {
    dispatch(countsLoaded(result.counts));
  }
};

/* Reads everything again: the session, the counts and every grid */
export const refreshProject = (): AppThunk<Promise<void>> => async (dispatch) => {
  dispatch(revisionRaised());

  const session = await window.mainApi.invoke(mainChannels.requestSession);

  if (session) {
    dispatch(sessionUpdated(session));
  }

  await dispatch(loadCounts());
};

/*
 * What an edit ended in: `null` once it is written or held, or the engine's
 * message when it was refused, which the status bar shows too.
 * */
export type EditOutcome = string | null;

/*
 * Writes `changes` in one transaction, then reads the grids and the counts
 * again. `done` is what the status bar says once it is written, and `failed`
 * words the engine's error for it.
 * */
export const writeNow =
  (
    changes: Change[],
    done: string,
    failed: (message: string) => string,
  ): AppThunk<Promise<EditOutcome>> =>
  async (dispatch) => {
    const result = await window.mainApi.invoke(mainChannels.writeChanges, changes);

    if (result.status === 'error') {
      dispatch(statusChanged({ text: failed(result.message), tone: 'danger' }));

      return result.message;
    }

    dispatch(statusChanged({ text: done, tone: 'success' }));
    dispatch(revisionRaised());
    await dispatch(loadCounts());

    return null;
  };

/* The texts the edit thunks put in the status bar, in the window's language */
export interface EditTexts {
  saved: string;
  staged: string;
  failed: (message: string) => string;
}

/*
 * Changes fields of an object: written at once, or held for a submit, as the
 * settings say. An object still to be inserted is always held, since it is.
 * */
export const editObject =
  (
    collection: string,
    target: ObjectTarget,
    values: Row,
    texts: EditTexts,
  ): AppThunk<Promise<EditOutcome>> =>
  async (dispatch, getState) => {
    const { settings, project } = getState();

    if ('insertId' in target) {
      dispatch(pendingChanged(stageInsertUpdate(project.pending, target.insertId, values)));

      return null;
    }

    if (settings.editMode === 'submit') {
      dispatch(pendingChanged(stageUpdate(project.pending, collection, target.key, values)));
      dispatch(statusChanged({ text: texts.staged, tone: 'info' }));

      return null;
    }

    return dispatch(
      writeNow(
        [{ kind: 'update', collection, key: target.key, values }],
        texts.saved,
        texts.failed,
      ),
    );
  };

export const insertObject =
  (collection: string, object: Row, texts: EditTexts): AppThunk<Promise<EditOutcome>> =>
  async (dispatch, getState) => {
    const { settings, project } = getState();

    if (settings.editMode === 'submit') {
      dispatch(pendingChanged(stageInsert(project.pending, collection, object).pending));
      dispatch(statusChanged({ text: texts.staged, tone: 'info' }));

      return null;
    }

    return dispatch(writeNow([{ kind: 'insert', collection, object }], texts.saved, texts.failed));
  };

export const deleteObjects =
  (collection: string, targets: ObjectTarget[], texts: EditTexts): AppThunk<Promise<EditOutcome>> =>
  async (dispatch, getState) => {
    const { settings, project } = getState();
    let pending = project.pending;
    const written: Change[] = [];

    for (const target of targets) {
      if ('insertId' in target) {
        pending = unstageInsert(pending, target.insertId);
      } else if (settings.editMode === 'submit') {
        pending = stageDelete(pending, collection, target.key);
      } else {
        written.push({ kind: 'delete', collection, key: target.key });
      }
    }

    dispatch(pendingChanged(pending));

    if (written.length === 0) {
      dispatch(statusChanged({ text: texts.staged, tone: 'info' }));

      return null;
    }

    return dispatch(writeNow(written, texts.saved, texts.failed));
  };

/* Writes every held edit in one transaction; when one is refused, every one stays held */
export const submitPending =
  (done: string, failed: (message: string) => string): AppThunk<Promise<EditOutcome>> =>
  async (dispatch, getState) => {
    const { pending } = getState().project;

    if (pending.length === 0) {
      return null;
    }

    const refused = await dispatch(writeNow(changesOf(pending), done, failed));

    if (refused === null) {
      dispatch(pendingChanged([]));
    }

    return refused;
  };

/*
 * Runs a tool and keeps what it found for the tools tab, which it brings
 * forward. `backupTitle` titles the save dialog a backup asks where with.
 * */
export const runTool =
  (
    tool: Tool,
    backupTitle: string,
    backupDone: (path: string) => string,
  ): AppThunk<Promise<void>> =>
  async (dispatch, getState) => {
    if (getState().project.runningTool !== null) {
      return;
    }

    dispatch(openTools());
    dispatch(toolStarted(tool));

    if (tool === 'check') {
      const result = await window.mainApi.invoke(mainChannels.checkDatabase);

      dispatch(toolFinished({ tool, result }));
    } else if (tool === 'compact') {
      const result = await window.mainApi.invoke(mainChannels.compactDatabase);

      dispatch(toolFinished({ tool, result }));
      // The file is smaller now, which the status bar shows
      await dispatch(refreshProject());
    } else {
      const result = await window.mainApi.invoke(mainChannels.backupDatabase, backupTitle);

      dispatch(toolFinished({ tool, result }));

      if (result.status === 'ok') {
        dispatch(statusChanged({ text: backupDone(result.report.path), tone: 'success' }));
      }
    }
  };

export default projectSlice.reducer;
