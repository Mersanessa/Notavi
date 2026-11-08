import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, BookOpen, Eye, EyeOff, FilePlus2, Flame, LayoutGrid, Plus, Upload } from 'lucide-react';
import { useStore, db } from '../../app/store';
import { useAsync, useDocumentTitle } from '../../app/hooks';
import { href, navigate, routes } from '../../app/router';
import { HOME_SECTIONS, type HomeSection } from '../../app/prefs';
import type { NovelSummary } from '../../data/model';
import { recentlyReadChapters } from '../../data/reading';
import { getStats, recommend } from '../../data/stats';
import { formatDuration, formatMinutes, formatNumber, readingMinutes, relativeTime } from '../../lib/text';
import { BookCard } from '../components/BookCard';
import { Cover } from '../components/Cover';
import { Button, IconButton } from '../components/Button';
import { Dialog } from '../components/Dialog';
import { EmptyState, Ribbon, SectionHeader } from '../components/misc';
import { Wordmark } from '../components/Wordmark';
import { CountUp } from '../components/CountUp';

const DAY = 86400000;

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Reading late';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export function HomePage() {
  useDocumentTitle('Home');
  const novels = useStore((s) => s.novels);
  const collections = useStore((s) => s.collections);
  const app = useStore((s) => s.app);
  const wpm = useStore((s) => s.reader.wpm);
  const [customising, setCustomising] = useState(false);

  const recent = useAsync(() => recentlyReadChapters(db(), 6), []);
  const stats = useAsync(() => getStats(db(), { days: 7 }), []);

  const groups = useMemo(() => {
    const now = Date.now();
    const continuing = novels
      .filter((n) => n.progress && n.lastReadAt && n.status !== 'completed' && n.status !== 'dropped')
      .sort((a, b) => (b.lastReadAt ?? 0) - (a.lastReadAt ?? 0));
    const added = [...novels].sort((a, b) => b.createdAt - a.createdAt).filter((n) => now - n.createdAt < 60 * DAY).slice(0, 12);
    const updated = novels
      .filter((n) => n.contentUpdatedAt - n.createdAt > 60000)
      .sort((a, b) => b.contentUpdatedAt - a.contentUpdatedAt)
      .slice(0, 12);
    const favourites = novels.filter((n) => n.favourite).sort((a, b) => (b.lastReadAt ?? b.createdAt) - (a.lastReadAt ?? a.createdAt));
    return { continuing, added, updated, favourites, recommended: recommend(novels, 10) };
  }, [novels]);

  if (!novels.length) {
    return (
      <div className="page page--home">
        <div className="welcome">
          <Wordmark height={44} className="welcome__mark" />
          <h1 className="welcome__title">Your library is empty</h1>
          <p className="welcome__lead">
            Import novels you own as EPUB, TXT, HTML or Markdown files, or add one by hand. Everything stays on this device.
          </p>
          <div className="welcome__actions">
            <Button variant="primary" size="lg" icon={Upload} onClick={() => navigate(routes.importFiles())}>
              Import files
            </Button>
            <Button size="lg" icon={FilePlus2} onClick={() => navigate(routes.newNovel())}>
              Add a novel by hand
            </Button>
          </div>
          <p className="welcome__hint">
            Moving from another device? Restore a backup in <a className="link" href={href(routes.settings('backup'))}>Settings</a>.
          </p>
        </div>
      </div>
    );
  }

  const order = app.homeOrder.filter((s) => !app.homeHidden.includes(s));
  const render = (s: HomeSection) => {
    switch (s) {
      case 'continue':
        return groups.continuing.length ? <ContinueReading key={s} list={groups.continuing} wpm={wpm} /> : null;
      case 'recentChapters':
        return recent.data?.length ? (
          <section key={s} className="home-section" aria-labelledby="h-recent">
            <SectionHeader id="h-recent" title="Recently read chapters" />
            <ul className="recent-chapters">
              {recent.data.map((r) => (
                <li key={r.chapterId}>
                  <a className="recent-chapter" href={href(routes.read(r.novelId, r.chapterId))}>
                    <Cover coverId={r.coverId} title={r.novelTitle} size="xs" />
                    <span className="recent-chapter__text">
                      <span className="recent-chapter__title">{r.chapterTitle}</span>
                      <span className="recent-chapter__novel">{r.novelTitle}</span>
                    </span>
                    <span className="recent-chapter__when">{relativeTime(r.lastOpenedAt)}</span>
                    <Ribbon value={r.maxRatio} className="recent-chapter__ribbon" label={`${Math.round(r.maxRatio * 100)}% of chapter read`} />
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ) : null;
      case 'recentlyAdded':
        return groups.added.length ? <Shelf key={s} id="h-added" title="Recently added" novels={groups.added} more={routes.library('sort=added')} /> : null;
      case 'recentlyUpdated':
        return groups.updated.length ? <Shelf key={s} id="h-updated" title="Recently updated" novels={groups.updated} more={routes.library('sort=updated')} /> : null;
      case 'favourites':
        return groups.favourites.length ? <Shelf key={s} id="h-fav" title="Favourites" novels={groups.favourites} more={routes.library('fav=1')} /> : null;
      case 'recommended':
        return groups.recommended.length ? (
          <section key={s} className="home-section" aria-labelledby="h-rec">
            <SectionHeader id="h-rec" title="Recommended from your library" />
            <div className="shelf">
              {groups.recommended.map((r) => (
                <div key={r.novel.id} className="shelf__item">
                  <BookCard novel={r.novel} />
                  {r.reason && <p className="rec-reason">{r.reason}</p>}
                </div>
              ))}
            </div>
          </section>
        ) : null;
      case 'collections':
        return collections.length ? (
          <section key={s} className="home-section" aria-labelledby="h-col">
            <SectionHeader id="h-col" title="Collections" action={<a className="link link--quiet" href={href(routes.collections())}>All collections</a>} />
            <div className="collection-grid collection-grid--compact">
              {collections.slice(0, 6).map((c) => (
                <CollectionTile key={c.id} id={c.id} name={c.name} count={c.novelCount} coverNovelIds={c.coverNovelIds} novels={novels} />
              ))}
            </div>
          </section>
        ) : null;
      case 'stats':
        return stats.data ? (
          <section key={s} className="home-section" aria-labelledby="h-stats">
            <SectionHeader id="h-stats" title="Reading summary" action={<a className="link link--quiet" href={href(routes.stats())}>All stats</a>} />
            <div className="summary">
              <div className="summary__item">
                <span className="summary__value">
                  <Flame size={20} aria-hidden className="summary__icon" />
                  <CountUp value={stats.data.currentStreak} />
                </span>
                <span className="summary__label">day streak</span>
              </div>
              <div className="summary__item">
                <span className="summary__value">{formatDuration(stats.data.readingMsThisWeek)}</span>
                <span className="summary__label">read this week</span>
              </div>
              <div className="summary__item">
                <span className="summary__value">
                  <CountUp value={stats.data.chaptersRead} format={(n) => formatNumber(Math.round(n))} />
                </span>
                <span className="summary__label">chapters read</span>
              </div>
              <div className="summary__item">
                <span className="summary__value">
                  <CountUp value={stats.data.byStatus.completed} />
                </span>
                <span className="summary__label">novels completed</span>
              </div>
            </div>
          </section>
        ) : null;
    }
  };

  return (
    <div className="page page--home">
      <div className="home-brand">
        <Wordmark height={22} />
      </div>
      <header className="home-head">
        <h1 className="home-head__title">{greeting()}</h1>
        <div className="home-head__actions">
          <IconButton icon={LayoutGrid} label="Customise Home" onClick={() => setCustomising(true)} />
          <Button variant="primary" icon={Plus} onClick={() => navigate(routes.importFiles())}>
            Import
          </Button>
        </div>
      </header>
      {order.map(render)}
      {order.every((s) => render(s) === null) && (
        <EmptyState icon={BookOpen} title="Nothing to show yet">
          Open a novel from your <a className="link" href={href(routes.library())}>library</a> to start reading.
        </EmptyState>
      )}
      <CustomiseHome open={customising} onClose={() => setCustomising(false)} />
    </div>
  );
}

function ContinueReading({ list, wpm }: { list: NovelSummary[]; wpm: number }) {
  const [lead, ...rest] = list;
  const wordsLeft = Math.max(0, Math.round(lead.totalWords * (1 - lead.percent)));
  return (
    <section className="home-section" aria-labelledby="h-continue">
      <SectionHeader id="h-continue" title="Continue reading" />
      <div className="continue">
        <a
          className="continue__lead"
          href={href(routes.read(lead.id))}
          data-testid="continue-lead"
          onPointerMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            e.currentTarget.style.setProperty('--mx', `${((e.clientX - r.left) / r.width) * 100}%`);
            e.currentTarget.style.setProperty('--my', `${((e.clientY - r.top) / r.height) * 100}%`);
          }}
        >
          <Cover coverId={lead.coverId} title={lead.title} author={lead.author} size="lg" />
          <div className="continue__body">
            <span className="continue__title">{lead.title}</span>
            {lead.author && <span className="continue__author">{lead.author}</span>}
            <span className="continue__chapter">{lead.progress?.chapterTitle}</span>
            <Ribbon value={lead.percent} className="continue__ribbon" label={`${Math.round(lead.percent * 100)}% read`} />
            <span className="continue__meta">
              <span>{Math.round(lead.percent * 100)}% read</span>
              <span>{wordsLeft ? `about ${formatMinutes(readingMinutes(wordsLeft, wpm))} left` : ''}</span>
            </span>
            <span className="btn btn--primary btn--md continue__cta">
              <BookOpen size={18} aria-hidden strokeWidth={1.75} />
              <span className="btn__label">Continue</span>
            </span>
          </div>
        </a>
        {rest.length > 0 && (
          <ul className="continue__more">
            {rest.slice(0, 5).map((n) => (
              <li key={n.id}>
                <a className="continue-mini" href={href(routes.read(n.id))}>
                  <Cover coverId={n.coverId} title={n.title} size="sm" />
                  <span className="continue-mini__text">
                    <span className="continue-mini__title">{n.title}</span>
                    <span className="continue-mini__chapter">{n.progress?.chapterTitle}</span>
                    <Ribbon value={n.percent} label={`${Math.round(n.percent * 100)}% read`} />
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function Shelf({ id, title, novels, more }: { id: string; title: string; novels: NovelSummary[]; more?: string }) {
  return (
    <section className="home-section" aria-labelledby={id}>
      <SectionHeader id={id} title={title} action={more && <a className="link link--quiet" href={href(more)}>See all</a>} />
      <div className="shelf">
        {novels.map((n) => (
          <div key={n.id} className="shelf__item">
            <BookCard novel={n} />
          </div>
        ))}
      </div>
    </section>
  );
}

export function CollectionTile({ id, name, count, coverNovelIds, novels }: { id: string; name: string; count: number; coverNovelIds: string[]; novels: NovelSummary[] }) {
  const covers = coverNovelIds.map((nid) => novels.find((n) => n.id === nid)).filter(Boolean) as NovelSummary[];
  return (
    <a className="collection-tile" href={href(routes.collection(id))}>
      <div className="collection-tile__stack" aria-hidden>
        {covers.slice(0, 3).map((n, i) => (
          <Cover key={n.id} coverId={n.coverId} title={n.title} size="sm" className={`collection-tile__cover collection-tile__cover--${i}`} />
        ))}
        {!covers.length && <div className="collection-tile__empty" />}
      </div>
      <span className="collection-tile__name">{name}</span>
      <span className="collection-tile__count">
        {count} {count === 1 ? 'novel' : 'novels'}
      </span>
    </a>
  );
}

function CustomiseHome({ open, onClose }: { open: boolean; onClose: () => void }) {
  const app = useStore((s) => s.app);
  const setApp = useStore((s) => s.setApp);
  const order = app.homeOrder.concat(HOME_SECTIONS.map((h) => h.value).filter((v) => !app.homeOrder.includes(v)));
  const move = (i: number, d: -1 | 1) => {
    const next = [...order];
    const [x] = next.splice(i, 1);
    next.splice(i + d, 0, x);
    void setApp({ homeOrder: next });
  };
  const toggle = (s: HomeSection) => void setApp({ homeHidden: app.homeHidden.includes(s) ? app.homeHidden.filter((x) => x !== s) : [...app.homeHidden, s] });
  return (
    <Dialog open={open} onClose={onClose} title="Customise Home" description="Choose which sections appear and in what order." footer={<Button variant="primary" onClick={onClose}>Done</Button>}>
      <ul className="reorder-list">
        {order.map((s, i) => {
          const label = HOME_SECTIONS.find((h) => h.value === s)!.label;
          const hidden = app.homeHidden.includes(s);
          return (
            <li key={s} className={`reorder-list__item ${hidden ? 'is-hidden' : ''}`}>
              <span className="reorder-list__label">{label}</span>
              <IconButton icon={hidden ? EyeOff : Eye} label={hidden ? `Show ${label}` : `Hide ${label}`} size="sm" onClick={() => toggle(s)} />
              <IconButton icon={ArrowUp} label={`Move ${label} up`} size="sm" disabled={i === 0} onClick={() => move(i, -1)} />
              <IconButton icon={ArrowDown} label={`Move ${label} down`} size="sm" disabled={i === order.length - 1} onClick={() => move(i, 1)} />
            </li>
          );
        })}
      </ul>
    </Dialog>
  );
}
