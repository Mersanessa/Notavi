import opentype from 'opentype.js';
import { readFileSync, writeFileSync } from 'node:fs';
const font = opentype.parse(readFileSync('node_modules/@fontsource/fraunces/files/fraunces-latin-600-normal.woff').buffer.slice(0));
const size = 200;
const text = 'Notavi';
// Lay out glyph by glyph so the i can lose its dot.
const glyphPaths = font.getPaths(text, 0, 0, size, { kerning: true, letterSpacing: -0.018 });
const parts = [];
let dot = null;
glyphPaths.forEach((p, i) => {
  if (text[i] === 'i') {
    const contours = [];
    let cur = [];
    for (const c of p.commands) { if (c.type === 'M' && cur.length) { contours.push(cur); cur = []; } cur.push(c); } if (cur.length) contours.push(cur);
    const bbox = (cs) => { const xs = [], ys = []; cs.forEach((c) => { for (const k of ['x', 'y', 'x1', 'y1', 'x2', 'y2']) if (c[k] !== undefined) (k.startsWith('x') ? xs : ys).push(c[k]); }); return { x1: Math.min(...xs), x2: Math.max(...xs), y1: Math.min(...ys), y2: Math.max(...ys) }; };
    const withBox = contours.map((cs) => ({ cs, b: bbox(cs) })).sort((a, b) => a.b.y1 - b.b.y1);
    dot = withBox[0].b;
    const keep = new opentype.Path();
    withBox.slice(1).forEach(({ cs }) => cs.forEach((c) => keep.commands.push(c)));
    parts.push(keep);
  } else parts.push(p);
});
const d = parts.map((p) => p.toPathData(2)).join(' ');
const all = new opentype.Path(); parts.forEach((p) => p.commands.forEach((c) => all.commands.push(c)));
const bb = all.getBoundingBox();
// Brass lozenge where the dot was: a little larger, a diamond.
const r = Math.max(dot.x2 - dot.x1, dot.y2 - dot.y1) * 0.66, cx = (dot.x1 + dot.x2) / 2, cy = (dot.y1 + dot.y2) / 2 - r * 0.32;
const lozenge = `M${cx.toFixed(2)} ${(cy - r).toFixed(2)} L${(cx + r * 0.78).toFixed(2)} ${cy.toFixed(2)} L${cx.toFixed(2)} ${(cy + r).toFixed(2)} L${(cx - r * 0.78).toFixed(2)} ${cy.toFixed(2)} Z`;
const pad = 6;
const vb = [bb.x1 - pad, Math.min(bb.y1, cy - r) - pad, bb.x2 - bb.x1 + pad * 2, Math.max(bb.y2, cy + r) - Math.min(bb.y1, cy - r) + pad * 2].map((n) => n.toFixed(1)).join(' ');
writeFileSync('wordmark.json', JSON.stringify({ viewBox: vb, letters: d, lozenge, letterPaths: parts.map((p) => p.toPathData(2)) }));
// Monogram N
const n = font.charToGlyph('N').getPath(0, 0, 400);
const nb = n.getBoundingBox();
writeFileSync('monogram.json', JSON.stringify({ d: n.toPathData(2), bbox: nb }));
console.log(vb, JSON.stringify(nb));
