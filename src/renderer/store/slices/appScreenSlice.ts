import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import { SYSTEM_DARK_THEME_QUERY } from '@/renderer/constants';
import type { AppSettings } from '@/common/settings';

export interface AppScreenState {
  darkTheme: boolean;
  followSystemTheme: boolean;
}

/*
 * The theme a window starts on. The stored choice comes from the main process,
 * and as long as the user has not made one, the operating system decides. The
 * browser engine already knows what it asks for, so that needs no trip to the
 * main process.
 * */
export const createAppScreenState = ({ darkTheme }: AppSettings): AppScreenState => ({
  darkTheme: darkTheme ?? window.matchMedia(SYSTEM_DARK_THEME_QUERY).matches,
  followSystemTheme: darkTheme === null,
});

export const appScreenSlice = createSlice({
  name: 'appScreen',
  // Replaced by the preloaded state in `createAppStore`, which holds the
  // settings the window was opened with
  initialState: { darkTheme: false, followSystemTheme: true } as AppScreenState,
  reducers: {
    setDarkTheme: (state, action: PayloadAction<boolean>) => {
      state.darkTheme = action.payload;
      // An explicit choice wins over the operating system from now on
      state.followSystemTheme = false;
    },
    setSystemDarkTheme: (state, action: PayloadAction<boolean>) => {
      if (!state.followSystemTheme) {
        return;
      }

      state.darkTheme = action.payload;
    },
  },
});

export const { setDarkTheme, setSystemDarkTheme } = appScreenSlice.actions;

export default appScreenSlice.reducer;
