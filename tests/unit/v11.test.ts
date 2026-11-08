import { describe, expect, it, beforeEach } from 'vitest';
import { MemoryDb } from '../../src/db/memory';
import * as N from '../../src/data/novels';
import * as A from '../../src/data/annotations';
import * as S from '../../src/data/search';
import { getStats, readingMsOn } from '../../src/data/stats';
import { logReading } from '../../src/data/reading';
import { DEFAULT_APP, resolveHomeOrder } from '../../src/app/prefs';
import { pickVoice, splitSentences } from '../../src/ui/reader/speech';
import { localDay } from '../../src/lib/text';

let db: MemoryDb;
beforeEach(async () => {
  db = await MemoryDb.create();
});

const chapter = { title: 'One', content: '<p>The first sentence is here. A second follows it!</p>' };

describe('ratings', () => {
  it('starts unrated, saves 1–5 stars, rejects anything else and sorts by rating', async () => {
    const a = await N.createNovel(db, { title: 'A' }, { chapters: [chapter] });
    const b = await N.createNovel(db, { title: 'B' }, { chapters: [chapter] });
    const c = await N.createNovel(db, { title: 'C' }, { chapters: [chapter] });
    expect((await N.getNovel(db, a))!.rating).toBe(0);
    await N.updateNovel(db, a, { rating: 3 });
    await N.updateNovel(db, b, { rating: 5 });
    expect((await N.getNovel(db, b))!.rating).toBe(5);
    await expect(N.updateNovel(db, c, { rating: 6 })).rejects.toThrow();
    const sorted = S.sortNovels(await N.listNovels(db), 'rating');
    expect(sorted.map((n) => n.title)).toEqual(['B', 'A', 'C']);
  });
});

describe('highlight of the day', () => {
  it('is null without highlights, stable for a day, and only uses highlights and notes long enough to read', async () => {
    expect(await A.highlightOfTheDay(db, '2026-11-08')).toBeNull();
    const id = await N.createNovel(db, { title: 'Quotes' }, { chapters: [chapter] });
    const [ch] = await N.listChapters(db, id);
    await A.addAnnotation(db, { novelId: id, chapterId: ch.id, kind: 'highlight', startOffset: 0, endOffset: 5, quote: 'Short' });
    await A.addAnnotation(db, { novelId: id, chapterId: ch.id, kind: 'chapter_bookmark', quote: 'A chapter bookmark with plenty of text in it' });
    expect(await A.highlightOfTheDay(db, '2026-11-08')).toBeNull();
    for (let i = 0; i < 5; i++) await A.addAnnotation(db, { novelId: id, chapterId: ch.id, kind: i % 2 ? 'note' : 'highlight', startOffset: 0, endOffset: 28, quote: `Quote number ${i} that is long enough`, note: i % 2 ? 'mine' : '' });
    const today = await A.highlightOfTheDay(db, '2026-11-08');
    expect(today?.quote).toMatch(/^Quote number/);
    expect(today?.novelTitle).toBe('Quotes');
    expect((await A.highlightOfTheDay(db, '2026-11-08'))?.id).toBe(today?.id);
    const days = new Set<string>();
    for (let d = 1; d <= 20; d++) days.add((await A.highlightOfTheDay(db, `2026-11-${String(d).padStart(2, '0')}`))!.id);
    expect(days.size).toBeGreaterThan(1); // it does change from day to day
  });
});

describe('daily goal data', () => {
  it('counts only today’s reading', async () => {
    const id = await N.createNovel(db, { title: 'Goal' }, { chapters: [chapter] });
    const [ch] = await N.listChapters(db, id);
    await logReading(db, { novelId: id, chapterId: ch.id, startedAt: Date.now() - 2 * 86400000, durationMs: 9 * 60000 });
    await logReading(db, { novelId: id, chapterId: ch.id, startedAt: Date.now() - 1000, durationMs: 7 * 60000 });
    expect(await readingMsOn(db, localDay())).toBe(7 * 60000);
    expect((await getStats(db)).readingMsToday).toBe(7 * 60000);
  });
});

describe('home order', () => {
  it('slots sections added in later versions into an older saved order', () => {
    const old = ['continue', 'recentChapters', 'stats', 'favourites'] as const;
    const order = resolveHomeOrder([...old]);
    expect(order[0]).toBe('continue');
    expect(order[1]).toBe('today');
    expect(new Set(order).size).toBe(DEFAULT_APP.homeOrder.length);
    expect(order.indexOf('stats')).toBeLessThan(order.indexOf('favourites')); // your order is kept
    expect(resolveHomeOrder(DEFAULT_APP.homeOrder)).toEqual(DEFAULT_APP.homeOrder);
  });
});

describe('read aloud helpers', () => {
  it('splits text into sentences with exact offsets', () => {
    const t = '“Who’s there?” said Scrooge. Nobody answered… The door creaked!  Then silence';
    const s = splitSentences(t, 'en');
    expect(s.length).toBeGreaterThanOrEqual(4);
    for (const x of s) expect(t.slice(x.start, x.end)).toBe(x.text);
    expect(s.map((x) => x.text).join(' ').replace(/\s+/g, ' ')).toBe(t.replace(/\s+/g, ' '));
  });

  it('prefers the chosen voice, then British English, then on-device voices', () => {
    const v = (id: string, lang: string, local = true) => ({ id, lang, local, name: id });
    const voices = [v('us', 'en-US'), v('gb-online', 'en-GB', false), v('gb', 'en-GB'), v('fr', 'fr-FR')];
    expect(pickVoice(voices, 'fr', 'en')?.id).toBe('fr');
    expect(pickVoice(voices, null, 'en')?.id).toBe('gb');
    expect(pickVoice(voices, null, 'en-US')?.id).toBe('us');
    expect(pickVoice(voices, null, 'fr')?.id).toBe('fr');
    expect(pickVoice(voices, null, 'ja')).toBeNull();
  });
});
