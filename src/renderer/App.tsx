import { HashRouter, Route, Routes } from 'react-router-dom';
import { Provider } from 'react-redux';
import type { AppStore } from '@/renderer/store';
import LocaleProvider from '@/renderer/components/base/LocaleProvider';
import ThemeProvider from '@/renderer/components/base/ThemeProvider';
import useLanguageSync from '@/renderer/hooks/useLanguageSync';

import NotFoundScreen from '@/renderer/screens/NotFoundScreen';
import MainScreen from '@/renderer/screens/MainScreen';

export default function App({ store }: { store: AppStore }) {
  // Every window shows the same language, whichever one it was changed in
  useLanguageSync();

  return (
    <Provider store={store}>
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
    </Provider>
  );
}
