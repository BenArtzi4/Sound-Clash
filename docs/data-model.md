# Sound Clash: Data Model

The schema for Postgres on Supabase. Seventeen tables in three groups: a **durable song catalog** (`songs`, `genres`, `song_genres`, plus the custom setlist support tables `artist_aliases` and `song_demand`, mig 061, and the Pick artists table `artist_whole_names`, mig 062), **ephemeral per-game state** (`active_games`, `game_secrets`, `game_teams`, `team_secrets`, `game_rounds`, `game_round_attempts`, and the custom setlist pool `game_setlists` / `game_song_pool`, mig 060) that cascade-deletes ~4h after game creation, and a **durable game-history archive** (`game_history`, `game_history_teams`, `game_history_songs`, mig 033) snapshotted at game end and never pruned.

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
   ├── game_rounds (FK: game_code) ───────────┘
   │
   └── game_setlists (FK: game_code): custom games only (mig 060)
          └── game_song_pool (FK: game_code; song_id → songs, ON DELETE CASCADE)

artist_aliases (PK: alias): artist_key is a value in songs.artist_keys (no FK; mig 061)
song_demand (PK: line_key): standalone (mig 061)
artist_whole_names (PK: name): a whole songs.artist credit, cleaned (no FK; mig 062)
```

**Durable** (never auto-deleted): `songs`, `genres`, `song_genres`, the operator-only `artist_aliases` / `song_demand` (mig 061) and `artist_whole_names` (mig 062). Only `genres` is anon-readable; the browser gets songs through game-scoped RPCs (mig 053, 054).
**Ephemeral** (deleted 4h after `started_at`): `active_games`, `game_teams`, `game_rounds`, and the tables that cascade from them (`game_secrets`, `team_secrets`, `game_round_attempts`, `game_setlists`, `game_song_pool`). Pruned by pg_cron.
**Durable game history** (never pruned; mig 033): `game_history`, `game_history_teams`, `game_history_songs` — an end-of-game snapshot written by `archive_game()` so a finished game survives the 4h sweep. Operator-only (no `anon` read). Indefinite retention (incl. team names) is a **consciously accepted** tradeoff — the strings are pseudonyms and the archive is operator-only; see `security-rls.md` §4 (T5.4).

The main FK crossing the durable ↔ ephemeral boundary is `game_rounds.song_id → songs.id`, with `ON DELETE SET NULL` so deleting a song doesn't break in-progress rounds. `game_song_pool.song_id → songs.id` (mig 060) is `ON DELETE CASCADE` instead: a deleted song simply leaves every custom game's pool. The history tables likewise keep a soft `game_history_songs.song_id → songs.id` (ON DELETE SET NULL) but **denormalize** title/artist/youtube_id, so a later catalog edit or delete can't rewrite the recorded history.

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
  unavailable_at timestamptz,                  -- dead-video auto-skip (mig 045); NULL = playable
  artist_keys   text[] GENERATED ALWAYS AS (song_artist_keys(artist)) STORED,  -- credited artists (mig 049)
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (youtube_id)                          -- one catalog row per YouTube video (mig 042; via UNIQUE INDEX songs_youtube_id_key)
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

-- Custom setlists (migration 061). A spelling a host may type, mapped to one
-- catalog artist. The rows are private catalog data: never committed to git,
-- uploaded like songs. RLS on with no policy, anon/authenticated revoked.
CREATE TABLE artist_aliases (
  alias      text PRIMARY KEY
             CHECK (alias = lower(btrim(alias)) AND alias <> ''),  -- stored cleaned
  artist_key text NOT NULL,   -- a value in songs.artist_keys (not an FK: an array)
  created_at timestamptz NOT NULL DEFAULT now()
);

-- The list lines that matched no catalog song, one row per song (the key is
-- the line's cleaned sides, sorted), written by record_song_demand
-- (migration 061). Operator-only, like the above.
CREATE TABLE song_demand (
  line_key           text PRIMARY KEY,
  raw_line           text NOT NULL,              -- the first line seen for this key
  request_count      integer NOT NULL DEFAULT 1,
  first_requested_at timestamptz NOT NULL DEFAULT now(),
  last_requested_at  timestamptz NOT NULL DEFAULT now(),
  status             text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'approved', 'rejected', 'added'))
);

-- Pick artists (migration 062). A songs.artist credit that is ONE artist
-- although song_artist_keys cuts it (it holds a comma, an "&", ...). The rows
-- are private catalog data: never committed to git, rebuilt from the
-- git-ignored review batch and uploaded like songs. Operator-only, like the
-- above.
CREATE TABLE artist_whole_names (
  name       text PRIMARY KEY
             CHECK (name = lower(btrim(name)) AND name <> ''),  -- the whole credit, cleaned
  created_at timestamptz NOT NULL DEFAULT now()
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
  buzz_attempt_id   integer,                           -- stable identity of the held buzz
  buzz_revision     integer NOT NULL DEFAULT 0,        -- orders game rows across Realtime and REST
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
  manager_token uuid NOT NULL DEFAULT gen_random_uuid(),
  is_test       boolean NOT NULL DEFAULT false  -- mig 051: created by a harness or a marked check
);

CREATE TABLE game_teams (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_code  text NOT NULL REFERENCES active_games(game_code) ON DELETE CASCADE,
  name       text NOT NULL,
  score      integer NOT NULL DEFAULT 0,
  joined_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (game_code, name)
);

-- Per-team rejoin credential, split off game_teams (migration 046) so anon --
-- who can read every game_teams column over Realtime -- can never see it.
-- No anon read policy, no base grant, NOT in the supabase_realtime publication.
-- Provisioned by an AFTER INSERT trigger on game_teams (create_team_secret),
-- cascade-deleted with the team (same 4-hour ephemerality). Only the
-- service-role backend reads it, to resolve a rejoin token back to a team row
-- (POST /games/.../rejoin) or reveal it to the host (GET .../rejoin-token).
CREATE TABLE team_secrets (
  team_id      uuid PRIMARY KEY REFERENCES game_teams(id) ON DELETE CASCADE,
  game_code    text NOT NULL REFERENCES active_games(game_code) ON DELETE CASCADE,
  rejoin_token uuid NOT NULL DEFAULT gen_random_uuid()
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

-- Custom setlist games (migration 060). One row per game whose host brought
-- their own list; a game with no row is a normal genre game. Written with
-- ready = true by save_game_setlist in the same call as the pool rows.
-- RLS on with no policy, anon/authenticated revoked, NOT in the
-- supabase_realtime publication: the pool is the game's answers.
CREATE TABLE game_setlists (
  game_code  text PRIMARY KEY REFERENCES active_games(game_code) ON DELETE CASCADE,
  ready      boolean NOT NULL DEFAULT false,   -- select/peek refuse while false
  list_total integer NOT NULL DEFAULT 0,       -- lines in the host's list, found or not
  created_at timestamptz NOT NULL DEFAULT now()
);

-- The songs a custom game may play. tier 1 = the host's list, tier 2 = more
-- songs by the same artists, played only once tier 1 is used up.
CREATE TABLE game_song_pool (
  game_code text NOT NULL REFERENCES game_setlists(game_code) ON DELETE CASCADE,
  song_id   uuid NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  tier      smallint NOT NULL CHECK (tier IN (1, 2)),
  PRIMARY KEY (game_code, song_id)
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
  is_test           boolean NOT NULL DEFAULT false,    -- mig 051: copied from game_secrets.is_test
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
CREATE INDEX team_secrets_rejoin_token_idx ON team_secrets (rejoin_token);  -- rejoin lookup (mig 046)
CREATE INDEX artist_aliases_artist_key_idx ON artist_aliases (artist_key); -- an artist's spellings (mig 061)

-- Game history (mig 033)
CREATE INDEX game_history_teams_history_idx ON game_history_teams (game_history_id);
CREATE INDEX game_history_songs_history_idx ON game_history_songs (game_history_id);
CREATE INDEX game_history_started_at_idx    ON game_history (started_at);
CREATE INDEX game_history_game_code_idx     ON game_history (game_code);
```

The `active_games_expires_at_idx` is the most important: it backs the hourly pg_cron sweep, which scans for rows past their TTL.

`game_setlists` and `game_song_pool` (mig 060) have no index beyond their primary keys: they are read by primary key only (`game_setlists` by `game_code`; `game_song_pool` by `game_code`, the leading key column, or by `(game_code, song_id)`). Deleting a catalog song scans `game_song_pool` for the cascade, which only holds the pools of live games.

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
(`SOUNDTRACK_GENRE_SLUGS` in `backend/app/constants.py`). The React pages get those slugs
from the `genre_slugs` column of the `round_song` / `game_setlist` RPCs (migration 053,
`rpc-functions.md §3g-§3h`), not from the `song_genres` table.

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
no decade (the create page's default **Any year** choice). So is a song from before 1960, as
the decade choices start at the 60s; the create page's song count (`song_pool_counts`,
migration 052) shows the difference. The catalog is backfilled by `tools/song-curation/`; the admin song form and CSV
importer both accept an optional `release_year` so new songs can carry it from creation.

### `songs.artist_keys`

`text[]` STORED generated column (migration 049): the artists credited in `artist`,
lowercased and trimmed, split by `song_artist_keys()` on ` & `, ` ft. `, ` feat. `,
` featuring `, ` vs. `, ` x ` (not the X of "Lil Nas X & …"), commas and the Hebrew ` ו`
prefix. "עומר אדם ולירן דנינו" gives `{"לירן דנינו","עומר אדם"}`. Postgres fills it on every
insert and on every update of `artist`, so nothing writes it and the admin API never
selects it. The song picker uses it to space artists (no artist again within 8 rounds)
and to prefer artists heard less in the game — see `rpc-functions.md §3cc`. Storing it
keeps the text split out of every pick. If `song_artist_keys` ever changes, run
`UPDATE songs SET artist = artist` so existing rows recompute.

### `songs.unavailable_at`

Nullable `timestamptz` (migration 045, I-Liveness Phase 2). **When the availability scan
last confirmed the song's YouTube video won't play** (oEmbed `404` deleted, or `403`/`401`
private / embedding disabled); `NULL` means playable. The
auto-pickers (`select_next_song`'s random path and `peek_next_song`) skip flagged songs, so
a confirmed-dead video never reaches a round; the explicit `p_song_id` override is
deliberately not filtered (a host forcing a specific song is a deliberate act).

Written only by the service-role-only `set_song_availability` RPC, called by
`POST /admin/songs/check-availability` with `commit=true`: a `404`/`403`/`401` verdict flags
a song (only if currently `NULL` — the timestamp records *first noticed*, and re-scans don't
rewrite it), a `200` clears it back to `NULL` (a restored/transient video becomes eligible
again), and an ambiguous verdict (`400`/`429`/`5xx`/timeout, or any page where the canary
video also failed) never writes. Updating a song
with a **different** `youtube_id` via the admin CRUD also clears the flag — the verdict
belongs to the video, not the song row. The flag is metadata, not deletion: the song stays
in the catalog and the admin list, and self-heals when the video comes back.

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

Postgres `uuid[]` array, set once at `POST /games`. The song pickers
(`select_next_song` / `peek_next_song`, direct-RPC — see `rpc-functions.md`)
use a weighted genre draw before choosing a song. Every selected tag on a
played song counts toward the corresponding genre. Israeli Covers counts
twice toward its genre, giving it about half the share of other genres in a
mix. The picker compares projected counts for genres that would still have
eligible songs after the pick and uses a two-unit spread when possible. The
previous round's genres have half weight. Songs must be unplayed in that
game, pass the decade filter and have `unavailable_at IS NULL`. See
[rpc-functions.md](rpc-functions.md#3cc-pick_next_song-the-song-picker-internal-only).
A custom setlist game (a `game_setlists` row, migration 060) has no genres:
its songs come from `game_song_pool` instead (see below).

### `active_games.selected_decades`

Postgres `integer[]` (migration 032), set once at `POST /games` and empty by
default. Each element is a **decade start-year** (the 80s = `1980`). When
non-empty, the song picker (`select_next_song` / `peek_next_song`) only serves
songs whose `release_year` floored to its decade (`release_year / 10 * 10`) is in
this array — combined with `selected_genres` as **genre AND decade**. Empty means
no year limit; a `NULL`-year song matches no specific decade (see
`songs.release_year`). Mirrors `selected_genres`' storage and lifecycle.

### `active_games.expires_at`

Default `now() + 4 hours`, stamped at game **creation** — lobby time counts against it. The host can push it out in one-hour steps via the token-gated `extend_game` RPC (migration 039: `GREATEST(expires_at, now()) + interval '1 hour'` per call, surfaced as the manager console's expiry-banner "Keep playing +1h" action); nothing else writes it after creation. The pg_cron sweep (`cleanup_expired_games()` in `rpc-functions.md`) deletes any row past this point.

### `active_games.buzzed_team_id` and `locked_at`

`buzzed_team_id` and `locked_at` implement the buzzer lock. Both are NULL when no team holds the buzz. Set together by the `buzz_in` RPC. Cleared together by `start_round`, `award_attempt`, and `end_round`. This is the **only** buzzer lock the running system reads (the UI pages and `award_attempt` all read it here). Migration 059 assigns `buzz_attempt_id` from the new row revision when a lock is acquired. The ID survives a countdown refresh and clears with the lock. The same team receives a new ID on its next buzz, including in the same round.

### `game_rounds.buzzed_team_id` — vestigial (mig 035)

Migration 011 had `buzz_in` mirror the winning team onto `game_rounds.buzzed_team_id` so the since-retired `award_points` could credit the score by reading it back. `award_points` was replaced by `award_attempt` (mig 016), which reads the lock off `active_games` instead, so nothing has read this column since. Migration 035 dropped the mirror-write from `buzz_in` — it was pure Realtime waste (`game_rounds` is published with REPLICA IDENTITY FULL, so the write fanned a no-op `ROUND_CHANGE` out to every client on **every buzz**). The column is retained as a nullable field (no destructive schema change) but is now always NULL in the running system; the only remaining reference is the frontend `roundEqual()` comparison, which is inert against a perpetually-NULL value.

### `game_secrets.is_test` / `game_history.is_test`

Migration 051. True for a game created by one of our own test runs, so durable history (and anything counted from it) holds real play only. `POST /games` sets it when the request's `User-Agent` contains `Headless` or doesn't start with `Mozilla/` (harnesses: headless Chromium, Node `fetch`, curl, httpx), or when it carries `X-Sound-Clash-Test: 1` (the create page sends it when opened with `?test=1`, for a check in a real browser). The service role holds a **column-level** `UPDATE (is_test)` grant on `game_secrets`, nothing else, so it still cannot rewrite `manager_token`. `archive_game` copies the flag into `game_history.is_test`; `mark_game_test(code[, started_at])` (service role) flags one that slipped through. Rows archived before 051 default to `false` and are not backfilled: a **real game** for any count is `NOT is_test AND team_count >= 2 AND round_count >= 5`, counted from the day 051 shipped.

### `game_secrets.manager_token`

Per-game uuid, the host's credential. **Lives in `game_secrets`, not `active_games`** (migration 034): `active_games` is anon-readable and in the `supabase_realtime` publication, so a token stored there was fanned out to every subscribed player over the WebSocket and returned by the anon `select *` hydrate — any player who knew the 6-char code could hijack the game. `game_secrets` has no anon read policy, no base grant, and is **not** in the publication, so anon can never see it.

A uuid is minted by an `AFTER INSERT` trigger on `active_games` (`create_game_secret`, in the same transaction as the game insert). `POST /games` reads it back (by `game_code`) and returns it to the host's browser, which stores it in `localStorage`. The FastAPI `require_manager_token` dependency reads `X-Manager-Token`, fetches the secret via the service-role client, and `secrets.compare_digest`s the values; this authorizes `bonus`, `end`, and `kick-team`. The six token-gated browser RPCs (`award_attempt`, `award_manager_bonus`, `release_buzz_lock`, `select_next_song`, `peek_next_song`, `extend_game`) validate it in-body (they read `game_secrets` as SECURITY DEFINER). The secret shares the game's 4-hour TTL via `ON DELETE CASCADE`; `cleanup_expired_games` removes the game and the FK removes the secret.

### `team_secrets.rejoin_token`

Per-team uuid, the **host-only** credential for reconnecting a team that lost its device (dead phone, closed tab, borrowed device) back to its *exact* `game_teams` row — same `id`, preserved `score` (issue #183). It mirrors `game_secrets.manager_token`'s isolation: **lives in `team_secrets`, not `game_teams`** (migration 046) because `game_teams` is anon-readable **and** in the `supabase_realtime` publication, so a token stored there would be fanned out to every subscribed player. `team_secrets` has no anon read policy, no base grant, and is **not** in the publication, so anon can never see it.

A uuid is minted by an `AFTER INSERT` trigger on `game_teams` (`create_team_secret`, in the same transaction as the team insert; `ON CONFLICT (team_id) DO NOTHING`), and existing teams are backfilled idempotently by the migration. The token is disclosed **only** to the authenticated host, via the manager-token-gated `GET /games/{code}/teams/{team_id}/rejoin-token` — never returned to players by the join endpoint, never stored in player `localStorage`, never sent over Realtime. To reconnect, the player scans a host-shown QR (`…/join/<CODE>#rt=<token>`, URL fragment — like the host `#mt=` recovery link) and the browser calls the unauthenticated `POST /games/{code}/rejoin`, where the rejoin token itself is the credential (128-bit uuid). Both endpoints resolve the token via the service-role backend (there is **no** SECURITY DEFINER RPC — rejoin is a cold-start-tolerant FastAPI endpoint, off the buzzer hot path). The row carries `game_code` denormalized so the rejoin lookup can scope by `(game_code, rejoin_token)`; it shares the team's ephemerality via `ON DELETE CASCADE` (the game sweep drops `active_games`, `game_teams` cascades, and each `team_secrets` cascades in turn). The name-based reclaim it shipped beside (T5.7, joining with the same name resumed the same team) was removed on 2026-10-04 after it merged two teams in game XSU8WK; a taken name is now a 409, so this token and the same browser's stored identity are the only ways back into an existing team.

### `game_teams.score`

Integer. Can go negative; wrong-buzz deducts 3 (`award_attempt`). Updated by `award_attempt` and `award_bonus` RPCs, never directly.

### `game_rounds` denormalization

Each round records `title_claimed_by`, `artist_claimed_by` (uuid refs to the team that claimed the corresponding token, NULL if unclaimed), plus `title_points` / `artist_points` / `wrong_buzz_penalty` for the most recent matching write (legacy denorm; the canonical per-buzz history is `game_round_attempts`). The `game_teams.score` field is the running cumulative across all rounds plus any `award_bonus` calls.

`free_guess_active boolean` (migration 017) is a per-round flag managed by `award_attempt`. It is `true` after a correct attempt and `false` after a wrong attempt; while true, the next wrong attempt waives the −3 penalty. See `rpc-functions.md §3` for the state-transition rules and `game-rules.md §4` for the user-facing scoring story.

### `game_round_attempts`

One row per `award_attempt` call: `(round_id, game_code, team_id, outcome, points_delta, created_at)`. `outcome` is one of `'title' | 'artist' | 'title_artist' | 'wrong'`. Insert-only; cascade-deletes with the round. Used to reconstruct per-buzz round detail (e.g. for a future "round breakdown" or streaks UI).

**Access (mig 037):** analytics-only. The app never reads this table, so it is **operator-only** — RLS enabled with no policy + no anon `GRANT` (same posture as `game_secrets` / `game_history*`) — and it is **not** in the `supabase_realtime` publication. Migration 016 originally published it (`REPLICA IDENTITY FULL`) and left it without RLS; mig 037 removed it from the publication (it had zero subscribers, so every scored buzz was WAL-decoded and broadcast for nothing) and locked it down. `award_attempt` still inserts rows because it runs SECURITY DEFINER as the table owner, bypassing RLS/GRANTs. A future streaks feature re-adds it to the publication deliberately.

The 014 migration dropped `source_points` and `timeout_penalty` columns. The 016 migration retired the one-shot `award_points` model in favour of multi-buzz `award_attempt` + explicit `end_round`.

### `game_setlists` and `game_song_pool`

Migration 060, custom setlists phase 1 (design: `docs/planning/2026-11-24-custom-setlist-design.md` §8). A host can bring their own list instead of choosing genres. The list is matched against the catalog before the game exists, and **Create game** saves the result through `save_game_setlist`, which writes the `game_setlists` row with `ready = true` and the pool rows in one call. A game with a `game_setlists` row is a **custom game**: it has no `selected_genres` or `selected_decades`, and `select_next_song` / `peek_next_song` take its songs from `pick_next_pool_song` (the host's list, tier 1, before the same-artist songs, tier 2; never a played or unavailable song). While `ready` is false they refuse with `setlist_not_ready`, so a broken or half-saved pool can never start. A game with no row is a normal genre game and its path is unchanged.

- `list_total` is the number of lines in the host's list, found or not; `game_pool_summary` returns it with the per-tier counts for the console line.
- A song is in a pool once (`PRIMARY KEY (game_code, song_id)`); an id in both the list and the fill is tier 1.
- `save_game_setlist` skips an id that is not in `songs` or is flagged unavailable (`unavailable_at IS NOT NULL`): a flagged song "cannot play" (design §8), so it never enters the pool and does not count in the pool size. A song flagged later stays in the pool, and the picker skips it.
- **`active_games` is not changed at all.** That row goes to every phone on every buzz, so the pool lives in these two tables, which players cannot read (RLS on with no policy, base privileges revoked, not in the Realtime publication; see `security-rls.md` §2). Both cascade-delete with the game.

See `rpc-functions.md` §3c, §3d and §3i-§3k.

### `artist_aliases` and `song_demand`

Migration 061, custom setlists phase 1 (design: `docs/planning/2026-11-24-custom-setlist-design.md` §7 and §13 point 5). Both are durable (no foreign key to the game tables, so the 4-hour sweep never reaches them) and operator-only: RLS on with no policy, every base privilege revoked from `anon` and `authenticated`, not in the Realtime publication. `service_role` holds `SELECT`, `INSERT`, `UPDATE`, `DELETE` (granted explicitly, as migrations 030 and 033 do), because the backend's list matcher reads `artist_aliases` through PostgREST.

- **`artist_aliases`** maps a spelling a host may type to one catalog artist, so a line in the other script still finds the artist. `alias` is the primary key and is stored cleaned: a `CHECK` refuses a value that is not lower case and trimmed, or is empty. `artist_key` is a value that appears in `songs.artist_keys`; it cannot be a foreign key (`artist_keys` is an array) and no trigger enforces it, so the offline verify tool checks it. One artist may have many spellings; the `artist_key` index finds them. **The rows are private:** they name the catalog's artists, so they are never committed to git; they are uploaded like songs. They are in the encrypted weekly catalog backup (`.github/workflows/catalog-backup.yml`) with `song_demand`, and `db/backups/restore.sql` restores them. An alias never joins two catalog entries that are translations of each other (two recordings).
- **`song_demand`** is the Demand Queue: the list lines that matched no catalog song, one row per song (`line_key`: the line's two sides, each cleaned as a title, sorted and joined; `api-contracts.md §2.2`), so the same song written in another order or with numbering or a note is one row. `record_song_demand` writes it: a new key gets a row with `request_count = 1`; a known key gets `request_count + 1` and a new `last_requested_at`, and keeps its first `raw_line`, its `first_requested_at` and its `status`. `status` (`pending`, `approved`, `rejected`, `added`) is the maintainer's review state; a new request never changes it.

See `rpc-functions.md` §3l.

### `artist_whole_names`

Migration 062, Pick artists (plan: `docs/planning/2026-11-24-pick-artists-plan.md`). `song_artist_keys` (migration 049) cuts a credit at every comma, `&`, `ft.` and so on, so a one-act name that holds a separator ("Salt, Pepper & Co", a made-up example) would show as three artists in the Pick artists list. A row here says that the whole credit is **one** artist: `name` is the credit cleaned (`lower(btrim(artist))`; a `CHECK` refuses a value that is not lower case and trimmed, or is empty), and a song whose cleaned credit is a row counts for that one name in `pickable_credits` (`rpc-functions.md` §3n). Only a whole credit matches: the same name inside a longer credit ("… ft. …") is still cut. The table changes only what the artist list shows and counts: `songs.artist_keys`, the song pickers and the list matcher keep the cut keys.

Durable (no foreign key, so the 4-hour sweep never reaches it) and operator-only, like `artist_aliases`: RLS on with no policy, every base privilege revoked from `anon` and `authenticated`, not in the Realtime publication; `service_role` holds `SELECT`, `INSERT`, `UPDATE`, `DELETE` (granted explicitly). **The rows are private catalog data:** each names a catalog artist, so they are never committed to git. They are rebuilt from the git-ignored review batch (`tools/song-curation/aliases/`) and uploaded like songs. They are **not yet** in the encrypted weekly catalog backup (`.github/workflows/catalog-backup.yml`): adding the table to the backup and to `db/backups/restore.sql` is a follow-up the maintainer approves; until then, a lost table is rebuilt from the batch.

See `rpc-functions.md` §3m-§3q.

## 5. Row-Level Security (summary)

Two principals: `anon` (browser) and `service_role` (FastAPI). All tables have RLS enabled; `anon` gets SELECT-only on `genres` and the live-game tables; mutations are exclusively via service_role or via the six browser-callable writes (`buzz_in`, `award_attempt`, `award_manager_bonus`, `release_buzz_lock`, `select_next_song`, `extend_game` — each a `SECURITY DEFINER` function that validates the game code or the `manager_token` in-body; see `security-rls.md` for the grant matrix). The browser reads song metadata only through the read-only, game-scoped `game_setlist` / `round_song` RPCs (mig 053; a song only for a game that played it, from the archive once the game is swept), the create page's counts through `song_pool_counts`, and the Pick artists tab's names and ready sign through `list_pickable_artists` / `artist_pick_status` (mig 062; names and a coarse level, never a song or a count); migration 054 dropped anon's policies on `songs` / `song_genres` and revoked its `SELECT` (and `authenticated`'s), so a direct read is "permission denied". `genres` stays readable. The exceptions are the song catalog (`songs`, `song_genres`, mig 054), the durable history tables (`game_history*`, mig 033), the secret tables (`game_secrets`, mig 034; `team_secrets`, mig 046), the per-buzz analytics log (`game_round_attempts`, mig 037), the custom setlist pool (`game_setlists`, `game_song_pool`, mig 060), the custom setlist support tables (`artist_aliases`, `song_demand`, mig 061), and the Pick artists whole names (`artist_whole_names`, mig 062): each has RLS on with **no `anon` policy at all**, so they are operator-only (read via the service role / Supabase SQL editor).

Full policy DDL and threat model: see **`security-rls.md`**.

## 6. RPC Functions (summary)

These core PL/pgSQL functions encode the game's state transitions (plus the history archiver); see `rpc-functions.md` for the full list:

| Function | Purpose | Caller |
|---|---|---|
| `buzz_in(p_game_code, p_team_id)` | Atomic buzzer lock | Browser via PostgREST (anon) |
| `award_attempt(p_game_code, p_round_id, p_correct_title, p_correct_artist, p_wrong, p_manager_token, p_buzz_attempt_id)` | Score the observed buzz (DB derives the +10/+5/−3 magnitudes); round stays open | Browser via PostgREST (`manager_token`) |
| `release_buzz_lock(p_game_code, p_manager_token, p_buzz_attempt_id)` | "Continue round" — clear the buzzer lock so play resumes | Browser via PostgREST (`manager_token`) |
| `select_next_song(p_game_code, p_manager_token, p_song_id DEFAULT NULL)` | Close the prior round and open the next on an unplayed song | Browser via PostgREST (`manager_token`) |
| `peek_next_song(p_game_code, p_manager_token)` | Read-only next-song candidate, so the Next-round tap can load it on the host's player in the gesture (no round advance) | Browser via PostgREST (`manager_token`) |
| `extend_game(p_game_code, p_manager_token)` | Push `expires_at` out by 1h ("Keep playing +1h") | Browser via PostgREST (`manager_token`) |
| `song_pool_counts()` | Read-only: playable songs per (decade, genre set), for the create page's "N songs in this mix" | Browser via PostgREST (anon, no token) |
| `game_setlist(p_game_code)` | Read-only: the songs a game's rounds played, in round order (live rows, else the most recent archive with that code), for the end-of-game setlist | Browser via PostgREST (anon, no token) |
| `round_song(p_game_code, p_song_id)` | Read-only: one song, only if that game played it, for the host score panel and the TV reveal | Browser via PostgREST (anon, no token) |
| `game_pool_summary(p_game_code, p_manager_token)` | Read-only: a custom game's list size and how many songs are left per tier; zero rows for a genre game | Browser via PostgREST (`manager_token`): the host console's progress line (`hooks/useSetlistProgress.ts`: once on mount and on each round change, stops after zero rows or `PGRST202`) |
| `save_game_setlist(p_game_code, p_list_song_ids, p_fill_song_ids, p_list_total)` | Save a custom game's pool and set `ready` in one call; returns the pool size | FastAPI `POST /games` with a list (service role) |
| `pick_next_pool_song(p_game_code)` | The custom-game picker: lowest tier left, then artist spacing, then a weighted draw | Internal (called by `select_next_song` / `peek_next_song`) |
| `record_song_demand(p_keys, p_lines)` | Count list lines the catalog lacks in `song_demand` (a key repeated in one call counts once); returns the rows touched | FastAPI `POST /games` with a list (service role), after the pool is saved |
| `list_pickable_artists()` | Read-only: every artist a host can tick (key, most common spelling, kind `film`/`he`/`en`, sorted aliases), most songs first; no count column | Browser via PostgREST (anon, no token): the Pick artists tab |
| `artist_pick_status(p_keys)` | Read-only: `ready` plus a level from 0 to `levels`, and `min_artists`; no count | Browser via PostgREST (anon, no token) and FastAPI `POST /games` with artists |
| `save_game_artists(p_game_code, p_keys)` | Save an artist game's pool (every playable song of the chosen artists, tier 1) through `save_game_setlist`; refuses a choice that is not ready; returns the pool size | FastAPI `POST /games` with artists (service role) |
| `artist_game_rule()` | The ready rule's numbers: minimum songs, minimum artists, levels (the only place that holds them; `rpc-functions.md` §3m) | Internal |
| `pickable_credits()` | (song, artist it counts for, spelling) for every playable song, with `artist_whole_names` applied | Internal (the three above) |
| `start_round(p_game_code, p_song_id)` | Begin a new round; closes any prior open round | Internal (called by `select_next_song`) |
| `end_round(p_game_code, p_round_id)` | Close the round (idempotent) | Internal; nothing calls it today (`start_round` closes the prior round itself) |
| `award_manager_bonus(p_game_code, p_manager_token, p_team_id)` | Fixed +4 to a team, returns its new score | Manager browser |
| `award_bonus(p_game_code, p_team_id, p_points DEFAULT 4)` | Adds a positive bonus to a team | `award_manager_bonus` and FastAPI |
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
├── 015_drop_total_rounds.sql   -- relaxed total_rounds NOT NULL (the actual DROP is mig 040)
├── 016_multi_buzz_rounds.sql -- multi-buzz model: token claims, award_attempt, end_round
├── 017_free_guess_flag.sql   -- per-round free-guess flag; waives -3 after first correct
│   … 018–032: manager-token RPCs, browser-direct RPC migration, soundtrack/decade filters, etc.
├── 033_game_history.sql      -- durable game-history archive: game_history*, archive_game(); end_game + cleanup sweep into it
├── 034_game_secrets.sql      -- move manager_token off active_games into anon-invisible game_secrets (D-1 leak fix)
├── 035_buzz_in_drop_round_update.sql   -- drop the dead game_rounds.buzzed_team_id mirror-write from buzz_in
├── 036_award_attempt_collapse_writes.sql -- collapse award_attempt's per-round writes into one UPDATE...RETURNING
├── 037_lock_down_game_round_attempts.sql -- remove game_round_attempts from the Realtime publication + enable RLS
├── 038_peek_next_song_metadata.sql -- peek_next_song also returns the candidate's title/artist/is_soundtrack so Next-round can label the song in-gesture
├── 039_extend_game.sql          -- token-gated "Keep playing +1h" TTL bump: expires_at = GREATEST(expires_at, now()) + 1h
├── 040_drop_total_rounds_column.sql -- finally DROP the orphan active_games.total_rounds (mig 015 only relaxed it)
├── 041_buzz_in_scope_team_to_game.sql -- buzz_in only locks for a team that belongs to the game (EXISTS guard); closes a cross-game score-write vector
├── 042_songs_youtube_id_unique.sql   -- enforce UNIQUE(songs.youtube_id) via idempotent UNIQUE INDEX; one catalog row per YouTube video
├── 043_award_attempt_boolean_overload.sql -- scoring authority in the DB (T7.1): boolean overload of award_attempt derives +10/+5/−3 server-side, added alongside the integer overload
├── 044_drop_award_attempt_integer_overload.sql -- drop the now-dead integer overload of award_attempt once the boolean-sending frontend soaked; boolean signature is now the sole one
│   … 045: songs.unavailable_at dead-video auto-skip + set_song_availability writer
├── 046_team_secrets.sql        -- per-team rejoin_token in an anon-invisible team_secrets table (host-only team reconnect, issue #183); mirrors game_secrets' isolation
│   … 047: uniform-per-song pick; 048: balanced genre turns via the internal pick_next_song helper
├── 049_song_spacing.sql        -- songs.artist_keys generated column + pick_next_song: no genre twice in a row, no artist again within 8 rounds, artists heard less preferred
│   … 050: release_year in select_next_song / peek_next_song rows
├── 051_test_game_flag.sql      -- game_secrets.is_test + game_history.is_test, archive_game copies it, mark_game_test fix-up
├── 052_song_pool_counts.sql    -- read-only song_pool_counts(): playable songs per (decade, genre set), so the create page counts any mix and blocks an empty one (#375)
├── 053_catalogue_rpcs.sql      -- game-scoped game_setlist() / round_song() so the browser stops reading songs directly; song_pool_counts() becomes SECURITY DEFINER (expand step; the revoke is 054)
├── 054_revoke_anon_catalogue_reads.sql -- drop anon_read_songs / anon_read_song_genres and REVOKE SELECT on songs, song_genres from anon + authenticated (contract step after 053); genres stays readable
│   … 055–059: award_manager_bonus, weighted genre balance, guarded round advance, buzz-lock broadcast, scoring bound to the buzz
├── 060_game_song_pool.sql      -- custom setlists: game_setlists + game_song_pool, pick_next_pool_song, save_game_setlist, game_pool_summary, and the custom-game branch in select_next_song / peek_next_song
├── 061_setlist_support_tables.sql -- custom setlists: durable artist_aliases (empty; rows are private) + song_demand, and record_song_demand
└── 062_pick_artists.sql        -- Pick artists: durable artist_whole_names (empty; rows are private), artist_game_rule, pickable_credits, list_pickable_artists, artist_pick_status, save_game_artists
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
- `game_setlists` / `game_song_pool` (mig 060): one row per custom game, plus one pool row per song in its pool; ~50 bytes per pool row. A list holds up to 300 lines, but one artist line adds all that artist's songs (up to 35 today) and the same-artist fill adds more, so a list of artist names can pull most of the ~1,700-song catalog into one pool. Even then the table stays small (a few live games at a time) and is read by primary key only.
- `artist_aliases` (mig 061): a few spellings per catalog artist, so hundreds to a few thousand rows; ~100 bytes each. Static between catalog uploads.
- `song_demand` (mig 061): one row per distinct missing line, ~150 bytes each. It accumulates like `game_history*` (below), but a repeated request only raises a count.
- `artist_whole_names` (mig 062): one row per reviewed credit that is one artist; at most a few hundred rows (only credits that `song_artist_keys` cuts can need one); ~80 bytes each. Static between catalog uploads.

**Total live size**: ~5 MB. Free tier is 500 MB. Headroom is enormous.

`game_history*` (mig 033) is the main set of tables that **accumulates** rather than being pruned: roughly 1 + ~8 team + ~30 song rows per archived game, ~150 bytes each → on the order of tens of MB per year at the high end of this range. Still tiny against the 500 MB tier for years, but unlike the ephemeral tables it grows monotonically. If pruning is ever wanted it's a one-line cron `DELETE FROM game_history WHERE started_at < now() - interval '<N> years'` (children cascade); none is scheduled today.

## 9. Dropped from Old Schema

The legacy Sound Clash codebase had tables and columns that **will not** be carried over. Listed here so future contributors don't reintroduce them:

- `songs.play_count`, `songs.last_played`: heatmap analytics; out of scope (game data is ephemeral by design).
- `songs.is_active`: soft-delete flag; replaced by hard delete.
- AI song-selection cache table; feature dropped.
- DynamoDB-style ephemeral state with TTL; replaced by Postgres `expires_at` + pg_cron.
- ElastiCache Redis sessions; Realtime handles fan-out; no server sessions to cache.
- Per-game *buzz-by-buzz* audit log; out of scope (the live `game_round_attempts` table is ephemeral). Note: a durable end-of-game **summary** now exists — `game_history*` (mig 033) records start/end, teams + final scores, round count, and the ordered song list — but the per-buzz attempt stream is still not retained.

If any of these are wanted later, add a separate migration; do not retrofit into the base schema.
