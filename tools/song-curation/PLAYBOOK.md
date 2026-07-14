# Song Curation Playbook

**Read this end-to-end before adding songs to the Sound Clash catalog.** It is the
authoritative runbook for finding, validating, reviewing and uploading new songs.
A future agent should be able to execute the whole flow from this file alone —
including the concrete sources, search queries, and cleanup rules already proven to
work (see §6 "Known-good sources" and §7 "Quality lessons").

History: built over several passes in June 2026; grew the candidate batch to ~760
validated net-new songs (mostly Hebrew). The catalog had ~804 songs at that point.

---

## 0. Goal & non-negotiable principles

- **Add *net-new*, *popular* songs per genre.** The prod catalog already holds
  **~800+ songs**, so most famous tracks already exist — always dedup against the
  live catalog *and the in-progress batch*, every run.
- **NEVER trust a YouTube id recalled from memory.** Claude hallucinates ids, worst
  of all for Hebrew. Every id must come from a real source (a YouTube playlist scrape
  or a web-search result) **and** be machine-verified via YouTube oEmbed before a
  human sees it.
- **Names come from YouTube, not from Claude.** `validate.py` standardises every
  title/artist on the real oEmbed video title; `audit.py` then proves 100% of names
  actually appear in the real video title.
- **The human does the final call.** The pipeline produces a *clean, verified,
  deduped* set; the user approves/rejects, sets start times, fixes genres in
  `review.html`. Make their review fast — drop garbage rather than ship it.
- **Recent years matter for teens.** Many players know only current-year songs, so
  each pass should pull the latest annual charts (2024/2025/2026…). See §6.

## 1. The pipeline & tools (`tools/song-curation/`)

The flow is **scrape → parse → verify → consolidate → validate → fix → audit → review → upload.**

| file | reusable? | what it does |
| --- | --- | --- |
| `parse_playlist.py` | yes (root) | scraped playlist JSON `[{id,title}]` → upload-format rows (splits "Artist - Song", strips prod credits, tags a genre). |
| `verify.py` | yes (root) | calls YouTube **oEmbed** per id → valid + embeddable? fetches real title/channel, match-scores vs proposed name, dedups against `--existing` files. stdlib-only. |
| `validate.py` | per-batch template | standardises names on the real oEmbed title (preserving Hebrew `'"׳״`), reassigns Israeli genres by a curated artist→genre map, sets soundtracks `artist=title=film`, drops banners; → `candidates.js` + `flagged.json`. |
| `fix.py` | per-batch template | second pass: swaps **reversed** "Song-Artist" rows (KNOWN-artist list), trims latin transliteration tails, **drops junk/foreign/medleys/minor-self-promoters**, **within-batch name-dedup**. |
| `audit.py` | per-batch template | re-scores every final artist+title against the real oEmbed title; should be ~100% "clean match". Writes `suspects.json`. |
| `chart_songs.py` | per-batch template | holds a hand-entered best-of-year chart list; dedups by title vs batch+catalog; prints which songs still need an id found. |
| `review.html`/`.js`/`.css` | yes (root) | browser review UI (same YouTube IFrame player as the game). Loads `candidates.js` as a `<script>` (works from `file://`). |

`validate.py` / `fix.py` / `audit.py` / `chart_songs.py` are committed at the tool
root as the canonical templates; they read/write `_verified.js` / `candidates.js`
from their own directory, so **copy them into a new `batches/<date>/` and run them
there** (tweak the artist lists / chart songs for the batch). Per-batch data
(`*_in.csv`, `master_all.csv`, `prod_catalog.csv`, `_verified.js`, `candidates.js`,
`_dumps/`) is gitignored.

## 2. Reference facts

- **Valid genre slugs (11):** `rock, pop, hip-hop, electronic, soundtracks,
  israeli-pop, israeli-cover, israeli-rock-pop, israeli-rap-hip-hop, mizrahit,
  israeli-soundtracks` (the slugs the importer accepts).
- **Upload CSV columns** (`backend/app/services/csv_import.py`):
  `title,artist,youtube_id,start_time,genres` (`genres` = `;`-sep slugs;
  `youtube_id` = `^[A-Za-z0-9_-]{11}$`; `start_time` int seconds ≥ 0). A trailing
  `is_soundtrack` column is ignored (derived from genre, mig 028).
- **Soundtrack convention:** `artist` = film/show name (the answer); `title` = cue,
  or just `title = artist`.
- **Handoff, not upload:** this tool stops at an *approved CSV*. Importing that CSV
  into the live catalog is a maintainer-only step and is intentionally **not**
  documented here — no project ref, no credentials, and no import command live in
  this repo. Export the CSV, hand it to a maintainer, and add a `### Added`
  CHANGELOG line when it ships.

## 3. Environment gotchas (Windows) — READ THESE

- **Always run Python with `PYTHONUTF8=1`.** Default console is cp1255 and crashes
  on Hebrew/emoji in `print` (the data files are fine, only stdout breaks).
- **Network egress needs `dangerouslyDisableSandbox: true`** on the Bash tool for
  `verify.py` (oEmbed) and `supabase` calls (sandbox blocks non-GitHub egress).
- **Playwright can't open `file://`** — serve the tool for play-testing:
  `python -m http.server 8753 --directory tools/song-curation`, then
  `http://localhost:8753/review.html`. The *user* can just double-click the file.
- Interpreter: `backend/.venv/Scripts/python.exe`.

## 4. The workflow, step by step

**1 — Dedup baseline.** Get a current catalog export (`youtube_id,title,artist`) as
`prod_catalog.csv` from a maintainer — this tool never connects to the live database
itself. If that export includes genre slugs, count rows per slug to spot the thin
genres. **Also fold the current batch** (`candidates.js`) into the dedup set if
you're adding to an existing batch — `fix.py`'s within-batch name-dedup is the
backstop.

**2 — Source candidates** (see §6 for concrete sources):
- *Global `rock/pop/hip-hop/electronic`*: Claude's recall of canonical official-video
  ids is ~90% reliable; hand-write a CSV, verify, web-search only the `invalid`/
  `mismatch` ones. Prefer newer/deeper cuts (famous ones are already in the catalog —
  expect ~66% duplicates).
- *Israeli/Hebrew*: **scrape curated YouTube playlists** (real ids + clean titles in
  bulk) and/or **find ids per song from annual hit-charts** (best for popularity).
- *Soundtracks*: scrape a movie-scores playlist, map `Composer/Film - Cue` → `artist=
  film, title=film` by hand. Low priority (well covered).

**3 — Parse playlist scrapes:**
```bash
PYTHONUTF8=1 .../python.exe parse_playlist.py <dump>.json --genre <slug> --source "<note>" --out batches/<date>/israeli_in.csv
```

**4 — Verify (oEmbed + dedup + embeddability):**
```bash
PYTHONUTF8=1 .../python.exe verify.py batches/<date>/master_all.csv \
  --existing batches/<date>/prod_catalog.csv --out batches/<date>/_verified.js
```
Status: `ok` = net-new + name matches; `duplicate` = already in catalog (dropped);
`invalid` = dead/private/embed-disabled (re-search or drop); `check-*`/`mismatch` =
usually punctuation/transliteration (fixed downstream), occasionally a wrong id.

**5 — Consolidate** every `*_in.csv` → `master_all.csv`, dedup by `youtube_id`.

**6 — Validate → Fix → Audit:**
```bash
PYTHONUTF8=1 .../python.exe batches/<date>/validate.py   # → candidates.js + flagged.json
PYTHONUTF8=1 .../python.exe batches/<date>/fix.py        # reversals/trims/drops/within-batch dedup
PYTHONUTF8=1 .../python.exe batches/<date>/audit.py      # expect ~100% clean; check suspects.json
cp batches/<date>/candidates.js tools/song-curation/candidates.js
```
Tune the curated artist lists in `validate.py` (POP/ROCKPOP/MIZRAHIT) and `fix.py`
(KNOWN, ALLOW, DROP_ARTIST, JUNK) for the new batch's artists.

**7 — Human review.** `review.html` → play, set start time, approve/reject, fix
genres, scan the **Flagged** filter, export CSV.

**8 — Handoff.** Export the approved CSV and hand it to a maintainer to import; the
import (and all live-DB access) is deliberately out of scope for this tool. Add a
`### Added` CHANGELOG line when it ships.

## 5. The Playwright scrape recipe (the workhorse)

**Find playlists** — playlist-filtered YouTube search, pull `list=` ids from the DOM:
```
https://www.youtube.com/results?search_query=<query>&sp=EgIQAw%253D%253D
```
Prefer big, genre-specific, curated playlists; **avoid single-artist playlists**
(noisy) and **DJ "סט"/"מחרוזת"/"רמיקסים" mixes** (medleys — multiple songs per video).

**Scrape** — navigate to `youtube.com/playlist?list=<id>`, run in `browser_evaluate`
(save with the `filename` param). The visible link text is the *duration*; the real
title is another anchor to the same id, so collect all texts per id and take the
longest non-duration one:
```js
() => {
  const byId = {};
  document.querySelectorAll('a[href*="watch?v="]').forEach(a => {
    const m = a.href.match(/[?&]v=([A-Za-z0-9_-]{11})/); if (!m) return;
    (byId[m[1]] = byId[m[1]] || []).push((a.getAttribute('title')||a.textContent||'').trim());
  });
  const isDur = s => /^\d+:\d+(:\d+)?$/.test(s);
  return Object.entries(byId).map(([id,t]) => ({ id,
    title: t.filter(x=>x && !isDur(x) && x!=='להפעלת כל הסרטונים').sort((a,b)=>b.length-a.length)[0]||''
  })).filter(x=>x.title);
}
```
Initial load gives ~100 videos (plenty). Some playlists 404 (title shows just
"YouTube", 0 videos) — pick another, or use hit-charts instead.

**Real-YouTube play-test** — serve on localhost, open `review.html`, in
`browser_evaluate` click a card's `button.load`, read `player.getPlayerState()` (1=PLAYING).

## 6. Known-good sources (reuse these first)

**Annual hit-charts (authoritative for popularity — best for "best of year YYYY"):**
- **Mako Hitlist annual** — `https://hitlist.mako.co.il/annual/2024` (and `/2025`, …).
  `WebFetch` it with "list the ranked songs as 'Artist — Song' in Hebrew". Gives ~40
  clean ranked names per year; then find each id by WebSearch (see below). On the 2024
  pass, 45/68 chart songs were already in the batch — dedup by title first
  (`chart_songs.py`).
- ice.co.il year-in-review articles also list the year's biggest songs.

**Per-song id discovery (when you have a name from a chart):** WebSearch
`"<artist> <song> קליפ רשמי"` (or `הקליפ הרשמי`) with `allowed_domains:["youtube.com"]`.
Take the official-channel / `(Prod. by …)` result, not live/remix/karaoke. English
acts: `"<artist> <song> official video"`.

**YouTube playlists that worked (list ids; some may go stale):**
- General recent Israeli (mizrahit+pop mix): `PLQvANBcZRbWrefTmmL21F_fNU0EH60wDy`
  (ים-תיכוני 2026), `PLJ4dTHPAykBm1Yp_lHM_GJP_m0gADRQEB` (גלגלצ 2026),
  `PLbzsxtRrMUe8XrDGI_w2MOjHkpYUS6F4U` (חמים 2025), `PL4fGSI1pDJn4ECcNLNscMAPND-Degbd5N`
  (100 המובילים ישראל), `PL8eSCDXgHmoMPehdNd5qy9msZC33tYe72` (קצביים).
- mizrahit: `PLbXAgsnPq-EP8BTMVrIeQrJvFaWQRHpO_` (10M+ views — classic popular),
  `PL70-abtm3JOZi0XsVGe4fR-i1EMbhmij-` (נוסטלגיה 90s-2000s).
- israeli-rock-pop: `PL21aXNqt5qEzpZ2KAQSZtm0taHGdcTqLS` (רוק ישראלי הכי טוב — good).
  AVOID `PLwF9UaW7tpginBeZDP3rwuLgde1AtuzsK` (single-artist עמית חיו spam).
- israeli-rap-hip-hop: `PLHhZwUQwkzySAOfRz_tCazth9noBopA4o`,
  `PLUrpxYINqnvZVjee_TDtGl1Wvfg9fdS8U` (ראפ הכי חם 2026).
- israeli-cover: `PL8KzolpuNRvaW1CbEN9XioBMMdjYd8NeV` (קאברים יפים),
  `PL3hv9QuhnTBlP1aTQq52xk3KYjiEoGOQ4` (אקוסטיים) — **both mix in foreign originals;
  fix.py drops the non-Hebrew-artist ones.**
- israeli-soundtracks: `PL-4qmSLhuPJaOuuEnizI7080Hblyf8UB8` (שירי פתיחה סדרות — only
  ~7; this genre is hard, low value).
- soundtracks (global): `PL4BrNFx1j7E5qDxSPIkeXgBqX0J7WaB2a` (Ultimate Movie Scores).

**Search-query patterns that surfaced good playlists:** `מזרחית <year> להיטים`,
`להיטים ישראלים <year>`, `גלגלצ <year>`, `ראפ ישראלי <year>`, `רוק ישראלי מיטב
הלהיטים`, `קאברים בעברית`, `פופ ישראלי להיטים`.

## 7. Quality lessons (don't relearn these)

- **Foreign contamination.** "Top in Israel"/cover charts include Arabic & global
  hits (Shakira, Justin Bieber, Ed Sheeran, Wael Kfoury…). Rule: a `pop/mizrahit/
  israeli-rock-pop/israeli-cover` row with **zero Hebrew in the artist** is foreign →
  **drop** (fix.py does this). Allow-list real Israeli acts with Latin stage names
  (e.g. **Static & Ben El**, **Noam Bettan** — both WebSearch-confirmed Israeli) and
  force them to `israeli-pop`. Don't apply this to `israeli-rap-hip-hop` (English
  names are normal there).
- **Medleys.** `מחרוזת` (and DJ "סט") videos contain several songs — useless for
  "name the song". Drop anything with `מחרוזת` in title/oEmbed.
- **Reversed "Song - Artist".** Some playlists list the song first. `fix.py` swaps
  when a KNOWN artist sits in the title field but not the artist field — keep the
  KNOWN-artist list current.
- **Transliteration tails.** Titles like `אתה תותח - Sarit Hadad -` get the trailing
  latin trimmed; preserve the Hebrew. (`check-*` verify flags are usually just this
  or apostrophes.)
- **Preserve Hebrew punctuation** `'"׳״` — `9 מ"מ`, `צ'אקי`, `ת'עיניים` break if stripped.
- **Minor self-promoters / junk titles.** One artist (עמית חיו) spammed a "rock"
  playlist with verbose self-promo titles; `fix.py` has a DROP_ARTIST + JUNK-phrase
  list ("זמר לחתונה", "סינגל חדש", "הלהיט של הזמר", "קריוקי", "פלייבק"…). Keep JUNK
  *specific* — bare words like `חתונה`/`מופע` appear in real song/band names.
- **Blank artist → drop.** If neither the parse nor the oEmbed title yields an artist,
  drop the row (validate.py); don't ship blank-artist rows.
- **Within-batch dedup** by normalized (artist,title) catches the same song uploaded
  twice under different ids across playlists (fix.py).
- **Embed-disabled** official videos return `invalid` from oEmbed → re-search for an
  embeddable upload or drop.
- **Genre is fuzzy** (mizrahit ↔ israeli-pop blur). Best-effort artist map; the user
  finalises in the tool. The mixed "Mediterranean" playlists need the artist→genre
  split most.
- **Some year playlists 404** (2024 mizrahit ones did) — fall back to the Mako
  annual chart + per-song id search.
- **Audit should be ~100%.** Residual `audit.py` suspects are normally just
  Hebrew-artist-vs-Latin-video-title (e.g. עומר אדם on an "- Topic" channel, עדן גולן
  = "Eden Golan") — verify the channel and move on.

## 8. One-screen cheat sheet

```bash
P="PYTHONUTF8=1 backend/.venv/Scripts/python.exe"; T=tools/song-curation; B=$T/batches/$(date +%F)
mkdir -p $B/_dumps; cp $T/{validate,fix,audit,chart_songs}.py $B/   # copy templates from tool root
# 1. get a catalog export from a maintainer → $B/prod_catalog.csv
# 2. scrape playlists (Playwright §5) → $B/_dumps/*.json   |  or WebFetch Mako chart + WebSearch ids
$P $T/parse_playlist.py $B/_dumps/x.json --genre mizrahit --source "yt …" --out $B/israeli_in.csv
# 5. consolidate *_in.csv → $B/master_all.csv (dedup youtube_id)
$P $T/verify.py $B/master_all.csv --existing $B/prod_catalog.csv --out $B/_verified.js   # sandbox off
$P $B/validate.py && $P $B/fix.py && $P $B/audit.py        # 6
cp $B/candidates.js $T/candidates.js                       # 7. open review.html
# 8. export approved CSV → hand to a maintainer to import (out of scope here)
```
