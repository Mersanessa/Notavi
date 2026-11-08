import { describe, expect, it } from 'vitest';
import { LoreBuilder, scanChapter, paragraphs } from '../../src/lore/extract';
import { SAGA, sagaHtml } from '../fixtures-src/saga';

function build() {
  const b = new LoreBuilder();
  SAGA.forEach((_, i) => b.add(scanChapter(sagaHtml(i), i)));
  return b.finish();
}

describe('lore extraction', () => {
  it('reads paragraphs out of chapter HTML', () => {
    expect(paragraphs('<p>One &amp; two</p><p>Three<br>Four</p>')).toEqual(['One & two', 'Three', 'Four']);
  });

  it('finds the names and groups first names with full names', () => {
    const idx = build();
    const names = idx.entities.flatMap((e) => e.forms.map((f) => f.t));
    const keys = idx.entities.map((e) => e.key);
    for (const n of ['mira valen', 'port halloway', 'orsk', 'tidewatch guild', 'doran kett', 'ashen sea', 'greywater isle', 'hollow crown', 'seraphine vale']) expect(keys).toContain(n);
    // Ordinary words that start sentences are not names.
    for (const n of ['Then', 'Suddenly', 'Every', 'Nobody', 'Inside', 'When', 'One', 'They']) expect(names).not.toContain(n);
    const mira = idx.entities.find((e) => e.key === 'mira valen')!;
    expect(mira.forms.map((f) => f.t)).toContain('Mira');
    const doran = idx.entities.find((e) => e.key === 'doran kett')!;
    expect(doran.forms.map((f) => f.t)).toContain('Doran');
  });

  it('tells characters, places and organisations apart', () => {
    const idx = build();
    const kind = (k: string) => idx.entities.find((e) => e.key === k)?.kind;
    expect(kind('mira valen')).toBe('character');
    expect(kind('orsk')).toBe('character');
    expect(kind('doran kett')).toBe('character');
    expect(kind('port halloway')).toBe('place');
    expect(kind('greywater isle')).toBe('place');
    expect(kind('ashen sea')).toBe('place');
    expect(kind('tidewatch guild')).toBe('organisation');
  });

  it('collects the book’s own descriptions, with the chapter they come from', () => {
    const idx = build();
    const d = (k: string) => idx.desc.filter(([e]) => idx.entities[e].key === k).map(([, pos, , text]) => [pos, text]);
    expect(d('mira valen')).toContainEqual([0, 'a cartographer from the inland hills']);
    expect(d('doran kett')).toContainEqual([1, 'the master of the Tidewatch Guild']);
    expect(d('seraphine vale')).toContainEqual([4, 'the first cartographer of the Ashen Sea']);
  });

  it('records who appears with whom, per chapter', () => {
    const idx = build();
    const id = (k: string) => idx.entities.findIndex((e) => e.key === k);
    const [m, o] = [id('mira valen'), id('orsk')];
    const pair = idx.cooc.filter(([a, b]) => (a === Math.min(m, o) && b === Math.max(m, o)));
    expect(pair.length).toBeGreaterThan(1);
    expect(pair.every(([, , pos]) => pos >= 0 && pos < SAGA.length)).toBe(true);
  });
});

import { loreView } from '../../src/lore/view';
import { MemoryDb } from '../../src/db/memory';
import * as N from '../../src/data/novels';
import { ensureLore, forgetLore } from '../../src/lore/build';
import { getLoreOverrides, loreMentions, setLoreOverride } from '../../src/data/lore';

describe('the spoiler-free view', () => {
  it('shows nothing from chapters not yet read', () => {
    const idx = build();
    const early = loreView(idx, [], { pos: 2 }); // read chapters 1–2
    const keys = early.entries.map((e) => e.key);
    expect(keys).toContain('mira valen');
    expect(keys).toContain('doran kett');
    expect(keys).not.toContain('seraphine vale'); // first appears in chapter 4/5
    expect(keys).not.toContain('hollow crown'); // chapter 3
    const doran = early.byKey.get('doran kett')!;
    expect(doran.desc.map((d) => d.text)).toEqual(['the master of the Tidewatch Guild']);
    expect(doran.lastPos).toBeLessThan(2);
  });

  it('names people by what you have seen so far (no surname before it is revealed)', () => {
    const idx = build();
    // After chapter 4 only "Seraphine" (a signature) has appeared — once, so not listed yet.
    expect(loreView(idx, [], { pos: 4 }).byKey.has('seraphine vale')).toBe(false);
    const later = loreView(idx, [], { pos: 6 }).byKey.get('seraphine vale')!;
    expect(later.name).toBe('Seraphine Vale');
    expect(later.forms).toContain('Seraphine');
  });

  it('counts the part of the current chapter already read', () => {
    const idx = build();
    const live = scanChapter(sagaHtml(4), 4, 1); // first paragraph of chapter 5
    const v = loreView(idx, [], { pos: 4, live });
    // Seraphine: 1 mention in chapter 4 + 1 in the first paragraph of chapter 5.
    expect(v.byKey.get('seraphine vale')?.mentions).toBe(2);
    expect(v.byKey.get('seraphine vale')?.desc[0].text).toBe('the first cartographer of the Ashen Sea');
  });

  it('ranks by importance so far and connects people who appear together', () => {
    const v = loreView(build(), [], { pos: 6 });
    expect(v.entries[0].tier).toBe('major');
    expect(['mira valen', 'orsk']).toContain(v.entries[0].key);
    const orsk = v.byKey.get('orsk')!;
    expect(orsk.related.map((r) => r.key)).toContain('mira valen');
  });

  it('applies your corrections: rename, retype, merge, hide and part-of', () => {
    const idx = build();
    const v = loreView(
      idx,
      [
        { key: 'hollow crown', kind: 'organisation', name: 'The Hollow Crown' },
        { key: 'greywater isle', parent: 'ashen sea' },
        { key: 'doran kett', mergedInto: 'orsk' },
        { key: 'port halloway', hidden: true },
      ],
      { pos: 6 },
    );
    expect(v.byKey.get('hollow crown')!.name).toBe('The Hollow Crown');
    expect(v.byKey.get('greywater isle')!.parent).toBe('ashen sea');
    expect(v.byKey.get('ashen sea')!.children).toContain('greywater isle');
    expect(v.byKey.has('doran kett')).toBe(false);
    expect(v.byKey.get('orsk')!.forms).toContain('Doran Kett');
    expect(v.byKey.has('port halloway')).toBe(false);
  });
});

describe('lore storage', () => {
  it('builds once, rebuilds after the chapters change, keeps your notes, and finds earlier mentions', async () => {
    const db = await MemoryDb.create();
    const id = await N.createNovel(db, { title: 'Saga' }, { chapters: SAGA.map((c, i) => ({ title: c.title, content: sagaHtml(i) })) });
    const a = await ensureLore(db, id);
    expect(a.entities.length).toBeGreaterThan(5);
    expect(await ensureLore(db, id)).toBe(a); // cached
    await setLoreOverride(db, id, 'orsk', { note: 'Trust him.' });
    await N.appendChapters(db, id, [{ title: 'Chapter 7', content: '<p>Orsk mended the sail. Orsk said nothing.</p>' }]);
    forgetLore(id);
    const b = await ensureLore(db, id);
    expect(b).not.toBe(a);
    expect(b.entities.find((e) => e.key === 'orsk')!.forms[0].c.some(([pos]) => pos === 6)).toBe(true);
    expect((await getLoreOverrides(db, id)).find((o) => o.key === 'orsk')!.note).toBe('Trust him.');
    const m = await loreMentions(db, id, ['Seraphine Vale', 'Seraphine'], 5);
    expect(m.total).toBe(2); // chapters 4 and 5, not 6
    expect(m.hits[0].position).toBe(4);
    expect(m.hits[0].snippet).toContain('<mark>');
  });
});
