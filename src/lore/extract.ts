/**
 * Lore extraction: finds the names and terms in a novel (characters, places, organisations, things)
 * and what the text itself says about them, without any AI and without leaving the device.
 *
 * How it works:
 *  1. Every chapter is read once. Runs of Capitalised words become candidate names; for each we count
 *     mentions per chapter, note clues to what kind of thing it is ("said X" → a person, "in X" → a
 *     place, "X Church" → an organisation), the book's own descriptions ("X, a member of the …"), and
 *     which names share a paragraph.
 *  2. Across the whole novel, a word counts as part of a name only if it is capitalised mid-sentence far
 *     more often than not, which filters out ordinary words that merely start a sentence.
 *  3. Forms are grouped (a first name joins the full name it belongs to), classified and linked.
 *
 * Everything is stored per chapter, so what is shown can be cut off exactly where the reader is:
 * no counts, descriptions or connections from chapters not yet read (see view.ts).
 */

export const LORE_VERSION = 1;

export type LoreKind = 'character' | 'place' | 'organisation' | 'term';

export const LORE_KINDS: { value: LoreKind; label: string; plural: string }[] = [
  { value: 'character', label: 'Character', plural: 'Characters' },
  { value: 'place', label: 'Place', plural: 'Places' },
  { value: 'organisation', label: 'Organisation', plural: 'Organisations' },
  { value: 'term', label: 'Term', plural: 'Terms and things' },
];

/* ------------------------------------------------------------------ vocab */

const STOP = new Set(
  `i a an the and or but if then so yet nor for of to in on at by with from into onto upon over under after before about above below
  he she it they we you me him her them us his hers its their our your my mine yours theirs ours this that these those there here
  what which who whom whose when where why how all any both each few more most other some such no not only own same than too very
  can will just should now also even still again ever never always perhaps maybe however although though because while once since
  until unless whether well oh ah yes yeah okay ok hmm huh hey wow alas indeed meanwhile suddenly finally afterwards anyway besides
  one two three four five six seven eight nine ten first second third last next everyone everything someone something nobody nothing
  anyone anything mr mrs ms miss sir madam lady lord dear chapter part book volume prologue epilogue interlude afterword foreword
  monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september october
  november december god goodness heavens damn hello goodbye thanks thank please sorry let do does did done is are was were be been
  being have has had having get got go went come came say said see saw look looked know knew think thought want wanted like`
    .split(/\s+/)
    .filter(Boolean),
);

const HONORIFICS = new Set(
  `mr mrs ms miss sir lady lord madam madame master mistress captain doctor dr professor saint st king queen prince princess duke duchess
  count countess earl baron baroness general colonel major lieutenant sergeant inspector detective officer father bishop cardinal pope
  emperor empress elder senior junior uncle aunt grandpa grandma granny brother sister young old`
    .split(/\s+/)
    .filter(Boolean),
);
const ABBREV = new Set(['mr', 'mrs', 'ms', 'dr', 'st', 'prof', 'gen', 'col', 'capt', 'lt', 'sgt', 'jr', 'sr', 'vs', 'etc']);
const CONNECTORS = new Set(['of', 'the', 'de', 'von', 'van', 'der', 'den', 'du', 'la', 'le', 'al', 'bin', 'el', 'di', 'da', 'and']);
const PLACE_WORDS = new Set(
  `city town village kingdom empire republic street road avenue lane island islands isle sea ocean river mountain mountains mount forest
  valley continent coast shore bay port harbour harbor castle palace tower district borough province county village desert lake realm
  region plains plain ruins temple cathedral square bridge hall academy manor estate gate gates woods wood hills hill peninsula strait
  cape canyon cave caves fortress citadel garden gardens park station market dock docks quarter ward land lands world plane domain
  marsh swamp tundra wastes wasteland abyss underworld`
    .split(/\s+/)
    .filter(Boolean),
);
const ORG_WORDS = new Set(
  `church order society club company guild clan association council army navy bureau department ministry party brotherhood sisterhood
  sect legion cult school university college bank team corps knights pirates alliance federation union institute agency court senate
  parliament crew gang syndicate family house dynasty cabinet committee foundation hospital church`
    .split(/\s+/)
    .filter(Boolean),
);
const PLACE_PREP = new Set(['in', 'at', 'to', 'from', 'into', 'towards', 'toward', 'near', 'across', 'through', 'inside', 'outside', 'around', 'reach', 'reached', 'visit', 'visited', 'leave', 'left', 'entered', 'enter', 'arrived', 'beyond', 'within']);
const SPEECH = new Set(
  `said says asked asks replied replies answered whispered shouted yelled cried muttered murmured exclaimed sighed laughed smiled nodded
  frowned grinned shrugged thought glanced stared looked turned walked smirked chuckled snorted growled hissed added continued explained
  admitted insisted interrupted remarked responded called told warned promised wondered realised realized noticed felt knew wanted`
    .split(/\s+/)
    .filter(Boolean),
);

/* ------------------------------------------------------------------ text */

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', mdash: '—', ndash: '–', hellip: '…' };
function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Chapter HTML → paragraphs of plain text (no DOM needed, so it runs in a worker and in tests). */
export function paragraphs(html: string): string[] {
  return decode(
    html
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '')
      .replace(/<\/(p|div|h[1-6]|li|blockquote|pre|tr|dt|dd|figcaption|section|article)>|<br\s*\/?>|<hr\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .split('\n')
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

interface Tok {
  w: string; // the word without a possessive ending
  s: number; // start offset in the paragraph
  e: number; // end offset
  cap: boolean;
  init: boolean; // first word of a sentence
  poss: boolean; // ended in 's / ’s
  punct: string; // punctuation right after (",", ".", …) or ''
}

const WORD_RE = /[\p{L}\p{M}][\p{L}\p{M}\p{N}'’-]*/gu;

function tokenise(p: string): Tok[] {
  const out: Tok[] = [];
  let m: RegExpExecArray | null;
  let sentenceStart = true;
  WORD_RE.lastIndex = 0;
  while ((m = WORD_RE.exec(p))) {
    let w = m[0];
    const s = m.index;
    let e = s + w.length;
    // Anything between the previous word and this one decides whether a new sentence began.
    const gap = p.slice(out.length ? out[out.length - 1].e : 0, s);
    if (out.length) {
      const prev = out[out.length - 1];
      if (/[.!?…]/.test(gap) && !(ABBREV.has(prev.w.toLowerCase()) && /^\.\s*$/.test(gap))) sentenceStart = true;
      prev.punct = gap.trim().charAt(0);
    }
    let poss = false;
    const pm = w.match(/['’]s$/i);
    if (pm) {
      w = w.slice(0, -2);
      poss = true;
    } else if (/['’]$/.test(w)) {
      w = w.slice(0, -1);
      e -= 1;
    }
    w = w.replace(/-+$/, '');
    if (!w) continue;
    const first = w.charAt(0);
    const cap = first !== first.toLowerCase() && !(w.length > 1 && w === w.toUpperCase());
    out.push({ w, s, e, cap, init: sentenceStart, poss, punct: '' });
    sentenceStart = false;
  }
  if (out.length) out[out.length - 1].punct = p.slice(out[out.length - 1].e).trim().charAt(0);
  return out;
}

/* ------------------------------------------------------------------ per chapter */

export interface RawOcc {
  /** Mentions in this chapter. */
  n: number;
  /** …of which at the start of a sentence (weak evidence it's a name). */
  init: number;
  char: number;
  place: number;
  /** …preceded by "the" (people's names rarely are). */
  the: number;
}

export interface ChapterScan {
  pos: number;
  /** Capitalised-word sequences seen, keyed by their text. */
  seqs: Map<string, RawOcc>;
  /** Paragraph index → sequences in it (only paragraphs with two or more). */
  together: [number, string[]][];
  /** [sequence, paragraph index, text] — the book's own descriptions. */
  desc: [string, number, string][];
  /** Word statistics for deciding what is a name. */
  capMid: Map<string, number>;
  capInit: Map<string, number>;
  lower: Map<string, number>;
}

const bump = (m: Map<string, number>, k: string, by = 1) => m.set(k, (m.get(k) ?? 0) + by);

/** Read one chapter (or the first `maxParagraphs` paragraphs of it). */
export function scanChapter(html: string, pos: number, maxParagraphs = Infinity): ChapterScan {
  const scan: ChapterScan = { pos, seqs: new Map(), together: [], desc: [], capMid: new Map(), capInit: new Map(), lower: new Map() };
  const paras = paragraphs(html).slice(0, maxParagraphs);
  paras.forEach((p, pi) => {
    const toks = tokenise(p);
    const inPara = new Set<string>();
    for (const t of toks) {
      if (t.cap) bump(t.init ? scan.capInit : scan.capMid, t.w);
      else bump(scan.lower, t.w.toLowerCase());
    }
    for (let i = 0; i < toks.length; i++) {
      if (!toks[i].cap) continue;
      // Grow a run of capitalised words, allowing "of the" etc. between them.
      let j = i;
      while (j + 1 < toks.length && !toks[j].poss && !toks[j].punct) {
        const nx = toks[j + 1];
        if (nx.cap) {
          j++;
          continue;
        }
        const lw = nx.w.toLowerCase();
        if (CONNECTORS.has(lw) && !nx.punct) {
          let k = j + 2;
          while (k < toks.length && CONNECTORS.has(toks[k].w.toLowerCase()) && !toks[k].cap && !toks[k - 1].punct) k++;
          if (k < toks.length && toks[k].cap && !toks[k - 1].punct && k - j <= 3) {
            j = k;
            continue;
          }
        }
        break;
      }
      const run = toks.slice(i, j + 1);
      const key = run.map((t) => t.w).join(' ');
      const occ = scan.seqs.get(key) ?? { n: 0, init: 0, char: 0, place: 0, the: 0 };
      occ.n++;
      if (run[0].init) occ.init++;
      const before = toks[i - 1]?.w.toLowerCase();
      const after = toks[j + 1];
      if (before && PLACE_PREP.has(before) && !toks[i - 1].cap) occ.place++;
      if (before === 'the' && !toks[i - 1].punct) occ.the++;
      if (before && SPEECH.has(before)) occ.char++;
      if (after && !after.cap && SPEECH.has(after.w.toLowerCase())) occ.char++;
      if (after && after.w.toLowerCase() === 'who') occ.char++;
      if (run[run.length - 1].poss) occ.char += 0.3;
      scan.seqs.set(key, occ);
      inPara.add(key);
      // Descriptions straight after the name: "X, a …,", "X was a …", "X, who …".
      const last = run[run.length - 1];
      const rest = toks.slice(j + 1, j + 14);
      if (rest.length >= 2) {
        const r0 = rest[0].w.toLowerCase();
        let from = -1;
        if (last.punct === ',' && ['a', 'an', 'the', 'who', 'one'].includes(r0)) from = 0;
        else if (!last.punct && ['was', 'is'].includes(r0) && ['a', 'an', 'the', 'one'].includes(rest[1].w.toLowerCase()) && !rest[0].punct) from = 1;
        if (from >= 0) {
          let k = from;
          while (k < rest.length - 1 && !rest[k].punct) k++;
          const cut = !rest[k].punct; // ran out of words before the clause ended
          const text = p.slice(rest[from].s, rest[k].e).trim() + (cut ? '…' : '');
          const words = k - from + 1;
          if (words >= 2 && scan.desc.filter((d) => d[0] === key).length < 3) scan.desc.push([key, pi, text]);
        }
      }
      i = j;
    }
    if (inPara.size >= 2) scan.together.push([pi, [...inPara]]);
  });
  return scan;
}

/* ------------------------------------------------------------------ the whole novel */

export interface LoreEntity {
  key: string;
  /** Spellings with their [chapter position, mentions] counts. */
  forms: { t: string; c: [number, number][] }[];
  kind: LoreKind;
  /** Key of the place/organisation this one is part of, when the name says so ("Tingen City" ⊂ "Tingen"). */
  parent?: string;
}

export interface LoreIndex {
  version: number;
  builtAt: number;
  entities: LoreEntity[];
  /** [entity index, chapter position, paragraph index, text] */
  desc: [number, number, number, string][];
  /** [entity a, entity b, chapter position, paragraphs together] */
  cooc: [number, number, number, number][];
  /** Words that count as parts of names, for reading the current chapter live. */
  proper: string[];
  /** Spelling (lower case) → entity index, after grouping. */
  formMap: Record<string, number>;
}

export class LoreBuilder {
  private scans: ChapterScan[] = [];
  add(scan: ChapterScan) {
    this.scans.push(scan);
  }

  finish(): LoreIndex {
    const capMid = new Map<string, number>();
    const capInit = new Map<string, number>();
    const lower = new Map<string, number>();
    for (const s of this.scans) {
      s.capMid.forEach((v, k) => bump(capMid, k, v));
      s.capInit.forEach((v, k) => bump(capInit, k, v));
      s.lower.forEach((v, k) => bump(lower, k, v));
    }
    const proper = new Set<string>();
    const allCap = new Set([...capMid.keys(), ...capInit.keys()]);
    for (const w of allCap) {
      const lw = w.toLowerCase();
      if (STOP.has(lw) || w.length < 2) continue;
      const mid = capMid.get(w) ?? 0;
      const init = capInit.get(w) ?? 0;
      const low = lower.get(lw) ?? 0;
      if ((mid >= 1 && mid >= 2 * low && mid + init >= 2) || (mid === 0 && low === 0 && init >= 3)) proper.add(w);
    }
    for (const h of HONORIFICS) proper.delete(h[0].toUpperCase() + h.slice(1));

    // Normalise each raw run into a name form, collecting counts per chapter.
    type Form = { t: string; c: Map<number, number>; total: number; char: number; place: number; the: number };
    const forms = new Map<string, Form>();
    const rawToForm = new Map<string, string | null>();
    const norm = (raw: string): string | null => {
      if (rawToForm.has(raw)) return rawToForm.get(raw)!;
      const r = normaliseRun(raw, proper);
      rawToForm.set(raw, r?.form ?? null);
      return r?.form ?? null;
    };
    const honorificHint = (raw: string) => HONORIFICS.has(raw.split(' ')[0].toLowerCase());
    for (const s of this.scans) {
      s.seqs.forEach((occ, raw) => {
        const f = norm(raw);
        if (!f) return;
        const form = forms.get(f) ?? { t: f, c: new Map(), total: 0, char: 0, place: 0, the: 0 };
        form.c.set(s.pos, (form.c.get(s.pos) ?? 0) + occ.n);
        form.total += occ.n;
        form.char += occ.char + (honorificHint(raw) ? occ.n : 0);
        form.place += occ.place;
        form.the += occ.the;
        forms.set(f, form);
      });
    }

    // Group: a lone first or last name joins the full name it overwhelmingly belongs to.
    const multi = [...forms.values()].filter((f) => f.t.includes(' '));
    const groupOf = new Map<string, string>(); // form → group head form
    for (const f of forms.values()) {
      if (f.t.includes(' ')) continue;
      const containing = multi.filter((m) => {
        const toks = m.t.split(' ');
        return (toks[0] === f.t || toks[toks.length - 1] === f.t) && !toks.some((t) => PLACE_WORDS.has(t.toLowerCase()) || ORG_WORDS.has(t.toLowerCase())) && toks.length <= 3;
      });
      if (!containing.length) continue;
      const sum = containing.reduce((a, m) => a + m.total, 0);
      const top = containing.sort((a, b) => b.total - a.total)[0];
      if (top.total >= 2 && top.total >= sum * 0.7) groupOf.set(f.t, top.t);
    }
    const heads = new Map<string, Form[]>();
    for (const f of forms.values()) {
      const head = groupOf.get(f.t) ?? f.t;
      heads.set(head, [...(heads.get(head) ?? []), f]);
    }

    const entities: LoreEntity[] = [];
    const formMap: Record<string, number> = {};
    for (const [head, fs] of heads) {
      if (!forms.has(head)) continue;
      const total = fs.reduce((a, f) => a + f.total, 0);
      if (total < 2) continue; // a name seen once is too likely to be noise
      const char = fs.reduce((a, f) => a + f.char, 0);
      const place = fs.reduce((a, f) => a + f.place, 0);
      const the = fs.reduce((a, f) => a + f.the, 0);
      const kind = classify(head, total, char, place, the);
      const idx = entities.length;
      entities.push({
        key: head.toLowerCase(),
        kind,
        forms: fs
          .sort((a, b) => b.total - a.total)
          .map((f) => ({ t: f.t, c: [...f.c.entries()].sort((a, b) => a[0] - b[0]) })),
      });
      for (const f of fs) formMap[f.t.toLowerCase()] = idx;
    }

    // "Part of": a place or organisation whose name contains another place's name.
    const byKey = new Map(entities.map((e, i) => [e.key, i]));
    for (const e of entities) {
      if (e.kind !== 'place' && e.kind !== 'organisation') continue;
      const toks = e.key.split(' ');
      if (toks.length < 2) continue;
      for (let len = toks.length - 1; len >= 1 && !e.parent; len--) {
        for (let at = 0; at + len <= toks.length; at++) {
          const sub = toks.slice(at, at + len).join(' ');
          const pi = byKey.get(sub);
          if (pi !== undefined && entities[pi].kind === 'place' && entities[pi] !== e) {
            e.parent = sub;
            break;
          }
        }
      }
    }

    // Descriptions and co-occurrence, mapped to entities.
    const desc: LoreIndex['desc'] = [];
    const coocOut: LoreIndex['cooc'] = [];
    for (const s of this.scans) {
      const cooc = new Map<string, number>();
      for (const [raw, pi, text] of s.desc) {
        const f = norm(raw);
        const ei = f !== null ? formMap[f.toLowerCase()] : undefined;
        if (ei !== undefined) desc.push([ei, s.pos, pi, text]);
      }
      for (const [, raws] of s.together) {
        const ids = [...new Set(raws.map((r) => norm(r)).map((f) => (f ? formMap[f.toLowerCase()] : undefined)).filter((x): x is number => x !== undefined))].sort((a, b) => a - b);
        for (let a = 0; a < ids.length; a++) for (let b = a + 1; b < ids.length; b++) bump(cooc, `${ids[a]}|${ids[b]}`);
      }
      // Keep each chapter's strongest connections; that's what "appears with" is made of, and it keeps the index small.
      [...cooc.entries()]
        .sort((x, y) => y[1] - x[1])
        .slice(0, 60)
        .forEach(([k, w]) => {
          const [a, b] = k.split('|').map(Number);
          coocOut.push([a, b, s.pos, w]);
        });
    }
    return {
      version: LORE_VERSION,
      builtAt: Date.now(),
      entities,
      desc,
      cooc: coocOut,
      proper: [...proper],
      formMap,
    };
  }
}

/** Turn a raw run of capitalised words into a name form, or null if it isn't one. */
export function normaliseRun(raw: string, proper: Set<string>): { form: string } | null {
  let toks = raw.split(' ');
  // Drop leading honorifics and leading non-name words ("Then Klein" → "Klein").
  while (toks.length && (HONORIFICS.has(toks[0].toLowerCase()) || ABBREV.has(toks[0].toLowerCase()) || (!proper.has(toks[0]) && !CONNECTORS.has(toks[0])) || CONNECTORS.has(toks[0]))) {
    if (!toks.length) break;
    toks = toks.slice(1);
  }
  while (toks.length && CONNECTORS.has(toks[toks.length - 1])) toks = toks.slice(0, -1);
  if (!toks.length) return null;
  // Every remaining word must be a name word, a connector inside, or a place/organisation word after a name.
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    const lw = t.toLowerCase();
    if (proper.has(t) || (CONNECTORS.has(lw) && i > 0)) continue;
    if (i > 0 && (PLACE_WORDS.has(lw) || ORG_WORDS.has(lw))) continue;
    return null;
  }
  if (!toks.some((t) => proper.has(t))) return null;
  if (toks.length === 1 && STOP.has(toks[0].toLowerCase())) return null;
  return { form: toks.join(' ') };
}

function classify(name: string, total: number, char: number, place: number, the: number): LoreKind {
  const toks = name.toLowerCase().split(' ');
  if (toks.some((t) => ORG_WORDS.has(t))) return 'organisation';
  if (toks.length > 1 && PLACE_WORDS.has(toks[toks.length - 1])) return 'place';
  if (toks[0] === 'the' && toks.length > 1 && ORG_WORDS.has(toks[toks.length - 1])) return 'organisation';
  if (char >= Math.max(1, total * 0.05) && char >= place) return 'character';
  if (place >= Math.max(1, total * 0.12)) return 'place';
  if (the >= total * 0.5) return toks.length > 1 ? 'organisation' : 'term'; // "the Hollow Crown", "the Spell"
  if (toks.length === 2 && !toks.some((t) => CONNECTORS.has(t))) return 'character';
  return 'term';
}
