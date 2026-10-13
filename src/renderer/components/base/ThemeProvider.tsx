import { ReactNode, useEffect, useLayoutEffect } from 'react';
import { setDarkTheme, setSystemDarkTheme } from '@/renderer/store/slices/appScreenSlice';
import { useAppDispatch, useAppSelector } from '@/renderer/store/hooks';
import { SYSTEM_DARK_THEME_QUERY } from '@/renderer/constants';
import { mainChannels, rendererChannels } from '@/common/ipc';

/*
 * Plass UI has no theme provider of its own: its tokens answer to `data-theme`
 * on any ancestor. So this component holds the theme state and writes that one
 * attribute, and the tree below it needs nothing wrapped around it.
 * */
export default function ThemeProvider({ children }: { children: ReactNode }) {
  const darkTheme = useAppSelector((state) => state.appScreen.darkTheme);
  const followSystemTheme = useAppSelector((state) => state.appScreen.followSystemTheme);
  const dispatch = useAppDispatch();

  useEffect(() => {
    // The renderer is told about a color scheme change directly, so the main
    // process does not have to watch `nativeTheme` and relay it.
    const systemDarkTheme = window.matchMedia(SYSTEM_DARK_THEME_QUERY);

    const handleSystemThemeChange = (event: MediaQueryListEvent): void => {
      dispatch(setSystemDarkTheme(event.matches));
    };

    systemDarkTheme.addEventListener('change', handleSystemThemeChange);

    return () => {
      systemDarkTheme.removeEventListener('change', handleSystemThemeChange);
    };
  }, [dispatch]);

  useEffect(() => {
    // An explicit choice made in another window. Only explicit ones are handed
    // around: a change the operating system makes reaches every window on its
    // own through the media query above.
    const unsubscribe = window.mainApi.on(rendererChannels.darkThemeUpdated, (_event, value) => {
      dispatch(setDarkTheme(value));
    });

    return unsubscribe;
  }, [dispatch]);

  useEffect(() => {
    // Only an explicit choice is reported. The main process stores it in the
    // settings file, hands it to the windows that are already open, and paints
    // the next window with it before its page loads.
    if (followSystemTheme) {
      return;
    }

    window.mainApi.send(mainChannels.setDarkTheme, darkTheme);
  }, [darkTheme, followSystemTheme]);

  useLayoutEffect(() => {
    // Written in a layout effect rather than in `useEffect`, so the first paint
    // of a window already carries the theme it settled on.
    document.documentElement.dataset.theme = darkTheme ? 'dark' : 'light';
  }, [darkTheme]);

  return children;
}
