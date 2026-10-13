import { ReactNode, useEffect, useLayoutEffect } from 'react';
import { selectDarkTheme, setSystemDarkTheme } from '@/renderer/store/slices/appScreenSlice';
import { useAppDispatch, useAppSelector } from '@/renderer/store/hooks';
import { SYSTEM_DARK_THEME_QUERY } from '@/renderer/constants';

/*
 * Plass UI has no theme provider of its own: its tokens answer to `data-theme`
 * on any ancestor. So this component writes that one attribute from the theme
 * the settings hold, or the one the system asks for while they hold none, and
 * the tree below it needs nothing wrapped around it.
 * */
export default function ThemeProvider({ children }: { children: ReactNode }) {
  const darkTheme = useAppSelector(selectDarkTheme);
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

  useLayoutEffect(() => {
    // Written in a layout effect rather than in `useEffect`, so the first paint
    // of a window already carries the theme it settled on.
    document.documentElement.dataset.theme = darkTheme ? 'dark' : 'light';
  }, [darkTheme]);

  return children;
}
