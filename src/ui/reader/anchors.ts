/**
 * Positions inside rendered chapter text.
 *
 * Reading position = (block index, fraction through that block). Blocks are the
 * top-level paragraphs/headings/etc. of the chapter, so the position survives
 * font, size, spacing and width changes, unlike a pixel offset.
 *
 * Annotations = character offsets into the chapter's text content, plus the
 * quoted text so they can be re-found if the chapter is edited.
 */

const BLOCK_SEL = 'p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, hr, figure, table, img, dt, dd';

export function getBlocks(root: HTMLElement): HTMLElement[] {
  const all = Array.from(root.querySelectorAll<HTMLElement>(BLOCK_SEL));
  const top = all.filter((el) => {
    const parent = el.parentElement?.closest(BLOCK_SEL);
    return !parent || !root.contains(parent);
  });
  return top.length ? top : (Array.from(root.children) as HTMLElement[]);
}

export interface Anchor {
  blockIndex: number;
  blockOffset: number;
}

/** Where the top of the viewport is, relative to the content blocks. `top` is the scroller's visible top in content coordinates. */
export function captureAnchor(blocks: HTMLElement[], scroller: HTMLElement, inset = 0): Anchor {
  if (!blocks.length) return { blockIndex: 0, blockOffset: 0 };
  const top = scroller.getBoundingClientRect().top + inset;
  // Binary search for the first block whose bottom is below the viewport top.
  let lo = 0;
  let hi = blocks.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (blocks[mid].getBoundingClientRect().bottom <= top) lo = mid + 1;
    else hi = mid;
  }
  const r = blocks[lo].getBoundingClientRect();
  if (lo === 0 && r.top >= top) return { blockIndex: 0, blockOffset: 0 };
  const offset = r.height > 0 ? Math.max(0, Math.min(1, (top - r.top) / r.height)) : 0;
  return { blockIndex: lo, blockOffset: offset };
}

export function scrollToAnchor(blocks: HTMLElement[], scroller: HTMLElement, a: Anchor, inset = 0) {
  if (a.blockIndex <= 0 && a.blockOffset <= 0) {
    // The very start: show the chapter heading too.
    scroller.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    return;
  }
  const el = blocks[Math.min(a.blockIndex, blocks.length - 1)];
  if (!el) return;
  const sr = scroller.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  const y = scroller.scrollTop + (r.top - sr.top) + r.height * a.blockOffset - inset;
  scroller.scrollTo({ top: Math.max(0, y), behavior: 'instant' as ScrollBehavior });
}

/* ------------------------------------------------------------------ text offsets */

function textWalker(root: Node) {
  return document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
}

/** Character offset of (node, offset) within root's text content. */
export function textOffset(root: Node, node: Node, offset: number): number {
  if (node.nodeType !== Node.TEXT_NODE) {
    // Point between child nodes: measure text before child[offset].
    const r = document.createRange();
    r.setStart(root, 0);
    r.setEnd(node, offset);
    return r.toString().length;
  }
  const w = textWalker(root);
  let total = 0;
  let n: Node | null;
  while ((n = w.nextNode())) {
    if (n === node) return total + offset;
    total += n.nodeValue?.length ?? 0;
  }
  return total;
}

/** A DOM Range for [start, end) in root's text content. */
export function rangeFromOffsets(root: Node, start: number, end: number): Range | null {
  const w = textWalker(root);
  let total = 0;
  let n: Node | null;
  const range = document.createRange();
  let started = false;
  while ((n = w.nextNode())) {
    const len = n.nodeValue?.length ?? 0;
    if (!started && start <= total + len) {
      range.setStart(n, Math.max(0, start - total));
      started = true;
    }
    if (started && end <= total + len) {
      range.setEnd(n, Math.max(0, end - total));
      return range;
    }
    total += len;
  }
  return null;
}

/** Locate an annotation: trust the offsets if the quote still matches, otherwise search for the quote nearby. */
export function locate(text: string, start: number, end: number, quote: string): [number, number] | null {
  if (!quote) return start >= 0 && end > start && end <= text.length ? [start, end] : null;
  if (text.slice(start, end) === quote) return [start, end];
  let best = -1;
  let bestDist = Infinity;
  for (let i = text.indexOf(quote); i >= 0; i = text.indexOf(quote, i + 1)) {
    const d = Math.abs(i - start);
    if (d < bestDist) {
      best = i;
      bestDist = d;
    }
  }
  return best >= 0 ? [best, best + quote.length] : null;
}

/** Wrap a text range in elements, splitting across nodes. Returns the created elements. */
export function wrapRange(range: Range, make: () => HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  const root = range.commonAncestorContainer;
  const nodes: Text[] = [];
  if (root.nodeType === Node.TEXT_NODE) nodes.push(root as Text);
  else {
    const w = textWalker(root);
    let n: Node | null;
    while ((n = w.nextNode())) if (range.intersectsNode(n)) nodes.push(n as Text);
  }
  for (const node of nodes) {
    let s = 0;
    let e = node.length;
    if (node === range.startContainer) s = range.startOffset;
    if (node === range.endContainer) e = range.endOffset;
    if (e <= s || !node.nodeValue?.slice(s, e).trim()) continue;
    let target = node;
    if (s > 0) target = target.splitText(s);
    if (e - s < target.length) target.splitText(e - s);
    const wrap = make();
    target.parentNode!.insertBefore(wrap, target);
    wrap.appendChild(target);
    out.push(wrap);
  }
  return out;
}

/** Remove wrappers added by wrapRange (keeps their text). */
export function unwrapAll(root: HTMLElement, selector: string) {
  root.querySelectorAll(selector).forEach((el) => {
    const parent = el.parentNode!;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
    parent.normalize();
  });
}

/** Ranges of every case- and accent-insensitive match of the query's terms. */
export function findMatches(text: string, query: string): [number, number][] {
  const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  // Folding can change length for some characters; map folded indexes back.
  const map: number[] = [];
  let folded = '';
  for (let i = 0; i < text.length; i++) {
    const f = fold(text[i]);
    for (let k = 0; k < f.length; k++) map.push(i);
    folded += f;
  }
  map.push(text.length);
  const phrases = Array.from(query.matchAll(/"([^"]+)"|(\S+)/g), (m) => fold((m[1] ?? m[2]).replace(/[^\p{L}\p{N}\s]/gu, ' ').trim())).filter((t) => t.length >= 2 || /[^\x00-\x7f]/.test(t));
  const out: [number, number][] = [];
  for (const p of phrases) {
    for (let i = folded.indexOf(p); i >= 0; i = folded.indexOf(p, i + p.length)) out.push([map[i], map[i + p.length - 1] + 1]);
  }
  return out.sort((a, b) => a[0] - b[0]).filter((r, i, a) => i === 0 || r[0] >= a[i - 1][1]);
}
