/**
 * The spoiler-free view of a novel's lore: everything is cut off at a reading position. Counts,
 * names, descriptions and connections come only from chapters before it (plus, for the chapter
 * being read, the part already read). Ranking is by importance so far, never by what comes later.
 */
import { normaliseRun, type ChapterScan, type DescKind, type LoreIndex, type LoreKind } from './extract';

export interface LoreOverride {
  key: string;
  name?: string | null;
  kind?: LoreKind | null;
  hidden?: boolean;
  mergedInto?: string | null;
  parent?: string | null;
  note?: string;
}

export type LoreTier = 'major' | 'recurring' | 'minor' | 'passing';
export const TIER_LABEL: Record<LoreTier, string> = { major: 'Major', recurring: 'Recurring', minor: 'Minor', passing: 'Passing mentions' };

export interface LoreEntry {
  key: string;
  name: string;
  kind: LoreKind;
  /** Spellings seen so far. */
  forms: string[];
  mentions: number;
  chapters: number;
  firstPos: number;
  lastPos: number;
  score: number;
  tier: LoreTier;
  rank: number;
  parent: string | null;
  children: string[];
  desc: { pos: number; text: string; kind: DescKind }[];
  related: { key: string; weight: number }[];
  note: string;
  hidden: boolean;
  edited: boolean;
  /** Last chapter it came up in before the one being read. */
  prevPos: number;
  /** [chapter position, mentions], in order. */
  presence: [number, number][];
  pronoun: 'he' | 'she' | null;
  /** Other names the book has given it ("known as …"). */
  aliases: { name: string; key: string | null }[];
  honorific: string | null;
  /** Written with "the" ("the Ashen Sea"). */
  article: boolean;
  /** Rank within its own kind (1 = most important character, place…). */
  kindRank: number;
}

export interface Upto {
  /** Chapters at positions below this are read in full. */
  pos: number;
  /** What has been read of the chapter at `pos`, scanned live. */
  live?: ChapterScan | null;
}

const properCache = new WeakMap<LoreIndex, Set<string>>();
function properOf(index: LoreIndex) {
  let s = properCache.get(index);
  if (!s) properCache.set(index, (s = new Set(index.proper)));
  return s;
}

/** Map a raw run from a live scan to an entity index (or undefined). */
export function entityOfRaw(index: LoreIndex, raw: string): number | undefined {
  const f = normaliseRun(raw, properOf(index));
  return f ? index.formMap[f.form.toLowerCase()] : undefined;
}

export interface LoreView {
  entries: LoreEntry[];
  byKey: Map<string, LoreEntry>;
  /** Final key for any entity key (after your merges). */
  resolve: (key: string) => string;
}

export function loreView(index: LoreIndex, overrides: LoreOverride[], upto: Upto, opts: { includeHidden?: boolean } = {}): LoreView {
  const ov = new Map(overrides.map((o) => [o.key, o]));
  // Corrections saved against a name that a newer Lore build has folded into another entry ("Klein" into
  // "Klein Moretti") follow it there, so your notes and fixes aren't lost when the extraction improves.
  const liveKeys = new Set(index.entities.map((e) => e.key));
  const current = (key: string) => (liveKeys.has(key) ? key : index.formMap[key] !== undefined ? index.entities[index.formMap[key]].key : key);
  for (const o of overrides) {
    const to = current(o.key);
    const into = o.mergedInto ? current(o.mergedInto) : o.mergedInto;
    if (to === o.key && into === o.mergedInto) continue;
    ov.delete(o.key);
    const moved = { ...o, key: to, mergedInto: into === to ? null : into };
    const there = ov.get(to);
    ov.set(to, there ? { ...moved, ...there, note: [there.note, o.note].filter(Boolean).join('\n\n') } : moved);
  }
  // Your merges: follow chains, ignore cycles.
  const resolve = (key: string) => {
    let k = key;
    const seen = new Set<string>();
    while (ov.get(k)?.mergedInto && !seen.has(k)) {
      seen.add(k);
      k = ov.get(k)!.mergedInto!;
    }
    return k;
  };
  const keyOf = index.entities.map((e) => resolve(e.key));

  type Acc = {
    key: string;
    kinds: LoreKind[];
    formCounts: Map<string, number>;
    mentions: number;
    chapters: Map<number, number>;
    first: number;
    last: number;
    prev: number;
    desc: { pos: number; text: string; kind: DescKind }[];
    rel: Map<string, number>;
    parents: string[];
    he: number;
    she: number;
    hon: Map<string, number>;
    the: number;
    act: number;
    aliases: Map<string, string | null>;
  };
  const acc = new Map<string, Acc>();
  const get = (key: string) => {
    let a = acc.get(key);
    if (!a) acc.set(key, (a = { key, kinds: [], formCounts: new Map(), mentions: 0, chapters: new Map(), first: Infinity, last: -1, prev: -1, desc: [], rel: new Map(), parents: [], he: 0, she: 0, hon: new Map(), the: 0, act: 0, aliases: new Map() }));
    return a;
  };

  index.entities.forEach((e, i) => {
    const a = get(keyOf[i]);
    a.kinds.push(e.kind);
    if (e.parent) a.parents.push(e.parent);
    if (e.g) ((a.he += e.g[0]), (a.she += e.g[1]));
    if (e.hon) a.hon.set(e.hon, (a.hon.get(e.hon) ?? 0) + 1);
    if (e.the) a.the++;
    let seen = 0;
    for (const f of e.forms) {
      for (const [pos, n] of f.c) {
        if (pos >= upto.pos) break;
        a.mentions += n;
        seen += n;
        a.chapters.set(pos, (a.chapters.get(pos) ?? 0) + n);
        a.first = Math.min(a.first, pos);
        a.last = Math.max(a.last, pos);
        a.prev = Math.max(a.prev, pos);
        a.formCounts.set(f.t, (a.formCounts.get(f.t) ?? 0) + n);
      }
    }
    // Agency counts are novel-wide; scale them to the share of mentions read so far.
    const total = e.forms.reduce((t, f) => t + f.c.reduce((x, [, n]) => x + n, 0), 0);
    a.act += total ? ((e.act ?? 0) * seen) / total : 0;
  });
  for (const [ei, pos, , text, kind] of index.desc) if (pos < upto.pos) get(keyOf[ei]).desc.push({ pos, text, kind: kind ?? 'app' });
  for (const [ei, name, oi, pos] of index.alias ?? []) if (pos < upto.pos) get(keyOf[ei]).aliases.set(name, oi >= 0 ? keyOf[oi] : null);
  const relate = (ka: string, kb: string, w: number) => {
    if (ka === kb) return;
    const a = get(ka);
    const b = get(kb);
    a.rel.set(kb, (a.rel.get(kb) ?? 0) + w);
    b.rel.set(ka, (b.rel.get(ka) ?? 0) + w);
  };
  for (const [ea, eb, pos, w] of index.cooc) if (pos < upto.pos) relate(keyOf[ea], keyOf[eb], w);

  // The part of the current chapter already read.
  const live = upto.live;
  if (live) {
    const liveKey = new Map<string, string | undefined>();
    const k = (raw: string) => {
      if (!liveKey.has(raw)) {
        const ei = entityOfRaw(index, raw);
        liveKey.set(raw, ei === undefined ? undefined : keyOf[ei]);
      }
      return liveKey.get(raw);
    };
    live.seqs.forEach((occ, raw) => {
      const key = k(raw);
      if (!key) return;
      const a = get(key);
      const f = normaliseRun(raw, properOf(index))!.form;
      a.mentions += occ.n;
      a.chapters.set(live.pos, (a.chapters.get(live.pos) ?? 0) + occ.n);
      a.first = Math.min(a.first, live.pos);
      a.last = Math.max(a.last, live.pos);
      a.formCounts.set(f, (a.formCounts.get(f) ?? 0) + occ.n);
    });
    for (const [raw, , text, kind] of live.desc) {
      const key = k(raw);
      if (key) get(key).desc.push({ pos: live.pos, text, kind });
    }
    for (const [raw, other] of live.alias) {
      const key = k(raw);
      if (key) get(key).aliases.set(other, k(other) ?? null);
    }
    for (const [, raws] of live.together) {
      const keys = [...new Set(raws.map(k).filter((x): x is string => !!x))];
      for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) relate(keys[i], keys[j], 1);
    }
  }

  // Entries seen at least twice so far (or that you've written about).
  let entries: LoreEntry[] = [];
  for (const a of acc.values()) {
    const o = ov.get(a.key);
    if (a.mentions < 2 && !o?.note) continue;
    if (o?.hidden && !opts.includeHidden) continue;
    if (!a.formCounts.size) continue;
    const forms = [...a.formCounts.entries()].sort((x, y) => y[0].split(' ').length - x[0].split(' ').length || y[1] - x[1]).map(([f]) => f);
    // Most frequent kind among merged parts.
    const kc = new Map<LoreKind, number>();
    a.kinds.forEach((kd) => kc.set(kd, (kc.get(kd) ?? 0) + 1));
    const kind = (o?.kind ?? [...kc.entries()].sort((x, y) => y[1] - x[1])[0][0]) as LoreKind;
    const desc = dedupeDesc(a.desc).slice(0, 12);
    const presence = [...a.chapters.entries()].sort((x, y) => x[0] - y[0]);
    const hon = [...a.hon.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null;
    entries.push({
      key: a.key,
      name: o?.name || forms[0],
      kind,
      forms,
      mentions: a.mentions,
      chapters: a.chapters.size,
      prevPos: a.prev,
      presence,
      pronoun: kind === 'character' && a.he + a.she >= 3 ? (a.he >= a.she * 2 ? 'he' : a.she >= a.he * 2 ? 'she' : null) : null,
      aliases: [...a.aliases.entries()].map(([name, key]) => ({ name, key })),
      honorific: hon,
      article: a.the > 0,
      kindRank: 0,
      firstPos: a.first,
      lastPos: a.last,
      score: 0,
      tier: 'passing',
      rank: 0,
      parent: o?.parent !== undefined && o.parent !== null ? o.parent : (a.parents[0] ?? null),
      children: [],
      desc,
      related: [],
      note: o?.note ?? '',
      hidden: !!o?.hidden,
      edited: !!o && !!(o.name || o.kind || o.mergedInto || o.parent || o.note || o.hidden),
    });
  }
  const byKey = new Map(entries.map((e) => [e.key, e]));
  for (const e of entries) {
    const a = acc.get(e.key)!;
    e.related = [...a.rel.entries()]
      .filter(([k]) => byKey.has(k))
      .sort((x, y) => y[1] - x[1])
      .slice(0, 24)
      .map(([key, weight]) => ({ key, weight }));
    if (e.parent) {
      const p = resolve(e.parent);
      e.parent = byKey.has(p) && p !== e.key ? p : null;
    }
  }
  for (const e of entries) if (e.parent) byKey.get(e.parent)?.children.push(e.key);
  scoreEntries(entries, acc, upto.pos);
  return { entries: entries.sort((x, y) => y.score - x.score || x.firstPos - y.firstPos).map((e, i) => ((e.rank = i + 1), e)), byKey, resolve };
}

/**
 * Importance so far, not just mentions: how often it comes up, across how much of the story, in how many
 * separate stretches, and how central it is (a PageRank over who appears with whom: someone linked to many
 * important characters matters even when named less often). Tiers are given within each kind, so places don't
 * crowd characters out of "Major".
 */
function scoreEntries(entries: LoreEntry[], acc: Map<string, { rel: Map<string, number>; act: number }>, uptoPos: number) {
  const n = entries.length;
  if (!n) return;
  const idx = new Map(entries.map((e, i) => [e.key, i]));
  // PageRank on the co-occurrence graph.
  const out: { j: number; w: number }[][] = entries.map((e) => [...acc.get(e.key)!.rel.entries()].filter(([k]) => idx.has(k)).map(([k, w]) => ({ j: idx.get(k)!, w })));
  const outW = out.map((l) => l.reduce((t, x) => t + x.w, 0));
  let pr = new Float64Array(n).fill(1 / n);
  for (let it = 0; it < 30; it++) {
    const next = new Float64Array(n).fill(0.15 / n);
    let dangling = 0;
    for (let i = 0; i < n; i++) {
      if (!outW[i]) dangling += pr[i];
      else for (const { j, w } of out[i]) next[j] += (0.85 * pr[i] * w) / outW[i];
    }
    for (let i = 0; i < n; i++) next[i] += (0.85 * dangling) / n;
    pr = next;
  }
  const span = Math.max(1, Math.min(uptoPos, 1e6));
  const bucket = Math.max(1, Math.round(span / 40)); // the story so far in ~40 stretches
  const raw = entries.map((e, i) => ({
    m: Math.log1p(e.mentions),
    c: Math.log1p(e.chapters),
    arcs: Math.log1p(new Set(e.presence.map(([p]) => Math.floor(p / bucket))).size),
    pr: pr[i],
    deg: Math.log1p(out[i].length),
    act: Math.log1p(acc.get(e.key)!.act),
  }));
  const max = (k: keyof (typeof raw)[0]) => Math.max(1e-9, ...raw.map((r) => r[k]));
  const mx = { m: max('m'), c: max('c'), arcs: max('arcs'), pr: max('pr'), deg: max('deg'), act: max('act') };
  entries.forEach((e, i) => {
    const r = raw[i];
    e.score = 0.26 * (r.m / mx.m) + 0.16 * (r.c / mx.c) + 0.16 * (r.arcs / mx.arcs) + 0.24 * Math.sqrt(r.pr / mx.pr) + 0.1 * (r.deg / mx.deg) + 0.08 * (r.act / mx.act);
  });
  // Tiers within each kind.
  const byKind = new Map<LoreKind, LoreEntry[]>();
  for (const e of entries) byKind.set(e.kind, [...(byKind.get(e.kind) ?? []), e]);
  for (const list of byKind.values()) {
    list.sort((x, y) => y.score - x.score);
    const k = list.length;
    const top = list[0].score;
    const majorN = Math.max(Math.min(k, 3), Math.round(k * 0.07));
    const recurringN = majorN + Math.max(3, Math.round(k * 0.2));
    list.forEach((e, i) => {
      e.kindRank = i + 1;
      e.tier =
        i < majorN && e.score >= top * 0.45 && e.chapters >= 2
          ? 'major'
          : i < recurringN && e.chapters >= 2 && e.score >= top * 0.2
            ? 'recurring'
            : e.chapters >= 2 || e.mentions >= 4
              ? 'minor'
              : 'passing';
    });
  }
}

function dedupeDesc(d: { pos: number; text: string; kind: DescKind }[]) {
  const seen = new Set<string>();
  return d.filter((x) => {
    const k = x.text.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
