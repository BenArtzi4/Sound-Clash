# Social link-preview image (`og:image`)

`frontend/public/og-image.jpg` is the card shown when a `soundclash.org` link is
shared in a chat or post — WhatsApp, iMessage, Slack, Discord, X, Facebook, etc.
It is referenced by the `og:image` / `twitter:image` tags in
`frontend/index.html`.

`card.html` is the source of truth for the design (plain HTML/CSS, sized to
1200×630). `render.mjs` rasterises it to a JPEG with headless chromium.

## Regenerate

1. Edit `card.html`.
2. From the repo root:

   ```sh
   node tools/og-image/render.mjs
   ```

   This drives the chromium that ships with the `tests/e2e` Playwright install
   and overwrites `frontend/public/og-image.jpg` (1200×630, JPEG q90, ~55 KB).
   If chromium is missing: `cd tests/e2e && npx playwright install chromium`.

## Why it's built this way

- **Static, in `index.html`.** Link-preview crawlers do **not** run JavaScript,
  so the tags have to be in the HTML the server returns. The SPA serves the same
  `index.html` for every route, so one card covers `soundclash.org` and every
  `/join/<code>` link.
- **Absolute https URL.** Crawlers fetch the image directly, so the tag points at
  `https://soundclash.org/og-image.jpg`, not a relative path.
- **JPEG, not PNG, and small.** WhatsApp silently refuses to render preview
  images much over ~300 KB. The gradient-heavy card is ~415 KB as PNG but ~55 KB
  as JPEG with no visible quality loss.
- **1200×630.** The standard 1.91:1 "large card" ratio, declared in the
  `og:image:width`/`height` tags.

## Caching gotcha

After deploying a change to the image or tags, WhatsApp and the other platforms
keep showing the **old** preview for a while — they cache per-URL aggressively
and there is no public purge button for WhatsApp. To check the new card without
waiting, share a one-off variant URL (e.g. `soundclash.org/?v=2`) or run the URL
through the [Facebook Sharing Debugger](https://developers.facebook.com/tools/debug/),
which forces a re-scrape on shared crawler infrastructure.
