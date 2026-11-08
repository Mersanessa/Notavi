import { readFileSync, writeFileSync } from 'node:fs';
const m = JSON.parse(readFileSync('monogram.json'));
const b = m.bbox; // N at size 400
const w = b.x2 - b.x1, h = b.y2 - b.y1;
// Place N centred-left in a 1024 square, lozenge to its upper right like the i-dot.
const scale = 560 / h;
const nx = 512 - (w * scale) / 2 - 40, ny = 512 + (h * scale) / 2 - 10;
const r = 60, lx = nx + w * scale + 92, ly = ny - h * scale + 58;
const icon = (bg, rx) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <defs><radialGradient id="g" cx="0.3" cy="0.22" r="0.9"><stop offset="0" stop-color="#1f2830"/><stop offset="1" stop-color="#11161b"/></radialGradient></defs>
  <rect width="1024" height="1024" rx="${rx}" fill="${bg}"/>
  <g transform="translate(${nx.toFixed(1)} ${ny.toFixed(1)}) scale(${scale.toFixed(4)}) translate(${-b.x1} ${-b.y2})"><path d="${m.d}" fill="#e9e2d4"/></g>
  <path d="M${lx} ${ly - r} L${lx + r * 0.78} ${ly} L${lx} ${ly + r} L${lx - r * 0.78} ${ly} Z" fill="#c8a15a"/>
</svg>`;
writeFileSync('icon.svg', icon('url(#g)', 228));
writeFileSync('icon-square.svg', icon('url(#g)', 0));
const wm = JSON.parse(readFileSync('wordmark.json'));
writeFileSync('wordmark.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${wm.viewBox}"><path d="${wm.letters}" fill="currentColor"/><path d="${wm.lozenge}" fill="#c8a15a"/></svg>`);
writeFileSync('p4.html', `<body style="margin:0;background:#2a2a2a;display:flex;gap:30px;align-items:center;padding:30px">
<img src="icon.svg" width="300"><img src="icon.svg" width="120"><img src="icon.svg" width="60"><img src="icon.svg" width="32">
<div style="background:#141a1f;color:#e9e2d4;padding:20px"><img src="wordmark.svg" width="260" style="filter:invert(0)"></div></body>`);
