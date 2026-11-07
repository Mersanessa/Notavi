import type { Db, Stmt } from '../db/types';
import { countWords, htmlToText, newId, sortKey, uniqueStrings } from '../lib/text';
import type { Chapter, ChapterMeta, Novel, NovelInput, NovelSummary, ParsedNovel } from './model';

/* ------------------------------------------------------------------ rows */

type NovelRow = {
  id: string; title: string; alt_titles: string; author: string; translator: string; description: string;
  genres: string; tags: string; content_type: Novel['contentType']; source: string; licence_notes: string;
  external_url: string; status: Novel['status']; publication_status: string; favourite: number;
  personal_notes: string; cover_id: string | null; language: string; created_at: number; updated_at: number;
  content_updated_at: number; last_read_at: number | null;
};
type SummaryRow = NovelRow & {
  chapter_count: number; total_words: number; chapters_read: number;
  p_chapter_id: string | null; p_ratio: number | null; p_position: number | null; p_title: string | null;
};

function parseList(s: string): string[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function rowToNovel(r: NovelRow): Novel {
  return {
    id: r.id,
    title: r.title,
    altTitles: parseList(r.alt_titles),
    author: r.author,
    translator: r.translator,
    description: r.description,
    genres: parseList(r.genres),
    tags: parseList(r.tags),
    contentType: r.content_type,
    source: r.source,
    licenceNotes: r.licence_notes,
    externalUrl: r.external_url,
    status: r.status,
    publicationStatus: r.publication_status,
    favourite: !!r.favourite,
    personalNotes: r.personal_notes,
    coverId: r.cover_id,
    language: r.language,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    contentUpdatedAt: r.content_updated_at,
    lastReadAt: r.last_read_at,
  };
}

function rowToSummary(r: SummaryRow): NovelSummary {
  const n = rowToNovel(r);
  const progress =
    r.p_chapter_id && r.p_position !== null
      ? { chapterId: r.p_chapter_id, position: r.p_position, ratio: r.p_ratio ?? 0, chapterTitle: r.p_title ?? '' }
      : null;
  let percent = 0;
  if (r.chapter_count > 0) {
    percent = progress ? (progress.position + Math.min(1, progress.ratio)) / r.chapter_count : r.chapters_read / r.chapter_count;
  }
  if (n.status === 'completed' && r.chapters_read >= r.chapter_count) percent = 1;
  return {
    ...n,
    chapterCount: r.chapter_count,
    totalWords: r.total_words,
    chaptersRead: r.chapters_read,
    progress,
    percent: Math.max(0, Math.min(1, percent)),
  };
}

const SUMMARY_SQL = `
SELECT n.*,
  (SELECT count(*) FROM chapters c WHERE c.novel_id = n.id) AS chapter_count,
  (SELECT coalesce(sum(c.word_count), 0) FROM chapters c WHERE c.novel_id = n.id) AS total_words,
  (SELECT count(*) FROM chapter_reads r WHERE r.novel_id = n.id AND r.completed_at IS NOT NULL) AS chapters_read,
  p.chapter_id AS p_chapter_id, p.chapter_ratio AS p_ratio, pc.position AS p_position, pc.title AS p_title
FROM novels n
LEFT JOIN progress p ON p.novel_id = n.id
LEFT JOIN chapters pc ON pc.id = p.chapter_id`;

/* ------------------------------------------------------------------ novels */

export async function listNovels(db: Db): Promise<NovelSummary[]> {
  const rows = await db.all<SummaryRow>(`${SUMMARY_SQL} ORDER BY n.sort_title`);
  return rows.map(rowToSummary);
}

export async function getNovel(db: Db, id: string): Promise<NovelSummary | undefined> {
  const row = await db.get<SummaryRow>(`${SUMMARY_SQL} WHERE n.id = ?`, [id]);
  return row ? rowToSummary(row) : undefined;
}

export async function novelExists(db: Db, id: string): Promise<boolean> {
  return !!(await db.get('SELECT 1 FROM novels WHERE id = ?', [id]));
}

function normalizeInput(input: Partial<NovelInput>) {
  const out: Partial<NovelInput> = { ...input };
  if (out.title !== undefined) out.title = out.title.replace(/\s+/g, ' ').trim();
  if (out.altTitles) out.altTitles = uniqueStrings(out.altTitles);
  if (out.genres) out.genres = uniqueStrings(out.genres);
  if (out.tags) out.tags = uniqueStrings(out.tags);
  for (const k of ['author', 'translator', 'source', 'externalUrl', 'language', 'publicationStatus'] as const) {
    if (out[k] !== undefined) out[k] = (out[k] as string).trim();
  }
  return out;
}

const FIELD_COLUMNS: Record<string, string> = {
  title: 'title', altTitles: 'alt_titles', author: 'author', translator: 'translator', description: 'description',
  genres: 'genres', tags: 'tags', contentType: 'content_type', source: 'source', licenceNotes: 'licence_notes',
  externalUrl: 'external_url', status: 'status', publicationStatus: 'publication_status', favourite: 'favourite',
  personalNotes: 'personal_notes', language: 'language',
};

function columnValue(key: string, v: unknown) {
  if (Array.isArray(v)) return JSON.stringify(v);
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v as string;
}

/** Statements that rebuild a novel's metadata search row from the table. */
function novelFtsStmts(id: string): Stmt[] {
  return [
    { sql: 'DELETE FROM novel_fts WHERE rowid = (SELECT rid FROM novels WHERE id = ?)', params: [id] },
    {
      sql: `INSERT INTO novel_fts(rowid, title, alt_titles, author, translator, genres, tags, description)
            SELECT rid, title,
              (SELECT group_concat(value, ' | ') FROM json_each(alt_titles)), author, translator,
              (SELECT group_concat(value, ' | ') FROM json_each(genres)),
              (SELECT group_concat(value, ' | ') FROM json_each(tags)), description
            FROM novels WHERE id = ?`,
      params: [id],
    },
  ];
}

export function chapterInsertStmts(novelId: string, position: number, ch: { id?: string; title: string; content: string }, now: number) {
  const id = ch.id ?? newId();
  const text = htmlToText(ch.content);
  const stmts: Stmt[] = [
    {
      sql: `INSERT INTO chapters(id, novel_id, position, title, content, word_count, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [id, novelId, position, ch.title, ch.content, countWords(text), now, now],
    },
    {
      sql: 'INSERT INTO chapter_fts(rowid, title, body) VALUES ((SELECT rid FROM chapters WHERE id = ?), ?, ?)',
      params: [id, ch.title, text],
    },
  ];
  return { id, stmts };
}

export interface CreateNovelOptions {
  cover?: { mime: string; data: Uint8Array } | null;
  chapters?: { title: string; content: string }[];
  images?: { id: string; mime: string; data: Uint8Array }[];
}

export async function createNovel(db: Db, input: NovelInput, opts: CreateNovelOptions = {}): Promise<string> {
  const n = normalizeInput(input) as NovelInput;
  if (!n.title) throw new Error('A title is required.');
  const id = newId();
  const now = Date.now();
  const coverId = opts.cover ? newId() : null;
  const stmts: Stmt[] = [
    {
      sql: `INSERT INTO novels(id, title, sort_title, alt_titles, author, translator, description, genres, tags,
              content_type, source, licence_notes, external_url, status, publication_status, favourite,
              personal_notes, cover_id, language, created_at, updated_at, content_updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      params: [
        id, n.title, sortKey(n.title), JSON.stringify(n.altTitles ?? []), n.author ?? '', n.translator ?? '',
        n.description ?? '', JSON.stringify(n.genres ?? []), JSON.stringify(n.tags ?? []),
        n.contentType ?? 'personal_import', n.source ?? '', n.licenceNotes ?? '', n.externalUrl ?? '',
        n.status ?? 'want_to_read', n.publicationStatus ?? '', n.favourite ? 1 : 0, n.personalNotes ?? '',
        coverId, n.language ?? '', now, now, now,
      ],
    },
  ];
  if (opts.cover && coverId) {
    stmts.push({
      sql: "INSERT INTO blobs(id, novel_id, kind, mime, data, created_at) VALUES (?, ?, 'cover', ?, ?, ?)",
      params: [coverId, id, opts.cover.mime, opts.cover.data, now],
    });
  }
  for (const img of opts.images ?? []) {
    stmts.push({
      sql: "INSERT INTO blobs(id, novel_id, kind, mime, data, created_at) VALUES (?, ?, 'image', ?, ?, ?)",
      params: [img.id, id, img.mime, img.data, now],
    });
  }
  (opts.chapters ?? []).forEach((ch, i) => stmts.push(...chapterInsertStmts(id, i, ch, now).stmts));
  stmts.push(...novelFtsStmts(id));
  await db.batch(stmts);
  return id;
}

/** Store a parsed import. `overrides` are fields the user set in the import dialog. */
export async function importParsed(db: Db, parsed: ParsedNovel, overrides: Partial<NovelInput> = {}): Promise<string> {
  return createNovel(
    db,
    {
      title: parsed.title,
      author: parsed.author,
      translator: parsed.translator,
      description: parsed.description,
      language: parsed.language,
      genres: parsed.genres,
      tags: parsed.tags,
      altTitles: parsed.altTitles,
      source: parsed.source,
      contentType: 'personal_import',
      ...Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== undefined)),
    } as NovelInput,
    { cover: parsed.cover, chapters: parsed.chapters, images: parsed.images },
  );
}

export async function updateNovel(db: Db, id: string, patch: Partial<NovelInput>): Promise<void> {
  const p = normalizeInput(patch);
  if (p.title !== undefined && !p.title) throw new Error('A title is required.');
  const sets: string[] = [];
  const params: (string | number)[] = [];
  for (const [k, v] of Object.entries(p)) {
    const col = FIELD_COLUMNS[k];
    if (!col || v === undefined) continue;
    sets.push(`${col} = ?`);
    params.push(columnValue(k, v));
  }
  if (p.title) {
    sets.push('sort_title = ?');
    params.push(sortKey(p.title));
  }
  if (!sets.length) return;
  // "Recently updated" uses content_updated_at, so metadata edits don't reshuffle it.
  sets.push('updated_at = ?');
  params.push(Date.now());
  await db.batch([{ sql: `UPDATE novels SET ${sets.join(', ')} WHERE id = ?`, params: [...params, id] }, ...novelFtsStmts(id)]);
}

export async function deleteNovel(db: Db, id: string): Promise<void> {
  await db.batch([{ sql: 'DELETE FROM novels WHERE id = ?', params: [id] }]);
}

/* ------------------------------------------------------------------ blobs */

export async function setCover(db: Db, novelId: string, cover: { mime: string; data: Uint8Array } | null): Promise<string | null> {
  const now = Date.now();
  const coverId = cover ? newId() : null;
  const stmts: Stmt[] = [{ sql: "DELETE FROM blobs WHERE novel_id = ? AND kind = 'cover'", params: [novelId] }];
  if (cover) {
    stmts.push({
      sql: "INSERT INTO blobs(id, novel_id, kind, mime, data, created_at) VALUES (?, ?, 'cover', ?, ?, ?)",
      params: [coverId, novelId, cover.mime, cover.data, now],
    });
  }
  stmts.push({ sql: 'UPDATE novels SET cover_id = ?, updated_at = ? WHERE id = ?', params: [coverId, now, novelId] });
  await db.batch(stmts);
  return coverId;
}

export async function getBlob(db: Db, id: string): Promise<{ mime: string; data: Uint8Array } | undefined> {
  return db.get<{ mime: string; data: Uint8Array }>('SELECT mime, data FROM blobs WHERE id = ?', [id]);
}

/* ------------------------------------------------------------------ chapters */

type ChapterRow = {
  id: string; novel_id: string; position: number; title: string; word_count: number;
  created_at: number; updated_at: number; content?: string; completed_at?: number | null; opened?: number | null;
};

function rowToChapterMeta(r: ChapterRow): ChapterMeta {
  return {
    id: r.id,
    novelId: r.novel_id,
    position: r.position,
    title: r.title,
    wordCount: r.word_count,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    completed: r.completed_at != null,
    opened: r.opened != null,
  };
}

export async function listChapters(db: Db, novelId: string): Promise<ChapterMeta[]> {
  const rows = await db.all<ChapterRow>(
    `SELECT c.id, c.novel_id, c.position, c.title, c.word_count, c.created_at, c.updated_at,
            r.completed_at, r.first_opened_at AS opened
     FROM chapters c LEFT JOIN chapter_reads r ON r.chapter_id = c.id
     WHERE c.novel_id = ? ORDER BY c.position`,
    [novelId],
  );
  return rows.map(rowToChapterMeta);
}

export async function getChapter(db: Db, id: string): Promise<Chapter | undefined> {
  const r = await db.get<ChapterRow>('SELECT * FROM chapters WHERE id = ?', [id]);
  return r ? { ...rowToChapterMeta(r), content: r.content ?? '' } : undefined;
}

export async function getChapterAt(db: Db, novelId: string, position: number): Promise<Chapter | undefined> {
  const r = await db.get<ChapterRow>('SELECT * FROM chapters WHERE novel_id = ? AND position = ?', [novelId, position]);
  return r ? { ...rowToChapterMeta(r), content: r.content ?? '' } : undefined;
}

function touchContent(novelId: string, now: number): Stmt {
  return { sql: 'UPDATE novels SET content_updated_at = ?, updated_at = ? WHERE id = ?', params: [now, now, novelId] };
}

/** Add a chapter. `position` defaults to the end; existing chapters shift down. */
export async function addChapter(db: Db, novelId: string, ch: { title: string; content: string }, position?: number): Promise<string> {
  const count = (await db.get<{ n: number }>('SELECT count(*) AS n FROM chapters WHERE novel_id = ?', [novelId]))!.n;
  const pos = position === undefined ? count : Math.max(0, Math.min(count, position));
  const now = Date.now();
  const { id, stmts } = chapterInsertStmts(novelId, pos, { title: ch.title.trim() || `Chapter ${pos + 1}`, content: ch.content }, now);
  await db.batch([
    { sql: 'UPDATE chapters SET position = position + 1 WHERE novel_id = ? AND position >= ?', params: [novelId, pos] },
    ...stmts,
    touchContent(novelId, now),
  ]);
  return id;
}

export async function updateChapter(db: Db, id: string, patch: { title?: string; content?: string }): Promise<void> {
  const cur = await getChapter(db, id);
  if (!cur) throw new Error('Chapter not found.');
  const title = patch.title !== undefined ? patch.title.trim() || cur.title : cur.title;
  const content = patch.content ?? cur.content;
  const text = htmlToText(content);
  const now = Date.now();
  await db.batch([
    { sql: 'UPDATE chapters SET title = ?, content = ?, word_count = ?, updated_at = ? WHERE id = ?', params: [title, content, countWords(text), now, id] },
    { sql: 'DELETE FROM chapter_fts WHERE rowid = (SELECT rid FROM chapters WHERE id = ?)', params: [id] },
    { sql: 'INSERT INTO chapter_fts(rowid, title, body) VALUES ((SELECT rid FROM chapters WHERE id = ?), ?, ?)', params: [id, title, text] },
    touchContent(cur.novelId, now),
  ]);
}

export async function deleteChapter(db: Db, id: string): Promise<void> {
  const cur = await db.get<{ novel_id: string; position: number }>('SELECT novel_id, position FROM chapters WHERE id = ?', [id]);
  if (!cur) return;
  const now = Date.now();
  await db.batch([
    { sql: 'DELETE FROM chapters WHERE id = ?', params: [id] },
    { sql: 'UPDATE chapters SET position = position - 1 WHERE novel_id = ? AND position > ?', params: [cur.novel_id, cur.position] },
    touchContent(cur.novel_id, now),
  ]);
}

/** Persist a new chapter order. `orderedIds` must contain every chapter of the novel exactly once. */
export async function reorderChapters(db: Db, novelId: string, orderedIds: string[]): Promise<void> {
  const existing = (await db.all<{ id: string }>('SELECT id FROM chapters WHERE novel_id = ?', [novelId])).map((r) => r.id);
  if (existing.length !== orderedIds.length || new Set(orderedIds).size !== orderedIds.length || !orderedIds.every((id) => existing.includes(id))) {
    throw new Error('The new chapter order must include every chapter exactly once.');
  }
  const now = Date.now();
  await db.batch([
    ...orderedIds.map((id, i) => ({ sql: 'UPDATE chapters SET position = ? WHERE id = ? AND novel_id = ?', params: [i, id, novelId] })),
    touchContent(novelId, now),
  ]);
}

export async function moveChapter(db: Db, id: string, toPosition: number): Promise<void> {
  const cur = await db.get<{ novel_id: string }>('SELECT novel_id FROM chapters WHERE id = ?', [id]);
  if (!cur) return;
  const ids = (await db.all<{ id: string }>('SELECT id FROM chapters WHERE novel_id = ? ORDER BY position', [cur.novel_id])).map((r) => r.id);
  const from = ids.indexOf(id);
  const to = Math.max(0, Math.min(ids.length - 1, toPosition));
  if (from === to) return;
  ids.splice(from, 1);
  ids.splice(to, 0, id);
  await reorderChapters(db, cur.novel_id, ids);
}

/* ------------------------------------------------------------------ facets */

export async function allGenresAndTags(db: Db): Promise<{ genres: string[]; tags: string[] }> {
  const g = await db.all<{ v: string }>('SELECT DISTINCT j.value AS v FROM novels, json_each(novels.genres) j ORDER BY j.value COLLATE NOCASE');
  const t = await db.all<{ v: string }>('SELECT DISTINCT j.value AS v FROM novels, json_each(novels.tags) j ORDER BY j.value COLLATE NOCASE');
  return { genres: uniqueStrings(g.map((r) => r.v)), tags: uniqueStrings(t.map((r) => r.v)) };
}
