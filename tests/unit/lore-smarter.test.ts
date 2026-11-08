import { describe, expect, it } from 'vitest';
import { LoreBuilder, scanChapter } from '../../src/lore/extract';
import { loreView, type LoreView } from '../../src/lore/view';
import { defineEntry, possibleDuplicates } from '../../src/lore/define';
import { SAGA, sagaHtml } from '../fixtures-src/saga';

function build() {
  const b = new LoreBuilder();
  SAGA.forEach((_, i) => b.add(scanChapter(sagaHtml(i), i)));
  return b.finish();
}
const ALL = Number.MAX_SAFE_INTEGER;
const title = (p: number) => `Chapter ${p + 1}`;
const get = (v: LoreView, k: string) => v.byKey.get(v.resolve(k))!;

describe('smarter lore extraction', () => {
  it('ignores contractions and dialogue openers', () => {
    const names = build().entities.flatMap((e) => e.forms.map((f) => f.t));
    for (const n of ['I’ll', 'I’m', 'I’ve', "I'll", 'I']) expect(names).not.toContain(n);
  });

  it('does not join two names with “and”', () => {
    const keys = build().entities.map((e) => e.key);
    expect(keys).not.toContain('mira and orsk');
  });

  it('groups plurals and short forms into one entry', () => {
    const idx = build();
    const forms = (k: string) => idx.entities.find((e) => e.key === k)!.forms.map((f) => f.t);
    expect(forms('lanternkeeper')).toContain('Lanternkeepers');
    expect(forms('tidewatch guild')).toContain('Guild');
  });

  it('learns pronouns and other names from the text', () => {
    const v = loreView(build(), [], { pos: ALL });
    expect(get(v, 'mira valen').pronoun).toBe('she');
    expect(get(v, 'orsk').pronoun).toBe('he');
    expect(get(v, 'orsk').aliases.map((a) => a.name)).toContain('Grey Captain');
  });

  it('ranks importance within each kind, not by raw mentions alone', () => {
    const v = loreView(build(), [], { pos: ALL });
    const mira = get(v, 'mira valen');
    expect(mira.kindRank).toBe(1);
    expect(mira.tier).toBe('major');
    // Orsk is in most chapters alongside Mira: central, even with fewer mentions.
    expect(['major', 'recurring']).toContain(get(v, 'orsk').tier);
  });
});

describe('automatic definitions', () => {
  it('leads with the book’s own words', () => {
    const v = loreView(build(), [], { pos: ALL });
    const lk = defineEntry(get(v, 'lanternkeeper'), v, title, ALL);
    expect(lk.lead).toMatch(/^People who could hear the Ashen Sea breathing at night\.$/);
    const mira = defineEntry(get(v, 'mira valen'), v, title, ALL);
    expect(mira.lead).toBe('A cartographer from the inland hills.');
  });

  it('adds facts the reader has already seen', () => {
    const v = loreView(build(), [], { pos: ALL });
    const mira = defineEntry(get(v, 'mira valen'), v, title, ALL).facts.join(' ');
    expect(mira).toMatch(/most prominent character so far/);
    expect(mira).toMatch(/First appears in Chapter 1/);
    expect(mira).toMatch(/Orsk/);
    const orsk = defineEntry(get(v, 'orsk'), v, title, ALL).facts.join(' ');
    expect(orsk).toMatch(/also known as the Grey Captain/);
  });

  it('stays spoiler-free', () => {
    const v = loreView(build(), [], { pos: 2 });
    const mira = defineEntry(get(v, 'mira valen'), v, title, 2);
    const text = [mira.lead, ...mira.facts].join(' ');
    expect(text).not.toMatch(/Seraphine|Lanternkeeper too|Grey Captain/);
    expect(v.byKey.has('seraphine vale')).toBe(false);
  });

  it('suggests merging a short name with a full one', () => {
    // Pretend the book never linked "Doran" to "Doran Kett", as can happen in long books.
    const v = loreView(build(), [], { pos: ALL });
    const doran = get(v, 'doran kett');
    const fake = { ...doran, key: 'doran', name: 'Doran', forms: ['Doran'], mentions: 3 };
    const view: LoreView = { ...v, entries: [...v.entries, fake], byKey: new Map([...v.byKey, ['doran', fake]]) };
    expect(possibleDuplicates(fake, view).map((e) => e.key)).toContain('doran kett');
    expect(possibleDuplicates(get(v, 'port halloway'), view)).toEqual([]);
  });
});
