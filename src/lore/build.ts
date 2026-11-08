/**
 * Keeps each novel's Lore index up to date: built once in a background worker, rebuilt only when the
 * chapters change, and cached in memory while the app is open.
 */
import type { Db } from '../db/types';
import { getLoreIndex, saveLoreIndex } from '../data/lore';
import { LoreBuilder, scanChapter, type LoreIndex } from './extract';

const cache = new Map<string, LoreIndex>();
const building = new Map<string, Promise<LoreIndex>>();
type Progress = (done: number, total: number) => void;
const listeners = new Map<string, Set<Progress>>();

export function cachedLore(novelId: string): LoreIndex | undefined {
  return cache.get(novelId);
}

/** The index for a novel, building it if missing or out of date. */
export async function ensureLore(db: Db, novelId: string, onProgress?: Progress): Promise<LoreIndex> {
  if (onProgress) {
    const set = listeners.get(novelId) ?? new Set();
    set.add(onProgress);
    listeners.set(novelId, set);
  }
  try {
    const hit = cache.get(novelId);
    if (hit && building.get(novelId) === undefined) {
      const stored = await getLoreIndex(db, novelId);
      if (stored?.fresh && stored.index.builtAt === hit.builtAt) return hit;
    }
    const stored = await getLoreIndex(db, novelId);
    if (stored?.fresh) {
      cache.set(novelId, stored.index);
      return stored.index;
    }
    let p = building.get(novelId);
    if (!p) {
      p = build(db, novelId, (d, t) => listeners.get(novelId)?.forEach((f) => f(d, t))).finally(() => building.delete(novelId));
      building.set(novelId, p);
    }
    const index = await p;
    cache.set(novelId, index);
    return index;
  } finally {
    if (onProgress) listeners.get(novelId)?.delete(onProgress);
  }
}

const BATCH = 40;

async function build(db: Db, novelId: string, progress: Progress): Promise<LoreIndex> {
  const total = (await db.get<{ n: number }>('SELECT count(*) AS n FROM chapters WHERE novel_id = ?', [novelId]))?.n ?? 0;
  const worker = typeof Worker !== 'undefined' && typeof window !== 'undefined' ? new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }) : null;
  const local = worker ? null : new LoreBuilder();
  const send = (msg: unknown) =>
    new Promise<{ type: string; index?: LoreIndex }>((resolve) => {
      worker!.onmessage = (e) => resolve(e.data);
      worker!.postMessage(msg);
    });
  try {
    progress(0, total);
    for (let offset = 0; offset < total; offset += BATCH) {
      const items = await db.all<{ html: string; pos: number }>('SELECT content AS html, position AS pos FROM chapters WHERE novel_id = ? ORDER BY position LIMIT ? OFFSET ?', [novelId, BATCH, offset]);
      if (worker) await send({ type: 'chapters', items });
      else for (const c of items) local!.add(scanChapter(c.html, c.pos));
      progress(Math.min(total, offset + items.length), total);
    }
    const index = worker ? (await send({ type: 'finish' })).index! : local!.finish();
    // The chapters' last change time, so a rebuild happens only after they change again.
    const changed = (await db.get<{ t: number }>('SELECT content_updated_at AS t FROM novels WHERE id = ?', [novelId]))?.t ?? 0;
    index.builtAt = Math.max(index.builtAt, changed);
    await saveLoreIndex(db, novelId, index);
    return index;
  } finally {
    worker?.terminate();
  }
}

export function forgetLore(novelId: string) {
  cache.delete(novelId);
}
