import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '@fontsource-variable/fraunces/index.css';
import '@fontsource-variable/hanken-grotesk/index.css';
import '@fontsource-variable/nunito-sans/index.css';
import '@fontsource-variable/nunito-sans/wght-italic.css';
import '@fontsource-variable/literata/index.css';
import '@fontsource-variable/literata/wght-italic.css';
import '@fontsource-variable/source-serif-4/index.css';
import '@fontsource-variable/source-serif-4/wght-italic.css';
import '@fontsource-variable/lora/index.css';
import '@fontsource-variable/lora/wght-italic.css';
import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/atkinson-hyperlegible/700.css';
import '@fontsource/atkinson-hyperlegible/400-italic.css';

import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/pages.css';
import './styles/reader.css';
import './styles/lore.css';
import './styles/motion.css';

import { App } from './ui/App';
import { useStore } from './app/store';
import { applyAppTheme, initialTheme } from './app/prefs';
import { WorkerDb, DbLockedError } from './db/client';
import { requestPersistentStorage } from './platform';
import { initLock } from './app/lock';
import { registerServiceWorker } from './app/sw';
import { initSplash } from './app/splash';
import { installGlobalHaptics } from './platform/haptics';

applyAppTheme(initialTheme());
initSplash();
installGlobalHaptics();

async function boot() {
  try {
    const { db, info } = await WorkerDb.open();
    await useStore.getState().boot(db, info);
    void requestPersistentStorage();
    // Flush pending writes when the app is backgrounded (matters for the IndexedDB fallback).
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void db.flush();
    });
  } catch (err) {
    console.error('[notavi] boot failed', err);
    if (err instanceof DbLockedError) useStore.getState().fail('locked-elsewhere', err.message);
    else useStore.getState().fail('error', `Your library couldn't be opened: ${(err as Error).message}`);
  }
}

initLock();
void boot();
registerServiceWorker();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
