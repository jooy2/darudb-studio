import { HashRouter, Route, Routes } from 'react-router-dom';
import { Provider } from 'react-redux';
import type { AppStore } from '@/renderer/store';
import LocaleProvider from '@/renderer/components/base/LocaleProvider';
import SettingsProvider from '@/renderer/components/base/SettingsProvider';
import ThemeProvider from '@/renderer/components/base/ThemeProvider';
import { MenuModelContext } from '@/renderer/components/menu/MenuModelContext';
import useLanguageSync from '@/renderer/hooks/useLanguageSync';
import type { MenuModel } from '@/common/ipc';

import NotFoundScreen from '@/renderer/screens/NotFoundScreen';
import MainScreen from '@/renderer/screens/MainScreen';

export default function App({ store, menu }: { store: AppStore; menu: MenuModel }) {
  // Every window shows the same language, whichever one it was changed in
  useLanguageSync();

  return (
    <Provider store={store}>
      <MenuModelContext value={menu}>
        <SettingsProvider>
          <ThemeProvider>
            <LocaleProvider>
              <HashRouter>
                <Routes>
                  <Route path="/">
                    <Route index element={<MainScreen />} />
                    <Route path="*" element={<NotFoundScreen />} />
                  </Route>
                </Routes>
              </HashRouter>
            </LocaleProvider>
          </ThemeProvider>
        </SettingsProvider>
      </MenuModelContext>
    </Provider>
  );
}
