// Renders the app icons from icon.html.
//
//   node tools/icons/render-icons.mjs                 # shipped design -> frontend/public/icons
//   node tools/icons/render-icons.mjs flat            # pure-white plate variant instead
//   node tools/icons/render-icons.mjs <mode> <dir>    # also emit comparison previews into <dir>
//
// Shipped design ("D"): a whisper-light cool gradient plate with single-hue
// blue (sky -> blue) equalizer bars — clean, Apple-style, on a near-white tile.
// Each icon is rasterised at its exact target pixel size; the glyph is vector,
// so edges are pixel-crisp at every size.
//
// Playwright's chromium is only installed in the tests/e2e workspace, so we
// resolve the package from there.
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('../../tests/e2e/node_modules/@playwright/test');

const here = dirname(fileURLToPath(import.meta.url));
const htmlUrl = pathToFileURL(resolve(here, 'icon.html')).href;
const outDir = resolve(here, '../../frontend/public/icons');

// Default plate is the subtle gradient; `flat` forces a pure-white plate.
const bgParam = process.argv[2] === 'flat' ? '' : '&bg=gradient';
const previewDir = process.argv[3] ? resolve(process.cwd(), process.argv[3]) : null;
// Shipped bars are single-hue blue (the icon.html `blue` gradient).
const colorParam = '&color=blue';

const browser = await chromium.launch();

async function shoot(url, size, path) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.goto(url, { waitUntil: 'load' });
  await page.screenshot({ path, clip: { x: 0, y: 0, width: size, height: size } });
  await page.close();
  console.log('wrote', path);
}

// Final app-icon set. Maskable gets extra padding so the glyph stays inside
// the inner-80% safe zone after the platform masks the corners.
const icons = [
  { file: 'icon-192.png', size: 192, scale: 64 },
  { file: 'icon-512.png', size: 512, scale: 64 },
  { file: 'icon-1024.png', size: 1024, scale: 64 },
  { file: 'icon-maskable-512.png', size: 512, scale: 54 },
  { file: 'apple-touch-icon.png', size: 180, scale: 64 },
];
for (const i of icons) {
  await shoot(`${htmlUrl}?scale=${i.scale}${bgParam}${colorParam}`, i.size, resolve(outDir, i.file));
}

// Optional side-by-side previews for picking a style.
if (previewDir) {
  const previews = [
    { file: 'preview-flat-512.png', q: '?scale=64' },
    { file: 'preview-gradient-512.png', q: '?scale=64&bg=gradient' },
    { file: 'preview-mock-flat-512.png', q: '?scale=62&round=1' },
    { file: 'preview-mock-gradient-512.png', q: '?scale=62&round=1&bg=gradient' },
  ];
  for (const pv of previews) {
    await shoot(`${htmlUrl}${pv.q}`, 512, resolve(previewDir, pv.file));
  }
}

await browser.close();
