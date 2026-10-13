import { ReactNode, useEffect } from 'react';
import { settingsReceived } from '@/renderer/store/slices/settingsSlice';
import { useAppDispatch } from '@/renderer/store/hooks';
import { rendererChannels } from '@/common/ipc';

/*
 * Keeps the window on the settings another window changed. The main process
 * hands every window but the one that made the change the settings it kept.
 * */
export default function SettingsProvider({ children }: { children: ReactNode }) {
  const dispatch = useAppDispatch();

  useEffect(
    () =>
      window.mainApi.on(rendererChannels.settingsUpdated, (_event, settings) => {
        dispatch(settingsReceived(settings));
      }),
    [dispatch],
  );

  return children;
}
