import type { IpcRendererEvent } from 'electron';
import type { SupportedLanguage } from './locales';
import type { AppSettings } from './settings';
import type { ChosenFile, FileCheck, Project, ProjectDraft } from './projects';
import type { AppCommand, MenuEntry, MenuPlatform } from './menu';

/*
 * The IPC contract, shared by the three processes.
 *
 * The channel a renderer calls, the whitelist the preload checks it against and
 * the handler the main process registers are the same string, so it is written
 * once here instead of three times.
 *
 * Everything under `src/common` is bundled into the main, preload and renderer
 * builds alike. Anything only one of them can run has to stay out: no Node.js
 * builtins, no `electron` runtime import, no DOM globals. Type-only imports are
 * erased at build time, so they are fine. ESLint enforces this, see the
 * `src/common` block in `eslint.config.ts`.
 *
 * Each process gets its own copy of this code, so a value exported here is not
 * shared between them. Keep it to constants, types and pure functions.
 * */

/*
 * Channels the renderer may send to the main process.
 * Adding an entry here is enough, the preload whitelist follows it.
 * */
export const mainChannels = {
  openExternalLink: 'msgOpenExternalLink',
  openWindow: 'msgOpenWindow',
  closeWindow: 'msgCloseWindow',
  requestSettings: 'msgRequestSettings',
  updateSettings: 'msgUpdateSettings',
  setDarkTheme: 'msgSetDarkTheme',
  setLanguage: 'msgSetLanguage',
  listProjects: 'msgListProjects',
  saveProject: 'msgSaveProject',
  deleteProject: 'msgDeleteProject',
  chooseDatabaseFile: 'msgChooseDatabaseFile',
  checkDatabaseFile: 'msgCheckDatabaseFile',
  canRememberPasswords: 'msgCanRememberPasswords',
  requestMenu: 'msgRequestMenu',
  invokeMenuEntry: 'msgInvokeMenuEntry',
  listenMenuCommands: 'msgListenMenuCommands',
  setShowsProject: 'msgSetShowsProject',
} as const;

/*
 * Channels the main process may push to the renderer.
 * */
export const rendererChannels = {
  darkThemeUpdated: 'msgDarkThemeUpdated',
  languageUpdated: 'msgLanguageUpdated',
  settingsUpdated: 'msgSettingsUpdated',
  projectsChanged: 'msgProjectsChanged',
  menuCommand: 'msgMenuCommand',
} as const;

/* What a window draws its menu bar from: the entries, and how to show their accelerators */
export interface MenuModel {
  entries: MenuEntry[];
  platform: MenuPlatform;
}

export type MainChannel = (typeof mainChannels)[keyof typeof mainChannels];

export type RendererChannel = (typeof rendererChannels)[keyof typeof rendererChannels];

/*
 * What each channel carries, written as the function the channel stands for.
 *
 * The bridge below is one generic pair of methods, so these two maps are what
 * makes a call to it checked: the arguments come from the parameter list, and
 * `invoke` resolves with the return type. A channel added to the lists above
 * without an entry here does not compile.
 * */
export interface MainChannelSignatures {
  [mainChannels.openExternalLink]: (url: string) => void;
  /* Opens another window on the route `path`, and resolves with its id, or `null` when refused */
  [mainChannels.openWindow]: (path: string) => number | null;
  /* Closes the window the call came from */
  [mainChannels.closeWindow]: () => boolean;
  [mainChannels.requestSettings]: () => AppSettings;
  /* Stores the valid ones of `changes` and resolves with every setting */
  [mainChannels.updateSettings]: (changes: Partial<AppSettings>) => AppSettings;
  [mainChannels.setDarkTheme]: (darkTheme: boolean) => void;
  [mainChannels.setLanguage]: (language: SupportedLanguage) => void;
  [mainChannels.listProjects]: () => Project[];
  [mainChannels.saveProject]: (draft: ProjectDraft) => Project;
  [mainChannels.deleteProject]: (id: number) => void;
  /* The open dialog, titled `title`; `null` when it was cancelled */
  [mainChannels.chooseDatabaseFile]: (title: string) => ChosenFile | null;
  [mainChannels.checkDatabaseFile]: (path: string, password?: string) => FileCheck;
  /* Whether this system has a keystore to keep remembered passwords in */
  [mainChannels.canRememberPasswords]: () => boolean;
  [mainChannels.requestMenu]: () => MenuModel;
  /* Does what the menu entry `id` does, for the window the call came from */
  [mainChannels.invokeMenuEntry]: (id: string) => void;
  /*
   * Tells the main process the window now listens for menu commands. One sent
   * before that waits for it, as a command for a window that is still loading.
   * */
  [mainChannels.listenMenuCommands]: () => void;
  /* Reports whether the window shows a project, which the entries for one need */
  [mainChannels.setShowsProject]: (showsProject: boolean) => void;
}

export interface RendererChannelSignatures {
  [rendererChannels.darkThemeUpdated]: (darkTheme: boolean) => void;
  [rendererChannels.languageUpdated]: (language: SupportedLanguage) => void;
  [rendererChannels.settingsUpdated]: (settings: AppSettings) => void;
  /* A window created, changed or deleted a project: the list is to be read again */
  [rendererChannels.projectsChanged]: () => void;
  /* A command of the application menu for what the window shows */
  [rendererChannels.menuCommand]: (command: AppCommand) => void;
}

export type MainChannelArgs<Channel extends MainChannel> = Parameters<
  MainChannelSignatures[Channel]
>;

export type MainChannelResult<Channel extends MainChannel> = ReturnType<
  MainChannelSignatures[Channel]
>;

export type RendererListener<Channel extends RendererChannel = RendererChannel> = (
  event: IpcRendererEvent,
  ...args: Parameters<RendererChannelSignatures[Channel]>
) => void;

/*
 * Shape of the bridge exposed on `window.mainApi` by the preload script.
 * The preload implements it and the renderer calls it, so a channel that is not
 * on the lists above is a build error rather than a thrown error at runtime.
 * */
export interface MainApi {
  /* Renderer -> Main, fire and forget */
  send<Channel extends MainChannel>(channel: Channel, ...data: MainChannelArgs<Channel>): void;
  /*
   * Renderer -> Main, blocks the renderer until the main process replies.
   * Nothing in the template uses it, because a blocking call before the first
   * paint is what it usually ends up being. Reach for `invoke` first.
   * */
  sendSync<Channel extends MainChannel>(
    channel: Channel,
    ...data: MainChannelArgs<Channel>
  ): Awaited<MainChannelResult<Channel>>;
  /* Main -> Renderer, returns the function that detaches the listener */
  on<Channel extends RendererChannel>(
    channel: Channel,
    listener: RendererListener<Channel>,
  ): () => void;
  once<Channel extends RendererChannel>(
    channel: Channel,
    listener: RendererListener<Channel>,
  ): () => void;
  off<Channel extends RendererChannel>(channel: Channel, listener: RendererListener<Channel>): void;
  /* Renderer -> Main, resolves with the value returned by `ipcMain.handle` */
  invoke<Channel extends MainChannel>(
    channel: Channel,
    ...data: MainChannelArgs<Channel>
  ): Promise<Awaited<MainChannelResult<Channel>>>;
}
