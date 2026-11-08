/**
 * The spoiler-free view of a novel's lore: everything is cut off at a reading position. Counts,
 * names, descriptions and connections come only from chapters before it (plus, for the chapter
 * being read, the part already read). Ranking is by importance so far, never by what comes later.
 */
import { normaliseRun, type ChapterScan, type LoreIndex, type LoreKind } from './extract';

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
  desc: { pos: number; text: string }[];
  related: { key: string; weight: number }[];
  note: string;
  hidden: boolean;
  edited: boolean;
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

  type Acc = { key: string; kinds: LoreKind[]; formCounts: Map<string, number>; mentions: number; chapters: Set<number>; first: number; last: number; desc: { pos: number; text: string }[]; rel: Map<string, number>; parents: string[] };
  const acc = new Map<string, Acc>();
  const get = (key: string) => {
    let a = acc.get(key);
    if (!a) acc.set(key, (a = { key, kinds: [], formCounts: new Map(), mentions: 0, chapters: new Set(), first: Infinity, last: -1, desc: [], rel: new Map(), parents: [] }));
    return a;
  };

  index.entities.forEach((e, i) => {
    const a = get(keyOf[i]);
    a.kinds.push(e.kind);
    if (e.parent) a.parents.push(e.parent);
    for (const f of e.forms) {
      for (const [pos, n] of f.c) {
        if (pos >= upto.pos) break;
        a.mentions += n;
        a.chapters.add(pos);
        a.first = Math.min(a.first, pos);
        a.last = Math.max(a.last, pos);
        a.formCounts.set(f.t, (a.formCounts.get(f.t) ?? 0) + n);
      }
    }
  });
  for (const [ei, pos, , text] of index.desc) if (pos < upto.pos) get(keyOf[ei]).desc.push({ pos, text });
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
      a.chapters.add(live.pos);
      a.first = Math.min(a.first, live.pos);
      a.last = Math.max(a.last, live.pos);
      a.formCounts.set(f, (a.formCounts.get(f) ?? 0) + occ.n);
    });
    for (const [raw, , text] of live.desc) {
      const key = k(raw);
      if (key) get(key).desc.push({ pos: live.pos, text });
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
    entries.push({
      key: a.key,
      name: o?.name || forms[0],
      kind,
      forms,
      mentions: a.mentions,
      chapters: a.chapters.size,
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
    const degree = a.rel.size;
    e.score = Math.pow(e.mentions, 0.55) * Math.pow(e.chapters, 0.65) + 0.6 * Math.sqrt(degree);
    if (e.parent) {
      const p = resolve(e.parent);
      e.parent = byKey.has(p) && p !== e.key ? p : null;
    }
  }
  for (const e of entries) if (e.parent) byKey.get(e.parent)?.children.push(e.key);

  // Importance tiers, by rank among everything seen so far.
  entries = entries.sort((x, y) => y.score - x.score || x.firstPos - y.firstPos);
  const n = entries.length;
  const majorN = Math.max(Math.min(n, 3), Math.round(n * 0.05));
  const recurringN = majorN + Math.round(n * 0.17);
  entries.forEach((e, i) => {
    e.rank = i + 1;
    e.tier = i < majorN ? 'major' : i < recurringN && e.chapters >= 2 ? 'recurring' : e.chapters >= 2 || e.mentions >= 4 ? 'minor' : 'passing';
  });
  return { entries, byKey, resolve };
}

function dedupeDesc(d: { pos: number; text: string }[]) {
  const seen = new Set<string>();
  return d.filter((x) => {
    const k = x.text.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
