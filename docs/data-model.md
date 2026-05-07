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

The only FK crossing the durable ↔ ephemeral boundary is `game_rounds.song_id → songs.id`, with `ON DELETE SET NULL` so deleting a song doesn't break in-progress rounds.

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
  is_soundtrack boolean NOT NULL DEFAULT false, -- true = movie/TV soundtrack
  source        text,                           -- name of movie/TV show; nullable
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
  round_number      integer NOT NULL DEFAULT 0,
  current_song_id   uuid REFERENCES songs(id) ON DELETE SET NULL,
  current_round_id  uuid,                              -- FK added below
  buzzed_team_id    uuid,                              -- nullable; the lock
  locked_at         timestamptz,                       -- server-authoritative buzz time
  started_at        timestamptz NOT NULL DEFAULT now(),
  ended_at          timestamptz,
  expires_at        timestamptz NOT NULL DEFAULT (now() + interval '4 hours'),
  manager_token     uuid NOT NULL DEFAULT gen_random_uuid()  -- per-game host credential
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
  buzzed_team_id  uuid REFERENCES game_teams(id) ON DELETE SET NULL,
  title_points       integer NOT NULL DEFAULT 0,
  artist_points      integer NOT NULL DEFAULT 0,
  wrong_buzz_penalty integer NOT NULL DEFAULT 0,
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
```

## 3. Indexes

```sql
CREATE INDEX active_games_expires_at_idx  ON active_games (expires_at);  -- cron sweep
CREATE INDEX game_teams_game_code_idx     ON game_teams  (game_code);
CREATE INDEX game_rounds_game_code_idx    ON game_rounds (game_code);
CREATE INDEX songs_is_soundtrack_idx      ON songs (is_soundtrack) WHERE is_soundtrack = true;
CREATE INDEX song_genres_genre_idx        ON song_genres (genre_id);
```

The `active_games_expires_at_idx` is the most important: it backs the hourly pg_cron sweep, which scans for rows past their TTL.

## 4. Field Notes

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

### `active_games.expires_at`

Default `started_at + 4 hours`. Read-only after game creation. The pg_cron sweep (`cleanup_expired_games()` in `rpc-functions.md`) deletes any row past this point.

### `active_games.buzzed_team_id` and `locked_at`

These two columns implement the buzzer lock. Both are NULL when no team holds the buzz. Set together by the `buzz_in` RPC. Cleared together by `start_round` and `award_points`.

### `active_games.manager_token`

Per-game uuid generated by Postgres at insert time. Returned to the host's browser by `POST /games` and stored in `localStorage`. The FastAPI `require_manager_token` dependency reads `X-Manager-Token` from the request, fetches the row, and `secrets.compare_digest`s the values; this is what authorizes `select-song`, `award-points`, `end`, and `kick-team`. The token shares the row's 4-hour TTL; when `cleanup_expired_games` deletes the game, the token disappears with it. There is no separate token table or revocation list.

### `game_teams.score`

Integer. Can go negative; wrong-buzz deducts 3 (`award_points`). Updated by `award_points` and `award_bonus` RPCs, never directly.

### `game_rounds` denormalization

Each round records `title_points`, `artist_points`, `wrong_buzz_penalty` separately so the round detail can be reconstructed for display. Net awarded = `title + artist - wrong_buzz_penalty`. The `game_teams.score` field is the running cumulative across all rounds plus any `award_bonus` calls; two sources of truth for different views.

The 014 migration dropped `source_points` and `timeout_penalty` columns. The "source" mechanic is gone from scoring (`songs.is_soundtrack` is still used by the song picker and admin UI but no longer affects points). Timeout is now a pure "end the round, no score change" signal; no penalty.

## 5. Row-Level Security (summary)

Two principals: `anon` (browser) and `service_role` (FastAPI). All tables have RLS enabled; `anon` gets SELECT-only on all tables; mutations are exclusively via service_role or via the `buzz_in` RPC (the only function `anon` is granted EXECUTE on).

Full policy DDL and threat model: see **`security-rls.md`**.

## 6. RPC Functions (summary)

Six PL/pgSQL functions encode all state transitions:

| Function | Purpose | Caller |
|---|---|---|
| `buzz_in(p_game_code, p_team_id)` | Atomic buzzer lock | Browser via PostgREST |
| `start_round(p_game_code, p_song_id)` | Begin a new round | FastAPI |
| `award_points(p_game_code, p_round_id, p_title, p_artist, p_wrong_buzz, p_timeout)` | Evaluate and score | FastAPI |
| `award_bonus(p_game_code, p_team_id, p_points DEFAULT 4)` | Host-discretion bonus to a team | FastAPI |
| `end_game(p_game_code)` | Mark game ended | FastAPI |
| `cleanup_expired_games()` | TTL sweep | pg_cron |

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
└── 012_manager_token.sql     -- per-game host credential
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

## 9. Dropped from Old Schema

The legacy Sound Clash codebase had tables and columns that **will not** be carried over. Listed here so future contributors don't reintroduce them:

- `songs.play_count`, `songs.last_played`: heatmap analytics; out of scope (game data is ephemeral by design).
- `songs.is_active`: soft-delete flag; replaced by hard delete.
- AI song-selection cache table; feature dropped.
- DynamoDB-style ephemeral state with TTL; replaced by Postgres `expires_at` + pg_cron.
- ElastiCache Redis sessions; Realtime handles fan-out; no server sessions to cache.
- Per-game audit log; out of scope (ephemeral).

If any of these are wanted later, add a separate migration; do not retrofit into the base schema.
