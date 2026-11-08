import { useEffect, useMemo, useRef, useState } from 'react';
import { Bookmark, CircleCheck, Highlighter, Search, StickyNote, X } from 'lucide-react';
import type { Annotation, ChapterMeta, NovelSummary } from '../../data/model';
import { IconButton } from '../components/Button';
import { Spinner } from '../components/misc';

export function ReaderDrawer({
  tab,
  onTab,
  novel,
  chapters,
  currentId,
  loadAnnotations,
  onPick,
  onPickAnnotation,
  onClose,
}: {
  tab: 'chapters' | 'bookmarks';
  onTab: (t: 'chapters' | 'bookmarks') => void;
  novel: NovelSummary;
  chapters: ChapterMeta[];
  currentId: string;
  loadAnnotations: () => Promise<Annotation[]>;
  onPick: (c: ChapterMeta) => void;
  onPickAnnotation: (a: Annotation) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [anns, setAnns] = useState<Annotation[] | null>(null);
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    if (tab === 'bookmarks') void loadAnnotations().then(setAnns);
  }, [tab, loadAnnotations]);

  useEffect(() => {
    if (tab === 'chapters') listRef.current?.querySelector('.is-current')?.scrollIntoView({ block: 'center' });
  }, [tab]);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? chapters.filter((c) => c.title.toLowerCase().includes(s) || String(chapters.indexOf(c) + 1) === s) : chapters;
  }, [chapters, q]);

  return (
    <aside className="reader-panel reader-panel--drawer" aria-label="Chapters and bookmarks" data-notap>
      <header className="reader-panel__head">
        <div className="reader-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'chapters'} className={tab === 'chapters' ? 'is-on' : ''} onClick={() => onTab('chapters')}>
            Chapters
          </button>
          <button type="button" role="tab" aria-selected={tab === 'bookmarks'} className={tab === 'bookmarks' ? 'is-on' : ''} onClick={() => onTab('bookmarks')}>
            Bookmarks & notes
          </button>
        </div>
        <IconButton icon={X} label="Close" onClick={onClose} size="sm" />
      </header>
      {tab === 'chapters' ? (
        <>
          <label className="filter-input reader-panel__search">
            <Search size={16} aria-hidden />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Find among ${chapters.length} chapters`} aria-label="Find a chapter" />
          </label>
          <ol className="drawer-chapters" ref={listRef}>
            {shown.map((c) => (
              <li key={c.id}>
                <button type="button" className={`drawer-chapter ${c.id === currentId ? 'is-current' : ''} ${c.completed ? 'is-read' : ''}`} onClick={() => onPick(c)} aria-current={c.id === currentId ? 'true' : undefined}>
                  <span className="drawer-chapter__num">{chapters.indexOf(c) + 1}</span>
                  <span className="drawer-chapter__title">{c.title}</span>
                  {c.completed && <CircleCheck size={14} aria-label="Read" className="drawer-chapter__check" />}
                </button>
              </li>
            ))}
          </ol>
        </>
      ) : (
        <div className="drawer-anns">
          {!anns ? (
            <Spinner />
          ) : !anns.length ? (
            <p className="drawer-anns__empty">No bookmarks or notes in “{novel.title}” yet. Select text to highlight it or add a note.</p>
          ) : (
            <ul>
              {anns.map((a) => {
                const Icon = a.kind === 'highlight' ? Highlighter : a.kind === 'note' ? StickyNote : Bookmark;
                return (
                  <li key={a.id}>
                    <button type="button" className={`drawer-ann hl-${a.color}`} onClick={() => onPickAnnotation(a)}>
                      <span className="drawer-ann__where">
                        <Icon size={14} aria-hidden /> {a.chapterTitle}
                      </span>
                      {a.quote && <span className="drawer-ann__quote">{a.quote.length > 180 ? a.quote.slice(0, 180) + '…' : a.quote}</span>}
                      {a.note && <span className="drawer-ann__note">{a.note}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </aside>
  );
}
