import type { Db, Stmt } from '../db/types';
import { localDay } from '../lib/text';
import type { Progress } from './model';

/** A chapter counts as finished once the reader has seen this much of it. */
export const COMPLETE_RATIO = 0.92;

type ProgressRow = { novel_id: string; chapter_id: string; block_index: number; block_offset: number; chapter_ratio: number; updated_at: number };

export async function getProgress(db: Db, novelId: string): Promise<Progress | undefined> {
  const r = await db.get<ProgressRow>('SELECT * FROM progress WHERE novel_id = ?', [novelId]);
  return r
    ? { novelId: r.novel_id, chapterId: r.chapter_id, blockIndex: r.block_index, blockOffset: r.block_offset, chapterRatio: r.chapter_ratio, updatedAt: r.updated_at }
    : undefined;
}

function completeStmts(novelId: string, chapterId: string, now: number): Stmt[] {
  return [
    {
      sql: `INSERT INTO chapter_reads(chapter_id, novel_id, first_opened_at, last_opened_at, max_ratio, completed_at)
            VALUES (?, ?, ?, ?, 1, ?)
            ON CONFLICT(chapter_id) DO UPDATE SET max_ratio = 1, completed_at = coalesce(completed_at, excluded.completed_at)`,
      params: [chapterId, novelId, now, now, now],
    },
    {
      sql: 'INSERT OR IGNORE INTO chapter_completions(chapter_id, novel_id, day, completed_at) VALUES (?, ?, ?, ?)',
      params: [chapterId, novelId, localDay(now), now],
    },
  ];
}

/**
 * Record the reading position. Called frequently (debounced) while reading.
 * Also records chapter history, marks the chapter finished once the reader
 * reaches its end, and moves a "Want to Read" novel to "Reading".
 */
export async function saveProgress(db: Db, p: Omit<Progress, 'updatedAt'>, now = Date.now()): Promise<void> {
  const ratio = Math.max(0, Math.min(1, p.chapterRatio));
  const stmts: Stmt[] = [
    {
      sql: `INSERT INTO progress(novel_id, chapter_id, block_index, block_offset, chapter_ratio, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(novel_id) DO UPDATE SET chapter_id = excluded.chapter_id, block_index = excluded.block_index,
              block_offset = excluded.block_offset, chapter_ratio = excluded.chapter_ratio, updated_at = excluded.updated_at`,
      params: [p.novelId, p.chapterId, p.blockIndex, p.blockOffset, ratio, now],
    },
    {
      sql: `INSERT INTO chapter_reads(chapter_id, novel_id, first_opened_at, last_opened_at, max_ratio)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(chapter_id) DO UPDATE SET last_opened_at = excluded.last_opened_at,
              max_ratio = max(max_ratio, excluded.max_ratio)`,
      params: [p.chapterId, p.novelId, now, now, ratio],
    },
    {
      sql: `UPDATE novels SET last_read_at = ?,
              status = CASE WHEN status = 'want_to_read' THEN 'reading' ELSE status END
            WHERE id = ?`,
      params: [now, p.novelId],
    },
  ];
  if (ratio >= COMPLETE_RATIO) stmts.push(...completeStmts(p.novelId, p.chapterId, now));
  await db.batch(stmts);
}

export async function markChapterCompleted(db: Db, novelId: string, chapterId: string, now = Date.now()): Promise<void> {
  await db.batch(completeStmts(novelId, chapterId, now));
}

export async function setChapterRead(db: Db, novelId: string, chapterId: string, read: boolean): Promise<void> {
  if (read) return markChapterCompleted(db, novelId, chapterId);
  await db.batch([
    { sql: 'UPDATE chapter_reads SET completed_at = NULL, max_ratio = 0 WHERE chapter_id = ?', params: [chapterId] },
    { sql: 'DELETE FROM chapter_completions WHERE chapter_id = ?', params: [chapterId] },
  ]);
}

/** Mark every chapter before `position` as read (e.g. when starting mid-way through a novel). */
export async function markReadUpTo(db: Db, novelId: string, position: number): Promise<void> {
  const ids = await db.all<{ id: string }>('SELECT id FROM chapters WHERE novel_id = ? AND position < ?', [novelId, position]);
  const now = Date.now();
  await db.batch(ids.flatMap((r) => completeStmts(novelId, r.id, now)));
}

export async function resetProgress(db: Db, novelId: string): Promise<void> {
  await db.batch([
    { sql: 'DELETE FROM progress WHERE novel_id = ?', params: [novelId] },
    { sql: 'DELETE FROM chapter_reads WHERE novel_id = ?', params: [novelId] },
  ]);
}

/** Append measured active reading time. Slices shorter than a second are dropped. */
export async function logReading(
  db: Db,
  entry: { novelId: string; chapterId: string | null; startedAt: number; durationMs: number; words?: number },
): Promise<void> {
  if (entry.durationMs < 1000) return;
  const duration = Math.min(entry.durationMs, 6 * 60 * 60 * 1000);
  await db.run(
    'INSERT INTO reading_log(novel_id, chapter_id, day, started_at, duration_ms, words) VALUES (?, ?, ?, ?, ?, ?)',
    [entry.novelId, entry.chapterId, localDay(entry.startedAt), entry.startedAt, Math.round(duration), entry.words ?? 0],
  );
}

export interface RecentChapter {
  chapterId: string;
  novelId: string;
  novelTitle: string;
  coverId: string | null;
  chapterTitle: string;
  position: number;
  lastOpenedAt: number;
  maxRatio: number;
}

export async function recentlyReadChapters(db: Db, limit = 8): Promise<RecentChapter[]> {
  return db.all<RecentChapter>(
    `SELECT r.chapter_id AS chapterId, r.novel_id AS novelId, n.title AS novelTitle, n.cover_id AS coverId,
            c.title AS chapterTitle, c.position AS position, r.last_opened_at AS lastOpenedAt, r.max_ratio AS maxRatio
     FROM chapter_reads r JOIN chapters c ON c.id = r.chapter_id JOIN novels n ON n.id = r.novel_id
     ORDER BY r.last_opened_at DESC LIMIT ?`,
    [limit],
  );
}

export async function novelReadingTime(db: Db, novelId: string): Promise<number> {
  return (await db.get<{ ms: number }>('SELECT coalesce(sum(duration_ms), 0) AS ms FROM reading_log WHERE novel_id = ?', [novelId]))!.ms;
}
