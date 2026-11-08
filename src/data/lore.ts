import type { Db } from '../db/types';
import { LORE_VERSION, type LoreIndex, type LoreKind } from '../lore/extract';
import type { LoreOverride } from '../lore/view';
import { snippetToHtml } from './search';

/** The stored index, if it's current (built after the chapters last changed, by this version of Notavi). */
export async function getLoreIndex(db: Db, novelId: string): Promise<{ index: LoreIndex; fresh: boolean } | null> {
  const r = await db.get<{ data: string; built_at: number; version: number; changed: number }>(
    `SELECT l.data, l.built_at, l.version, n.content_updated_at AS changed FROM lore_index l JOIN novels n ON n.id = l.novel_id WHERE l.novel_id = ?`,
    [novelId],
  );
  if (!r) return null;
  try {
    const index = JSON.parse(r.data) as LoreIndex;
    return { index, fresh: r.version === LORE_VERSION && r.built_at >= r.changed };
  } catch {
    return null;
  }
}

export async function saveLoreIndex(db: Db, novelId: string, index: LoreIndex): Promise<void> {
  await db.run(
    `INSERT INTO lore_index(novel_id, built_at, version, data) VALUES (?, ?, ?, ?)
     ON CONFLICT(novel_id) DO UPDATE SET built_at = excluded.built_at, version = excluded.version, data = excluded.data`,
    [novelId, index.builtAt, index.version, JSON.stringify(index)],
  );
}

type UserRow = { entity_key: string; name: string | null; kind: LoreKind | null; hidden: number; merged_into: string | null; parent: string | null; note: string };

export async function getLoreOverrides(db: Db, novelId: string): Promise<LoreOverride[]> {
  const rows = await db.all<UserRow>('SELECT entity_key, name, kind, hidden, merged_into, parent, note FROM lore_user WHERE novel_id = ?', [novelId]);
  return rows.map((r) => ({ key: r.entity_key, name: r.name, kind: r.kind, hidden: !!r.hidden, mergedInto: r.merged_into, parent: r.parent, note: r.note }));
}

/** Change what you've set for one entry; fields left out keep their value. */
export async function setLoreOverride(db: Db, novelId: string, key: string, patch: Partial<Omit<LoreOverride, 'key'>>): Promise<void> {
  const cur = (await getLoreOverrides(db, novelId)).find((o) => o.key === key) ?? { key };
  const next = { ...cur, ...patch };
  await db.run(
    `INSERT INTO lore_user(novel_id, entity_key, name, kind, hidden, merged_into, parent, note, updated_at) VALUES (?,?,?,?,?,?,?,?,?)
     ON CONFLICT(novel_id, entity_key) DO UPDATE SET name = excluded.name, kind = excluded.kind, hidden = excluded.hidden,
       merged_into = excluded.merged_into, parent = excluded.parent, note = excluded.note, updated_at = excluded.updated_at`,
    [novelId, key, next.name?.trim() || null, next.kind ?? null, next.hidden ? 1 : 0, next.mergedInto ?? null, next.parent ?? null, next.note ?? '', Date.now()],
  );
}

export interface LoreMention {
  chapterId: string;
  position: number;
  chapterTitle: string;
  snippet: string;
}

/** Earlier mentions of any of `forms`, in chapters before `beforePos`, most recent first. */
export async function loreMentions(db: Db, novelId: string, forms: string[], beforePos: number, opts: { limit?: number; offset?: number; oldestFirst?: boolean } = {}): Promise<{ hits: LoreMention[]; total: number }> {
  const terms = forms.map((f) => f.replace(/["*^:()]/g, ' ').trim()).filter(Boolean);
  if (!terms.length || beforePos <= 0) return { hits: [], total: 0 };
  const q = terms.map((t) => `"${t}"`).join(' OR ');
  const where = `chapter_fts MATCH ? AND c.novel_id = ? AND c.position < ? AND (c.book_only = 0 OR n.reading_mode = 'book')`;
  const params = [q, novelId, beforePos];
  const from = 'FROM chapter_fts f JOIN chapters c ON c.rid = f.rowid JOIN novels n ON n.id = c.novel_id';
  const total = (await db.get<{ n: number }>(`SELECT count(*) AS n ${from} WHERE ${where}`, params))?.n ?? 0;
  const rows = await db.all<{ chapterId: string; position: number; chapterTitle: string; snip: string }>(
    `SELECT c.id AS chapterId, c.position AS position,
            CASE WHEN n.reading_mode = 'book' AND c.original_title != '' THEN c.original_title ELSE c.title END AS chapterTitle,
            snippet(chapter_fts, 1, char(1), char(2), '…', 22) AS snip
     ${from} WHERE ${where} ORDER BY c.position ${opts.oldestFirst ? 'ASC' : 'DESC'} LIMIT ? OFFSET ?`,
    [...params, opts.limit ?? 5, opts.offset ?? 0],
  );
  return { hits: rows.map(({ snip, ...r }) => ({ ...r, snippet: snippetToHtml(snip) })), total };
}

/** Chapter titles by position, for "first appeared in …". */
export async function chapterTitleMap(db: Db, novelId: string): Promise<Map<number, { id: string; title: string }>> {
  const rows = await db.all<{ id: string; position: number; title: string; original_title: string; mode: string }>(
    `SELECT c.id, c.position, c.title, c.original_title, n.reading_mode AS mode FROM chapters c JOIN novels n ON n.id = c.novel_id WHERE c.novel_id = ?`,
    [novelId],
  );
  return new Map(rows.map((r) => [r.position, { id: r.id, title: r.mode === 'book' && r.original_title ? r.original_title : r.title }]));
}
