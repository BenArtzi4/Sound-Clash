# Artist alias tools

A host's pasted song list is matched against the catalog by artist key, a value of
`songs.artist_keys` (lower case, the catalog's own spelling). A key in Hebrew script, or a
Latin key with a symbol (made-up examples: `bl!nk`, `ca$h`), is missed when the host types the
artist in other letters (`blink`, `cash`). The `artist_aliases` table maps such a spelling to one
artist key (`alias` = lower case and trimmed, `artist_key` = a value of `songs.artist_keys`);
the matcher reads it through `backend/app/services/setlist_catalog.py`.

These tools build that table offline. They never connect to the database; uploading is a
maintainer step.

| File | What |
| --- | --- |
| `common.py` | shared helpers: reads a CLI dump, builds the product's `CatalogIndex`, puts this checkout's `backend/` first on `sys.path` |
| `build_candidates.py` | step 1: Wikidata candidates for every Hebrew or symbol key |
| `gen_alias_sql.py` | steps 5 and 6: `review.md` for the maintainer, then the upload and verify SQL; `--check` after the upload |
| `replay_pilot.py` | step 7: the 14 pilot playlists through the product's matcher, with the alias file |

**Private data.** The rows name the catalog's artists. Snapshots, candidates, agent outputs,
`review.md`, the SQL and the reports stay in the batch folder under `tools/song-curation/batches/`
(git-ignored). Never put a real artist name in a committed file, a commit message or a PR. The
private catalog backup (`.github/workflows/catalog-backup.yml`) already dumps `artist_aliases`.

## Conventions

- `$B` = the batch folder, an absolute path: `C:/.../tools/song-curation/batches/<YYYY-MM-DD>-aliases`.
- `$P` = the absolute path of the backend venv's python (`backend/.venv/Scripts/python.exe` on
  Windows, `backend/.venv/bin/python` elsewhere), run with `PYTHONUTF8=1` set. Never `-I`: it
  drops `PYTHONUTF8`.
- The tools run from the repository root (a worktree works: `common.py` imports that checkout's
  `backend/`). `supabase` commands run from the checkout that holds the Supabase link (the main
  tree; a worktree has none).
- stdout gets counts only. Read the files for names.

## The run

### 1. Snapshot (read-only)

```bash
mkdir -p $B/_dumps
supabase db query --linked "select s.id, s.title, s.artist, s.unavailable_at, s.artist_keys, coalesce((select string_agg(g.slug, ';' order by g.slug) from song_genres sg join genres g on g.id = sg.genre_id where sg.song_id = s.id), '') as genres from songs s order by s.artist, s.title" > $B/_dumps/catalog_raw.json 2> $B/_dumps/catalog.err
```

For an incremental run (new artists only, see the add-songs skill), also dump the table:

```bash
supabase db query --linked "select alias, artist_key from artist_aliases" > $B/_dumps/aliases_raw.json 2> $B/_dumps/aliases.err
```

### 2. Wikidata candidates

```bash
PYTHONUTF8=1 $P tools/song-curation/aliases/build_candidates.py --catalog $B/_dumps/catalog_raw.json [--existing $B/_dumps/aliases_raw.json]
```

- Network: run it outside the sandbox (`dangerouslyDisableSandbox: true`). About 1 s per
  request and two requests per key, so a full catalog takes 10 to 15 minutes: start it in the
  background and read its output when it ends. Every answer is cached under `$B/_cache/wikidata/`,
  so a rerun resumes where it stopped and a finished run repeats with no request. A key whose
  request failed for good is listed as `error`; a rerun tries it again.
- `--limit N` looks at the first N keys only (a trial); `--out DIR` writes elsewhere (default `$B`).
- Keys: the `artist_keys` values of playable songs that are Hebrew (a character in
  U+0590-U+05FF) or hold a symbol (no Hebrew, a character that is not a letter, digit or space).
  Skipped (`skipped.json`): `film_or_show` (every playable song of the key is a soundtrack song:
  an English title of a film or show is a translation, never an alias) and `existing` (the key
  already has a row in `--existing`).
- A Wikidata entity is used when one of its labels or aliases in the search language (Hebrew for
  a Hebrew key, English for a symbol key) equals the key under `norm()` and it is a music act (a
  music word in its description, or "instance of: musical group"). Its English names (the `en`
  and `mul` labels and aliases) are the candidates, unless one norms to the key itself.
- Writes `candidates.json` (`artist_key`, `alias`, `source_url`), `no_candidate.json`
  (`artist_key`, `reason`: `no_match`, `ambiguous` = two music acts with different English names,
  `no_latin_alias`, `error`) and `skipped.json`.

### 3. Research agent (keys with no candidate)

From `$B`, cut `no_candidate.json` into packets of about 50 keys (keys only, no reasons):

```bash
$P -c "import json; k=[r['artist_key'] for r in json.load(open('no_candidate.json', encoding='utf-8'))]; [open(f'research_in_p{i // 50 + 1}.json', 'w', encoding='utf-8').write(json.dumps(k[i:i + 50], ensure_ascii=False, indent=1)) for i in range(0, len(k), 50)]"
```

One background `general-purpose` agent per packet, `model: "opus"`, at most 3 at once, with
this prompt (fill in the paths):

> Input: `<abs $B>/research_in_pN.json`, a JSON list of catalog artist keys (Hebrew-script names,
> or Latin names with a symbol) and nothing else. For each key: find the Latin spelling the
> artist (or band) uses on their own official pages: official website, verified YouTube channel,
> verified Spotify / Apple Music artist page, or their own social pages; record the exact page as
> `source_url`. For a Latin name with a symbol, look for the plain-letter spelling those pages
> also use. Several real spellings in use → one row each. No official Latin spelling found → no
> row (list the key in your reply). Never invent a transliteration. A film or show name is never
> an alias. Copy each `artist_key` exactly as the input has it. Output:
> `<abs $B>/research_pN.json`, a JSON list of exactly `{"artist_key", "alias", "source_url"}`,
> rewritten every ~10 keys. Never touch git, the database, or files outside your output. Reply
> briefly: counts, and the keys with no row.

Merge, from `$B`:

```bash
$P -c "import glob, json; rows=[r for f in sorted(glob.glob('research_p*.json')) for r in json.load(open(f, encoding='utf-8'))]; open('research.json', 'w', encoding='utf-8').write(json.dumps(rows, ensure_ascii=False, indent=1))"
```

### 4. Checking agent (every pair, fresh agents)

The pairs of `candidates.json` and `research.json` only (no notes, no reasons), in packets of
about 150, from `$B`:

```bash
$P -c "import json; rows=[{k: r[k] for k in ('artist_key', 'alias', 'source_url')} for f in ('candidates.json', 'research.json') for r in json.load(open(f, encoding='utf-8'))]; [open(f'check_in_p{i // 150 + 1}.json', 'w', encoding='utf-8').write(json.dumps(rows[i:i + 150], ensure_ascii=False, indent=1)) for i in range(0, len(rows), 150)]"
```

One new background `general-purpose` agent per packet (never a research agent), `model: "opus"`,
at most 3 at once:

> Input: `<abs $B>/check_in_pN.json`, a JSON list of `{"artist_key", "alias", "source_url"}`
> pairs only. For each pair: open the source (and search if needed) and decide whether the alias
> is a real spelling of the SAME artist or band as the catalog key. `confirmed` = a source shows
> that this artist uses or is credited under this spelling; `wrong` = a different person or band,
> a translation of a film or show name, or a misspelling nobody uses; `unsure` = could not verify.
> A film or show name in English and in Hebrew are two catalog entries, never an alias.
> `evidence` = one short sentence with what the source shows, and the link if it differs from
> `source_url`. Output: `<abs $B>/checked_pN.json` = every input row, unchanged and in the same
> order, plus `"verdict"` and `"evidence"`, rewritten every ~25 pairs. Never touch git, the
> database, or files outside your output. Reply briefly: counts per verdict.

Merge, from `$B` (the result must have as many rows as the packets together):

```bash
$P -c "import glob, json; rows=[r for f in sorted(glob.glob('checked_p*.json')) for r in json.load(open(f, encoding='utf-8'))]; open('checked.json', 'w', encoding='utf-8').write(json.dumps(rows, ensure_ascii=False, indent=1))"
```

### 5. The maintainer's review

```bash
PYTHONUTF8=1 $P tools/song-curation/aliases/gen_alias_sql.py --batch $B --review
```

Give the maintainer the absolute path of `$B/review.md`. It lists the `unsure` and `wrong` pairs
with a box each (tick `[x]` to keep one; confirmed pairs are kept without a tick) and the pairs
the rules drop, with no box. They tell Claude when they are done.

The rules (a pair they drop is never uploaded): (a) the artist key is not a value of the
snapshot's `artist_keys`; (b) the alias norms to its own key; (c) the alias norms to a catalog
artist key (the matcher tries a key before an alias); (d) one alias in norm form points at two
or more keys (all of those pairs go). To keep a dropped pair, fix `checked.json` and run
`--review` again. A review.md with a ticked box is not overwritten without `--force`, and
`--force` loses the ticks.

### 6. The SQL

```bash
PYTHONUTF8=1 $P tools/song-curation/aliases/gen_alias_sql.py --batch $B
```

Keeps the confirmed pairs and the ticked ones, minus every rule drop, and writes
`upload_aliases.sql` (one `INSERT ... ON CONFLICT (alias) DO UPDATE`), `aliases_final.json` and
`verify_aliases.sql` (one read-only `SELECT`). It writes nothing when no pair is left.

In an incremental run the upload moves an alias that is already in the table to its new key.
Check that no new row clashes with one already there; this must print 0:

```bash
PYTHONUTF8=1 $P -c "import sys; sys.path.insert(0, 'tools/song-curation/aliases'); import common; from app.services.setlist_text import norm; old={norm(r['alias']): r['artist_key'] for r in common.supabase_rows('$B/_dumps/aliases_raw.json')}; new=common.read_json('$B/aliases_final.json'); print(sum(norm(r['alias']) in old and norm(old[norm(r['alias'])]) != norm(r['artist_key']) for r in new), 'new rows clash with an alias already in the table')"
```

### 7. The pilot replay must PASS before an upload

```bash
PYTHONUTF8=1 $P tools/song-curation/aliases/replay_pilot.py --catalog $B/_dumps/catalog_raw.json --aliases $B/aliases_final.json
```

PASS (exit 0) = every pilot list reaches the pilot's count and no refused trap matches. The
report (real names) is `$B/replay_report.txt`. It needs the pilot folder
`tools/song-curation/batches/2026-11-24-setlist-pilot/` (git-ignored, on the maintainer's
computer; `--pilot DIR` points elsewhere).

### 8. Upload, verify, then replay against production

Only after the maintainer names this production write, from the checkout with the Supabase link
(`$B` absolute, `C:/...`: a relative `-f` resolves against the project root):

```bash
supabase db query --linked -f "$B/upload_aliases.sql"
supabase db query --linked -f "$B/verify_aliases.sql" > $B/_dumps/verify_result.json
PYTHONUTF8=1 $P tools/song-curation/aliases/gen_alias_sql.py --batch $B --check $B/_dumps/verify_result.json
```

`--check` must print PASS: every uploaded pair is in the table and no row of the table points at
an artist key that no song has (`total_rows` can be higher than the upload: earlier uploads).

The backend keeps the catalog and the aliases in memory for 10 minutes (`CACHE_SECONDS` in
`backend/app/services/setlist_catalog.py`). Wait 10 minutes, or restart the Render service,
then (network, outside the sandbox; about 7 s between lists):

```bash
PYTHONUTF8=1 $P tools/song-curation/aliases/replay_pilot.py --api https://api.soundclash.org --report $B/replay_api_report.txt
```

### 9. Keep it private

Nothing in `$B` is committed. Commit only tool code. The weekly encrypted catalog backup picks
up the new rows.
