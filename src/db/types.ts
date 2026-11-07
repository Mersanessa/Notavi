export type SqlValue = string | number | null | Uint8Array | boolean | undefined;

export interface Stmt {
  sql: string;
  params?: SqlValue[];
}

export interface StorageInfo {
  backend: 'opfs' | 'indexeddb' | 'memory';
  persistent: boolean;
  sqliteVersion: string;
  sizeBytes?: number;
}

/**
 * The storage abstraction every repository talks to.
 *  - WorkerDb  — SQLite-WASM in a Web Worker, persisted to OPFS (IndexedDB fallback). Used by the app.
 *  - MemoryDb  — the same engine in-process, unpersisted. Used by unit tests.
 * A native backend (e.g. tauri-plugin-sql) could implement this without touching repositories.
 */
export interface Db {
  all<T = Record<string, unknown>>(sql: string, params?: SqlValue[]): Promise<T[]>;
  get<T = Record<string, unknown>>(sql: string, params?: SqlValue[]): Promise<T | undefined>;
  run(sql: string, params?: SqlValue[]): Promise<{ changes: number }>;
  /** Run statements atomically in a single transaction. Returns total changed rows. */
  batch(stmts: Stmt[]): Promise<number>;
  /** Serialized SQLite file of the whole library. */
  exportBytes(): Promise<Uint8Array>;
  /** Validate `bytes` and replace the whole library with it, keeping a safety copy of the current one. */
  replaceWith(bytes: Uint8Array): Promise<{ novels: number }>;
  /** Put back the library that the last `replaceWith` replaced. */
  undoReplace(): Promise<boolean>;
  info(): Promise<StorageInfo>;
}
