/**
 * Web-novel layout: turns the sections of one or more imported books into a
 * flat, continuously numbered chapter list, the way web novels are read.
 *
 * The one rule this module must never break: chapter text is passed through
 * untouched. Sections may be split (at chapter headings), joined (opener
 * pages, text split across files) or set aside (copyright pages, contents),
 * but every word is accounted for, and `auditPlan` proves it.
 */
import type { NewChapter, ParsedSection } from '../data/model';
import { countWords, htmlToText, newId } from '../lib/text';
import { fragmentToHtml, cloneBetween } from './dom';

export type PlanKind = 'chapter' | 'special' | 'extra' | 'front' | 'back';

export const KIND_LABEL: Record<PlanKind, string> = {
  chapter: 'Chapter',
  special: 'Story extra',
  extra: 'Author’s extra',
  front: 'Front matter',
  back: 'Back matter',
};

export interface PlanItem {
  id: string;
  kind: PlanKind;
  include: boolean;
  /** Title as it will be stored. */
  title: string;
  /** Title as found in the book (before web-style renumbering). */
  originalTitle: string;
  content: string;
  /** Heading text taken out of the content to become the title (only when a section is split at a heading). */
  movedHeading: string;
  /** The heading's original HTML, so it can be put back exactly if the user joins this item onto another. */
  movedHtml: string;
  /** A title the user typed; overrides automatic titles. */
  customTitle?: string;
  words: number;
  number: number | null;
  /** Which file/volume it came from. */
  origin: string;
  /** Human-readable notes about what was done ("Joined its opener page"). */
  notes: string[];
  titleFrom: ParsedSection['titleFrom'];
}

export interface Volume {
  label: string;
  sections: ParsedSection[];
}

export interface PlanOptions {
  /** Retitle chapters "Chapter N: Name", numbered continuously across volumes. */
  webTitles: boolean;
  /** Number to give the first chapter (e.g. to continue an existing novel). */
  startNumber: number;
}

/* ------------------------------------------------------------------ title analysis */

const WORD_NUMS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30,
  forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const WORD_NUM_RE = Object.keys(WORD_NUMS).join('|');
const ROMAN_RE = /^(?=[mdclxvi])m{0,4}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$/i;

function romanToInt(r: string): number {
  const v: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
  let total = 0;
  const s = r.toLowerCase();
  for (let i = 0; i < s.length; i++) {
    const a = v[s[i]];
    const b = v[s[i + 1]] ?? 0;
    total += a < b ? -a : a;
  }
  return total;
}

function wordsToInt(w: string): number | null {
  const parts = w.toLowerCase().split(/[\s-]+/);
  let n = 0;
  for (const p of parts) {
    if (!(p in WORD_NUMS)) return null;
    n += WORD_NUMS[p];
  }
  return n;
}

export interface TitleParts {
  /** Chapter number found in the title, if any. */
  number: number | null;
  /** Name without numbering ("The Fool"). */
  name: string;
  /** True if the title looks like a chapter title at all. */
  chapterLike: boolean;
}

/** "Chapter 12: The Fool" → { 12, "The Fool" }; "XII. The Sea" → { 12, "The Sea" }; "第12章 名" → { 12, "名" }. */
export function parseTitle(raw: string): TitleParts {
  const t = raw.replace(/\s+/g, ' ').trim();
  const sep = String.raw`\s*(?:[:.\-–—)|]\s*|\s+|$)`;
  let m = t.match(new RegExp(String.raw`^(?:chapter|chap\.?|ch\.?|episode|ep\.?|stave)\s*(\d+|[ivxlcdm]+|(?:${WORD_NUM_RE})(?:[\s-](?:${WORD_NUM_RE}))*)\b${sep}(.*)$`, 'i'));
  if (m) {
    const n = /^\d+$/.test(m[1]) ? Number(m[1]) : ROMAN_RE.test(m[1]) ? romanToInt(m[1]) : wordsToInt(m[1]);
    return { number: n, name: m[2].trim(), chapterLike: true };
  }
  m = t.match(/^第\s*([0-9０-９]+|[零〇一二三四五六七八九十百千万两]+)\s*[章回话話节節]\s*(.*)$/);
  if (m) {
    const digits = m[1].replace(/[０-９]/g, (d) => String(d.charCodeAt(0) - 0xff10));
    return { number: /^\d+$/.test(digits) ? Number(digits) : null, name: m[2].trim(), chapterLike: true };
  }
  // Bare numbers/roman numerals need a separator or nothing after them ("12 - The Fool", "XII.", "12").
  m = t.match(/^(\d{1,5}|[ivxlcdm]{1,7})(?:\s*[:.\-–—)|]\s*(.*)|\s*$)/i);
  if (m && (/^\d+$/.test(m[1]) || ROMAN_RE.test(m[1]))) {
    return { number: /^\d+$/.test(m[1]) ? Number(m[1]) : romanToInt(m[1]), name: (m[2] ?? '').trim(), chapterLike: true };
  }
  return { number: null, name: t, chapterLike: false };
}

const FRONT_RE = /^(cover|title( page)?|half[- ]?title|copyright|(table of )?contents|toc|dedication|epigraph|also by|other (books|titles|works) by|praise for|about this (e?book)|frontispiece|front ?matter|newsletter|sign[- ]?up|insert|colou?r (illustrations?|inserts?|plates?|pages?)|maps?|cast of characters|character (list|guide)|dramatis personae)\b/i;
const BACK_RE = /^(about the (author|translator|illustrator|artist|publisher)|acknowledge?ments?|thank you for (reading|buying|purchasing)|newsletter|also (available|by)|coming soon|(sneak )?preview|back ?matter|colophon|credits|join (our|the)|follow (us|the author)|discover more|get (the|our) latest|read more from|copyright)\b/i;
const SPECIAL_RE = /^(prologue|epilogue|interlude|intermission|side story|side chapter|extra( chapter)?|bonus( chapter)?|special( chapter)?|chapter 0\b|another side)/i;
const AUTHOR_EXTRA_RE = /^(afterword|author'?s?’?s? (note|afterword|words?)|translator'?s?’?s? (note|afterword)|foreword|preface|introduction|glossary|appendix|illustrations?|character (profiles?|sheets?)|volume \d+ (afterword|illustrations))/i;
const VOLUME_RE = /^(volume|vol\.|book|part|arc)\s+(\d+|[ivxlcdm]+|(?:one|two|three|four|five|six|seven|eight|nine|ten))\b/i;

/* ------------------------------------------------------------------ splitting at in-text chapter headings */

const BLOCKS = 'h1, h2, h3, h4, p, div';

function isInlineChapterHeading(el: Element): boolean {
  const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  if (!text || text.length > 90) return false;
  if (el.querySelector('p, div, h1, h2, h3, h4, img')) return false;
  const tag = el.tagName.toLowerCase();
  const p = parseTitle(text);
  // A heading tag that reads like a chapter title, or a standalone paragraph that says "Chapter N".
  if (/^h[1-4]$/.test(tag)) return (p.chapterLike && /^(chapter|chap|ch|episode|ep|stave|第)/i.test(text)) || SPECIAL_RE.test(text);
  return /^(chapter|chap\.?|episode|第)/i.test(text) && p.chapterLike && !/[,;]$/.test(text);
}

/** Split a section that holds several chapters (common in converted ebooks) at its chapter headings. */
function splitAtChapterHeadings(section: { title: string; content: string }): { title: string; content: string; movedHeading: string; movedHtml: string }[] | null {
  if (!/chapter|chap|episode|第|prologue|epilogue|interlude|side story/i.test(section.content)) return null;
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${section.content}</body>`, 'text/html');
  const body = doc.body;
  const heads = Array.from(body.querySelectorAll(BLOCKS)).filter(isInlineChapterHeading);
  if (!heads.length) return null;
  const { lead, sections } = splitAt(body, heads);
  const out: { title: string; content: string; movedHeading: string; movedHtml: string }[] = [];
  if (htmlToText(lead).trim() || /<img/i.test(lead)) out.push({ title: section.title, content: lead.trim(), movedHeading: '', movedHtml: '' });
  sections.forEach((html, i) => {
    const h = heads[i];
    const headHtml = h.outerHTML;
    const headText = (h.textContent ?? '').replace(/\s+/g, ' ').trim();
    // The section starts with the heading element itself; take it out, it becomes the title.
    let rest = html.startsWith(headHtml) ? html.slice(headHtml.length) : html.replace(headHtml, '');
    let moved = headText;
    let movedHtml = headHtml;
    let title = headText;
    // "Chapter 12" followed by a short subtitle heading ("The Fool"): fold it into the title too.
    const sub = rest.match(/^\s*<(h[1-6])[^>]*>([\s\S]*?)<\/\1>/i);
    if (sub && parseTitle(headText).name === '') {
      const subText = htmlToText(sub[2]).replace(/\s+/g, ' ').trim();
      if (subText && subText.length < 80) {
        title = `${headText}: ${subText}`;
        moved = `${headText} ${subText}`;
        movedHtml = headHtml + sub[0].trim();
        rest = rest.slice(rest.indexOf(sub[0]) + sub[0].length);
      }
    }
    out.push({ title, content: rest.trim(), movedHeading: moved, movedHtml });
  });
  return out.length > 1 || out[0]?.movedHeading ? out : null;
}

function splitAt(root: Element, markers: Element[]) {
  // Local copy of dom.splitAt that keeps document order (markers already are).
  const lead = fragmentToHtml(cloneBetween(root, null, markers[0]));
  const sections = markers.map((m, i) => fragmentToHtml(cloneBetween(root, m, markers[i + 1] ?? null)));
  return { lead, sections };
}

/* ------------------------------------------------------------------ planning */

const words = (html: string) => countWords(htmlToText(html));
const isEmpty = (html: string) => !htmlToText(html).trim() && !/<img/i.test(html);

function joinHtml(a: string, b: string): string {
  if (!a.trim()) return b;
  if (!b.trim()) return a;
  return `${a}\n${b}`;
}

/** Build the default arrangement for one or more volumes. */
export function planLayout(volumes: Volume[], opts: PlanOptions): PlanItem[] {
  const items: PlanItem[] = [];
  for (const vol of volumes) {
    // 1. Split sections that contain several chapters.
    const pieces: (ParsedSection & { movedHeading: string; movedHtml: string; notes: string[] })[] = [];
    for (const s of vol.sections) {
      const split = s.role === 'toc' ? null : splitAtChapterHeadings(s);
      if (split) {
        split.forEach((p, i) =>
          pieces.push({
            ...s,
            title: p.title,
            content: p.content,
            movedHeading: p.movedHeading,
            movedHtml: p.movedHtml,
            titleFrom: p.movedHeading ? 'heading' : s.titleFrom,
            notes: split.length > 1 ? [`Split from a section holding ${split.length} parts`] : i === 0 ? [] : [],
          }),
        );
      } else pieces.push({ ...s, movedHeading: '', movedHtml: '', notes: [] });
    }

    // 2. Join chapter-opener pages to their text, and text that a converter split across files.
    const anyTitled = pieces.some((p) => p.titleFrom === 'toc' || p.titleFrom === 'heading');
    const joined: typeof pieces = [];
    for (let i = 0; i < pieces.length; i++) {
      const p = pieces[i];
      const prev = joined[joined.length - 1];
      const next = pieces[i + 1];
      const tp = parseTitle(p.title);
      const opener = (tp.chapterLike || SPECIAL_RE.test(p.title)) && !VOLUME_RE.test(p.title) && words(p.content) < 15 && !/<img/i.test(p.content) && next && next.role !== 'toc';
      if (opener && (next.titleFrom === 'generated' || parseTitle(next.title).name === tp.name || next.title === p.title)) {
        // Opener page + the following text become one chapter.
        pieces[i + 1] = {
          ...next,
          title: p.title,
          titleFrom: p.titleFrom,
          content: joinHtml(p.content, joinMoved(next)),
          movedHeading: p.movedHeading,
          movedHtml: p.movedHtml,
          notes: [...p.notes, ...next.notes, 'Joined its chapter-opener page'],
        };
        continue;
      }
      if (anyTitled && p.titleFrom === 'generated' && prev && prev.role !== 'toc' && !isEmpty(p.content)) {
        prev.content = joinHtml(prev.content, joinMoved(p));
        if (!prev.notes.includes('Re-joined text that was split across files')) prev.notes.push('Re-joined text that was split across files');
        continue;
      }
      joined.push({ ...p });
    }

    // 3. Classify.
    const firstStory = joined.findIndex((p) => isStoryish(p));
    let lastStory = -1;
    joined.forEach((p, i) => isStoryish(p) && (lastStory = i));
    joined.forEach((p, i) => {
      const kind = classify(p, i, firstStory, lastStory);
      items.push({
        id: newId(),
        kind,
        include: kind !== 'front' && kind !== 'back',
        title: p.title,
        originalTitle: p.title,
        content: p.content,
        movedHeading: p.movedHeading,
        movedHtml: p.movedHtml,
        words: words(p.content),
        number: null,
        origin: vol.label,
        notes: p.notes,
        titleFrom: p.titleFrom,
      });
    });
  }
  return renumber(items, opts);
}

/** When an item is appended to another, any heading it had moved out goes back, exactly as it was, in front of its content. */
function joinMoved(p: { movedHtml: string; content: string }): string {
  return p.movedHtml ? joinHtml(p.movedHtml, p.content) : p.content;
}

function isStoryish(p: ParsedSection): boolean {
  if (p.role === 'front' || p.role === 'back' || p.role === 'toc') return false;
  if (FRONT_RE.test(p.title) || BACK_RE.test(p.title) || AUTHOR_EXTRA_RE.test(p.title)) return false;
  return parseTitle(p.title).chapterLike || SPECIAL_RE.test(p.title) || words(p.content) >= 400;
}

function classify(p: ParsedSection, i: number, firstStory: number, lastStory: number): PlanKind {
  const w = words(p.content);
  if (p.role === 'toc') return 'front';
  if (SPECIAL_RE.test(p.title)) return 'special';
  if (AUTHOR_EXTRA_RE.test(p.title)) return 'extra';
  if (FRONT_RE.test(p.title) && (i <= firstStory || firstStory < 0)) return 'front';
  if (BACK_RE.test(p.title) && i >= lastStory) return 'back';
  if (FRONT_RE.test(p.title) || BACK_RE.test(p.title)) return i < firstStory ? 'front' : 'back';
  if (p.role === 'front') return 'front';
  if (p.role === 'back') return 'back';
  if (VOLUME_RE.test(p.title) && w < 60) return 'front';
  if (parseTitle(p.title).chapterLike) return 'chapter';
  // Untitled or oddly titled: by position and size.
  if (firstStory >= 0 && i < firstStory && w < 400) return 'front';
  if (lastStory >= 0 && i > lastStory && w < 400) return 'back';
  return 'chapter';
}

/** Apply numbering and (optionally) web-style titles. Called again whenever the user changes the plan. */
export function renumber(items: PlanItem[], opts: PlanOptions): PlanItem[] {
  let n = opts.startNumber;
  return items.map((it) => {
    if (it.kind !== 'chapter' || !it.include) return { ...it, number: null, title: it.customTitle ?? it.originalTitle };
    const number = n++;
    if (it.customTitle) return { ...it, number, title: it.customTitle };
    if (!opts.webTitles) return { ...it, number, title: it.originalTitle };
    const parts = parseTitle(it.originalTitle);
    const name = parts.chapterLike ? parts.name : it.titleFrom === 'generated' ? '' : it.originalTitle;
    return { ...it, number, title: name ? `Chapter ${number}: ${name}` : `Chapter ${number}` };
  });
}

/** Join an item onto the previous one (user action). */
export function mergeWithPrevious(items: PlanItem[], id: string, opts: PlanOptions): PlanItem[] {
  const i = items.findIndex((x) => x.id === id);
  if (i <= 0) return items;
  const prev = items[i - 1];
  const cur = items[i];
  const merged: PlanItem = {
    ...prev,
    content: joinHtml(prev.content, joinMoved(cur)),
    words: countWords(htmlToText(joinHtml(prev.content, joinMoved(cur)))),
    notes: [...prev.notes, `Joined “${cur.originalTitle}”`],
  };
  return renumber([...items.slice(0, i - 1), merged, ...items.slice(i + 1)], opts);
}

/* ------------------------------------------------------------------ audit */

function tokens(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

export interface Audit {
  ok: boolean;
  sourceWords: number;
  keptWords: number;
  setAsideWords: number;
  setAside: { title: string; words: number }[];
  /** Index of the first differing word, if the check failed. */
  mismatchAt?: number;
}

/**
 * Prove that nothing was lost or altered: the words of every source section, in
 * order, must equal the words of the planned items (including set-aside ones),
 * in order, with headings that were moved into titles counted where they were.
 */
export function auditPlan(volumes: Volume[], items: PlanItem[]): Audit {
  const src = volumes.flatMap((v) => v.sections.flatMap((s) => tokens(htmlToText(s.content))));
  const out = items.flatMap((it) => [...tokens(it.movedHeading), ...tokens(htmlToText(it.content))]);
  let mismatchAt: number | undefined;
  const len = Math.max(src.length, out.length);
  for (let i = 0; i < len; i++) {
    if (src[i] !== out[i]) {
      mismatchAt = i;
      break;
    }
  }
  const setAside = items.filter((it) => !it.include).map((it) => ({ title: it.originalTitle, words: countWords(htmlToText(it.content)) }));
  const setAsideWords = setAside.reduce((s, x) => s + x.words, 0);
  return {
    ok: mismatchAt === undefined,
    sourceWords: src.length,
    keptWords: src.length - setAsideWords,
    setAsideWords,
    setAside,
    mismatchAt,
  };
}

/**
 * Should web-novel titles be on by default? Yes when the book already names its chapters
 * "Chapter …" (renumbering only tidies them); no for books with their own naming ("Stave I").
 */
export function suggestWebTitles(volumes: Volume[]): boolean {
  const titled = volumes.flatMap((v) => v.sections).filter((s) => parseTitle(s.title).chapterLike);
  if (titled.length < 2) return false;
  const chapterWord = titled.filter((s) => /^(chapter|chap\.?|ch\.)\s/i.test(s.title.trim())).length;
  return chapterWord / titled.length >= 0.8;
}

/** Pick the first chapter number when adding to an existing novel. */
export function nextChapterNumber(existingTitles: string[]): number {
  let max = 0;
  for (const t of existingTitles) {
    const p = parseTitle(t);
    if (p.number !== null && p.number > max) max = p.number;
  }
  return Math.max(max, 0) + 1;
}

/** Guess a volume number from a book title or file name, for ordering volumes. */
export function volumeNumber(label: string): number | null {
  const m = label.match(/(?:vol(?:ume)?|book|part)\.?\s*(\d+)/i) ?? label.match(/(\d+)\s*(?:\.\w+)?$/);
  return m ? Number(m[1]) : null;
}

/** Items to store, in order: included ones only. Moved headings become titles, so content is stored as-is. */
/**
 * The chapters to store. Set-aside items are kept too, as book-only chapters, so the novel can still be read
 * as the original book (title page, copyright, contents and all); the book's own titles are kept alongside.
 */
export function chaptersFromPlan(items: PlanItem[]): NewChapter[] {
  return items.map((it) => {
    const title = it.title.trim() || 'Untitled';
    const original = (it.originalTitle || it.movedHeading || '').trim();
    return { title, content: it.content, bookOnly: !it.include, originalTitle: original && original !== title ? original : undefined };
  });
}
