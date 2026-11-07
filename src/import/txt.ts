import type { ParsedNovel } from '../data/model';
import { countWords, escapeHtml } from '../lib/text';
import { ImportError, decodeText, fileStem, looksBinary } from './errors';

/* ------------------------------------------------------------------ heading detection */

const NUM_WORDS =
  'one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|last|final';
const ROMAN = '[ivxlcdm]+';

type Kind = 'chapter' | 'special' | 'cjk' | 'part' | 'roman' | 'number';

const PATTERNS: { kind: Kind; re: RegExp }[] = [
  // "Chapter 12", "CHAPTER XII.", "Chapter Twelve: The Fool", "Ch. 5 - Name", "Chapter 1205 – The Sea"
  { kind: 'chapter', re: new RegExp(`^(chapter|chap\\.?|ch\\.?)\\s*(\\d+|${ROMAN}|(?:${NUM_WORDS})(?:[- ](?:${NUM_WORDS}))*)\\b[\\s.:–—-]*(.{0,120})$`, 'i') },
  { kind: 'special', re: /^(prologue|epilogue|interlude|afterword|foreword|preface|introduction|side story|extra chapter|bonus chapter|author'?s note|intermission)\b[\s.:–—-]*(.{0,120})$/i },
  { kind: 'cjk', re: /^第\s*[0-9０-９零〇一二三四五六七八九十百千万两]+\s*[章回节節话話卷]/ },
  { kind: 'part', re: new RegExp(`^(book|part|volume|vol\\.)\\s+(\\d+|${ROMAN}|${NUM_WORDS})\\b[\\s.:–—-]*(.{0,120})$`, 'i') },
  // Bare roman numerals ("XII." / "XII. THE SEA") — common in classics.
  { kind: 'roman', re: new RegExp(`^(${ROMAN})\\.?(\\s+[^a-z].{0,100})?$`, 'i') },
  // Bare numbers ("12" / "12." / "12. The Sea")
  { kind: 'number', re: /^(\d{1,4})\.?(\s+\S.{0,100})?$/ },
];

const ROMAN_VALID = /^m{0,4}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$/i;

function classify(line: string): Kind | null {
  const t = line.trim();
  if (!t || t.length > 140) return null;
  for (const p of PATTERNS) {
    const m = t.match(p.re);
    if (!m) continue;
    if (p.kind === 'roman' && !ROMAN_VALID.test(m[1])) continue;
    // A line that ends like a sentence after a long run is prose, not a heading.
    if ((p.kind === 'number' || p.kind === 'roman') && /[a-z].*[,;]$/.test(t)) continue;
    return p.kind;
  }
  return null;
}

interface Line {
  text: string;
  blankBefore: boolean;
  blankAfter: boolean;
}

/** Indices of heading lines, choosing the most trustworthy pattern family present. */
export function detectHeadings(lines: Line[]): number[] {
  const byKind = new Map<Kind, number[]>();
  lines.forEach((l, i) => {
    const k = classify(l.text);
    if (!k) return;
    // Headings stand on their own: blank line before (or start), and usually after.
    const isolated = l.blankBefore || i === 0;
    if (!isolated) return;
    if ((k === 'roman' || k === 'number') && !l.blankAfter) return;
    byKind.set(k, [...(byKind.get(k) ?? []), i]);
  });
  const get = (k: Kind) => byKind.get(k) ?? [];
  const special = get('special');
  // Prefer explicit chapter words, then CJK, then bare numerals, then parts.
  for (const k of ['chapter', 'cjk'] as Kind[]) {
    if (get(k).length >= 2) return [...get(k), ...special, ...get('part')].sort((a, b) => a - b);
  }
  for (const k of ['roman', 'number'] as Kind[]) {
    if (get(k).length >= 3) return [...get(k), ...special].sort((a, b) => a - b);
  }
  if (get('part').length >= 2) return [...get('part'), ...special].sort((a, b) => a - b);
  if (get('chapter').length === 1) return [...get('chapter'), ...special].sort((a, b) => a - b);
  return special.length >= 2 ? special : [];
}

/* ------------------------------------------------------------------ paragraphs */

const SCENE_BREAK = /^\s*([*#~=_•·◇◆-]\s*){3,}\s*$|^\s*(\*\s*){1,3}$/;

/** Turn a block of plain text into paragraphs. Hard-wrapped lines are joined. */
export function textToHtml(block: string): string {
  const chunks = block.split(/\n\s*\n/);
  const hasBlankLines = chunks.length > 1;
  const paragraphs: string[] = [];
  const units = hasBlankLines ? chunks : block.split('\n');
  for (const raw of units) {
    const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    if (lines.length === 1 && SCENE_BREAK.test(lines[0])) {
      paragraphs.push('<hr>');
      continue;
    }
    // Poetry / short-line blocks keep their line breaks; prose is joined.
    const short = lines.length > 1 && lines.every((l) => l.length < 45);
    const html = short ? lines.map(escapeHtml).join('<br>') : escapeHtml(lines.join(' '));
    paragraphs.push(`<p>${html}</p>`);
  }
  return paragraphs.join('\n');
}

/* ------------------------------------------------------------------ Project Gutenberg */

function stripGutenberg(text: string): { body: string; title?: string; author?: string; gutenberg: boolean } {
  const start = text.match(/^\*{3}\s*START OF (THE|THIS) PROJECT GUTENBERG E(BOOK|TEXT).*\*{3}\s*$/im);
  const end = text.match(/^\*{3}\s*END OF (THE|THIS) PROJECT GUTENBERG E(BOOK|TEXT).*\*{3}\s*$/im);
  if (!start) return { body: text, gutenberg: false };
  const header = text.slice(0, start.index);
  const title = header.match(/^Title:\s*(.+(?:\n {6,}.+)*)$/m)?.[1].replace(/\s+/g, ' ').trim();
  const author = header.match(/^Author:\s*(.+)$/m)?.[1].trim();
  const bodyStart = start.index! + start[0].length;
  const bodyEnd = end && end.index! > bodyStart ? end.index! : text.length;
  return { body: text.slice(bodyStart, bodyEnd), title, author, gutenberg: true };
}

/* ------------------------------------------------------------------ main */

const TARGET_WORDS = 4000;

export function parseTxt(bytes: Uint8Array, fileName: string): ParsedNovel {
  const { text: decoded, encoding } = decodeText(bytes);
  if (looksBinary(decoded)) throw new ImportError(`“${fileName}” doesn't look like a text file.`);
  const normalised = decoded.replace(/\r\n?/g, '\n').replace(/ /g, ' ').replace(/\t/g, '    ');
  const warnings: string[] = [];
  if (encoding !== 'utf-8') warnings.push(`Read as ${encoding.toUpperCase()} because the file isn't UTF-8. If accents look wrong, re-save it as UTF-8.`);

  const pg = stripGutenberg(normalised);
  const body = pg.body.trim();
  if (!body) throw new ImportError(`“${fileName}” is empty.`);
  if (pg.gutenberg) warnings.push('Removed the Project Gutenberg header and licence text. The licence is noted in the novel details.');

  const rawLines = body.split('\n');
  const lines: Line[] = rawLines.map((t, i) => ({
    text: t,
    blankBefore: i === 0 || rawLines[i - 1].trim() === '',
    blankAfter: i === rawLines.length - 1 || rawLines[i + 1].trim() === '',
  }));
  const headings = detectHeadings(lines);

  let chapters: { title: string; content: string }[] = [];
  if (headings.length) {
    const lead = rawLines.slice(0, headings[0]).join('\n').trim();
    if (countWords(lead) > 40) chapters.push({ title: 'Opening', content: textToHtml(lead) });
    headings.forEach((h, i) => {
      let title = rawLines[h].trim().replace(/\s+/g, ' ');
      let start = h + 1;
      // A heading followed by a short subtitle line ("CHAPTER I." / "THE SEA") — fold it into the title.
      const next = rawLines.slice(start).findIndex((l) => l.trim() !== '');
      if (next >= 0) {
        const cand = rawLines[start + next].trim();
        const after = rawLines[start + next + 1];
        const isSubtitle = cand.length < 70 && !/[.!?…"”’]$/.test(cand) && (after === undefined || after.trim() === '') && !headings.includes(start + next) && /^[^a-z]/.test(cand);
        if (isSubtitle && /^(chapter|chap\.?|ch\.?|[ivxlcdm]+\.?|\d+\.?)\s*[\divxlcdm]*\.?$/i.test(title)) {
          title = `${title.replace(/[.:]$/, '')}: ${cand}`;
          start = start + next + 1;
        }
      }
      const end = headings[i + 1] ?? rawLines.length;
      chapters.push({ title: tidyTitle(title), content: textToHtml(rawLines.slice(start, end).join('\n')) });
    });
    // A part/volume heading directly followed by a chapter heading has no body: fold it into the next title.
    const merged: typeof chapters = [];
    for (let i = 0; i < chapters.length; i++) {
      const c = chapters[i];
      if (!c.content.trim() && chapters[i + 1]) {
        chapters[i + 1] = { ...chapters[i + 1], title: `${c.title} — ${chapters[i + 1].title}` };
        continue;
      }
      if (c.content.trim()) merged.push(c);
    }
    chapters = merged;
  }

  if (!chapters.length) {
    chapters = splitBySize(body);
    if (chapters.length > 1) warnings.push(`No chapter headings found, so the text was split into ${chapters.length} parts of about ${TARGET_WORDS.toLocaleString('en-GB')} words. You can rename or merge them by editing chapters.`);
    else warnings.push('No chapter headings found; imported as a single chapter.');
  }

  return {
    format: 'txt',
    title: pg.title || fileStem(fileName) || 'Untitled',
    author: pg.author,
    source: pg.gutenberg ? 'Project Gutenberg' : undefined,
    chapters,
    warnings,
  };
}

function tidyTitle(t: string): string {
  // "CHAPTER XII. THE SEA" → keep, but turn shouting into title case for readability.
  if (t === t.toUpperCase() && /[A-Z]{4,}/.test(t)) {
    return t.toLowerCase().replace(/(^|[\s:—–-])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase()).replace(/\b(Ii|Iii|Iv|Vi|Vii|Viii|Ix|Xi|Xii|Xiii|Xiv|Xv|Xvi|Xvii|Xviii|Xix|Xx)\b/g, (r) => r.toUpperCase());
  }
  return t;
}

function splitBySize(body: string): { title: string; content: string }[] {
  const paras = body.split(/\n\s*\n/);
  const out: { title: string; content: string }[] = [];
  let buf: string[] = [];
  let words = 0;
  const flush = () => {
    if (!buf.length) return;
    out.push({ title: `Part ${out.length + 1}`, content: textToHtml(buf.join('\n\n')) });
    buf = [];
    words = 0;
  };
  for (const p of paras) {
    buf.push(p);
    words += countWords(p);
    if (words >= TARGET_WORDS) flush();
  }
  flush();
  if (out.length === 1) out[0].title = 'Full text';
  return out;
}
