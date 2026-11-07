/**
 * Synchronous SQLite engine wrapper. Runs inside the DB worker in the app and
 * in-process in unit tests, so both execute identical SQL and migrations.
 */
import { MIGRATIONS, SCHEMA_VERSION } from './schema';
import type { SqlValue, Stmt } from './types';

/* Minimal structural types for the parts of sqlite-wasm we use. */
export interface OO1DB {
  exec(opts: { sql: string; bind?: unknown[]; rowMode?: 'object'; returnValue?: 'resultRows' }): unknown;
  changes(): number;
  transaction<T>(fn: (db: OO1DB) => T): T;
  close(): void;
  pointer?: number;
}

export interface Sqlite3Static {
  oo1: { DB: new (filename?: string, flags?: string) => OO1DB };
  capi: {
    sqlite3_js_db_export(db: OO1DB): Uint8Array;
    sqlite3_deserialize(pDb: number, schema: string, pData: number, szDb: number, szBuf: number, flags: number): number;
    SQLITE_DESERIALIZE_FREEONCLOSE: number;
    SQLITE_DESERIALIZE_RESIZEABLE: number;
  };
  wasm: { allocFromTypedArray(u8: Uint8Array): number };
  version: { libVersion: string };
}

const SQLITE_MAGIC = 'SQLite format 3\u0000';

export function looksLikeSqlite(bytes: Uint8Array): boolean {
  if (bytes.length < 512) return false;
  for (let i = 0; i < SQLITE_MAGIC.length; i++) if (bytes[i] !== SQLITE_MAGIC.charCodeAt(i)) return false;
  return true;
}

function bindable(params?: SqlValue[]): unknown[] | undefined {
  if (!params) return undefined;
  return params.map((p) => (typeof p === 'boolean' ? (p ? 1 : 0) : p === undefined ? null : p));
}

export class Engine {
  constructor(
    public sqlite3: Sqlite3Static,
    public db: OO1DB,
  ) {}

  static configure(db: OO1DB) {
    db.exec({ sql: 'PRAGMA foreign_keys = ON; PRAGMA journal_mode = DELETE; PRAGMA synchronous = NORMAL;' });
  }

  all<T = Record<string, unknown>>(sql: string, params?: SqlValue[]): T[] {
    return this.db.exec({ sql, bind: bindable(params), rowMode: 'object', returnValue: 'resultRows' }) as T[];
  }

  run(sql: string, params?: SqlValue[]): { changes: number } {
    this.db.exec({ sql, bind: bindable(params) });
    return { changes: this.db.changes() };
  }

  batch(stmts: Stmt[]): number {
    let changes = 0;
    this.db.transaction((tx) => {
      for (const s of stmts) {
        tx.exec({ sql: s.sql, bind: bindable(s.params) });
        changes += tx.changes();
      }
    });
    return changes;
  }

  exportBytes(): Uint8Array {
    return this.sqlite3.capi.sqlite3_js_db_export(this.db);
  }

  /** Schema version stored in the DB (0 = empty / not a Notavi library). */
  version(): number {
    const hasMeta = this.all<{ n: number }>("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='meta'")[0].n;
    if (!hasMeta) return 0;
    const row = this.all<{ value: string }>("SELECT value FROM meta WHERE key='schema_version'")[0];
    return row ? Number(row.value) : 0;
  }

  migrate(): number {
    const from = this.version();
    if (from > SCHEMA_VERSION) {
      throw new Error('This library was created by a newer version of Notavi. Update the app to open it.');
    }
    for (let v = from; v < SCHEMA_VERSION; v++) {
      this.db.transaction((tx) => {
        tx.exec({ sql: MIGRATIONS[v] });
        tx.exec({
          sql: "INSERT INTO meta(key, value) VALUES('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
          bind: [String(v + 1)],
        });
        tx.exec({ sql: "INSERT OR IGNORE INTO meta(key, value) VALUES('created_at', ?)", bind: [String(Date.now())] });
      });
    }
    return SCHEMA_VERSION;
  }

  integrityOk(): boolean {
    const rows = this.all<Record<string, string>>('PRAGMA integrity_check');
    return rows.length === 1 && Object.values(rows[0])[0] === 'ok';
  }
}

/** Open an in-memory DB, optionally loaded from a serialized SQLite file. */
export function openMemoryDb(sqlite3: Sqlite3Static, bytes?: Uint8Array): OO1DB {
  const db = new sqlite3.oo1.DB(':memory:', 'c');
  if (bytes?.length) {
    const p = sqlite3.wasm.allocFromTypedArray(bytes);
    const rc = sqlite3.capi.sqlite3_deserialize(
      db.pointer!,
      'main',
      p,
      bytes.length,
      bytes.length,
      sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE | sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE,
    );
    if (rc !== 0) {
      db.close();
      throw new Error(`Couldn't load the library (SQLite error ${rc}).`);
    }
  }
  return db;
}

/**
 * Check bytes that are about to replace the library: must be an intact SQLite
 * file holding a Notavi schema this app version can open.
 */
export function validateLibraryBytes(sqlite3: Sqlite3Static, bytes: Uint8Array): { version: number; novels: number } {
  if (!looksLikeSqlite(bytes)) throw new Error("This file doesn't contain a Notavi library.");
  const db = openMemoryDb(sqlite3, bytes);
  try {
    const eng = new Engine(sqlite3, db);
    if (!eng.integrityOk()) throw new Error('The library in this file is damaged (integrity check failed).');
    const v = eng.version();
    if (v === 0) throw new Error("This file doesn't contain a Notavi library.");
    if (v > SCHEMA_VERSION) throw new Error('This backup was made by a newer version of Notavi. Update the app first.');
    const novels = eng.all<{ n: number }>('SELECT count(*) AS n FROM novels')[0].n;
    return { version: v, novels };
  } finally {
    db.close();
  }
}
