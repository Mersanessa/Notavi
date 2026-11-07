// Generates test fixtures in ./fixtures. Run: npm run fixtures
// Texts are short public-domain excerpts (Austen 1813, Carroll 1865, Dickens 1843,
// Conan Doyle 1891, Wu Cheng'en 16th c.) padded with original filler prose so
// chapters are long enough to exercise scrolling. Transcribed from memory, so
// minor differences from canonical editions are possible.
import JSZip from 'jszip';
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2] || 'fixtures';
mkdirSync(OUT, { recursive: true });
const w = (name, data) => writeFileSync(join(OUT, name), data);

/* ---------------------------------------------------------------- filler prose (original) */
const SUBJECTS = ['The lamplighter', 'An old clerk', 'The wind off the river', 'A tired carriage horse', 'The housekeeper', 'Somebody upstairs', 'The rain', 'A boy with a lantern', 'The church clock', 'Her aunt'];
const VERBS = ['passed slowly along', 'waited beside', 'considered', 'hurried past', 'returned to', 'looked across', 'settled upon', 'circled', 'remembered', 'listened at'];
const OBJECTS = ['the narrow street', 'the cold window', 'the unopened letter', 'the long table', 'the iron gate', 'the quiet square', 'the last of the candles', 'the half-finished map', 'the kitchen door', 'the road to town'];
const TAILS = ['as evening came on.', 'without a word to anyone.', 'and thought better of it.', 'while the fire burned low.', 'though nobody noticed.', 'for the third time that week.', 'as if expecting company.', 'and then, at last, went home.'];
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9) >>> 0) / 4294967296);
}
function filler(seed, paragraphs = 8) {
  const r = rng(seed);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const out = [];
  for (let p = 0; p < paragraphs; p++) {
    const n = 3 + Math.floor(r() * 4);
    const s = [];
    for (let i = 0; i < n; i++) s.push(`${pick(SUBJECTS)} ${pick(VERBS)} ${pick(OBJECTS)} ${pick(TAILS)}`);
    out.push(s.join(' '));
  }
  return out;
}

/* ---------------------------------------------------------------- public-domain excerpts */
const PRIDE = [
  'It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.',
  'However little known the feelings or views of such a man may be on his first entering a neighbourhood, this truth is so well fixed in the minds of the surrounding families, that he is considered the rightful property of some one or other of their daughters.',
  '“My dear Mr. Bennet,” said his lady to him one day, “have you heard that Netherfield Park is let at last?”',
  'Mr. Bennet replied that he had not.',
  '“But it is,” returned she; “for Mrs. Long has just been here, and she told me all about it.”',
  'Mr. Bennet made no answer.',
  '“Do you not want to know who has taken it?” cried his wife impatiently.',
  '“You want to tell me, and I have no objection to hearing it.”',
  'This was invitation enough.',
];
const ALICE = [
  'Alice was beginning to get very tired of sitting by her sister on the bank, and of having nothing to do: once or twice she had peeped into the book her sister was reading, but it had no pictures or conversations in it, “and what is the use of a book,” thought Alice “without pictures or conversations?”',
  'So she was considering in her own mind (as well as she could, for the hot day made her feel very sleepy and stupid), whether the pleasure of making a daisy-chain would be worth the trouble of getting up and picking the daisies, when suddenly a White Rabbit with pink eyes ran close by her.',
  'There was nothing so very remarkable in that; nor did Alice think it so very much out of the way to hear the Rabbit say to itself, “Oh dear! Oh dear! I shall be late!”',
];
const ALICE2 = [
  '“Curiouser and curiouser!” cried Alice (she was so much surprised, that for the moment she quite forgot how to speak good English).',
];
const CAROL = [
  'Marley was dead: to begin with. There is no doubt whatever about that. The register of his burial was signed by the clergyman, the clerk, the undertaker, and the chief mourner. Scrooge signed it: and Scrooge’s name was good upon ’Change, for anything he chose to put his hand to.',
  'Old Marley was as dead as a door-nail.',
];
const CAROL2 = ['When Scrooge awoke, it was so dark, that looking out of bed, he could scarcely distinguish the transparent window from the opaque walls of his chamber.'];
const CAROL3 = ['The Phantom slowly, gravely, silently, approached. When it came near him, Scrooge bent down upon his knee; for in the very air through which this Spirit moved it seemed to scatter gloom and mystery.'];
const HOLMES = [
  'To Sherlock Holmes she is always the woman. I have seldom heard him mention her under any other name. In his eyes she eclipses and predominates the whole of her sex.',
  'It was not that he felt any emotion akin to love for Irene Adler.',
];
const HOLMES2 = ['My friend Watson, as he was so often reminded, had been away from Baker Street for some weeks when this curious affair began.'];

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const paras = (list) => list.map((p) => `<p>${esc(p)}</p>`).join('\n');

/* ---------------------------------------------------------------- PNG encoder */
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function png(width, height, color) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b] = color(x, y);
      const o = y * (width * 3 + 1) + 1 + x * 3;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const coverPng = png(300, 450, (x, y) => [40 + (y / 450) * 60, 60 + (x / 300) * 40, 90]);
const illustration = png(120, 80, (x, y) => ((x >> 3) + (y >> 3)) % 2 ? [200, 170, 110] : [60, 70, 80]);

/* ---------------------------------------------------------------- EPUB builder */
const xhtml = (title, body) => `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en">
<head><title>${esc(title)}</title><style>p{margin:0}</style></head>
<body>
${body}
</body>
</html>`;

async function epub({ name, version = '3.0', meta, files, spine, nav, ncx, extra = {}, cover, mutate }) {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  const items = [];
  for (const [path, content] of Object.entries(files)) {
    const type = path.endsWith('.png') ? 'image/png' : path.endsWith('.ncx') ? 'application/x-dtbncx+xml' : 'application/xhtml+xml';
    const id = path.replace(/[^a-z0-9]/gi, '_');
    const props = [path === nav ? 'nav' : '', path === cover ? 'cover-image' : ''].filter(Boolean).join(' ');
    items.push(`<item id="${id}" href="${path}" media-type="${type}"${props ? ` properties="${props}"` : ''}/>`);
    zip.file(`OEBPS/${path}`, content);
  }
  const spineXml = spine.map((s) => `<itemref idref="${s.replace(/[^a-z0-9]/gi, '_')}"/>`).join('');
  zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="${version}" unique-identifier="uid" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
<metadata>
<dc:identifier id="uid">urn:notavi:fixture:${name}</dc:identifier>
${meta}
${version.startsWith('2') && cover ? `<meta name="cover" content="${cover.replace(/[^a-z0-9]/gi, '_')}"/>` : ''}
</metadata>
<manifest>${items.join('\n')}</manifest>
<spine${ncx ? ` toc="${ncx.replace(/[^a-z0-9]/gi, '_')}"` : ''}>${spineXml}</spine>
</package>`);
  for (const [p, c] of Object.entries(extra)) zip.file(p, c);
  if (mutate) mutate(zip);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/* 1. EPUB 3: nav, cover, illustration, centred scene break, chapter titles from nav */
w('alice-excerpt.epub', await epub({
  name: 'alice',
  meta: `<dc:title id="t1">Alice’s Adventures in Wonderland (excerpt)</dc:title>
<meta refines="#t1" property="title-type">main</meta>
<dc:title id="t2">Alice in Wonderland</dc:title>
<dc:creator id="c1">Lewis Carroll</dc:creator><meta refines="#c1" property="role">aut</meta>
<dc:language>en-GB</dc:language>
<dc:subject>Fantasy</dc:subject><dc:subject>Classic</dc:subject>
<dc:publisher>Notavi test fixture</dc:publisher>
<dc:description>&lt;p&gt;A short excerpt used to test Notavi’s EPUB import.&lt;/p&gt;</dc:description>`,
  nav: 'nav.xhtml',
  cover: 'images/cover.png',
  files: {
    'nav.xhtml': xhtml('Contents', `<nav epub:type="toc"><h1>Contents</h1><ol><li><a href="text/ch1.xhtml">Down the Rabbit-Hole</a></li><li><a href="text/ch2.xhtml">The Pool of Tears</a></li></ol></nav>`),
    'text/cover.xhtml': xhtml('Cover', `<div><img src="../images/cover.png" alt="Cover"/></div>`),
    'text/ch1.xhtml': xhtml('Chapter I', `<h1>Down the Rabbit-Hole</h1>\n${paras(ALICE)}\n<p style="text-align:center">* * *</p>\n<p><img src="../images/rabbit.png" alt="A checked pattern"/></p>\n${paras(filler(1, 14))}\n<p onclick="alert(1)">A paragraph with <em>emphasis</em>, <strong>strength</strong> and <a href="https://example.com">a link</a>.</p><script>alert('x')</script>`),
    'text/ch2.xhtml': xhtml('Chapter II', `<h1>The Pool of Tears</h1>\n${paras(ALICE2)}\n${paras(filler(2, 12))}`),
    'images/cover.png': coverPng,
    'images/rabbit.png': illustration,
  },
  spine: ['text/cover.xhtml', 'text/ch1.xhtml', 'text/ch2.xhtml'],
}));

/* 2. EPUB 2: NCX, several chapters inside one file (Gutenberg style) */
const carolBody = [
  `<h2 id="stave1">Stave One: Marley’s Ghost</h2>`, paras(CAROL), paras(filler(11, 10)),
  `<div class="chapter"><h2 id="stave2">Stave Two: The First of the Three Spirits</h2>`, paras(CAROL2), paras(filler(12, 10)), `</div>`,
  `<h2 id="stave3">Stave Three: The Last of the Spirits</h2>`, paras(CAROL3), paras(filler(13, 10)),
].join('\n');
w('christmas-carol-epub2.epub', await epub({
  name: 'carol',
  version: '2.0',
  meta: `<dc:title>A Christmas Carol (excerpt)</dc:title><dc:creator opf:role="aut">Charles Dickens</dc:creator><dc:creator opf:role="trl">Nobody (test)</dc:creator><dc:language>en</dc:language><dc:subject>Ghost stories</dc:subject>`,
  ncx: 'toc.ncx',
  cover: 'cover.png',
  files: {
    'toc.ncx': `<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><navMap>
<navPoint id="n1" playOrder="1"><navLabel><text>Stave I: Marley’s Ghost</text></navLabel><content src="carol.xhtml#stave1"/></navPoint>
<navPoint id="n2" playOrder="2"><navLabel><text>Stave II: The First of the Three Spirits</text></navLabel><content src="carol.xhtml#stave2"/></navPoint>
<navPoint id="n3" playOrder="3"><navLabel><text>Stave III: The Last of the Spirits</text></navLabel><content src="carol.xhtml#stave3"/></navPoint>
</navMap></ncx>`,
    'carol.xhtml': xhtml('A Christmas Carol', carolBody),
    'cover.png': coverPng,
  },
  spine: ['carol.xhtml'],
}));

/* 3. Plain text in Project Gutenberg layout, hard-wrapped, with chapter headings */
const wrap = (s) => s.replace(/(.{1,70})(\s+|$)/g, '$1\n').trim();
const prideTxt = `The Project Gutenberg eBook of Pride and Prejudice (excerpt)

Title: Pride and Prejudice

Author: Jane Austen

Language: English

*** START OF THE PROJECT GUTENBERG EBOOK PRIDE AND PREJUDICE ***




PRIDE AND PREJUDICE

By Jane Austen



Chapter 1

${PRIDE.map(wrap).join('\n\n')}

${filler(21, 8).map(wrap).join('\n\n')}

* * *

${filler(22, 6).map(wrap).join('\n\n')}



Chapter 2

Mr. Bennet was among the earliest of those who waited on Mr. Bingley.

${filler(23, 10).map(wrap).join('\n\n')}



CHAPTER III.

${filler(24, 10).map(wrap).join('\n\n')}

*** END OF THE PROJECT GUTENBERG EBOOK PRIDE AND PREJUDICE ***

Updated editions will replace the previous one. This is licence boilerplate that should be removed.
`;
w('pride-and-prejudice-gutenberg.txt', prideTxt.replace(/\n/g, '\r\n'));

/* 4. The same kind of text in Windows-1252 with curly quotes */
const cp1252 = (s) => Buffer.from(s.replace(/[“”]/g, '"').replace(/’/g, "'").replace(/é/g, 'é'), 'latin1');
w('legacy-cp1252.txt', cp1252(`Chapter One: The Café\n\nThe café on the corner was closing. ${filler(31, 1)[0]}\n\nChapter Two: Afterwards\n\n${filler(32, 3).join('\n\n')}\n`));

/* 5. Single HTML file with h2 chapters */
w('scandal-in-bohemia.html', `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>A Scandal in Bohemia (excerpt)</title><meta name="author" content="Arthur Conan Doyle"><meta name="keywords" content="Detective, Victorian"></head>
<body><h1>A Scandal in Bohemia</h1><p>Some front matter before the first chapter that is long enough to count as an opening section because it goes on for quite a while and has more than forty words in it, mentioning Baker Street, the fog, the fire, the violin and the lodgings that Holmes and Watson shared for so many years in London.</p>
<h2>I.</h2>${paras(HOLMES)}${paras(filler(41, 10))}
<h2>II.</h2>${paras(HOLMES2)}${paras(filler(42, 10))}<img src="https://example.com/remote.png"><img src="data:image/png;base64,${illustration.toString('base64')}" alt="inline">
<h2>III.</h2>${paras(filler(43, 10))}<iframe src="https://example.com"></iframe></body></html>`);

/* 6. Markdown with front matter */
w('lamplighter-notes.md', `---
title: The Lamplighter's Notes
author: Notavi Fixtures
tags: [Original, Short]
genres: Slice of life
description: An original test text written for Notavi.
---

# The Lamplighter's Notes

## First Evening

${filler(51, 6).join('\n\n')}

> A quotation, set apart.

## Second Evening

${filler(52, 6).join('\n\n')}

***

${filler(53, 3).join('\n\n')}

## Third Evening

Some *emphasis*, some **strong text**, and <script>alert(1)</script> raw HTML that must be removed.

${filler(54, 6).join('\n\n')}
`);

/* 7. CJK chapter headings (Journey to the West, 16th century, opening line) */
w('xiyouji-excerpt.txt', `第一回 灵根育孕源流出 心性修持大道生\n\n诗曰：混沌未分天地乱，茫茫渺渺无人见。\n\n${'这是测试用的段落。'.repeat(30)}\n\n第二回 悟彻菩提真妙理 断魔归本合元神\n\n${'这是第二回的测试段落。'.repeat(30)}\n`);

/* 8. No headings at all → split by size */
w('no-headings.txt', filler(61, 160).join('\n\n'));

/* 9. Roman numeral headings */
w('roman-numerals.txt', ['I.', 'II.', 'III.', 'IV.'].map((h, i) => `${h}\n\n${filler(70 + i, 4).join('\n\n')}`).join('\n\n\n'));

/* ---------------------------------------------------------------- malformed files */
const M = join(OUT, 'malformed');
mkdirSync(M, { recursive: true });
const wm = (name, data) => writeFileSync(join(M, name), data);
const good = await epub({ name: 'base', meta: '<dc:title>Base</dc:title>', files: { 'a.xhtml': xhtml('A', '<h1>A</h1><p>Text.</p>') }, spine: ['a.xhtml'] });
wm('truncated.epub', good.subarray(0, Math.floor(good.length / 2)));
wm('not-really.epub', 'This is plain text pretending to be an EPUB.');
wm('empty.txt', '');
wm('binary.txt', Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 7919) % 256)));
wm('document.pdf', '%PDF-1.4\n%âãÏÓ\n1 0 obj\n<<>>\nendobj\n');
wm('book.mobi', 'BOOKMOBI fake');
wm('no-text.html', '<html><body><div></div><script>alert(1)</script></body></html>');
wm('drm.epub', await epub({
  name: 'drm', meta: '<dc:title>Locked</dc:title>', files: { 'a.xhtml': xhtml('A', '<p>Encrypted gibberish</p>') }, spine: ['a.xhtml'],
  extra: { 'META-INF/encryption.xml': `<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#"><enc:EncryptedData><enc:EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes128-cbc"/><enc:CipherData><enc:CipherReference URI="OEBPS/a.xhtml"/></enc:CipherData></enc:EncryptedData></encryption>` },
}));
wm('no-opf.epub', await epub({ name: 'noopf', meta: '', files: { 'a.xhtml': xhtml('A', '<p>x</p>') }, spine: [], mutate: (z) => { z.remove('OEBPS/content.opf'); z.file('META-INF/container.xml', '<container/>'); } }));
wm('broken-opf.epub', await epub({ name: 'badopf', meta: '', files: {}, spine: [], mutate: (z) => z.file('OEBPS/content.opf', '<package><metadata><dc:title>Unclosed') }));
wm('malformed-xhtml.epub', await epub({
  name: 'malformed', meta: '<dc:title>Sloppy Markup</dc:title>',
  files: { 'a.xhtml': '<html><body><h1>Chapter One</h1><p>Unclosed paragraph &nbsp; with an entity<p>Another <b>bold</body>', 'b.xhtml': xhtml('B', '<h1>Chapter Two</h1><p>Fine.</p>') },
  spine: ['a.xhtml', 'b.xhtml'],
}));
wm('missing-chapter.epub', await epub({
  name: 'missing', meta: '<dc:title>Missing Pieces</dc:title>',
  files: { 'a.xhtml': xhtml('A', '<h1>Present</h1><p>Here.</p><img src="gone.png"/>'), 'b.xhtml': xhtml('B', '<p>Soon removed</p>') },
  spine: ['a.xhtml', 'b.xhtml'], mutate: (z) => z.remove('OEBPS/b.xhtml'),
}));
wm('no-chapters.epub', await epub({ name: 'nochap', meta: '<dc:title>Hollow</dc:title>', files: { 'a.xhtml': xhtml('A', '<div>   </div>') }, spine: ['a.xhtml'] }));

console.log(`Fixtures written to ${OUT}/`);
