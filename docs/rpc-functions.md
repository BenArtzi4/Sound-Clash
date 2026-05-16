# Sound Clash: Postgres RPC Functions

The eight PL/pgSQL functions that hold the system's logic. Each is callable as a Postgres function and exposed via Supabase PostgREST RPC. Together they encode every state-changing operation in the game.

Functions live in `db/migrations/005_rpc_functions.sql` (the original five), `db/migrations/014_scoring_revamp.sql` (added `award_bonus`, retired `source/timeout` shape of the old award function), `db/migrations/016_multi_buzz_rounds.sql` (replaced the one-shot `award_points` with multi-buzz `award_attempt` + `end_round`), `db/migrations/018_split_attempt_release.sql` (split scoring from buzz-lock release: added `release_buzz_lock` and scoped `award_attempt`'s lock-clear to the wrong-buzz path), and `db/migrations/019_refresh_locked_at_on_correct.sql` (`award_attempt` refreshes `locked_at` on a correct attempt so the floor-holding team's answer countdown restarts for the remaining token).

## 0. Conventions

- All functions use `SECURITY DEFINER` so they run with the table-owner's privileges (allowing them to bypass RLS for their own writes). Anon callers can only invoke functions that have been explicitly `GRANT EXECUTE ... TO anon`'d.
- Functions are idempotent where the data model allows (see per-function notes).
- Error returns use Postgres exception codes: `P0001` for application errors, `P0002` for "no_data_found".
- Functions are named with `snake_case`. Parameter names prefixed with `p_`.
- Return types are explicit `TABLE(...)` for multi-column results; void for fire-and-forget ops.

## 1. `buzz_in`: atomic buzzer claim

The hot path. Called by browsers via PostgREST. <100ms RTT.

```sql
CREATE OR REPLACE FUNCTION buzz_in(
  p_game_code char(6),
  p_team_id   uuid
)
RETURNS TABLE(locked boolean, locked_team_id uuid, locked_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_round_id  uuid;
  v_locked_at timestamptz;
BEGIN
  -- Atomic conditional UPDATE on active_games. RETURNING captures the
  -- current_round_id so we can mirror the lock onto game_rounds, and
  -- the resulting locked_at for the function's return value.
  UPDATE active_games ag
     SET buzzed_team_id = p_team_id,
         locked_at      = now()
   WHERE ag.game_code = p_game_code
     AND ag.status = 'playing'
     AND ag.buzzed_team_id IS NULL
  RETURNING ag.current_round_id, ag.locked_at INTO v_round_id, v_locked_at;

  IF FOUND THEN
    -- Mirror the lock onto the round so award_points can credit the
    -- team. active_games.buzzed_team_id is reset to NULL after each
    -- round; game_rounds.buzzed_team_id is the durable record.
    IF v_round_id IS NOT NULL THEN
      UPDATE game_rounds
         SET buzzed_team_id = p_team_id
       WHERE id = v_round_id;
    END IF;

    RETURN QUERY SELECT true, p_team_id, v_locked_at;
  ELSE
    -- Lock already held or game not playable; return current state so
    -- the caller can reconcile its UI.
    RETURN QUERY
    SELECT false, ag.buzzed_team_id, ag.locked_at
      FROM active_games ag
     WHERE ag.game_code = p_game_code;
  END IF;
END $$;

REVOKE ALL ON FUNCTION buzz_in(char, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION buzz_in(char, uuid) TO anon;
```

### Race correctness

Postgres MVCC + row-level locking guarantees only one concurrent caller can satisfy `buzzed_team_id IS NULL`. See `realtime-design.md` §4 for the full argument.

### Error semantics

| Caller's input | Function returns |
|---|---|
| Valid call, lock available | `(locked=true, locked_team_id=<their id>, locked_at=<now>)` |
| Valid call, lock already held | `(locked=false, locked_team_id=<other team>, locked_at=<earlier>)` |
| `p_team_id` doesn't exist in `game_teams` | UPDATE proceeds; orphan FK eventually breaks. **Caller is responsible** for sending a valid team id (frontend reads from its localStorage). |
| `p_game_code` doesn't exist | UPDATE matches 0 rows; SELECT returns 0 rows; PostgREST returns `[]`. Frontend treats as no-op. |
| Game in `waiting` or `ended` state | Same as "no match"; returns `(locked=false, ...)` if game exists. |

The function does not raise exceptions. All outcomes are encoded in the return value. This keeps the hot path fast (no exception overhead) and the client logic simple.

### Callers

- Browser team page via `supabase.rpc('buzz_in', { p_game_code, p_team_id })`.
- Phase 3 stress test: `tests/db/test_buzz_in_race.py`.

### Testing

```python
# tests/db/test_buzz_in_race.py
async def test_concurrent_buzz_one_winner(db):
    game_code = await create_test_game(db, status='playing')
    team_ids = [await create_test_team(db, game_code) for _ in range(10)]

    results = await asyncio.gather(*[
        db.rpc('buzz_in', {'p_game_code': game_code, 'p_team_id': tid})
        for tid in team_ids
    ])

    winners = [r for r in results if r[0]['locked']]
    assert len(winners) == 1, f"Expected 1 winner, got {len(winners)}"

async def test_buzz_when_no_game(db):
    result = await db.rpc('buzz_in', {'p_game_code': 'NOPE12', 'p_team_id': uuid4()})
    assert result == []  # PostgREST empty array

async def test_buzz_when_game_waiting(db):
    game_code = await create_test_game(db, status='waiting')
    team_id = await create_test_team(db, game_code)
    result = await db.rpc('buzz_in', {'p_game_code': game_code, 'p_team_id': team_id})
    assert result[0]['locked'] is False
```

Phase 3 exit criterion: the race test passes 100 consecutive runs without a single failure.

## 2. `start_round`: manager advances to next song

Called by FastAPI (`POST /games/{code}/select-song`). Not exposed to anon.

```sql
CREATE OR REPLACE FUNCTION start_round(
  p_game_code char(6),
  p_song_id   uuid
)
RETURNS uuid  -- new round id
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_round_id  uuid;
  v_round_num integer;
  v_status    text;
BEGIN
  -- Verify game state
  SELECT status, round_number + 1 INTO v_status, v_round_num
    FROM active_games WHERE game_code = p_game_code;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'game_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_status = 'ended' THEN
    RAISE EXCEPTION 'game_already_ended' USING ERRCODE = 'P0001';
  END IF;

  -- Insert new round row
  INSERT INTO game_rounds (game_code, round_number, song_id)
  VALUES (p_game_code, v_round_num, p_song_id)
  RETURNING id INTO v_round_id;

  -- Update game state: clear buzz, advance round number, set current song/round
  UPDATE active_games
     SET status           = 'playing',
         round_number     = v_round_num,
         current_song_id  = p_song_id,
         current_round_id = v_round_id,
         buzzed_team_id   = NULL,
         locked_at        = NULL
   WHERE game_code = p_game_code;

  RETURN v_round_id;
END $$;

REVOKE ALL ON FUNCTION start_round(char, uuid) FROM PUBLIC;
-- No GRANT to anon; only service_role calls this.
```

### Error semantics

| Failure | Exception |
|---|---|
| Game doesn't exist | `P0002 game_not_found` |
| Game already ended | `P0001 game_already_ended` |
| Song doesn't exist (orphan FK) | Postgres FK violation |

The FastAPI router translates these into HTTP responses (404, 409).

### Idempotency

Not idempotent. Each call increments `round_number` and creates a new row. Callers must not retry blindly on network error.

### Callers

- FastAPI `POST /games/{code}/select-song` after picking a random song.

## 3. `award_attempt`: manager scores one buzz (multi-buzz model)

Called **direct from the manager browser** via Supabase PostgREST RPC (as of migration 021). Replaces the old FastAPI `POST /games/{code}/attempt` endpoint; removing the Render hop drops manager-action latency from ~400-600ms to ~150ms. The function takes the per-game `manager_token` as its last argument and validates it before any side effect, so anon EXECUTE is safe here the same way it is for `buzz_in`. Replaces the older `award_points` (migration 016). `award_attempt` does **not** close the round — a round can accept many `award_attempt` calls (one per buzz) until the manager calls `end_round` (or `start_round` for the next song defensively closes it).

```sql
CREATE OR REPLACE FUNCTION award_attempt(
  p_game_code     text,
  p_round_id      uuid,
  p_title         integer DEFAULT 0,   -- 0 or 10
  p_artist        integer DEFAULT 0,   -- 0 or 5
  p_wrong_buzz    integer DEFAULT 0,   -- 0 or 3 (deducted)
  p_manager_token uuid    DEFAULT NULL -- required; validated in the body
)
RETURNS TABLE(
  team_id            uuid,
  points_delta       integer,
  team_total_score   integer,
  title_claimed_by   uuid,
  artist_claimed_by  uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public;
```

Token check (run before any other read/write):
- Fetch `manager_token, ended_at` from `active_games` for the code. Missing row → `P0002 game_not_found`. Ended → `P0001 game_ended`. Mismatched or NULL token → `28000 manager_token_required`.

Behavior:
- Reads the current `buzzed_team_id` off `active_games`. If null → raises `P0001 no_buzz_to_score`.
- `p_wrong_buzz > 0 AND (p_title > 0 OR p_artist > 0)` → raises `P0001 wrong_buzz_with_correct`.
- `p_title > 0` while `title_claimed_by` is already set → raises `P0001 title_already_claimed`. Same shape for `artist_already_claimed`.
- On success: applies score delta to the buzzed team, marks `title_claimed_by` / `artist_claimed_by` if applicable, and inserts a `game_round_attempts` row.
- **Buzz-lock handling** (migration 018, refined by migration 019): only the wrong-buzz path clears `active_games.buzzed_team_id` and `locked_at`. A correct `title` / `artist` / `title_artist` attempt leaves `buzzed_team_id` in place — the answering team retains the floor for the other token until the manager presses Continue (`release_buzz_lock`) or Wrong, or until `start_round` defensively clears the lock for the next song — but it **refreshes `locked_at = now()`** so the clients' answer countdown restarts for the remaining token (migration 019). The no-op continue case (no toggles, no `wrong_buzz`) leaves the lock untouched. Before 018 the lock was always cleared regardless of outcome.
- **Free-guess flag** (`game_rounds.free_guess_active`, migration 017): if `p_wrong_buzz > 0` AND `free_guess_active = true`, the penalty is waived (`points_delta = 0`); the attempt is still recorded with `outcome = 'wrong'`. After processing, the function sets `free_guess_active = true` if the outcome was correct (`title` / `artist` / `title_artist`) and `false` otherwise. So the flag is consumed by every attempt and re-armed by every correct one.

### Error semantics

| Failure | Exception |
|---|---|
| Game code unknown | `P0002 game_not_found` |
| Game already ended | `P0001 game_ended` |
| Bad / missing / NULL manager token | `28000 manager_token_required` |
| Round doesn't exist | `P0002 round_not_found` |
| Round already ended | `P0001 round_already_ended` |
| No buzz currently held | `P0001 no_buzz_to_score` |
| `wrong_buzz` combined with `title` or `artist` | `P0001 wrong_buzz_with_correct` |
| Title token already claimed | `P0001 title_already_claimed` |
| Artist token already claimed | `P0001 artist_already_claimed` |

### Idempotency

Not idempotent. Each successful call records one attempt and may shift token claims. The frontend guards against double-submit with a `busy` flag; the function additionally raises `title_already_claimed` / `artist_already_claimed` so a leaked double-click cannot double-award.

### Callers

- Manager browser → Supabase PostgREST RPC (`frontend/src/hooks/useManagerActions.ts::awardAttemptDirect`).

## 3aa. `release_buzz_lock`: manager re-arms the buzzers without scoring

Added in migration 018, opened to anon callers with the manager_token check in migration 021. Called **direct from the manager browser** when the host presses Continue after a correct `award_attempt` (which leaves the lock in place).

```sql
CREATE OR REPLACE FUNCTION release_buzz_lock(
  p_game_code     text,
  p_manager_token uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public;
```

Behavior:
- Validates `p_manager_token` against `active_games.manager_token` (same error matrix as `award_attempt`: `game_not_found` / `game_ended` / `manager_token_required`).
- Then: `UPDATE active_games SET buzzed_team_id = NULL, locked_at = NULL WHERE game_code = p_game_code`. That's the entire post-check body.
- No-op (post-check) if no buzz is held; never raises a "nothing to release" error.

### Idempotency

Idempotent on the unlock side: safe to call any number of times once authorized.

### Callers

- Manager browser → Supabase PostgREST RPC (`frontend/src/hooks/useManagerActions.ts::releaseBuzzLockDirect`).

## 3b. `end_round`: manager closes the round

Called by FastAPI (`POST /games/{code}/end-round`). Not exposed to anon. Sets `game_rounds.ended_at` and clears any lingering buzz lock. Idempotent; safe to call repeatedly.

```sql
CREATE OR REPLACE FUNCTION end_round(
  p_game_code text,
  p_round_id  uuid
) RETURNS timestamptz  -- ended_at value
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public;
```

Behavior:
- If round exists and is open → stamps `ended_at = now()` and returns it.
- If round exists and is already ended → returns the existing `ended_at` unchanged.
- If round doesn't exist → raises `P0002 round_not_found`.
- Always clears `active_games.buzzed_team_id` and `locked_at` for the game.

### Callers

- FastAPI `POST /games/{code}/end-round` (transitional rollback path; no
  current caller in the deployed frontend).
- Defensive cleanup inside `start_round` (closes any open prior round before inserting the new one).
- Called from inside `select_next_song` to close any still-open prior round before a new one is started.

## 3c. `select_next_song`: manager advances to the next round, direct from the browser

Added in migration 022. Called **direct from the manager browser** when the host presses "Next round" or the initial "Start game". Replaces the legacy two-hop flow that went `browser -> FastAPI POST /end-round -> Render -> Supabase` then `browser -> FastAPI POST /select-song -> Render -> Supabase`; collapses it to one direct RPC for ~400ms of latency savings on every round transition.

```sql
CREATE OR REPLACE FUNCTION select_next_song(
  p_game_code      text,
  p_manager_token  uuid,
  p_song_id        uuid DEFAULT NULL   -- NULL = random pick; non-NULL = manual
) RETURNS TABLE(
  round_id      uuid,
  round_number  integer,
  song_id       uuid,
  song_title    text,
  song_artist   text,
  youtube_id    text,
  start_time    integer,
  is_soundtrack boolean,
  source        text
) LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public;
```

Behavior:
- Token + game-state gate runs first (same shape as `award_attempt`): raises `game_not_found` / `game_ended` / `manager_token_required` before any reads of song / round state.
- Then `no_genres_selected` (`22023`) if `selected_genres` is empty.
- Random path: picks an unplayed song from `song_genres` constrained to `selected_genres`. Equal-weight per eligible genre, mirroring `backend/app/services/song_picker.py`. Raises `no_more_songs` (`22023`) when the pool is exhausted.
- Manual path: caller supplies `p_song_id`; validates it exists in `songs`, raises `song_not_found` (`P0002`) otherwise. No "already played in this game" check (matches the legacy REST manual-pick semantics — Restart-song flow).
- Delegates round creation to `start_round`, so the prior round is closed defensively, `round_number` advances, and `active_games.current_round_id` / `current_song_id` are wired up.
- Returns one row with the new round + the picked song's metadata.

### Idempotency

Not idempotent on its own — every call inserts a new round. The composition relies on `start_round`'s defensive close-prior-round step so a stuck-open prior round doesn't block the call.

### Callers

- Manager browser → Supabase PostgREST RPC (`frontend/src/hooks/useSelectNextSong.ts::selectNextSongDirect`). Single caller in the deployed frontend.
- The legacy FastAPI `POST /games/{code}/select-song` endpoint stays as a transitional rollback path; no current caller from the deployed frontend.

## 3a. `award_bonus`: host-discretion bonus to a chosen team

Added in migration 014. Independent of round state and the buzz lock; the host picks any team in the game and grants a positive number of points (default 4). Does not touch `game_rounds`. Called by FastAPI (`POST /games/{code}/bonus`). Not exposed to anon.

```sql
CREATE OR REPLACE FUNCTION award_bonus(
  p_game_code char(6),
  p_team_id   uuid,
  p_points    integer DEFAULT 4
) RETURNS integer  -- new total score for the team
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public;
```

### Error semantics

| Failure | Exception |
|---|---|
| `p_points <= 0` | `P0001 bonus_points_non_positive` |
| Game doesn't exist | `P0002 game_not_found` |
| Game already ended | `P0001 game_already_ended` |
| Team doesn't exist or belongs to a different game | `P0002 team_not_in_game` |

### Idempotency

Not idempotent. Each call adds `p_points` to the team's score. The host is expected to click "+4 Bonus" only when they mean to.

### Callers

- FastAPI `POST /games/{code}/bonus`.

## 4. `end_game`: manager ends the game

Called by FastAPI (`POST /games/{code}/end`). Not exposed to anon.

```sql
CREATE OR REPLACE FUNCTION end_game(p_game_code char(6))
RETURNS timestamptz  -- the ended_at timestamp
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ended_at timestamptz;
  v_status   text;
BEGIN
  SELECT status, ended_at INTO v_status, v_ended_at
    FROM active_games WHERE game_code = p_game_code;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'game_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_status = 'ended' THEN
    RAISE EXCEPTION 'game_already_ended' USING ERRCODE = 'P0001';
  END IF;

  UPDATE active_games
     SET status   = 'ended',
         ended_at = now()
   WHERE game_code = p_game_code
   RETURNING ended_at INTO v_ended_at;

  RETURN v_ended_at;
END $$;

REVOKE ALL ON FUNCTION end_game(char) FROM PUBLIC;
```

### Error semantics

| Failure | Exception |
|---|---|
| Game doesn't exist | `P0002 game_not_found` |
| Game already ended | `P0001 game_already_ended` |

### Idempotency

Not idempotent on the game-state side (raises on repeat call). FastAPI returns 409 to surface this to the manager UI rather than silently no-oping (a no-op would mask a UI bug).

### Side effects

The pg_cron sweeper (§5) will eventually delete the game row. Setting `status = 'ended'` does not trigger immediate deletion; the game and its scoreboard remain queryable until `expires_at` is reached.

### Callers

- FastAPI `POST /games/{code}/end`.

## 5. `cleanup_expired_games`: pg_cron sweeper

Called by `pg_cron` hourly. Not exposed to anyone else.

```sql
CREATE OR REPLACE FUNCTION cleanup_expired_games()
RETURNS integer  -- number of games deleted
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  WITH deleted AS (
    DELETE FROM active_games
     WHERE expires_at < now()
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM deleted;

  RETURN v_count;
END $$;

REVOKE ALL ON FUNCTION cleanup_expired_games() FROM PUBLIC;
```

### Behaviour

Deletes every `active_games` row whose `expires_at` has passed. `game_teams` and `game_rounds` cascade-delete via FK (defined in `data-model.md`).

### Schedule

```sql
SELECT cron.schedule(
  'cleanup-expired-games',
  '0 * * * *',                      -- top of every hour
  $$ SELECT cleanup_expired_games(); $$
);
```

### Observability

Cron run history is in `cron.job_run_details`:

```sql
SELECT jobid, runid, job_pid, database, status, return_message, start_time, end_time
  FROM cron.job_run_details
 WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'cleanup-expired-games')
 ORDER BY start_time DESC LIMIT 10;
```

The `return_message` shows the integer count of deleted games (success) or an error message.

### Failure modes

| Failure | Effect | Mitigation |
|---|---|---|
| pg_cron job paused/disabled | Games accumulate; storage grows | Monitor `cron.job_run_details`; manual `DELETE FROM active_games WHERE expires_at < now();` |
| Cascade delete blocks (lock contention) | Sweep retries next hour | Acceptable; no urgent action |
| pg_cron extension not installed | Sweeper never runs | Phase 3 verifies extension is enabled |

### Testing

```python
# tests/db/test_cron_cleanup.py
async def test_cleanup_deletes_expired(db):
    game_code = await create_test_game(db)
    await db.execute(
        "UPDATE active_games SET expires_at = now() - interval '1 minute' "
        "WHERE game_code = $1", game_code)
    deleted = await db.rpc('cleanup_expired_games')
    assert deleted >= 1
    row = await db.fetchrow(
        "SELECT 1 FROM active_games WHERE game_code = $1", game_code)
    assert row is None
```

## 6. Function ↔ Caller Reference Matrix

| Function | Anon callable? | Service role callable? | Called by |
|---|---|---|---|
| `buzz_in` | ✅ | ✅ | Browser (team page) |
| `award_attempt` | ✅ (token-gated) | ✅ | Browser (manager page) |
| `release_buzz_lock` | ✅ (token-gated) | ✅ | Browser (manager page) |
| `select_next_song` | ✅ (token-gated) | ✅ | Browser (manager page) |
| `start_round` | ❌ | ✅ | Internal call from `select_next_song` |
| `end_round` | ❌ | ✅ | Internal cleanup from `start_round`; FastAPI POST /games/.../end-round (transitional) |
| `award_bonus` | ❌ | ✅ | FastAPI POST /games/.../bonus |
| `end_game` | ❌ | ✅ | FastAPI POST /games/.../end |
| `cleanup_expired_games` | ❌ | ✅ | pg_cron (hourly), manual ops |

The four anon-callable functions all validate authentication inside the
function body (`buzz_in` checks the game-code; the other three check the
per-game `manager_token`). This is what makes anon EXECUTE safe.

## 7. Why Functions, Not Just Direct UPDATEs?

You could implement these in FastAPI as raw SQL UPDATEs. We don't, because:

1. **Atomicity for `buzz_in`**: must be a single statement, server-side. A function is the cleanest way to express "atomic UPDATE + return current state."
2. **Race-free RPC for the browser**: the browser must call `buzz_in` directly to bypass Python cold starts. PostgREST exposes only functions and tables; complex logic needs a function.
3. **Encapsulation**: the function is the contract. Future implementations (e.g., adding tournament mode) can change internals without touching callers.
4. **Single-place enforcement of state-machine rules**: the `IF v_status = 'ended'` checks live in one place, not scattered across HTTP routes.
5. **Server-authoritative timestamps**: `now()` runs in the database, not the application. No clock-skew bugs.

The cost is some PL/pgSQL learning curve for the team. Worth it for the hot-path correctness alone.

## 8. What These Functions Don't Do

- **No authentication checks**. Auth lives at the layer above; RLS for anon, FastAPI's admin middleware for service-role calls.
- **No business-rule validation that depends on external state** (e.g., "is this song already played in this game?"). FastAPI does that before calling the RPC.
- **No transactional bundling beyond their own scope**. Each function is one transaction; cross-function bundling is the caller's job (rare; the boundaries are well-aligned).
- **No long-running work**. All functions complete in single-digit milliseconds.

## 9. Migration Notes

These functions are added in `db/migrations/005_rpc_functions.sql`. To modify a function in production:

1. Write a new migration file (e.g., `006_revise_buzz_in.sql`) with `CREATE OR REPLACE FUNCTION ...`.
2. Apply via `db-migrate` GitHub Actions workflow.
3. Deploy any caller code changes (FastAPI, frontend) to use the new contract.

`CREATE OR REPLACE` is safe for callers; it doesn't break existing transactions. But changing the **return type or parameter list** is a breaking change; coordinate with caller deploys.
