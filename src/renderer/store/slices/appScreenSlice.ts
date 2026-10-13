import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import type { RootState } from '@/renderer/store';
import { SYSTEM_DARK_THEME_QUERY } from '@/renderer/constants';

/*
 * What a window shows that is not a setting: the color scheme the operating
 * system asks for, which the theme follows while the user has made no choice,
 * and which of the dialogs any screen opens is open.
 * */
export interface AppScreenState {
  systemDarkTheme: boolean;
  settingsOpen: boolean;
  noticesOpen: boolean;
}

/*
 * The browser engine already knows what the system asks for, so that needs no
 * trip to the main process.
 * */
export const createAppScreenState = (): AppScreenState => ({
  systemDarkTheme: window.matchMedia(SYSTEM_DARK_THEME_QUERY).matches,
  settingsOpen: false,
  noticesOpen: false,
});

export const appScreenSlice = createSlice({
  name: 'appScreen',
  // Replaced by the preloaded state in `createAppStore`
  initialState: {
    systemDarkTheme: false,
    settingsOpen: false,
    noticesOpen: false,
  } as AppScreenState,
  reducers: {
    setSystemDarkTheme: (state, action: PayloadAction<boolean>) => {
      state.systemDarkTheme = action.payload;
    },
    setSettingsOpen: (state, action: PayloadAction<boolean>) => {
      state.settingsOpen = action.payload;
    },
    setNoticesOpen: (state, action: PayloadAction<boolean>) => {
      state.noticesOpen = action.payload;
    },
  },
});

export const { setSystemDarkTheme, setSettingsOpen, setNoticesOpen } = appScreenSlice.actions;

/* Whether the window is dark: the user's choice, or the system's without one */
export const selectDarkTheme = (state: RootState): boolean =>
  state.settings.darkTheme ?? state.appScreen.systemDarkTheme;

export default appScreenSlice.reducer;
