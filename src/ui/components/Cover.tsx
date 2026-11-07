import { useBlobUrl } from '../../app/blobs';
import { hashString } from '../../lib/text';

/* Cloth binding colours for generated covers: muted, bookish, varied. */
const CLOTHS = [
  ['#2f4858', '#d9c9a3'], ['#5b3a3a', '#e7d3b0'], ['#38503e', '#e2d6b5'], ['#4a3f5c', '#ddd0b8'],
  ['#6a4b2a', '#f0dfbf'], ['#24434a', '#d6c7a1'], ['#5a2e3f', '#ecd8bf'], ['#3d4a2f', '#e6d9b4'],
  ['#2e3550', '#d9ccad'], ['#6b3a26', '#f2e0c2'], ['#3e3a33', '#e0d3b6'], ['#1f4d4a', '#dacba6'],
];

interface Props {
  coverId: string | null;
  title: string;
  author?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

/**
 * A book cover. Stored covers are shown as-is; books without one get a
 * generated cloth binding with the title set in the display face.
 */
export function Cover({ coverId, title, author, size = 'md', className = '' }: Props) {
  const url = useBlobUrl(coverId);
  if (coverId && url) {
    return (
      <div className={`cover cover--${size} ${className}`}>
        <img className="cover__img" src={url} alt="" loading="lazy" decoding="async" draggable={false} />
      </div>
    );
  }
  const [cloth, ink] = CLOTHS[hashString(title) % CLOTHS.length];
  // Size by both total length and the longest word, so words never break mid-way.
  const len = title.length;
  const longest = Math.max(...title.split(/\s+/).map((w) => w.length));
  const byLen = len > 60 ? 0 : len > 36 ? 1 : len > 18 ? 2 : 3;
  const byWord = longest > 13 ? 0 : longest > 10 ? 1 : longest > 7 ? 2 : 3;
  const fit = (['xs', 'sm', 'md', 'lg'] as const)[Math.min(byLen, byWord)];
  return (
    <div className={`cover cover--${size} cover--generated ${className}`} style={{ '--cloth': cloth, '--ink': ink } as React.CSSProperties} aria-hidden>
      <div className="cover__frame">
        <span className={`cover__title cover__title--${fit}`}>{title}</span>
        {author && size !== 'xs' && size !== 'sm' && <span className="cover__author">{author}</span>}
      </div>
    </div>
  );
}
