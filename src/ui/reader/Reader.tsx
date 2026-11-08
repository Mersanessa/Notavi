import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Bookmark, BookmarkCheck, ChevronLeft, ChevronRight, List, Maximize, Minimize, Type, X, ChevronUp, ChevronDown, CircleCheck, Headphones, Gauge, Search } from 'lucide-react';
import { db, mutate, refreshLibrary, toast, useStore } from '../../app/store';
import { navigate, routes, useRoute } from '../../app/router';
import { resolveBlobRefs } from '../../app/blobs';
import { DEFAULT_BOOK, READER_FONTS, applyAppTheme, setThemeColour, type ReaderTheme } from '../../app/prefs';
import type { Annotation, Chapter, ChapterMeta, HighlightColor, NovelSummary, ReadingMode } from '../../data/model';
import { displayTitle, getChapter, getNovel, listChapters, updateNovel } from '../../data/novels';
import { Cover } from '../components/Cover';
import { getProgress, logReading, markChapterCompleted, saveProgress } from '../../data/reading';
import { addAnnotation, deleteAnnotation, listAnnotationsForChapter, listAnnotationsForNovel, toggleChapterBookmark, updateAnnotation } from '../../data/annotations';
import { sanitizeChapterHtml } from '../../import/dom';
import { formatMinutes, formatNumber, localDay, readingMinutes } from '../../lib/text';
import { readingMsOn } from '../../data/stats';
import { keepScreenOn, setFullscreen, copyText } from '../../platform';
import { haptic } from '../../platform/haptics';
import { IconButton, Button } from '../components/Button';
import { Spinner, EmptyState } from '../components/misc';
import { captureAnchor, capturePageAnchor, findMatches, getBlocks, locate, pageForAnchor, pageOfX, rangeFromOffsets, scrollToAnchor, textOffset, unwrapAll, wrapRange, type Anchor, type PageFlow } from './anchors';

const THEME_BG: Record<ReaderTheme, string> = { night: '#141a1f', black: '#000000', sepia: '#f3e8d2', paper: '#f7f7f3' };

/** Chapter titles as the chosen format shows them. */
function titled(list: ChapterMeta[], mode: ReadingMode): ChapterMeta[] {
  return list.map((c) => ({ ...c, title: displayTitle(c, mode) }));
}

interface Geometry {
  /** Width of one page turn (the whole screen). */
  stride: number;
  cols: 1 | 2;
  padX: number;
}
import { ReaderSettings } from './ReaderSettings';
import { ReaderDrawer } from './ReaderDrawer';
import { SelectionToolbar, HighlightPopover, type SelectionInfo } from './SelectionToolbar';
import { NoteDialog } from './NoteDialog';
import { SpeechDock, ScrollDock } from './ReaderDock';
import { Speaker, speechSupported, splitSentences, type Sentence } from './speech';

type PageMotion = '' | 'is-fading' | 'is-entering-next' | 'is-entering-prev' | 'is-turning-next' | 'is-turning-prev';

/** CSS Custom Highlight API (Safari 17.2+, Chrome 105+): paints the spoken sentence without touching the DOM. */
function speechHighlight(range: Range | null) {
  const reg = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
  const H = (window as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
  if (!reg || !H) return;
  if (range) reg.set('notavi-tts', new H(range));
  else reg.delete('notavi-tts');
}

/** A quiet toast (and a success tap) the first time today's reading reaches the daily goal. */
async function celebrateGoal() {
  const goal = useStore.getState().app.dailyGoal;
  if (!goal) return;
  const day = localDay();
  try {
    if (localStorage.getItem('notavi.goalMet') === day) return;
    if ((await readingMsOn(db(), day)) < goal * 60000) return;
    localStorage.setItem('notavi.goalMet', day);
  } catch {
    return;
  }
  toast({ message: `Daily goal reached: ${goal} minutes today`, tone: 'success' });
}

const IDLE_MS = 3 * 60 * 1000; // stop counting reading time after 3 minutes without interaction
const SHORT_CHAPTER_DWELL_MS = 8000;
const TOP_INSET = 8;

interface Loaded {
  novel: NovelSummary;
  chapters: ChapterMeta[];
}

export function Reader({ novelId, chapterId: requestedChapterId }: { novelId: string; chapterId: string | null }) {
  const prefs = useStore((s) => s.reader);
  const reduceMotion = useStore((s) => s.app.reduceMotion);
  const { query } = useRoute();
  const jumpAnnotation = query.get('a');
  const findQuery = query.get('find');

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [missing, setMissing] = useState(false);
  const [chapter, setChapter] = useState<Chapter | null>(null);
  /** What's on screen: the chapter and its rendered HTML change together, never one before the other. */
  const [view, setView] = useState<{ chapter: Chapter; html: string } | null>(null);
  const html = view?.html ?? '';
  const shown = view?.chapter ?? null;
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [chrome, setChrome] = useState(true);
  const [panel, setPanel] = useState<'none' | 'settings' | 'chapters' | 'bookmarks'>('none');
  const [fullscreen, setFs] = useState(false);
  const [ratio, setRatio] = useState(0);
  const [selection, setSelection] = useState<SelectionInfo | null>(null);
  const [activeHighlight, setActiveHighlight] = useState<{ ann: Annotation; rect: DOMRect } | null>(null);
  const [noteFor, setNoteFor] = useState<{ ann?: Annotation; sel?: SelectionInfo } | null>(null);
  const [finds, setFinds] = useState<{ index: number; total: number } | null>(null);
  const [pageMotion, setPageMotion] = useState<PageMotion>('');
  const enterDir = useRef<'next' | 'prev' | null>(null);
  const [findText, setFindText] = useState<string | null>(findQuery);
  const findInput = useRef<HTMLInputElement>(null);
  const [tts, setTts] = useState<{ playing: boolean; index: number; total: number } | null>(null);
  const [auto, setAuto] = useState<{ running: boolean } | null>(null);
  const newAnn = useRef<string | null>(null);

  /* ---------------------------------------------------------------- book format: pages */

  const mode: ReadingMode = loaded?.novel.readingMode ?? 'web';
  const book = mode === 'book';
  const bookRef = useRef(book);
  bookRef.current = book;
  /** The typography in force: each format keeps its own. */
  const bookT = { ...DEFAULT_BOOK, ...prefs.book };
  const t = book ? { ...prefs, ...bookT } : prefs;

  const [vp, setVp] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const on = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  const geom: Geometry = useMemo(() => {
    const W = vp.w;
    const cols = bookT.spreads && W >= 960 && W > vp.h * 1.15 ? 2 : 1;
    const line = t.measure * t.fontSize * 0.5; // a "ch" is about half an em in these fonts
    const colSpace = cols === 2 ? W / 2 : W;
    const padX = Math.round(Math.max(t.margin, cols === 2 ? 40 : 22, (colSpace - line) / 2));
    return { stride: W, cols, padX };
  }, [vp, bookT.spreads, t.measure, t.fontSize, t.margin]);

  const pageEl = useRef<HTMLDivElement>(null);
  const flowEnd = useRef<HTMLSpanElement>(null);
  const [pageIdx, setPageIdx] = useState(0);
  const pageRef = useRef(0);
  const [pageCount, setPageCount] = useState(1);
  const pageCountRef = useRef(1);
  const openAtEnd = useRef(false);
  const flow = (): PageFlow | null => (pageEl.current ? { el: pageEl.current, stride: geom.stride, padX: geom.padX } : null);
  const flowRef = useRef(flow);
  flowRef.current = flow;

  /** Count the pages of the laid-out chapter. */
  function paginate() {
    const f = flowRef.current();
    const end = flowEnd.current;
    if (!f || !end) return 1;
    const n = pageOfX(f, end.getBoundingClientRect().left) + 1;
    pageCountRef.current = n;
    setPageCount(n);
    return n;
  }

  /** Show a page; the anchor, progress and status follow it. */
  function showPage(n: number, opts: { animate?: boolean; save?: boolean } = {}) {
    const last = pageCountRef.current - 1;
    const p = Math.max(0, Math.min(last, n));
    pageRef.current = p;
    setPageIdx(p);
    const el = pageEl.current;
    if (el) el.classList.toggle('no-anim', opts.animate === false);
    const f = flowRef.current();
    if (f) anchor.current = capturePageAnchor(blocks.current, f, p);
    const r = last > 0 ? p / last : 1;
    lastRatio.current = r;
    setRatio(r);
    if (opts.save !== false && renderedFor.current) schedulePersist();
  }

  /** Put an anchor back on screen in whichever format is showing. */
  function restoreAnchor(a: Anchor) {
    const s = scroller.current;
    if (!s) return;
    if (bookRef.current) {
      s.scrollTop = 0;
      s.scrollLeft = 0;
      paginate();
      const f = flowRef.current();
      showPage(f ? pageForAnchor(blocks.current, f, a) : 0, { animate: false, save: false });
      anchor.current = a;
    } else {
      scrollToAnchor(blocks.current, s, a, TOP_INSET);
      selfScrollTop.current = s.scrollTop;
    }
  }

  /** Bring an element or text range into view: its page in book format, the middle of the screen otherwise. */
  function reveal(target: Element | Range, smooth = false) {
    if (bookRef.current) {
      const f = flowRef.current();
      if (f) showPage(pageOfX(f, target.getBoundingClientRect().left + 1), { animate: smooth });
      return;
    }
    const el = target instanceof Range ? (target.startContainer.parentElement ?? null) : target;
    el?.scrollIntoView({ block: 'center', behavior: smooth && !reduceMotion ? 'smooth' : 'instant' });
  }

  const scroller = useRef<HTMLDivElement>(null);
  const article = useRef<HTMLDivElement>(null);
  const blocks = useRef<HTMLElement[]>([]);
  const anchor = useRef<Anchor>({ blockIndex: 0, blockOffset: 0 });
  const restoring = useRef(false);
  /** Which chapter the DOM currently shows; progress is only saved for that chapter. */
  const renderedFor = useRef<string | null>(null);
  const openedAt = useRef(Date.now());
  const lastInteraction = useRef(Date.now());
  const timerStart = useRef<number | null>(null);
  const cache = useRef(new Map<string, Chapter>());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chapterRef = useRef<Chapter | null>(null);
  chapterRef.current = chapter;

  /* ---------------------------------------------------------------- loading */

  // Progress, status and stats change while reading; refresh the library views on the way out.
  useEffect(() => () => void setTimeout(() => void refreshLibrary(), 50), []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [novel, chapters] = await Promise.all([getNovel(db(), novelId), listChapters(db(), novelId)]);
      if (!alive) return;
      if (!novel || !chapters.length) return setMissing(true);
      setLoaded({ novel, chapters: titled(chapters, novel.readingMode) });
    })();
    return () => {
      alive = false;
    };
  }, [novelId]);

  const loadChapter = useCallback(async (id: string) => {
    const c = cache.current.get(id) ?? (await getChapter(db(), id));
    if (c) cache.current.set(id, c);
    return c;
  }, []);

  // Pick the chapter: explicit, else where you left off, else the first.
  const [initialAnchor, setInitialAnchor] = useState<Anchor | null>(null);
  useEffect(() => {
    if (!loaded) return;
    let alive = true;
    void (async () => {
      const progress = await getProgress(db(), novelId);
      let id = requestedChapterId;
      if (!id || !loaded.chapters.some((c) => c.id === id)) id = progress?.chapterId && loaded.chapters.some((c) => c.id === progress.chapterId) ? progress.chapterId : loaded.chapters[0].id;
      const resume = progress && progress.chapterId === id && !jumpAnnotation && !findQuery;
      const c = await loadChapter(id);
      if (!alive || !c) return;
      setInitialAnchor(resume ? { blockIndex: progress.blockIndex, blockOffset: progress.blockOffset } : { blockIndex: 0, blockOffset: 0 });
      setChapter(c);
      if (id !== requestedChapterId) navigate(routes.read(novelId, id, query.toString() || undefined), { replace: true });
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, requestedChapterId]);

  // Render content + annotations for the chapter.
  useEffect(() => {
    if (!chapter) return;
    let alive = true;
    void Promise.all([resolveBlobRefs(sanitizeChapterHtml(chapter.content)), listAnnotationsForChapter(db(), chapter.id)]).then(([h, anns]) => {
      if (!alive) return;
      restoring.current = true;
      setView({ chapter, html: h });
      setAnnotations(anns);
    });
    openedAt.current = Date.now();
    return () => {
      alive = false;
    };
  }, [chapter]);

  const index = loaded && chapter ? loaded.chapters.findIndex((c) => c.id === chapter.id) : -1;
  const prev = index > 0 ? loaded!.chapters[index - 1] : null;
  const next = loaded && index >= 0 && index < loaded.chapters.length - 1 ? loaded.chapters[index + 1] : null;

  // Prefetch neighbours for instant chapter changes.
  useEffect(() => {
    if (next) void loadChapter(next.id);
    if (prev) void loadChapter(prev.id);
  }, [next, prev, loadChapter]);

  /* ---------------------------------------------------------------- painting */

  const paint = useCallback(() => {
    const root = article.current;
    if (!root) return;
    unwrapAll(root, 'mark.hl, mark.find');
    root.querySelectorAll('.has-bookmark').forEach((el) => el.classList.remove('has-bookmark'));
    const text = root.textContent ?? '';
    for (const a of annotations) {
      if (a.kind === 'chapter_bookmark') continue;
      if (a.kind === 'text_bookmark') {
        const b = blocks.current[a.blockIndex ?? -1];
        b?.classList.add('has-bookmark');
        continue;
      }
      const at = locate(text, a.startOffset ?? -1, a.endOffset ?? -1, a.quote);
      if (!at) continue;
      const range = rangeFromOffsets(root, at[0], at[1]);
      if (!range) continue;
      wrapRange(range, () => {
        const m = document.createElement('mark');
        m.className = `hl hl-${a.color}${a.note ? ' has-note' : ''}${a.id === newAnn.current ? ' is-new' : ''}`;
        m.dataset.ann = a.id;
        return m;
      });
    }
  }, [annotations]);

  useLayoutEffect(() => {
    const root = article.current;
    if (!root || !html) return;
    root.innerHTML = view!.html;
    blocks.current = getBlocks(root);
    paint();
    // Restore position: saved anchor, annotation, or search match.
    restoring.current = true;
    const s = scroller.current!;
    const apply = () => {
      const start = initialAnchor ?? { blockIndex: 0, blockOffset: 0 };
      if (bookRef.current) {
        restoreAnchor(start);
        if (openAtEnd.current) showPage(pageCountRef.current - 1, { animate: false, save: false });
      }
      if (jumpAnnotation) {
        const ann = annotations.find((a) => a.id === jumpAnnotation);
        const el = root.querySelector<HTMLElement>(`mark[data-ann="${CSS.escape(jumpAnnotation)}"]`);
        if (el) {
          reveal(el);
          el.classList.add('is-flash');
        } else if (ann?.blockIndex != null) restoreAnchor({ blockIndex: ann.blockIndex, blockOffset: 0 });
        else if (!bookRef.current) s.scrollTop = 0;
      } else if (findQuery) {
        runFind(findQuery, 0);
      } else if (!bookRef.current) {
        if (start.blockIndex > 0 || start.blockOffset > 0) scrollToAnchor(blocks.current, s, start, TOP_INSET);
        else s.scrollTop = 0;
      }
      if (!bookRef.current) anchor.current = captureAnchor(blocks.current, s, TOP_INSET);
    };
    apply();
    openAtEnd.current = false;
    restoring.current = false;
    renderedFor.current = view!.chapter.id;
    lastRatio.current = initialAnchor && (initialAnchor.blockIndex > 0 || initialAnchor.blockOffset > 0) ? lastRatio.current : 0;
    const openedAtRender = Date.now();
    // Re-apply once fonts and images have settled (they can shift layout), unless the reader has already moved.
    const imgs = Array.from(root.querySelectorAll('img')).filter((i) => !i.complete);
    void Promise.all([document.fonts?.ready, ...imgs.map((i) => new Promise((r) => ((i.onload = r), (i.onerror = r))))]).then(() => {
      if (lastInteraction.current < openedAtRender && renderedFor.current === view!.chapter.id) {
        restoring.current = true;
        apply();
        restoring.current = false;
      }
      onScroll();
    });
    setPageMotion(enterDir.current && !reduceMotion ? (bookRef.current ? `is-turning-${enterDir.current}` : `is-entering-${enterDir.current}`) as PageMotion : '');
    enterDir.current = null;
    // Read aloud and auto-scroll carry on into the next chapter.
    if (speechContinue.current) {
      speechContinue.current = false;
      requestAnimationFrame(() => latest.current.startSpeech(true));
    }
    if (autoContinue.current) {
      autoContinue.current = false;
      setAuto({ running: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // Re-paint highlights when annotations change (without moving the reader).
  useEffect(() => {
    if (html && !restoring.current) {
      const a = anchor.current;
      paint();
      blocks.current = getBlocks(article.current!);
      if (bookRef.current) {
        // Highlights don't move text in book format; keep the page and refresh the anchor from it.
        const f = flowRef.current();
        if (f) anchor.current = capturePageAnchor(blocks.current, f, pageRef.current);
      } else restoreAnchor(a);
      newAnn.current = null;
      if (speaker.current) showSentence(speaker.current.index, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annotations]);

  // Keep the same passage in view when typography or window size changes.
  useEffect(() => {
    const root = article.current;
    if (!root) return;
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (restoring.current || !renderedFor.current) return;
        // Our own scroll must not be read back as the reader's position: layout may shift again before its scroll event arrives.
        restoreAnchor(anchor.current);
      });
    });
    ro.observe(root);
    return () => ro.disconnect();
  }, []);

  /* ---------------------------------------------------------------- progress */

  const lastRatio = useRef(0);
  const computeRatio = useCallback(() => {
    const s = scroller.current;
    // On unmount the scroller is already detached: keep the last measured value.
    if (!s || bookRef.current) return lastRatio.current;
    const max = s.scrollHeight - s.clientHeight;
    const r = max <= 4 ? (Date.now() - openedAt.current > SHORT_CHAPTER_DWELL_MS ? 1 : 0) : Math.min(1, s.scrollTop / max);
    lastRatio.current = r;
    return r;
  }, []);

  const persist = useCallback(async () => {
    const c = chapterRef.current;
    if (!c || renderedFor.current !== c.id) return;
    const a = anchor.current;
    await saveProgress(db(), { novelId, chapterId: c.id, blockIndex: a.blockIndex, blockOffset: a.blockOffset, chapterRatio: computeRatio() });
  }, [novelId, computeRatio]);

  const schedulePersist = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void persist(), 700);
  }, [persist]);

  const lastY = useRef(0);
  /** Where our own position restore left the scroller; its scroll event isn't the reader moving. */
  const selfScrollTop = useRef<number | null>(null);
  const onScroll = useCallback(() => {
    const s = scroller.current;
    if (!s || restoring.current || !renderedFor.current) return;
    if (bookRef.current) {
      // Pages never scroll; undo anything (focus, selection) that nudged the hidden overflow.
      if (s.scrollTop || s.scrollLeft) (s.scrollTop = 0), (s.scrollLeft = 0);
      return;
    }
    const own = selfScrollTop.current;
    selfScrollTop.current = null;
    if (own !== null && Math.abs(s.scrollTop - own) < 1) return void setRatio(computeRatio());
    anchor.current = captureAnchor(blocks.current, s, TOP_INSET);
    setRatio(computeRatio());
    // Hide the bars while reading downwards; show them at the very end.
    const y = s.scrollTop;
    if (y > lastY.current + 12 && y > 80) setChrome(false);
    if (s.scrollHeight - s.clientHeight - y < 24) setChrome(true);
    lastY.current = y;
    schedulePersist();
  }, [computeRatio, schedulePersist]);

  // Save on leave, background and chapter change.
  useEffect(() => {
    const flush = () => {
      void persist();
      flushTimer();
    };
    const vis = () => document.visibilityState === 'hidden' && flush();
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', vis);
      window.removeEventListener('pagehide', flush);
      flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapter?.id]);

  /* ---------------------------------------------------------------- reading time */

  const flushTimer = useCallback(() => {
    const c = chapterRef.current;
    if (timerStart.current && c) {
      const end = Math.min(Date.now(), lastInteraction.current + IDLE_MS);
      const ms = end - timerStart.current;
      if (ms > 0) void logReading(db(), { novelId, chapterId: c.id, startedAt: timerStart.current, durationMs: ms }).then(celebrateGoal);
    }
    timerStart.current = document.visibilityState === 'visible' ? Date.now() : null;
  }, [novelId]);

  useEffect(() => {
    timerStart.current = Date.now();
    const tick = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastInteraction.current > IDLE_MS) {
        if (timerStart.current) flushTimer();
        timerStart.current = null;
      } else if (timerStart.current && Date.now() - timerStart.current > 30000) flushTimer();
    }, 5000);
    const vis = () => {
      if (document.visibilityState === 'visible') {
        timerStart.current = Date.now();
        lastInteraction.current = Date.now();
      }
    };
    document.addEventListener('visibilitychange', vis);
    return () => {
      clearInterval(tick);
      document.removeEventListener('visibilitychange', vis);
    };
  }, [flushTimer]);

  const touch = () => {
    lastInteraction.current = Date.now();
    if (!timerStart.current && document.visibilityState === 'visible') timerStart.current = Date.now();
  };

  /* ---------------------------------------------------------------- screen */

  // Match the status bar (and iOS's blur under it) to the page, so a light page doesn't get a dark band over the title.
  useEffect(() => {
    setThemeColour(THEME_BG[prefs.theme]);
  }, [prefs.theme]);
  useEffect(() => () => applyAppTheme(useStore.getState().app.theme), []);

  useEffect(() => {
    if (prefs.keepAwake) void keepScreenOn(true);
    return () => void keepScreenOn(false);
  }, [prefs.keepAwake]);

  useEffect(() => {
    const onFs = () => setFs(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      document.removeEventListener('fullscreenchange', onFs);
      if (document.fullscreenElement) void setFullscreen(false);
    };
  }, []);

  const toggleFullscreen = async () => {
    const on = !fullscreen;
    await setFullscreen(on);
    setFs(on);
    setChrome(!on);
  };

  /* ---------------------------------------------------------------- navigation */

  const goTo = useCallback(
    async (target: ChapterMeta | null, opts: { finished?: boolean; atEnd?: boolean } = {}) => {
      if (!target || !chapter) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      flushTimer();
      if (opts.finished) await markChapterCompleted(db(), novelId, chapter.id);
      else await persist();
      const from = loaded ? loaded.chapters.findIndex((c) => c.id === chapter.id) : 0;
      const to = loaded ? loaded.chapters.findIndex((c) => c.id === target.id) : 1;
      enterDir.current = to >= from ? 'next' : 'prev';
      setPageMotion(reduceMotion ? '' : 'is-fading');
      haptic('medium');
      // Keep reading aloud through a chapter change; the new chapter starts from its title.
      if (speaker.current?.playing) {
        speaker.current.pause();
        speechContinue.current = true;
      }
      speechHighlight(null);
      renderedFor.current = null;
      const c = await loadChapter(target.id);
      if (!c) return;
      setInitialAnchor({ blockIndex: 0, blockOffset: 0 });
      openAtEnd.current = !!opts.atEnd && bookRef.current;
      setPanel('none');
      setSelection(null);
      setFinds(null);
      setFindText(null);
      navigate(routes.read(novelId, target.id), { replace: true });
      setChapter(c);
      lastY.current = 0;
    },
    [chapter, loaded, novelId, persist, flushTimer, loadChapter, reduceMotion],
  );

  const page = useCallback(
    (dir: 1 | -1) => {
      const s = scroller.current;
      if (!s || !chapterRef.current || renderedFor.current !== chapterRef.current.id) return; // still switching chapters
      if (bookRef.current) {
        const n = pageRef.current + dir;
        if (n < 0) return void (prev && goTo(prev, { atEnd: true }));
        if (n >= pageCountRef.current) return void (next && goTo(next, { finished: true }));
        showPage(n);
        setChrome(false);
        haptic('selection');
        touch();
        return;
      }
      const lh = prefs.fontSize * prefs.lineHeight;
      const atEnd = s.scrollTop + s.clientHeight >= s.scrollHeight - 4;
      const atStart = s.scrollTop <= 2;
      if (dir === 1 && atEnd) return void (next && goTo(next, { finished: true }));
      if (dir === -1 && atStart) return void (prev && goTo(prev));
      const behavior = prefs.smoothScroll && !reduceMotion ? 'smooth' : 'instant';
      s.scrollBy({ top: dir * Math.max(120, s.clientHeight - lh * 2), behavior: behavior as ScrollBehavior });
      haptic('selection');
      touch();
    },
    [prefs.fontSize, prefs.lineHeight, prefs.smoothScroll, reduceMotion, next, prev, goTo],
  );

  const exit = () => navigate(routes.novel(novelId), { replace: false });

  // Keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        openFind();
        return;
      }
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return;
      touch();
      switch (e.key) {
        case 'ArrowDown':
        case 'PageDown':
        case 'j':
          e.preventDefault();
          page(1);
          break;
        case ' ':
          e.preventDefault();
          page(e.shiftKey ? -1 : 1);
          break;
        case 'ArrowUp':
        case 'PageUp':
        case 'k':
          e.preventDefault();
          page(-1);
          break;
        case 'ArrowRight':
        case ']':
        case 'n':
          e.preventDefault();
          if (book && e.key === 'ArrowRight') page(1);
          else void goTo(next, { finished: true });
          break;
        case 'ArrowLeft':
        case '[':
        case 'p':
          e.preventDefault();
          if (book && e.key === 'ArrowLeft') page(-1);
          else void goTo(prev);
          break;
        case 'Home':
          if (book) showPage(0);
          else scroller.current?.scrollTo({ top: 0 });
          break;
        case 'End':
          if (book) showPage(pageCountRef.current - 1);
          else scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
          break;
        case 'f':
          void toggleFullscreen();
          break;
        case 't':
        case 'c':
          setPanel((p) => (p === 'chapters' ? 'none' : 'chapters'));
          break;
        case 's':
          setPanel((p) => (p === 'settings' ? 'none' : 'settings'));
          break;
        case 'b':
          void toggleBookmark();
          break;
        case '/':
          e.preventDefault();
          openFind();
          break;
        case 'l':
          toggleSpeech();
          break;
        case 'a':
          toggleAuto();
          break;
        case 'Escape':
          if (selection) setSelection(null);
          else if (findText !== null) closeFind();
          else if (tts) stopSpeech();
          else if (auto) setAuto(null);
          else if (panel !== 'none') setPanel('none');
          else if (fullscreen) void toggleFullscreen();
          else exit();
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Taps and swipes
  const pointer = useRef<{ x: number; y: number; t: number; type: string } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    pointer.current = { x: e.clientX, y: e.clientY, t: Date.now(), type: e.pointerType };
    held.current = true;
    followPausedUntil.current = Date.now() + 4000;
    touch();
  };
  // Book format: the page follows your finger, then settles on the next or previous page.
  const drag = useRef<{ dx: number } | null>(null);
  const endDrag = () => {
    drag.current = null;
    const el = pageEl.current;
    el?.classList.remove('is-dragging');
    el?.style.setProperty('--drag', '0px');
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const p = pointer.current;
    if (!book || !p || p.type === 'mouse') return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    if (!drag.current) {
      if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) return;
      drag.current = { dx: 0 };
      pageEl.current?.classList.add('is-dragging');
    }
    const atFirst = pageRef.current === 0 && !prev;
    const atLast = pageRef.current >= pageCountRef.current - 1 && !next;
    const d = (dx > 0 && atFirst) || (dx < 0 && atLast) ? dx / 3 : dx; // resist at the very start and end
    drag.current.dx = d;
    pageEl.current?.style.setProperty('--drag', `${d}px`);
  };
  const wheelAcc = useRef({ v: 0, at: 0 });
  const onWheel = (e: React.WheelEvent) => {
    touch();
    followPausedUntil.current = Date.now() + 4000;
    if (!book) return;
    const now = Date.now();
    const w = wheelAcc.current;
    if (now - w.at < 380) return; // one turn per flick
    w.v += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (Math.abs(w.v) > 40) {
      page(w.v > 0 ? 1 : -1);
      w.v = 0;
      w.at = now;
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    held.current = false;
    const p = pointer.current;
    pointer.current = null;
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    const dt = Date.now() - p.t;
    if (drag.current) {
      const d = drag.current.dx;
      const v = dx / Math.max(1, dt);
      endDrag();
      if (d < -geom.stride * 0.16 || (v < -0.45 && d < -24)) page(1);
      else if (d > geom.stride * 0.16 || (v > 0.45 && d > 24)) page(-1);
      return;
    }
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    // Horizontal swipe → change chapter.
    if (!book && prefs.swipeChapters && p.type !== 'mouse' && Math.abs(dx) > 90 && Math.abs(dy) < 50 && dt < 600) {
      void goTo(dx < 0 ? next : prev, { finished: dx < 0 });
      return;
    }
    if (Math.abs(dx) > 8 || Math.abs(dy) > 8 || dt > 500) return; // a scroll or long-press, not a tap
    const target = e.target as HTMLElement;
    if (target.closest('a, button, .hl, img, [data-noTap]')) return;
    if (panel !== 'none') return setPanel('none');
    const w = window.innerWidth;
    const zone = e.clientX / w;
    const edge = book ? 0.3 : 0.25;
    if ((book || prefs.tapToTurn) && zone < edge) page(-1);
    else if ((book || prefs.tapToTurn) && zone > 1 - edge) page(1);
    else setChrome((c) => !c);
  };

  /* ---------------------------------------------------------------- annotations */

  const reloadAnnotations = useCallback(async () => {
    if (chapter) setAnnotations(await listAnnotationsForChapter(db(), chapter.id));
  }, [chapter]);

  const chapterBookmarked = annotations.some((a) => a.kind === 'chapter_bookmark');
  const toggleBookmark = async () => {
    if (!chapter) return;
    const existing = annotations.find((a) => a.kind === 'chapter_bookmark');
    if (existing) {
      await deleteAnnotation(db(), existing.id);
      toast('Bookmark removed');
    } else {
      await addAnnotation(db(), { novelId, chapterId: chapter.id, kind: 'chapter_bookmark', blockIndex: anchor.current.blockIndex, quote: blocks.current[anchor.current.blockIndex]?.textContent?.slice(0, 160) ?? '' });
      toast({ message: 'Chapter bookmarked', tone: 'success' });
    }
    await reloadAnnotations();
    void toggleChapterBookmark; // kept for API parity
  };

  // Track text selection inside the chapter.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const onSel = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        const sel = window.getSelection();
        const root = article.current;
        if (!sel || sel.isCollapsed || !root || !sel.rangeCount) return setSelection(null);
        const range = sel.getRangeAt(0);
        if (!root.contains(range.commonAncestorContainer)) return setSelection(null);
        const quote = range.toString();
        if (!quote.trim()) return setSelection(null);
        const start = textOffset(root, range.startContainer, range.startOffset);
        const end = start + quote.length;
        const blockIndex = blocks.current.findIndex((b) => b.contains(range.startContainer) || b === range.startContainer);
        setSelection({ start, end, quote, blockIndex: Math.max(0, blockIndex), rect: range.getBoundingClientRect() });
        setActiveHighlight(null);
      }, 220);
    };
    document.addEventListener('selectionchange', onSel);
    return () => {
      clearTimeout(t);
      document.removeEventListener('selectionchange', onSel);
    };
  }, []);

  const createFromSelection = async (kind: 'highlight' | 'text_bookmark' | 'note', color: HighlightColor = 'amber', note = '', sel: SelectionInfo | null = selection) => {
    if (!sel || !chapter) return;
    const id = await addAnnotation(db(), { novelId, chapterId: chapter.id, kind, startOffset: sel.start, endOffset: sel.end, blockIndex: sel.blockIndex, quote: sel.quote, color, note });
    if (kind !== 'text_bookmark' && !reduceMotion) newAnn.current = id;
    window.getSelection()?.removeAllRanges();
    setSelection(null);
    await reloadAnnotations();
    toast({ message: kind === 'highlight' ? 'Highlighted' : kind === 'note' ? 'Note added' : 'Bookmark added', tone: 'success' });
  };

  const onArticleClick = (e: React.MouseEvent) => {
    const mark = (e.target as HTMLElement).closest<HTMLElement>('mark.hl');
    if (!mark) return;
    const ann = annotations.find((a) => a.id === mark.dataset.ann);
    if (ann) setActiveHighlight({ ann, rect: mark.getBoundingClientRect() });
  };

  /* ---------------------------------------------------------------- find in chapter */

  const findRanges = useRef<HTMLElement[][]>([]);
  const runFind = (q: string, i: number) => {
    const root = article.current;
    if (!root) return;
    unwrapAll(root, 'mark.find');
    const text = root.textContent ?? '';
    const matches = findMatches(text, q);
    findRanges.current = [];
    // Wrap from the end so earlier offsets stay valid.
    const wrapped: HTMLElement[][] = [];
    for (let k = matches.length - 1; k >= 0; k--) {
      const r = rangeFromOffsets(root, matches[k][0], matches[k][1]);
      if (!r) continue;
      wrapped.unshift(
        wrapRange(r, () => {
          const m = document.createElement('mark');
          m.className = 'find';
          return m;
        }),
      );
    }
    findRanges.current = wrapped;
    blocks.current = getBlocks(root);
    if (!wrapped.length) {
      setFinds({ index: 0, total: 0 });
      return;
    }
    const idx = ((i % wrapped.length) + wrapped.length) % wrapped.length;
    root.querySelectorAll('mark.find.is-current').forEach((m) => m.classList.remove('is-current'));
    wrapped[idx].forEach((m) => m.classList.add('is-current'));
    if (bookRef.current) paginate();
    if (wrapped[idx][0]) reveal(wrapped[idx][0]);
    setFinds({ index: idx, total: wrapped.length });
  };
  const stepFind = (d: 1 | -1) => {
    const list = findRanges.current;
    if (!finds || !list.length) return;
    const idx = (finds.index + d + list.length) % list.length;
    article.current?.querySelectorAll('mark.find.is-current').forEach((m) => m.classList.remove('is-current'));
    list[idx].forEach((m) => m.classList.add('is-current'));
    if (list[idx][0]) reveal(list[idx][0], prefs.smoothScroll || bookRef.current);
    setFinds({ ...finds, index: idx });
  };
  const clearFind = () => {
    if (article.current) unwrapAll(article.current, 'mark.find');
    blocks.current = article.current ? getBlocks(article.current) : [];
    findRanges.current = [];
    setFinds(null);
  };
  const closeFind = () => {
    clearFind();
    setFindText(null);
    if (findQuery) navigate(routes.read(novelId, chapter?.id), { replace: true });
  };
  const openFind = () => {
    setFindText((t) => t ?? '');
    setPanel('none');
    requestAnimationFrame(() => findInput.current?.select());
  };
  const findDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onFindInput = (v: string) => {
    setFindText(v);
    if (findDebounce.current) clearTimeout(findDebounce.current);
    findDebounce.current = setTimeout(() => {
      if (v.trim().length < 2) clearFind();
      else runFind(v, 0);
    }, 220);
  };

  /* ---------------------------------------------------------------- read aloud */

  const speaker = useRef<Speaker | null>(null);
  const sentences = useRef<Sentence[]>([]);
  const sentencesFor = useRef<string | null>(null);
  const speechContinue = useRef(false);
  const followPausedUntil = useRef(0);

  const showSentence = (i: number, follow = true) => {
    setTts((t) => (t ? { ...t, index: i } : t));
    const sn = sentences.current[i];
    const root = article.current;
    const s = scroller.current;
    if (!sn || !root || !s) return;
    if (sn.block < 0) return speechHighlight(null);
    const range = rangeFromOffsets(root, sn.start, sn.end);
    speechHighlight(range);
    if (!range || !follow || Date.now() < followPausedUntil.current) return;
    if (bookRef.current) {
      const f = flowRef.current();
      const first = range.getClientRects()[0];
      if (f && first) {
        const p = pageOfX(f, first.left + 1);
        if (p !== pageRef.current) showPage(p);
      }
      return;
    }
    const r = range.getBoundingClientRect();
    const h = s.clientHeight;
    if (r.top < h * 0.14 || r.bottom > h * 0.72) s.scrollBy({ top: r.top - h * 0.3, behavior: reduceMotion ? 'instant' : ('smooth' as ScrollBehavior) });
  };

  const buildSentences = (withTitle: boolean): Sentence[] => {
    const root = article.current;
    if (!root) return [];
    const lang = loaded?.novel.language || 'en';
    const out: Sentence[] = [];
    if (withTitle && shown?.title) out.push({ block: -1, start: -1, end: -1, text: shown.title });
    blocks.current.forEach((b, i) => {
      const t = b.textContent ?? '';
      if (!t.trim()) return;
      const base = textOffset(root, b, 0);
      for (const x of splitSentences(t, lang)) out.push({ block: i, start: base + x.start, end: base + x.end, text: x.text });
    });
    return out;
  };

  const stopSpeech = () => {
    speaker.current?.stop();
    speaker.current = null;
    speechContinue.current = false;
    speechHighlight(null);
    setTts(null);
  };

  const startSpeech = (fromTop = false) => {
    if (!speechSupported()) return toast({ message: 'Read aloud isn’t available on this device.', tone: 'error' });
    speaker.current?.stop();
    setAuto(null);
    const a = anchor.current;
    const atTop = fromTop || (a.blockIndex === 0 && a.blockOffset === 0);
    const list = buildSentences(atTop);
    if (!list.length) return toast('There’s no text to read aloud in this chapter.');
    sentences.current = list;
    sentencesFor.current = renderedFor.current;
    const target = a.blockIndex + (a.blockOffset > 0.6 ? 1 : 0);
    const from = atTop ? 0 : Math.max(0, list.findIndex((x) => x.block >= target));
    followPausedUntil.current = 0;
    const sp = new Speaker(list, {
      rate: prefs.ttsRate,
      voiceId: prefs.ttsVoice,
      lang: loaded?.novel.language || 'en',
      onSentence: (i) => latest.current.showSentence(i),
      onEnd: () => {
        const n = latest.current.next;
        if (n) {
          speechContinue.current = true;
          void latest.current.goTo(n, { finished: true });
        } else {
          speechHighlight(null);
          setTts((t) => (t ? { ...t, playing: false } : t));
          toast('That’s the end of the last chapter.');
        }
      },
      onError: (m) => {
        toast({ message: m, tone: 'error' });
        setTts((t) => (t ? { ...t, playing: false } : t));
      },
    });
    speaker.current = sp;
    setTts({ playing: true, index: from, total: list.length });
    void sp.play(from);
  };

  const toggleSpeech = () => {
    const sp = speaker.current;
    if (!sp) return startSpeech();
    if (sp.playing) {
      sp.pause();
      setTts((t) => (t ? { ...t, playing: false } : t));
    } else if (sentencesFor.current !== renderedFor.current) startSpeech();
    else {
      followPausedUntil.current = 0;
      setTts((t) => (t ? { ...t, playing: true } : t));
      void sp.play();
    }
  };

  // Voice and speed changes apply straight away.
  useEffect(() => {
    speaker.current?.setOptions({ rate: prefs.ttsRate, voiceId: prefs.ttsVoice });
  }, [prefs.ttsRate, prefs.ttsVoice]);

  // Stop speaking when leaving the reader.
  useEffect(
    () => () => {
      speaker.current?.stop();
      speechHighlight(null);
    },
    [],
  );

  // Lock-screen / headphone controls where the platform offers them.
  useEffect(() => {
    const ms = navigator.mediaSession;
    if (!ms || !tts) return;
    try {
      ms.metadata = new MediaMetadata({ title: shown?.title ?? '', artist: loaded?.novel.author ?? '', album: loaded?.novel.title ?? '' });
      ms.setActionHandler('play', () => latest.current.toggleSpeech());
      ms.setActionHandler('pause', () => latest.current.toggleSpeech());
      ms.setActionHandler('nexttrack', () => speaker.current?.skip(1));
      ms.setActionHandler('previoustrack', () => speaker.current?.skip(-1));
    } catch {
      /* not supported here */
    }
    return () => {
      try {
        for (const a of ['play', 'pause', 'nexttrack', 'previoustrack'] as MediaSessionAction[]) ms.setActionHandler(a, null);
      } catch {
        /* ignore */
      }
    };
  }, [tts, shown, loaded]);

  /* ---------------------------------------------------------------- auto-scroll */

  const held = useRef(false);
  const autoContinue = useRef(false);
  const toggleAuto = () => {
    if (auto) return setAuto(auto.running ? { running: false } : { running: true });
    if (speaker.current) stopSpeech();
    setAuto({ running: true });
  };

  useEffect(() => {
    if (!auto?.running) return;
    const s = scroller.current;
    if (!s) return;
    let raf = 0;
    let last = performance.now();
    let pos = s.scrollTop;
    let endAt = 0;
    let touchedAt = 0;
    const step = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const switching = renderedFor.current !== chapterRef.current?.id;
      if (held.current || switching) {
        pos = s.scrollTop;
        raf = requestAnimationFrame(step);
        return;
      }
      if (Math.abs(s.scrollTop - pos) > 2) pos = s.scrollTop; // the reader moved it by hand
      const max = s.scrollHeight - s.clientHeight;
      if (pos >= max - 1) {
        endAt ||= now;
        if (now - endAt > 1800) {
          const n = latest.current.next;
          if (n) {
            autoContinue.current = true;
            void latest.current.goTo(n, { finished: true });
          } else setAuto({ running: false });
          return;
        }
      } else {
        endAt = 0;
        pos = Math.min(max, pos + (prefs.autoScrollSpeed / 10) * prefs.fontSize * prefs.lineHeight * dt);
        s.scrollTop = pos;
      }
      if (now - touchedAt > 2000) {
        touchedAt = now;
        touch();
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, prefs.autoScrollSpeed, prefs.fontSize, prefs.lineHeight]);

  const latest = useRef({ next, goTo, showSentence, startSpeech, toggleSpeech });
  latest.current = { next, goTo, showSentence, startSpeech, toggleSpeech };

  /* ---------------------------------------------------------------- render */

  const style = useMemo(() => {
    const font = READER_FONTS.find((f) => f.value === t.font) ?? READER_FONTS[0];
    return {
      '--r-font': font.stack,
      '--r-size': `${t.fontSize}px`,
      '--r-weight': t.fontWeight,
      '--r-lh': t.lineHeight,
      '--r-ps': `${t.paragraphSpacing}em`,
      '--r-measure': `${t.measure}ch`,
      '--r-margin': `${t.margin}px`,
      '--r-align': t.align,
      '--r-indent': t.indent ? (book ? '1.3em' : '1.6em') : '0',
      '--r-hyphens': t.hyphenate ? 'auto' : 'manual',
      ...(book ? { '--pad-x': `${geom.padX}px`, '--cols': geom.cols, '--gap': `${geom.padX * 2}px`, '--stride': `${geom.stride}px`, '--page': pageIdx } : {}),
    } as React.CSSProperties;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t.font, t.fontSize, t.fontWeight, t.lineHeight, t.paragraphSpacing, t.measure, t.margin, t.align, t.indent, t.hyphenate, book, geom, pageIdx]);

  // Re-lay out pages (and keep your place) when the format, screen or text settings change.
  const layoutKey = `${book}|${geom.stride}|${geom.cols}|${geom.padX}|${vp.h}|${t.font}|${t.fontSize}|${t.fontWeight}|${t.lineHeight}|${t.paragraphSpacing}|${t.align}|${t.indent}|${t.hyphenate}`;
  const lastLayout = useRef(layoutKey);
  useLayoutEffect(() => {
    if (lastLayout.current === layoutKey) return;
    lastLayout.current = layoutKey;
    if (!renderedFor.current) return;
    restoring.current = true;
    restoreAnchor(anchor.current);
    restoring.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutKey]);

  /** Switch between web novel and book. Only presentation changes; the same chapter and passage stay in view. */
  const switchFormat = async (m: ReadingMode) => {
    if (!loaded || !chapter) return;
    if (auto) setAuto(null);
    await mutate((d) => updateNovel(d, novelId, { readingMode: m }), m === 'book' ? 'Reading as a book' : 'Reading as a web novel');
    const [novel, list] = await Promise.all([getNovel(db(), novelId), listChapters(db(), novelId)]);
    if (!novel) return;
    const chapters = titled(list, m);
    setLoaded({ novel, chapters });
    if (!chapters.some((c) => c.id === chapter.id)) {
      // This section only exists in the book: carry on from the next web-novel chapter.
      const nextVisible = chapters.find((c) => c.position > chapter.position) ?? chapters[chapters.length - 1];
      const c = await loadChapter(nextVisible.id);
      if (c) {
        setInitialAnchor({ blockIndex: 0, blockOffset: 0 });
        renderedFor.current = null;
        navigate(routes.read(novelId, c.id), { replace: true });
        setChapter(c);
      }
    }
    setChrome(true);
  };

  if (missing)
    return (
      <div className="reader" data-reader-theme={prefs.theme}>
        <div className="reader__missing">
          <EmptyState icon={X} title="Nothing to read here" action={<Button onClick={() => navigate(routes.novel(novelId))}>Back to the novel</Button>}>
            This novel has no chapters yet, or it has been deleted.
          </EmptyState>
        </div>
      </div>
    );

  const hour = new Date().getHours();
  const warmth = Math.max(prefs.warmth, prefs.warmAtNight && (hour >= 21 || hour < 6) ? 0.45 : 0);
  const words = shown?.wordCount ?? 0;
  const matter = book && !!shown?.bookOnly; // title page, copyright, contents…
  const pagesLeft = Math.max(0, pageCount - pageIdx - 1);
  const shownIndex = loaded && shown ? loaded.chapters.findIndex((c) => c.id === shown.id) : -1;
  const minutesLeft = Math.max(0, Math.round(readingMinutes(words, prefs.wpm) * (1 - ratio)));
  const novelPct = loaded && index >= 0 ? (index + ratio) / loaded.chapters.length : 0;
  const isLast = loaded ? index === loaded.chapters.length - 1 : false;

  return (
    <div
      className={`reader ${chrome ? 'has-chrome' : ''} ${fullscreen ? 'is-fullscreen' : ''} ${panel !== 'none' ? 'has-panel' : ''} ${tts || auto ? 'has-dock' : ''} ${book ? `reader--book ${geom.cols === 2 ? 'is-spread' : ''} ${matter ? 'is-matter' : ''}` : ''}`}
      data-reader-theme={prefs.theme}
      style={style}
      data-testid="reader"
    >
      <header className="reader__top" aria-hidden={!chrome}>
        <IconButton icon={ArrowLeft} label="Back to novel" onClick={exit} />
        <div className="reader__titles">
          <span className="reader__novel">{loaded?.novel.title}</span>
          <span className="reader__chapter">{chapter ? displayTitle(chapter, mode) : ''}</span>
        </div>
        <IconButton icon={chapterBookmarked ? BookmarkCheck : Bookmark} active={chapterBookmarked} tone="brass" label={chapterBookmarked ? 'Remove chapter bookmark' : 'Bookmark this chapter'} onClick={toggleBookmark} />
        <IconButton icon={Search} label="Find in chapter" onClick={openFind} active={findText !== null} data-testid="find-btn" />
        <IconButton icon={List} label="Chapters and bookmarks" onClick={() => setPanel(panel === 'chapters' ? 'none' : 'chapters')} active={panel === 'chapters' || panel === 'bookmarks'} />
        <IconButton icon={Type} label="Reading settings" onClick={() => setPanel(panel === 'settings' ? 'none' : 'settings')} active={panel === 'settings'} data-testid="reader-settings-btn" />
        <IconButton icon={fullscreen ? Minimize : Maximize} label={fullscreen ? 'Exit full screen' : 'Full screen'} onClick={toggleFullscreen} className="reader__fs" />
      </header>

      {findText !== null && (
        <div className="reader__find" role="search" data-notap>
          <Search size={16} aria-hidden className="reader__find-icon" />
          <input
            ref={findInput}
            className="reader__find-input"
            value={findText}
            autoFocus={!findQuery}
            placeholder="Find in chapter"
            aria-label="Find in chapter"
            enterKeyHint="search"
            onChange={(e) => onFindInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (!finds && findText.trim()) runFind(findText, 0);
                else stepFind(e.shiftKey ? -1 : 1);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                closeFind();
              }
            }}
            data-testid="find-input"
          />
          <span className="reader__find-count" aria-live="polite">
            {finds ? (finds.total ? `${finds.index + 1} of ${finds.total}` : 'No matches') : ''}
          </span>
          <IconButton icon={ChevronUp} size="sm" label="Previous match" onClick={() => stepFind(-1)} disabled={!finds?.total} />
          <IconButton icon={ChevronDown} size="sm" label="Next match" onClick={() => stepFind(1)} disabled={!finds?.total} />
          <IconButton icon={X} size="sm" label="Close search" onClick={closeFind} />
        </div>
      )}

      <div
        className="reader__scroll"
        ref={scroller}
        onScroll={onScroll}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          held.current = false;
          pointer.current = null;
          endDrag();
        }}
        onWheel={onWheel}
        tabIndex={-1}
      >
        {!shown ? (
          <div className="reader__loading">
            <Spinner label="Loading chapter" />
          </div>
        ) : null}
        <div ref={pageEl} className={`reader__page ${pageMotion}`} onAnimationEnd={(e) => e.target === e.currentTarget && setPageMotion('')} data-testid="reader-page">
          {book && shown && shownIndex === 0 && loaded && (
            <div className="book-cover-page" aria-hidden>
              <Cover coverId={loaded.novel.coverId} title={loaded.novel.title} author={loaded.novel.author} size="xl" />
            </div>
          )}
          {shown && !matter && (
            <header className="chapter-head">
              <p className="chapter-head__novel">{loaded?.novel.title}</p>
              <h1 className="chapter-head__title">{displayTitle(shown, mode)}</h1>
              <p className="chapter-head__meta">
                <span>
                  Chapter {shownIndex + 1} of {formatNumber(loaded?.chapters.length ?? 0)}
                </span>
                {words > 0 && <span>{formatNumber(words)} words</span>}
                {words > 0 && <span>{formatMinutes(readingMinutes(words, prefs.wpm))}</span>}
              </p>
            </header>
          )}
          <article ref={article} className="reading-text" onClick={onArticleClick} lang={loaded?.novel.language || undefined} data-testid="chapter-text" />
          {chapter && html && (!book || !next) && (
            <footer className="chapter-end">
              {next ? (
                <button type="button" className="chapter-end__next" onClick={() => goTo(next, { finished: true })} data-testid="next-chapter">
                  <span className="chapter-end__label">Next chapter</span>
                  <span className="chapter-end__title">{next.title}</span>
                  <ChevronRight size={22} aria-hidden className="chapter-end__arrow" />
                </button>
              ) : (
                <div className="chapter-end__last">
                  <CircleCheck size={22} aria-hidden />
                  <p>{loaded?.novel.publicationStatus.toLowerCase().includes('ongoing') ? 'You’re caught up with the latest chapter.' : 'You’ve reached the last chapter.'}</p>
                  {isLast && loaded?.novel.status !== 'completed' && (
                    <Button
                      variant="primary"
                      onClick={async () => {
                        await markChapterCompleted(db(), novelId, chapter.id);
                        await mutate((d) => updateNovel(d, novelId, { status: 'completed' }), 'Marked as completed');
                        setLoaded((l) => (l ? { ...l, novel: { ...l.novel, status: 'completed' } } : l));
                      }}
                    >
                      Mark novel as completed
                    </Button>
                  )}
                </div>
              )}
              {prev && (
                <button type="button" className="chapter-end__prev" onClick={() => goTo(prev)}>
                  <ChevronLeft size={16} aria-hidden /> Previous: {prev.title}
                </button>
              )}
            </footer>
          )}
          <span ref={flowEnd} className="reader__flow-end" aria-hidden />
        </div>
      </div>

      {book && shown && (
        <>
          <div className="book-running" aria-hidden>
            {geom.cols === 2 ? (
              <>
                <span>{loaded?.novel.title}</span>
                <span>{displayTitle(shown, mode)}</span>
              </>
            ) : (
              <span>{matter ? loaded?.novel.title : displayTitle(shown, mode)}</span>
            )}
          </div>
          <div className="book-folio" aria-hidden data-testid="book-folio">
            {geom.cols === 2 ? (
              <>
                <span>{pageIdx * 2 + 1}</span>
                <span>{pageIdx * 2 + 2 <= pageCount * 2 ? pageIdx * 2 + 2 : ''}</span>
              </>
            ) : (
              <span>
                {pageIdx + 1} of {pageCount}
              </span>
            )}
          </div>
        </>
      )}

      <footer className="reader__bottom" aria-hidden={!chrome}>
        <IconButton icon={ChevronLeft} label="Previous chapter" onClick={() => goTo(prev)} disabled={!prev} data-testid="prev-chapter-btn" />
        {speechSupported() && <IconButton icon={Headphones} label={tts ? 'Stop reading aloud' : 'Read aloud'} active={!!tts} onClick={() => (tts ? stopSpeech() : startSpeech())} data-testid="listen-btn" />}
        <button type="button" className="reader__position" onClick={() => setPanel('chapters')}>
          <span>
            Chapter {index + 1} of {formatNumber(loaded?.chapters.length ?? 0)}
          </span>
          <span className="reader__novel-pct">{Math.round(novelPct * 100)}% of novel</span>
        </button>
        {!book && <IconButton icon={Gauge} label={auto ? 'Stop auto-scroll' : 'Auto-scroll'} active={!!auto} onClick={() => (auto ? setAuto(null) : toggleAuto())} data-testid="autoscroll-btn" />}
        <IconButton icon={ChevronRight} label="Next chapter" onClick={() => goTo(next, { finished: true })} disabled={!next} data-testid="next-chapter-btn" />
      </footer>

      {tts && (
        <SpeechDock
          playing={tts.playing}
          index={tts.index}
          total={tts.total}
          rate={prefs.ttsRate}
          onToggle={toggleSpeech}
          onSkip={(d) => {
            followPausedUntil.current = 0;
            speaker.current?.skip(d);
          }}
          onRate={(r) => void useStore.getState().setReader({ ttsRate: r })}
          onClose={stopSpeech}
        />
      )}
      {auto && !tts && <ScrollDock running={auto.running} speed={prefs.autoScrollSpeed} onToggle={toggleAuto} onSpeed={(v) => void useStore.getState().setReader({ autoScrollSpeed: v })} onClose={() => setAuto(null)} />}

      {(prefs.dim > 0 || warmth > 0) && <div className="reader__filter" aria-hidden style={{ '--dim': prefs.dim, '--warm': warmth } as React.CSSProperties} data-testid="reader-filter" />}

      {prefs.showStatus && (
        <div className="reader__status" aria-hidden>
          <div className="reader__status-bar">
            <div style={{ transform: `scaleX(${ratio})` }} />
          </div>
          {book ? (
            <>
              <span>{Math.round(novelPct * 100)}% of book</span>
              <span>{pagesLeft ? `${pagesLeft} ${pagesLeft === 1 ? 'page' : 'pages'} left in chapter` : 'Last page of chapter'}</span>
            </>
          ) : (
            <>
              <span>{Math.round(ratio * 100)}%</span>
              <span>{minutesLeft > 0 ? `${formatMinutes(minutesLeft)} left in chapter` : 'End of chapter'}</span>
            </>
          )}
        </div>
      )}

      {selection && !noteFor && (
        <SelectionToolbar
          info={selection}
          onHighlight={(c) => createFromSelection('highlight', c)}
          onNote={() => setNoteFor({ sel: selection })}
          onBookmark={() => createFromSelection('text_bookmark')}
          onCopy={async () => {
            toast((await copyText(selection.quote)) ? 'Copied' : "Couldn't copy");
            window.getSelection()?.removeAllRanges();
            setSelection(null);
          }}
        />
      )}
      {activeHighlight && (
        <HighlightPopover
          ann={activeHighlight.ann}
          rect={activeHighlight.rect}
          onClose={() => setActiveHighlight(null)}
          onColour={async (c) => {
            await updateAnnotation(db(), activeHighlight.ann.id, { color: c });
            setActiveHighlight(null);
            await reloadAnnotations();
          }}
          onNote={() => {
            setNoteFor({ ann: activeHighlight.ann });
            setActiveHighlight(null);
          }}
          onDelete={async () => {
            await deleteAnnotation(db(), activeHighlight.ann.id);
            setActiveHighlight(null);
            await reloadAnnotations();
            toast('Highlight removed');
          }}
        />
      )}
      {noteFor && (
        <NoteDialog
          quote={noteFor.ann?.quote ?? noteFor.sel?.quote ?? ''}
          initial={noteFor.ann?.note ?? ''}
          onCancel={() => setNoteFor(null)}
          onSave={async (note) => {
            if (noteFor.ann) {
              await updateAnnotation(db(), noteFor.ann.id, { note, kind: noteFor.ann.kind === 'highlight' ? 'highlight' : 'note' });
              await reloadAnnotations();
              toast({ message: 'Note saved', tone: 'success' });
            } else await createFromSelection('note', 'amber', note, noteFor.sel ?? null);
            setNoteFor(null);
          }}
        />
      )}

      {panel === 'settings' && <ReaderSettings onClose={() => setPanel('none')} mode={mode} onFormat={(m) => void switchFormat(m)} />}
      {(panel === 'chapters' || panel === 'bookmarks') && loaded && chapter && (
        <ReaderDrawer
          tab={panel}
          onTab={setPanel}
          novel={loaded.novel}
          chapters={loaded.chapters}
          currentId={chapter.id}
          loadAnnotations={() => listAnnotationsForNovel(db(), novelId)}
          onPick={(c) => goTo(c)}
          onPickAnnotation={(a) => {
            setPanel('none');
            if (a.chapterId === chapter.id) {
              const el = article.current?.querySelector<HTMLElement>(`mark[data-ann="${CSS.escape(a.id)}"]`);
              if (el) reveal(el, true);
              else if (a.blockIndex != null) restoreAnchor({ blockIndex: a.blockIndex, blockOffset: 0 });
            } else navigate(routes.read(novelId, a.chapterId, `a=${a.id}`), { replace: true });
          }}
          onClose={() => setPanel('none')}
        />
      )}
    </div>
  );
}
