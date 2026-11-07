import { isTauri } from '../platform';
import { toast } from './store';

/**
 * Register the service worker (PWA only) so the app works offline.
 * New versions are offered, never forced mid-read.
 */
export function registerServiceWorker() {
  if (isTauri() || !('serviceWorker' in navigator) || import.meta.env.DEV) return;
  void import('virtual:pwa-register').then(({ registerSW }) => {
    const update = registerSW({
      immediate: true,
      onNeedRefresh() {
        toast({ message: 'A new version of Notavi is ready.', action: { label: 'Update', run: () => void update(true) }, duration: 60000 });
      },
      onOfflineReady() {
        // Say it once, the first time; after that it's just how the app works.
        try {
          if (localStorage.getItem('notavi.offlineReady')) return;
          localStorage.setItem('notavi.offlineReady', '1');
        } catch {
          return;
        }
        toast({ message: 'Notavi is ready to work offline.', tone: 'success' });
      },
    });
  });
}
