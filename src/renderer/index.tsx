import { createRoot } from 'react-dom/client';
import App from '@/renderer/App';
import { initI18n } from '@/renderer/i18n';
import { createAppStore } from '@/renderer/store';
import { mainChannels } from '@/common/ipc';
// The one stylesheet the page loads. Plass UI is imported from inside it, see
// `assets/css/global.css`.
import '@/renderer/assets/css/global.css';

/*
 * The stored theme and language live in the main process, so they are asked for
 * before the first render, along with the menu the window draws. The main
 * process already holds both in memory, so the wait is one local round trip,
 * and the window behind it is painted in the stored background from the start.
 * */
const bootstrap = async (): Promise<void> => {
  const [settings, menu] = await Promise.all([
    window.mainApi.invoke(mainChannels.requestSettings),
    window.mainApi.invoke(mainChannels.requestMenu),
  ]);

  await initI18n(settings.language);

  createRoot(document.getElementById('app')!).render(
    <App store={createAppStore(settings)} menu={menu} />,
  );
};

void bootstrap();
