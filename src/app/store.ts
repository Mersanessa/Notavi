import { create } from 'zustand';
import type { Db, StorageInfo } from '../db/types';
import type { Collection, NovelSummary } from '../data/model';
import { listNovels } from '../data/novels';
import { listCollections } from '../data/collections';
import { getSetting, setSetting } from '../data/settings';
import { haptic, setHapticsEnabled } from '../platform/haptics';
import { DEFAULT_APP, DEFAULT_READER, applyAppTheme, type AppPrefs, type ReaderPrefs } from './prefs';

let currentDb: Db | null = null;

/** The splash runs before the database opens, so it reads the motion preference from localStorage. */
function mirrorMotion(reduce: boolean) {
  document.documentElement.dataset.motion = reduce ? 'reduce' : 'full';
  try {
    localStorage.setItem('notavi.motion', reduce ? 'reduce' : 'full');
  } catch {
    /* ignore */
  }
}

/** The open library database. Available once the app has booted. */
export function db(): Db {
  if (!currentDb) throw new Error('Database not ready');
  return currentDb;
}

export interface Toast {
  id: number;
  message: string;
  tone?: 'default' | 'error' | 'success';
  action?: { label: string; run: () => void };
  duration?: number;
}

interface State {
  status: 'booting' | 'ready' | 'error' | 'locked-elsewhere';
  error: string | null;
  storage: StorageInfo | null;
  novels: NovelSummary[];
  collections: Collection[];
  /** Bumped after any library change so views can reload their own data. */
  version: number;
  app: AppPrefs;
  reader: ReaderPrefs;
  toasts: Toast[];

  boot(db: Db, storage: StorageInfo): Promise<void>;
  fail(status: 'error' | 'locked-elsewhere', message: string): void;
  refresh(): Promise<void>;
  setApp(patch: Partial<AppPrefs>): Promise<void>;
  setReader(patch: Partial<ReaderPrefs>): Promise<void>;
  toast(t: Omit<Toast, 'id'> | string): void;
  dismissToast(id: number): void;
}

let toastSeq = 0;

export const useStore = create<State>((set, get) => ({
  status: 'booting',
  error: null,
  storage: null,
  novels: [],
  collections: [],
  version: 0,
  app: DEFAULT_APP,
  reader: DEFAULT_READER,
  toasts: [],

  async boot(database, storage) {
    currentDb = database;
    const [app, reader, novels, collections] = await Promise.all([
      getSetting(database, 'app', DEFAULT_APP),
      getSetting(database, 'reader', DEFAULT_READER),
      listNovels(database),
      listCollections(database),
    ]);
    applyAppTheme(app.theme);
    mirrorMotion(app.reduceMotion);
    setHapticsEnabled(app.haptics);
    set({ status: 'ready', storage, app, reader, novels, collections });
  },

  fail(status, message) {
    set({ status, error: message });
  },

  async refresh() {
    const [novels, collections, storage] = await Promise.all([listNovels(db()), listCollections(db()), db().info()]);
    // After a restore, settings may have changed too.
    const [app, reader] = await Promise.all([getSetting(db(), 'app', DEFAULT_APP), getSetting(db(), 'reader', DEFAULT_READER)]);
    applyAppTheme(app.theme);
    set((s) => ({ novels, collections, storage, app, reader, version: s.version + 1 }));
  },

  async setApp(patch) {
    const app = { ...get().app, ...patch };
    set({ app });
    if (patch.theme) applyAppTheme(app.theme);
    if (patch.reduceMotion !== undefined) mirrorMotion(app.reduceMotion);
    if (patch.haptics !== undefined) setHapticsEnabled(app.haptics);
    await setSetting(db(), 'app', app);
  },

  async setReader(patch) {
    const reader = { ...get().reader, ...patch };
    set({ reader });
    await setSetting(db(), 'reader', reader);
  },

  toast(t) {
    const toast: Toast = typeof t === 'string' ? { id: ++toastSeq, message: t } : { ...t, id: ++toastSeq };
    if (toast.tone === 'success') haptic('success');
    else if (toast.tone === 'error') haptic('error');
    set((s) => ({ toasts: [...s.toasts.slice(-2), toast] }));
    setTimeout(() => get().dismissToast(toast.id), toast.duration ?? (toast.action ? 7000 : 3600));
  },

  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));

export const toast = (t: Omit<Toast, 'id'> | string) => useStore.getState().toast(t);
export const refreshLibrary = () => useStore.getState().refresh();

/** Run a mutation, refresh the library and report failures as a toast. */
export async function mutate<T>(fn: (d: Db) => Promise<T>, success?: string): Promise<T | undefined> {
  try {
    const out = await fn(db());
    await refreshLibrary();
    if (success) toast({ message: success, tone: 'success' });
    return out;
  } catch (err) {
    console.error(err);
    toast({ message: (err as Error).message || 'Something went wrong.', tone: 'error' });
    return undefined;
  }
}
