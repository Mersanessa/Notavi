import { useLayoutEffect, useRef, useState } from 'react';
import { BookMarked, Bookmark, Copy, Highlighter, StickyNote, Trash2, X } from 'lucide-react';
import { HIGHLIGHT_COLORS, type Annotation, type HighlightColor } from '../../data/model';

export interface SelectionInfo {
  start: number;
  end: number;
  quote: string;
  blockIndex: number;
  rect: DOMRect;
}

const COLOUR_NAMES: Record<HighlightColor, string> = { amber: 'Amber', sage: 'Sage', sky: 'Sky', rose: 'Rose', violet: 'Violet' };

/** Position a floating bar below the selection (Android/iOS show their own menu above it). */
function useFloat(rect: DOMRect) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: -999, left: -999 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let top = rect.bottom + 12;
    if (top + h > window.innerHeight - 12) top = Math.max(12, rect.top - h - 12);
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, rect.left + rect.width / 2 - w / 2));
    setPos({ top, left });
  }, [rect]);
  return { ref, style: { top: pos.top, left: pos.left } };
}

const IOS = typeof navigator !== 'undefined' && /iPhone|iPad|iPod/.test(navigator.userAgent);
const LAST_COLOUR = 'notavi.lastHighlight';

/** The colour new highlights get: the last one you picked (change it by tapping a highlight). */
export function lastHighlightColour(): HighlightColor {
  try {
    const c = localStorage.getItem(LAST_COLOUR) as HighlightColor | null;
    return c && HIGHLIGHT_COLORS.includes(c) ? c : 'amber';
  } catch {
    return 'amber';
  }
}
export function rememberHighlightColour(c: HighlightColor) {
  try {
    localStorage.setItem(LAST_COLOUR, c);
  } catch {
    /* ignore */
  }
}

export function SelectionToolbar({
  info,
  onHighlight,
  onNote,
  onBookmark,
  onCopy,
  onLookUp,
}: {
  info: SelectionInfo;
  onHighlight: (c: HighlightColor) => void;
  onNote: () => void;
  onBookmark: () => void;
  onCopy: () => void;
  onLookUp?: () => void;
}) {
  const { ref, style } = useFloat(info.rect);
  const colour = lastHighlightColour();
  return (
    <div ref={ref} className="float-bar float-bar--compact" style={style} role="toolbar" aria-label="Selected text" data-notap onPointerDown={(e) => e.preventDefault()}>
      <button type="button" className={`float-bar__btn float-bar__btn--hl hl-${colour}`} onClick={() => onHighlight(colour)} data-testid="highlight-btn">
        <Highlighter size={17} aria-hidden /> Highlight
      </button>
      <button type="button" className="float-bar__btn" onClick={onNote}>
        <StickyNote size={17} aria-hidden /> Note
      </button>
      <button type="button" className="float-bar__btn" onClick={onBookmark} aria-label="Bookmark">
        <Bookmark size={17} aria-hidden />
      </button>
      {onLookUp && (
        <button type="button" className="float-bar__btn" onClick={onLookUp} aria-label="Look up in Lore" data-testid="lookup-btn">
          <BookMarked size={17} aria-hidden />
        </button>
      )}
      {!IOS && (
        <button type="button" className="float-bar__btn" onClick={onCopy} aria-label="Copy">
          <Copy size={17} aria-hidden />
        </button>
      )}
    </div>
  );
}

export function HighlightPopover({
  ann,
  rect,
  onClose,
  onColour,
  onNote,
  onDelete,
}: {
  ann: Annotation;
  rect: DOMRect;
  onClose: () => void;
  onColour: (c: HighlightColor) => void;
  onNote: () => void;
  onDelete: () => void;
}) {
  const { ref, style } = useFloat(rect);
  return (
    <div ref={ref} className="float-bar float-bar--stack" style={style} role="dialog" aria-label="Highlight" data-notap>
      {ann.note && <p className="float-bar__note">{ann.note}</p>}
      <div className="float-bar__row">
        <div className="float-bar__swatches">
          {HIGHLIGHT_COLORS.map((c) => (
            <button key={c} type="button" className={`swatch hl-${c} ${c === ann.color ? 'is-on' : ''}`} aria-label={`Change colour to ${COLOUR_NAMES[c]}`} aria-pressed={c === ann.color} onClick={() => (rememberHighlightColour(c), onColour(c))} />
          ))}
        </div>
        <span className="float-bar__sep" />
        <button type="button" className="float-bar__btn" onClick={onNote}>
          <StickyNote size={17} aria-hidden /> {ann.note ? 'Edit note' : 'Add note'}
        </button>
        <button type="button" className="float-bar__btn is-danger" onClick={onDelete} aria-label="Remove highlight">
          <Trash2 size={17} aria-hidden />
        </button>
        <button type="button" className="float-bar__btn" onClick={onClose} aria-label="Close">
          <X size={17} aria-hidden />
        </button>
      </div>
    </div>
  );
}
