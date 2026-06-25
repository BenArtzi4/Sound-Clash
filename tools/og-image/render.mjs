// Renders card.html to the 1200x630 social link-preview image.
//
//   node tools/og-image/render.mjs                 # -> frontend/public/og-image.jpg
//   node tools/og-image/render.mjs out.png         # PNG instead (bigger)
//
// Playwright's chromium is only installed in the tests/e2e workspace, so we
// resolve the package from there. If the browser is missing, run
// `npx playwright install chromium` inside tests/e2e first.
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('../../tests/e2e/node_modules/@playwright/test');

const here = dirname(fileURLToPath(import.meta.url));
const htmlPath = resolve(here, 'card.html');
const outPath = process.argv[2]
  ? resolve(process.cwd(), process.argv[2])
  : resolve(here, '../../frontend/public/og-image.jpg');

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1200, height: 630 },
  deviceScaleFactor: 1,
});
await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);
const isJpeg = /\.jpe?g$/i.test(outPath);
await page.screenshot({
  path: outPath,
  clip: { x: 0, y: 0, width: 1200, height: 630 },
  ...(isJpeg ? { type: 'jpeg', quality: 90 } : {}),
});
await browser.close();
console.log('wrote', outPath);
