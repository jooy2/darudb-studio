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
 * before the first render. The main process already holds them in memory, so
 * the wait is one local round trip, and the window behind it is painted in the
 * stored background from the start.
 * */
const bootstrap = async (): Promise<void> => {
  const settings = await window.mainApi.invoke(mainChannels.requestSettings);

  await initI18n(settings.language);

  createRoot(document.getElementById('app')!).render(<App store={createAppStore(settings)} />);
};

void bootstrap();
