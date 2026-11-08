import { describe, expect, it, beforeEach } from 'vitest';
import { MemoryDb } from '../../src/db/memory';
import * as N from '../../src/data/novels';
import { saveProgress } from '../../src/data/reading';
import { searchText } from '../../src/data/search';
import { chaptersFromPlan, planLayout, type Volume } from '../../src/import/layout';
import { htmlToText } from '../../src/lib/text';

let db: MemoryDb;
beforeEach(async () => {
  db = await MemoryDb.create();
});

const para = (n: number, tag: string) => `<p>${Array.from({ length: n }, (_, i) => `${tag}${i}`).join(' ')}.</p>`;
const book = (): Volume => ({
  label: 'Lantern',
  sections: [
    { title: 'Title Page', content: '<p>The Lantern Road</p>', role: 'front', titleFrom: 'toc' },
    { title: 'Copyright', content: '<p>Copyright © 2024 lighthouse.</p>', role: 'front', titleFrom: 'toc' },
    { title: 'Chapter One: The Gate', content: para(300, 'gate'), titleFrom: 'toc' },
    { title: 'Chapter Two: The Sea', content: para(300, 'sea'), titleFrom: 'toc' },
    { title: 'About the Author', content: '<p>Lives by the lighthouse.</p>', titleFrom: 'toc' },
  ],
});

async function importBook() {
  const plan = planLayout([book()], { webTitles: true, startNumber: 1 });
  return N.createNovel(db, { title: 'Lantern' }, { chapters: chaptersFromPlan(plan) });
}

describe('reading a novel as a web novel or as a book', () => {
  it('keeps every section on import: set-aside ones become book-only, and the book’s own titles are kept', async () => {
    const plan = planLayout([book()], { webTitles: true, startNumber: 1 });
    const chs = chaptersFromPlan(plan);
    // Nothing from the file is dropped.
    expect(chs.map((c) => htmlToText(c.content)).join(' ')).toBe(book().sections.map((s) => htmlToText(s.content)).join(' '));
    expect(chs.filter((c) => c.bookOnly).length).toBeGreaterThanOrEqual(2);
    const gate = chs.find((c) => c.content.includes('gate0'))!;
    expect(gate.title).toBe('Chapter 1: The Gate');
    expect(gate.originalTitle).toBe('Chapter One: The Gate');
  });

  it('shows front and back matter and original titles only as a book, and switches back without losing anything', async () => {
    const id = await importBook();
    const web = await N.listChapters(db, id);
    const all = await N.listChapters(db, id, { all: true });
    expect(all.length).toBeGreaterThan(web.length);
    expect(web.some((c) => c.title === 'Copyright')).toBe(false);
    expect((await N.getNovel(db, id))!.chapterCount).toBe(web.length);

    await N.updateNovel(db, id, { readingMode: 'book' });
    const asBook = await N.listChapters(db, id);
    expect(asBook.length).toBe(all.length);
    expect((await N.getNovel(db, id))!.chapterCount).toBe(all.length);
    expect(asBook.map((c) => N.displayTitle(c, 'book'))).toContain('Chapter One: The Gate');
    expect(asBook.map((c) => N.displayTitle(c, 'web'))).toContain('Chapter 1: The Gate');

    await N.updateNovel(db, id, { readingMode: 'web' });
    expect((await N.listChapters(db, id)).map((c) => c.id)).toEqual(web.map((c) => c.id));
  });

  it('counts progress by the chapters each format shows', async () => {
    const id = await importBook();
    const gate = (await N.listChapters(db, id)).find((c) => c.title.includes('Gate'))!;
    await saveProgress(db, { novelId: id, chapterId: gate.id, blockIndex: 0, blockOffset: 0, chapterRatio: 0 });
    expect((await N.getNovel(db, id))!.progress!.position).toBe(0); // first web-novel chapter
    expect((await N.getNovel(db, id))!.progress!.chapterTitle).toBe('Chapter 1: The Gate');
    await N.updateNovel(db, id, { readingMode: 'book' });
    const n = (await N.getNovel(db, id))!;
    expect(n.progress!.position).toBeGreaterThan(0); // after the title page and copyright
    expect(n.progress!.chapterTitle).toBe('Chapter One: The Gate');
  });

  it('searches book-only sections only when reading as a book', async () => {
    const id = await importBook();
    expect((await searchText(db, 'lighthouse', { novelId: id })).total).toBe(0);
    await N.updateNovel(db, id, { readingMode: 'book' });
    expect((await searchText(db, 'lighthouse', { novelId: id })).total).toBe(2);
  });

  it('lets a section move in and out of the web novel, and edits the right title', async () => {
    const id = await importBook();
    const about = (await N.listChapters(db, id, { all: true })).find((c) => c.title === 'About the Author')!;
    expect(about.bookOnly).toBe(true);
    await N.setChapterBookOnly(db, about.id, false);
    expect((await N.listChapters(db, id)).some((c) => c.id === about.id)).toBe(true);

    const gate = (await N.listChapters(db, id)).find((c) => c.title.includes('Gate'))!;
    await N.updateChapter(db, gate.id, { originalTitle: 'I. The Gate' });
    const after = (await N.getChapter(db, gate.id))!;
    expect(after.title).toBe('Chapter 1: The Gate');
    expect(after.originalTitle).toBe('I. The Gate');
    await N.updateChapter(db, gate.id, { title: 'Chapter 1: Gatehouse' });
    expect((await N.getChapter(db, gate.id))!.originalTitle).toBe('I. The Gate');
  });

  it('defaults to the web-novel format', async () => {
    const id = await N.createNovel(db, { title: 'Plain' }, { chapters: [{ title: 'A', content: '<p>x</p>' }] });
    expect((await N.getNovel(db, id))!.readingMode).toBe('web');
  });
});
