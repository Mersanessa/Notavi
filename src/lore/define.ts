/**
 * A definition for every entry, written from what the book has said and shown so far: no AI, nothing
 * invented, nothing from later chapters. The lead is the book's own description where it gives one; the
 * rest is composed from facts the reader has already seen (when it first came up, who it appears with,
 * where, what it's part of, what else it's called).
 */
import type { LoreEntry, LoreView } from './view';

export interface Definition {
  /** One line: the book's own description, tidied ("A cartographer from the inland hills."). */
  lead: string | null;
  leadPos: number | null;
  /** A few short sentences of facts. */
  facts: string[];
}

/** "the Tidewatch Guild", "the Ashen Sea", but "Port Halloway", "Greywater Isle", "Orsk": as the book writes it. */
export function named(e: Pick<LoreEntry, 'name' | 'kind'> & { article?: boolean }): string {
  if (e.kind === 'character' || /^the\s/i.test(e.name)) return e.name;
  return e.article ? `the ${e.name}` : e.name;
}

export function list(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const sentence = (s: string) => {
  const t = s.trim().replace(/[,;:]+$/, '');
  return /[.!?…]$/.test(t) ? t : `${t}.`;
};

export function lead(e: Pick<LoreEntry, 'desc' | 'kind'>): { text: string; pos: number } | null {
  if (!e.desc.length) return null;
  const pri = (k: string) => (e.kind === 'character' ? { app: 0, def: 1, who: 2 } : { def: 0, app: 1, who: 2 })[k as 'app'] ?? 3;
  const best = [...e.desc].sort((a, b) => pri(a.kind) - pri(b.kind) || a.pos - b.pos)[0];
  const text = best.kind === 'who' ? `${e.kind === 'character' ? 'Someone' : 'One'} ${best.text}` : cap(best.text);
  return { text: sentence(text), pos: best.pos };
}

/**
 * @param title chapter title for a position
 * @param beforePos the reading position (entries are already cut off there)
 */
export function defineEntry(e: LoreEntry, view: LoreView, title: (pos: number) => string, beforePos: number): Definition {
  const l = lead(e);
  const facts: string[] = [];
  const first = e.name.split(' ')[0];
  const subject = e.kind === 'character' ? first : cap(named(e));
  const rel = (kinds: LoreEntry['kind'][], min = 1, n = 3) =>
    e.related
      .map((r) => ({ x: view.byKey.get(r.key), w: r.weight }))
      .filter((r): r is { x: LoreEntry; w: number } => !!r.x && kinds.includes(r.x.kind) && r.w >= min && r.x.key !== e.parent && !l?.text.includes(r.x.name))
      .slice(0, n)
      .map((r) => r.x);
  const kindWord = { character: 'character', place: 'place', organisation: 'group', term: 'term' }[e.kind];

  // Standing so far.
  const top = e.kindRank === 1 && e.tier === 'major';
  facts.push(
    top
      ? e.kind === 'character'
        ? 'The most prominent character so far.'
        : `The most prominent ${kindWord} so far.`
      : e.tier === 'major'
        ? `One of the central ${kindWord}s so far.`
        : e.tier === 'recurring'
          ? `A recurring ${kindWord}.`
          : e.tier === 'minor'
            ? `A minor ${kindWord} so far.`
            : 'Only mentioned in passing so far.',
  );
  if (e.honorific && e.kind === 'character' && !e.name.startsWith(e.honorific)) facts.push(`Usually called ${e.honorific} ${e.name.split(' ').slice(-1)[0]}.`);

  // When.
  const since = e.chapters > 1 ? ` and has come up in ${e.chapters} chapters so far` : '';
  facts.push(`First ${e.kind === 'term' ? 'used' : 'appears'} in ${title(e.firstPos)}${since}.`);

  // Who, where, what.
  if (e.kind === 'character') {
    const people = rel(['character']);
    if (people.length) facts.push(`Most often alongside ${list(people.map(named))}.`);
    const places = rel(['place'], 2, 2);
    if (places.length) facts.push(`Usually around ${list(places.map(named))}.`);
    const groups = rel(['organisation'], 2, 2);
    if (groups.length) facts.push(`Linked to ${list(groups.map(named))}.`);
    const surname = e.name.includes(' ') ? e.name.split(' ').slice(-1)[0] : null;
    if (surname) {
      const family = view.entries.filter((x) => x !== e && x.kind === 'character' && x.name.split(' ').length > 1 && x.name.split(' ').slice(-1)[0] === surname).slice(0, 4);
      if (family.length) facts.push(`Shares the ${surname} name with ${list(family.map((x) => x.name))}.`);
    }
  } else if (e.kind === 'place') {
    if (e.parent) facts.push(`Part of ${named(view.byKey.get(e.parent) ?? { name: e.parent, kind: 'place' })}.`);
    const kids = e.children.map((k) => view.byKey.get(k)).filter((x): x is LoreEntry => !!x);
    if (kids.length) facts.push(`Includes ${list(kids.slice(0, 4).map(named))}${kids.length > 4 ? ` and ${kids.length - 4} more` : ''}.`);
    const people = rel(['character']);
    if (people.length) facts.push(`Where you most often find ${list(people.map(named))}.`);
    const groups = rel(['organisation'], 2, 2);
    if (groups.length) facts.push(`Linked to ${list(groups.map(named))}.`);
  } else if (e.kind === 'organisation') {
    const people = rel(['character']);
    if (people.length) facts.push(`Most linked with ${list(people.map(named))}.`);
    const places = rel(['place'], 2, 2);
    if (places.length) facts.push(`Usually around ${list(places.map(named))}.`);
  } else {
    const things = rel(['character', 'organisation', 'term'], 1, 3);
    if (things.length) facts.push(`Often comes up with ${list(things.map(named))}.`);
  }
  const other = e.aliases.filter((a) => a.name.toLowerCase() !== e.name.toLowerCase());
  if (other.length) facts.push(`${subject} is also known as ${list(other.map((a) => (/^[A-Z]/.test(a.name) && e.kind === 'character' ? `the ${a.name}` : a.name)))}.`);

  // When last seen, if it's been a while.
  if (e.prevPos >= 0 && beforePos < Number.MAX_SAFE_INTEGER && beforePos - e.prevPos >= 3) facts.push(`Last came up in ${title(e.prevPos)}, ${beforePos - e.prevPos} chapters ago.`);

  return { lead: l?.text ?? null, leadPos: l?.pos ?? null, facts };
}

/** Entries that are probably the same as this one ("Klein" and "Klein Moretti"), to merge with one tap. */
export function possibleDuplicates(e: LoreEntry, view: LoreView): LoreEntry[] {
  const mine = new Set(e.forms.flatMap((f) => f.split(' ')).map((w) => w.toLowerCase()));
  const single = e.name.split(' ').length === 1;
  return view.entries
    .filter((x) => {
      if (x === e || x.key === e.parent || e.children.includes(x.key) || x.parent === e.key) return false;
      if (x.kind !== e.kind && !(x.kind === 'term' || e.kind === 'term')) return false;
      const toks = x.name.split(' ').map((w) => w.toLowerCase());
      if (single) return toks.length > 1 && (toks[0] === e.name.toLowerCase() || toks[toks.length - 1] === e.name.toLowerCase()) && e.kind === 'character';
      if (toks.length === 1) return mine.has(toks[0]) && x.kind === 'character' && e.kind === 'character' && (e.name.toLowerCase().startsWith(toks[0] + ' ') || e.name.toLowerCase().endsWith(' ' + toks[0]));
      return false;
    })
    .slice(0, 3);
}
