# Pick Artists Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A host ticks artists on the third tab of the Host page, and the game plays every catalog song by those artists. The game can be created only when the choice holds at least 60 songs by at least 5 artists.

**Architecture:** One migration adds one small private table and five functions on top of the song pool of phase 1. The browser reads the artist names and asks "ready or not" directly from Postgres; `POST /games` saves the pool. An artist game is a pool where every song is in tier 1, so nothing in the round path changes: `select_next_song`, `peek_next_song` and the buzzer are not touched.

**Tech Stack:** Postgres PL/pgSQL (one new migration), FastAPI + supabase-py, React 18 + TypeScript, pytest + testcontainers, vitest, Playwright. No new package.

**Spec:** [2026-11-24-host-music-choices.md](2026-11-24-host-music-choices.md), sections 3 and 9. Section 9 holds the final choices and wins where they differ. The song pool is section 8 of [2026-11-24-custom-setlist-design.md](2026-11-24-custom-setlist-design.md).

**Starts after:** every pull request of the [phase 1 plan](2026-11-24-custom-setlist-phase1-plan.md) is merged, and migrations 060 and 061 are on production. This plan uses phase 1's pool tables, `save_game_setlist`, the switch of its Task 10 and the console line of its Task 11.

**Waits for the maintainer's OK:** the wording of the line after "Game ready" (Task 6, copy table). Everything else is decided.

## Global Constraints

- **Process:** follow [EXECUTION-CONTRACT.md](EXECUTION-CONTRACT.md) for every PR. One-line commit messages, no AI attribution. Never merge, and never apply a migration or upload rows to production, unless the maintainer names that action in the current prompt.
- **Where to work:** a git worktree from fresh `origin/main`. The main tree is on another branch and holds the maintainer's uncommitted files; do not touch it. One worktree agent per message.
- **No new dependency. No `.github/workflows/` change.**
- **Not changed, at all:** the `songs` table and its `artist_keys` column, `song_artist_keys`, `pick_next_song`, `pick_next_pool_song`, `select_next_song`, `peek_next_song`, `save_game_setlist`, `game_pool_summary`, `game_setlists`, `game_song_pool`, the `active_games` table, `buzz_in`, `award_attempt`, `release_buzz_lock`, and the existing test files for them. If one of those tests fails, the change is wrong; do not edit the test.
- **The rule lives in one place:** `artist_game_rule()` returns 60 songs, 5 artists and 4 levels. No other file holds those three numbers, except test data and the copy `Pick at least {minArtists} artists`, which reads the number from the database's answer.
- **No song count leaves the server through this feature.** The list of names has no count, the status answer is `ready` plus a level from 0 to 4, and the `POST /games` answer is as today. Tests assert each one.
- **Catalogue protection:** an answer holds artist names, their kind and their other spellings. Never a song title, a song id, a YouTube id or a start time.
- **Private data:** the rows of `artist_whole_names` and `artist_aliases`, and real catalog names, are never committed. Tests use made-up names.
- **Migration:** the next free number (062 on 2026-11-24; confirm with `git ls-tree --name-only origin/main db/migrations/ | tail -n 3`). Idempotent, one transaction. Apply it twice on the local stack.
- **Limits:** at most 200 artists in one request. `POST /games` keeps its rate limit.
- **Copy:** the exact text of the tables in Task 6.
- **Motion:** CSS only, the site's tokens (`--dur-micro`, `--dur-state`, `--ease-move`, `--ease-arrive`). Only `transform`, `opacity` and colours change. The site's reduced-motion rule must leave only colour changes.
- **Docs in the same PR:** `docs/data-model.md`, `docs/rpc-functions.md`, `docs/security-rls.md`, `docs/api-contracts.md`, the RPC list in `CLAUDE.md`. A `CHANGELOG.md` `[Unreleased]` line in the PR that shows the tab.
- **Gates:** backend line coverage at least 90%, no `# pragma: no cover`; frontend no `it.skip`, no state library, no CSS-in-JS, `any` needs a `// reason` comment.
- **Local test commands:** database subset `cd backend && DATABASE_URL="" python -m pytest -c pyproject.toml --rootdir=. -p no:cov ../tests/db/<file> -q` (Docker Desktop must run; stop it after). Frontend `cd frontend && npx vitest run <file>`.

## Review Focus

1. **The catalog changes between the last tick and Create** (a song is flagged, and the choice drops under 60 songs). Expected: a 400 with `artists_not_enough`, the page says `Pick more artists to start.`, and no game row is left. Tests: Task 1 step 1, Task 2 step 1.
2. **Status answers arrive late or in the wrong order** (a slow phone network, fast ticking). Expected: only the newest answer is shown, and Create is off until the newest answer is in. Test: Task 4 step 1.
3. **Names with odd text:** one artist whose name holds `&` or a comma, a duet, a Hebrew name with `״`, a key that is not in the catalog. Expected: a whole name stays whole, a duet's song counts once, an unknown key is ignored. Tests: Task 1 step 1.
4. **The host opens `/manager/create/artists` directly, reloads it, or changes tab and comes back.** Expected: no 404, and the chosen artists are still ticked after a tab change. Tests: Task 6 step 1, Task 7 step 1.
5. **A 320 px phone with long names and 30 chosen artists.** Expected: names go onto two lines and none is cut, the chosen row slides, and the bottom bar covers neither the last tiles nor `Show 20 more` at the end of the list. Test: Task 7 step 1.

## File Map

| File | Responsibility |
| --- | --- |
| `db/migrations/062_pick_artists.sql` | `artist_whole_names`, the rule, the list of names, the status, the save |
| `tests/db/test_pick_artists.py` | Database tests for all of the above |
| `backend/app/models/games.py`, `backend/app/routers/games.py` | `POST /games` with chosen artists |
| `tools/song-curation/aliases/whole_names.py` | Offline: list the credits that the splitter cuts, and write the upload SQL (code only) |
| `frontend/src/lib/artists.ts` | Types, loading the names, asking the status, the search filter |
| `frontend/src/hooks/useArtistPickStatus.ts` | Asks the status after each change; drops late answers |
| `frontend/src/components/ReadySign.tsx` | The sound bars |
| `frontend/src/components/ArtistPanel.tsx` | The third tab: search, language chips, chosen row, tiles, `Show 20 more` |
| `frontend/src/pages/ManagerCreateGamePage.tsx` | The third tab, the bottom bar's text, the create call |
| `tests/e2e/pick_artists.spec.ts` | One artist game from the tab to round 1, and the 320 px layout |

PRs: **PR 1** = Tasks 1 to 3 (database, backend, the offline tool; nothing visible). **PR 2** = Tasks 4 to 7 (the tab). Migration 062 goes to production between them.

---

### Task 1: The names, the rule and the save, in one migration

**Files:**
- Create: `db/migrations/062_pick_artists.sql`, `tests/db/test_pick_artists.py`
- Modify: `tests/db/test_rls_anon.py`, `tests/db/test_rls_function_grants.py` (add cases), `tests/db/conftest.py` (the TRUNCATE list gains `artist_whole_names`), `docs/data-model.md`, `docs/rpc-functions.md`, `docs/security-rls.md`, `CLAUDE.md`

**Interfaces:**
- Consumes: `songs` (`id`, `artist`, `artist_keys`, `unavailable_at`), `song_genres`, `genres.slug`, `artist_aliases(alias, artist_key)` (migration 061), `save_game_setlist(text, uuid[], uuid[], integer)` (migration 060).
- Produces:

```sql
-- Private. One row is one credit that is ONE artist although it holds a separator.
CREATE TABLE IF NOT EXISTS artist_whole_names (
  name       text PRIMARY KEY CHECK (name = lower(btrim(name)) AND name <> ''),
  created_at timestamptz NOT NULL DEFAULT now()
);  -- RLS on, no policy. REVOKE ALL FROM anon, authenticated. service_role: SELECT, INSERT, UPDATE, DELETE.

-- service_role only
artist_game_rule()  RETURNS TABLE(min_songs integer, min_artists integer, levels integer)   -- 60, 5, 4
pickable_credits()  RETURNS TABLE(song_id uuid, artist_key text, shown text)

-- anon, authenticated, service_role. STABLE, SECURITY DEFINER, SET search_path = public.
list_pickable_artists()          RETURNS TABLE(artist_key text, name text, kind text, aliases text[])
artist_pick_status(p_keys text[]) RETURNS TABLE(ready boolean, level integer, levels integer, min_artists integer)

-- service_role only. SECURITY DEFINER.
save_game_artists(p_game_code text, p_keys text[]) RETURNS integer   -- the pool size
```

What each one does:

- **Playable** means `songs.unavailable_at IS NULL`.
- **`pickable_credits`**: one row for each playable song and each artist it counts for. A song whose `lower(btrim(artist))` is a row of `artist_whole_names` counts for that one name, and `shown` is `btrim(artist)`. Every other song counts for each value of its `artist_keys`; `shown` is the piece of `artist` whose `lower(btrim())` is that key, cut with the same regular expression as `song_artist_keys` (migration 049). A test keeps the two in step.
- **`list_pickable_artists`**: one row for each `artist_key`. `name` is the most common `shown` of the key (a tie: the smallest in byte order). `kind` is `film` when every song of the key is in a genre with the slug `soundtracks` or `israeli-soundtracks`; else `he` when the key holds a Hebrew letter; else `en`. `aliases` are the `alias` values of `artist_aliases` for the key, sorted; `'{}'` when there are none. Order: most songs first, then `name`. **There is no count column.**
- **`artist_pick_status`**: `p_keys` that is NULL or empty gives `(false, 0, 4, 5)`. More than 200 elements: `RAISE EXCEPTION 'too_many_artists' USING ERRCODE = '22023'`. Keys are compared after `lower(btrim())`; a repeated key, and a key that `pickable_credits` does not have, are ignored. `artists` is the number of known keys, `songs` the number of different songs they have. `ready` is `artists >= min_artists AND songs >= min_songs`. `level` is `levels` when ready, 0 when `artists = 0`, and otherwise `greatest(1, least(levels - 1, ceil(levels * least(songs::numeric / min_songs, artists::numeric / min_artists))))`.
- **`save_game_artists`**: when the status of `p_keys` is not ready, `RAISE EXCEPTION 'artists_not_enough' USING ERRCODE = '22023'` and write nothing. Otherwise call `save_game_setlist(p_game_code, <the song ids of the known keys>, '{}', <the number of known keys>)` and return its result. Every song is in tier 1. A missing game gives the error of `save_game_setlist`.

The migration creates new objects only. It takes no lock on `active_games` or `songs`.

- [ ] **Step 1: Write the failing tests** (made-up artists; a helper inserts N songs for a credit)

```python
async def test_list_has_no_count_and_orders_by_most_songs(db):
    # columns are exactly artist_key, name, kind, aliases; the artist with 3 songs comes before the artist with 1
async def test_list_skips_unavailable_songs(db)                 # an artist whose only song is flagged is not listed
async def test_list_kinds(db)                                   # film: every song in soundtracks; he: a Hebrew key; en: the rest
async def test_list_name_is_the_most_common_spelling(db)        # 'Zed Band' twice, 'ZED BAND' once -> 'Zed Band'
async def test_list_carries_aliases(db)                         # artist_aliases('zed band alt', 'zed band') -> aliases == ['zed band alt']
async def test_duet_counts_for_both_artists(db)                 # 'Zed Band & Ann Lee' is listed under both keys
async def test_whole_name_is_one_artist(db):                    # Review Focus 3
    # a song by 'Salt, Pepper & Co': three keys without a row; with artist_whole_names('salt, pepper & co'): one key, name 'Salt, Pepper & Co'
async def test_shown_pieces_agree_with_artist_keys(db):         # for every seeded credit: {lower(shown)} == set(artist_keys)
async def test_status_ready_needs_both_rules(db):               # 5 artists with 59 songs: false; 4 artists with 80: false; 5 with 60: true
async def test_status_levels(db):                               # no key: 0; one small artist: 1; 5 artists with 30 songs: 2; 5 with 59: 3; ready: 4
async def test_status_counts_a_duet_once(db)
async def test_status_ignores_unknown_and_repeated_keys(db)     # Review Focus 3
async def test_status_refuses_more_than_200_keys(db)            # SQLSTATE 22023, 'too_many_artists'
async def test_status_columns_hold_no_count(db)                 # columns are exactly ready, level, levels, min_artists
async def test_save_fills_tier_one_and_marks_ready(db)          # game_setlists.ready is true; every pool row is tier 1; returns the pool size
async def test_save_refuses_a_small_choice_and_writes_nothing(db)   # 'artists_not_enough'; no game_setlists row       (Review Focus 1)
async def test_artist_game_plays_only_its_pool(db)              # select_next_song until no_more_songs: exactly the pool, each song once
# test_rls_anon.py: anon cannot read artist_whole_names
# test_rls_function_grants.py: anon may run list_pickable_artists and artist_pick_status;
#   anon may not run save_game_artists, artist_game_rule, pickable_credits
```

- [ ] **Step 2: Run, see them fail** (the functions do not exist).
- [ ] **Step 3: Write the migration.**
- [ ] **Step 4: Run the tests. Expected: pass.** Apply the migration twice on the local stack. Run the existing `tests/db` files for `select_next_song`, `peek_next_song` and the setlist pool: pass, unchanged.
- [ ] **Step 5: Timing.** On the local stack with 2,000 made-up songs by 900 artists, run each of `list_pickable_artists()` and `artist_pick_status(<50 keys>)` 20 times. Write the two medians in the PR. Target: under 30 ms each.
- [ ] **Step 6: Fingerprint.** Run `tests/smoke/setlist_fingerprint.sql` on the local stack before and after the migration; `diff` must be empty.
- [ ] **Step 7: Update the four docs** (two more functions that a browser may call; the new private table). **Commit:** `Add the artist list, the ready rule and the save for artist games`.

### Task 2: `POST /games` with chosen artists

**Files:**
- Modify: `backend/app/models/games.py`, `backend/app/routers/games.py`, `tests/backend/test_games_create.py` (add cases), `docs/api-contracts.md`

**Interfaces:**
- Consumes: Task 1 (`artist_pick_status`, `save_game_artists`); the error envelope and the error class that phase 1 Task 7 uses for `setlist_empty`.
- Produces:

```python
class ArtistsInput(BaseModel):       # extra="forbid"
    names: list[str]                 # 1 to 200 items, each 1 to 120 characters: artist_key values of list_pickable_artists
class CreateGameRequest:             # + artists: ArtistsInput | None = None
    # validator: exactly one of "selected_genres is not empty", "setlist is set", "artists is set"
```

The answer does not change: it has no song count.

Order inside the handler: `client.rpc("artist_pick_status", {"p_keys": names})` first, while no row exists → not ready: a 400 with `error` = `artists_not_enough` and the message `Pick more artists to start.` → insert the game as today with empty genres → `client.rpc("save_game_artists", {...})` → if it fails, delete the game row; a database `artists_not_enough` becomes the same 400, any other failure is raised as today.

- [ ] **Step 1: Write the failing tests** (the existing tests stay as they are)

```python
async def test_create_with_artists_saves_the_pool(client, db)        # 201; game_setlists.ready; the pool is the artists' playable songs, all tier 1
async def test_create_answer_has_today_s_keys_only(client, db)       # set(resp.json()) == the keys of a genre game's answer
async def test_small_choice_is_a_400_and_creates_nothing(client, db):    # Review Focus 1
    assert resp.status_code == 400 and resp.json()["error"] == "artists_not_enough"
async def test_choice_shrinks_between_status_and_save(client, db, monkeypatch):   # Review Focus 1
    # the status says ready, then save_game_artists raises artists_not_enough -> 400 and no active_games row
async def test_failed_pool_save_removes_the_game(client, db, monkeypatch)
async def test_exactly_one_source(client)                            # genres + artists, setlist + artists, and none: refused as phase 1 Task 7 refuses
async def test_more_than_200_names_is_a_422(client)
```

- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Change the models and the handler.**
- [ ] **Step 4: Run the whole backend suite with coverage. Expected: pass, coverage at least 90%.**
- [ ] **Step 5: Update `docs/api-contracts.md`. Commit:** `Let a host create a game from chosen artists`.

### Task 3: Whole names (offline; rows are never committed)

The database cuts a credit such as `A & B` into its artists. A few credits are one artist whose name holds `&` or a comma, or a film whose title holds a comma; about ten were seen in the catalog on 2026-11-24. Without this task the list would show their pieces as artists.

**Files:**
- Create: `tools/song-curation/aliases/whole_names.py`, and its test beside the tests of the other tools in that folder

**Interfaces:**
- Produces: `whole_names.py candidates <catalog dump> <out.tsv>` (every credit that gives two or more keys, with its pieces and its song count) and `whole_names.py sql <reviewed.tsv> <out.sql>` (`INSERT INTO artist_whole_names (name) VALUES (…) ON CONFLICT DO NOTHING`, lower case, trimmed).

- [ ] **Step 1: Write the tool's tests** (made-up credits: a duet, a band with `&`, a title with a comma; the SQL is lower case and can run twice).
- [ ] **Step 2: Write the tool. Run the tests.**
- [ ] **Step 3: Make the candidate file** from a fresh read-only catalog dump, in the git-ignored batch folder.
- [ ] **Step 4: One research agent (Opus) marks each row `one` or `several`, with a source for each `one`.** A second agent checks every `one` row. The maintainer reads the `one` rows before anything is uploaded.
- [ ] **Step 5: Upload, only when the maintainer names it.** Read-only counts before and after. Then, on production: no piece of a reviewed credit is in `list_pickable_artists()`, and each whole name is.
- [ ] **Step 6: Commit the tool code only:** `Add the tool that finds artist names the splitter cuts`.

### Task 4: Frontend data: the names, the status, the filter

**Files:**
- Create: `frontend/src/lib/artists.ts`, `artists.test.ts`, `frontend/src/hooks/useArtistPickStatus.ts`, `useArtistPickStatus.test.ts`
- Modify: `frontend/src/lib/types.ts`, `frontend/src/lib/api.ts`, `frontend/src/lib/api.test.ts`

**Interfaces:**
- Consumes: Task 1's two browser functions, through the Supabase client as `loadSongPool` does.
- Produces:

```ts
// types.ts
export type ArtistKind = "he" | "en" | "film";
export interface PickableArtist { key: string; name: string; kind: ArtistKind; aliases: string[] }
export interface ArtistPickStatus { ready: boolean; level: number; levels: number; minArtists: number }

// artists.ts
export const RECOMMENDED_ARTISTS = 10;   // advice in the bottom bar; not a rule
export const MAX_ARTISTS = 200;
export function loadPickableArtists(): Promise<PickableArtist[]>;                 // kept in memory; a failed load is not kept
export function fetchArtistPickStatus(keys: readonly string[]): Promise<ArtistPickStatus>;
export function filterArtists(list: readonly PickableArtist[], query: string, kind: ArtistKind | "all"):
  { artist: PickableArtist; viaAlias: string | null }[];

// useArtistPickStatus.ts
export function useArtistPickStatus(keys: readonly string[]): { status: ArtistPickStatus | null; pending: boolean; failed: boolean };

// api.ts
export type CreateGameBody = /* the two shapes of phase 1 */ | { artists: { names: string[] } };
```

`filterArtists` keeps the order of the list. It trims and lower-cases the query; an artist matches when its name holds the query, or when one of its aliases does (then `viaAlias` is that alias). An empty query matches every artist.

`useArtistPickStatus` asks 150 ms after the last change of `keys`, and once at the start with no keys (the answer carries `minArtists`). From a change until its answer, `pending` is true and `status` is the last answer. An answer to an older question is dropped. A failed call sets `failed` and keeps `status`; the next change asks again.

- [ ] **Step 1: Write the failing tests**

```ts
// artists.test.ts
it("finds an artist by a part of the name, in any letter case")
it("finds a Hebrew artist by a Latin alias and says which alias")     // viaAlias === "omer adam"
it("filters by kind and keeps the order of the list")
it("maps the database rows to PickableArtist")                        // artist_key -> key
// useArtistPickStatus.test.ts (fake timers)
it("asks once, 150 ms after the last of three quick changes")
it("drops an answer that is older than the last question")            // Review Focus 2
it("is pending from a change until its answer")                       // Review Focus 2
it("keeps the last status and sets failed when the call fails")
// api.test.ts: createGame sends an { artists } body unchanged
```

- [ ] **Step 2: Run, see them fail.** **Step 3: Implement.** **Step 4: Run, then `npm run typecheck && npm run lint`.**
- [ ] **Step 5: Commit:** `Add the frontend data layer for picking artists`.

### Task 5: The sound bars

**Files:**
- Create: `frontend/src/components/ReadySign.tsx`, `ReadySign.module.css`, `ReadySign.test.tsx`

**Interfaces:**
- Produces: `export function ReadySign(props: { level: number; levels: number; ready: boolean }): JSX.Element;`

Four bars in the shape of the Sound Clash mark: heights 12, 18, 9 and 15 px in a 24 px box, each 5 px wide, 3 px apart, corner radius 1.5 px, standing on one base line. The sign is `aria-hidden`: the text beside it carries the meaning. Bar number `k` (1 to 4) is lit when `k <= round(level * 4 / levels)`. Unlit is `--border-strong`, lit is `--bone`, and when `ready` all four are `--positive`. Colours change with a transition (`--dur-state`, `--ease-move`).

When `ready` turns from false to true after the first render, the four bars jump once: `transform: scaleY(1)` to `1.35` and back, origin at the bottom, 420 ms, `--ease-arrive`, each bar 50 ms after the one before. No jump on a first render that is already ready, and none when `ready` turns false. This is the one keyframe animation of the feature: it runs once, at a rare moment, and it is not started by fast repeated taps.

- [ ] **Step 1: Write the failing tests**

```ts
it("lights as many bars as the level")                               // level 0 to 4 -> 0 to 4 bars with data-lit="true"
it("marks every bar ready when ready")                               // data-ready="true" on the sign
it("jumps only when ready turns true after the first render")        // the jump class after a false -> true update; none on a first render with ready
it("is hidden from screen readers")
```

- [ ] **Step 2: Run, see them fail.** **Step 3: Implement.** **Step 4: Run vitest, typecheck, lint.**
- [ ] **Step 5: Commit:** `Add the sound bars that show when an artist game is ready`.

### Task 6: The Pick artists tab

**Files:**
- Create: `frontend/src/components/ArtistPanel.tsx`, `ArtistPanel.module.css`, `ArtistPanel.test.tsx`
- Modify: `frontend/src/components/MusicSourceSwitch.tsx` (the third entry), `frontend/src/pages/ManagerCreateGamePage.tsx`, its `.module.css` and `.test.tsx` (add cases), `frontend/public/_redirects`, `frontend/src/lib/redirects.test.ts`, `frontend/src/lib/funnel.ts` and its test, `frontend/src/pages/HowToPlayPage.tsx`, `CHANGELOG.md`

**Interfaces:**
- Consumes: Tasks 4 and 5; the switch and the route of phase 1 Task 10.
- Produces:

```ts
export function ArtistPanel(props: {
  artists: readonly PickableArtist[] | null;      // null while loading
  chosen: readonly string[];                      // keys, the newest last
  onChange: (keys: string[]) => void;
  listTabHref: string;                            // the "My own list" tab, for the empty search
}): JSX.Element;
export function trackArtistGameCreated(artistCount: number): void;   // funnel.ts
```

**The page.** `MUSIC_SOURCE_TABS` gains `{ id: "artists", label: "Pick artists", to: "/manager/create/artists" }`, so the switch has three parts. `_redirects` gains the exact line `/manager/create/artists   /spa-shell   200`, and `STATIC_VIEWS` gains the address. The page owns `chosen`, so the ticks stay when the host changes tab. The panel is loaded with `React.lazy` and its chunk is fetched when the page is idle; the names are loaded when the tab first opens. `Create game` is enabled only when `status?.ready && !pending && !busy`. Submit sends `createGame({ artists: { names: chosen } })`; a 400 with `artists_not_enough` shows the toast `Pick more artists to start.`

**The panel, top to bottom:**

1. **Search box.** It stays at the top of the screen while the list scrolls. It always looks in all names, whatever chip is on.
2. **Language chips**, one row: `All`, `עברית`, `English`, `Films & TV`. One is on at a time.
3. **Chosen artists**: one sliding row of chips, the newest first; a tap removes one (`aria-label="Remove {name}"`). Empty: `No artists yet. Tap a name to add it.`
4. **Count line**: `Showing 20 of 873 names`; with a search: `{n} results in all 873 names` (`1 result`). These are numbers of names, never of songs.
5. **Tiles**, two in a line, built as the genre tiles are (a `label` with a hidden checkbox, a tick box and the name; `dir="auto"` on the name). A long name goes onto two lines. When a search matched through an alias, the alias is under the name in small text. A tile shows no number.
6. **`Show 20 more ({left} left)`**. The list starts with 20 tiles; a change of chip or search goes back to 20. The ticks stay.
7. **Empty search**: `No artist with that name. You can type it in My own list.`, where `My own list` is a link to that tab.

At 200 chosen artists, another tick is refused with the toast `200 artists is the most for one game.`

**The bottom bar** (`data-testid="mix-count"`): `ReadySign`, then the status line; a second, smaller line under it when it has text.

| State | Status line | Second line |
| --- | --- | --- |
| Names or status not loaded yet | (empty) | |
| No artist chosen | `Pick at least {minArtists} artists to start.` | |
| Fewer than `minArtists` | `{n} artists · pick at least {minArtists}` (`1 artist · …`) | |
| Enough artists, not ready | `{n} artists · add more` | |
| Ready, fewer than 10 artists | `{n} artists · Game ready` (`Game ready` bold, in `--positive`) | `You can add more. We recommend 10 or more.` **(wording waits for the maintainer's OK)** |
| Ready, 10 or more artists | `{n} artists · Game ready` | |
| The status call failed | `Could not check. Try again in a moment.` | |

The second line enters with `@starting-style` (opacity 0 and 4 px lower, `--dur-state`, `--ease-arrive`, after 200 ms). Nothing on this tab shows a song count.

Other copy: search placeholder `Search {total} artists`. How to Play, new FAQ entry: Q `Can I choose the artists?` A `Yes. On the Host page choose Pick artists and tick the artists you want. When the bars turn green, the game is ready. It plays songs by those artists only.` `CHANGELOG.md`, under Added: hosts can build a game from artists they pick.

Test ids: `music-source-artists`, `artist-search`, `artist-filter-{all|he|en|film}`, `artist-chosen`, `artist-count`, `artist-tile`, `artist-more`, `ready-sign`, `ready-hint`.

- [ ] **Step 1: Write the failing tests**

```ts
// ArtistPanel.test.tsx
it("shows 20 tiles and the count line, then 20 more")
it("shows no song count anywhere")                                    // no text matches /\d+ songs?/
it("ticks and unticks an artist, and lists the chosen ones newest first")
it("keeps the ticks when the chip or the search changes")
it("searches in all names whatever chip is on")
it("shows the alias under a name that matched through it")
it("offers My own list when the search finds nothing")
it("refuses the 201st artist with a message")
// ManagerCreateGamePage.test.tsx (new cases)
it("opens Pick artists at /manager/create/artists")                   // Review Focus 4
it("keeps the chosen artists when the tab changes")                   // Review Focus 4
it("shows each line of the bottom bar for its state")                 // the seven rows of the table, from a mocked status
it("hides the second line at 10 artists")
it("keeps Create off until the newest status is ready")               // pending -> disabled; ready -> enabled
it("creates a game from the chosen artists")                          // createGame called with { artists: { names } }
it("says to pick more when the server refuses the choice")            // 400 artists_not_enough -> toast, still on the page
it("leaves the Genres and My own list tabs as they were")             // existing tests green
// redirects.test.ts: /manager/create/artists is served the SPA shell
// funnel test: viewName("/manager/create/artists") === "/manager/create/artists"
```

- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Build the panel, the tab and the bottom bar.** Follow the page's tile, chip and button styles; no new colour.
- [ ] **Step 4: Run vitest, typecheck, lint, format check and `npm run build`.** The entry chunk must not grow by more than 1 KB against `main`.
- [ ] **Step 5: Add the How to Play entry and the `CHANGELOG.md` line. Commit:** `Add Pick artists to the host page`.

### Task 7: End-to-end, proofs and release

**Files:**
- Create: `tests/e2e/pick_artists.spec.ts`
- Modify: `docs/planning/TASKS.md`, `docs/planning/NEXT-SESSION.md`

**Interfaces:**
- Consumes: every earlier task; the admin API of the local stack, to add and remove the spec's own songs.

- [ ] **Step 1: Write the spec**

```ts
// beforeAll: add 60 songs by 6 made-up artists ("E2E Pick A" … "E2E Pick F", 10 songs each, each with its own
// made-up YouTube id) through the admin API; afterAll removes them. The spec reads titles; it never waits for playback.
test("a game from chosen artists", async () => {
  // open /manager/create/artists directly                              (Review Focus 4)
  // bar: "Pick at least 5 artists to start."; no bar is lit; Create is off
  // the page shows no text like "12 songs"
  // search "e2e pick" -> 6 tiles; tick 4 -> "4 artists · pick at least 5"
  // tick the 5th (50 songs) -> "5 artists · add more"; 3 bars lit; Create still off
  // tick the 6th -> "6 artists · Game ready"; 4 bars ready; the second line shows; Create is on
  // open Genres, then Pick artists again -> the 6 are still ticked      (Review Focus 4)
  // Create -> console -> one team joins -> Start
  // round 1: the console's song title is one of the 60; the line reads "Your songs: 59 of 60 left"
});
test("the tab on a 320 px phone", async () => {                         // Review Focus 5
  // viewport 320 x 568; a made-up artist with a 40-letter name is on a tile: two lines, scrollWidth <= clientWidth
  // tick 30 artists: the chosen row has one line and scrolls
  // scroll to the end: "Show 20 more" (or the last tile) is fully above the bottom bar
});
```

- [ ] **Step 2: Run it against the local stack** (`cd tests/e2e && npm test pick_artists`). Expected: pass. Then `custom_setlist`, `host_page_layout`, `full_game` and `buzzer_race`: pass, unchanged.
- [ ] **Step 3: No-regression proof.** This plan changes no existing function, so the proof is the fingerprint: save the output of `tests/smoke/setlist_fingerprint.sql` on production before migration 062, run it again after, and `diff` must be empty. Add the `run-stress` and `run-e2e` labels to both PRs; trust the labelled runs.
- [ ] **Step 4: Release order.** PR 1 merged → migration 062 on production (named by the maintainer) → fingerprint diff → the whole-names upload (Task 3 step 5) → on production, `SELECT count(*) FROM list_pickable_artists()` is near the number of credited names and the payload has no count → PR 2 merged → `node tests/smoke/ui_prod_pass.mjs all` (29 of 29) → open `https://www.soundclash.org/manager/create/artists` directly: the Host page with Pick artists open, not the 404 page → one full artist game on production with `?test=1` → the Full-Game Exit Gate.
- [ ] **Step 5: Tick the task in `TASKS.md`, refresh `NEXT-SESSION.md`. Commit:** `Record the Pick artists release checks`.
