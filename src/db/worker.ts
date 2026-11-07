/// <reference lib="webworker" />
/**
 * Database worker — owns the only SQLite connection.
 *
 * Persistence, in order of preference:
 *  1. OPFS through the "opfs-sahpool" VFS (no COOP/COEP headers needed).
 *     Chromium (WebView2 on Windows, Android System WebView, Chrome) and Safari 16.4+.
 *  2. In-memory SQLite snapshotted to IndexedDB after writes (older browsers).
 */
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { Engine, openMemoryDb, validateLibraryBytes, type OO1DB, type Sqlite3Static } from './engine';
import type { StorageInfo } from './types';

declare const self: DedicatedWorkerGlobalScope;

const DB_FILE = '/notavi.sqlite3';
const SAFETY_FILE = '/notavi-before-restore.sqlite3';
const IDB_NAME = 'notavi-fallback';

let sqlite3: Sqlite3Static;
let engine: Engine;
let backend: StorageInfo['backend'] = 'memory';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pool: any = null;
let snapshotTimer: ReturnType<typeof setTimeout> | null = null;

/* ---------- IndexedDB fallback ---------- */
function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('files');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbGet(key: string): Promise<Uint8Array | undefined> {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const req = db.transaction('files').objectStore('files').get(key);
    req.onsuccess = () => resolve(req.result as Uint8Array | undefined);
    req.onerror = () => reject(req.error);
  });
}
async function idbPut(key: string, value: Uint8Array): Promise<void> {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('files', 'readwrite');
    tx.objectStore('files').put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
function snapshotSoon() {
  if (backend !== 'indexeddb') return;
  if (snapshotTimer) clearTimeout(snapshotTimer);
  snapshotTimer = setTimeout(() => {
    snapshotTimer = null;
    void idbPut('main', engine.exportBytes());
  }, 300);
}
async function snapshotNow() {
  if (backend !== 'indexeddb') return;
  if (snapshotTimer) clearTimeout(snapshotTimer);
  snapshotTimer = null;
  await idbPut('main', engine.exportBytes());
}

/* ---------- open ---------- */
function openPoolDb(): OO1DB {
  const db = new pool.OpfsSAHPoolDb(DB_FILE) as OO1DB;
  Engine.configure(db);
  return db;
}

function useMemory(bytes?: Uint8Array) {
  const db = openMemoryDb(sqlite3, bytes);
  Engine.configure(db);
  engine = new Engine(sqlite3, db);
}

async function open(): Promise<StorageInfo> {
  sqlite3 = (await sqlite3InitModule()) as unknown as Sqlite3Static;
  const opfsSupported =
    typeof (globalThis as { FileSystemSyncAccessHandle?: unknown }).FileSystemSyncAccessHandle !== 'undefined' &&
    typeof navigator.storage?.getDirectory === 'function';
  if (opfsSupported) {
    // If OPFS is supported but fails, surface the error rather than silently
    // opening a different, empty library.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pool = await (sqlite3 as any).installOpfsSAHPoolVfs({ name: 'notavi-pool', initialCapacity: 6 });
    engine = new Engine(sqlite3, openPoolDb());
    backend = 'opfs';
  } else {
    let bytes: Uint8Array | undefined;
    try {
      bytes = await idbGet('main');
      backend = 'indexeddb';
    } catch {
      backend = 'memory';
    }
    useMemory(bytes);
  }
  engine.migrate();
  await snapshotNow();
  return info();
}

function info(): StorageInfo {
  const size = engine.all<{ s: number }>('SELECT page_count * page_size AS s FROM pragma_page_count(), pragma_page_size()')[0]?.s;
  return { backend, persistent: backend !== 'memory', sqliteVersion: sqlite3.version.libVersion, sizeBytes: size };
}

async function replaceWith(bytes: Uint8Array, keepSafety = true): Promise<{ novels: number }> {
  const { novels } = validateLibraryBytes(sqlite3, bytes);
  const current = engine.exportBytes();
  if (backend === 'opfs') {
    if (keepSafety) await pool.importDb(SAFETY_FILE, current);
    engine.db.close();
    await pool.importDb(DB_FILE, bytes);
    engine = new Engine(sqlite3, openPoolDb());
  } else {
    if (keepSafety && backend === 'indexeddb') await idbPut('safety', current);
    engine.db.close();
    useMemory(bytes);
  }
  engine.migrate();
  await snapshotNow();
  return { novels };
}

async function undoReplace(): Promise<boolean> {
  let bytes: Uint8Array | undefined;
  if (backend === 'opfs') {
    if (!(pool.getFileNames() as string[]).includes(SAFETY_FILE)) return false;
    bytes = pool.exportFile(SAFETY_FILE);
  } else if (backend === 'indexeddb') {
    bytes = await idbGet('safety');
  }
  if (!bytes) return false;
  await replaceWith(bytes, false);
  return true;
}

/* ---------- RPC ---------- */
type Req = { id: number; op: string; args: unknown[] };
let ready: Promise<StorageInfo> | null = null;

self.onmessage = async (ev: MessageEvent<Req>) => {
  const { id, op, args } = ev.data;
  try {
    if (op === 'open') {
      ready ??= open();
      self.postMessage({ id, ok: true, result: await ready });
      return;
    }
    await ready;
    let result: unknown;
    switch (op) {
      case 'all':
        result = engine.all(args[0] as string, args[1] as never);
        break;
      case 'run':
        result = engine.run(args[0] as string, args[1] as never);
        snapshotSoon();
        break;
      case 'batch':
        result = engine.batch(args[0] as never);
        snapshotSoon();
        break;
      case 'export':
        result = engine.exportBytes();
        break;
      case 'replace':
        result = await replaceWith(args[0] as Uint8Array);
        break;
      case 'undoReplace':
        result = await undoReplace();
        break;
      case 'flush':
        await snapshotNow();
        break;
      case 'info':
        result = info();
        break;
      default:
        throw new Error(`Unknown database operation: ${op}`);
    }
    self.postMessage({ id, ok: true, result });
  } catch (err) {
    self.postMessage({ id, ok: false, error: (err as Error)?.message ?? String(err) });
  }
};
