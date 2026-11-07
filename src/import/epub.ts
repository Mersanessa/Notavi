import JSZip from 'jszip';
import type { ParsedNovel } from '../data/model';
import { htmlToText, newId, uniqueStrings } from '../lib/text';
import { hasContent, markAlignment, parseXhtml, sanitizeChapterHtml, splitAt, stripLeadingTitle } from './dom';
import { ImportError, decodeText, fileStem } from './errors';

const IMAGE_TYPES: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml', bmp: 'image/bmp',
};

function dirname(p: string) {
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i + 1);
}

/** Resolve an href relative to `base` inside the zip. Returns [path, fragment]. */
export function resolveHref(base: string, href: string): [string, string] {
  const [rawPath, frag = ''] = href.split('#');
  let path = rawPath;
  try {
    path = decodeURIComponent(rawPath);
  } catch {
    /* keep as is */
  }
  if (!path) return ['', frag];
  const parts = (path.startsWith('/') ? path.slice(1) : base + path).split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p !== '.' && p !== '') out.push(p);
  }
  return [out.join('/'), frag];
}

function xml(text: string, what: string): Document {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new ImportError(`This EPUB's ${what} is damaged and can't be read.`);
  return doc;
}

/** Elements by local name, ignoring namespace prefixes (dc:title, opf:meta…). */
function byLocal(root: Document | Element, name: string): Element[] {
  return Array.from(root.getElementsByTagName('*')).filter((e) => e.localName === name);
}

async function readText(zip: JSZip, path: string): Promise<string | null> {
  const f = zip.file(path) ?? zip.file(new RegExp(`^${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'))[0];
  if (!f) return null;
  const bytes = await f.async('uint8array');
  const declared = new TextDecoder('latin1').decode(bytes.subarray(0, 200)).match(/encoding=["']([\w-]+)/i)?.[1];
  return decodeText(bytes, declared).text;
}

interface TocEntry {
  path: string;
  frag: string;
  title: string;
}

function parseNav(doc: Document, base: string): TocEntry[] {
  const navs = byLocal(doc, 'nav');
  const toc = navs.find((n) => (n.getAttribute('epub:type') ?? n.getAttributeNS('http://www.idpf.org/2007/ops', 'type') ?? '').includes('toc')) ?? navs[0];
  if (!toc) return [];
  return byLocal(toc, 'a')
    .map((a) => {
      const [path, frag] = resolveHref(base, a.getAttribute('href') ?? '');
      return { path, frag, title: (a.textContent ?? '').replace(/\s+/g, ' ').trim() };
    })
    .filter((e) => e.path);
}

function parseNcx(doc: Document, base: string): TocEntry[] {
  return byLocal(doc, 'navPoint')
    .map((np) => {
      const label = byLocal(np, 'text')[0]?.textContent ?? '';
      const src = byLocal(np, 'content')[0]?.getAttribute('src') ?? '';
      const [path, frag] = resolveHref(base, src);
      return { path, frag, title: label.replace(/\s+/g, ' ').trim() };
    })
    .filter((e) => e.path);
}

export async function parseEpub(bytes: Uint8Array, fileName: string): Promise<ParsedNovel> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new ImportError(`“${fileName}” isn't a valid EPUB. The file may be incomplete or damaged.`);
  }
  const warnings: string[] = [];

  // DRM: refuse rather than attempt anything. Font obfuscation is not DRM and is fine.
  const enc = await readText(zip, 'META-INF/encryption.xml');
  if (enc) {
    const algos = Array.from(enc.matchAll(/Algorithm=["']([^"']+)["']/g)).map((m) => m[1]);
    const contentEncrypted = algos.some((a) => !/idpf\.org\/2008\/embedding|ns\.adobe\.com\/pdf\/enc#RC/.test(a) && !/#(sha1|sha256)$/.test(a));
    if (contentEncrypted) throw new ImportError(`“${fileName}” is protected by DRM. Notavi only imports DRM-free files and does not remove DRM.`);
  }

  const container = await readText(zip, 'META-INF/container.xml');
  let opfPath = container?.match(/full-path=["']([^"']+)["']/)?.[1];
  if (!opfPath) opfPath = Object.keys(zip.files).find((p) => p.toLowerCase().endsWith('.opf'));
  if (!opfPath) throw new ImportError(`“${fileName}” is missing its package file, so it isn't a readable EPUB.`);
  const opfText = await readText(zip, opfPath);
  if (!opfText) throw new ImportError(`“${fileName}” is missing its package file, so it isn't a readable EPUB.`);
  const opf = xml(opfText, 'package file');
  const base = dirname(opfPath);

  /* metadata */
  const first = (name: string) => byLocal(opf, name)[0]?.textContent?.replace(/\s+/g, ' ').trim() || undefined;
  const refines = new Map<string, Record<string, string>>();
  byLocal(opf, 'meta').forEach((m) => {
    const r = m.getAttribute('refines');
    const prop = m.getAttribute('property');
    if (r && prop) refines.set(r.slice(1), { ...(refines.get(r.slice(1)) ?? {}), [prop]: m.textContent?.trim() ?? '' });
  });
  const titles = byLocal(opf, 'title').map((t) => ({ text: t.textContent?.replace(/\s+/g, ' ').trim() ?? '', type: refines.get(t.getAttribute('id') ?? '')?.['title-type'] }));
  const mainTitle = titles.find((t) => t.type === 'main')?.text ?? titles[0]?.text;
  const altTitles = titles.filter((t) => t.text && t.text !== mainTitle && t.type !== 'subtitle').map((t) => t.text);
  const authors: string[] = [];
  const translators: string[] = [];
  for (const tag of ['creator', 'contributor']) {
    for (const c of byLocal(opf, tag)) {
      const role = c.getAttribute('opf:role') ?? c.getAttributeNS('http://www.idpf.org/2007/opf', 'role') ?? refines.get(c.getAttribute('id') ?? '')?.role ?? (tag === 'creator' ? 'aut' : '');
      const name = c.textContent?.replace(/\s+/g, ' ').trim();
      if (!name) continue;
      if (role === 'trl') translators.push(name);
      else if (role === 'aut' || (tag === 'creator' && !role)) authors.push(name);
    }
  }
  const rawDescription = first('description');
  const description = rawDescription ? htmlToText(rawDescription.includes('<') ? rawDescription : rawDescription.replace(/&lt;/g, '<').replace(/&gt;/g, '>')) : undefined;
  const subjects = uniqueStrings(byLocal(opf, 'subject').map((s) => s.textContent ?? '')).filter((s) => s.length < 60);

  /* manifest & spine */
  const manifest = new Map<string, { path: string; type: string; props: string }>();
  byLocal(opf, 'item').forEach((it) => {
    const id = it.getAttribute('id');
    const href = it.getAttribute('href');
    if (id && href) manifest.set(id, { path: resolveHref(base, href)[0], type: it.getAttribute('media-type') ?? '', props: it.getAttribute('properties') ?? '' });
  });
  const spineEl = byLocal(opf, 'spine')[0];
  const spine = byLocal(opf, 'itemref')
    .map((r) => ({ item: manifest.get(r.getAttribute('idref') ?? ''), linear: r.getAttribute('linear') !== 'no' }))
    .filter((s): s is { item: { path: string; type: string; props: string }; linear: boolean } => !!s.item && /html|xml/.test(s.item.type));
  if (!spine.length) throw new ImportError(`“${fileName}” has no chapters listed in its reading order.`);

  /* table of contents */
  let toc: TocEntry[] = [];
  const navItem = [...manifest.values()].find((m) => m.props.split(/\s+/).includes('nav'));
  if (navItem) {
    const t = await readText(zip, navItem.path);
    if (t) toc = parseNav(parseXhtml(t).doc, dirname(navItem.path));
  }
  if (!toc.length) {
    const ncxId = spineEl?.getAttribute('toc');
    const ncx = (ncxId && manifest.get(ncxId)) || [...manifest.values()].find((m) => m.type === 'application/x-dtbncx+xml');
    if (ncx) {
      const t = await readText(zip, ncx.path);
      if (t) {
        try {
          toc = parseNcx(xml(t, 'table of contents'), dirname(ncx.path));
        } catch {
          warnings.push("The table of contents is damaged, so chapter titles were taken from the text.");
        }
      }
    }
  }
  const tocByFile = new Map<string, TocEntry[]>();
  for (const e of toc) tocByFile.set(e.path, [...(tocByFile.get(e.path) ?? []), e]);
  const navPath = navItem?.path;

  /* cover */
  let coverItem = [...manifest.values()].find((m) => m.props.split(/\s+/).includes('cover-image'));
  if (!coverItem) {
    const coverId = byLocal(opf, 'meta').find((m) => m.getAttribute('name') === 'cover')?.getAttribute('content');
    if (coverId) coverItem = manifest.get(coverId) ?? [...manifest.values()].find((m) => m.path.endsWith(coverId));
  }
  if (!coverItem) coverItem = [...manifest.values()].find((m) => m.type.startsWith('image/') && /cover/i.test(m.path));
  let cover: ParsedNovel['cover'] = null;
  if (coverItem) {
    const f = zip.file(coverItem.path);
    if (f) cover = { mime: coverItem.type || IMAGE_TYPES[coverItem.path.split('.').pop()!.toLowerCase()] || 'image/jpeg', data: await f.async('uint8array') };
  }

  /* images referenced from chapters */
  const images: { id: string; mime: string; data: Uint8Array }[] = [];
  const imageIds = new Map<string, string>();
  let missingImages = 0;
  async function imageId(path: string): Promise<string | null> {
    if (imageIds.has(path)) return imageIds.get(path)!;
    const f = zip.file(path);
    const mime = IMAGE_TYPES[path.split('.').pop()!.toLowerCase()];
    if (!f || !mime) {
      missingImages++;
      return null;
    }
    const id = newId();
    images.push({ id, mime, data: await f.async('uint8array') });
    imageIds.set(path, id);
    return id;
  }

  /* chapters */
  const chapters: { title: string; content: string }[] = [];
  let lenientCount = 0;
  let index = 0;
  for (const { item, linear } of spine) {
    if (item.path === navPath && !tocByFile.has(item.path)) continue;
    const text = await readText(zip, item.path);
    if (text == null) {
      warnings.push(`A chapter file (${item.path.split('/').pop()}) is missing from the EPUB and was skipped.`);
      continue;
    }
    const { doc, lenient } = parseXhtml(text);
    if (lenient) lenientCount++;
    const body = doc.querySelector('body') ?? doc.body;
    if (!body) continue;
    body.querySelectorAll('script, style, nav[epub\\:type], iframe, object, embed, form').forEach((e) => e.remove());
    const dir = dirname(item.path);

    // Images: <img src> and SVG-wrapped <image xlink:href> (common for illustrations).
    for (const svg of Array.from(body.getElementsByTagName('svg'))) {
      const img = Array.from(svg.getElementsByTagName('image'))[0];
      const href = img?.getAttribute('xlink:href') ?? img?.getAttribute('href') ?? img?.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
      if (href) {
        const el = doc.createElement('img');
        el.setAttribute('src', href);
        svg.replaceWith(el);
      } else svg.remove();
    }
    const imgs = Array.from(body.getElementsByTagName('img'));
    // The cover page: the cover is shown on the novel page instead.
    if (coverItem && imgs.length === 1 && !htmlToText(body.innerHTML) && resolveHref(dir, imgs[0].getAttribute('src') ?? '')[0] === coverItem.path) continue;
    for (const img of imgs) {
      const [path] = resolveHref(dir, img.getAttribute('src') ?? '');
      const id = path ? await imageId(path) : null;
      if (id) {
        img.setAttribute('src', `notavi-blob:${id}`);
        Array.from(img.attributes).forEach((a) => a.name !== 'src' && a.name !== 'alt' && img.removeAttribute(a.name));
      } else img.remove();
    }
    markAlignment(body);

    const entries = tocByFile.get(item.path) ?? [];
    const anchored = entries
      .filter((e) => e.frag)
      .map((e) => ({ e, el: doc.getElementById(e.frag) }))
      .filter((x): x is { e: TocEntry; el: HTMLElement } => !!x.el);
    const plainEntry = entries.find((e) => !e.frag);

    const push = (title: string | undefined, html: string) => {
      const heading = html.match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i)?.[1];
      const headingText = heading ? htmlToText(heading).replace(/\s+/g, ' ').trim() : '';
      const t = title || (headingText && headingText.length < 120 ? headingText : '') || `Chapter ${index + 1}`;
      const content = sanitizeChapterHtml(stripLeadingTitle(html, t));
      if (!hasContent(content)) return;
      if (!linear && !title && htmlToText(content).length < 400) return; // ancillary pages (title page, copyright)
      chapters.push({ title: t, content });
      index++;
    };

    if (anchored.length >= 1 && !(anchored.length === 1 && isAtStart(body, anchored[0].el))) {
      const { lead, sections } = splitAt(body, anchored.map((a) => a.el));
      if (htmlToText(lead).trim()) push(plainEntry?.title, lead);
      // splitAt sorts by document order; TOC order normally matches.
      const sortedTitles = [...anchored].sort((a, b) => (a.el.compareDocumentPosition(b.el) & 4 ? -1 : 1)).map((a) => a.e.title);
      sections.forEach((html, i) => push(sortedTitles[i], html));
    } else {
      push(plainEntry?.title ?? anchored[0]?.e.title, body.innerHTML);
    }
  }

  if (!chapters.length) throw new ImportError(`“${fileName}” doesn't contain any readable chapters.`);
  if (lenientCount) warnings.push(`${lenientCount} chapter file${lenientCount === 1 ? ' was' : 's were'} malformed and read in forgiving mode; check their formatting.`);
  if (missingImages) warnings.push(`${missingImages} image${missingImages === 1 ? '' : 's'} referenced in the book couldn't be found and were left out.`);

  return {
    format: 'epub',
    title: mainTitle || fileStem(fileName) || 'Untitled',
    altTitles,
    author: authors.join(', ') || undefined,
    translator: translators.join(', ') || undefined,
    description,
    language: first('language'),
    genres: subjects.slice(0, 8),
    source: first('publisher') || first('source'),
    cover,
    images,
    chapters,
    warnings,
  };
}

/** True when nothing with text comes before `el` in `body`. */
function isAtStart(body: Element, el: Element): boolean {
  const { lead } = splitAt(body, [el]);
  return !htmlToText(lead).trim();
}
