import { marked } from 'marked';
import type { ParsedNovel } from '../data/model';
import { countWords, htmlToText, newId, uniqueStrings } from '../lib/text';
import { hasContent, markAlignment, parseHtmlDocument, sanitizeChapterHtml, splitAt, stripLeadingTitle } from './dom';
import { ImportError, decodeText, fileStem, looksBinary } from './errors';

type Image = { id: string; mime: string; data: Uint8Array };

function dataUriToImage(uri: string): Image | null {
  const m = uri.match(/^data:(image\/(png|jpe?g|gif|webp|avif|svg\+xml));base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!m || m[1].includes('svg')) return null;
  try {
    const bin = atob(m[3].replace(/\s+/g, ''));
    const data = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
    return { id: newId(), mime: m[1].toLowerCase(), data };
  } catch {
    return null;
  }
}

/** Split an HTML document into chapters at its main heading level. */
export function htmlDocToNovel(doc: Document, fileName: string, format: 'html' | 'markdown', meta: Partial<ParsedNovel> = {}): ParsedNovel {
  const warnings: string[] = [];
  const body = doc.body;
  if (!body) throw new ImportError(`“${fileName}” has no readable content.`);
  body.querySelectorAll('script, style, noscript, nav, iframe, object, embed, form, template').forEach((e) => e.remove());

  // Inline images (data: URIs) can be kept; external ones can't — files are imported offline.
  const images: Image[] = [];
  let dropped = 0;
  body.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src') ?? '';
    const parsed = src.startsWith('data:') ? dataUriToImage(src) : null;
    if (parsed) {
      images.push(parsed);
      img.setAttribute('src', `notavi-blob:${parsed.id}`);
    } else {
      dropped++;
      img.remove();
    }
  });
  if (dropped) warnings.push(`${dropped} image${dropped === 1 ? '' : 's'} pointing outside the file couldn't be imported.`);
  markAlignment(body);

  const count = (sel: string) => body.querySelectorAll(sel).length;
  const docTitle = (meta.title || doc.querySelector('title')?.textContent || '').trim();
  let level: string | null = null;
  let bookTitle = docTitle;
  if (count('h1') >= 2) level = 'h1';
  else if (count('h2') >= 2) level = 'h2';
  else if (count('h3') >= 2) level = 'h3';
  if (level !== 'h1' && count('h1') === 1) {
    const h1 = body.querySelector('h1')!;
    bookTitle ||= h1.textContent?.trim() ?? '';
    if (level) h1.remove();
  }

  const chapters: { title: string; content: string }[] = [];
  if (level) {
    const headings = Array.from(body.querySelectorAll(level));
    const { lead, sections } = splitAt(body, headings);
    if (countWords(htmlToText(lead)) > 40) chapters.push({ title: 'Opening', content: sanitizeChapterHtml(lead) });
    sections.forEach((html, i) => {
      const title = headings[i].textContent?.replace(/\s+/g, ' ').trim() || `Chapter ${i + 1}`;
      const content = sanitizeChapterHtml(stripLeadingTitle(html, title));
      if (hasContent(content)) chapters.push({ title, content });
    });
  } else {
    const content = sanitizeChapterHtml(body.innerHTML);
    if (hasContent(content)) chapters.push({ title: bookTitle || fileStem(fileName), content: stripLeadingTitle(content, bookTitle) });
    warnings.push('No chapter headings found; imported as a single chapter.');
  }
  if (!chapters.length) throw new ImportError(`“${fileName}” has no readable text.`);

  const author = meta.author || doc.querySelector('meta[name="author" i]')?.getAttribute('content')?.trim() || undefined;
  const description = meta.description || doc.querySelector('meta[name="description" i]')?.getAttribute('content')?.trim() || undefined;
  const keywords = doc.querySelector('meta[name="keywords" i]')?.getAttribute('content');
  return {
    format,
    title: bookTitle || fileStem(fileName) || 'Untitled',
    author,
    description,
    language: meta.language || doc.documentElement.getAttribute('lang') || undefined,
    tags: uniqueStrings([...(meta.tags ?? []), ...(keywords ? keywords.split(',') : [])]),
    genres: meta.genres,
    chapters,
    images,
    warnings,
  };
}

export function parseHtmlFile(bytes: Uint8Array, fileName: string): ParsedNovel {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 2048));
  const declared = head.match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1];
  const { text } = decodeText(bytes, declared);
  if (looksBinary(text)) throw new ImportError(`“${fileName}” doesn't look like an HTML file.`);
  if (!/<\s*(html|body|p|div|h[1-6]|br)\b/i.test(text)) throw new ImportError(`“${fileName}” doesn't contain any HTML. Rename it to .txt to import it as plain text.`);
  return htmlDocToNovel(parseHtmlDocument(text), fileName, 'html');
}

/* ------------------------------------------------------------------ Markdown */

function parseFrontMatter(md: string): { body: string; meta: Partial<ParsedNovel> } {
  const m = md.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
  if (!m) return { body: md, meta: {} };
  const meta: Partial<ParsedNovel> = {};
  const list = (v: string) => uniqueStrings(v.replace(/^\[|\]$/g, '').split(',').map((s) => s.replace(/^["']|["']$/g, '')));
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1].toLowerCase();
    const val = kv[2].trim().replace(/^["']|["']$/g, '');
    if (key === 'title') meta.title = val;
    else if (key === 'author') meta.author = val;
    else if (key === 'translator') meta.translator = val;
    else if (key === 'description' || key === 'summary') meta.description = val;
    else if (key === 'language' || key === 'lang') meta.language = val;
    else if (key === 'tags') meta.tags = list(val);
    else if (key === 'genres' || key === 'genre') meta.genres = list(val);
  }
  return { body: md.slice(m[0].length), meta };
}

export function parseMarkdown(bytes: Uint8Array, fileName: string): ParsedNovel {
  const { text } = decodeText(bytes);
  if (looksBinary(text)) throw new ImportError(`“${fileName}” doesn't look like a Markdown file.`);
  if (!text.trim()) throw new ImportError(`“${fileName}” is empty.`);
  const { body, meta } = parseFrontMatter(text.replace(/\r\n?/g, '\n'));
  const html = marked.parse(body, { async: false, gfm: true, breaks: false }) as string;
  const doc = parseHtmlDocument(`<!doctype html><html><head><title></title></head><body>${html}</body></html>`);
  const parsed = htmlDocToNovel(doc, fileName, 'markdown', meta);
  parsed.translator = meta.translator;
  return parsed;
}
