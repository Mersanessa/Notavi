/** Text helpers shared by importers, repositories and the reader. */

export function newId(): string {
  const c = globalThis.crypto as Crypto;
  if (typeof c.randomUUID === 'function') return c.randomUUID();
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', sbquo: '‚', bdquo: '„', copy: '©', reg: '®', trade: '™',
  middot: '·', bull: '•', laquo: '«', raquo: '»', shy: '', thinsp: ' ', ensp: ' ', emsp: ' ',
  zwnj: '', zwj: '', eacute: 'é', egrave: 'è', aacute: 'á', agrave: 'à', ouml: 'ö', uuml: 'ü', auml: 'ä',
  szlig: 'ß', ccedil: 'ç', ntilde: 'ñ', deg: '°', sect: '§', para: '¶', dagger: '†', times: '×',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try {
        return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : m;
      } catch {
        return m;
      }
    }
    return NAMED[e] ?? NAMED[e.toLowerCase()] ?? m;
  });
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const BLOCK_RE = /<\/?(p|div|br|h[1-6]|li|ul|ol|blockquote|section|article|tr|hr|pre|figure|figcaption|table)\b[^>]*>/gi;

/** Fast, DOM-free HTML → plain text (search index, word counts). */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '')
      .replace(BLOCK_RE, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/[ \t\f\r ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

const CJK_RE = /[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯]/g;

/** Word count. CJK characters count individually. */
export function countWords(text: string): number {
  const cjk = text.match(CJK_RE)?.length ?? 0;
  const words = text.replace(CJK_RE, ' ').match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)?.length ?? 0;
  return words + cjk;
}

export const DEFAULT_WPM = 230;

export function readingMinutes(words: number, wpm = DEFAULT_WPM): number {
  return Math.max(1, Math.round(words / Math.max(60, wpm)));
}

export function formatMinutes(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function formatDuration(ms: number): string {
  if (ms <= 0) return '0 min';
  const min = Math.round(ms / 60000);
  return min < 1 ? 'under a minute' : formatMinutes(min);
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat().format(n);
}

export function sortKey(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .replace(/^(the|a|an)\s+/i, '')
    .toLowerCase();
}

export function formatDate(ts: number | null | undefined, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString(undefined, opts);
}

export function relativeTime(ts: number | null | undefined, now = Date.now()): string {
  if (!ts) return 'never';
  const min = Math.round((now - ts) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d} days ago`;
  return formatDate(ts);
}

/** Local calendar day as YYYY-MM-DD. */
export function localDay(ts = Date.now()): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function uniqueStrings(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const v = raw.replace(/\s+/g, ' ').trim();
    const k = v.toLowerCase();
    if (v && !seen.has(k)) {
      seen.add(k);
      out.push(v);
    }
  }
  return out;
}

export function splitList(s: string): string[] {
  return uniqueStrings(s.split(/[,;\n]/));
}

/**
 * Turn free text into a safe FTS5 query. Every term is quoted so operators and
 * punctuation can't break it; the last bare term gets a prefix match so results
 * appear while typing. "Quoted phrases" stay phrases.
 */
export function toFtsQuery(input: string): string {
  const parts: { text: string; phrase: boolean }[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input))) {
    const phrase = m[1] !== undefined;
    const cleaned = (m[1] ?? m[2]).replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
    if (cleaned) parts.push({ text: cleaned, phrase });
  }
  const out: string[] = [];
  parts.forEach((p, i) => {
    if (p.phrase) {
      out.push(`"${p.text}"`);
      return;
    }
    const terms = p.text.split(' ');
    terms.forEach((t, j) => {
      const last = i === parts.length - 1 && j === terms.length - 1;
      out.push(last ? `"${t}"*` : `"${t}"`);
    });
  });
  return out.join(' ');
}

/** A stable small hash, used for generated cover colours. */
export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
