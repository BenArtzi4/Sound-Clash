# Release-year backfill runbook

How we populate `songs.release_year` (migration 031) for the whole catalog, and
how to top it up later. The lookup is done by **parallel Claude Code subagents
using the WebSearch / WebFetch tools** — we have no LLM API key, so the agents
*are* the LLM. `year_backfill.py` only does the deterministic ends (split the
catalog, reconcile the answers into SQL). See `data-sources.md` for the source
authorities and the original-vs-upload-year warning.

## The one rule that matters: ORIGINAL release year

`release_year` is the year the **song** was first commercially released — **not**
the year of the recording in our catalog. For a cover or re-recording, store the
**first artist's** year: a 2012 cover of a 1967 song is `1967`. This is what
makes a "play 60s music" filter feel right even when our clip is a famous later
cover. Never use the YouTube upload date.

## Pipeline

```
prod songs ──dump──> songs_catalog.csv
                         │ partition (──size 30)
                         ▼
              year_in/batch_NN.csv   (youtube_id,title,artist,lang)
                ├─ extractor wave (agents, WebSearch) ─> year_out/extract_batch_NN.csv
                └─ judge wave     (agents, blind)      ─> year_out/judge_batch_NN.csv
                         │ build (reconcile)
                         ▼
        db/backfill/release_years.sql   +   flagged.csv (human review)
```

### 1. Dump the catalog

```bash
supabase link --project-ref jvfddxuaqcsrguibkymp
supabase db query --linked \
  "COPY (SELECT youtube_id, title, artist FROM songs ORDER BY artist, title) \
   TO STDOUT WITH CSV HEADER" > batches/<date>/songs_catalog.csv
```

### 2. Partition

```bash
PYTHONUTF8=1 backend/.venv/Scripts/python.exe tools/song-curation/year_backfill.py \
  partition batches/<date>/songs_catalog.csv \
  --size 30 --out-dir batches/<date>/year_in
```

Writes `batch_01.csv …` with a `lang` hint (`he`/`en`) so the agent picks the
right prompt.

### 3. Extractor wave (parallel agents, sandbox disabled)

Fan out ~5 concurrent `general-purpose` subagents, one per few batches. Each
agent reads a `year_in/batch_NN.csv` and, **per row**, runs the question below
with WebSearch (confirm against Wikipedia / MusicBrainz / Discogs / official
pages via WebFetch when the snippet is thin). It must **write its answers to
`year_out/extract_batch_NN.csv` and return only a one-line summary** (keeps the
orchestrator's context clean).

Per-song question:

- **en:** *In what year was the song "<title>" first originally released? The
  recording in our catalog is performed by "<artist>". If that version is a
  cover or re-recording, give the year the song was ORIGINALLY released by its
  first artist — not this version's year.*
- **he:** *באיזו שנה יצא לראשונה השיר "<title>" של "<artist>"? אם מדובר בגרסת
  כיסוי, ציין את שנת היציאה המקורית של השיר (של האמן/ית המקורי/ת) ולא את שנת
  הכיסוי.*

Output CSV columns (exact header — `build` parses these):

```
youtube_id,title,artist,year,is_cover,original_artist,confidence,source
```

- `year` — integer, the original release year (blank if genuinely unsure).
- `is_cover` — `yes` / `no` / `unknown`.
- `original_artist` — first artist if `is_cover=yes`, else blank.
- `confidence` — 0.0–1.0 (the agent's own certainty).
- `source` — the URL it trusted most.

### 4. Judge wave (independent, blind — database validation)

A second set of agents gets the **same `year_in/batch_NN.csv`** — **not** the
extractor's answers — and re-derives the year independently. This wave is the
**database-validation** layer: each agent must **first query the structured
music databases** — MusicBrainz (`musicbrainz.org/ws/2`, first-release-date of
the work/recording) and Wikidata (property P577 publication date) via `WebFetch`
(both are keyless JSON APIs) — and only fall back to `WebSearch` when the song
isn't found there. Leading with the databases means the two waves don't share a
failure mode (the extractor leads with WebSearch). Run them on a different model
than the extractor where possible for true cross-model corroboration. Write to
`year_out/judge_batch_NN.csv`:

```
youtube_id,year,confidence,note
```

`note` should say which database the year came from (e.g. `musicbrainz`,
`wikidata`, or `websearch-fallback`) so disagreements are easy to triage.

### 5. Build → SQL + review list

```bash
PYTHONUTF8=1 backend/.venv/Scripts/python.exe tools/song-curation/year_backfill.py \
  build \
  --extract-dir batches/<date>/year_out \
  --judge-dir   batches/<date>/year_out \
  --out ../../db/backfill/release_years.sql \
  --flagged batches/<date>/flagged.csv
```

Reconcile rule (tune with `--threshold`, default `0.7`): a year is **auto-
accepted** only when the extractor and judge agree **and** both are ≥ threshold
confident. With `--decade-tolerance` the two waves are treated as agreeing when
their years fall in the same decade (the extractor's year is kept) — for the
decade-filter use case where the exact year inside a decade is irrelevant.
Everything else (`disagree`, `low-confidence`, `no-judge`, `no-year`)
goes to `flagged.csv`, sorted worst-first with the YouTube link and both
proposed years. `build` also writes `accepted.csv`
(`youtube_id,title,artist,year,is_cover,lang`) next to `flagged.csv` — the input
to the spot-check in step 7.

### 6. Human review

Eyeball `flagged.csv` top-down. Resolve each by appending a corrected row to a
small `year_out/extract_manual.csv` + `year_out/judge_manual.csv` (same headers,
matching years, confidence `1.0`) and re-running `build`, or by hand-editing
`release_years.sql`. Covers and disagreements cluster at the top — that's where
the judgement is.

### 7. Third validation — real-Google spot-check (~50 songs)

An independent confidence gate on the **auto-accepted** songs (the ones that skip
the `flagged.csv` review and go straight to prod). It re-asks the exact question
validated by hand, against the **real Google AI Overview**, for a random
non-cover sample: if those agree with the pipeline, trust the whole accepted set;
if not, widen the review. Covers are excluded — the literal template returns the
*cover's* year, not the original, so a cover would false-mismatch; covers are
already covered by `flagged.csv`.

1. **Pick the sample** (reproducible via `--seed`). Flat random 50 across the
   accepted non-cover songs:
   ```bash
   PYTHONUTF8=1 backend/.venv/Scripts/python.exe tools/song-curation/year_backfill.py \
     sample --accepted batches/<date>/accepted.csv \
     --size 50 --out batches/<date>/sample_in.csv
   ```
   (Omit `--size` for the language-weighted default — 30 Hebrew + 20 English —
   which oversamples the higher-risk Hebrew set instead of sampling flat.)
2. **Ask the real Google** — for each row in `sample_in.csv`, drive the Playwright
   MCP browser to a Google search and read the **AI Overview ("סקירת AI")** box:
   - **en:** `What year did <artist> release the song '<title>'?`
     (e.g. `What year did AC/DC release the song 'Back in Black'?` → AI Overview
     "…released … on **July 25, 1980**" → record `1980`.)
   - **he:** `באיזו שנה יצא השיר '<title>' של <artist>?`

   Write `youtube_id,google_year` into `batches/<date>/sample_answers.csv` (take
   the **year** out of whatever date the AI Overview gives; if no AI Overview
   appears, leave `google_year` blank → counts as `no-answer`). No `--no-sandbox`
   is needed for the Playwright MCP browser, and at ~40 queries Google won't
   rate-limit; if a one-off consent/CAPTCHA page appears, clear it and continue.
3. **Report**:
   ```bash
   PYTHONUTF8=1 backend/.venv/Scripts/python.exe tools/song-curation/year_backfill.py \
     sample-report --sample batches/<date>/sample_in.csv \
     --answers batches/<date>/sample_answers.csv \
     --accepted batches/<date>/accepted.csv \
     --out batches/<date>/sample_report.csv
   ```
   Prints `match / mismatch / no-answer` and writes `sample_report.csv` (MISMATCH
   rows first). A high match rate (≥ ~95%) clears the accepted set; each MISMATCH
   is a real correction — fix it like a flagged row (step 6) and re-run `build`.

### 8. Apply

```bash
# dry-run on a throwaway local stack first
supabase start
supabase db query --db-url "$LOCAL_DB_URL" -f db/migrations/031_song_release_year.sql
supabase db query --db-url "$LOCAL_DB_URL" -f db/backfill/release_years.sql   # note row count
supabase db query --db-url "$LOCAL_DB_URL" -f db/backfill/release_years.sql   # re-apply: same count, no error

# then prod (migration 031 must already be applied there)
supabase db query --linked -f db/backfill/release_years.sql
```

Spot-check anchors afterwards: *Back in Black* → 1980; a known cover → the
original's year. Add a `### Added` CHANGELOG line when the catalog gains years
that the new decade filter (PR2) can use.

## What's committed vs local

`year_backfill.py` and this runbook are committed. `db/backfill/release_years.sql`
is committed (reproducible record). Everything under `batches/` — the catalog
dump, the `year_in` / `year_out` CSVs, and `flagged.csv` — is gitignored working
data.
