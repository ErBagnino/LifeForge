// Renders the PWA icons from scripts/icon.svg.mjs using Playwright's Chromium.
// Usage: npm run icons   (requires a Playwright install; icons are committed, so this is only needed after artwork changes)
import { writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { iconSvg } from './icon.svg.mjs';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('Playwright not found. Install it (npm i -D playwright) or set NODE_PATH to a global install.');
  process.exit(1);
}

const out = new URL('../public/', import.meta.url);
mkdirSync(new URL('icons/', out), { recursive: true });
writeFileSync(new URL('favicon.svg', out), iconSvg({ size: 64 }));

const targets = [
  { file: 'icons/icon-192.png', size: 192, rounded: false, scale: 1 },
  { file: 'icons/icon-512.png', size: 512, rounded: false, scale: 1 },
  { file: 'icons/icon-maskable-512.png', size: 512, rounded: false, scale: 0.72 },
  { file: 'apple-touch-icon.png', size: 180, rounded: false, scale: 0.94 },
];

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage();
for (const t of targets) {
  await page.setViewportSize({ width: t.size, height: t.size });
  await page.setContent(`<html><body style="margin:0">${iconSvg(t)}</body></html>`);
  const buf = await page.locator('svg').screenshot({ omitBackground: true });
  writeFileSync(new URL(t.file, out), buf);
  console.info('wrote', t.file);
}
await browser.close();
