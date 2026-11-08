import { useCallback, useEffect, useMemo, useState } from 'react';
import { db, useStore } from '../../app/store';
import type { Db } from '../../db/types';
import { getChapter } from '../../data/novels';
import { getProgress } from '../../data/reading';
import { getLoreOverrides } from '../../data/lore';
import { ensureLore, cachedLore } from '../../lore/build';
import { scanChapter, type LoreIndex } from '../../lore/extract';
import { loreView, type LoreOverride, type LoreView, type Upto } from '../../lore/view';

export interface ReadingPoint extends Upto {
  /** Human description of where the spoiler line sits. */
  chapterId: string | null;
  chapterTitle: string | null;
  finished: boolean;
}

/** Where a novel's spoiler line is: the start of the chapter you're on, plus what you've read of it. */
export async function readingPoint(d: Db, novelId: string, status: string): Promise<ReadingPoint> {
  if (status === 'completed') return { pos: Number.MAX_SAFE_INTEGER, chapterId: null, chapterTitle: null, finished: true };
  const p = await getProgress(d, novelId);
  if (!p) return { pos: 0, chapterId: null, chapterTitle: null, finished: false };
  const ch = await getChapter(d, p.chapterId);
  if (!ch) return { pos: 0, chapterId: null, chapterTitle: null, finished: false };
  if (p.chapterRatio >= 0.97) return { pos: ch.position + 1, chapterId: ch.id, chapterTitle: ch.title, finished: false };
  return { pos: ch.position, live: scanChapter(ch.content, ch.position, p.blockIndex), chapterId: ch.id, chapterTitle: ch.title, finished: false };
}

export interface LoreState {
  status: 'loading' | 'building' | 'ready' | 'error';
  progress: { done: number; total: number } | null;
  index: LoreIndex | null;
  overrides: LoreOverride[];
  point: ReadingPoint | null;
  view: LoreView | null;
  reload: () => void;
}

/** Everything a Lore screen needs for one novel, cut off at your reading position. */
export function useLore(novelId: string | null, opts: { includeHidden?: boolean } = {}): LoreState {
  const novels = useStore((s) => s.novels);
  const novel = novels.find((n) => n.id === novelId) ?? null;
  const [index, setIndex] = useState<LoreIndex | null>(() => (novelId ? cachedLore(novelId) ?? null : null));
  const [overrides, setOverrides] = useState<LoreOverride[]>([]);
  const [point, setPoint] = useState<ReadingPoint | null>(null);
  const [status, setStatus] = useState<LoreState['status']>('loading');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!novelId || !novel) return;
    let alive = true;
    setStatus(cachedLore(novelId) ? 'ready' : 'loading');
    void (async () => {
      try {
        const [ov, pt] = await Promise.all([getLoreOverrides(db(), novelId), readingPoint(db(), novelId, novel.status)]);
        if (!alive) return;
        setOverrides(ov);
        setPoint(pt);
        const idx = await ensureLore(db(), novelId, (done, total) => {
          if (!alive) return;
          setStatus('building');
          setProgress({ done, total });
        });
        if (!alive) return;
        setIndex(idx);
        setStatus('ready');
      } catch (e) {
        console.error(e);
        if (alive) setStatus('error');
      }
    })();
    return () => {
      alive = false;
    };
  }, [novelId, novel?.status, novel?.progress?.chapterId, novel?.contentUpdatedAt, tick]);

  const view = useMemo(() => (index && point ? loreView(index, overrides, point, opts) : null), [index, point, overrides, opts.includeHidden]);
  return { status, progress, index, overrides, point, view, reload };
}
