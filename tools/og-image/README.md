# Brand images: link-preview card + app icons

Two generators, one design. Both draw the equaliser mark from
`frontend/src/components/icons.tsx` on the app's accent orange.

| Output | Source | Command |
|---|---|---|
| `frontend/public/og-image.jpg` (2400×1260) | `card.html` | `node tools/og-image/render.mjs` |
| `frontend/public/icons/*.png` (5 files) | `render-icons.mjs` | `node tools/og-image/render-icons.mjs` |

Both drive the chromium that ships with the `tests/e2e` Playwright install. If
the browser is missing: `cd tests/e2e && npx playwright install chromium`.

## The design — "Orange knockout"

Flat `--accent` `#ff7a00`, everything on it in black. Chosen (2026-09-21) over
four alternatives because the link preview and the home-screen icon are the two
surfaces whose entire job is to be noticed in a scrolling feed, and nothing else
in a WhatsApp thread is a solid orange rectangle. It is deliberately *not* the
app's own warm-black ground — a dark card among dark cards reads as a blank
rectangle at thumbnail size.

Two rules it must keep:

- **Black ink on the orange, never cream or white.** `--bone` on `#ff7a00`
  measures about 2:1 and fails; black is 8.04:1. This is the one hard
  accessibility constraint in the whole design system (`01-design-system.md` §2).
- **Flat colour, no gradients.** The system bans them, and a flat field also
  survives the aggressive JPEG re-encoding chat apps apply to previews.

## The card

`card.html` is the source of truth: plain HTML/CSS at 1200×630, the wordmark
rebuilt with the same numbers as `frontend/src/components/Logo.module.css`
(mark at `1.15em`, `0.45em` gap, Anton uppercase, `letter-spacing: 0.04em`).

Regenerate by editing `card.html` and running `render.mjs`. Before it
screenshots, the renderer asserts:

- **Both fonts actually parsed.** `document.fonts.check()` alone is not a guard —
  per spec it returns `true` when *no* face matches the family, because nothing
  then needs loading, which is exactly the silent-fallback case. The real
  assertion is a per-face `status === "loaded"` scan of the `FontFaceSet`.
- **The lockup fits the frame.** A clipped card is not obvious in a thumbnail.

Both guards were verified to fail (exit 1) by pointing the `@font-face` at a
missing file: the face reports `status: "error"` and the fallback lockup
measures 1200px, tripping the width guard independently.

Fonts load from `frontend/public/fonts` over `file://`, so the build has no
network dependency and cannot quietly fall back to a system face. That needs
chromium's `--allow-file-access-from-files` — without it every `file://`
document is its own opaque origin and the `@font-face` fetch is refused.

## The icons

`render-icons.mjs` writes all five in one pass:

| File | Size | Used by |
|---|---|---|
| `icon-192.png` | 192 | manifest, `purpose: any` |
| `icon-512.png` | 512 | manifest, `purpose: any` |
| `icon-1024.png` | 1024 | manifest, `purpose: any` |
| `icon-maskable-512.png` | 512 | manifest, `purpose: maskable` |
| `apple-touch-icon.png` | 180 | `index.html`, iOS home screen |

**The icons are the mark alone — no wordmark.** At the ~48 px a phone home
screen actually draws, "Sound Clash" is unreadable, so the letters stay on the
card.

**Square corners, full bleed.** Every platform applies its own mask (iOS
squircle, Android circle/squircle/teardrop), so a baked-in radius shows up as a
dark notch inside the OS's own rounding.

**The maskable file is the same artwork.** A centred mark on a flat ground is
already maskable — there is no corner detail to lose. It exists as a separate
file only because the manifest declares `purpose` separately.

After writing each PNG the script **decodes it back** and scans for non-ground
pixels, so it measures the file on disk rather than the intent. It fails on a
wrong output size, a mark off-centre by more than 2%, or — for the maskable
one — ink reaching past the centre-80% safe circle that Android guarantees to
keep. Current output: ink at 39% of the tile, using 70% of the safe radius.

## Where the tags and colours live

Changing the artwork means checking four things stay in sync:

- `frontend/index.html` — `og:image` / `twitter:image` (absolute `https://www.`
  URL; the bare apex has no HTTPS listener), and `og:image:width` / `height`,
  which must match the **output** pixels (2400×1260, not the 1200×630 logical
  card).
- `frontend/public/manifest.webmanifest` — the four icon `src` paths, and
  `theme_color` / `background_color`, which track `--bg` `#14120e`.
- `frontend/index.html` — the inline SVG favicon, which is the same mark on
  `--bg`. It is deliberately bolder than the home-screen icons (the viewBox
  crops the mark's padding so the ink fills ~80%): a 16 px tab needs the weight,
  and a favicon is never OS-masked.
- `frontend/public/_headers` — nothing to do for these, but note the icons and
  the card are served from `public/` unhashed, so see the caching note below.

## Why the card is built this way

- **Static, in `index.html`.** Link-preview crawlers do **not** run JavaScript,
  so the tags have to be in the HTML the server returns. The SPA serves the same
  `index.html` for every route, so one card covers `soundclash.org` and every
  `/join/<code>` link.
- **Absolute https URL.** Crawlers fetch the image directly, so the tag points at
  `https://www.soundclash.org/og-image.jpg`, not a relative path.
- **JPEG, and small.** WhatsApp silently refuses to render preview images much
  over ~300 KB. The current flat card is ~87 KB at q92.
- **1200×630 rendered at 2×.** The standard 1.91:1 "large card" ratio.
  Supersampling keeps type crisp after the platforms re-encode and downscale it
  on their own servers.

## Caching gotcha

After deploying a change to the image or tags, WhatsApp and the other platforms
keep showing the **old** preview for a while — they cache per-URL aggressively
and there is no public purge button for WhatsApp. To check the new card without
waiting, share a one-off variant URL (e.g. `www.soundclash.org/?v=2`) or run the URL
through the [Facebook Sharing Debugger](https://developers.facebook.com/tools/debug/),
which forces a re-scrape on shared crawler infrastructure.

The PWA icons cache the same way on a device that has already installed the app:
the home-screen icon usually only updates on a fresh "Add to Home Screen".
