import { useEffect, useRef } from 'react';
import { mainChannels, rendererChannels } from '@/common/ipc';
import type { AppCommand } from '@/common/menu';

export type MenuCommandHandlers = Partial<Record<AppCommand, () => void>>;

/*
 * Runs the handler for a command of the application menu, picked from either
 * the native menu or the window's own menu bar, or pressed as its shortcut.
 *
 * The screen that can do a command is the one that handles it, so a command no
 * mounted screen handles does nothing. Once the handlers are in place, the main
 * process is told the window listens, and sends the commands that waited for
 * it, such as the one that opened the window in the first place.
 * */
export default function useMenuCommands(handlers: MenuCommandHandlers): void {
  // Read when a command arrives rather than captured with the listener, so the
  // handlers can close over the latest render without subscribing again
  const handlersRef = useRef(handlers);

  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    const unsubscribe = window.mainApi.on(rendererChannels.menuCommand, (_event, command) => {
      handlersRef.current[command]?.();
    });

    window.mainApi.send(mainChannels.listenMenuCommands);

    return unsubscribe;
  }, []);
}
