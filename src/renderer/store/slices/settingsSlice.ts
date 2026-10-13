import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import type { AppThunk } from '@/renderer/store';
import { mainChannels } from '@/common/ipc';
import type { AppSettings } from '@/common/settings';

/*
 * The settings, as the main process keeps them. A window reads them before its
 * first render, changes them through `changeSettings`, and hears of a change
 * another window made through `SettingsProvider`.
 * */
export type SettingsState = AppSettings;

export const settingsSlice = createSlice({
  name: 'settings',
  // Replaced by the preloaded state in `createAppStore`
  initialState: {
    darkTheme: null,
    language: null,
    menuBarStyle: 'inline',
    editMode: 'immediate',
    projectView: 'grid',
  } as SettingsState,
  reducers: {
    /* What the main process holds, after a change made here or in another window */
    settingsReceived: (_state, action: PayloadAction<AppSettings>) => ({ ...action.payload }),
    settingsChanged: (state, action: PayloadAction<Partial<AppSettings>>) => {
      Object.assign(state, action.payload);
    },
  },
});

export const { settingsReceived, settingsChanged } = settingsSlice.actions;

/*
 * Shows `changes` at once, then stores them. The main process answers with
 * every setting as it kept them, which is what the window ends up showing.
 * `null` for the theme or the language hands it back to the system.
 * */
export const changeSettings =
  (changes: Partial<AppSettings>): AppThunk<Promise<void>> =>
  async (dispatch) => {
    dispatch(settingsChanged(changes));
    dispatch(settingsReceived(await window.mainApi.invoke(mainChannels.updateSettings, changes)));
  };

export default settingsSlice.reducer;
