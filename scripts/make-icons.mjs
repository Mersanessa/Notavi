// Renders the app icon at every size needed (PWA, iOS, Tauri source). Run: npm run icons
import { chromium } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';

const svg = readFileSync('public/icons/icon.svg', 'utf8');
// Maskable / iOS variants: full-bleed square background, artwork inside the safe zone.
const square = svg.replace('rx="112"', 'rx="0"');
const maskable = square.replace('<rect x="136"', '<g transform="translate(51 51) scale(0.8)"><rect x="136"').replace('</svg>', '</g></svg>');
mkdirSync('src-tauri/icons', { recursive: true });
const jobs = [
  ['public/icons/icon-192.png', svg, 192],
  ['public/icons/icon-512.png', svg, 512],
  ['public/icons/icon-maskable-512.png', maskable, 512],
  ['public/icons/apple-touch-icon.png', square, 180],
  ['src-tauri/icons/source-1024.png', svg, 1024],
];
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome' });
const page = await browser.newPage();
for (const [out, markup, size] of jobs) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${markup.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: out, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  console.log('wrote', out);
}
await browser.close();
