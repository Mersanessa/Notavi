import { describe, expect, it, beforeEach } from 'vitest';
import { MemoryDb } from '../../src/db/memory';
import * as N from '../../src/data/novels';
import * as R from '../../src/data/reading';
import * as A from '../../src/data/annotations';
import * as C from '../../src/data/collections';
import * as S from '../../src/data/search';
import { getStats, computeStreaks, recommend } from '../../src/data/stats';
import { getSetting, setSetting } from '../../src/data/settings';
import { localDay, toFtsQuery } from '../../src/lib/text';

let db: MemoryDb;

const chapters = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ title: `Chapter ${i + 1}`, content: `<p>Paragraph one of chapter ${i + 1}. The lighthouse keeper waited.</p><p>Second paragraph ${i + 1}.</p>` }));

beforeEach(async () => {
  db = await MemoryDb.create();
});

describe('schema', () => {
  it('migrates an empty database and records the version', async () => {
    const v = await db.get<{ value: string }>("SELECT value FROM meta WHERE key='schema_version'");
    expect(Number(v!.value)).toBeGreaterThan(0);
  });
});

describe('novels and chapters', () => {
  it('creates a novel with chapters and summarises it', async () => {
    const id = await N.createNovel(db, { title: '  The Lighthouse  ', author: 'A. Keeper', genres: ['Mystery', 'mystery', 'Drama'] }, { chapters: chapters(3) });
    const n = (await N.getNovel(db, id))!;
    expect(n.title).toBe('The Lighthouse');
    expect(n.genres).toEqual(['Mystery', 'Drama']);
    expect(n.chapterCount).toBe(3);
    expect(n.totalWords).toBeGreaterThan(20);
    expect(n.status).toBe('want_to_read');
    expect(n.percent).toBe(0);
  });

  it('rejects an empty title', async () => {
    await expect(N.createNovel(db, { title: '   ' })).rejects.toThrow(/title/i);
  });

  it('adds, inserts, edits, reorders and deletes chapters keeping positions contiguous', async () => {
    const id = await N.createNovel(db, { title: 'T' }, { chapters: chapters(3) });
    const c0 = await N.addChapter(db, id, { title: 'Prologue', content: '<p>Before.</p>' }, 0);
    let list = await N.listChapters(db, id);
    expect(list.map((c) => c.title)).toEqual(['Prologue', 'Chapter 1', 'Chapter 2', 'Chapter 3']);
    expect(list.map((c) => c.position)).toEqual([0, 1, 2, 3]);

    await N.updateChapter(db, list[1].id, { title: 'One', content: '<p>Rewritten zebra text</p>' });
    expect((await N.getChapter(db, list[1].id))!.title).toBe('One');
    expect((await S.searchText(db, 'zebra')).total).toBe(1);

    await N.moveChapter(db, c0, 3);
    list = await N.listChapters(db, id);
    expect(list.map((c) => c.title)).toEqual(['One', 'Chapter 2', 'Chapter 3', 'Prologue']);

    await N.deleteChapter(db, list[1].id);
    list = await N.listChapters(db, id);
    expect(list.map((c) => c.position)).toEqual([0, 1, 2]);
    expect(list.map((c) => c.title)).toEqual(['One', 'Chapter 3', 'Prologue']);

    await expect(N.reorderChapters(db, id, [list[0].id])).rejects.toThrow();
  });

  it('updates metadata and keeps the search index in sync', async () => {
    const id = await N.createNovel(db, { title: 'Old Name' });
    await N.updateNovel(db, id, { title: 'Shadowed Spire', altTitles: ['Torre Sombría'], tags: ['slow burn'] });
    expect(await S.searchNovelIds(db, 'spire')).toEqual([id]);
    expect(await S.searchNovelIds(db, 'sombria')).toEqual([id]); // diacritics folded
    expect(await S.searchNovelIds(db, 'old name')).toEqual([]);
    expect(await S.searchNovelIds(db, 'slow bu')).toEqual([id]); // prefix while typing
  });

  it('deletes a novel and everything that belongs to it, including the search index', async () => {
    const id = await N.createNovel(db, { title: 'Doomed' }, { chapters: chapters(2), cover: { mime: 'image/png', data: new Uint8Array([1, 2, 3]) } });
    const ch = (await N.listChapters(db, id))[0];
    await R.saveProgress(db, { novelId: id, chapterId: ch.id, blockIndex: 1, blockOffset: 0, chapterRatio: 0.5 });
    await A.addAnnotation(db, { novelId: id, chapterId: ch.id, kind: 'chapter_bookmark' });
    const col = await C.createCollection(db, 'Shelf');
    await C.addToCollection(db, col, id);
    await N.deleteNovel(db, id);
    for (const t of ['novels', 'chapters', 'blobs', 'progress', 'chapter_reads', 'annotations', 'collection_items', 'novel_fts', 'chapter_fts']) {
      expect((await db.get<{ n: number }>(`SELECT count(*) AS n FROM ${t}`))!.n, t).toBe(0);
    }
  });

  it('stores and replaces covers', async () => {
    const id = await N.createNovel(db, { title: 'C' });
    const c1 = await N.setCover(db, id, { mime: 'image/jpeg', data: new Uint8Array([9, 9]) });
    expect((await N.getBlob(db, c1!))!.data).toEqual(new Uint8Array([9, 9]));
    await N.setCover(db, id, null);
    expect(await N.getBlob(db, c1!)).toBeUndefined();
    expect((await N.getNovel(db, id))!.coverId).toBeNull();
  });
});

describe('progress', () => {
  it('saves and restores position, moves Want to Read to Reading and completes chapters', async () => {
    const id = await N.createNovel(db, { title: 'P' }, { chapters: chapters(4) });
    const list = await N.listChapters(db, id);
    await R.saveProgress(db, { novelId: id, chapterId: list[1].id, blockIndex: 7, blockOffset: 0.25, chapterRatio: 0.4 });
    const p = (await R.getProgress(db, id))!;
    expect(p).toMatchObject({ chapterId: list[1].id, blockIndex: 7, blockOffset: 0.25, chapterRatio: 0.4 });
    let n = (await N.getNovel(db, id))!;
    expect(n.status).toBe('reading');
    expect(n.percent).toBeCloseTo((1 + 0.4) / 4);
    expect(n.chaptersRead).toBe(0);

    await R.saveProgress(db, { novelId: id, chapterId: list[1].id, blockIndex: 20, blockOffset: 0, chapterRatio: 1 });
    n = (await N.getNovel(db, id))!;
    expect(n.chaptersRead).toBe(1);
    const meta = await N.listChapters(db, id);
    expect(meta[1].completed).toBe(true);
    expect(meta[0].completed).toBe(false);

    await R.markReadUpTo(db, id, 1);
    expect((await N.getNovel(db, id))!.chaptersRead).toBe(2);
    await R.setChapterRead(db, id, list[0].id, false);
    expect((await N.getNovel(db, id))!.chaptersRead).toBe(1);
  });

  it('survives a "restart" (export + reopen)', async () => {
    const id = await N.createNovel(db, { title: 'Persist' }, { chapters: chapters(2) });
    const list = await N.listChapters(db, id);
    await R.saveProgress(db, { novelId: id, chapterId: list[1].id, blockIndex: 3, blockOffset: 0.5, chapterRatio: 0.6 });
    const reopened = await MemoryDb.create(await db.exportBytes());
    expect(await R.getProgress(reopened, id)).toMatchObject({ chapterId: list[1].id, blockIndex: 3, blockOffset: 0.5 });
  });

  it('lists recently read chapters', async () => {
    const id = await N.createNovel(db, { title: 'Recent' }, { chapters: chapters(3) });
    const list = await N.listChapters(db, id);
    await R.saveProgress(db, { novelId: id, chapterId: list[0].id, blockIndex: 0, blockOffset: 0, chapterRatio: 0.1 }, 1000);
    await R.saveProgress(db, { novelId: id, chapterId: list[2].id, blockIndex: 0, blockOffset: 0, chapterRatio: 0.1 }, 2000);
    const recent = await R.recentlyReadChapters(db);
    expect(recent.map((r) => r.chapterTitle)).toEqual(['Chapter 3', 'Chapter 1']);
  });
});

describe('annotations', () => {
  it('adds, edits, lists and deletes bookmarks, highlights and notes', async () => {
    const id = await N.createNovel(db, { title: 'Notes' }, { chapters: chapters(2) });
    const [c1, c2] = await N.listChapters(db, id);
    expect(await A.toggleChapterBookmark(db, id, c2.id)).toBe(true);
    const h = await A.addAnnotation(db, { novelId: id, chapterId: c1.id, kind: 'highlight', startOffset: 5, endOffset: 20, quote: 'graph one of c', color: 'sage' });
    await A.addAnnotation(db, { novelId: id, chapterId: c1.id, kind: 'note', startOffset: 30, endOffset: 40, quote: 'x', note: 'Remember this' });
    await expect(A.addAnnotation(db, { novelId: id, chapterId: c1.id, kind: 'highlight', startOffset: 5, endOffset: 5 })).rejects.toThrow();
    await A.updateAnnotation(db, h, { note: 'Nice line', color: 'rose' });
    const all = await A.listAnnotationsForNovel(db, id);
    expect(all.map((a) => a.kind)).toEqual(['highlight', 'note', 'chapter_bookmark']);
    expect(all[0]).toMatchObject({ note: 'Nice line', color: 'rose', chapterTitle: 'Chapter 1' });
    expect(await A.annotationCounts(db, id)).toMatchObject({ highlight: 1, note: 1, chapter_bookmark: 1 });
    expect(await A.toggleChapterBookmark(db, id, c2.id)).toBe(false);
    await A.deleteAnnotation(db, h);
    expect((await A.listAnnotationsForChapter(db, c1.id)).length).toBe(1);
  });
});

describe('collections', () => {
  it('manages collections and membership', async () => {
    const a = await N.createNovel(db, { title: 'A' });
    const b = await N.createNovel(db, { title: 'B' });
    const col = await C.createCollection(db, 'Night reads', 'For late');
    await C.addToCollection(db, col, a);
    await C.addToCollection(db, col, b);
    await C.addToCollection(db, col, b); // idempotent
    expect(await C.collectionNovelIds(db, col)).toEqual([a, b]);
    await C.reorderCollectionItems(db, col, [b, a]);
    expect(await C.collectionNovelIds(db, col)).toEqual([b, a]);
    expect((await C.getCollection(db, col))!.novelCount).toBe(2);
    expect(await C.collectionsForNovel(db, a)).toEqual([col]);
    await C.updateCollection(db, col, { name: 'Late reads' });
    expect((await C.listCollections(db))[0].name).toBe('Late reads');
    await expect(C.createCollection(db, ' ')).rejects.toThrow();
    await C.removeFromCollection(db, col, a);
    await C.deleteCollection(db, col);
    expect(await C.listCollections(db)).toEqual([]);
  });
});

describe('search', () => {
  it('builds safe FTS queries from arbitrary input', () => {
    expect(toFtsQuery('hello wor')).toBe('"hello" "wor"*');
    expect(toFtsQuery('"exact phrase" more')).toBe('"exact phrase" "more"*');
    expect(toFtsQuery('NOT AND OR ( ) * : ^')).toBe('"NOT" "AND" "OR"*');
    expect(toFtsQuery('   ')).toBe('');
  });

  it('finds text across the library and within one novel, with highlighted snippets', async () => {
    const a = await N.createNovel(db, { title: 'A' }, { chapters: [{ title: 'One', content: '<p>The <b>crimson</b> moon rose over Tingen.</p>' }] });
    await N.createNovel(db, { title: 'B' }, { chapters: [{ title: 'Uno', content: '<p>A crimson tide &amp; a <script>x</script> grey sky.</p>' }] });
    const all = await S.searchText(db, 'crimson');
    expect(all.total).toBe(2);
    const within = await S.searchText(db, 'crimson', { novelId: a });
    expect(within.total).toBe(1);
    expect(within.hits[0].snippet).toContain('<mark>crimson</mark>');
    expect(within.hits[0].snippet).not.toContain('<b>');
    const odd = await S.searchText(db, '<img src=x onerror=alert(1)> crimson');
    expect(odd.hits.every((h) => !h.snippet.includes('<img'))).toBe(true);
  });

  it('filters and sorts', async () => {
    const now = Date.now();
    const a = await N.createNovel(db, { title: 'Alpha', genres: ['Fantasy'], favourite: true });
    const b = await N.createNovel(db, { title: 'beta', genres: ['Mystery'], status: 'completed' });
    const list = await N.listNovels(db);
    expect(S.filterNovels(list, { favouritesOnly: true }).map((n) => n.id)).toEqual([a]);
    expect(S.filterNovels(list, { genres: ['mystery'] }).map((n) => n.id)).toEqual([b]);
    expect(S.filterNovels(list, { statuses: ['completed', 'reading'] }).map((n) => n.id)).toEqual([b]);
    expect(S.filterNovels(list, { addedWithinDays: 7 }, now + 30 * 86400000)).toEqual([]);
    expect(S.sortNovels(list, 'title').map((n) => n.title)).toEqual(['Alpha', 'beta']);
    expect(S.sortNovels(list, 'title', 'desc').map((n) => n.title)).toEqual(['beta', 'Alpha']);
    expect((await N.allGenresAndTags(db)).genres).toEqual(['Fantasy', 'Mystery']);
  });
});

describe('stats', () => {
  it('computes streaks', () => {
    expect(computeStreaks(['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-05'], '2026-01-05')).toEqual({ current: 1, longest: 3 });
    expect(computeStreaks(['2026-01-03', '2026-01-04'], '2026-01-05')).toEqual({ current: 2, longest: 2 });
    expect(computeStreaks(['2026-01-01'], '2026-01-05')).toEqual({ current: 0, longest: 1 });
    expect(computeStreaks(['2026-02-28', '2026-03-01'], '2026-03-01')).toEqual({ current: 2, longest: 2 });
  });

  it('derives stats from real activity only', async () => {
    let s = await getStats(db);
    expect(s.readingMs).toBe(0);
    expect(s.currentStreak).toBe(0);
    expect(s.days.every((d) => d.ms === 0)).toBe(true);

    const id = await N.createNovel(db, { title: 'S' }, { chapters: chapters(2) });
    const [c1] = await N.listChapters(db, id);
    await R.logReading(db, { novelId: id, chapterId: c1.id, startedAt: Date.now(), durationMs: 5 * 60000 });
    await R.logReading(db, { novelId: id, chapterId: c1.id, startedAt: Date.now(), durationMs: 500 }); // dropped
    await R.markChapterCompleted(db, id, c1.id);
    s = await getStats(db);
    expect(s.readingMs).toBe(5 * 60000);
    expect(s.chaptersRead).toBe(1);
    expect(s.currentStreak).toBe(1);
    expect(s.days.at(-1)).toMatchObject({ day: localDay(), ms: 5 * 60000, chapters: 1 });
    expect(s.months.at(-1)!.ms).toBe(5 * 60000);
    expect(s.topNovels[0]).toMatchObject({ novelId: id, title: 'S' });

    await N.deleteNovel(db, id); // history is kept
    s = await getStats(db);
    expect(s.readingMs).toBe(5 * 60000);
    expect(s.topNovels[0].title).toBe('Deleted novel');
  });

  it('recommends unstarted novels similar to liked ones', async () => {
    await N.createNovel(db, { title: 'Liked', genres: ['Mystery'], tags: ['Victorian'], favourite: true, status: 'completed' });
    const match = await N.createNovel(db, { title: 'Match', genres: ['Mystery'], tags: ['Victorian', 'Occult'] });
    await N.createNovel(db, { title: 'Other', genres: ['Romance'] });
    const recs = recommend(await N.listNovels(db));
    expect(recs.map((r) => r.novel.id)).toEqual([match]);
    expect(recs[0].reason).toContain('Mystery');
  });
});

describe('settings', () => {
  it('round-trips and merges defaults', async () => {
    expect(await getSetting(db, 'x', { a: 1, b: 2 })).toEqual({ a: 1, b: 2 });
    await setSetting(db, 'x', { a: 5 });
    expect(await getSetting(db, 'x', { a: 1, b: 2 })).toEqual({ a: 5, b: 2 });
  });
});

describe('restore', () => {
  it('validates, replaces and can undo', async () => {
    await N.createNovel(db, { title: 'Keep me' });
    const other = await MemoryDb.create();
    await N.createNovel(other, { title: 'From backup' });
    await N.createNovel(other, { title: 'Also from backup' });
    const res = await db.replaceWith(await other.exportBytes());
    expect(res.novels).toBe(2);
    expect((await N.listNovels(db)).map((n) => n.title).sort()).toEqual(['Also from backup', 'From backup']);
    expect(await db.undoReplace()).toBe(true);
    expect((await N.listNovels(db)).map((n) => n.title)).toEqual(['Keep me']);
    await expect(db.replaceWith(new Uint8Array(2000))).rejects.toThrow(/Notavi library/);
  });
});
