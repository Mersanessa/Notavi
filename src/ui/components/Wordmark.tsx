import { WORDMARK } from '../brand-paths';

/** The Notavi wordmark: Fraunces lettering in the current text colour, the i's dot in brass. */
export function Wordmark({ height = 28, className = '', title = 'Notavi' }: { height?: number; className?: string; title?: string }) {
  const [, , w, h] = WORDMARK.viewBox.split(' ').map(Number);
  return (
    <svg className={`wordmark-svg ${className}`} viewBox={WORDMARK.viewBox} height={height} width={(height * w) / h} role="img" aria-label={title}>
      <path d={WORDMARK.letters} fill="currentColor" />
      <path className="wordmark-svg__lozenge" d={WORDMARK.lozenge} fill="var(--brass)" />
    </svg>
  );
}

/** Just the lozenge, used as a small brand accent (e.g. the navigation rail). */
export function Lozenge({ size = 10, className = '' }: { size?: number; className?: string }) {
  return (
    <svg className={className} viewBox="-1 -1.3 2 2.6" width={size} height={size * 1.3} aria-hidden>
      <path d="M0 -1.3 L1 0 L0 1.3 L-1 0 Z" fill="var(--brass)" />
    </svg>
  );
}
