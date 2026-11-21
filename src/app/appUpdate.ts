import { isTauri, openExternal, platformName } from '../platform';
import { APP_VERSION } from './backup';
import { toast } from './store';

/**
 * "Update available" for the Android app, like the web app has. Each release publishes the APK and a tiny
 * version.json next to the website. The app reads that one file (nothing about you or your library is sent)
 * and, if there's a newer version, offers it; tapping Update downloads the APK, which installs over this one.
 * The only network request Notavi ever makes, and only in the Android app.
 */
export const UPDATE_BASE = 'https://mersanessa.github.io/Notavi/android/';
const LAST = 'notavi.updateCheckedAt';
const EVERY = 6 * 60 * 60 * 1000;

export function updatesSupported(): boolean {
  return isTauri() && platformName() === 'android';
}

/** -1, 0 or 1. Plain numeric dotted versions ("1.4.10" > "1.4.9"). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

export async function latestVersion(): Promise<string | null> {
  const r = await fetch(`${UPDATE_BASE}version.json?t=${Date.now()}`, { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (!r.ok) return null;
  const v = ((await r.json()) as { version?: unknown }).version;
  return typeof v === 'string' && /^\d+(\.\d+)*$/.test(v) ? v : null;
}

export function installUpdate(version: string) {
  void openExternal(`${UPDATE_BASE}notavi-${version}.apk`).catch((e: Error) => toast({ message: e.message, tone: 'error' }));
}

function offer(version: string) {
  toast({ message: `Notavi ${version} is ready.`, action: { label: 'Update', run: () => installUpdate(version) }, duration: 60000 });
}

/** Ask now. Returns the newer version, null if up to date; throws if it couldn't check. */
export async function checkForUpdate(): Promise<string | null> {
  const v = await latestVersion();
  try {
    localStorage.setItem(LAST, String(Date.now()));
  } catch {
    /* fine */
  }
  return v && compareVersions(v, APP_VERSION) > 0 ? v : null;
}

/** Quietly check at launch and when you come back to the app, at most every six hours. */
export function startUpdateChecks() {
  if (!updatesSupported()) return;
  const maybe = () => {
    let last = 0;
    try {
      last = Number(localStorage.getItem(LAST)) || 0;
    } catch {
      /* fine */
    }
    if (Date.now() - last < EVERY) return;
    checkForUpdate()
      .then((v) => v && offer(v))
      .catch(() => {
        /* offline: try again next time */
      });
  };
  setTimeout(maybe, 4000);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && maybe());
}
