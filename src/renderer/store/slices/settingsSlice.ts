import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import type { AppThunk } from '@/renderer/store';
import { mainChannels } from '@/common/ipc';
import type { AppSettings, EditMode, MenuBarStyle } from '@/common/settings';

/*
 * The preferences that decide how a window works rather than how it looks. The
 * theme and the language have slices and channels of their own, since they
 * reach the page before React does.
 * */
export interface SettingsState {
  menuBarStyle: MenuBarStyle;
  editMode: EditMode;
}

export type SettingChanges = Partial<SettingsState>;

export const createSettingsState = ({ menuBarStyle, editMode }: AppSettings): SettingsState => ({
  menuBarStyle,
  editMode,
});

export const settingsSlice = createSlice({
  name: 'settings',
  // Replaced by the preloaded state in `createAppStore`
  initialState: { menuBarStyle: 'inline', editMode: 'immediate' } as SettingsState,
  reducers: {
    /* What the main process holds, after a change made here or in another window */
    settingsReceived: (state, action: PayloadAction<AppSettings>) => {
      state.menuBarStyle = action.payload.menuBarStyle;
      state.editMode = action.payload.editMode;
    },
    settingsChanged: (state, action: PayloadAction<SettingChanges>) => {
      Object.assign(state, action.payload);
    },
  },
});

export const { settingsReceived, settingsChanged } = settingsSlice.actions;

/*
 * Shows `changes` at once, then stores them. The main process answers with
 * every setting as it kept them, which is what the window ends up showing.
 * */
export const changeSettings =
  (changes: SettingChanges): AppThunk<Promise<void>> =>
  async (dispatch) => {
    dispatch(settingsChanged(changes));
    dispatch(settingsReceived(await window.mainApi.invoke(mainChannels.updateSettings, changes)));
  };

export default settingsSlice.reducer;
