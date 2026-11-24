# Custom Setlist, Phase 1 (pasted names) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A host pastes a list of songs, films or artists, and the game plays the catalog songs of that list first, then more songs by the same artists.

**Architecture:** Matching runs once in FastAPI and saves a per-game song pool in two new Postgres tables. `select_next_song` and `peek_next_song` get one branch that picks from that pool. `active_games`, the buzzer functions and the genre picker are not changed.

**Tech Stack:** Postgres PL/pgSQL (two new migrations), FastAPI + supabase-py (standard library only), React 18 + TypeScript, pytest + testcontainers, vitest, Playwright. No new package.

**Spec:** [2026-11-24-custom-setlist-design.md](2026-11-24-custom-setlist-design.md). Read it first. Phase 2 (YouTube playlist links) gets its own plan after this one ships.

## Global Constraints

- **Process:** follow [EXECUTION-CONTRACT.md](EXECUTION-CONTRACT.md) for every PR. One-line commit messages, no AI attribution. Never merge, and never apply a migration to production, unless the maintainer names that action in the current prompt.
- **Where to work:** a git worktree from fresh `origin/main` (`git worktree add ../sc-setlist -b feature/custom-setlist-db origin/main`). The main tree is on another branch and holds the maintainer's uncommitted files; do not touch it. One worktree agent per message.
- **No new dependency. No `.github/workflows/` change.**
- **Not changed, at all:** the `active_games` table (columns, triggers, policies, publication), `buzz_in`, `award_attempt`, `release_buzz_lock`, `start_round`, `end_round`, `pick_next_song`, and the existing test files for them. If one of those tests fails, the change is wrong; do not edit the test.
- **Kept signatures:** `select_next_song(text, uuid, uuid, integer)` and `peek_next_song(text, uuid)` keep their arguments, return columns and grants. Use `CREATE OR REPLACE`, starting from the newest body on `main` (migration 057 on 2026-11-24; confirm with `git grep -l "FUNCTION select_next_song" origin/main -- db/migrations | tail -n 1`).
- **Migrations:** the next free numbers (060 and 061 on 2026-11-24; confirm with `git ls-tree --name-only origin/main db/migrations/ | tail -n 3`). Idempotent. Apply each twice on the local stack.
- **Limits:** 300 lines and 20,000 characters per list. Rate limit `10/minute` on `POST /setlists/check` and `POST /games`.
- **Catalogue protection:** an API answer holds titles and artists only. Never a song id, a YouTube id or a start time.
- **Private data:** alias rows and real catalog names are never committed. Tests use made-up catalog rows.
- **Order of play:** tier 1 (the host's list) before tier 2 (same artists). No genre fill. No mode switch.
- **Matching:** the rule order of spec section 7. A line that names another artist never matches on the title alone.
- **Docs in the same PR:** `docs/data-model.md`, `docs/rpc-functions.md`, `docs/security-rls.md`, `docs/api-contracts.md`, the RPC list in `CLAUDE.md`. A `CHANGELOG.md` `[Unreleased]` line for each user-visible PR.
- **Gates:** backend line coverage at least 90%, no `# pragma: no cover`; frontend no `it.skip`, no state library, no CSS-in-JS, `any` needs a `// reason` comment.
- **Local test commands:** database subset `cd backend && DATABASE_URL="" python -m pytest -c pyproject.toml --rootdir=. -p no:cov ../tests/db/<file> -q` (Docker Desktop must run; stop it after). Frontend `cd frontend && npx vitest run <file>`.

## Review Focus

1. **A paste that is not a list** (Spotify track links, a playlist link, a page of HTML, one 20,000-character line). Expected: the helper or a clear message; never a 500 and never an empty game. Tests: Task 3 step 1, Task 6 step 1, Task 10 step 1.
2. **Hebrew with marks**: right-to-left marks, niqqud, `״` and `׳`, curly quotes. Expected: the same match as plain text. Test: Task 3 step 1.
3. **The catalog changes between Check and Create** (a song is deleted or flagged). Expected: the game is created with the songs that remain, or a clear `setlist_empty`; never a foreign-key 500. Tests: Task 1 step 1, Task 7 step 1.
4. **A list by one artist or one film.** Expected: every song plays; the artist-spacing rule never blocks. Test: Task 1 step 1.
5. **The host reloads the console or opens the backup host link mid-game.** Expected: the progress line is right and the next song still comes from the pool. Tests: Task 11 step 1, Task 12 step 1.

## File Map

| File | Responsibility |
| --- | --- |
| `db/migrations/060_game_song_pool.sql` | Pool tables, pool picker, save and summary functions, the branch in select and peek |
| `db/migrations/061_setlist_support_tables.sql` | `artist_aliases`, `song_demand`, `record_song_demand` |
| `backend/app/services/setlist_text.py` | Text rules: normalise, clean, split artists, cross-script skeleton, parse a paste |
| `backend/app/services/setlist_matcher.py` | Match lines against an in-memory catalog index; compute the two tiers |
| `backend/app/services/setlist_catalog.py` | Load and cache the catalog index and the aliases |
| `backend/app/models/setlists.py`, `backend/app/routers/setlists.py` | `POST /setlists/check` |
| `backend/app/models/games.py`, `backend/app/routers/games.py` | `POST /games` with a list |
| `tools/song-curation/aliases/` | Offline alias build, SQL generator, pilot replay (code only; data stays in `batches/`) |
| `frontend/src/lib/setlistText.ts` | Count lines, detect pasted links |
| `frontend/src/components/MusicSourceSwitch.tsx` | The switch at the top of the Host page; one address for each tab |
| `frontend/src/components/SetlistPanel.tsx`, `SetlistHelp.tsx` | The "My own list" panel and the converter helper |
| `frontend/src/hooks/useSetlistProgress.ts` | The console's "left in your list" numbers |
| `tests/e2e/custom_setlist.spec.ts` | One custom game from create to "no more songs" |
| `tests/smoke/setlist_fingerprint.sql`, `tests/smoke/setlist_timing_selfcheck.sql` | The no-regression proofs |

PRs: **PR 1** = Tasks 1 and 2. **PR 2** = Tasks 3 to 7. **PR 3** = Task 8 (tool code only). **PR 4** = Tasks 9 to 12. Task 13 runs across them.

---

### Task 1: Song pool tables, picker and the select/peek branch

**Files:**
- Create: `db/migrations/060_game_song_pool.sql`
- Create: `tests/db/test_game_song_pool.py`
- Modify: `tests/db/test_rls_anon.py`, `tests/db/test_rls_function_grants.py` (add cases only)
- Modify: `docs/data-model.md`, `docs/rpc-functions.md`, `docs/security-rls.md`, `CLAUDE.md`

**Interfaces:**
- Consumes: `songs.artist_keys`, `songs.unavailable_at`, `game_rounds`, `game_secrets.manager_token`, the bodies of `select_next_song` and `peek_next_song` from migration 057, the `artist_history` / `scored` / `ranked` steps of `pick_next_song` (migration 056).
- Produces:

```sql
game_setlists (game_code text PRIMARY KEY REFERENCES active_games(game_code) ON DELETE CASCADE,
               ready boolean NOT NULL DEFAULT false,
               list_total integer NOT NULL DEFAULT 0,
               created_at timestamptz NOT NULL DEFAULT now())
game_song_pool (game_code text NOT NULL REFERENCES game_setlists(game_code) ON DELETE CASCADE,
                song_id uuid NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
                tier smallint NOT NULL CHECK (tier IN (1, 2)),
                PRIMARY KEY (game_code, song_id))
-- both: RLS enabled, no policy, REVOKE ALL FROM anon, authenticated; not in the realtime publication

pick_next_pool_song(p_game_code text) RETURNS uuid                -- service_role only; NULL when nothing is left
save_game_setlist(p_game_code text, p_list_song_ids uuid[], p_fill_song_ids uuid[], p_list_total integer)
  RETURNS integer                                                 -- pool size; service_role only
game_pool_summary(p_game_code text, p_manager_token uuid)
  RETURNS TABLE(list_total integer, list_songs integer, list_left integer,
                extra_songs integer, extra_left integer)          -- anon-callable, token-gated
```

Behaviour the tests pin:

- `save_game_setlist`: `game_not_found` (P0002) for an unknown code; `setlist_exists` (P0001) on a second call; ids that are not in `songs` are skipped; an id in both arrays is tier 1; `setlist_empty` (22023) when no id is left, and then nothing is written; the `game_setlists` row is inserted with `ready = true` in the same call.
- `select_next_song` and `peek_next_song`, after the token check: read `game_setlists.ready` by key. Row found and `ready = false` → `setlist_not_ready` (P0001). Row found → skip the `no_genres_selected` check, pick with `pick_next_pool_song`, and in the guarded `p_song_id` path accept the song only if it is in the pool, not played and available (`song_no_longer_eligible` otherwise). No row → today's path, unchanged.
- `game_pool_summary`: the token check of `peek_next_song`; zero rows for a game with no `game_setlists` row; `list_songs` counts tier 1, `list_left` counts tier 1 not played and available; the same for tier 2.

- [ ] **Step 1: Write the failing tests** in `tests/db/test_game_song_pool.py`

```python
async def _setlist_game(conn, tier1: int, tier2: int, *, ready: bool = True, artist: str | None = None):
    """Game + tier1/tier2 songs saved through save_game_setlist. Returns (code, token, ids1, ids2)."""

async def _play(conn, code, token) -> uuid.UUID:
    return (await conn.fetchrow(
        "SELECT * FROM select_next_song($1, $2, NULL::uuid, NULL::integer)", code, token))["song_id"]

async def test_list_songs_play_before_same_artist_songs(db):
    code, token, ids1, ids2 = await _setlist_game(db, 3, 3)
    first = [await _play(db, code, token) for _ in range(3)]
    assert set(first) == set(ids1)
    assert {await _play(db, code, token) for _ in range(3)} == set(ids2)

async def test_no_repeat_then_no_more_songs(db):
    code, token, *_ = await _setlist_game(db, 2, 1)
    assert len({await _play(db, code, token) for _ in range(3)}) == 3
    with pytest.raises(asyncpg.PostgresError, match="no_more_songs"):
        await _play(db, code, token)

async def test_unavailable_song_is_skipped(db):          # one tier-1 song flagged unavailable_at = now()
async def test_not_ready_blocks_select_and_peek(db):     # UPDATE game_setlists SET ready = false -> 'setlist_not_ready' from both
async def test_guarded_select_rejects_song_outside_pool(db)   # p_song_id of a catalog song not in the pool -> 'song_no_longer_eligible'
async def test_peek_returns_pool_song_and_does_not_advance(db)
async def test_single_artist_pool_plays_every_song(db):  # Review Focus 4: 6 songs, artist="Same Artist" -> 6 different songs, no error
async def test_save_skips_unknown_ids_and_prefers_tier_1(db):  # Review Focus 3: uuid4() in the list array, one id in both arrays
    assert await db.fetchval("SELECT tier FROM game_song_pool WHERE game_code=$1 AND song_id=$2", code, both) == 1
async def test_save_empty_raises_and_writes_nothing(db):  # 'setlist_empty'; no game_setlists row afterwards
async def test_save_twice_raises_setlist_exists(db)
async def test_pool_is_deleted_with_the_game(db):         # DELETE FROM active_games -> 0 rows in both tables
async def test_summary_counts_and_token(db):
    # 3 tier-1, 2 tier-2, list_total 5, one round played
    assert dict(row) == {"list_total": 5, "list_songs": 3, "list_left": 2, "extra_songs": 2, "extra_left": 2}
    # wrong token -> 'manager_token_required'
async def test_genre_game_has_no_summary_and_still_plays(db):  # no game_setlists row: summary returns 0 rows, select works as before
```

Add to `test_rls_anon.py`: anon gets "permission denied" on `SELECT` from `game_setlists` and `game_song_pool`. Add to `test_rls_function_grants.py`: anon cannot execute `pick_next_pool_song` or `save_game_setlist`; anon can execute `game_pool_summary`.

- [ ] **Step 2: Run them and see them fail** (`relation "game_setlists" does not exist`).

- [ ] **Step 3: Write `db/migrations/060_game_song_pool.sql`**

One transaction. `CREATE TABLE IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`, re-runnable grants. The pool picker:

```sql
WITH played AS (            -- as in pick_next_song
  SELECT gr.song_id AS sid, gr.round_number AS rn FROM game_rounds gr
   WHERE gr.game_code = p_game_code AND gr.song_id IS NOT NULL
),
candidates AS (
  SELECT p.tier, s.id AS sid, s.artist_keys
    FROM game_song_pool p JOIN songs s ON s.id = p.song_id
   WHERE p.game_code = p_game_code
     AND s.unavailable_at IS NULL
     AND s.id NOT IN (SELECT played.sid FROM played)
),
chosen_songs AS (
  SELECT c.sid, c.artist_keys FROM candidates c
   WHERE c.tier = (SELECT min(tier) FROM candidates)
)
-- then last_round, artist_history, scored (spacing, plays) and the weighted draw
-- exactly as in pick_next_song (migration 056), over chosen_songs.
-- Leave out the genre balance, artist_left and genre_left: plays is used as it is.
```

Add an index-free design note in the file header: both tables are read by primary key only.

- [ ] **Step 4: Run the new tests and the untouched ones** (`test_select_next_song.py`, `test_peek_next_song.py`, `test_song_spacing.py`, `test_guarded_round_advance.py`, `test_buzz_in_race.py`, `test_migrations_idempotent.py`). Expected: all pass, with no edit to those files.

- [ ] **Step 5: Update the four docs and the RPC list in `CLAUDE.md`** (seven anon-callable RPCs now; `game_pool_summary` is the new one). Commit: `Add the per-game song pool and its picker for custom setlists`.

### Task 2: Alias and demand tables

**Files:**
- Create: `db/migrations/061_setlist_support_tables.sql`, `tests/db/test_setlist_support_tables.py`
- Modify: `tests/db/test_rls_anon.py`, `docs/data-model.md`, `docs/rpc-functions.md`, `docs/security-rls.md`

**Interfaces:**
- Produces:

```sql
artist_aliases (alias text PRIMARY KEY CHECK (alias = lower(btrim(alias)) AND alias <> ''),
                artist_key text NOT NULL,           -- a value that appears in songs.artist_keys
                created_at timestamptz NOT NULL DEFAULT now())   -- + index on artist_key
song_demand (line_key text PRIMARY KEY, raw_line text NOT NULL,
             request_count integer NOT NULL DEFAULT 1,
             first_requested_at timestamptz NOT NULL DEFAULT now(),
             last_requested_at timestamptz NOT NULL DEFAULT now(),
             status text NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','approved','rejected','added')))
record_song_demand(p_keys text[], p_lines text[]) RETURNS integer   -- rows touched; service_role only
-- both tables: durable, RLS enabled, no policy, REVOKE ALL FROM anon, authenticated
```

- [ ] **Step 1: Write the failing tests**

```python
async def test_alias_must_be_lowercase_and_trimmed(db):   # INSERT ' Omer Adam' -> check_violation
async def test_record_demand_inserts_then_counts(db):
    await db.fetchval("SELECT record_song_demand($1, $2)", ["queen innuendo"], ["Queen - Innuendo"])
    await db.fetchval("SELECT record_song_demand($1, $2)", ["queen innuendo"], ["QUEEN - Innuendo "])
    row = await db.fetchrow("SELECT raw_line, request_count FROM song_demand WHERE line_key = 'queen innuendo'")
    assert (row["raw_line"], row["request_count"]) == ("Queen - Innuendo", 2)
async def test_record_demand_rejects_unequal_arrays(db)
async def test_rejected_status_survives_a_new_request(db)   # status stays 'rejected', count still rises
```

Plus anon "permission denied" on both tables in `test_rls_anon.py`.

- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Write migration 061.** `record_song_demand` is one `INSERT ... SELECT unnest ... ON CONFLICT (line_key) DO UPDATE SET request_count = song_demand.request_count + 1, last_requested_at = now()`.
- [ ] **Step 4: Run the tests and the idempotency test. Expected: pass.**
- [ ] **Step 5: Update the docs. Commit:** `Add the artist alias and song demand tables`.

### Task 3: Text rules

**Files:**
- Create: `backend/app/services/setlist_text.py`, `tests/backend/test_setlist_text.py`
- Modify: `backend/app/db/errors.py` (add `SetlistError`)

**Interfaces:**
- Consumes: the proven rules in the pilot script `tools/song-curation/batches/2026-11-24-setlist-pilot/pilot_match.py` (git-ignored, so it exists only in the maintainer's main working tree, not in a worktree: copy `JUNK_WORDS`, `HEB`, `LAT_PAIRS`, `LAT` from there) and `norm` in `tools/song-curation/requests/parse_requests.py`.
- Produces:

```python
MAX_LINES = 300
MAX_CHARS = 20_000

class SetlistError(DomainError):          # in app/db/errors.py; status = 400
    def __init__(self, code: str, message: str) -> None: ...   # sets self.code
# codes: "setlist_too_long", "setlist_links_only", "setlist_no_songs", "setlist_empty"

@dataclass(frozen=True)
class ListLine:
    raw: str            # the line as the host wrote it, trimmed
    left: str           # text before the first separator, or the whole line
    right: str | None   # text after it; None when the line has no separator

def norm(s: str) -> str
def clean_title(s: str) -> str
def artist_keys(s: str) -> tuple[str, ...]      # credited artists, main artist first
def is_hebrew(s: str) -> bool
def skeleton(s: str) -> str                      # consonants only, doubled letters collapsed, both scripts
def parse_setlist_text(text: str) -> list[ListLine]
```

Parsing rules: drop the BOM, `\r`, the marks U+200E, U+200F, U+202A to U+202E and U+2066 to U+2069; skip empty lines and lines that start with `#`; strip leading numbering (`1.`, `01 -`, `•`, `*`) and a trailing duration (`3:51`); split on the first ` - `, ` – ` or ` — `. A first line that is a CSV or TSV header with a title column (`track name`, `title` or `song`) and an artist column gives `left` = artist and `right` = title for every row. A line that is only a URL is dropped; if every line is a URL, raise `setlist_links_only`.

- [ ] **Step 1: Write the failing tests**

```python
def test_norm():
    assert norm("  Beyoncé ") == "beyonce"
    assert norm("שָׁלוֹם") == "שלום"                                   # niqqud
    assert norm("\u200fנערי שובה אליי\u200e") == "נערי שובה אלי"       # Review Focus 2
    assert norm('שב"ק ס\'') == norm("שב״ק ס׳") == "שב ק ס"

def test_clean_title():
    assert clean_title('Let It Go - From "Frozen"/Soundtrack Version') == "Let It Go"
    assert clean_title("Everybody (Backstreet's Back) - Extended Version") == "Everybody (Backstreet's Back)"
    assert clean_title("Be Without You (Intro Clean)") == "Be Without You"
    assert clean_title("לאן שלא תלכי - רמיקס") == "לאן שלא תלכי"
    assert clean_title("Wake Me Up Before You Go-Go") == "Wake Me Up Before You Go-Go"

def test_artist_keys():
    assert artist_keys("Macklemore & Ryan Lewis ft. Ray Dalton") == ("macklemore", "ryan lewis", "ray dalton")
    assert artist_keys("סטטיק ובן אל תבורי") == ("סטטיק", "בן אל תבורי")

def test_skeleton_is_the_same_in_both_scripts():
    assert skeleton("Zohar Argov") == skeleton("זוהר ארגוב") == "zrgb"
    assert skeleton("Ha'perah Be'gani") == skeleton("הפרח בגני") == "prbgn"

def test_parse_lines():
    text = "\ufeff1. Queen - Bohemian Rhapsody\r\n\n# my party - 2026\n02 - ABBA – Dancing Queen  3:51\nFrozen\n"
    assert [(l.left, l.right) for l in parse_setlist_text(text)] == [
        ("Queen", "Bohemian Rhapsody"), ("ABBA", "Dancing Queen"), ("Frozen", None)]
    assert [(l.left, l.right) for l in parse_setlist_text("50 Cent - In Da Club\n1999 - Prince")] == [
        ("50 Cent", "In Da Club"), ("1999", "Prince")]

def test_parse_csv_with_header():
    text = "Track Name,Artist Name(s),Album\nLet It Go,\"Idina Menzel, Disney\",Frozen\n"
    assert [(l.left, l.right) for l in parse_setlist_text(text)] == [("Idina Menzel, Disney", "Let It Go")]

@pytest.mark.parametrize("text,code", [                      # Review Focus 1
    ("https://open.spotify.com/track/abc\nhttps://open.spotify.com/track/def", "setlist_links_only"),
    ("https://open.spotify.com/playlist/xyz", "setlist_links_only"),
    ("a - b\n" * 301, "setlist_too_long"),
    ("x" * 20_001, "setlist_too_long"),
    ("  \n\n# only a comment\n", "setlist_no_songs"),
])
def test_parse_refuses(text, code):
    with pytest.raises(SetlistError) as e:
        parse_setlist_text(text)
    assert e.value.code == code
```

- [ ] **Step 2: Run, see them fail** (`ModuleNotFoundError: app.services.setlist_text`).
- [ ] **Step 3: Write `setlist_text.py`** to these signatures. Leading numbering is at most 3 digits followed by `.`, `)` or ` - `, so `50 Cent - In Da Club` and `1999 - Prince` stay whole. A line with no letters or digits is dropped.
- [ ] **Step 4: Run. Expected: pass.** Then `ruff check . && ruff format --check . && mypy app`.
- [ ] **Step 5: Commit:** `Add the text rules for pasted song lists`.

### Task 4: Matcher

**Files:**
- Create: `backend/app/services/setlist_matcher.py`, `tests/backend/test_setlist_matcher.py`

**Interfaces:**
- Consumes: Task 3's functions.
- Produces:

```python
@dataclass(frozen=True)
class CatalogSong:
    id: str
    title: str
    artist: str
    artist_keys: tuple[str, ...]
    is_soundtrack: bool

class CatalogIndex:
    def __init__(self, songs: Sequence[CatalogSong], aliases: Mapping[str, str]) -> None: ...
    # aliases: lowercased spelling -> a key that appears in some song's artist_keys

Rule = Literal["same_song", "alias", "other_script_title", "soundtrack",
               "near_spelling", "artist_or_film", "title_alone"]
Reason = Literal["not_in_catalog", "several_songs_share_this_name"]

@dataclass(frozen=True)
class LineResult:
    line: ListLine
    songs: tuple[CatalogSong, ...]     # empty when not found
    rule: Rule | None
    reason: Reason | None

@dataclass(frozen=True)
class SetlistMatch:
    results: tuple[LineResult, ...]
    list_song_ids: tuple[str, ...]     # tier 1, no duplicates, in list order
    fill_song_ids: tuple[str, ...]     # tier 2: same main artists, minus tier 1

def match_line(index: CatalogIndex, line: ListLine) -> LineResult
def match_setlist(index: CatalogIndex, lines: Sequence[ListLine]) -> SetlistMatch
```

Rules, in this order (spec section 7). A line with a separator is tried as `(artist=left, title=right)` and as `(artist=right, title=left)`; the first rule that matches in either order wins.

1. `same_song`: cleaned titles equal and a credited artist equal.
2. `alias`: cleaned titles equal and a list artist maps through `aliases` to a credited artist.
3. `other_script_title`: the artist matches by rule 1 or 2, the title is in the other script, and its `skeleton` is at least 80% like the skeleton of one of **that artist's** songs (`difflib.SequenceMatcher`, 3 or more consonants).
4. `soundtrack`: cleaned titles equal, the catalog song is a soundtrack, and the film's key is in the line or the title has 2 or more words.
5. `near_spelling`: the artist is at least 85% alike (or equal without spaces) and the title equal; or the artist equal and the title at least 88% alike.
6. A line with no separator: `artist_or_film` when the text (or its alias) is a catalog artist key, giving all that key's songs; else `title_alone` when exactly one catalog song has that cleaned title; else `several_songs_share_this_name` when more than one has it.
7. Otherwise `not_in_catalog`.

Fill: every catalog song that credits the **main artist** (first key, after alias mapping) of any line, found or not, and every song that shares the main key of a matched song; minus `list_song_ids`.

- [ ] **Step 1: Write the failing tests** over this made-up catalog:

```python
CATALOG = [  # id, title, artist, soundtrack
    ("q1", "Bohemian Rhapsody", "Queen", False), ("q2", "Don't Stop Me Now", "Queen", False),
    ("o1", "תל אביב", "עומר אדם ft. אריסה", False), ("o2", "שני משוגעים", "עומר אדם", False),
    ("z1", "הפרח בגני", "זוהר ארגוב", False),
    ("f1", "Let It Go", "Frozen", True), ("f2", "Love Is an Open Door", "Frozen", True),
    ("m1", "Beyond", "Moana 2", True), ("s1", "All Star", "Shrek", True),
    ("b1", "Sunny", "Boney M.", False), ("b2", "Sunny", "Other Band", False),
    ("p1", "Where Is the Love?", "The Black Eyed Peas", False), ("a1", "Dancing Queen", "ABBA", False),
]
ALIASES = {"omer adam": "עומר אדם", "zohar argov": "זוהר ארגוב"}

@pytest.mark.parametrize("line,ids,rule", [
    ("Queen - Bohemian Rhapsody", ("q1",), "same_song"),
    ("Bohemian Rhapsody - Queen", ("q1",), "same_song"),                    # both orders
    ("Queen - Bohemian Rhapsody - Remastered 2011", ("q1",), "same_song"),
    ("Omer Adam - תל אביב", ("o1",), "alias"),
    ("Zohar Argov - Ha'perah Be'gani", ("z1",), "other_script_title"),
    ('Idina Menzel, Disney - Let It Go - From "Frozen"/Soundtrack Version', ("f1",), "soundtrack"),
    ("Smash Mouth - All Star", ("s1",), "soundtrack"),
    ("Black Eyed Peas - Where Is The Love?", ("p1",), "near_spelling"),
    ("Frozen", ("f1", "f2"), "artist_or_film"),
    ("omer adam", ("o1", "o2"), "artist_or_film"),
    ("Dancing Queen", ("a1",), "title_alone"),
])
def test_matches(line, ids, rule): ...

@pytest.mark.parametrize("line,reason", [
    ("Leon Bridges - Beyond", "not_in_catalog"),            # one-word soundtrack title, another artist
    ("Bobby Hebb - Sunny", "not_in_catalog"),               # a cover: title alone never matches
    ("Sunny", "several_songs_share_this_name"),
    ("Nobody - Not A Real Song", "not_in_catalog"),
])
def test_refuses(line, reason): ...

def test_tiers():
    m = match_setlist(index, parse_setlist_text(
        "Queen - Bohemian Rhapsody\nBohemian Rhapsody - Queen\nOmer Adam - Not In Catalog\nFrozen"))
    assert m.list_song_ids == ("q1", "f1", "f2")            # the duplicate line counts once
    assert set(m.fill_song_ids) == {"q2", "o1", "o2"}        # same artists, also for the line that was not found

def test_300_lines_against_2000_songs_is_fast():
    # synthetic catalog "Artist {i}" / "Song {i}", 300 lines of which half match
    start = time.perf_counter(); match_setlist(big_index, lines)
    assert time.perf_counter() - start < 2.0
```

- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Write `setlist_matcher.py`.** `CatalogIndex.__init__` builds dictionaries by cleaned title, by artist key and by artist skeleton, so `match_line` never loops over the whole catalog (the pilot script did, and needed minutes).
- [ ] **Step 4: Run. Expected: pass**, then ruff and mypy.
- [ ] **Step 5: Commit:** `Add the setlist matcher`.

### Task 5: Catalog snapshot

**Files:**
- Create: `backend/app/services/setlist_catalog.py`, `tests/backend/test_setlist_catalog.py`

**Interfaces:**
- Consumes: `get_supabase_client()`, Task 4's `CatalogIndex` and `CatalogSong`, tables `songs`, `song_genres`, `genres`, `artist_aliases`.
- Produces:

```python
CACHE_SECONDS = 600
async def get_catalog_index() -> CatalogIndex
def reset_catalog_index_cache() -> None
```

Reads `songs` (`id,title,artist,artist_keys,unavailable_at`) and `artist_aliases` in pages of 1,000 rows with `.order(...).range(start, end)`: PostgREST returns at most 1,000 rows per request. A song is a soundtrack when it has a `song_genres` row for the genre slugs `soundtracks` or `israeli-soundtracks`. Songs with `unavailable_at` set are left out. Blocking calls run through `anyio.to_thread.run_sync`, as in `routers/games.py`.

- [ ] **Step 1: Write the failing tests**

```python
async def test_loads_more_than_one_page(client, db):      # insert 1,500 songs -> index holds 1,500
async def test_leaves_out_unavailable_songs(client, db)
async def test_marks_soundtracks(client, db)
async def test_loads_aliases(client, db)                  # row ('omer adam', 'עומר אדם') maps in the index
async def test_second_call_uses_the_cache(client, db, monkeypatch)   # count table("songs") calls: 2 pages once, then 0
```

- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Write `setlist_catalog.py`.**
- [ ] **Step 4: Run. Expected: pass.**
- [ ] **Step 5: Commit:** `Load and cache the catalog index for setlist matching`.

### Task 6: `POST /setlists/check`

**Files:**
- Create: `backend/app/models/setlists.py`, `backend/app/routers/setlists.py`, `tests/backend/test_setlists_check.py`
- Modify: `backend/app/main.py` (include the router), `docs/api-contracts.md`

**Interfaces:**
- Consumes: Tasks 3 to 5.
- Produces: `POST /setlists/check`, limit `10/minute`, body `{"text": "<= 20,000 characters"}`, answer:

```json
{
  "lines_total": 4,
  "ready": [
    {"line": "Queen - Bohemian Rhapsody", "title": "Bohemian Rhapsody", "artist": "Queen", "songs": 1},
    {"line": "Frozen", "title": null, "artist": "Frozen", "songs": 2}
  ],
  "not_found": [{"line": "Nobody - Not A Real Song", "reason": "not_in_catalog"}],
  "list_songs": 3,
  "same_artist_songs": 1,
  "pool_size": 4
}
```

`title` and `artist` are the catalog's spelling. Errors use the existing envelope: 400 with `error` = `setlist_too_long`, `setlist_links_only` or `setlist_no_songs`.

- [ ] **Step 1: Write the failing tests**

```python
async def test_check_returns_counts_and_catalog_spelling(client, db)       # the JSON above, from seeded rows
async def test_check_never_returns_ids(client, db):
    assert song_id not in resp.text and "youtube_id" not in resp.text and "start_time" not in resp.text
async def test_check_links_only_is_a_400(client):                          # Review Focus 1
    assert resp.status_code == 400 and resp.json()["error"] == "setlist_links_only"
async def test_check_too_long_is_a_400(client)
async def test_check_html_page_gives_an_empty_pool_not_an_error(client):   # Review Focus 1
    assert resp.status_code == 200 and resp.json()["pool_size"] == 0
async def test_check_is_rate_limited(client)                               # the 11th call in a minute -> 429
async def test_check_writes_nothing(client, db)                            # no row in active_games, song_demand, game_setlists
```

- [ ] **Step 2: Run, see them fail (404).**
- [ ] **Step 3: Write the models and the router; include it in `main.py`.**
- [ ] **Step 4: Run. Expected: pass.** Then the whole backend suite with coverage.
- [ ] **Step 5: Document the endpoint in `docs/api-contracts.md`. Commit:** `Add the setlist check endpoint`.

### Task 7: `POST /games` with a list

**Files:**
- Modify: `backend/app/models/games.py`, `backend/app/routers/games.py`, `tests/backend/test_games_create.py` (add cases), `docs/api-contracts.md`

**Interfaces:**
- Consumes: Tasks 1 to 5 (`save_game_setlist`, `record_song_demand`, the matcher).
- Produces:

```python
class SetlistInput(BaseModel):       # extra="forbid"
    text: str                        # max_length 20_000
class SetlistSummary(BaseModel):
    list_songs: int
    same_artist_songs: int
class CreateGameRequest:             # selected_genres: list[UUID] = [];  setlist: SetlistInput | None = None
    # validator: exactly one of "selected_genres is not empty" and "setlist is set"
class CreateGameResponse:            # + setlist: SetlistSummary | None = None
```

Order inside the handler: parse and match first (no row exists yet) → pool empty: `SetlistError("setlist_empty", ...)` → insert the game as today with empty genres → `client.rpc("save_game_setlist", {...})` → if that fails, delete the game row and raise → `record_song_demand` for the lines that were not found (`line_key` = `norm` of the raw line), inside `try/except` that only logs: demand must never fail a create.

- [ ] **Step 1: Write the failing tests** (added to `test_games_create.py`; the existing tests stay as they are)

```python
async def test_create_with_setlist_saves_the_pool(client, db):
    resp = await client.post("/games", json={"setlist": {"text": "Queen - Bohemian Rhapsody\nNobody - Not A Real Song"}})
    assert resp.status_code == 201 and resp.json()["setlist"] == {"list_songs": 1, "same_artist_songs": 1}
    assert await db.fetchval("SELECT ready FROM game_setlists WHERE game_code = $1", code) is True
    assert await db.fetchval("SELECT count(*) FROM game_song_pool WHERE game_code = $1", code) == 2
async def test_create_with_setlist_records_demand(client, db)        # 'nobody not a real song' has request_count 1
async def test_create_with_both_or_neither_is_a_400(client)          # {"selected_genres": [g], "setlist": {...}} and {}
async def test_setlist_with_no_playable_song_is_a_400_and_creates_nothing(client, db)   # error 'setlist_empty', 0 new games
async def test_song_deleted_after_the_index_was_cached(client, db):  # Review Focus 3
    # warm the cache, DELETE one matched song, then create -> 201, pool holds the other songs
async def test_failed_pool_save_removes_the_game(client, db, monkeypatch)   # rpc raises -> 5xx and no active_games row
async def test_demand_failure_does_not_fail_the_create(client, db, monkeypatch)
```

- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Change the models and the handler.**
- [ ] **Step 4: Run the whole backend suite with coverage. Expected: pass, coverage at least 90%.**
- [ ] **Step 5: Update `docs/api-contracts.md` and `CHANGELOG.md`. Commit:** `Let a host create a game from a pasted song list`.

### Task 8: Alias data (offline; rows are never committed)

**Files:**
- Create: `tools/song-curation/aliases/README.md`, `build_candidates.py`, `gen_alias_sql.py`, `replay_pilot.py`
- Modify: `.claude/skills/add-songs/` (one new step: "a new Hebrew artist needs an alias row")
- Data (git-ignored): `tools/song-curation/batches/<date>-aliases/`

**Interfaces:**
- Consumes: a catalog snapshot `_dumps/catalog_raw.json` with `artist_keys`; Task 4's matcher (imported by `replay_pilot.py`); the pilot lists in `tools/song-curation/batches/2026-11-24-setlist-pilot/playlists/`.
- Produces: `candidates.json` and `research.json` as lists of `{"artist_key", "alias", "source_url"}`; `checked.json` adding `"verdict": "confirmed" | "wrong" | "unsure"` and `"evidence"`; `upload_aliases.sql`; `verify_aliases.sql`.

- [ ] **Step 1: `build_candidates.py`.** For each catalog artist key in Hebrew script, and each Latin key that holds a symbol (`ke$ha`, `p!nk`), look up Wikidata (`wbsearchentities` in Hebrew, then the English label and English aliases). One request per second, every answer cached on disk. Print how many keys got a candidate.
- [ ] **Step 2: Research agent (Opus).** Give it only the keys with no candidate. It finds the Latin spelling the artist uses on their own official pages and channels, and records the source link. It writes `research.json`.
- [ ] **Step 3: Checking agent (Opus, fresh).** Give it only the pairs and their links, not the first agent's notes. For each pair it confirms from a source, or marks `wrong` or `unsure`. It writes `checked.json`. Also give it this rule: a film or show name in English and in Hebrew are two catalog entries, never an alias.
- [ ] **Step 4: The maintainer reads `review.md`** (the `unsure` and `wrong` rows, made by `gen_alias_sql.py --review`).
- [ ] **Step 5: `gen_alias_sql.py`** writes `upload_aliases.sql` (`INSERT ... ON CONFLICT (alias) DO UPDATE SET artist_key = EXCLUDED.artist_key`, aliases lowercased and trimmed, written with `newline="\n"`) and `verify_aliases.sql` (row count, and no `artist_key` missing from `songs.artist_keys`).
- [ ] **Step 6: `replay_pilot.py`** runs the 14 pilot lists through the product matcher with the alias file. Pass: each list reaches at least the pilot's count (27, 17, 4, 20, 11, 6, 15, 28, 5, 7, 13, 4, 26, 23 in file order), and none of the 17 refused traps in `_dumps/check_title_only.txt` becomes a match.
- [ ] **Step 7: Upload.** The maintainer names the production write; then run `verify_aliases.sql`.
- [ ] **Step 8: Commit the tool code and the skill step only:** `Add the offline tools that build the artist alias table`.

### Task 9: Frontend API, types and text helper

**Files:**
- Create: `frontend/src/lib/setlistText.ts`, `frontend/src/lib/setlistText.test.ts`
- Modify: `frontend/src/lib/api.ts`, `frontend/src/lib/types.ts`, `frontend/src/lib/api.test.ts`

**Interfaces:**
- Produces:

```ts
// setlistText.ts
export function countSongLines(text: string): number;                       // not empty, not "#...", not a URL
export function detectLinks(text: string): "spotify" | "youtube" | "other" | null;   // set when every line is a URL

// types.ts
export interface SetlistReadyItem { line: string; title: string | null; artist: string; songs: number }
export type SetlistMissReason = "not_in_catalog" | "several_songs_share_this_name";
export interface SetlistMissItem { line: string; reason: SetlistMissReason }
export interface SetlistCheckResponse {
  lines_total: number; ready: SetlistReadyItem[]; not_found: SetlistMissItem[];
  list_songs: number; same_artist_songs: number; pool_size: number;
}
export interface SetlistSummary { list_songs: number; same_artist_songs: number }
// CreateGameResponse gains: setlist?: SetlistSummary | null

// api.ts
export type CreateGameBody =
  | { selected_genres: string[]; selected_decades: number[] }
  | { setlist: { text: string } };
export function checkSetlist(text: string): Promise<SetlistCheckResponse>;  // POST /setlists/check, timeoutMs 45000
export function createGame(body: CreateGameBody, opts?: { testRun?: boolean }): Promise<CreateGameResponse>;
```

- [ ] **Step 1: Write the failing tests**

```ts
expect(countSongLines("Queen - A\n\n# note\nhttps://x.y/z\nFrozen")).toBe(2);
expect(detectLinks("https://open.spotify.com/track/a\nhttps://open.spotify.com/track/b")).toBe("spotify");
expect(detectLinks("https://www.youtube.com/playlist?list=PL1")).toBe("youtube");
expect(detectLinks("Queen - A\nhttps://open.spotify.com/track/a")).toBeNull();
// api.test.ts: checkSetlist posts {text} to /setlists/check; createGame sends a {setlist} body unchanged
```

- [ ] **Step 2: Run, see them fail.** **Step 3: Implement.** **Step 4: Run, then `npm run typecheck && npm run lint`.**
- [ ] **Step 5: Commit:** `Add the frontend API and helpers for pasted song lists`.

### Task 10: The switch on the create page, "My own list", and the converter helper

> **Changed on 2026-11-24**, after the maintainer chose the look of the Host page. The design is [2026-11-24-host-music-choices.md](2026-11-24-host-music-choices.md): read its section 7 (how the switch is made, the motion) and section 9 (the final choices) before this task. Where they differ, section 9 is right. The third tab, `Pick artists`, is not part of this task; it has [its own plan](2026-11-24-pick-artists-plan.md).

**Files:**
- Create: `frontend/src/components/MusicSourceSwitch.tsx`, `MusicSourceSwitch.module.css`, `MusicSourceSwitch.test.tsx`, `frontend/src/components/SetlistPanel.tsx`, `SetlistPanel.module.css`, `SetlistPanel.test.tsx`, `frontend/src/components/SetlistHelp.tsx`, `SetlistHelp.test.tsx`, `tests/e2e/host_page_layout.spec.ts`
- Modify: `frontend/src/App.tsx` (the route), `frontend/public/_redirects`, `frontend/src/lib/redirects.test.ts`, `frontend/src/pages/ManagerCreateGamePage.tsx`, its `.module.css` and `.test.tsx` (add cases), `frontend/src/lib/songPool.ts` and its test, `frontend/src/pages/HowToPlayPage.tsx`, `frontend/src/lib/funnel.ts` and its test, `CHANGELOG.md`

**Interfaces:**
- Consumes: Task 9.
- Produces:

```ts
// MusicSourceSwitch.tsx
export type MusicSource = "genres" | "list" | "artists";
export interface MusicSourceTab { id: MusicSource; label: string; to: string }
export const MUSIC_SOURCE_TABS: readonly MusicSourceTab[];   // this task: genres ("/manager/create"), list ("/manager/create/list")
export function MusicSourceSwitch(props: { tabs: readonly MusicSourceTab[]; active: MusicSource }): JSX.Element;

export interface SetlistPanelState { text: string; check: SetlistCheckResponse | null }
export function SetlistPanel(props: { value: SetlistPanelState; onChange: (s: SetlistPanelState) => void }): JSX.Element;
export function SetlistHelp(props: { open: boolean; onToggle: () => void; linksPasted: boolean }): JSX.Element;
export function trackSetlistGameCreated(listSongs: number, poolSize: number): void;   // funnel.ts
export function describeMix(count: number, noun?: "mix" | "game"): { text: string; tone: MixTone };   // songPool.ts; default "mix"
```

**The address decides the tab.** One route, `/manager/create/:source?`, draws `ManagerCreateGamePage`, so the page stays mounted when the tab changes. No `source` opens Genres; `list` opens My own list; anything else goes to `/manager/create` with `replace`. A tab is a link (`replace`, so Back leaves the Host page) and keeps the query string (`?test=1`). The page owns every tab's state (picked genres and decades, the pasted text and its check), so each tab is as the host left it.

**A reload must not give a 404.** `frontend/public/_redirects` has no catch-all, so add the exact line `/manager/create/list   /spa-shell   200` (not a `/*` line: a wrong address under it must stay a real 404). Add `/manager/create/list` to `STATIC_VIEWS` in `funnel.ts`, so its page views are not counted as `/other`.

**The top of the page.** Under `Host a game` one fixed line, `Choose how to pick the songs`, replaces today's `Pick at least one genre to start.` Then the switch. There is no changing line under the switch: the instruction moves to the status line in the bottom bar (`data-testid="mix-count"`), which is empty today when no genre is picked.

**The switch** (design section 7). A track with 4 px of padding. The row of labels is drawn twice; the second copy is `aria-hidden`, has the light colours (background `--bone`, text `--bg`) and is clipped to the open part with `clip-path: inset(… round 6px)`. The position comes from two attributes on that copy, `data-n` (2 or 3 tabs) and `data-i`, with a fixed `clip-path` for each pair; the clip moves in `--dur-state` with `--ease-move`. `role="tablist"`; the left and right arrow keys open the next tab and wrap; only the open tab is in the tab order. Each label is 44 px high and stays on one line; when the switch is narrower than 340 px its font is 0.86rem (a container query).

**Content.** The open tab's content is keyed by the tab. It enters with `@starting-style`: opacity 0 and 12 px from the side of its tab (`translateX(12px)`, or `-12px` when the new tab is left of the old one), over `--dur-state` with `--ease-arrive`. The old content leaves at once. No animation on the first load of the page. CSS only, no keyframes, no View Transitions; the site's reduced-motion rule makes it instant. A browser without `@starting-style` shows the content at once, which is fine.

**My own list.** `SetlistPanel` is loaded with `React.lazy`; fetch its chunk when the page is idle (as the page already does for the console), so the tab opens with no wait and the first load does not grow. The Create button is enabled only when `check !== null && check.pool_size > 0`; editing the text sets `check` back to `null`. The panel keeps its `Check my list` button: it does not check by itself. Submit sends `createGame({ setlist: { text } })`.

**Genres tab, two changes.** (1) Quick start shows that it slides: an edge fade on each side that has more mixes, a round arrow button on that side (44 px hit area; a tap moves the row by about 70% of its width), and `6 mixes` (`PRESETS.length`) at the right of the `Quick start` label. Fades and arrows follow the scroll position, and a tap on a mix must not move the row. (2) On a phone (600 px and narrower) the genre tiles are in two columns: `grid-template-columns: 1fr 1fr`, tile padding 10 px, font 0.95rem, `overflow-wrap: anywhere`. The longest names go onto two lines; none is cut.

Exact copy:

| Where | Text |
| --- | --- |
| Under the title | `Choose how to pick the songs` |
| Switch | `Genres` · `My own list` |
| Bottom bar, Genres, no genre picked | `Pick at least one genre to start.` |
| Bottom bar, My own list | nothing pasted: `Paste your songs to start.` · pasted, not checked: `Check your list to see the songs` · checking: `Checking your list…` · checked: `describeMix(check.pool_size, "game")`, for example `61 songs in this game` |
| Quick start, right of the label | `6 mixes` |
| Box label | `Paste a list of songs` |
| Placeholder | `One per line: Artist - Song. A film or an artist alone works too.` |
| While typing | `Found {n} songs` (`Found 1 song`) |
| Button | `Check my list`; busy: `Checking your list…` |
| Result | `Your list: {n} lines` · `{n} ready to play` · `{n} cannot play` + `Show` · `+ {n} more by the same artists, played after your list` · `{n} songs in this game` |
| Reasons | `Not in the game yet` · `More than one song has this name. Add the artist.` |
| Links pasted | `These are links, not song names.` |
| Helper title | `Have the list on Spotify?` |
| Helper steps | `1. Open Chosic's playlist exporter` (link `https://www.chosic.com/spotify-playlist-exporter/`, new tab, `rel="noopener noreferrer"`) · `2. Paste your playlist link there and download the TXT file` · `3. Paste the text here` |
| Helper, Apple | `On a Mac with Apple Music: File → Library → Export Playlist.` |
| Helper, last line | `Sound Clash is not connected to Spotify, Apple Music or Chosic.` |
| How to Play, new FAQ entry | Q: `Can I play my own playlist?` A: `Yes. On the Host page choose My own list and paste your songs, one per line. Films, shows and artists work too. The game plays your songs first, then more songs by the same artists. For a Spotify playlist, export the song names with Chosic's playlist exporter and paste them.` (the same link) |

Test ids: `music-source-genres`, `music-source-list`, `music-source-panel`, `quick-start-count`, `quick-start-prev`, `quick-start-next`, `setlist-input`, `setlist-found`, `setlist-check`, `setlist-result`, `setlist-missing`, `setlist-help`.

- [ ] **Step 1: Write the failing tests**

```ts
// MusicSourceSwitch.test.tsx
it("draws one tab for each entry and marks the open one")     // aria-selected, data-i, data-n="2"
it("opens the next tab with the arrow keys, and wraps")
it("keeps the query string in each tab's link")               // ?test=1
// ManagerCreateGamePage.test.tsx (new cases)
it("opens Genres at /manager/create and My own list at /manager/create/list")
it("goes to /manager/create for an unknown tab")
it("keeps the picked genres and the pasted text when the tab changes")   // genres -> list -> genres -> list
it("shows the fixed line under the title")                    // "Choose how to pick the songs"
it("puts the instruction in the bottom bar")                  // no genre: "Pick at least one genre to start."
it("does not animate the first content")                      // the first panel has data-first
it("says how many mixes Quick start has")                     // "6 mixes"
// redirects.test.ts: /manager/create/list is served the SPA shell; /manager/create/nope matches no rule
// funnel test: viewName("/manager/create/list") === "/manager/create/list"
// songPool.test.ts: describeMix(61, "game").text === "61 songs in this game"; describeMix(61).text is unchanged
// SetlistPanel.test.tsx
it("counts songs while the host types")                       // "Found 2 songs"
it("checks the list and shows the counts")                     // mocked checkSetlist -> the five result lines
it("lists the lines that cannot play, with the reason")
it("turns the check off when the text changes")                // Create disabled again
it("opens the helper when Spotify links are pasted")           // Review Focus 1: "These are links, not song names."
it("shows the server's message for a refused list")            // 400 setlist_too_long -> toast, no result card
it("creates a game from the list")                             // createGame called with { setlist: { text } }
it("keeps Create disabled until the check has songs")          // pool_size 0 -> disabled
it("leaves the genre flow as it was")                          // existing tests green
// SetlistHelp.test.tsx: the link href, target and rel; the last line is present
```

Two existing assertions change on purpose, and only these: the line under the title, and an empty `mix-count` when no genre is picked.

```ts
// tests/e2e/host_page_layout.spec.ts, viewport 320 x 568
test("the fixed line and each switch label stay on one line")      // scrollWidth <= clientWidth, height of one line
test("genre tiles are in two columns and no name is cut")          // tiles 1 and 2 share a top; scrollWidth <= clientWidth
test("Quick start shows that it slides")                           // next arrow visible; a tap moves the row; then the prev arrow shows
test("a tap on a mix does not move the row")                       // scrollLeft is the same before and after
test("a reload on /manager/create/list opens My own list")
```

- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Before writing the helper copy into code, send one research agent (Opus) to confirm that Chosic's exporter still works with no login, and to save one TXT sample.** Add that sample's shape as one more case in `tests/backend/test_setlist_text.py` (made-up song names in the same layout). If the exporter no longer works, stop and tell the maintainer; do not ship a dead link.
- [ ] **Step 4: Build the switch, the route, the `_redirects` line and the top of the page; then the Genres tab changes; then the two list components.** Follow the page's existing chip and button styles; no new colour, no new package.
- [ ] **Step 5: Run vitest, typecheck, lint, format check, and `npm run build`.** Compare the create route's chunk size with `main`: the entry chunk must not grow by more than 1 KB. Run `tests/e2e/host_page_layout.spec.ts` and `tests/e2e/redesign_guards.spec.ts` against the local stack.
- [ ] **Step 6: Add the `CHANGELOG.md` lines (My own list under Added; the new top of the Host page under Changed). Commit:** `Add My own list to the host page with a guide for Spotify playlists`.

### Task 11: The console's progress line

**Files:**
- Create: `frontend/src/hooks/useSetlistProgress.ts`, `useSetlistProgress.test.ts`
- Modify: `frontend/src/pages/ManagerConsolePage.tsx` and its test, the place that turns RPC errors into toasts

**Interfaces:**
- Consumes: Task 1's `game_pool_summary`.
- Produces:

```ts
export interface SetlistProgress { listTotal: number; listSongs: number; listLeft: number; extraSongs: number; extraLeft: number }
export function useSetlistProgress(gameCode: string, managerToken: string | null, roundNumber: number): SetlistProgress | null;
```

It calls the RPC on mount and each time `roundNumber` changes. Zero rows, a missing function (PGRST202) or any error gives `null` and no toast: a normal game and an old database both show nothing.

Copy: `Your songs: {listLeft} of {listSongs} left`; when `listLeft` is 0 and `extraSongs` is more than 0: `Your songs are done. Now: more by the same artists ({extraLeft} left)`. ("Your songs", not "Your list", so the same line also fits a game from chosen artists.) Test id `setlist-progress`. The `setlist_not_ready` error shows `Your songs are not ready yet. Try again in a moment.`

- [ ] **Step 1: Write the failing tests**

```ts
it("returns null for a game with no list")
it("returns the numbers and refetches when the round changes")
it("fetches on mount, so a reload mid-game shows the right numbers")   // Review Focus 5
it("returns null when the function is missing")                         // PGRST202
// console test: both lines render; nothing renders for a normal game
```

- [ ] **Step 2: Run, see them fail.** **Step 3: Implement.** **Step 4: Run vitest, typecheck, lint.**
- [ ] **Step 5: Commit:** `Show the host how much of their list is left`.

### Task 12: End-to-end game

**Files:**
- Create: `tests/e2e/custom_setlist.spec.ts`

**Interfaces:**
- Consumes: the local stack with `db/seed/songs.sql` (`E2E Test Song 1` by `E2E Test Artist A`, …, and the soundtrack `Star Wars`), the admin API to add one more song by `E2E Test Artist A`.

- [ ] **Step 1: Write the spec**

```ts
test("a game from a pasted list plays the list first, then the same artist", async () => {
  // setup: POST /admin/songs -> "E2E Extra Song" by "E2E Test Artist A" (deleted in afterAll)
  // create page -> My own list -> paste:
  //   E2E Test Artist A - E2E Test Song 1
  //   E2E Test Song 2 - E2E Test Artist B
  //   Star Wars
  //   Nobody - Not A Real Song
  // Check -> "3 ready to play", "1 cannot play", "+ 1 more by the same artists"
  // Create -> console -> one team joins -> Start
  // rounds 1 to 3: the console's song titles are {Song 1, Song 2, Star Wars} in any order
  // progress line: "Your songs: 2 of 3 left" after round 1
  // reload the console after round 2 -> the line still reads "Your songs: 1 of 3 left"      (Review Focus 5)
  // round 4: "E2E Extra Song"; the line reads "Your songs are done. Now: more by the same artists (0 left)"
  // Next round -> the existing "no more songs" message
});
```

- [ ] **Step 2: Run it against the local stack** (`cd tests/e2e && npm test custom_setlist`). Expected: pass. Then `full_game`, `multi_buzz_round` and `buzzer_race`: pass, unchanged.
- [ ] **Step 3: Commit:** `Add an end-to-end test for a game from a pasted list`.

### Task 13: Prove no regression, then release

**Files:**
- Create: `tests/smoke/setlist_fingerprint.sql`, `tests/smoke/setlist_timing_selfcheck.sql`
- Modify: `docs/planning/TASKS.md`, `docs/planning/NEXT-SESSION.md`

**Interfaces:**
- Consumes: every earlier task; the pass marks of spec section 10.

- [ ] **Step 1: Fingerprint.** `setlist_fingerprint.sql` returns one row per function with `md5(pg_get_functiondef(oid))` for `buzz_in`, `award_attempt`, `release_buzz_lock`, `start_round`, `end_round`, `pick_next_song`, plus the column list, trigger list and publication row of `active_games`. Save the output on production **before** migration 060. After 060 and 061: run again; `diff` must be empty.
- [ ] **Step 2: Timing, before production changes.** `setlist_timing_selfcheck.sql` is one `DO` block that builds a synthetic 8-genre game, times 200 `peek_next_song` and 200 guarded `select_next_song` calls with `clock_timestamp()`, then installs the new function bodies with `EXECUTE`, times the same calls again, times 200 `pick_next_pool_song` calls on a 300-song pool, and ends with `RAISE EXCEPTION 'TIMING_ROLLBACK old_peek=… new_peek=… old_select=… new_select=… pool_pick=…'`. Pass: each new average is at most 1 ms above the old one, and `pool_pick` is under 10 ms. Then confirm that no synthetic row is left. Keep the run under 60 seconds.
- [ ] **Step 3: CI.** Add the `run-stress` and `run-e2e` labels to PR 1 and PR 4; trust the labelled runs.
- [ ] **Step 4: Release order.** PR 1 merged, then migrations 060 and 061 on production (each named by the maintainer) → fingerprint diff → PR 2 → alias upload (Task 8 step 7) → PR 4 → `node tests/smoke/ui_prod_pass.mjs all` (29 of 29) → open `https://www.soundclash.org/manager/create/list` directly: the Host page with My own list open, not the 404 page → one full custom game on production with `?test=1` → the Full-Game Exit Gate.
- [ ] **Step 5: One week later.** Open a GitHub issue now, dated one week after the release, to compare the median and 95th percentile of `buzz_in`, `select_next_song` and `peek_next_song` spans in normal games, one week before against one week after. A rise blocks phase 2.
- [ ] **Step 6: Tick the task in `TASKS.md`, refresh `NEXT-SESSION.md`. Commit:** `Record the custom setlist phase 1 release checks`.
