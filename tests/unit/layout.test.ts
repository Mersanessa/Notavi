import { describe, expect, it } from 'vitest';
import { suggestWebTitles, auditPlan, chaptersFromPlan, mergeWithPrevious, nextChapterNumber, parseTitle, planLayout, renumber, volumeNumber, type Volume } from '../../src/import/layout';
import type { ParsedSection } from '../../src/data/model';

const para = (n: number, tag = 'w') => `<p>${Array.from({ length: n }, (_, i) => `${tag}${i}`).join(' ')}.</p>`;
const OPTS = { webTitles: true, startNumber: 1 };

function bookOne(): Volume {
  const s = (title: string, content: string, extra: Partial<ParsedSection> = {}): ParsedSection => ({ title, content, titleFrom: 'toc', ...extra });
  return {
    label: 'The Lantern Road, Volume 1',
    sections: [
      s('Title Page', '<p>The Lantern Road</p><p>Book One</p>', { role: 'front' }),
      s('Copyright', '<p>Copyright © 2024 A. Writer. All rights reserved.</p>', { role: 'front' }),
      s('Contents', '<p>Prologue</p><p>Chapter 1</p>', { role: 'toc' }),
      s('Prologue', para(500, 'pro')),
      s('Chapter One', '', { titleFrom: 'heading' }), // opener page
      s('Section 6', para(800, 'one'), { titleFrom: 'generated' }), // its text
      s('Chapter 2: The Gate', para(600, 'gate')),
      s('Section 8', `<p><em>continued</em> ${'more '.repeat(300)}</p>`, { titleFrom: 'generated' }), // split across files
      s('Chapters 3 and 4', `<h2>Chapter 3</h2><h3>Ash</h3>${para(400, 'ash')}<p data-align="center">* * *</p>${para(50, 'ash2')}<h2>Chapter 4: Ember</h2>${para(450, 'ember')}`),
      s('Afterword', para(200, 'aft')),
      s('About the Author', '<p>A. Writer lives by the sea.</p>'),
    ],
  };
}

function bookTwo(): Volume {
  return {
    label: 'The Lantern Road, Volume 2',
    sections: [
      { title: 'Copyright', content: '<p>Copyright © 2025.</p>', role: 'front', titleFrom: 'toc' },
      { title: 'Chapter 1: New Dawn', content: para(700, 'dawn'), titleFrom: 'toc' },
      { title: 'Side Story: The Ferryman', content: para(300, 'ferry'), titleFrom: 'toc' },
      { title: 'Chapter 2: Old Debts', content: para(700, 'debt'), titleFrom: 'toc' },
    ],
  };
}

describe('parseTitle', () => {
  it.each([
    ['Chapter 12: The Fool', 12, 'The Fool'],
    ['CHAPTER XII. THE SEA', 12, 'THE SEA'],
    ['Chapter Twenty-One', 21, ''],
    ['Ch. 5 - Name', 5, 'Name'],
    ['12 - The Fool', 12, 'The Fool'],
    ['XII.', 12, ''],
    ['第12章 名字', 12, '名字'],
    ['Stave I: Marley’s Ghost', 1, 'Marley’s Ghost'],
  ])('%s', (t, n, name) => {
    expect(parseTitle(t)).toEqual({ number: n, name, chapterLike: true });
  });
  it('does not mistake ordinary titles for numbered ones', () => {
    expect(parseTitle('I Am Legend').chapterLike).toBe(false);
    expect(parseTitle('The Fool').chapterLike).toBe(false);
    expect(parseTitle('1984 Revisited').chapterLike).toBe(false);
  });
});

describe('web-novel layout', () => {
  it('flattens a book into a continuously numbered chapter list across volumes', () => {
    const vols = [bookOne(), bookTwo()];
    const plan = planLayout(vols, OPTS);
    const included = plan.filter((p) => p.include).map((p) => p.title);
    expect(included).toEqual([
      'Prologue',
      'Chapter 1',
      'Chapter 2: The Gate',
      'Chapter 3: Ash',
      'Chapter 4: Ember',
      'Afterword',
      'Chapter 5: New Dawn',
      'Side Story: The Ferryman',
      'Chapter 6: Old Debts',
    ]);
    expect(plan.filter((p) => !p.include).map((p) => p.originalTitle)).toEqual(['Title Page', 'Copyright', 'Contents', 'About the Author', 'Copyright']);
    expect(plan.find((p) => p.title === 'Chapter 1')!.notes).toContain('Joined its chapter-opener page');
    expect(plan.find((p) => p.title === 'Chapter 2: The Gate')!.notes).toContain('Re-joined text that was split across files');
    expect(plan.find((p) => p.title === 'Chapter 3: Ash')!.notes[0]).toMatch(/Split/);
    expect(plan.find((p) => p.title === 'Afterword')!.kind).toBe('extra');
    expect(plan.find((p) => p.originalTitle === 'Side Story: The Ferryman')!.kind).toBe('special');
  });

  it('never loses or changes a word, whatever the arrangement', () => {
    const vols = [bookOne(), bookTwo()];
    let plan = planLayout(vols, OPTS);
    let audit = auditPlan(vols, plan);
    expect(audit.ok).toBe(true);
    expect(audit.setAside.map((s) => s.title)).toEqual(['Title Page', 'Copyright', 'Contents', 'About the Author', 'Copyright']);
    expect(audit.keptWords + audit.setAsideWords).toBe(audit.sourceWords);

    // User joins "Chapter 4" back onto "Chapter 3": still nothing lost, numbering follows.
    const ch4 = plan.find((p) => p.title === 'Chapter 4: Ember')!;
    plan = mergeWithPrevious(plan, ch4.id, OPTS);
    audit = auditPlan(vols, plan);
    expect(audit.ok).toBe(true);
    expect(plan.find((p) => p.title === 'Chapter 4: New Dawn')).toBeTruthy();
    // The re-joined heading is put back exactly as it was.
    expect(plan.find((p) => p.title === 'Chapter 3: Ash')!.content).toContain('<h2>Chapter 4: Ember</h2>');
  });

  it('catches a changed or missing word, even after the check has run before', () => {
    const vols = [bookOne(), bookTwo()];
    const plan = planLayout(vols, OPTS);
    expect(auditPlan(vols, plan).ok).toBe(true);
    const i = plan.findIndex((p) => p.kind === 'chapter');
    const changed = plan.map((p, k) => (k === i ? { ...p, content: `${p.content}<p>One extra word.</p>` } : p));
    const bad = auditPlan(vols, changed);
    expect(bad.ok).toBe(false);
    expect(bad.mismatchAt).toBeGreaterThan(0);
    expect(auditPlan(vols, plan.filter((_, k) => k !== i)).ok).toBe(false);
    expect(auditPlan(vols, plan).ok).toBe(true);
  });

  it('keeps chapter HTML byte-for-byte when it only passes through', () => {
    const vols = [bookTwo()];
    const plan = planLayout(vols, OPTS);
    expect(plan.find((p) => p.title === 'Chapter 1: New Dawn')!.content).toBe(vols[0].sections[1].content);
  });

  it('can keep original titles and continue numbering from an existing novel', () => {
    const vols = [bookTwo()];
    const orig = planLayout(vols, { webTitles: false, startNumber: 1 });
    expect(orig.filter((p) => p.include).map((p) => p.title)).toEqual(['Chapter 1: New Dawn', 'Side Story: The Ferryman', 'Chapter 2: Old Debts']);
    const start = nextChapterNumber(['Prologue', 'Chapter 1', 'Chapter 2: The Gate', 'Chapter 4: Ember', 'Afterword']);
    expect(start).toBe(5);
    const cont = planLayout(vols, { webTitles: true, startNumber: start });
    expect(cont.filter((p) => p.include && p.number).map((p) => p.title)).toEqual(['Chapter 5: New Dawn', 'Chapter 6: Old Debts']);
  });

  it('lets set-aside items be brought back, and custom titles stick', () => {
    const vols = [bookOne()];
    let plan = planLayout(vols, OPTS);
    plan = renumber(
      plan.map((p) => (p.originalTitle === 'About the Author' ? { ...p, include: true } : p.originalTitle === 'Chapter 2: The Gate' ? { ...p, customTitle: 'The Gate (revised)' } : p)),
      OPTS,
    );
    expect(chaptersFromPlan(plan).map((c) => c.title)).toContain('About the Author');
    expect(chaptersFromPlan(plan).map((c) => c.title)).toContain('The Gate (revised)');
  });

  it('leaves a plain run of chapters alone', () => {
    const vols: Volume[] = [{ label: 'x', sections: [1, 2, 3].map((n) => ({ title: `Chapter ${n}`, content: para(300, `c${n}`), titleFrom: 'heading' as const })) }];
    const plan = planLayout(vols, OPTS);
    expect(plan.map((p) => [p.title, p.include])).toEqual([
      ['Chapter 1', true],
      ['Chapter 2', true],
      ['Chapter 3', true],
    ]);
    expect(auditPlan(vols, plan).ok).toBe(true);
  });

  it('does not merge untitled sections when the book has no contents at all', () => {
    const vols: Volume[] = [{ label: 'x', sections: [1, 2].map((n) => ({ title: `Section ${n}`, content: para(500, `s${n}`), titleFrom: 'generated' as const })) }];
    expect(planLayout(vols, OPTS).length).toBe(2);
  });

  it('suggests web titles only for books that already say "Chapter"', () => {
    expect(suggestWebTitles([bookTwo()])).toBe(true);
    const stave: Volume = { label: 'c', sections: ['Stave I: A', 'Stave II: B', 'Stave III: C'].map((t) => ({ title: t, content: para(10) })) };
    expect(suggestWebTitles([stave])).toBe(false);
  });

  it('guesses volume numbers for ordering', () => {
    expect(volumeNumber('Shadow Slave Vol. 3')).toBe(3);
    expect(volumeNumber('lord-of-mysteries-volume-12.epub')).toBe(12);
    expect(volumeNumber('Book 2: The Rise')).toBe(2);
    expect(volumeNumber('Untitled')).toBeNull();
  });
});
