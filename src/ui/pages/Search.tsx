import { useEffect, useMemo, useRef, useState } from 'react';
import { Heart, Search as SearchIcon, X } from 'lucide-react';
import { db, useStore } from '../../app/store';
import { useDocumentTitle } from '../../app/hooks';
import { href, navigate, routes, useRoute } from '../../app/router';
import { STATUSES, type ReadingStatus } from '../../data/model';
import { filterNovels, searchNovelIds, searchText, type TextHit } from '../../data/search';
import { formatNumber } from '../../lib/text';
import { BookRow } from '../components/BookCard';
import { IconButton, Button } from '../components/Button';
import { Chip, EmptyState, PageHeader, Spinner } from '../components/misc';
import { Segmented } from '../components/Fields';

const PAGE = 30;

export function SearchPage() {
  useDocumentTitle('Search');
  const novels = useStore((s) => s.novels);
  const { query } = useRoute();
  const [q, setQ] = useState(query.get('q') ?? '');
  const [mode, setMode] = useState<'novels' | 'text'>((query.get('in') as 'text') === 'text' ? 'text' : 'novels');
  const [statuses, setStatuses] = useState<ReadingStatus[]>([]);
  const [fav, setFav] = useState(false);
  const [genre, setGenre] = useState('');
  const [recent, setRecent] = useState<'' | 'added' | 'updated'>('');
  const [ids, setIds] = useState<string[] | null>(null);
  const [text, setText] = useState<{ hits: TextHit[]; total: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => input.current?.focus(), []);

  // Keep the URL in sync so Back returns to the same search.
  useEffect(() => {
    const t = setTimeout(() => navigate(`/search?q=${encodeURIComponent(q)}${mode === 'text' ? '&in=text' : ''}`, { replace: true }), 300);
    return () => clearTimeout(t);
  }, [q, mode]);

  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setIds(null);
      setText(null);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        if (mode === 'novels') setIds(await searchNovelIds(db(), term));
        else setText(await searchText(db(), term, { limit: PAGE }));
      } finally {
        setLoading(false);
      }
    }, 150);
    return () => clearTimeout(t);
  }, [q, mode]);

  const genres = useMemo(() => Array.from(new Set(novels.flatMap((n) => n.genres))).sort((a, b) => a.localeCompare(b)), [novels]);
  const filtered = useMemo(() => {
    const base = ids ? (ids.map((id) => novels.find((n) => n.id === id)).filter(Boolean) as typeof novels) : q.trim() ? [] : novels;
    return filterNovels(base, {
      statuses,
      favouritesOnly: fav,
      genres: genre ? [genre] : [],
      addedWithinDays: recent === 'added' ? 14 : undefined,
      updatedWithinDays: recent === 'updated' ? 14 : undefined,
    });
  }, [ids, novels, statuses, fav, genre, recent, q]);
  const filtering = statuses.length > 0 || fav || !!genre || !!recent;

  const more = async () => {
    if (!text) return;
    const nextPage = await searchText(db(), q.trim(), { limit: PAGE, offset: text.hits.length });
    setText({ total: text.total, hits: [...text.hits, ...nextPage.hits] });
  };

  return (
    <div className="page page--search">
      <PageHeader title="Search" />
      <div className="search-box">
        <SearchIcon size={20} aria-hidden />
        <input
          ref={input}
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={mode === 'novels' ? 'Title, author, genre, tag or description' : 'Words or "an exact phrase" in any chapter'}
          aria-label="Search"
          enterKeyHint="search"
          data-testid="search-input"
        />
        {loading && <Spinner />}
        {q && <IconButton icon={X} label="Clear search" size="sm" onClick={() => (setQ(''), input.current?.focus())} />}
      </div>
      <div className="search-modes">
        <Segmented
          label="Search in"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'novels', label: 'Novels' },
            { value: 'text', label: 'Chapter text' },
          ]}
        />
      </div>

      {mode === 'novels' && (
        <>
          <div className="filters" aria-label="Filters">
            {STATUSES.map((s) => (
              <Chip key={s.value} active={statuses.includes(s.value)} onClick={() => setStatuses(statuses.includes(s.value) ? statuses.filter((x) => x !== s.value) : [...statuses, s.value])}>
                {s.label}
              </Chip>
            ))}
            <Chip active={fav} onClick={() => setFav(!fav)}>
              <Heart size={13} aria-hidden fill={fav ? 'currentColor' : 'none'} /> Favourites
            </Chip>
            <Chip active={recent === 'added'} onClick={() => setRecent(recent === 'added' ? '' : 'added')}>
              Recently added
            </Chip>
            <Chip active={recent === 'updated'} onClick={() => setRecent(recent === 'updated' ? '' : 'updated')}>
              Recently updated
            </Chip>
            {genres.length > 0 && (
              <select className={`chip-select ${genre ? 'is-on' : ''}`} value={genre} onChange={(e) => setGenre(e.target.value)} aria-label="Genre">
                <option value="">All genres</option>
                {genres.map((g) => (
                  <option key={g}>{g}</option>
                ))}
              </select>
            )}
          </div>
          {!q.trim() && !filtering ? (
            <EmptyState icon={SearchIcon} title="Search your library">
              Find novels by title, alternative title, author, genre, tag or description. Switch to “Chapter text” to search inside every chapter.
            </EmptyState>
          ) : !filtered.length ? (
            <EmptyState icon={SearchIcon} title="No novels found">
              {q.trim() ? (
                <>
                  Nothing matches “{q.trim()}”{filtering ? ' with these filters' : ''}.{' '}
                  <button type="button" className="link" onClick={() => setMode('text')}>
                    Search chapter text instead
                  </button>
                </>
              ) : (
                'No novels match these filters.'
              )}
            </EmptyState>
          ) : (
            <>
              <p className="muted result-count">
                {filtered.length} {filtered.length === 1 ? 'novel' : 'novels'}
              </p>
              <div className="book-list">
                {filtered.map((n) => (
                  <BookRow key={n.id} novel={n} />
                ))}
              </div>
            </>
          )}
        </>
      )}

      {mode === 'text' &&
        (!q.trim() ? (
          <EmptyState icon={SearchIcon} title="Search inside your novels">
            Type a word or phrase. Put quotes around words to match them as an exact phrase.
          </EmptyState>
        ) : !text ? null : !text.total ? (
          <EmptyState icon={SearchIcon} title="No matches">
            No chapter contains “{q.trim()}”.
          </EmptyState>
        ) : (
          <div className="text-hits">
            <p className="muted result-count">
              {formatNumber(text.total)} {text.total === 1 ? 'chapter matches' : 'chapters match'}
            </p>
            <ul>
              {text.hits.map((h) => (
                <li key={h.chapterId}>
                  <a className="text-hit" href={href(routes.read(h.novelId, h.chapterId, `find=${encodeURIComponent(q.trim())}`))} data-testid="text-hit">
                    <span className="text-hit__novel">{h.novelTitle}</span>
                    <span className="text-hit__title">
                      <span className="chapter-row__num">{h.position + 1}</span> {h.chapterTitle}
                    </span>
                    <span className="text-hit__snippet" dangerouslySetInnerHTML={{ __html: h.snippet }} />
                  </a>
                </li>
              ))}
            </ul>
            {text.hits.length < text.total && (
              <div className="center">
                <Button onClick={more}>Show more</Button>
              </div>
            )}
          </div>
        ))}
    </div>
  );
}
