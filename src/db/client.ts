import type { Db, SqlValue, StorageInfo, Stmt } from './types';

export class DbLockedError extends Error {
  constructor() {
    super('Notavi is already open in another tab or window.');
    this.name = 'DbLockedError';
  }
}

/** Main-thread proxy for the database worker. */
export class WorkerDb implements Db {
  private worker: Worker;
  private seq = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  private constructor() {
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'notavi-db' });
    this.worker.onmessage = (ev) => {
      const { id, ok, result, error } = ev.data as { id: number; ok: boolean; result: unknown; error: string };
      const p = this.pending.get(id);
      if (!p) return;
      this.pending.delete(id);
      if (ok) p.resolve(result);
      else p.reject(new Error(error));
    };
    this.worker.onerror = (ev) => {
      for (const p of this.pending.values()) p.reject(new Error(ev.message || 'The database stopped unexpectedly.'));
      this.pending.clear();
    };
  }

  private call<T>(op: string, args: unknown[] = []): Promise<T> {
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.worker.postMessage({ id, op, args });
    });
  }

  static async open(): Promise<{ db: WorkerDb; info: StorageInfo }> {
    await acquireSingleInstanceLock();
    const db = new WorkerDb();
    const info = await db.call<StorageInfo>('open');
    return { db, info };
  }

  all<T>(sql: string, params?: SqlValue[]) {
    return this.call<T[]>('all', [sql, params]);
  }
  async get<T>(sql: string, params?: SqlValue[]) {
    return (await this.call<T[]>('all', [sql, params]))[0];
  }
  run(sql: string, params?: SqlValue[]) {
    return this.call<{ changes: number }>('run', [sql, params]);
  }
  batch(stmts: Stmt[]) {
    return this.call<number>('batch', [stmts]);
  }
  exportBytes() {
    return this.call<Uint8Array>('export');
  }
  replaceWith(bytes: Uint8Array) {
    return this.call<{ novels: number }>('replace', [bytes]);
  }
  undoReplace() {
    return this.call<boolean>('undoReplace');
  }
  flush() {
    return this.call<void>('flush');
  }
  info() {
    return this.call<StorageInfo>('info');
  }
}

/**
 * OPFS access handles are exclusive, so only one tab/window may own the library.
 * The lock is held for the lifetime of the page.
 */
function acquireSingleInstanceLock(): Promise<void> {
  if (!('locks' in navigator)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    navigator.locks
      .request('notavi-library', { ifAvailable: true }, (lock) => {
        if (!lock) {
          reject(new DbLockedError());
          return;
        }
        resolve();
        return new Promise(() => {});
      })
      .catch(reject);
  });
}
