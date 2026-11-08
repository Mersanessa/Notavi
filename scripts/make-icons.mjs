// Renders the app icon at every size needed (PWA, iOS, Tauri source). Run: npm run icons
// Sources: public/icons/icon.svg (rounded) and public/icons/icon-square.svg (full bleed, for maskable/iOS/Tauri).
import { chromium } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';

const rounded = readFileSync('public/icons/icon.svg', 'utf8');
const square = readFileSync('public/icons/icon-square.svg', 'utf8');
mkdirSync('src-tauri/icons', { recursive: true });
const jobs = [
  ['public/icons/icon-192.png', rounded, 192],
  ['public/icons/icon-512.png', rounded, 512],
  ['public/icons/icon-maskable-512.png', square, 512],
  ['public/icons/apple-touch-icon.png', square, 180],
  ['src-tauri/icons/source-1024.png', square, 1024],
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
