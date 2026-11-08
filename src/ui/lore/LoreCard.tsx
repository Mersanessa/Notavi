import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Waypoints, X } from 'lucide-react';
import { db } from '../../app/store';
import { loreMentions, type LoreMention } from '../../data/lore';
import { TIER_LABEL, type LoreEntry, type LoreView } from '../../lore/view';
import { formatNumber } from '../../lib/text';
import { IconButton, Button } from '../components/Button';
import { KindPill, WikiLink, useChapterTitles } from './LoreNote';

/**
 * The spoiler-free card shown when you tap a name while reading: what the book has told you about it
 * so far, and where it came up before. Nothing from beyond the word you tapped.
 */
export function LoreCard({
  novelId,
  entry,
  name,
  view,
  beforePos,
  rect,
  onSwitch,
  onOpenLore,
  onClose,
  hover = false,
  cardRef,
}: {
  novelId: string;
  entry: LoreEntry | null;
  /** What was tapped or selected, when it isn't (yet) an entry. */
  name: string;
  view: LoreView | null;
  beforePos: number;
  rect: DOMRect;
  onSwitch: (key: string) => void;
  onOpenLore: (key: string | null) => void;
  onClose: () => void;
  hover?: boolean;
  cardRef?: React.RefObject<HTMLDivElement | null>;
}) {
  const own = useRef<HTMLDivElement>(null);
  const ref = cardRef ?? own;
  const [pos, setPos] = useState({ top: -9999, left: -9999 });
  const [mentions, setMentions] = useState<{ hits: LoreMention[]; total: number } | null>(null);
  const titles = useChapterTitles(novelId);
  const forms = entry?.forms ?? [name];

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let top = rect.bottom + 10;
    if (top + h > window.innerHeight - 12) top = Math.max(12, rect.top - h - 10);
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, rect.left + rect.width / 2 - w / 2));
    setPos({ top, left });
  }, [rect, entry, mentions, ref]);

  useEffect(() => {
    let alive = true;
    setMentions(null);
    void loreMentions(db(), novelId, forms, beforePos, { limit: 3 }).then((m) => alive && setMentions(m));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [novelId, forms.join('|'), beforePos]);

  const related = entry ? entry.related.slice(0, 6).map((r) => view?.byKey.get(r.key)).filter((e): e is LoreEntry => !!e) : [];
  const first = entry ? titles.get(entry.firstPos)?.title : null;

  return (
    <div ref={ref} className={`lore-card ${hover ? 'is-hover' : ''}`} style={pos} role="dialog" aria-label={`About ${entry?.name ?? name}`} data-notap data-testid="lore-card" onPointerDown={(e) => e.stopPropagation()}>
      <div className="lore-card__head">
        <div style={{ flex: 1, minWidth: 0 }}>
          {entry && <KindPill kind={entry.kind} />}
          <h2 className="lore-card__name">{entry?.name ?? name}</h2>
          <p className="lore-card__meta">
            {entry ? (
              <>
                {TIER_LABEL[entry.tier]} · {formatNumber(entry.mentions)} {entry.mentions === 1 ? 'mention' : 'mentions'} so far
                {first ? ` · first in ${first}` : ''}
              </>
            ) : mentions && mentions.total ? (
              `Came up in ${formatNumber(mentions.total)} earlier ${mentions.total === 1 ? 'chapter' : 'chapters'}`
            ) : (
              'This is the first time it comes up.'
            )}
          </p>
        </div>
        <IconButton icon={X} size="sm" label="Close" onClick={onClose} />
      </div>

      {entry && entry.desc.length > 0 && (
        <div className="lore-card__sec">
          <h3>What you know</h3>
          <ul className="lore-card__desc">
            {entry.desc.slice(0, 3).map((d, i) => (
              <li key={i}>
                {entry.name.split(' ')[0]}, {d.text.replace(/[.,;:]$/, '')}.
              </li>
            ))}
          </ul>
        </div>
      )}

      {entry?.note && (
        <div className="lore-card__sec">
          <h3>Your note</h3>
          <p className="lore-card__note">{entry.note}</p>
        </div>
      )}

      {related.length > 0 && (
        <div className="lore-card__sec">
          <h3>Seen with</h3>
          <div className="lore-card__chips">
            {related.map((r) => (
              <WikiLink key={r.key} entry={r} onOpen={onSwitch} />
            ))}
          </div>
        </div>
      )}

      {mentions && mentions.hits.length > 0 && (
        <div className="lore-card__sec">
          <h3>Previously</h3>
          {mentions.hits.map((m) => (
            <p key={m.chapterId} className="lore-card__snip">
              <b>{m.chapterTitle}</b>
              <span dangerouslySetInnerHTML={{ __html: m.snippet }} />
            </p>
          ))}
        </div>
      )}

      <div className="lore-card__foot">
        <Button size="sm" variant="ghost" icon={Waypoints} onClick={() => onOpenLore(entry?.key ?? null)}>
          {entry ? 'Open in Lore' : 'Open Lore'}
        </Button>
      </div>
    </div>
  );
}
