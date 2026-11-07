/** In-process, unpersisted SQLite with the same engine as the app. Used by unit tests. */
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { Engine, openMemoryDb, validateLibraryBytes, type Sqlite3Static } from './engine';
import type { Db, SqlValue, Stmt } from './types';

let shared: Promise<Sqlite3Static> | null = null;

export class MemoryDb implements Db {
  private safety: Uint8Array | null = null;
  private constructor(
    private sqlite3: Sqlite3Static,
    private engine: Engine,
  ) {}

  static async create(bytes?: Uint8Array): Promise<MemoryDb> {
    shared ??= sqlite3InitModule() as unknown as Promise<Sqlite3Static>;
    const sqlite3 = await shared;
    const db = openMemoryDb(sqlite3, bytes);
    Engine.configure(db);
    const engine = new Engine(sqlite3, db);
    engine.migrate();
    return new MemoryDb(sqlite3, engine);
  }

  async all<T>(sql: string, params?: SqlValue[]) {
    return this.engine.all<T>(sql, params);
  }
  async get<T>(sql: string, params?: SqlValue[]) {
    return this.engine.all<T>(sql, params)[0];
  }
  async run(sql: string, params?: SqlValue[]) {
    return this.engine.run(sql, params);
  }
  async batch(stmts: Stmt[]) {
    return this.engine.batch(stmts);
  }
  async exportBytes() {
    return this.engine.exportBytes();
  }
  async replaceWith(bytes: Uint8Array, keepSafety = true) {
    const { novels } = validateLibraryBytes(this.sqlite3, bytes);
    if (keepSafety) this.safety = this.engine.exportBytes();
    this.engine.db.close();
    const db = openMemoryDb(this.sqlite3, bytes);
    Engine.configure(db);
    this.engine = new Engine(this.sqlite3, db);
    this.engine.migrate();
    return { novels };
  }
  async undoReplace() {
    if (!this.safety) return false;
    const s = this.safety;
    this.safety = null;
    await this.replaceWith(s, false);
    return true;
  }
  async info() {
    return { backend: 'memory' as const, persistent: false, sqliteVersion: this.sqlite3.version.libVersion };
  }
}
