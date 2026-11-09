import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Settings } from 'lucide-react';
import { PlAppLogo, PlHeader, PlIconButton } from 'plass-ui';
import AppMenuBar from '@/renderer/components/menu/AppMenuBar';
import { setSettingsOpen } from '@/renderer/store/slices/appScreenSlice';
import { useAppDispatch, useAppSelector } from '@/renderer/store/hooks';
import { APP_NAME } from '@/renderer/constants';

// Narrower than this, the row of menus no longer fits beside the logo and the
// window's own buttons, and they fold behind one button whatever the settings
// say. A window is never this narrow on the screen, but one zoomed in is.
const NARROW_WINDOW_QUERY = '(max-width: 720px)';

/* Whether the window is too narrow for the row of menus */
const useNarrowWindow = (): boolean => {
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW_WINDOW_QUERY).matches);

  useEffect(() => {
    const query = window.matchMedia(NARROW_WINDOW_QUERY);
    const update = (event: MediaQueryListEvent): void => setNarrow(event.matches);

    query.addEventListener('change', update);

    return () => query.removeEventListener('change', update);
  }, []);

  return narrow;
};

interface AppHeaderProps {
  /* Whether the window shows a project, which the menu's entries for one need */
  showsProject?: boolean;
}

/*
 * The bar across the top of every screen: the logo, the menu and the settings.
 * It is the window's title bar too, which the window is dragged by, and the
 * system's own buttons sit at one of its ends, see `.app-header` in
 * `screens.css`. The menu folded behind one button is the last thing in it.
 *
 * What a project screen shows of its project, its name, is in its toolbar
 * rather than here, so the bar reads the same on every screen.
 * */
export default function AppHeader({ showsProject = false }: AppHeaderProps) {
  const collapsedSetting = useAppSelector((state) => state.settings.menuBarStyle === 'collapsed');
  const collapsedMenu = useNarrowWindow() || collapsedSetting;
  const dispatch = useAppDispatch();
  const [t] = useTranslation();

  return (
    <PlHeader
      className="app-header"
      size="sm"
      density="compact"
      brand={
        <PlAppLogo
          className="app-header__brand"
          data-testid="main-logo"
          size="sm"
          src="images/logo.png"
          alt={APP_NAME}
        />
      }
      actions={
        <>
          <PlIconButton
            data-testid="btn-settings"
            size="sm"
            variant="ghost"
            label={t('common.settings')}
            icon={<Settings />}
            onClick={() => dispatch(setSettingsOpen(true))}
          />
          {collapsedMenu && <AppMenuBar collapsed showsProject={showsProject} />}
        </>
      }
    >
      {!collapsedMenu && <AppMenuBar showsProject={showsProject} />}
    </PlHeader>
  );
}
