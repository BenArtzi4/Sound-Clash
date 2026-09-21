// Renders the five PWA / home-screen icons into frontend/public/icons/.
//
//   node tools/og-image/render-icons.mjs
//
// Same design as the link-preview card ("Orange knockout"): a flat --accent
// #ff7a00 tile with the equaliser mark in black. At the ~48px a phone home
// screen actually draws, the wordmark is unreadable, so the icons are the mark
// alone — the letters only ever appear on the card.
//
// The tiles are full-bleed squares with square corners on purpose. Every
// platform applies its own mask (iOS squircle, Android circle/squircle/
// teardrop), so baking in a radius would show up as a dark notch inside the
// OS's own rounding.
//
// Like render.mjs this borrows the chromium installed in tests/e2e. If it is
// missing: `cd tests/e2e && npx playwright install chromium`.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require('../../tests/e2e/node_modules/@playwright/test');

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '../../frontend/public/icons');

const GROUND = '#ff7a00'; // --accent
const INK = '#000000'; // --accent-ink; cream on this orange is ~2:1 and fails

// Verbatim from EqualizerMark in frontend/src/components/icons.tsx — same
// 24-unit grid, same 2.5 stroke, same round caps, so the icon is the app's
// mark and not a redrawing of it.
const BARS = ['M5 15v-6', 'M9.5 19V5', 'M14 17V7', 'M18.5 15v-6'];

// The mark's box as a fraction of the tile. 0.58 is the value the approved
// design was reviewed at; it puts the drawn ink at ~0.39 of the tile, which
// clears the maskable safe zone with room to spare (asserted below).
const MARK_SCALE = 0.58;

const ICONS = [
  { file: 'icon-192.png', size: 192 },
  { file: 'icon-512.png', size: 512 },
  { file: 'icon-1024.png', size: 1024 },
  // Identical artwork: a centred mark on a flat ground is already maskable —
  // there is no corner detail to lose. It exists as its own file because the
  // manifest declares purpose "maskable" separately from "any".
  { file: 'icon-maskable-512.png', size: 512, maskable: true },
  // iOS home screen. Referenced from index.html, not the manifest, and iOS
  // ignores transparency — hence the opaque ground.
  { file: 'apple-touch-icon.png', size: 180 },
];

function tileHtml(size) {
  const mark = Math.round(size * MARK_SCALE);
  const paths = BARS.map((d) => `<path d="${d}" stroke-width="2.5" />`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    *{margin:0;padding:0;box-sizing:border-box}
    html,body{width:${size}px;height:${size}px}
    body{background:${GROUND};display:grid;place-items:center;overflow:hidden}
    svg{display:block}
  </style></head><body>
    <svg viewBox="0 0 24 24" width="${mark}" height="${mark}" fill="none"
         stroke="${INK}" stroke-linecap="round" aria-hidden="true">${paths}</svg>
  </body></html>`;
}

// Measures the icon that was actually written to disk: decode the PNG in the
// browser, scan for pixels that are not the orange ground, and report the ink's
// bounding box. This checks the output file rather than the intent, so a
// mis-sized or mis-centred mark cannot pass.
async function measureInk(page, file, size) {
  const b64 = readFileSync(resolve(outDir, file)).toString('base64');
  return page.evaluate(
    async ({ b64, size }) => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + b64;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      const { data } = c.getContext('2d').getImageData(0, 0, c.width, c.height);
      let minX = c.width, minY = c.height, maxX = -1, maxY = -1;
      for (let y = 0; y < c.height; y++) {
        for (let x = 0; x < c.width; x++) {
          const i = (y * c.width + x) * 4;
          // Ground is #ff7a00; anything meaningfully darker is ink. The
          // threshold ignores the anti-aliased rim of the round caps.
          if (data[i] < 200 || data[i + 1] > 160 || data[i + 2] > 80) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      const cx = c.width / 2;
      const cy = c.height / 2;
      const corners = [[minX, minY], [maxX, minY], [minX, maxY], [maxX, maxY]];
      const maxRadius = Math.max(...corners.map(([x, y]) => Math.hypot(x - cx, y - cy)));
      return {
        width: c.width,
        height: c.height,
        ink: { minX, minY, maxX, maxY },
        inkW: maxX - minX + 1,
        inkH: maxY - minY + 1,
        maxRadius,
        expected: size,
      };
    },
    { b64, size },
  );
}

const browser = await chromium.launch();
const page = await browser.newPage();
const problems = [];
const rows = [];

for (const icon of ICONS) {
  await page.setViewportSize({ width: icon.size, height: icon.size });
  await page.setContent(tileHtml(icon.size), { waitUntil: 'load' });
  await page.screenshot({
    path: resolve(outDir, icon.file),
    clip: { x: 0, y: 0, width: icon.size, height: icon.size },
    type: 'png',
  });

  const m = await measureInk(page, icon.file, icon.size);
  if (m.width !== icon.size || m.height !== icon.size) {
    problems.push(`${icon.file}: wrote ${m.width}x${m.height}, expected ${icon.size}x${icon.size}`);
  }
  // Centred within a pixel or two, allowing for the odd/even rounding of the
  // mark box against the tile.
  const offX = (m.ink.minX + m.ink.maxX + 1) / 2 - m.width / 2;
  const offY = (m.ink.minY + m.ink.maxY + 1) / 2 - m.height / 2;
  if (Math.abs(offX) > icon.size * 0.02 || Math.abs(offY) > icon.size * 0.02) {
    problems.push(`${icon.file}: mark off-centre by ${offX.toFixed(1)},${offY.toFixed(1)}px`);
  }
  // Android crops a maskable icon to a circle, squircle or teardrop depending
  // on the launcher; only the centre 80% circle is guaranteed to survive.
  const safeRadius = icon.size * 0.4;
  const pct = ((m.maxRadius / safeRadius) * 100).toFixed(0);
  if (icon.maskable && m.maxRadius > safeRadius) {
    problems.push(
      `${icon.file}: ink reaches ${m.maxRadius.toFixed(0)}px from centre, past the ${safeRadius}px safe radius`,
    );
  }
  rows.push(
    `  ${icon.file.padEnd(24)} ${String(m.width).padStart(4)}px  ink ${String(m.inkW).padStart(4)}x${String(m.inkH).padEnd(4)} ` +
      `(${((m.inkW / m.width) * 100).toFixed(0)}% of tile)  safe-zone use ${pct}%${icon.maskable ? '  <- maskable' : ''}`,
  );
}

await browser.close();

console.log(rows.join('\n'));
if (problems.length) {
  console.error('\nicon check failed:\n  - ' + problems.join('\n  - '));
  process.exit(1);
}
console.log(`\nwrote ${ICONS.length} icons to ${outDir}`);
