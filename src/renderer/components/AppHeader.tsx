import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Settings } from 'lucide-react';
import { PlAppLogo, PlHeader, PlIconButton } from 'plass-ui';
import AppMenuBar from '@/renderer/components/menu/AppMenuBar';
import ThemeIcon from '@/renderer/components/ThemeIcon';
import { selectDarkTheme, setSettingsOpen } from '@/renderer/store/slices/appScreenSlice';
import { changeSettings } from '@/renderer/store/slices/settingsSlice';
import { useAppDispatch, useAppSelector } from '@/renderer/store/hooks';
import { APP_NAME } from '@/renderer/constants';

interface AppHeaderProps {
  /* What the window shows, beside the logo: the app's name, or a project's */
  title?: string;
  /* Whether the window shows a project, which the menu's entries for one need */
  showsProject?: boolean;
  /* Buttons of the screen, before the settings and the theme switch */
  actions?: ReactNode;
}

/* The bar across the top of every screen: the logo, the menu and the app's own buttons */
export default function AppHeader({
  title = APP_NAME,
  showsProject = false,
  actions = null,
}: AppHeaderProps) {
  const darkTheme = useAppSelector(selectDarkTheme);
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
          alt=""
          name={title}
        />
      }
      actions={
        <>
          {actions}
          <PlIconButton
            data-testid="btn-settings"
            size="sm"
            variant="ghost"
            label={t('common.settings')}
            icon={<Settings />}
            onClick={() => dispatch(setSettingsOpen(true))}
          />
          <PlIconButton
            data-testid="btn-change-theme"
            size="sm"
            variant="ghost"
            label={t('common.switch-theme')}
            icon={<ThemeIcon darkTheme={darkTheme} />}
            onClick={() => void dispatch(changeSettings({ darkTheme: !darkTheme }))}
          />
        </>
      }
    >
      <AppMenuBar showsProject={showsProject} />
    </PlHeader>
  );
}
