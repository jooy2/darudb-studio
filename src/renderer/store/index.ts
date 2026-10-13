import { configureStore } from '@reduxjs/toolkit';
import appScreenSlice, { createAppScreenState } from '@/renderer/store/slices/appScreenSlice';
import type { AppSettings } from '@/common/settings';

/*
 * The store is made once per window, after the main process has answered with
 * the stored settings, so the first render already shows the stored choice.
 * */
export const createAppStore = (settings: AppSettings) =>
  configureStore({
    reducer: {
      appScreen: appScreenSlice,
    },
    preloadedState: {
      appScreen: createAppScreenState(settings),
    },
  });

export type AppStore = ReturnType<typeof createAppStore>;
export type RootState = ReturnType<AppStore['getState']>;
export type AppDispatch = AppStore['dispatch'];
