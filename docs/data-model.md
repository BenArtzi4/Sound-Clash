# Sound Clash: Data Model

The schema for Postgres on Supabase. Six tables, two halves: durable catalog and ephemeral game state.

For PL/pgSQL function bodies that mutate this schema, see **`rpc-functions.md`**.
For RLS policies and access matrix, see **`security-rls.md`**.

## 1. ER Diagram

```
genres ──┬── song_genres ──┬── songs
         │                 │
         │ (composite PK)  │
         │                 │
         └─────────────────┘
                                 (FK with ON DELETE SET NULL)
                                              │
active_games (PK: game_code) ◄────────────────┤
   │                                          │
   ├── game_teams (FK: game_code): N teams   │
   │                                          │
   └── game_rounds (FK: game_code) ───────────┘
```

**Durable** (never auto-deleted): `songs`, `genres`, `song_genres`.
**Ephemeral** (deleted 4h after `started_at`): `active_games`, `game_teams`, `game_rounds`. Pruned by pg_cron.
**Durable game history** (never pruned; mig 033): `game_history`, `game_history_teams`, `game_history_songs` — an end-of-game snapshot written by `archive_game()` so a finished game survives the 4h sweep. Operator-only (no `anon` read).

The only FK crossing the durable ↔ ephemeral boundary is `game_rounds.song_id → songs.id`, with `ON DELETE SET NULL` so deleting a song doesn't break in-progress rounds. The history tables likewise keep a soft `game_history_songs.song_id → songs.id` (ON DELETE SET NULL) but **denormalize** title/artist/youtube_id, so a later catalog edit or delete can't rewrite the recorded history.

## 2. DDL

```sql
-- Required extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- for gen_random_uuid()

-- ====== Durable: song catalog ======
CREATE TABLE songs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title         text NOT NULL,
  artist        text NOT NULL,
  youtube_id    char(11) NOT NULL,
  start_time    integer NOT NULL DEFAULT 0,    -- seconds
  release_year  integer                        -- original release year (mig 031); nullable
                  CHECK (release_year IS NULL OR release_year BETWEEN 1900 AND 2100),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE genres (
  id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  slug text NOT NULL UNIQUE
);

CREATE TABLE song_genres (
  song_id  uuid REFERENCES songs(id)  ON DELETE CASCADE,
  genre_id uuid REFERENCES genres(id) ON DELETE CASCADE,
  PRIMARY KEY (song_id, genre_id)
);

-- ====== Ephemeral: live game state ======
CREATE TABLE active_games (
  game_code         text PRIMARY KEY,
  status            text NOT NULL DEFAULT 'waiting'
                     CHECK (status IN ('waiting','playing','ended')),
  selected_genres   uuid[] NOT NULL DEFAULT '{}',
  selected_decades  integer[] NOT NULL DEFAULT '{}',   -- mig 032; decade start-years
  round_number      integer NOT NULL DEFAULT 0,
  current_song_id   uuid REFERENCES songs(id) ON DELETE SET NULL,
  current_round_id  uuid,                              -- FK added below
  buzzed_team_id    uuid,                              -- nullable; the lock
  locked_at         timestamptz,                       -- server-authoritative buzz time
  started_at        timestamptz NOT NULL DEFAULT now(),
  ended_at          timestamptz,
  expires_at        timestamptz NOT NULL DEFAULT (now() + interval '4 hours')
  -- manager_token was here until migration 034 moved it to game_secrets (below):
  -- active_games is anon-readable and Realtime-published, so the token leaked.
);

-- Per-game host credential, split off active_games (migration 034) so anon --
-- who can read every active_games column over Realtime -- can never see it.
-- No anon read policy, no base grant, NOT in the supabase_realtime publication.
-- Provisioned by an AFTER INSERT trigger on active_games (create_game_secret),
-- cascade-deleted with the game (same 4-hour ephemerality). Only the SECURITY
-- DEFINER RPCs (as owner) and the service-role backend read it.
CREATE TABLE game_secrets (
  game_code     text PRIMARY KEY REFERENCES active_games(game_code) ON DELETE CASCADE,
  manager_token uuid NOT NULL DEFAULT gen_random_uuid()
);

CREATE TABLE game_teams (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_code  text NOT NULL REFERENCES active_games(game_code) ON DELETE CASCADE,
  name       text NOT NULL,
  score      integer NOT NULL DEFAULT 0,
  joined_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (game_code, name)
);

CREATE TABLE game_rounds (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_code       text NOT NULL REFERENCES active_games(game_code) ON DELETE CASCADE,
  round_number    integer NOT NULL,
  song_id         uuid REFERENCES songs(id) ON DELETE SET NULL,
  started_at      timestamptz NOT NULL DEFAULT now(),
  buzzed_team_id  uuid REFERENCES game_teams(id) ON DELETE SET NULL,   -- vestigial since mig 035 (no longer written); see §4
  title_points       integer NOT NULL DEFAULT 0,
  artist_points      integer NOT NULL DEFAULT 0,
  wrong_buzz_penalty integer NOT NULL DEFAULT 0,
  title_claimed_by   uuid REFERENCES game_teams(id) ON DELETE SET NULL,   -- mig 016 (multi-buzz)
  artist_claimed_by  uuid REFERENCES game_teams(id) ON DELETE SET NULL,   -- mig 016 (multi-buzz)
  free_guess_active  boolean NOT NULL DEFAULT false,                      -- mig 017 (free-guess flag)
  ended_at           timestamptz,
  UNIQUE (game_code, round_number)
);

-- Deferred FKs (must be added after game_rounds and game_teams exist)
ALTER TABLE active_games
  ADD CONSTRAINT active_games_current_round_fkey
  FOREIGN KEY (current_round_id) REFERENCES game_rounds(id) ON DELETE SET NULL;

ALTER TABLE active_games
  ADD CONSTRAINT active_games_buzzed_team_fkey
  FOREIGN KEY (buzzed_team_id) REFERENCES game_teams(id) ON DELETE SET NULL;

-- ====== Durable: game history (archive of finished games) ======
-- Snapshotted by archive_game() when a game ends or is swept (mig 033). Never
-- pruned. Song columns are denormalized so history survives later catalog edits.
CREATE TABLE game_history (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_code         text NOT NULL,
  started_at        timestamptz NOT NULL,
  ended_at          timestamptz,                       -- end_game time, or sweep time if abandoned
  round_count       integer NOT NULL,                  -- rounds actually played (>= 1)
  selected_genres   uuid[] NOT NULL DEFAULT '{}',
  selected_decades  integer[] NOT NULL DEFAULT '{}',
  team_count        integer NOT NULL DEFAULT 0,
  archived_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (game_code, started_at)                       -- idempotency key (game_code recycles over time)
);

CREATE TABLE game_history_teams (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_history_id  uuid NOT NULL REFERENCES game_history(id) ON DELETE CASCADE,
  name             text NOT NULL,
  score            integer NOT NULL,
  joined_at        timestamptz
);

CREATE TABLE game_history_songs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_history_id  uuid NOT NULL REFERENCES game_history(id) ON DELETE CASCADE,
  round_number     integer NOT NULL,
  song_id          uuid REFERENCES songs(id) ON DELETE SET NULL,  -- soft FK; denorm columns are canonical
  song_title       text NOT NULL,
  song_artist      text NOT NULL,
  youtube_id       text NOT NULL,
  start_time       integer NOT NULL DEFAULT 0,
  UNIQUE (game_history_id, round_number)
);
```

## 3. Indexes

```sql
CREATE INDEX active_games_expires_at_idx  ON active_games (expires_at);  -- cron sweep
CREATE INDEX game_teams_game_code_idx     ON game_teams  (game_code);
CREATE INDEX game_rounds_game_code_idx    ON game_rounds (game_code);
CREATE INDEX song_genres_genre_idx        ON song_genres (genre_id);

-- Game history (mig 033)
CREATE INDEX game_history_teams_history_idx ON game_history_teams (game_history_id);
CREATE INDEX game_history_songs_history_idx ON game_history_songs (game_history_id);
CREATE INDEX game_history_started_at_idx    ON game_history (started_at);
CREATE INDEX game_history_game_code_idx     ON game_history (game_code);
```

The `active_games_expires_at_idx` is the most important: it backs the hourly pg_cron sweep, which scans for rows past their TTL.

## 4. Field Notes

### Soundtrack rounds — no `is_soundtrack` column

There is **no `is_soundtrack` column** on `songs` (it was dropped in migration 028).
Soundtrack-ness — whether a round uses the single **Correct (+15)** button and the 🎬
badge instead of the title/artist split — is derived from genre membership: a song is a
soundtrack ⇔ it belongs to a genre whose slug is in `('soundtracks', 'israeli-soundtracks')`.
The genres table is the single source of truth, so the per-song flag can no longer drift
from the genre tag. The value is still surfaced everywhere as a field named
`is_soundtrack`, just **computed** rather than stored: `select_next_song` computes it in
SQL via `EXISTS` over `song_genres → genres` (see `rpc-functions.md §3c`), the admin list
(`backend/app/routers/admin_songs.py`) computes it in Python and the in-game React pages
(`frontend/src/lib/soundtrack.ts`) compute it in TS, both from the genre slugs
(`SOUNDTRACK_GENRE_SLUGS` in `backend/app/constants.py`).

Convention for a soundtrack row: **`artist` holds the film/show name** (film / TV / game /
musical) — it is the answer players must give and the only text revealed on the display
and manager screens — while **`title` holds the song/clip name**, shown only as a smaller
hint on the manager screen and only when it differs from the film name. When a soundtrack
has no distinct clip name, set `title = artist` (the catalog's older soundtrack rows do
this). The CSV importer no longer derives soundtrack-ness or rewrites these fields; it just
requires both `title` and `artist` and stores them verbatim.

### `songs.release_year`

Nullable `integer` (migration 031). The **original commercial release year of the song**,
not of the recording in our catalog: for a cover, store the year the song was first released
by its original artist (a 2012 cover of a 1967 song is `1967`). This is what makes a decade
filter like "play 60s music" behave the way players expect even when the clip is a famous
later cover. `NULL` means the year is unknown / not yet backfilled.

The decade filter (migration 032) derives a song's decade as `release_year / 10 * 10`
(integer division: `1985 → 1980`). A `NULL`-year song therefore matches **no** specific
decade, so it is excluded from a decade-filtered game and included only when the host picks
no decade. The catalog is backfilled by `tools/song-curation/`; the admin song form and CSV
importer both accept an optional `release_year` so new songs can carry it from creation.

### `active_games.game_code`

- 6 chars, alphabet `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (no 0/O, 1/I/L, no lowercase).
- Generated by FastAPI on `POST /games` with collision retry up to 5 times, then 500.
- ~32^6 ≈ 1 billion combinations. Birthday-paradox collision becomes likely around ~30k concurrent games; well above any expected scale.

### `active_games.status`

State machine enforced by CHECK constraint and by RPC functions (see `rpc-functions.md` and `game-rules.md`).

```
waiting → playing → ended
```

Backwards transitions are NOT enforced at the database level; RPC functions reject them.

### `active_games.selected_genres`

Postgres `uuid[]` array. Used by FastAPI when picking a random song:
```sql
SELECT s.* FROM songs s
JOIN song_genres sg ON sg.song_id = s.id
WHERE sg.genre_id = ANY($1)
  AND s.id NOT IN (
    SELECT song_id FROM game_rounds WHERE game_code = $2 AND song_id IS NOT NULL
  )
ORDER BY random() LIMIT 1;
```

### `active_games.selected_decades`

Postgres `integer[]` (migration 032), set once at `POST /games` and empty by
default. Each element is a **decade start-year** (the 80s = `1980`). When
non-empty, the song picker (`select_next_song` / `peek_next_song`) only serves
songs whose `release_year` floored to its decade (`release_year / 10 * 10`) is in
this array — combined with `selected_genres` as **genre AND decade**. Empty means
no year limit; a `NULL`-year song matches no specific decade (see
`songs.release_year`). Mirrors `selected_genres`' storage and lifecycle.

### `active_games.expires_at`

Default `started_at + 4 hours`. Read-only after game creation. The pg_cron sweep (`cleanup_expired_games()` in `rpc-functions.md`) deletes any row past this point.

### `active_games.buzzed_team_id` and `locked_at`

These two columns implement the buzzer lock. Both are NULL when no team holds the buzz. Set together by the `buzz_in` RPC. Cleared together by `start_round`, `award_attempt`, and `end_round`. This is the **only** buzzer lock the running system reads (the UI pages and `award_attempt` all read it here).

### `game_rounds.buzzed_team_id` — vestigial (mig 035)

Migration 011 had `buzz_in` mirror the winning team onto `game_rounds.buzzed_team_id` so the since-retired `award_points` could credit the score by reading it back. `award_points` was replaced by `award_attempt` (mig 016), which reads the lock off `active_games` instead, so nothing has read this column since. Migration 035 dropped the mirror-write from `buzz_in` — it was pure Realtime waste (`game_rounds` is published with REPLICA IDENTITY FULL, so the write fanned a no-op `ROUND_CHANGE` out to every client on **every buzz**). The column is retained as a nullable field (no destructive schema change) but is now always NULL in the running system; the only remaining reference is the frontend `roundEqual()` comparison, which is inert against a perpetually-NULL value.

### `game_secrets.manager_token`

Per-game uuid, the host's credential. **Lives in `game_secrets`, not `active_games`** (migration 034): `active_games` is anon-readable and in the `supabase_realtime` publication, so a token stored there was fanned out to every subscribed player over the WebSocket and returned by the anon `select *` hydrate — any player who knew the 6-char code could hijack the game. `game_secrets` has no anon read policy, no base grant, and is **not** in the publication, so anon can never see it.

A uuid is minted by an `AFTER INSERT` trigger on `active_games` (`create_game_secret`, in the same transaction as the game insert). `POST /games` reads it back (by `game_code`) and returns it to the host's browser, which stores it in `localStorage`. The FastAPI `require_manager_token` dependency reads `X-Manager-Token`, fetches the secret via the service-role client, and `secrets.compare_digest`s the values; this authorizes `bonus`, `end`, and `kick-team`. The four browser-direct RPCs (`award_attempt`, `release_buzz_lock`, `select_next_song`, `peek_next_song`) validate it in-body (they `LEFT JOIN game_secrets`, running as SECURITY DEFINER). The secret shares the game's 4-hour TTL via `ON DELETE CASCADE`; `cleanup_expired_games` removes the game and the FK removes the secret.

### `game_teams.score`

Integer. Can go negative; wrong-buzz deducts 3 (`award_attempt`). Updated by `award_attempt` and `award_bonus` RPCs, never directly.

### `game_rounds` denormalization

Each round records `title_claimed_by`, `artist_claimed_by` (uuid refs to the team that claimed the corresponding token, NULL if unclaimed), plus `title_points` / `artist_points` / `wrong_buzz_penalty` for the most recent matching write (legacy denorm; the canonical per-buzz history is `game_round_attempts`). The `game_teams.score` field is the running cumulative across all rounds plus any `award_bonus` calls.

`free_guess_active boolean` (migration 017) is a per-round flag managed by `award_attempt`. It is `true` after a correct attempt and `false` after a wrong attempt; while true, the next wrong attempt waives the −3 penalty. See `rpc-functions.md §3` for the state-transition rules and `game-rules.md §4` for the user-facing scoring story.

### `game_round_attempts`

One row per `award_attempt` call: `(round_id, game_code, team_id, outcome, points_delta, created_at)`. `outcome` is one of `'title' | 'artist' | 'title_artist' | 'wrong'`. Insert-only; cascade-deletes with the round. Used to reconstruct per-buzz round detail (e.g. for a future "round breakdown" or streaks UI).

**Access (mig 037):** analytics-only. The app never reads this table, so it is **operator-only** — RLS enabled with no policy + no anon `GRANT` (same posture as `game_secrets` / `game_history*`) — and it is **not** in the `supabase_realtime` publication. Migration 016 originally published it (`REPLICA IDENTITY FULL`) and left it without RLS; mig 037 removed it from the publication (it had zero subscribers, so every scored buzz was WAL-decoded and broadcast for nothing) and locked it down. `award_attempt` still inserts rows because it runs SECURITY DEFINER as the table owner, bypassing RLS/GRANTs. A future streaks feature re-adds it to the publication deliberately.

The 014 migration dropped `source_points` and `timeout_penalty` columns. The 016 migration retired the one-shot `award_points` model in favour of multi-buzz `award_attempt` + explicit `end_round`.

## 5. Row-Level Security (summary)

Two principals: `anon` (browser) and `service_role` (FastAPI). All tables have RLS enabled; `anon` gets SELECT-only on the catalog and live-game tables; mutations are exclusively via service_role or via the `buzz_in` RPC (the only function `anon` is granted EXECUTE on). The exceptions are the durable history tables (`game_history*`, mig 033), the secret table (`game_secrets`, mig 034), and the per-buzz analytics log (`game_round_attempts`, mig 037): each has RLS on with **no `anon` policy at all**, so they are operator-only (read via the service role / Supabase SQL editor).

Full policy DDL and threat model: see **`security-rls.md`**.

## 6. RPC Functions (summary)

These core PL/pgSQL functions encode the game's state transitions (plus the history archiver); see `rpc-functions.md` for the full list:

| Function | Purpose | Caller |
|---|---|---|
| `buzz_in(p_game_code, p_team_id)` | Atomic buzzer lock | Browser via PostgREST |
| `start_round(p_game_code, p_song_id)` | Begin a new round; closes any prior open round | FastAPI |
| `award_attempt(p_game_code, p_round_id, p_title, p_artist, p_wrong_buzz)` | Score one buzz; round stays open | FastAPI |
| `end_round(p_game_code, p_round_id)` | Close the round (idempotent) | FastAPI |
| `award_bonus(p_game_code, p_team_id, p_points DEFAULT 4)` | Host-discretion bonus to a team | FastAPI |
| `end_game(p_game_code)` | Archive, then mark game ended | FastAPI |
| `cleanup_expired_games()` | Archive expiring games, then TTL-sweep | pg_cron |
| `archive_game(p_game_code)` | Snapshot a finished game into durable history (idempotent; skips 0-round games) | internal (`end_game`, `cleanup_expired_games`) |

Full bodies, race-correctness arguments, and tests: see **`rpc-functions.md`**.

## 7. Migration Ordering

Apply SQL files in this order:

```
db/migrations/
├── 001_extensions.sql        -- pg_cron, pgcrypto
├── 002_durable_tables.sql    -- songs, genres, song_genres
├── 003_ephemeral_tables.sql  -- active_games, game_teams, game_rounds, deferred FKs
├── 004_indexes.sql
├── 005_rpc_functions.sql     -- the 5 PL/pgSQL functions (see rpc-functions.md)
├── 006_rls_policies.sql      -- enable RLS + policies + grants (see security-rls.md)
├── 007_cron_jobs.sql         -- cron.schedule() calls
├── 008_seed_genres.sql       -- initial genre rows
├── 009_realtime_publication.sql
├── 010_text_game_code.sql    -- char(6) → text on ephemeral tables (Realtime fix)
├── 011_buzz_in_records_round.sql
├── 012_manager_token.sql     -- per-game host credential
├── 013_seed_extra_genres.sql
├── 014_scoring_revamp.sql    -- wrong-buzz penalty, +4 bonus, drop source/timeout
├── 015_drop_total_rounds.sql
├── 016_multi_buzz_rounds.sql -- multi-buzz model: token claims, award_attempt, end_round
├── 017_free_guess_flag.sql   -- per-round free-guess flag; waives -3 after first correct
│   … 018–032: manager-token RPCs, browser-direct RPC migration, soundtrack/decade filters, etc.
├── 033_game_history.sql      -- durable game-history archive: game_history*, archive_game(); end_game + cleanup sweep into it
├── 034_game_secrets.sql      -- move manager_token off active_games into anon-invisible game_secrets (D-1 leak fix)
├── 035_buzz_in_drop_round_update.sql   -- drop the dead game_rounds.buzzed_team_id mirror-write from buzz_in
├── 036_award_attempt_collapse_writes.sql -- collapse award_attempt's per-round writes into one UPDATE...RETURNING
└── 037_lock_down_game_round_attempts.sql -- remove game_round_attempts from the Realtime publication + enable RLS
```

All migrations are written to be idempotent: `CREATE TABLE IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`, `DROP POLICY IF EXISTS … ; CREATE POLICY …`. Re-running them is safe.

Songs are imported separately by Phase 2 of the roadmap (`scripts/import-songs.py`), not by these migrations. Genres are seeded statically in `008_seed_genres.sql`.

## 8. Capacity

At expected scale (100–1000 games/mo):

- `songs` table: ~1,000–10,000 rows × ~200 bytes = ~2 MB. Static.
- `genres`: ~20 rows. Tiny.
- `song_genres`: ~30,000 rows × ~50 bytes = ~1.5 MB. Static.
- `active_games`: never more than ~30 rows at any moment (TTL prunes); ~1 KB each.
- `game_teams`: max ~30 × 8 = ~240 rows; ~200 bytes each.
- `game_rounds`: max ~30 × 30 = ~900 rows; ~300 bytes each.

**Total live size**: ~5 MB. Free tier is 500 MB. Headroom is enormous.

`game_history*` (mig 033) is the one set of tables that **accumulates** rather than being pruned: roughly 1 + ~8 team + ~30 song rows per archived game, ~150 bytes each → on the order of tens of MB per year at the high end of this range. Still tiny against the 500 MB tier for years, but unlike the ephemeral tables it grows monotonically. If pruning is ever wanted it's a one-line cron `DELETE FROM game_history WHERE started_at < now() - interval '<N> years'` (children cascade); none is scheduled today.

## 9. Dropped from Old Schema

The legacy Sound Clash codebase had tables and columns that **will not** be carried over. Listed here so future contributors don't reintroduce them:

- `songs.play_count`, `songs.last_played`: heatmap analytics; out of scope (game data is ephemeral by design).
- `songs.is_active`: soft-delete flag; replaced by hard delete.
- AI song-selection cache table; feature dropped.
- DynamoDB-style ephemeral state with TTL; replaced by Postgres `expires_at` + pg_cron.
- ElastiCache Redis sessions; Realtime handles fan-out; no server sessions to cache.
- Per-game *buzz-by-buzz* audit log; out of scope (the live `game_round_attempts` table is ephemeral). Note: a durable end-of-game **summary** now exists — `game_history*` (mig 033) records start/end, teams + final scores, round count, and the ordered song list — but the per-buzz attempt stream is still not retained.

If any of these are wanted later, add a separate migration; do not retrofit into the base schema.
