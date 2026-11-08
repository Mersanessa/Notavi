import { Heart } from 'lucide-react';
import { StarsShown } from './Stars';
import type { NovelSummary } from '../../data/model';
import { href, routes } from '../../app/router';
import { Cover } from './Cover';
import { Ribbon, StatusBadge } from './misc';

function chapterCount(n: NovelSummary) {
  if (n.contentType === 'external_link' && !n.chapterCount) return 'Link';
  return `${n.chapterCount} ${n.chapterCount === 1 ? 'chapter' : 'chapters'}`;
}

/** Give the tapped card's cover the shared transition name, so it glides into the novel page. */
export function heroCover(e: React.MouseEvent<HTMLElement>) {
  document.querySelectorAll<HTMLElement>('[style*="view-transition-name"]').forEach((el) => (el.style.viewTransitionName = ''));
  const cover = e.currentTarget.querySelector<HTMLElement>('.cover');
  if (cover) cover.style.viewTransitionName = 'hero-cover';
}

/** Grid card: the cover does most of the talking. */
export function BookCard({ novel, to }: { novel: NovelSummary; to?: string }) {
  const started = novel.percent > 0;
  return (
    <a className="book-card" href={href(to ?? routes.novel(novel.id))} data-testid="book-card" onClick={heroCover}>
      <div className="book-card__cover">
        <Cover coverId={novel.coverId} title={novel.title} author={novel.author} size="md" />
        {started && <Ribbon value={novel.percent} className="book-card__ribbon" label={`${Math.round(novel.percent * 100)}% read`} />}
        {novel.favourite && (
          <span className="book-card__fav" aria-label="Favourite">
            <Heart size={14} fill="currentColor" strokeWidth={0} />
          </span>
        )}
      </div>
      <div className="book-card__text">
        <span className="book-card__title">{novel.title}</span>
        {novel.author && <span className="book-card__author">{novel.author}</span>}
        <span className="book-card__meta">
          <StatusBadge status={novel.status} />
          <span className="book-card__count">{chapterCount(novel)}</span>
        </span>
        {novel.genres[0] && <span className="book-card__genre">{novel.genres.slice(0, 2).join(', ')}</span>}
        <StarsShown value={novel.rating} />
      </div>
    </a>
  );
}

/** List row: denser, with progress as a number. */
export function BookRow({ novel }: { novel: NovelSummary }) {
  const pct = Math.round(novel.percent * 100);
  return (
    <a className="book-row" href={href(routes.novel(novel.id))} data-testid="book-row" onClick={heroCover}>
      <Cover coverId={novel.coverId} title={novel.title} size="xs" />
      <div className="book-row__main">
        <span className="book-row__title">
          {novel.title}
          {novel.favourite && <Heart className="book-row__fav" size={13} fill="currentColor" strokeWidth={0} aria-label="Favourite" />}
        </span>
        <span className="book-row__sub">
          {novel.author || 'Unknown author'}
          {novel.genres[0] && <span className="book-row__genre">{novel.genres.slice(0, 2).join(', ')}</span>}
          <StarsShown value={novel.rating} />
        </span>
      </div>
      <StatusBadge status={novel.status} />
      <span className="book-row__count">{chapterCount(novel)}</span>
      <div className="book-row__progress">
        <Ribbon value={novel.percent} label={`${pct}% read`} />
        <span>{pct}%</span>
      </div>
    </a>
  );
}
