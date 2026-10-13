import type { SortKey } from './data';

/*
 * What a window was doing, as the app keeps it to open the same windows,
 * projects and tabs on the next launch, when the settings ask for that.
 * Shared by the three processes.
 *
 * A window reports its state to the main process as it changes, and the main
 * process keeps it in the app's data file, which the user can reach, so what
 * comes back from either is checked by the functions below before it is used.
 *
 * See `src/common/ipc.ts` for what may live in this folder.
 * */

export const tabKinds = ['collection', 'query', 'tools'] as const;

export type TabKind = (typeof tabKinds)[number];

/* A tab, without what only its window knows, such as the rows it read */
export interface SavedTab {
  kind: TabKind;
  collection: string | null;
  filter: string;
  sort: SortKey[];
  text: string;
}

/* The tab groups of a project screen, left to right, and which one has the focus */
export interface WorkspaceLayout {
  groups: { tabs: SavedTab[]; active: number }[];
  focusedGroup: number;
}

/* What a window shows: the project list, or a project and its tabs */
export interface WindowState {
  projectId: number | null;
  layout: WorkspaceLayout | null;
}

// Bounds on what is kept, so a window cannot fill the data file
const MAX_GROUPS = 4;
const MAX_TABS = 64;
const MAX_TEXT = 20000;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isText = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= MAX_TEXT;

const isIndex = (value: unknown, length: number): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) < Math.max(length, 1);

const isSortKey = (value: unknown): value is SortKey =>
  isObject(value) && isText(value.field) && typeof value.descending === 'boolean';

export const isSavedTab = (value: unknown): value is SavedTab =>
  isObject(value) &&
  tabKinds.includes(value.kind as TabKind) &&
  (value.collection === null || isText(value.collection)) &&
  isText(value.filter) &&
  isText(value.text) &&
  Array.isArray(value.sort) &&
  value.sort.length <= MAX_TABS &&
  value.sort.every(isSortKey);

export const isWorkspaceLayout = (value: unknown): value is WorkspaceLayout =>
  isObject(value) &&
  Array.isArray(value.groups) &&
  value.groups.length <= MAX_GROUPS &&
  value.groups.every(
    (group) =>
      isObject(group) &&
      Array.isArray(group.tabs) &&
      group.tabs.length <= MAX_TABS &&
      group.tabs.every(isSavedTab) &&
      isIndex(group.active, group.tabs.length),
  ) &&
  isIndex(value.focusedGroup, value.groups.length);

export const isWindowState = (value: unknown): value is WindowState =>
  isObject(value) &&
  (value.projectId === null || Number.isSafeInteger(value.projectId)) &&
  (value.layout === null || isWorkspaceLayout(value.layout));
