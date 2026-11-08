import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Eye, X } from 'lucide-react';
import { db, useStore } from '../../app/store';
import { READER_FONTS } from '../../app/prefs';
import { resolveBlobRefs } from '../../app/blobs';
import { getChapterAt } from '../../data/novels';
import { sanitizeChapterHtml } from '../../import/dom';
import { findMatches, rangeFromOffsets, wrapRange } from '../reader/anchors';

export interface PeekStop {
  position: number;
  title: string;
}

/**
 * A small reader of its own, for looking back at an earlier chapter from Lore without leaving it. It never
 * touches your reading position, progress, stats or reading speed: close it and you're exactly where you were.
 */
export function Peek({ novelId, stops, start, terms, onClose }: { novelId: string; stops: PeekStop[]; start: number; terms: string[]; onClose: () => void }) {
  const prefs = useStore((s) => s.reader);
  const reduceMotion = useStore((s) => s.app.reduceMotion) || matchMedia('(prefers-reduced-motion: reduce)').matches;
  const smoothOk = useRef(!reduceMotion);
  smoothOk.current = !reduceMotion;
  const [at, setAt] = useState(start);
  const [html, setHtml] = useState<string | null>(null);
  const [hit, setHit] = useState(0);
  const [hits, setHits] = useState(0);
  const body = useRef<HTMLDivElement>(null);
  const article = useRef<HTMLElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const marks = useRef<HTMLElement[]>([]);
  const stop = stops[at];
  const query = useMemo(() => terms.map((t) => `"${t}"`).join(' '), [terms]);

  useEffect(() => {
    let alive = true;
    setHtml(null);
    void (async () => {
      const c = await getChapterAt(db(), novelId, stop.position);
      const h = c ? await resolveBlobRefs(sanitizeChapterHtml(c.content)) : '<p>This chapter is no longer in the novel.</p>';
      if (alive) setHtml(h);
    })();
    return () => {
      alive = false;
    };
  }, [novelId, stop.position]);

  const show = useCallback((i: number, smooth = true) => {
    const list = marks.current;
    if (!list.length) return;
    const k = (i + list.length) % list.length;
    list.forEach((m, j) => m.classList.toggle('is-current', j === k));
    const m = list[k];
    const box = body.current!;
    const top = m.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - box.clientHeight * 0.3;
    box.scrollTo({ top: Math.max(0, top), behavior: smooth && smoothOk.current ? 'smooth' : 'auto' });
    setHit(k);
  }, []);

  useLayoutEffect(() => {
    const root = article.current;
    if (!root || html === null) return;
    root.innerHTML = html;
    const text = root.textContent ?? '';
    const found = findMatches(text, query);
    // Wrap from the end so earlier offsets stay valid.
    const made: HTMLElement[] = [];
    for (let i = found.length - 1; i >= 0; i--) {
      const r = rangeFromOffsets(root, found[i][0], found[i][1]);
      if (r) made.unshift(...wrapRange(r, () => Object.assign(document.createElement('mark'), { className: 'find' })));
    }
    marks.current = made;
    setHits(made.length);
    body.current!.scrollTop = 0;
    show(0, false);
  }, [html, query, show]);

  // Escape closes; keep focus inside while open.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    panel.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey, true);
    document.body.classList.add('has-modal');
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.classList.remove('has-modal');
      opener?.focus?.({ preventScroll: true });
    };
  }, [onClose]);

  const font = READER_FONTS.find((f) => f.value === prefs.font) ?? READER_FONTS[0];
  const style = {
    '--r-font': font.stack,
    '--r-size': `${Math.min(prefs.fontSize, 22)}px`,
    '--r-weight': prefs.fontWeight,
    '--r-lh': prefs.lineHeight,
    '--r-ps': `${prefs.paragraphSpacing}em`,
    '--r-align': prefs.align,
    '--r-indent': prefs.indent ? '1.6em' : '0',
  } as React.CSSProperties;

  return createPortal(
    <div className="peek-root" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={panel} className="peek" data-reader-theme={prefs.theme} style={style} role="dialog" aria-modal="true" aria-label={`Peek at ${stop.title}`} tabIndex={-1} data-testid="peek">
        <header className="peek__head">
          <div className="peek__titles">
            <span className="peek__kicker">
              <Eye size={13} aria-hidden /> Looking back · your place is kept
            </span>
            <h2 className="peek__title">{stop.title}</h2>
          </div>
          <button type="button" className="peek__btn" aria-label="Close" onClick={onClose} data-testid="peek-close">
            <X size={20} aria-hidden />
          </button>
        </header>
        <div ref={body} className="peek__body">
          {html === null && <p className="peek__loading">Opening…</p>}
          <article ref={article} className="reading-text peek__text" />
        </div>
        <footer className="peek__foot">
          <button type="button" className="peek__btn peek__btn--text" disabled={at >= stops.length - 1} onClick={() => setAt((i) => i + 1)} aria-label="Earlier chapter">
            <ChevronLeft size={18} aria-hidden /> <span className="peek__lbl">Earlier</span>
          </button>
          <span className="peek__hits" aria-live="polite">
            {hits > 0 && (
              <>
                <button type="button" className="peek__btn" aria-label="Previous mention" onClick={() => show(hit - 1)} disabled={hits < 2}>
                  <ChevronUp size={18} aria-hidden />
                </button>
                <span data-testid="peek-count">
                  {hit + 1} of {hits}
                </span>
                <button type="button" className="peek__btn" aria-label="Next mention" onClick={() => show(hit + 1)} disabled={hits < 2}>
                  <ChevronDown size={18} aria-hidden />
                </button>
              </>
            )}
          </span>
          <button type="button" className="peek__btn peek__btn--text" disabled={at <= 0} onClick={() => setAt((i) => i - 1)} aria-label="Later chapter">
            <span className="peek__lbl">Later</span> <ChevronRight size={18} aria-hidden />
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
