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

// Render at 2x device scale so the 1200x630 logical card rasterises to a
// 2400x1260 image. WhatsApp/iMessage re-encode and downscale the preview on
// their own servers; feeding them a supersampled source keeps text and the
// logo crisp after that pass instead of soft. The og:image:width/height meta
// in frontend/index.html must match these output pixels.
//
// --allow-file-access-from-files: the card pulls its two woff2 files from
// frontend/public/fonts over file://. Without the flag Chromium treats every
// file:// document as its own opaque origin and refuses the @font-face fetch,
// and the card would render in a system face with no error anywhere.
const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
const page = await browser.newPage({
  viewport: { width: 1200, height: 630 },
  deviceScaleFactor: 2,
});
await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });

const report = await page.evaluate(async () => {
  // font-display: block only fetches a face when something on the page needs
  // it, so ask for both explicitly before reading their status. A missing file
  // rejects here — swallow that so it surfaces as a readable problem below
  // (the face is left at status "error") instead of an uncaught NetworkError.
  await Promise.all([
    document.fonts.load('136px "Anton"', 'Sound Clash').catch(() => {}),
    document.fonts.load('600 30px "Instrument Sans"', 'Name the song. Buzz first.').catch(() => {}),
  ]);
  await document.fonts.ready.catch(() => {});
  return {
    faces: [...document.fonts].map((f) => ({ family: f.family, status: f.status })),
    antonCheck: document.fonts.check('136px "Anton"'),
    uiCheck: document.fonts.check('600 30px "Instrument Sans"'),
    lockupWidth: document.querySelector('.wordmark').getBoundingClientRect().width,
    taglineWidth: document.querySelector('.tagline').getBoundingClientRect().width,
  };
});

// document.fonts.check() on its own is NOT a guard: per spec it returns true
// when *no* face matches the family, because nothing then needs loading — i.e.
// it reports success in exactly the silent-fallback case we care about. The
// per-face status scan is the assertion that actually bites; check() is kept
// alongside it to catch a face that parsed but does not cover the text.
const loaded = (family) => report.faces.some((f) => f.family === family && f.status === 'loaded');
const problems = [];
if (!loaded('Anton')) problems.push('Anton did not load');
if (!loaded('Instrument Sans')) problems.push('Instrument Sans did not load');
if (!report.antonCheck) problems.push('document.fonts.check() false for Anton');
if (!report.uiCheck) problems.push('document.fonts.check() false for Instrument Sans');
// A card whose lockup runs past the frame is clipped, and clipping is not
// obvious in a thumbnail. Fail on it rather than ship it.
if (report.lockupWidth > 1104) problems.push(`lockup ${Math.round(report.lockupWidth)}px exceeds the 1104px safe width`);
if (report.lockupWidth < 600) problems.push(`lockup only ${Math.round(report.lockupWidth)}px — the display face probably fell back`);
if (problems.length) {
  await browser.close();
  console.error('font/layout check failed:\n  - ' + problems.join('\n  - '));
  console.error('faces:', JSON.stringify(report.faces));
  process.exit(1);
}

const isJpeg = /\.jpe?g$/i.test(outPath);
await page.screenshot({
  path: outPath,
  clip: { x: 0, y: 0, width: 1200, height: 630 },
  ...(isJpeg ? { type: 'jpeg', quality: 92 } : {}),
});
await browser.close();
console.log(
  `wrote ${outPath}\n  fonts ok (Anton, Instrument Sans) · lockup ${Math.round(report.lockupWidth)}px · tagline ${Math.round(report.taglineWidth)}px`,
);
