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
| `build_candidates.py` | step 2: Wikidata candidates for every Hebrew or symbol key |
| `gen_alias_sql.py` | steps 5 and 6: `review.md` for the maintainer, then the upload, verify and undo SQL; `--check` in step 8 |
| `replay_pilot.py` | step 7: the 14 pilot playlists through the product's matcher, with the table as it will be after the upload; step 8: the same lists against the API |
| `whole_names.py` | Pick artists: lists the credits the database cuts into two or more artists, then writes the `artist_whole_names` upload, undo and verify SQL and the maintainer's review file (see "Whole names" at the end) |

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

Both dumps, in every run:

```bash
mkdir -p $B/_dumps
supabase db query --linked "select s.id, s.title, s.artist, s.unavailable_at, s.artist_keys, coalesce((select string_agg(g.slug, ';' order by g.slug) from song_genres sg join genres g on g.id = sg.genre_id where sg.song_id = s.id), '') as genres from songs s order by s.artist, s.title" > $B/_dumps/catalog_raw.json 2> $B/_dumps/catalog.err
supabase db query --linked "select alias, artist_key from artist_aliases order by alias" > $B/_dumps/aliases_raw.json 2> $B/_dumps/aliases.err
```

An empty `artist_aliases` table gives `"rows": []` in `aliases_raw.json`: that is a correct
dump. Step 6 refuses to run without it.

Steps 2 to 5 can take days (research, checking, the maintainer's review). When more than a few
hours have passed since this step, take both dumps again, with the same two commands, right
before step 6: step 6 checks the rules against the snapshot and builds the table after the
upload, and the undo, from the aliases dump.

### 2. Wikidata candidates

```bash
PYTHONUTF8=1 $P tools/song-curation/aliases/build_candidates.py --catalog $B/_dumps/catalog_raw.json --existing $B/_dumps/aliases_raw.json
```

- Network: run it outside the sandbox (`dangerouslyDisableSandbox: true`). Measured on
  2026-11-25: about 5 to 6 s per request (Wikidata's own answer time; the 1 s gap between two
  requests is not what limits it) and about two requests per key, so a full catalog run (about
  380 keys) takes about an hour: start it in the background and read its output when it ends.
  Every answer is cached under `$B/_cache/wikidata/`, so a rerun resumes where it stopped and a
  finished run repeats with no request. A key whose request failed for good is listed as
  `error`; a rerun tries it again.
- `--existing` only saves lookups: a key that already has a row in the table is skipped (an
  empty table skips none).
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
$P -c "import json; k=[r['artist_key'] for r in json.load(open('no_candidate.json', encoding='utf-8'))]; [open(f'research_in_p{i // 50 + 1}.json', 'w', encoding='utf-8').write(json.dumps(k[i:i + 50], ensure_ascii=False, indent=1)) for i in range(0, len(k), 50)]; print(len(k), 'keys in', -(-len(k) // 50), 'packets')"
```

One background `general-purpose` agent per packet, `model: "opus"`, at most 3 at once, with
this prompt (fill in the paths):

> Input: `<abs $B>/research_in_pN.json`, a JSON list of catalog artist keys (Hebrew-script names,
> or Latin names with a symbol) and nothing else. Read no other file in that folder. For each key:
> find the Latin spelling the artist (or band) uses on their own official pages: official
> website, verified YouTube channel,
> verified Spotify / Apple Music artist page, or their own social pages; record the exact page as
> `source_url`. For a Latin name with a symbol, look for the plain-letter spelling those pages
> also use. Several real spellings in use → one row each. No official Latin spelling found → no
> row (list the key in your reply). Never invent a transliteration. A film or show name is never
> an alias. Copy each `artist_key` exactly as the input has it. Output:
> `<abs $B>/research_pN.json`, a JSON list of exactly `{"artist_key", "alias", "source_url"}`,
> rewritten every ~10 keys. Never touch git, the database, or files outside your output. Reply
> briefly: counts, and the keys with no row.

Merge, from `$B` (it prints the rows and the packets it read):

```bash
$P -c "import glob, json; files=sorted(glob.glob('research_p*.json')); rows=[r for f in files for r in json.load(open(f, encoding='utf-8'))]; open('research.json', 'w', encoding='utf-8').write(json.dumps(rows, ensure_ascii=False, indent=1)); print(len(rows), 'rows from', len(files), 'packets in research.json')"
```

With no key left for research there is no `research.json`; steps 4 and 6 work without it.

### 4. Checking agent (every pair, fresh agents)

The pairs of `candidates.json` and `research.json` only (no notes, no reasons), in packets of
about 150, from `$B` (it prints the pairs and the packets):

```bash
$P -c "import json, os; rows=[{k: r[k] for k in ('artist_key', 'alias', 'source_url')} for f in ('candidates.json', 'research.json') if os.path.exists(f) for r in json.load(open(f, encoding='utf-8'))]; [open(f'check_in_p{i // 150 + 1}.json', 'w', encoding='utf-8').write(json.dumps(rows[i:i + 150], ensure_ascii=False, indent=1)) for i in range(0, len(rows), 150)]; print(len(rows), 'pairs in', -(-len(rows) // 150), 'packets')"
```

One new background `general-purpose` agent per packet (never a research agent), `model: "opus"`,
at most 3 at once:

> Input: `<abs $B>/check_in_pN.json`, a JSON list of `{"artist_key", "alias", "source_url"}`
> pairs only. Read no other file in that folder. For each pair: open the source (and search if
> needed) and decide whether the alias
> is a real spelling of the SAME artist or band as the catalog key. `confirmed` = a source shows
> that this artist uses or is credited under this spelling; `wrong` = a different person or band,
> a translation of a film or show name, or a misspelling nobody uses; `unsure` = could not verify.
> A film or show name in English and in Hebrew are two catalog entries, never an alias.
> `evidence` = one short sentence with what the source shows, and the link if it differs from
> `source_url`. Output: `<abs $B>/checked_pN.json` = every input row, unchanged and in the same
> order, plus `"verdict"` and `"evidence"`, rewritten every ~25 pairs. Never touch git, the
> database, or files outside your output. Reply briefly: counts per verdict.

Merge, from `$B`. The merged `checked.json` must have as many rows as the packets together; the
command prints both numbers:

```bash
$P -c "import glob, json; load=lambda f: json.load(open(f, encoding='utf-8')); sent=sum(len(load(f)) for f in glob.glob('check_in_p*.json')); rows=[r for f in sorted(glob.glob('checked_p*.json')) for r in load(f)]; open('checked.json', 'w', encoding='utf-8').write(json.dumps(rows, ensure_ascii=False, indent=1)); print(len(rows), 'rows in checked.json,', sent, 'pairs in the check_in packets (must be equal)')"
```

When the two numbers differ, an agent dropped or added rows: run that packet again with a fresh
agent before going on. A pair that an agent changed is dropped in step 5 anyway (rule (e)).

### 5. The maintainer's review

```bash
PYTHONUTF8=1 $P tools/song-curation/aliases/gen_alias_sql.py --batch $B --review
```

Give the maintainer the absolute path of `$B/review.md`. It lists the `unsure` and `wrong` pairs
with a box each (tick `[x]` to keep one; confirmed pairs are kept without a tick) and the pairs
the rules drop, with no box. They tell Claude when they are done.

The rules (a pair they drop is never uploaded):

- (a) the artist key is not a value of the snapshot's `artist_keys`;
- (b) the alias norms to its own key;
- (c) the alias norms to a catalog artist key. The matcher's rule 2 (`_alias` in
  `backend/app/services/setlist_matcher.py`) reads the alias table for every artist named on a
  line, catalog artists included, so such a row would let a line that names that catalog artist
  match a song of the same title by the alias's artist: a cross-artist match;
- (d) one alias in norm form gives two or more artist keys among the pairs that can be uploaded
  (the confirmed ones, and in step 6 the ticked ones): all of those pairs go. An unsure or wrong
  pair counts only once it is ticked, so it never drops a confirmed pair; on the review page it is
  dropped itself when a confirmed pair gives its alias another key. Two ticked pairs with the
  same alias and different keys both go: tick one;
- (e) the pair, cleaned, is in neither `candidates.json` nor `research.json` (a checking agent
  changed or added it).

To keep a dropped pair, fix `checked.json` and run `--review` again. A review.md with a ticked
box is not overwritten without `--force`, and `--force` clears the ticks: copy the ticked lines
first and tick them again in the new review.md (or ask the maintainer to).

### 6. The SQL

```bash
PYTHONUTF8=1 $P tools/song-curation/aliases/gen_alias_sql.py --batch $B
```

It needs `$B/_dumps/aliases_raw.json` (step 1, taken again right before this step when step 1 is
more than a few hours old) and stops when it is missing. It keeps the confirmed pairs and the
ticked ones, minus every rule drop, refuses to write when two of them norm alike with different
keys (rule (d) prevents that; the check is a second guard), and writes:

- `upload_aliases.sql`: one `INSERT ... ON CONFLICT (alias) DO UPDATE`;
- `aliases_final.json`: this upload's rows;
- `verify_aliases.sql`: one read-only `SELECT` (step 8);
- `undo_aliases.sql`: one statement that puts the table back as the dump shows it (step 8, only
  after a FAIL);
- `aliases_after_upload.json`: the dump's rows with this upload's rows replacing the same alias,
  as `ON CONFLICT` will (the same rows as `aliases_final.json` when the table is empty). Step 7
  reads it.

It prints the table's row count now and after the upload, how many rows the upload adds, and how
many of the dump's rows it moves to another artist key. It writes nothing when no pair is left.

Then check that no new row clashes with an alias already in the table (the same spelling in
`norm()` form, another artist key); this must print 0, or only the deliberate corrections
described below:

```bash
PYTHONUTF8=1 $P -c "import sys; sys.path.insert(0, 'tools/song-curation/aliases'); import common; from app.services.setlist_text import norm; old={norm(r['alias']): r for r in common.supabase_rows('$B/_dumps/aliases_raw.json')}; new=common.read_json('$B/aliases_final.json'); bad=[{'new': r, 'in_table': old[norm(r['alias'])]} for r in new if norm(r['alias']) in old and norm(old[norm(r['alias'])]['artist_key']) != norm(r['artist_key'])]; common.write_json('$B/_dumps/clashes.json', bad); print(len(bad), 'new rows clash with an alias already in the table (listed in _dumps/clashes.json)')"
```

When it prints more than 0, read `$B/_dumps/clashes.json`. For each clash, fix that row's
`artist_key` in `checked.json` or delete the row, then rerun step 6. When the row was a ticked
one, its line in review.md no longer matches: run step 5 first, with `--force` (which clears the
ticks: copy the ticked lines first and tick them again, or ask the maintainer). Keep a clash only
when the alias is exactly the table's and the new key is a deliberate correction of the old one;
then the upload moves it, step 6 counts it as moved, and `undo_aliases.sql` would move it back.

### 7. The pilot replay must PASS before an upload

The backend matches against the whole table, so the replay reads the table as it will be after
the upload:

```bash
PYTHONUTF8=1 $P tools/song-curation/aliases/replay_pilot.py --catalog $B/_dumps/catalog_raw.json --aliases $B/aliases_after_upload.json
```

PASS (exit 0) = every pilot list reaches the pilot's count and no refused trap matches. Exit 1 is
a FAIL, exit 2 a bad by-design list or a missing pilot file. The report (real names) is
`$B/replay_report.txt`.

stdout also gives the lost, gained and other-song totals against the pilot (not gated). Read the
`gained` and `other song` lines in each file's `[2] Against the pilot` section of the report: a
line that now finds a song by another artist than the line names means a wrong pair. Mark that
pair `wrong` in `checked.json` (and untick it in review.md if it was ticked), then rerun step 6
and this step.

The pilot folder is `tools/song-curation/batches/2026-11-24-setlist-pilot/` (git-ignored, on the
maintainer's computer; `--pilot DIR` points elsewhere). It must hold:

| File | What | Format | Written by |
| --- | --- | --- | --- |
| `playlists/NN-<name>.txt` | the 14 pilot playlists, `01` to `14` | the text as a host pastes it | the pilot (2026-11-24) |
| `results/NN-<name>.detail.txt` | the pilot's verdict for each unique song line of that playlist (offline mode only) | `<verdict> \| <artist> - <title>[   ==>   <catalog artist> - <catalog title>]`, the catalog part when the pilot found a song | the pilot's own script |
| `_dumps/refused_traps.txt` | title-only lines whose catalog song is by another performer: gated, none may match | the results format | controller ruling (the trap split of `check_title_only.txt`) |
| `_dumps/should_match.txt` | the other title-only lines: reported, not gated (offline mode only) | the results format | controller ruling (the same split) |
| `_dumps/by_design_losses.txt` | optional: pilot matches that a settled rule refuses by design; each lowers its file's required count when the product does not match it | `<file> \| <reason> \| <song line as written in that playlist>`, one entry per song line | controller ruling (Ruling X2) |

Blank lines and lines that start with `#` are skipped. All of it is private: git-ignored, never
committed. When a required file is missing, `replay_pilot.py` stops before it matches or sends
anything, with one line that names the missing files (exit 2). Without `by_design_losses.txt`
there are no exceptions, and stdout says so.

### 8. Upload, verify, then replay against production

Only after the maintainer names this production write, from the checkout with the Supabase link
(`$B` absolute, `C:/...`: a relative `-f` resolves against the project root):

```bash
supabase db query --linked -f "$B/upload_aliases.sql"
supabase db query --linked -f "$B/verify_aliases.sql" > $B/_dumps/verify_result.json
PYTHONUTF8=1 $P tools/song-curation/aliases/gen_alias_sql.py --batch $B --check $B/_dumps/verify_result.json
```

`--check` must print PASS: every uploaded pair is in the table, no row of the table points at an
artist key that no song has, and no row's alias is itself a song's artist key (`alias_is_key`:
rule (c) on the whole table, so it re-checks the older rows too after later catalog additions;
the exact form only, since step 6 checks this upload's rows in `norm()` form). `total_rows` can be
higher than the upload: earlier uploads.

The backend keeps the catalog and the aliases in memory for 10 minutes (`CACHE_SECONDS` in
`backend/app/services/setlist_catalog.py`). Wait 10 minutes, or restart the Render service,
then (network, outside the sandbox; about 7 s between lists):

```bash
PYTHONUTF8=1 $P tools/song-curation/aliases/replay_pilot.py --api https://api.soundclash.org --report $B/replay_api_report.txt
```

**When `--check` or the API replay FAILs**, tell the maintainer. Only after they name this
production write, undo the upload and check that the table is as it was:

```bash
supabase db query --linked -f "$B/undo_aliases.sql"
supabase db query --linked -f "$B/verify_aliases.sql" > $B/_dumps/verify_undone.json
PYTHONUTF8=1 $P tools/song-curation/aliases/gen_alias_sql.py --batch $B --check $B/_dumps/verify_undone.json --undone
```

The undo prints one row: `deleted` must equal `expected_deleted`, and `restored`
`expected_restored`. It deletes only the added rows that still hold what the upload wrote, and
gives a moved row its old key back only while it still holds the new one, so a second run, or a
run before the upload, changes nothing; a smaller number means a row changed after the upload and
was left alone. `--check --undone` must print PASS: the table has the dump's row count again and
holds only the uploaded pairs the dump already had. The undo is right only for the table the
dump shows, which is why step 1's dumps are taken again right before step 6.

### 9. Keep it private

Nothing in `$B` is committed. Commit only tool code. The weekly encrypted catalog backup picks
up the new rows.

## Whole names (whole_names.py)

The database cuts an artist credit into its artists (`song_artist_keys`, migration 049), so the
Pick artists list counts the made-up duet `Zed Band & Nia Quillfeather` for `Zed Band` and for
`Nia Quillfeather`. That is right for a duet. A few credits are one act whose name holds `&`, a comma or a Hebrew
word that starts with ו (made-up examples: the band `Salt & Pepper Co`, the film
`The Lamp, the Owl and the Kettle`). A row in the private table `artist_whole_names` (`name` =
the credit in lower case, trimmed) makes the list count that credit as one name. This tool finds
the credits the database cuts and, after people mark them, writes the SQL. It never connects to a
database or the network.

Everything stays in a git-ignored batch folder: `$W` =
`C:/.../tools/song-curation/batches/<YYYY-MM-DD>-whole-names` (absolute). Nothing in it is
committed.

**1. Candidates.** Take the catalog dump of step 1 above into `$W/_dumps/catalog_raw.json`, then:

```bash
PYTHONUTF8=1 $P tools/song-curation/aliases/whole_names.py candidates $W/_dumps/catalog_raw.json $W/candidates.tsv
```

One row per credit of the playable songs that the dump's `artist_keys` cut into two or more keys,
most songs first. Columns: `credit` (the most common spelling), `name` (lower case, trimmed),
`pieces`, `songs`, `kind` (`film`: every song has a soundtrack genre; `he`: Hebrew; `en`) and
`solo` (for each piece: `yes` when it has songs of its own, that is, a playable song whose
`artist_keys` hold the piece's key but not all the keys of this credit; a longer credit by the same
act, such as `Salt & Pepper Co feat. Zed Band`, does not count). Credits where the Python split
and the dump's keys disagree also go to `$W/candidates.mismatch.tsv`, with the count on stdout.
The database's keys decide which credits are listed.

**2. Marks.** A research agent and then a second, checking agent mark each row. The controller
adds four tab-separated columns to the file: `research` and `check` (`one` or `several`), `source`
and `check_note` (short notes, may be empty).

- `one`: one act that performs under that name (a band, a duo known by one name, a show or film
  title), or a piece alone is not a name a host would know.
- `several`: each piece is an artist with songs of their own.

Only a row with `one` in both `research` and `check` is uploaded. Any other value in those two
columns stops the tool.

**3. SQL and review.**

```bash
PYTHONUTF8=1 $P tools/song-curation/aliases/whole_names.py sql $W/reviewed.tsv $W/whole_names.sql
```

It writes five files in the folder of the SQL file:

- `whole_names.sql`: one `INSERT ... ON CONFLICT DO NOTHING`. A second run changes nothing.
- `undo_whole_names.sql`: one `DELETE` of exactly the uploaded names.
- `verify_whole_names.sql`: one read-only `SELECT`, one row per uploaded name with `present`.
- `review.txt`: for the maintainer. One line per name to upload,
  `<credit> instead of <piece 1> | <piece 2> — <source>` (the pieces joined with ` | `, so a
  comma cut shows), then the rows the two agents did not agree on.
- `contained.txt`: credits that are not uploaded but hold an uploaded name as a part (made up:
  `zed & co feat. nia quillfeather` holds `zed & co`). They stay cut: the table matches whole
  credits only.

With no row to upload it writes no SQL file and says so (exit 1). The maintainer reads
`review.txt` before anything is uploaded.

**4. Upload, verify, undo.** Each is one statement, run from the checkout with the Supabase link
(absolute paths), and the upload only when the maintainer names it:

```bash
supabase db query --linked -f "C:/abs/path/whole_names.sql"
supabase db query --linked -f "C:/abs/path/verify_whole_names.sql"
```

`present` must be true on every row. The undo, `undo_whole_names.sql`, also runs only when the
maintainer names it; then `verify_whole_names.sql` shows `present` false on every row.

The tests use made-up credits and need no database or network:

```bash
PYTHONUTF8=1 $P -m pytest tools/song-curation/aliases/test_whole_names.py -p no:cov -q
```
