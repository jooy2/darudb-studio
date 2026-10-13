import { useEffect, useRef, type ReactNode } from 'react';
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
import { APP_NAME } from '@/renderer/constants';
import { mainChannels } from '@/common/ipc';
import { acceleratorLabel, type MenuEntry, type MenuRole } from '@/common/menu';

// The entries that act on the field with the focus, as the Edit menu's do
const EDITING_ROLES = new Set<MenuRole>([
  'undo',
  'redo',
  'cut',
  'copy',
  'paste',
  'pasteAndMatchStyle',
  'delete',
  'selectAll',
]);

// Where the menus are, so focus moving into them is not taken for the user's field
const MENU_AREAS = '[role="menu"], [role="menubar"], [data-app-menu-button]';

interface AppMenuBarProps {
  /* Whether every menu is behind one button rather than in a row, as the settings say */
  collapsed?: boolean;
  /* Whether the window shows a project, which the entries for one need */
  showsProject?: boolean;
}

/*
 * The application menu, drawn in the window: every menu in a row, or all of
 * them behind one button.
 *
 * It lists what the native menu lists, from the same entries, and a click goes
 * to the main process, which does what the native menu would. The shortcuts it
 * shows are the native menu's, which is what answers them.
 * */
export default function AppMenuBar({ collapsed = false, showsProject = false }: AppMenuBarProps) {
  const { entries, platform } = useMenuModel();
  const [t] = useTranslation();
  // The element the user worked in before a menu took the focus
  const lastFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const remember = (event: FocusEvent): void => {
      if (event.target instanceof HTMLElement && !event.target.closest(MENU_AREAS)) {
        lastFocused.current = event.target;
      }
    };

    document.addEventListener('focusin', remember);

    return () => document.removeEventListener('focusin', remember);
  }, []);

  /*
   * Does what the entry does. An editing entry acts on the field with the
   * focus, which the menu took, so the focus goes back to that field first,
   * once the menu has closed and handed it to its trigger.
   * */
  const invoke = (entry: MenuEntry): void => {
    if (!entry.role || !EDITING_ROLES.has(entry.role)) {
      window.mainApi.send(mainChannels.invokeMenuEntry, entry.id);

      return;
    }

    const field = lastFocused.current;

    window.setTimeout(() => {
      if (field?.isConnected) {
        field.focus({ preventScroll: true });
      }

      window.mainApi.send(mainChannels.invokeMenuEntry, entry.id);
    }, 0);
  };

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
          onClick={() => invoke(entry)}
        >
          {labelOf(entry)}
        </PlMenuItem>
      );
    });

  if (collapsed) {
    return (
      <PlMenu
        size="sm"
        align="end"
        trigger={
          <PlIconButton
            data-testid="app-menu-button"
            data-app-menu-button
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
