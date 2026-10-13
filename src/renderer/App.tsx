import { HashRouter, Route, Routes } from 'react-router-dom';
import { Provider } from 'react-redux';
import { PlConfirmProvider, PlToastProvider } from 'plass-ui';
import type { AppStore } from '@/renderer/store';
import LocaleProvider from '@/renderer/components/base/LocaleProvider';
import SettingsProvider from '@/renderer/components/base/SettingsProvider';
import ThemeProvider from '@/renderer/components/base/ThemeProvider';
import { MenuModelContext } from '@/renderer/components/menu/MenuModelContext';
import SettingsDialog from '@/renderer/components/settings/SettingsDialog';
import useMenuCommands from '@/renderer/hooks/useMenuCommands';
import { setSettingsOpen } from '@/renderer/store/slices/appScreenSlice';
import { useAppDispatch } from '@/renderer/store/hooks';
import type { MenuModel } from '@/common/ipc';

import NotFoundScreen from '@/renderer/screens/NotFoundScreen';
import MainScreen from '@/renderer/screens/MainScreen';
import ProjectScreen from '@/renderer/screens/ProjectScreen';

/* What every screen shares: the settings dialog, which any of them opens */
function Screens() {
  const dispatch = useAppDispatch();

  useMenuCommands({
    settings: () => dispatch(setSettingsOpen(true)),
  });

  return (
    <>
      <HashRouter>
        <Routes>
          <Route path="/">
            <Route index element={<MainScreen />} />
            <Route path="project/:id" element={<ProjectScreen />} />
            <Route path="*" element={<NotFoundScreen />} />
          </Route>
        </Routes>
      </HashRouter>
      <SettingsDialog />
    </>
  );
}

export default function App({ store, menu }: { store: AppStore; menu: MenuModel }) {
  return (
    <Provider store={store}>
      <MenuModelContext value={menu}>
        <SettingsProvider>
          <ThemeProvider>
            <LocaleProvider>
              <PlToastProvider position="bottom-end" size="sm">
                <PlConfirmProvider size="sm">
                  <Screens />
                </PlConfirmProvider>
              </PlToastProvider>
            </LocaleProvider>
          </ThemeProvider>
        </SettingsProvider>
      </MenuModelContext>
    </Provider>
  );
}
