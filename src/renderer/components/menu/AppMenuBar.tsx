import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Menu as MenuIcon } from 'lucide-react';
import {
  PlIconButton,
  PlMenu,
  PlMenubar,
  PlMenubarMenu,
  PlMenuItem,
  PlMenuSeparator,
  PlMenuSubmenu,
} from 'plass-ui';
import { useMenuModel } from '@/renderer/components/menu/MenuModelContext';
import { useAppSelector } from '@/renderer/store/hooks';
import { APP_NAME } from '@/renderer/constants';
import { mainChannels } from '@/common/ipc';
import { acceleratorLabel, type MenuEntry } from '@/common/menu';

interface AppMenuBarProps {
  /* Whether the window shows a project, which the entries for one need */
  showsProject?: boolean;
}

/*
 * The application menu, drawn in the window: every menu in a row, or all of
 * them behind one button, as the settings say.
 *
 * It lists what the native menu lists, from the same entries, and a click goes
 * to the main process, which does what the native menu would. The shortcuts it
 * shows are the native menu's, which is what answers them.
 * */
export default function AppMenuBar({ showsProject = false }: AppMenuBarProps) {
  const { entries, platform } = useMenuModel();
  const menuBarStyle = useAppSelector((state) => state.settings.menuBarStyle);
  const [t] = useTranslation();

  // The app menu of macOS has no label of its own: it is titled with the app
  const labelOf = (entry: MenuEntry): string =>
    entry.label ? t(entry.label, { name: APP_NAME }) : APP_NAME;

  const rowsOf = (menu: readonly MenuEntry[]): ReactNode =>
    menu.map((entry) => {
      if (entry.separator) {
        return <PlMenuSeparator key={entry.id} />;
      }

      if (entry.submenu) {
        return (
          <PlMenuSubmenu key={entry.id} label={labelOf(entry)}>
            {rowsOf(entry.submenu)}
          </PlMenuSubmenu>
        );
      }

      return (
        <PlMenuItem
          key={entry.id}
          disabled={entry.needsProject === true && !showsProject}
          shortcut={entry.accelerator ? acceleratorLabel(entry.accelerator, platform) : undefined}
          onClick={() => {
            window.mainApi.send(mainChannels.invokeMenuEntry, entry.id);
          }}
        >
          {labelOf(entry)}
        </PlMenuItem>
      );
    });

  if (menuBarStyle === 'collapsed') {
    return (
      <PlMenu
        size="sm"
        trigger={
          <PlIconButton
            data-testid="app-menu-button"
            size="sm"
            variant="ghost"
            label={t('menu.more')}
            icon={<MenuIcon />}
          />
        }
      >
        {entries.map((menu) => (
          <PlMenuSubmenu key={menu.id} label={labelOf(menu)}>
            {rowsOf(menu.submenu ?? [])}
          </PlMenuSubmenu>
        ))}
      </PlMenu>
    );
  }

  return (
    <PlMenubar data-testid="app-menu-bar" size="sm" aria-label={t('menu.more')}>
      {entries.map((menu) => (
        <PlMenubarMenu key={menu.id} label={labelOf(menu)}>
          {rowsOf(menu.submenu ?? [])}
        </PlMenubarMenu>
      ))}
    </PlMenubar>
  );
}
