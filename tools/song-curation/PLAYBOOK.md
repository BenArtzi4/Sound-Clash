# Song Curation Playbook

**Read this end-to-end before adding songs to the Sound Clash catalog.** It is the
authoritative runbook for finding, validating, reviewing and uploading new songs.
A future agent should be able to execute the whole flow from this file alone.

---

## 0. Goal & non-negotiable principles

- **Add *net-new*, *popular* songs per genre.** The prod catalog already holds
  **800+ songs**, so most famous tracks already exist — always dedup against the
  live catalog, every run.
- **NEVER trust a YouTube id recalled from memory.** Claude hallucinates ids,
  worst of all for Hebrew songs. Every id must come from a real source (web search
  result or a real YouTube playlist) **and** be machine-verified via YouTube oEmbed
  before a human ever sees it.
- **The human does the final call.** The pipeline produces a *clean, verified,
  deduped* candidate set; the user approves/rejects, sets start times, and fixes
  genres in `review.html`. Aim to make their review fast, not to be perfect.
- **Names come from YouTube, not from Claude.** Validation standardises every
  title/artist on the real oEmbed video title (see `validate.py`).

## 1. The tools (all in `tools/song-curation/`)

| file | what it does |
| --- | --- |
| `verify.py` | calls YouTube **oEmbed** for each candidate id → confirms it's valid + embeddable, fetches the real title/channel, match-scores vs the proposed name, dedups against the live catalog, writes `candidates.js`. stdlib-only. |
| `parse_playlist.py` | turns a scraped YouTube-playlist JSON (`[{id,title}]`) into upload-format candidate rows (splits "Artist - Song", strips prod credits, tags a genre). |
| `validate.py` | **per-batch, copy from a previous batch and adapt.** Standardises names on the real oEmbed title (preserving Hebrew apostrophes/gershayim), reassigns Israeli genres by a curated artist→genre map, drops playlist-banner rows, flags suspect rows → `candidates.js` + `flagged.json`. |
| `review.html` / `review.js` / `review.css` | the browser review UI (same YouTube IFrame player the game uses). Approve/reject, set start time, edit genre, export CSV. Loads `candidates.js` as a `<script>` so it works from `file://`. |

## 2. Reference facts (verify before relying on them — code changes)

- **Valid genre slugs (11):** `rock, pop, hip-hop, electronic, soundtracks,
  israeli-pop, israeli-cover, israeli-rock-pop, israeli-rap-hip-hop, mizrahit,
  israeli-soundtracks` (source: `db/backups/genres-20260531.csv`).
- **Upload CSV columns** (importer = `backend/app/services/csv_import.py`):
  `title,artist,youtube_id,start_time,genres`. `genres` is `;`-separated slugs.
  `youtube_id` must match `^[A-Za-z0-9_-]{11}$`; `start_time` integer seconds ≥ 0.
  An `is_soundtrack` column is ignored (derived from genre, mig 028).
- **Soundtrack convention:** for the `soundtracks` / `israeli-soundtracks` genres,
  **`artist` = the film/show name** (the answer players give); `title` = the cue
  name, or just set `title = artist` if there's no distinct clip name.
- **Prod project ref:** `jvfddxuaqcsrguibkymp`. Catalog is durable; ephemeral game
  tables auto-delete — never touch those.
- **Upload path:** >100 rows exceed Render's import timeout → generate idempotent
  SQL and apply with `supabase db query --linked` (mirror `db/seed/songs.sql`'s
  `WHERE NOT EXISTS (youtube_id)` + `ON CONFLICT DO NOTHING` pattern). The
  `/admin/songs/bulk-import` endpoint is only for a handful of rows.

## 3. Environment gotchas (Windows) — READ THESE

- **Always run Python with `PYTHONUTF8=1`** (`PYTHONUTF8=1 backend/.venv/Scripts/python.exe …`).
  The default Windows console is cp1255 and crashes on Hebrew/emoji in `print`.
- **Network egress needs the sandbox off.** oEmbed (`verify.py`) and `supabase`
  calls require `dangerouslyDisableSandbox: true` on the Bash tool. The sandbox
  blocks non-GitHub egress.
- **Playwright cannot open `file://`** — serve the tool over localhost to drive it
  with Playwright (`python -m http.server 8753 --directory tools/song-curation`),
  but the *user* can just double-click `review.html`.
- The Python interpreter is `backend/.venv/Scripts/python.exe`.

## 4. The workflow, step by step

### Step 1 — Dedup baseline (dump the live catalog)
```bash
supabase link --project-ref jvfddxuaqcsrguibkymp   # once
supabase db query --linked "select youtube_id, title, artist from songs"   # returns JSON
```
Parse the JSON `rows` into `batches/<date>/prod_catalog.csv` (cols
`youtube_id,title,artist`). Also check per-genre coverage to find the thin genres
worth filling:
```sql
select g.slug, count(*) from genres g left join song_genres sg on sg.genre_id=g.id group by g.slug order by 2 desc;
```

### Step 2 — Source candidates

**Global / English genres (`rock,pop,hip-hop,electronic`):** Claude's recall of
*canonical official-video ids* for mega-hits is actually reliable (~90%+), and
`verify.py` catches the rest. So: hand-write a CSV of well-known songs with your
best-guess official ids, verify, then web-search only the ones flagged
`invalid`/`mismatch`. Prefer **newer/deeper cuts** since the famous ones are
already in the catalog (expect a high duplicate rate on first pass).

**Israeli / Hebrew genres + soundtracks:** Claude's recall is unreliable here —
**source from curated YouTube playlists instead.** This is the key technique: a
playlist scrape yields real ids + clean "Artist – Song" titles in bulk. See §5.

**Soundtracks (global film/TV):** scrape a "movie scores" playlist, but the titles
are "Composer/Film - Cue" — map each to `artist=film name, title=cue` by hand
(can't use the generic parser). Already-covered genre; low priority.

### Step 3 — Parse playlist scrapes
```bash
PYTHONUTF8=1 backend/.venv/Scripts/python.exe tools/song-curation/parse_playlist.py \
    <dump>.json --genre <slug> --source "<note>" --out batches/<date>/israeli_in.csv
```
(appends rows; run once per playlist with the right `--genre`.)

### Step 4 — Verify (oEmbed + dedup + embeddability)
```bash
PYTHONUTF8=1 backend/.venv/Scripts/python.exe tools/song-curation/verify.py \
    batches/<date>/<input>.csv \
    --existing batches/<date>/prod_catalog.csv \
    --existing .claude/example_upload.csv \
    --out batches/<date>/_verified.js
```
Status meanings: `ok` = net-new & name matches; `duplicate` = already in catalog
(drop); `invalid` = dead/private/embedding-disabled (re-search a real id, or drop);
`check-title`/`check-artist`/`mismatch` = valid but name didn't match — usually a
punctuation/transliteration difference that `validate.py` fixes, occasionally a
wrong id. **When adding to an existing batch, also pass the previous
`master_all.csv` as `--existing` so you dedup against your own batch.**

### Step 5 — Consolidate
Merge every `*_in.csv` into `batches/<date>/master_all.csv`, deduping by
`youtube_id` (keep first). This is the source of truth.

### Step 6 — Validate (standardise names + fix genres)
Copy a previous `batches/*/validate.py`, adjust the curated `POP`/`ROCKPOP`/
`MIZRAHIT` artist lists, run it. It:
- drops `duplicate`/`invalid`/playlist-banner rows,
- re-derives `artist`/`title` from the real oEmbed title for playlist-sourced rows
  (preserving Hebrew `'`/`"`/`׳`/`״`),
- reassigns Israeli genres by artist (this is how `israeli-pop` gets split out of
  the mixed "mizrahit/Mediterranean" bucket),
- sets soundtracks to `artist=film, title=film`,
- writes `candidates.js` + `flagged.json` (rows needing a human eye).
Copy `candidates.js` next to `review.html`.

### Step 7 — Human review
User opens `review.html`, plays each song, sets start time, approves/rejects,
fixes genres, checks the **Flagged** filter, exports the approved CSV.

### Step 8 — Upload
Generate idempotent SQL from the approved CSV (see §2) and apply via
`supabase db query --linked`. Dry-run against a local `supabase start` stack first;
re-apply to confirm 0 net new rows (idempotency). Add a `### Added` line to
`CHANGELOG.md`. Nothing is uploaded until the user approves.

## 5. The Playwright playlist-scrape recipe (the workhorse)

**Find playlists** — navigate to YouTube's playlist-filtered search (the `sp`
param filters to playlists), then pull `list=` ids out of the DOM:
```
https://www.youtube.com/results?search_query=<query>&sp=EgIQAw%253D%253D
```
Prefer bigger, genre-specific, curated-looking playlists; avoid single-artist
playlists (noisy). Hebrew queries that work: `מזרחית להיטים`, `פופ ישראלי להיטים`,
`רוק ישראלי קלאסי`, `ראפ ישראלי היפ הופ`, `קאברים בעברית`.

**Scrape a playlist** — navigate to `https://www.youtube.com/playlist?list=<id>`,
then run this in `browser_evaluate` (save with the `filename` param):
```js
() => {
  const byId = {};
  document.querySelectorAll('a[href*="watch?v="]').forEach(a => {
    const m = a.href.match(/[?&]v=([A-Za-z0-9_-]{11})/);
    if (!m) return;
    const t = (a.getAttribute('title') || a.textContent || '').trim();
    (byId[m[1]] = byId[m[1]] || []).push(t);
  });
  const isDur = s => /^\d+:\d+(:\d+)?$/.test(s);
  return Object.entries(byId).map(([id, texts]) => ({
    id,
    title: texts.filter(t => t && !isDur(t) && t !== 'להפעלת כל הסרטונים')
                .sort((a,b)=>b.length-a.length)[0] || ''
  })).filter(x => x.title);
}
```
(The visible link text is the *duration*; the real title is another anchor to the
same id — hence collecting all texts per id and taking the longest non-duration
one.) Initial load gives ~100 videos; that's plenty per playlist.

**Real-YouTube validation via Playwright:** to confirm a sample actually plays,
serve the tool on localhost, open `review.html`, and in `browser_evaluate` click a
card's `button.load` then read `player.getPlayerState()` (1 = PLAYING).

## 6. Quality lessons (don't relearn these)

- **Preserve Hebrew punctuation** (`'`, `"`, `׳`, `״`) in names — `9 מ"מ`,
  `צ'אקי`, `ת'עיניים` break if you strip them. (`check-*` flags are usually just
  this.)
- **"Top in Israel" playlists include foreign hits** (Shakira, Arabic pop). Flag
  pop/mizrahit/rock rows with **zero Hebrew** as `maybe-foreign`; do *not* flag
  `israeli-cover`/`israeli-rap-hip-hop` for that (English titles are normal there).
- **Genre is fuzzy** (mizrahit vs israeli-pop blur). Best-effort artist map + let
  the user finalise in the tool's genre checkboxes. Don't over-engineer it.
- **Playlist titles** are `Artist - Song (Prod. by X)`; split on the first
  spaced dash, drop bracketed/`|`/`//` tails.
- **Embedding-disabled** official videos return `invalid` from oEmbed — they're
  unusable in-game, so re-search for an embeddable upload (lyric/official-audio) or
  drop the song.
- **Soundtrack score playlists** are messy (`Film Soundtrack - Cue`); map by hand.
- **Dedup catches a lot** — on the first global pass ~66% were already in the
  catalog. That's expected; lean into newer/deeper cuts.

## 7. One-screen cheat sheet

```bash
P="PYTHONUTF8=1 backend/.venv/Scripts/python.exe"; T=tools/song-curation; B=$T/batches/$(date +%F)
# 1. catalog dump → prod_catalog.csv (sandbox off)
# 2..3. scrape playlists (Playwright) → *.json ; parse:
$P $T/parse_playlist.py dump.json --genre mizrahit --source "yt …" --out $B/in.csv
# 4. verify (sandbox off):
$P $T/verify.py $B/in.csv --existing $B/prod_catalog.csv --existing .claude/example_upload.csv --out $B/_verified.js
# 5. consolidate → master_all.csv  6. cp+adapt validate.py → candidates.js + flagged.json
# 7. cp $B/candidates.js $T/candidates.js ; open review.html  8. export CSV → idempotent SQL → prod
```
