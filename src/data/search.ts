import type { Db } from '../db/types';
import { escapeHtml, toFtsQuery } from '../lib/text';
import type { NovelSummary, ReadingStatus } from './model';

/** Novel ids matching the query across title, alternative titles, author, translator, genres, tags and description, best first. */
export async function searchNovelIds(db: Db, query: string): Promise<string[]> {
  const q = toFtsQuery(query);
  if (!q) return [];
  const rows = await db.all<{ id: string }>(
    `SELECT n.id FROM novel_fts f JOIN novels n ON n.rid = f.rowid
     WHERE novel_fts MATCH ?
     ORDER BY bm25(novel_fts, 10.0, 8.0, 6.0, 3.0, 4.0, 4.0, 1.0) LIMIT 500`,
    [q],
  );
  return rows.map((r) => r.id);
}

export interface TextHit {
  chapterId: string;
  novelId: string;
  novelTitle: string;
  chapterTitle: string;
  position: number;
  /** Safe HTML: escaped text with <mark> around matches. */
  snippet: string;
}

const START = '\u0001';
const END = '\u0002';

export function snippetToHtml(raw: string): string {
  return escapeHtml(raw).replaceAll(START, '<mark>').replaceAll(END, '</mark>');
}

/** Full-text search over chapter text, across the library or within one novel. */
export async function searchText(
  db: Db,
  query: string,
  opts: { novelId?: string; limit?: number; offset?: number } = {},
): Promise<{ hits: TextHit[]; total: number }> {
  const q = toFtsQuery(query);
  if (!q) return { hits: [], total: 0 };
  const where = opts.novelId ? 'chapter_fts MATCH ? AND c.novel_id = ?' : 'chapter_fts MATCH ?';
  const params = opts.novelId ? [q, opts.novelId] : [q];
  const total = (await db.get<{ n: number }>(`SELECT count(*) AS n FROM chapter_fts f JOIN chapters c ON c.rid = f.rowid WHERE ${where}`, params))!.n;
  const rows = await db.all<{ chapterId: string; novelId: string; novelTitle: string; chapterTitle: string; position: number; snip: string }>(
    `SELECT c.id AS chapterId, c.novel_id AS novelId, n.title AS novelTitle, c.title AS chapterTitle, c.position AS position,
            snippet(chapter_fts, 1, '${START}', '${END}', '…', 18) AS snip
     FROM chapter_fts f JOIN chapters c ON c.rid = f.rowid JOIN novels n ON n.id = c.novel_id
     WHERE ${where}
     ORDER BY ${opts.novelId ? 'c.position' : 'rank'}
     LIMIT ? OFFSET ?`,
    [...params, opts.limit ?? 30, opts.offset ?? 0],
  );
  return { hits: rows.map(({ snip, ...r }) => ({ ...r, snippet: snippetToHtml(snip) })), total };
}

/* ------------------------------------------------------------------ filtering & sorting (pure) */

export type SortKey = 'title' | 'author' | 'added' | 'updated' | 'last_read' | 'progress' | 'chapters';
export const SORTS: { value: SortKey; label: string }[] = [
  { value: 'last_read', label: 'Last read' },
  { value: 'added', label: 'Date added' },
  { value: 'updated', label: 'Recently updated' },
  { value: 'title', label: 'Title' },
  { value: 'author', label: 'Author' },
  { value: 'progress', label: 'Progress' },
  { value: 'chapters', label: 'Chapter count' },
];

export interface NovelFilters {
  statuses?: ReadingStatus[];
  genres?: string[];
  tags?: string[];
  favouritesOnly?: boolean;
  /** Added within the last N days. */
  addedWithinDays?: number;
  /** Content updated within the last N days. */
  updatedWithinDays?: number;
  collectionNovelIds?: Set<string> | null;
}

const DAY = 86400000;

export function filterNovels(list: NovelSummary[], f: NovelFilters, now = Date.now()): NovelSummary[] {
  const lc = (a: string[]) => a.map((x) => x.toLowerCase());
  return list.filter((n) => {
    if (f.statuses?.length && !f.statuses.includes(n.status)) return false;
    if (f.favouritesOnly && !n.favourite) return false;
    if (f.genres?.length) {
      const g = lc(n.genres);
      if (!f.genres.every((x) => g.includes(x.toLowerCase()))) return false;
    }
    if (f.tags?.length) {
      const t = lc(n.tags);
      if (!f.tags.every((x) => t.includes(x.toLowerCase()))) return false;
    }
    if (f.addedWithinDays && now - n.createdAt > f.addedWithinDays * DAY) return false;
    if (f.updatedWithinDays && now - n.contentUpdatedAt > f.updatedWithinDays * DAY) return false;
    if (f.collectionNovelIds && !f.collectionNovelIds.has(n.id)) return false;
    return true;
  });
}

export function sortNovels(list: NovelSummary[], key: SortKey, dir: 'asc' | 'desc' = defaultDir(key)): NovelSummary[] {
  const coll = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
  const cmp: Record<SortKey, (a: NovelSummary, b: NovelSummary) => number> = {
    title: (a, b) => coll.compare(a.title, b.title),
    author: (a, b) => coll.compare(a.author || '￿', b.author || '￿') || coll.compare(a.title, b.title),
    added: (a, b) => a.createdAt - b.createdAt,
    updated: (a, b) => a.contentUpdatedAt - b.contentUpdatedAt,
    last_read: (a, b) => (a.lastReadAt ?? 0) - (b.lastReadAt ?? 0) || b.createdAt - a.createdAt,
    progress: (a, b) => a.percent - b.percent,
    chapters: (a, b) => a.chapterCount - b.chapterCount,
  };
  const sorted = [...list].sort(cmp[key]);
  return dir === 'desc' ? sorted.reverse() : sorted;
}

export function defaultDir(key: SortKey): 'asc' | 'desc' {
  return key === 'title' || key === 'author' ? 'asc' : 'desc';
}
