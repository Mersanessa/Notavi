/**
 * The opening sequence (markup and animation live in index.html). It plays for
 * at least ~1.3 s, or until tapped, and dissolves once the library is open.
 */
const started = performance.now();
const MIN_MS = 1300;
let skipped = false;
let done = false;

function reduced(): boolean {
  try {
    if (localStorage.getItem('notavi.motion') === 'reduce') return true;
  } catch {
    /* ignore */
  }
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function initSplash() {
  const el = document.getElementById('splash');
  if (!el) return;
  el.addEventListener('pointerdown', () => (skipped = true), { once: true });
}

/** Fade the splash out. Safe to call more than once. */
export function dismissSplash() {
  if (done) return;
  const el = document.getElementById('splash');
  if (!el) return;
  done = true;
  const wait = skipped || reduced() ? 0 : Math.max(0, MIN_MS - (performance.now() - started));
  setTimeout(() => {
    el.classList.add('is-out');
    setTimeout(() => el.remove(), reduced() ? 150 : 650);
  }, wait);
}
