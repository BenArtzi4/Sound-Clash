# Song curation tool

> **Adding songs? Read [`PLAYBOOK.md`](./PLAYBOOK.md) first** — it's the full
> step-by-step process (find → verify → validate → review → upload) a future
> agent can execute end-to-end. This README is just the tool reference.
>
> The two current workflows are the Claude Code skills `add-songs` (new songs from
> requests, artists, charts or playlists: [`requests/`](./requests/README.md)) and
> `audit-songs` (fix the songs already in the game: better videos, duplicates, names,
> genres: [`audit/`](./audit/README.md)). Both play-test new videos with
> [`playtest/playtest.mjs`](./playtest/playtest.mjs).


A small, reusable workflow for adding popular songs to the Sound Clash catalog
**without** trusting Claude's from-memory guesses for song name, artist, or — the
big one — the YouTube id. IDs are discovered from the web, then **every id is
machine-verified** against YouTube before a human ever looks at it; the human
then previews each song in the *same* IFrame player the game uses and approves
or rejects it.

```
research (web search)  ──>  candidates_in.csv  ──>  verify.py  ──>  batches/<date>/candidates.js
                                                                        │
                                       python review_server.py batches/<date>  →  http://localhost:8760/
                                                                        │
                                     play · set start · fix title/artist/year/genres · approve/reject
                                                                        │
                                                              Export approved CSV
                                                                        │
                                                          hand to a maintainer to import
```

## Why this exists

- **Wrong ids / names (esp. Hebrew):** `verify.py` calls YouTube oEmbed for each
  id. An invalid, private, or embed-disabled id is dropped/flagged; the *real*
  video title + channel are shown next to the proposed ones so mismatches are
  obvious.
- **Start time:** the review page plays the real video, big. Scrub, press **S**
  (set start = now), nudge ±1/±5 s, or jump to the "most replayed" hook — no
  guessing.
- **Genre:** toggle chips for exactly the 11 valid slugs; fix inline.
- **Embeddability == playable in-game:** the review player embeds videos exactly
  like the game's player (youtube-nocookie, same parameters), so "it plays here"
  means it works in a real round (codes 101/150 = won't play embedded get a red
  banner and a ⚠ in the list).

## Files

| File | Committed? | What |
| --- | --- | --- |
| `review.html` / `review.js` / `review.css` | yes | the reusable review page |
| `review_server.py` | yes | tiny stdlib server: serves the page + a batch, saves decisions to `<batch>/decisions.json` |
| `verify.py` | yes | oEmbed verifier + `candidates.js` generator (stdlib only) |
| `batches/<date>/candidates.js` | no (gitignored) | per-batch verified data |
| `batches/<date>/decisions.json` | no | the review's decisions (written by `review_server.py`) |
| `batches/<date>/approved-songs-*.csv` | no | exported approvals |

## The review page

```bash
cd tools/song-curation
python review_server.py batches/2026-10-11 --port 8760     # add --open to launch the browser
# open http://localhost:8760/   (other batches on the same server: /?batch=<folder name>)
```

**Always open it through the server, at `localhost`.** Two YouTube rules make the
other ways unreliable, both verified on 2026-10-11:

- A page opened as a **file** (double-click) loads the songs and saves decisions in
  the browser, but YouTube refuses to play anything there (error 153, "missing
  referrer"). The page says so on load.
- A page opened on a bare **IP** (`http://127.0.0.1:8760/`) gets error 150 for some
  label-owned videos that play fine on `http://localhost:8760/`. The page redirects
  an IP address to `localhost` by itself and never records those errors.

**Layout.** Song list on the left (search, All/Pending/Approved/Rejected/Flagged,
sort by batch order / flagged first / views / title), a large player in the middle
sized to fit the screen (about 1170 px wide at 1920×1080, 880 px at 1366×768 with
every control visible without scrolling), and the details on the right (below the
player on smaller screens): warnings, title / artist / year / genre editors, the
real YouTube title + channel + views + upload date, the original request and the
research notes. **T** (or ⤢) is a theater mode that hides the side panels.

**Flow.** Clicking a song plays it from its start time. **A** approves and **R**
rejects, and both jump to the next pending song and play it. **U** undoes. Edited
fields turn orange, show the old value, and have a ↺ to reset them.

**Start time.** **S** = set start to the current time; −5/−1/+1/+5 (or **[** **]**)
nudge it and replay from the new start; type `1:05` in the field; **H** uses the
hook (the peak of YouTube's "most replayed" curve); **P** plays from the start. The
strip under the player draws that curve (or a plain timeline when there's none):
click to seek, Shift+click to set the start there.

**Other uploads.** When a candidate has `alternatives`, a strip under the player
shows them: ▶ Preview plays one, **Use this video** makes it the exported
`youtube_id` (Switch back undoes it). Decisions stay keyed by the candidate's
original id.

**Keys** (any keyboard layout, Hebrew included, and they keep working after you
click inside the YouTube player): A approve · R reject · U undo · J/↓ next ·
K/↑ previous · Space play/pause · ←/→ ±5 s (Shift ±1 s) · 1–9 jump to 10–90 % ·
S set start · H hook · P play from start · [ ] nudge start · E edit title ·
/ search · T theater · ? help.

**Saving.** Every change goes to localStorage at once (one key per batch, from
`window.BATCH.id` or a hash of the ids) and, when served by `review_server.py`,
to `<batch>/decisions.json`. Changes the server hasn't confirmed stay queued in
the browser and are retried every 4 s and on the next page load; the pill in the
top bar says **Saved** / **Saving…** / **Unsaved (n) — retrying**. So a crashed or
stopped server loses nothing: restart it and the page catches up. The server backs
up `decisions.json` on start (`decisions.startup-backup.json`) and before a reset.
The ⋯ menu has **Export decisions (JSON backup)**, **Import decisions…** (moves a
review between browsers; newest record wins) and **Reset all decisions…**.

**Export.** **⬇ Export approved CSV** downloads
`title,artist,youtube_id,start_time,genres,release_year` (UTF-8 with BOM,
`genres` `;`-joined, `release_year` blank when unknown) and, in server mode, also
saves it into the batch folder. It warns first about approved rows without a
genre / title / artist or whose video failed to play.

### `candidates.js` format

```js
window.BATCH = { id: "2026-10-11", title: "User requests, Oct 2026" };   // optional
window.CANDIDATES = [ { youtube_id: "…", title: "…", artist: "…", genres: ["pop"], … } ];
```

Only `youtube_id`, `title`, `artist` and `genres` are required; older batches with
just the `verify.py` fields (`valid`, `match_status`, `oembed_title`,
`oembed_author`, `notes`, `source`…) still work. Optional fields the page uses:

| field | shown as |
| --- | --- |
| `start_time`, `release_year` | proposed start (s) and year |
| `suggested_start` | the **Hook** button and ★ on the timeline |
| `heat`: `[[second, 0..1], …]` | the "most replayed" curve under the player |
| `length`, `views`, `channel`, `channel_badge` (`artist`/`verified`), `upload_date`, `oembed_title` | the "On YouTube" panel |
| `alternatives`: `[{youtube_id, yt_title, channel, views, length, why}]` | the "Other uploads" strip |
| `flags`: `[{level: "warn"/"info", text}]` | the "Check" box; `warn` also puts the song under **Flagged** |
| `request`: `{line, title, artist}`, `notes`, `confidence`, `group` | the "Research" panel (`confidence: "low"` = Flagged) |

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
       --existing prod_catalog.csv \
       --out batches/$(date +%F)/candidates.js
   ```

   `prod_catalog.csv` is a current catalog export (`youtube_id,title,artist`) you
   get from a maintainer — this tool never connects to the live database itself.

2. **Review:** `python review_server.py batches/<date>` and open
   `http://localhost:8760/` (see [The review page](#the-review-page)). Approve/reject,
   fix start times + names + genres. Decisions are saved to
   `batches/<date>/decisions.json` and in the browser.

3. **Export:** click **⬇ Export approved CSV** (also saved into the batch folder).

4. **Upload:** `requests/gen_upload.py <csv>` (run from the batch folder) writes the
   idempotent upload SQL and a read-only verify query; a maintainer applies it with
   their own linked Supabase CLI and checks the result with `--check`. No project ref
   or credentials live in this repo. Full sequence: the `add-songs` skill
   (`.claude/skills/add-songs/SKILL.md`).

## Validate the export before uploading

```bash
cd ../../backend && .venv/Scripts/python -c \
  "from app.services.csv_import import parse_csv; \
   print(len(parse_csv(open('../tools/song-curation/batches/<date>/approved-songs-XXXX.csv','rb').read())))"
```

Zero `ValidationError`s and the expected row count means the file is importer-clean.
