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

// Android launcher icons. Every layer is full-bleed so no launcher ever shows a white plate or a frame:
// - adaptive: a background layer (the ink gradient) and a transparent foreground with the mark kept inside the
//   central safe zone (66 of 108 dp) so circles, squircles and teardrops never clip the lozenge;
// - legacy (launchers or themes that ignore adaptive icons): a full square and a full circle, no transparent margin.
{
  const body = square.replace(/^[\s\S]*?<\/defs>/, '').replace(/<\/svg>\s*$/, '');
  const defs = square.match(/<defs>[\s\S]*?<\/defs>/)[0];
  const mark = body.replace(/<rect[^>]*\/>/, '');
  // The mark's centre is (541, 501) in the 1024 artwork; scale it so its farthest corners sit inside the 66 dp safe circle.
  const fgSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><g transform="translate(512 512) scale(0.68) translate(-541 -501)">${mark}</g></svg>`;
  const bgSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">${defs}<rect width="1024" height="1024" fill="url(#g)"/></svg>`;
  const roundSvg = square.replace('<rect width="1024" height="1024" rx="0"', '<rect width="1024" height="1024" rx="512"');
  const dens = { mdpi: [48, 108], hdpi: [72, 162], xhdpi: [96, 216], xxhdpi: [144, 324], xxxhdpi: [192, 432] };
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome' });
  const p = await b.newPage();
  const shot = async (out, markup, size) => {
    await p.setViewportSize({ width: size, height: size });
    await p.setContent(`<html><body style="margin:0;background:transparent">${markup.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
    await p.screenshot({ path: out, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  };
  for (const [d, [legacy, layer]] of Object.entries(dens)) {
    const dir = `src-tauri/icons/android/mipmap-${d}`;
    mkdirSync(dir, { recursive: true });
    await shot(`${dir}/ic_launcher.png`, square, legacy);
    await shot(`${dir}/ic_launcher_round.png`, roundSvg, legacy);
    await shot(`${dir}/ic_launcher_foreground.png`, fgSvg, layer);
    await shot(`${dir}/ic_launcher_background.png`, bgSvg, layer);
  }
  console.log('wrote Android launcher icons');
  await b.close();
}
