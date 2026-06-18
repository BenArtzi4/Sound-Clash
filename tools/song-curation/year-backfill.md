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

### 4. Judge wave (independent, blind)

A second set of agents gets the **same `year_in/batch_NN.csv`** — **not** the
extractor's answers — and re-derives the year independently, leading with the
structured sources (MusicBrainz / Wikidata) so the two waves don't share a
failure mode. Run them on a different model than the extractor where possible
for true cross-model corroboration. Write to `year_out/judge_batch_NN.csv`:

```
youtube_id,year,confidence,note
```

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
confident. Everything else (`disagree`, `low-confidence`, `no-judge`, `no-year`)
goes to `flagged.csv`, sorted worst-first with the YouTube link and both
proposed years.

### 6. Human review

Eyeball `flagged.csv` top-down. Resolve each by appending a corrected row to a
small `year_out/extract_manual.csv` + `year_out/judge_manual.csv` (same headers,
matching years, confidence `1.0`) and re-running `build`, or by hand-editing
`release_years.sql`. Covers and disagreements cluster at the top — that's where
the judgement is.

### 7. Apply

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
