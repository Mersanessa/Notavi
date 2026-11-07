import type { Db } from '../db/types';
import { localDay } from '../lib/text';
import type { NovelSummary, ReadingStatus } from './model';

export interface DayActivity {
  day: string;
  ms: number;
  chapters: number;
}

export interface MonthActivity {
  month: string; // YYYY-MM
  ms: number;
  chapters: number;
}

export interface Stats {
  novels: number;
  chaptersRead: number;
  readingMs: number;
  readingMsThisWeek: number;
  currentStreak: number;
  longestStreak: number;
  activeDays: number;
  byStatus: Record<ReadingStatus, number>;
  favourites: number;
  annotations: number;
  days: DayActivity[];
  months: MonthActivity[];
  topNovels: { novelId: string; title: string; ms: number }[];
}

function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n, 12);
  return localDay(dt.getTime());
}

/** Current and longest run of consecutive active days. A streak survives until the end of the day after the last activity. */
export function computeStreaks(activeDays: string[], today = localDay()): { current: number; longest: number } {
  const set = new Set(activeDays);
  const sorted = [...set].sort();
  let longest = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of sorted) {
    run = prev && addDays(prev, 1) === d ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = d;
  }
  let current = 0;
  let cursor = set.has(today) ? today : addDays(today, -1);
  while (set.has(cursor)) {
    current++;
    cursor = addDays(cursor, -1);
  }
  return { current, longest };
}

export async function getStats(db: Db, opts: { days?: number; now?: number } = {}): Promise<Stats> {
  const now = opts.now ?? Date.now();
  const today = localDay(now);
  const nDays = opts.days ?? 182;
  const firstDay = addDays(today, -(nDays - 1));

  const [novels, chapters, time, statusRows, favs, ann, timeByDay, chByDay, top] = await Promise.all([
    db.get<{ n: number }>('SELECT count(*) AS n FROM novels'),
    db.get<{ n: number }>('SELECT count(*) AS n FROM chapter_completions'),
    db.get<{ ms: number }>('SELECT coalesce(sum(duration_ms), 0) AS ms FROM reading_log'),
    db.all<{ status: ReadingStatus; n: number }>('SELECT status, count(*) AS n FROM novels GROUP BY status'),
    db.get<{ n: number }>('SELECT count(*) AS n FROM novels WHERE favourite = 1'),
    db.get<{ n: number }>('SELECT count(*) AS n FROM annotations'),
    db.all<{ day: string; ms: number }>('SELECT day, sum(duration_ms) AS ms FROM reading_log GROUP BY day'),
    db.all<{ day: string; n: number }>('SELECT day, count(*) AS n FROM chapter_completions GROUP BY day'),
    db.all<{ novelId: string; title: string; ms: number }>(
      `SELECT l.novel_id AS novelId, coalesce(n.title, 'Deleted novel') AS title, sum(l.duration_ms) AS ms
       FROM reading_log l LEFT JOIN novels n ON n.id = l.novel_id GROUP BY l.novel_id ORDER BY ms DESC LIMIT 5`,
    ),
  ]);

  const msByDay = new Map(timeByDay.map((r) => [r.day, r.ms]));
  const chByDayMap = new Map(chByDay.map((r) => [r.day, r.n]));
  const active = new Set<string>([...timeByDay.filter((r) => r.ms >= 60000).map((r) => r.day), ...chByDay.map((r) => r.day)]);
  const { current, longest } = computeStreaks([...active], today);

  const days: DayActivity[] = [];
  for (let d = firstDay; d <= today; d = addDays(d, 1)) days.push({ day: d, ms: msByDay.get(d) ?? 0, chapters: chByDayMap.get(d) ?? 0 });

  const months: MonthActivity[] = [];
  const t = new Date(now);
  for (let i = 11; i >= 0; i--) {
    const m = new Date(t.getFullYear(), t.getMonth() - i, 1);
    const key = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`;
    let ms = 0;
    let ch = 0;
    for (const [day, v] of msByDay) if (day.startsWith(key)) ms += v;
    for (const [day, v] of chByDayMap) if (day.startsWith(key)) ch += v;
    months.push({ month: key, ms, chapters: ch });
  }

  // Week starts Monday.
  const dow = (new Date(now).getDay() + 6) % 7;
  const weekStart = addDays(today, -dow);
  let week = 0;
  for (const [day, v] of msByDay) if (day >= weekStart && day <= today) week += v;

  const byStatus: Record<ReadingStatus, number> = { want_to_read: 0, reading: 0, on_hold: 0, completed: 0, dropped: 0 };
  for (const r of statusRows) byStatus[r.status] = r.n;

  return {
    novels: novels!.n,
    chaptersRead: chapters!.n,
    readingMs: time!.ms,
    readingMsThisWeek: week,
    currentStreak: current,
    longestStreak: longest,
    activeDays: active.size,
    byStatus,
    favourites: favs!.n,
    annotations: ann!.n,
    days,
    months,
    topNovels: top,
  };
}

/* ------------------------------------------------------------------ recommendations */

/**
 * "Recommended from my library": unstarted or paused novels ranked by genre/tag
 * similarity to what you've favourited, finished or are reading. Pure function.
 */
export function recommend(novels: NovelSummary[], limit = 8): { novel: NovelSummary; reason: string; score: number }[] {
  const liked = novels.filter((n) => n.favourite || n.status === 'completed' || n.status === 'reading');
  if (!liked.length) return [];
  const weight = new Map<string, number>();
  const key = (kind: 'g' | 't', v: string) => `${kind}:${v.toLowerCase()}`;
  for (const n of liked) {
    const w = (n.favourite ? 2 : 1) * (n.status === 'completed' ? 1.5 : 1);
    for (const g of n.genres) weight.set(key('g', g), (weight.get(key('g', g)) ?? 0) + 2 * w);
    for (const t of n.tags) weight.set(key('t', t), (weight.get(key('t', t)) ?? 0) + w);
  }
  const candidates = novels.filter((n) => (n.status === 'want_to_read' || n.status === 'on_hold') && n.contentType !== 'external_link');
  const scored = candidates.map((n) => {
    const feats = [...n.genres.map((g) => key('g', g)), ...n.tags.map((t) => key('t', t))];
    let s = 0;
    const matched: string[] = [];
    for (const f of feats) {
      const w = weight.get(f);
      if (w) {
        s += w;
        matched.push(f.slice(2));
      }
    }
    // Normalise so novels with huge tag lists don't dominate.
    const score = feats.length ? s / Math.sqrt(feats.length) : 0;
    const display = [...n.genres, ...n.tags].filter((x) => matched.includes(x.toLowerCase())).slice(0, 3);
    return { novel: n, score, reason: display.length ? `Shares ${display.join(', ')}` : '' };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || b.novel.createdAt - a.novel.createdAt)
    .slice(0, limit);
}
