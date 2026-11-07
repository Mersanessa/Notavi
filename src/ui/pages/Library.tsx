import { useMemo, useState } from 'react';
import { ArrowDownUp, FilePlus2, Heart, LayoutGrid, LibraryBig, Rows3, Search, Upload, X } from 'lucide-react';
import { db, useStore } from '../../app/store';
import { useAsync, useDocumentTitle } from '../../app/hooks';
import { collectionNovelIds } from '../../data/collections';
import { navigate, routes, useRoute } from '../../app/router';
import { STATUSES, type ReadingStatus } from '../../data/model';
import { defaultDir, filterNovels, sortNovels, SORTS, type SortKey } from '../../data/search';
import { BookCard, BookRow } from '../components/BookCard';
import { Button, IconButton } from '../components/Button';
import { Chip, EmptyState, PageHeader } from '../components/misc';
import { Segmented } from '../components/Fields';

export function LibraryPage() {
  useDocumentTitle('Library');
  const novels = useStore((s) => s.novels);
  const collections = useStore((s) => s.collections);
  const app = useStore((s) => s.app);
  const setApp = useStore((s) => s.setApp);
  const { query } = useRoute();

  const [text, setText] = useState('');
  const [statuses, setStatuses] = useState<ReadingStatus[]>(() => (query.get('status')?.split(',').filter(Boolean) as ReadingStatus[]) ?? []);
  const [fav, setFav] = useState(query.get('fav') === '1');
  const [genre, setGenre] = useState(query.get('genre') ?? '');
  const [tag, setTag] = useState(query.get('tag') ?? '');
  const [recent, setRecent] = useState<'' | 'added7' | 'added30' | 'updated7' | 'updated30'>('');
  const [collection, setCollection] = useState(query.get('collection') ?? '');
  const [sort, setSort] = useState<SortKey>((query.get('sort') as SortKey) || (app.librarySort as SortKey) || 'last_read');
  const [dir, setDir] = useState<'asc' | 'desc'>(defaultDir(sort));

  const facets = useMemo(() => {
    const g = new Map<string, number>();
    const t = new Map<string, number>();
    for (const n of novels) {
      n.genres.forEach((x) => g.set(x, (g.get(x) ?? 0) + 1));
      n.tags.forEach((x) => t.set(x, (t.get(x) ?? 0) + 1));
    }
    const sorted = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k]) => k);
    return { genres: sorted(g), tags: sorted(t) };
  }, [novels]);

  const colIds = useAsync(async () => (collection ? new Set(await collectionNovelIds(db(), collection)) : null), [collection]);
  const collectionIds = colIds.data ?? null;

  const shown = useMemo(() => {
    let list = filterNovels(novels, {
      statuses,
      favouritesOnly: fav,
      genres: genre ? [genre] : [],
      tags: tag ? [tag] : [],
      addedWithinDays: recent === 'added7' ? 7 : recent === 'added30' ? 30 : undefined,
      updatedWithinDays: recent === 'updated7' ? 7 : recent === 'updated30' ? 30 : undefined,
      collectionNovelIds: collection ? collectionIds ?? new Set() : null,
    });
    const q = text.trim().toLowerCase();
    if (q) list = list.filter((n) => [n.title, n.author, n.translator, ...n.altTitles].some((s) => s.toLowerCase().includes(q)));
    return sortNovels(list, sort, dir);
  }, [novels, statuses, fav, genre, tag, recent, collection, collectionIds, text, sort, dir]);

  const activeFilters = statuses.length + (fav ? 1 : 0) + (genre ? 1 : 0) + (tag ? 1 : 0) + (recent ? 1 : 0) + (collection ? 1 : 0);
  const clear = () => {
    setStatuses([]);
    setFav(false);
    setGenre('');
    setTag('');
    setRecent('');
    setCollection('');
    setText('');
  };

  return (
    <div className="page page--library">
      <PageHeader title="Library" lead={novels.length ? `${novels.length} ${novels.length === 1 ? 'novel' : 'novels'}` : undefined}>
        <Button icon={FilePlus2} onClick={() => navigate(routes.newNovel())}>
          Add by hand
        </Button>
        <Button variant="primary" icon={Upload} onClick={() => navigate(routes.importFiles())}>
          Import
        </Button>
      </PageHeader>

      {novels.length > 0 && (
        <div className="toolbar" role="search">
          <label className="filter-input">
            <Search size={18} aria-hidden />
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Filter by title or author" aria-label="Filter by title or author" />
            {text && <IconButton icon={X} label="Clear filter" size="sm" onClick={() => setText('')} />}
          </label>
          <div className="toolbar__group">
            <label className="select-inline">
              <span className="visually-hidden">Sort by</span>
              <select
                value={sort}
                onChange={(e) => {
                  const k = e.target.value as SortKey;
                  setSort(k);
                  setDir(defaultDir(k));
                  void setApp({ librarySort: k });
                }}
              >
                {SORTS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <IconButton icon={ArrowDownUp} label={dir === 'asc' ? 'Ascending order' : 'Descending order'} onClick={() => setDir(dir === 'asc' ? 'desc' : 'asc')} />
            <Segmented
              label="View"
              value={app.libraryView}
              onChange={(v) => void setApp({ libraryView: v })}
              options={[
                { value: 'grid', label: <LayoutGrid size={18} aria-label="Grid" />, title: 'Grid' },
                { value: 'list', label: <Rows3 size={18} aria-label="List" />, title: 'List' },
              ]}
            />
          </div>
        </div>
      )}

      {novels.length > 0 && (
        <div className="filters" aria-label="Filters">
          {STATUSES.map((s) => (
            <Chip key={s.value} active={statuses.includes(s.value)} onClick={() => setStatuses(statuses.includes(s.value) ? statuses.filter((x) => x !== s.value) : [...statuses, s.value])}>
              {s.label}
            </Chip>
          ))}
          <Chip active={fav} onClick={() => setFav(!fav)}>
            <Heart size={13} aria-hidden fill={fav ? 'currentColor' : 'none'} /> Favourites
          </Chip>
          <select className={`chip-select ${recent ? 'is-on' : ''}`} value={recent} onChange={(e) => setRecent(e.target.value as typeof recent)} aria-label="Recently added or updated">
            <option value="">Any date</option>
            <option value="added7">Added this week</option>
            <option value="added30">Added this month</option>
            <option value="updated7">Updated this week</option>
            <option value="updated30">Updated this month</option>
          </select>
          {facets.genres.length > 0 && (
            <select className={`chip-select ${genre ? 'is-on' : ''}`} value={genre} onChange={(e) => setGenre(e.target.value)} aria-label="Genre">
              <option value="">All genres</option>
              {facets.genres.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          )}
          {facets.tags.length > 0 && (
            <select className={`chip-select ${tag ? 'is-on' : ''}`} value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Tag">
              <option value="">All tags</option>
              {facets.tags.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          )}
          {collections.length > 0 && (
            <select className={`chip-select ${collection ? 'is-on' : ''}`} value={collection} onChange={(e) => setCollection(e.target.value)} aria-label="Collection">
              <option value="">All collections</option>
              {collections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          {activeFilters > 0 && (
            <button type="button" className="link link--quiet filters__clear" onClick={clear}>
              Clear filters
            </button>
          )}
        </div>
      )}

      {!novels.length ? (
        <EmptyState
          icon={LibraryBig}
          title="No novels yet"
          action={
            <Button variant="primary" icon={Upload} onClick={() => navigate(routes.importFiles())}>
              Import files
            </Button>
          }
        >
          Import EPUB, TXT, HTML or Markdown files, or add a novel by hand.
        </EmptyState>
      ) : !shown.length ? (
        <EmptyState icon={Search} title="No novels match" action={<Button onClick={clear}>Clear filters</Button>}>
          Try removing a filter.
        </EmptyState>
      ) : app.libraryView === 'grid' ? (
        <div className="book-grid">
          {shown.map((n) => (
            <BookCard key={n.id} novel={n} />
          ))}
        </div>
      ) : (
        <div className="book-list">
          {shown.map((n) => (
            <BookRow key={n.id} novel={n} />
          ))}
        </div>
      )}
    </div>
  );
}
