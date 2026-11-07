/**
 * DOM helpers for importers: splitting a document into chapters at heading /
 * anchor elements, and sanitising chapter HTML.
 */
import { htmlToText } from '../lib/text';

const FOLLOWING = 4; // Node.DOCUMENT_POSITION_FOLLOWING
const CONTAINS = 8; // Node.DOCUMENT_POSITION_CONTAINS (other contains this)
const CONTAINED_BY = 16; // Node.DOCUMENT_POSITION_CONTAINED_BY

/** -1 if a is before b in document order, 1 if after, 0 if same. Ancestors come before descendants. */
function order(a: Node, b: Node): number {
  if (a === b) return 0;
  const pos = a.compareDocumentPosition(b);
  if (pos & CONTAINED_BY) return -1; // a contains b → a starts first
  if (pos & CONTAINS) return 1;
  return pos & FOLLOWING ? -1 : 1;
}

function contains(a: Node, b: Node) {
  return a !== b && !!(a.compareDocumentPosition(b) & CONTAINED_BY);
}

/**
 * Clone the part of `root`'s content that lies between `start` (inclusive) and
 * `end` (exclusive), keeping ancestors of partially included nodes so the
 * structure stays valid. Either boundary may be null (= open).
 */
export function cloneBetween(root: Element, start: Element | null, end: Element | null): DocumentFragment {
  const doc = root.ownerDocument;
  const frag = doc.createDocumentFragment();
  const visit = (node: Node, parent: Node) => {
    const holdsStart = !!start && contains(node, start);
    const holdsEnd = !!end && contains(node, end);
    if (holdsStart || holdsEnd) {
      // Partially in range: keep a shallow copy and look inside.
      const copy = node.cloneNode(false);
      for (const child of Array.from(node.childNodes)) visit(child, copy);
      if (copy.childNodes.length) parent.appendChild(copy);
      return;
    }
    const afterStart = !start || order(start, node) <= 0;
    const beforeEnd = !end || (order(node, end) < 0 && !contains(end, node) && node !== end);
    if (afterStart && beforeEnd) parent.appendChild(node.cloneNode(true));
  };
  for (const child of Array.from(root.childNodes)) visit(child, frag);
  return frag;
}

export function fragmentToHtml(frag: DocumentFragment): string {
  const div = frag.ownerDocument!.createElement('div');
  div.appendChild(frag);
  return div.innerHTML;
}

/**
 * Split `root` at each marker. Returns the HTML before the first marker
 * (`lead`) and one section per marker.
 */
export function splitAt(root: Element, markers: Element[]): { lead: string; sections: string[] } {
  const sorted = [...markers].sort(order);
  const lead = sorted.length ? fragmentToHtml(cloneBetween(root, null, sorted[0])) : root.innerHTML;
  const sections = sorted.map((m, i) => fragmentToHtml(cloneBetween(root, m, sorted[i + 1] ?? null)));
  return { lead, sections };
}

/* ------------------------------------------------------------------ sanitising */

const ALLOWED_TAGS = new Set([
  'p', 'br', 'hr', 'em', 'i', 'strong', 'b', 'u', 's', 'del', 'ins', 'sub', 'sup', 'small', 'mark', 'span', 'div',
  'blockquote', 'q', 'cite', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'pre', 'code',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'figure', 'figcaption', 'img', 'ruby', 'rt', 'rp',
  'abbr', 'section', 'article', 'aside', 'header', 'footer',
]);
/** Removed together with everything inside them. */
const DROP_TAGS = new Set([
  'script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'form', 'input', 'button', 'select',
  'textarea', 'option', 'svg', 'math', 'video', 'audio', 'source', 'track', 'canvas', 'link', 'meta', 'base', 'title',
  'head', 'noscript', 'template', 'nav', 'map', 'area', 'dialog', 'portal',
]);
const ALLOWED_ATTR: Record<string, string[]> = {
  '*': ['lang', 'dir', 'title', 'data-align'],
  img: ['src', 'alt'],
  td: ['colspan', 'rowspan'],
  th: ['colspan', 'rowspan'],
  abbr: ['title'],
};
const BLOB_SRC = /^notavi-blob:[a-z0-9-]{8,64}$/i;

function cleanNode(node: Node) {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 3) continue; // text
    if (child.nodeType !== 1) {
      child.parentNode!.removeChild(child); // comments, processing instructions, CDATA
      continue;
    }
    const el = child as Element;
    const tag = el.localName.toLowerCase();
    if (DROP_TAGS.has(tag)) {
      el.remove();
      continue;
    }
    cleanNode(el);
    if (!ALLOWED_TAGS.has(tag)) {
      // Unknown or disallowed (e.g. <a>, <font>, <center>): keep the content, drop the element.
      const frag = el.ownerDocument.createDocumentFragment();
      while (el.firstChild) frag.appendChild(el.firstChild);
      el.replaceWith(frag);
      continue;
    }
    const allowed = [...ALLOWED_ATTR['*'], ...(ALLOWED_ATTR[tag] ?? [])];
    for (const a of Array.from(el.attributes)) {
      if (!allowed.includes(a.name.toLowerCase())) el.removeAttribute(a.name);
    }
    const align = el.getAttribute('data-align');
    if (align && align !== 'center' && align !== 'right') el.removeAttribute('data-align');
    if (tag === 'img' && !BLOB_SRC.test(el.getAttribute('src') ?? '')) el.remove();
  }
}

/**
 * Sanitise chapter HTML with a strict allow-list: basic formatting only. No
 * scripts, styles, event handlers, links, forms or remote resources. Images
 * must point at stored blobs (`notavi-blob:<id>`). Parsing uses an inert
 * DOMParser document, so nothing in the input runs or loads.
 */
export function sanitizeChapterHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<!doctype html><html><body>${html}</body></html>`, 'text/html');
  cleanNode(doc.body);
  return tidy(doc.body.innerHTML);
}

/** Remove empty wrappers and collapse excessive breaks. */
function tidy(html: string): string {
  return html
    .replace(/<(span|div|section|article|header|footer)>\s*<\/\1>/gi, '')
    .replace(/(<br\s*\/?>\s*){3,}/gi, '<br><br>')
    .replace(/<p>(\s|&nbsp;| )*<\/p>/gi, '')
    .trim();
}

/** Copy `text-align: center/right` (from inline style or common class names) into data-align before sanitising. */
export function markAlignment(root: Element) {
  root.querySelectorAll('p, div').forEach((el) => {
    const style = (el.getAttribute('style') ?? '').toLowerCase();
    const cls = (el.getAttribute('class') ?? '').toLowerCase();
    if (/text-align:\s*center/.test(style) || /\b(center|centered|centre|centred|ctr)\b/.test(cls)) el.setAttribute('data-align', 'center');
    else if (/text-align:\s*right/.test(style) || /\bright\b/.test(cls)) el.setAttribute('data-align', 'right');
  });
}

export function hasContent(html: string): boolean {
  return htmlToText(html).length > 0 || /<img\b/i.test(html);
}

/** Remove the first heading from chapter HTML if it repeats the chapter title (the reader shows the title itself). */
export function stripLeadingTitle(html: string, title: string): string {
  const m = html.match(/^\s*(?:<(?:div|section|header|article)[^>]*>\s*)*<(h[1-6])[^>]*>([\s\S]*?)<\/\1>/i);
  if (!m) return html;
  const headingText = htmlToText(m[2]).replace(/\s+/g, ' ').trim().toLowerCase();
  const t = title.replace(/\s+/g, ' ').trim().toLowerCase();
  if (headingText && (headingText === t || t.includes(headingText) || headingText.includes(t))) {
    const idx = html.indexOf(m[0]) + m[0].length;
    const prefix = m[0].slice(0, m[0].lastIndexOf('<' + m[1]));
    return (prefix + html.slice(idx)).trim();
  }
  return html;
}

export function parseHtmlDocument(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

/** Parse XHTML strictly, falling back to the forgiving HTML parser for malformed files. */
export function parseXhtml(text: string): { doc: Document; lenient: boolean } {
  const doc = new DOMParser().parseFromString(text, 'application/xhtml+xml');
  if (!doc.getElementsByTagName('parsererror').length && doc.querySelector('body')) return { doc, lenient: false };
  return { doc: parseHtmlDocument(text), lenient: true };
}
