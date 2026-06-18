# Song curation tool

> **Adding songs? Read [`PLAYBOOK.md`](./PLAYBOOK.md) first** — it's the full
> step-by-step process (find → verify → validate → review → upload) a future
> agent can execute end-to-end. This README is just the tool reference.


A small, reusable workflow for adding popular songs to the Sound Clash catalog
**without** trusting Claude's from-memory guesses for song name, artist, or — the
big one — the YouTube id. IDs are discovered from the web, then **every id is
machine-verified** against YouTube before a human ever looks at it; the human
then previews each song in the *same* IFrame player the game uses and approves
or rejects it.

```
research (web search)  ──>  candidates_in.csv  ──>  verify.py  ──>  candidates.js
                                                                        │
                                                            open review.html in a browser
                                                                        │
                                                   approve / fix start-time / fix genre
                                                                        │
                                                              Export approved CSV
                                                                        │
                                                          generate idempotent SQL → prod
```

## Why this exists

- **Wrong ids / names (esp. Hebrew):** `verify.py` calls YouTube oEmbed for each
  id. An invalid, private, or embed-disabled id is dropped/flagged; the *real*
  video title + channel are shown next to the proposed ones so mismatches are
  obvious.
- **Start time:** the review page plays the real video. Scrub to the right spot
  and click **⏱ Set start = current time** — no guessing.
- **Genre:** each card has checkboxes for exactly the 11 valid slugs; fix inline.
- **Embeddability == playable in-game:** the review player is the game's player,
  so "it plays here" guarantees it works in a real round (codes 101/150 = embed
  disabled get a red badge).

## Files

| File | Committed? | What |
| --- | --- | --- |
| `review.html` / `review.js` / `review.css` | yes | the reusable review UI |
| `verify.py` | yes | oEmbed verifier + `candidates.js` generator (stdlib only) |
| `batches/<date>/candidates.js` | no (gitignored) | per-batch verified data |
| `batches/<date>/approved-songs-*.csv` | no | exported approvals |

## Bulk sourcing from YouTube playlists

For genres where Claude's recall is weak (esp. Hebrew), the fastest high-quality
source is a curated YouTube playlist: scraping it yields **real video ids + titles
in bulk** (no per-song guessing). Load a playlist in a browser, extract
`{id, title}` pairs from the `a[href*="watch?v="]` anchors, save as JSON, then:

```bash
python parse_playlist.py pl_dump.json --genre mizrahit --source "yt mizrahit playlist" --out candidates_in.csv
```

`parse_playlist.py` splits each "Artist - Song (Prod...)" title into artist/song,
strips production credits/noise, tags the genre, and appends upload-format rows.
The artist/song split is best-effort — run a clean-context validation pass (and the
review tool) over the result. Soundtrack rows need artist = film/show name, so they
usually need manual mapping rather than the generic split.

## Input CSV format

Same column order as the importer (`backend/app/services/csv_import.py`), plus an
optional `source` note:

```csv
title,artist,youtube_id,start_time,genres,source
Bohemian Rhapsody,Queen,fJ9rUzIMcZQ,0,rock,"best rock songs of all time"
```

`genres` is `;`-separated slugs. Valid slugs: `rock, pop, hip-hop, electronic,
soundtracks, israeli-pop, israeli-cover, israeli-rock-pop, israeli-rap-hip-hop,
mizrahit, israeli-soundtracks`.

## Run it

1. **Verify** (needs network; run with the sandbox disabled):

   ```bash
   python verify.py candidates_in.csv \
       --existing ../../.claude/example_upload.csv \
       --existing prod_catalog.csv \
       --out batches/$(date +%F)/candidates.js
   ```

   To dedup against production, first dump the live catalog:

   ```bash
   supabase link --project-ref jvfddxuaqcsrguibkymp
   supabase db query --linked "copy (select youtube_id, title, artist from songs) to stdout with csv header" > prod_catalog.csv
   ```

2. **Review:** copy/symlink the generated `candidates.js` next to `review.html`
   (or generate straight into this folder) and open `review.html` in a browser.
   Approve/reject, fix start times + genres. Decisions persist in `localStorage`.

3. **Export:** click **⬇ Export approved CSV**.

4. **Upload:** the catalog has hundreds of rows, which exceeds Render's import
   timeout, so generate idempotent SQL (mirror `db/seed/songs.sql`) from the
   exported CSV and apply with `supabase db query --linked`. The
   `/admin/songs/bulk-import` endpoint is fine for small follow-up fixes.

## Validate the export before uploading

```bash
cd ../../backend && .venv/Scripts/python -c \
  "from app.services.csv_import import parse_csv; \
   print(len(parse_csv(open('../tools/song-curation/batches/<date>/approved-songs-XXXX.csv','rb').read())))"
```

Zero `ValidationError`s and the expected row count means the file is importer-clean.
