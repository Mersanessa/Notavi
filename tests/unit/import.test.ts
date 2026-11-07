import { describe, expect, it, beforeAll } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { parseFile, ImportError } from '../../src/import';
import { splitAt } from '../../src/import/dom';
import { detectHeadings, textToHtml } from '../../src/import/txt';
import { decodeText } from '../../src/import/errors';
import { resolveHref } from '../../src/import/epub';
import { MemoryDb } from '../../src/db/memory';
import { importParsed, listChapters, getChapter, getNovel, getBlob } from '../../src/data/novels';
import { searchText } from '../../src/data/search';

const DIR = join(__dirname, '../../fixtures');
const load = (name: string) => new Uint8Array(readFileSync(join(DIR, name)));
const parse = (name: string) => parseFile(name.split('/').pop()!, load(name));

beforeAll(() => {
  execSync('node scripts/make-fixtures.mjs', { cwd: join(__dirname, '../..') });
});

describe('EPUB', () => {
  it('imports an EPUB 3 with nav titles, metadata, cover and images, and strips unsafe markup', async () => {
    const n = await parse('alice-excerpt.epub');
    expect(n.title).toBe('Alice’s Adventures in Wonderland (excerpt)');
    expect(n.altTitles).toEqual(['Alice in Wonderland']);
    expect(n.author).toBe('Lewis Carroll');
    expect(n.language).toBe('en-GB');
    expect(n.genres).toEqual(['Fantasy', 'Classic']);
    expect(n.description).toContain('short excerpt');
    expect(n.description).not.toContain('<p>');
    expect(n.cover?.mime).toBe('image/png');
    expect(n.chapters.map((c) => c.title)).toEqual(['Down the Rabbit-Hole', 'The Pool of Tears']); // cover page skipped
    const ch1 = n.chapters[0].content;
    expect(ch1).toContain('Alice was beginning');
    expect(ch1).not.toMatch(/<h1/); // duplicate title removed
    expect(ch1).toMatch(/<em>emphasis<\/em>/);
    expect(ch1).not.toMatch(/onclick|<script|alert|href=/);
    expect(ch1).toContain('data-align="center"');
    expect(n.images).toHaveLength(1);
    expect(ch1).toContain(`notavi-blob:${n.images![0].id}`);
  });

  it('splits an EPUB 2 file with several chapters at NCX anchors', async () => {
    const n = await parse('christmas-carol-epub2.epub');
    expect(n.author).toBe('Charles Dickens');
    expect(n.translator).toBe('Nobody (test)');
    expect(n.cover).toBeTruthy();
    expect(n.chapters.map((c) => c.title)).toEqual([
      'Stave I: Marley’s Ghost',
      'Stave II: The First of the Three Spirits',
      'Stave III: The Last of the Spirits',
    ]);
    expect(n.chapters[0].content).toContain('Marley was dead');
    expect(n.chapters[0].content).not.toContain('When Scrooge awoke');
    expect(n.chapters[1].content).toContain('When Scrooge awoke');
    expect(n.chapters[1].content).not.toContain('Phantom');
    expect(n.chapters[2].content).toContain('Phantom');
  });

  it('reads malformed XHTML leniently and reports it', async () => {
    const n = await parse('malformed/malformed-xhtml.epub');
    expect(n.chapters.map((c) => c.title)).toEqual(['Chapter One', 'Chapter Two']);
    expect(n.chapters[0].content).toContain('Another');
    expect(n.warnings.join(' ')).toMatch(/malformed/);
  });

  it('skips missing chapter files and images with warnings', async () => {
    const n = await parse('malformed/missing-chapter.epub');
    expect(n.chapters).toHaveLength(1);
    expect(n.warnings.join(' ')).toMatch(/missing/);
    expect(n.warnings.join(' ')).toMatch(/image/);
  });

  it.each([
    ['malformed/truncated.epub', /isn't a valid EPUB/],
    ['malformed/not-really.epub', /isn't an EPUB/],
    ['malformed/drm.epub', /DRM/],
    ['malformed/no-opf.epub', /package file/],
    ['malformed/broken-opf.epub', /damaged/],
    ['malformed/no-chapters.epub', /readable chapters/],
  ])('fails gracefully on %s', async (file, msg) => {
    const err = await parse(file).catch((e) => e);
    expect(err).toBeInstanceOf(ImportError);
    expect(err.message).toMatch(msg);
  });

  it('resolves relative hrefs', () => {
    expect(resolveHref('OEBPS/text/', '../images/a%20b.png#x')).toEqual(['OEBPS/images/a b.png', 'x']);
    expect(resolveHref('', 'ch1.xhtml')).toEqual(['ch1.xhtml', '']);
  });
});

describe('TXT', () => {
  it('detects chapters, strips the Gutenberg wrapper, joins hard-wrapped lines and keeps scene breaks', async () => {
    const n = await parse('pride-and-prejudice-gutenberg.txt');
    expect(n.title).toBe('Pride and Prejudice');
    expect(n.author).toBe('Jane Austen');
    expect(n.source).toBe('Project Gutenberg');
    expect(n.chapters.map((c) => c.title)).toEqual(['Chapter 1', 'Chapter 2', 'Chapter III.']); // short title page dropped
    const ch1 = n.chapters[0].content;
    expect(ch1).toContain('<p>It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.</p>');
    expect(ch1).toContain('<hr>');
    expect(n.chapters.map((c) => c.content).join('')).not.toMatch(/licence boilerplate|START OF/);
    expect(n.warnings.join(' ')).toMatch(/Gutenberg/);
  });

  it('decodes Windows-1252 and warns', async () => {
    const n = await parse('legacy-cp1252.txt');
    expect(n.chapters[0].title).toBe('Chapter One: The Café');
    expect(n.warnings.join(' ')).toMatch(/WINDOWS-1252/);
  });

  it('handles CJK chapter headings', async () => {
    const n = await parse('xiyouji-excerpt.txt');
    expect(n.chapters.map((c) => c.title)).toEqual(['第一回 灵根育孕源流出 心性修持大道生', '第二回 悟彻菩提真妙理 断魔归本合元神']);
  });

  it('handles bare roman numeral headings', async () => {
    const n = await parse('roman-numerals.txt');
    expect(n.chapters.map((c) => c.title)).toEqual(['I.', 'II.', 'III.', 'IV.']);
  });

  it('splits text without headings into parts', async () => {
    const n = await parse('no-headings.txt');
    expect(n.chapters.length).toBeGreaterThan(1);
    expect(n.chapters[0].title).toBe('Part 1');
    expect(n.warnings.join(' ')).toMatch(/No chapter headings/);
  });

  it('does not treat numbered prose as headings', () => {
    const lines = ['1', '', 'Text here', '', 'He counted 2 apples, then 3,', '', '2', '', 'More', '', '3', '', 'End'].map((t, i, a) => ({
      text: t,
      blankBefore: i === 0 || a[i - 1] === '',
      blankAfter: i === a.length - 1 || a[i + 1] === '',
    }));
    expect(detectHeadings(lines)).toEqual([0, 6, 10]);
  });

  it('keeps short-line verse and escapes HTML in plain text', () => {
    expect(textToHtml('A longer opening paragraph of prose that runs on.\n\nRoses red,\nviolets blue.')).toContain('<p>Roses red,<br>violets blue.</p>');
    expect(textToHtml('One line per paragraph.\nAnother paragraph.')).toBe('<p>One line per paragraph.</p>\n<p>Another paragraph.</p>');
    expect(textToHtml('a <b> & c')).toBe('<p>a &lt;b&gt; &amp; c</p>');
  });

  it.each([
    ['malformed/empty.txt', /empty/],
    ['malformed/binary.txt', /doesn't look like a text file/],
    ['malformed/document.pdf', /PDF/],
    ['malformed/book.mobi', /\.mobi/],
  ])('fails gracefully on %s', async (file, msg) => {
    const err = await parse(file).catch((e) => e);
    expect(err).toBeInstanceOf(ImportError);
    expect(err.message).toMatch(msg);
  });

  it('decodes BOMs', () => {
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x68, 0x69])).text).toBe('hi');
    expect(decodeText(new Uint8Array([0xff, 0xfe, 0x68, 0, 0x69, 0])).text).toBe('hi');
  });
});

describe('HTML and Markdown', () => {
  it('splits HTML at h2 with h1 as the book title, keeps inline images, drops remote ones', async () => {
    const n = await parse('scandal-in-bohemia.html');
    expect(n.title).toBe('A Scandal in Bohemia (excerpt)');
    expect(n.author).toBe('Arthur Conan Doyle');
    expect(n.tags).toEqual(['Detective', 'Victorian']);
    expect(n.chapters.map((c) => c.title)).toEqual(['Opening', 'I.', 'II.', 'III.']);
    expect(n.images).toHaveLength(1);
    expect(n.warnings.join(' ')).toMatch(/1 image/);
    expect(n.chapters.map((c) => c.content).join('')).not.toMatch(/iframe|example\.com/);
  });

  it('imports Markdown with front matter', async () => {
    const n = await parse('lamplighter-notes.md');
    expect(n.title).toBe("The Lamplighter's Notes");
    expect(n.author).toBe('Notavi Fixtures');
    expect(n.tags).toEqual(['Original', 'Short']);
    expect(n.genres).toEqual(['Slice of life']);
    expect(n.chapters.map((c) => c.title)).toEqual(['First Evening', 'Second Evening', 'Third Evening']);
    expect(n.chapters[0].content).toContain('<blockquote>');
    expect(n.chapters[2].content).toContain('<em>emphasis</em>');
    expect(n.chapters[2].content).not.toContain('script');
  });

  it('rejects HTML with no text', async () => {
    await expect(parse('malformed/no-text.html')).rejects.toThrow(/no readable text/);
  });
});

describe('splitting', () => {
  it('splits nested structures at markers without losing or duplicating text', () => {
    const doc = new DOMParser().parseFromString('<body><div class="c"><h2 id="a">A</h2><p>one</p><div><h2 id="b">B</h2><p>two</p></div></div><p>tail</p></body>', 'text/html');
    const { lead, sections } = splitAt(doc.body, [doc.getElementById('a')!, doc.getElementById('b')!]);
    expect(lead).toBe('');
    expect(sections[0]).toBe('<div class="c"><h2 id="a">A</h2><p>one</p></div>');
    expect(sections[1]).toBe('<div class="c"><div><h2 id="b">B</h2><p>two</p></div></div><p>tail</p>');
  });
});

describe('storing imports', () => {
  it('stores every fixture and makes it searchable', async () => {
    const db = await MemoryDb.create();
    const files = readdirSync(DIR).filter((f) => !f.startsWith('.') && f !== 'malformed' && f !== 'README.md');
    for (const f of files) {
      const parsed = await parse(f);
      const id = await importParsed(db, parsed, { contentType: 'public_domain' });
      const n = (await getNovel(db, id))!;
      expect(n.chapterCount, f).toBe(parsed.chapters.length);
      expect(n.contentType).toBe('public_domain');
    }
    const alice = await parse('alice-excerpt.epub');
    const id = await importParsed(db, alice);
    const n = (await getNovel(db, id))!;
    expect((await getBlob(db, n.coverId!))!.mime).toBe('image/png');
    const ch = await getChapter(db, (await listChapters(db, id))[0].id);
    const blobId = ch!.content.match(/notavi-blob:([a-z0-9-]+)/)![1];
    expect((await getBlob(db, blobId))!.data.length).toBeGreaterThan(50);
    expect((await searchText(db, 'rabbit pink eyes')).total).toBeGreaterThan(0);
  });
});
