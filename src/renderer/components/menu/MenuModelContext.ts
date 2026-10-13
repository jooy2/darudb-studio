import { createContext, useContext } from 'react';
import type { MenuModel } from '@/common/ipc';

/*
 * The application menu, as the main process built it. It does not change while
 * the app runs, so a window asks for it once, before its first render, and
 * every menu bar in the window reads it from here.
 * */
export const MenuModelContext = createContext<MenuModel>({ entries: [], platform: 'other' });

export const useMenuModel = (): MenuModel => useContext(MenuModelContext);
