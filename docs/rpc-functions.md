# Sound Clash: Postgres RPC Functions

The twelve PL/pgSQL functions that hold the system's logic. Each is callable as a Postgres function and exposed via Supabase PostgREST RPC. Together they encode every state-changing operation in the game.

Functions live in `db/migrations/005_rpc_functions.sql` (the original five), `db/migrations/014_scoring_revamp.sql` (added `award_bonus`, retired `source/timeout` shape of the old award function), `db/migrations/016_multi_buzz_rounds.sql` (replaced the one-shot `award_points` with multi-buzz `award_attempt` + `end_round`), `db/migrations/018_split_attempt_release.sql` (split scoring from buzz-lock release: added `release_buzz_lock` and scoped `award_attempt`'s lock-clear to the wrong-buzz path), `db/migrations/019_refresh_locked_at_on_correct.sql` (`award_attempt` refreshes `locked_at` on a correct attempt so the floor-holding team's answer countdown restarts for the remaining token), `db/migrations/035_buzz_in_drop_round_update.sql` (dropped the now-dead `game_rounds.buzzed_team_id` mirror-write from `buzz_in` to halve buzz-path Realtime fan-out), `db/migrations/036_award_attempt_collapse_writes.sql` (collapsed `award_attempt`'s per-round writes into one combined `UPDATE … RETURNING`), `db/migrations/039_extend_game.sql` (added `extend_game`, the token-gated TTL bump behind the manager console's expiry warning banner), `db/migrations/043_award_attempt_boolean_overload.sql` (T7.1: added a boolean overload of `award_attempt` that derives the point magnitudes server-side, alongside the integer one), and `db/migrations/044_drop_award_attempt_integer_overload.sql` (dropped the integer overload once the boolean-sending frontend had soaked, leaving the boolean signature as the sole `award_attempt` overload).

## 0. Conventions

- All functions use `SECURITY DEFINER` so they run with the table-owner's privileges (allowing them to bypass RLS for their own writes). Anon callers can only invoke functions that have been explicitly `GRANT EXECUTE ... TO anon`'d.
- Functions are idempotent where the data model allows (see per-function notes).
- Error returns use Postgres exception codes: `P0001` for application errors, `P0002` for "no_data_found".
- Functions are named with `snake_case`. Parameter names prefixed with `p_`.
- Return types are explicit `TABLE(...)` for multi-column results; void for fire-and-forget ops.

## 1. `buzz_in`: atomic buzzer claim

The hot path. Called by browsers via PostgREST. <100ms RTT.

```sql
-- Current body as of migration 041. Migration 035 dropped the dead
-- game_rounds.buzzed_team_id mirror-write (mig 011, for the since-retired
-- award_points), and migration 041 added the EXISTS membership predicate so a
-- team that does not belong to p_game_code can never win the lock (cross-game
-- score-write guard; see security-rls.md §4 and award_bonus's team_not_in_game).
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
  v_locked_at timestamptz;
BEGIN
  -- Atomic conditional UPDATE on active_games. Only the first concurrent caller
  -- to satisfy buzzed_team_id IS NULL wins. RETURNING captures the resulting
  -- locked_at for the function's return value. The EXISTS predicate scopes the
  -- claim to a team that is a member of this game.
  UPDATE active_games ag
     SET buzzed_team_id = p_team_id,
         locked_at      = now()
   WHERE ag.game_code = p_game_code
     AND ag.status = 'playing'
     AND ag.buzzed_team_id IS NULL
     AND EXISTS (
       SELECT 1 FROM game_teams gt
        WHERE gt.id = p_team_id AND gt.game_code = p_game_code
     )
  RETURNING ag.locked_at INTO v_locked_at;

  IF FOUND THEN
    RETURN QUERY SELECT true, p_team_id, v_locked_at;
  ELSE
    -- Lock already held, game not playable, or team not a member of this game;
    -- return current state so the caller can reconcile its UI.
    RETURN QUERY
    SELECT false, ag.buzzed_team_id, ag.locked_at
      FROM active_games ag
     WHERE ag.game_code = p_game_code;
  END IF;
END $$;

REVOKE ALL ON FUNCTION buzz_in(char, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION buzz_in(char, uuid) TO anon;
```

The lock lives **only** on `active_games` (`buzzed_team_id` + `locked_at`). `game_rounds.buzzed_team_id` is a vestigial nullable column, no longer written by any function (see `data-model.md §4`).

A `p_team_id` that isn't a member of `p_game_code` (i.e. a team from another game) can **never** win the lock: the `EXISTS` membership predicate (mig 041) fails the UPDATE, so the call falls through to the "already locked / not playable" return path. This closes a cross-game score-write vector — see `security-rls.md §4`.

### Race correctness

Postgres MVCC + row-level locking guarantees only one concurrent caller can satisfy `buzzed_team_id IS NULL`. See `realtime-design.md` §4 for the full argument.

### Error semantics

| Caller's input | Function returns |
|---|---|
| Valid call, lock available | `(locked=true, locked_team_id=<their id>, locked_at=<now>)` |
| Valid call, lock already held | `(locked=false, locked_team_id=<other team>, locked_at=<earlier>)` |
| `p_team_id` isn't a member of `p_game_code` (nonexistent, or belongs to another game) | UPDATE matches 0 rows (the `EXISTS` membership predicate fails; mig 041); returns `(locked=false, ...)` with the game's current lock state. A foreign team can't be planted into the lock. **Caller is still responsible** for sending its own team id (frontend reads from its localStorage). |
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

Called only from inside `select_next_song` (§3c) — there is no longer a
direct caller. The function stays service-role-only and is not exposed to
anon; `select_next_song` invokes it under SECURITY DEFINER privileges.
Historically called by FastAPI's `POST /games/{code}/select-song`, which
was retired in the dead-code cleanup once the direct-RPC path stabilised.

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

- `select_next_song` (§3c) invokes `start_round` internally; that's the only caller in the running system.

## 3. `award_attempt`: manager scores one buzz (multi-buzz model)

Called **direct from the manager browser** via Supabase PostgREST RPC (as of migration 021). Replaces the old FastAPI `POST /games/{code}/attempt` endpoint; removing the Render hop drops manager-action latency from ~400-600ms to ~150ms. The function takes the per-game `manager_token` as its last argument and validates it before any side effect, so anon EXECUTE is safe here the same way it is for `buzz_in`. Replaces the older `award_points` (migration 016). `award_attempt` does **not** close the round — a round can accept many `award_attempt` calls (one per buzz) until the manager calls `end_round` (or `start_round` for the next song defensively closes it).

```sql
CREATE OR REPLACE FUNCTION award_attempt(
  p_game_code      text,
  p_round_id       uuid,
  p_correct_title  boolean,            -- claim the TITLE token (+10, derived server-side)
  p_correct_artist boolean,            -- claim the ARTIST token (+5, derived server-side)
  p_wrong          boolean,            -- wrong buzz (−3, derived server-side; free-guess may waive it)
  p_manager_token  uuid                -- NONE of the 6 args carry a DEFAULT: a default would make the overload ambiguous (Postgres 42725); see mig 021. The frontend always sends all six.
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

**Scoring authority is in the DB (migration 043, T7.1 / D-7).** The client sends
only booleans; the function derives the magnitudes itself (`+10 / +5 / −3`), so a
tampered browser can no longer POST an arbitrary point value. Soundtrack rounds
stay emergent — the UI sends **both** correct flags and the function sums
`10 + 5 = 15` as two independent claims (no soundtrack awareness in the DB).

> **Rollout history (dual overload → boolean-only).** Migration 043 **added**
> this boolean signature **alongside** the legacy integer one
> (`award_attempt(text, uuid, integer, integer, integer, uuid)`, mig 036, which
> took the magnitudes as client integers), so the migration could be applied to
> prod decoupled from the frontend deploy — a still-loaded old tab routed to the
> integer overload, a freshly deployed tab to the boolean one, PostgREST
> resolving by the distinct named-arg set (`p_correct_title/p_correct_artist/
> p_wrong` vs `p_title/p_artist/p_wrong_buzz`). Once the boolean-sending frontend
> (PR #218) had soaked, **migration 044** dropped the integer overload (mirrors
> mig 023), leaving this boolean signature as the **sole** `award_attempt`
> overload.

Token check (run before any other read/write):
- Fetch `ended_at` from `active_games` (LEFT JOIN `game_secrets` for `manager_token`) for the code. Since migration 034 the token lives in `game_secrets`, not `active_games`. Missing game row → `P0002 game_not_found`. Ended → `P0001 game_ended`. Mismatched or NULL token → `28000 manager_token_required`.

Behavior:
- Derives the point magnitudes from the flags server-side: `p_correct_title → 10`, `p_correct_artist → 5`, `p_wrong → 3` (a NULL flag is treated as false). Nothing on the wire carries a magnitude.
- Reads the current `buzzed_team_id` off `active_games`. If null → raises `P0001 no_buzz_to_score`.
- `p_wrong AND (p_correct_title OR p_correct_artist)` → raises `P0001 wrong_buzz_with_correct`.
- `p_correct_title` while `title_claimed_by` is already set → raises `P0001 title_already_claimed`. Same shape for `artist_already_claimed`.
- On success: applies score delta to the buzzed team, marks `title_claimed_by` / `artist_claimed_by` if applicable, and inserts a `game_round_attempts` row.
- **Write shape** (migration 036): all per-round column changes (title/artist claim + points, `wrong_buzz_penalty`, `free_guess_active`) are committed in **one** combined `UPDATE game_rounds` computed from branch vars via `CASE` (each unchanged column keeps its value); the statement is **skipped entirely** when nothing changes (no toggles, no wrong, `free_guess_active` unchanged), so a no-op Continue emits zero `game_rounds` writes. The team-score read and the returned claim columns fold into `RETURNING` (the score UPDATE's on the scoring path, the combined UPDATE's for the claims) rather than trailing `SELECT`s. This is a pure Realtime/round-trip economy change — a Correct Song emits one `ROUND_CHANGE` instead of two — with identical scoring behavior.
- **Buzz-lock handling** (migration 018, refined by migration 019): only the wrong-buzz path clears `active_games.buzzed_team_id` and `locked_at`. A correct `title` / `artist` / `title_artist` attempt leaves `buzzed_team_id` in place — the answering team retains the floor for the other token until the manager presses Continue (`release_buzz_lock`) or Wrong, or until `start_round` defensively clears the lock for the next song — but it **refreshes `locked_at = now()`** so the clients' answer countdown restarts for the remaining token (migration 019). The no-op continue case (no toggles, no `wrong_buzz`) leaves the lock untouched. Before 018 the lock was always cleared regardless of outcome.
- **Free-guess flag** (`game_rounds.free_guess_active`, migration 017): if `p_wrong` AND `free_guess_active = true`, the penalty is waived (`points_delta = 0`); the attempt is still recorded with `outcome = 'wrong'`. After processing, the function sets `free_guess_active = true` if the outcome was correct (`title` / `artist` / `title_artist`) and `false` otherwise. So the flag is consumed by every attempt and re-armed by every correct one.

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
- Validates `p_manager_token` against `game_secrets.manager_token` (LEFT JOIN from `active_games`; migration 034 moved the token off `active_games`). Same error matrix as `award_attempt`: `game_not_found` / `game_ended` / `manager_token_required`.
- Then: `UPDATE active_games SET buzzed_team_id = NULL, locked_at = NULL WHERE game_code = p_game_code`. That's the entire post-check body.
- No-op (post-check) if no buzz is held; never raises a "nothing to release" error.

### Idempotency

Idempotent on the unlock side: safe to call any number of times once authorized.

### Callers

- Manager browser → Supabase PostgREST RPC (`frontend/src/hooks/useManagerActions.ts::releaseBuzzLockDirect`).

## 3b. `end_round`: closes a round (internal-only)

Called only from inside `start_round`'s defensive prior-round close, which
in turn is invoked by `select_next_song` (§3c). Not exposed to anon and no
longer reachable from any HTTP endpoint. Sets `game_rounds.ended_at` and
clears any lingering buzz lock. Idempotent; safe to call repeatedly.

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

- Defensive cleanup inside `start_round` (closes any open prior round before inserting the new one).
- Indirectly via `select_next_song`, which calls `start_round`.

## 3c. `select_next_song`: manager advances to the next round, direct from the browser

Added in migration 022. Called **direct from the manager browser** when the host presses "Next round" or the initial "Start game". Replaces the legacy two-hop flow that went `browser -> FastAPI POST /end-round -> Render -> Supabase` then `browser -> FastAPI POST /select-song -> Render -> Supabase`; collapses it to one direct RPC for ~400ms of latency savings on every round transition. The two REST endpoints it replaced were removed in the post-stabilisation dead-code cleanup.

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
  is_soundtrack boolean
) LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public;
```

Behavior:
- Token + game-state gate runs first (same shape as `award_attempt`): raises `game_not_found` / `game_ended` / `manager_token_required` before any reads of song / round state.
- Then `no_genres_selected` (`22023`) if `selected_genres` is empty.
- Random path: picks an unplayed song from `song_genres` constrained to `selected_genres`. Equal-weight per eligible genre, picked via Postgres `random()` in a CTE. Raises `no_more_songs` (`22023`) when the pool is exhausted. (Historically this logic lived in `backend/app/services/song_picker.py`, removed in the dead-code cleanup.)
- **Decade filter (migration 032):** when `active_games.selected_decades` is non-empty, the `eligible` CTE additionally requires `(songs.release_year / 10 * 10) = ANY(selected_decades)` — the song's decade must be one the host chose. The empty default imposes no year limit. A `NULL` `release_year` matches no specific decade, so unknown-year songs are excluded when a decade is selected and included when none is. `selected_decades` is optional; only `selected_genres` is required.
- **Dead-video auto-skip (migration 045):** the `eligible` CTE also requires `songs.unavailable_at IS NULL`, so a video the availability scan confirmed dead (see §5b) is never randomly picked — an all-flagged pool raises the same `no_more_songs`.
- Manual path: caller supplies `p_song_id`; validates it exists in `songs`, raises `song_not_found` (`P0002`) otherwise. No "already played in this game" check (matches the legacy REST manual-pick semantics — Restart-song flow), and **no `unavailable_at` filter** — a host forcing a specific song (the peek commit / a restart) is a deliberate act.
- Delegates round creation to `start_round`, so the prior round is closed defensively, `round_number` advances, and `active_games.current_round_id` / `current_song_id` are wired up.
- Returns one row with the new round + the picked song's metadata.
- The returned `is_soundtrack` flag is **computed** (migration 028), not read from a column — `songs.is_soundtrack` was dropped. It is `EXISTS(SELECT 1 FROM song_genres sg JOIN genres g ON g.id = sg.genre_id WHERE sg.song_id = <picked> AND g.slug IN ('soundtracks', 'israeli-soundtracks'))`, i.e. true when the song belongs to a soundtrack genre. The `RETURNS TABLE` shape is unchanged, so PostgREST routing and the realtime/frontend contract are identical.

### Idempotency

Not idempotent on its own — every call inserts a new round. The composition relies on `start_round`'s defensive close-prior-round step so a stuck-open prior round doesn't block the call.

### Callers

- Manager browser → Supabase PostgREST RPC (`frontend/src/hooks/useSelectNextSong.ts::selectNextSongDirect`). Single caller in the deployed system.

## 3d. `peek_next_song`: read-only "what would the next random song be?"

Added in migration 029. Called **direct from the manager browser** during the current round so the host's hidden second YouTube player can **prebuffer** the upcoming video. Production traces showed ~89% of the click→audio-playing time is YouTube's own buffering (`game.song_start.load_to_playing`); because `select_next_song` picks randomly at click time there is nothing to preload in advance, so this probe runs the same picker without committing.

```sql
CREATE OR REPLACE FUNCTION peek_next_song(
  p_game_code      text,
  p_manager_token  uuid
) RETURNS TABLE(
  song_id       uuid,
  youtube_id    text,
  start_time    integer,
  song_title    text,     -- migration 038 (I-NextMeta)
  song_artist   text,     -- migration 038 (I-NextMeta)
  is_soundtrack boolean   -- migration 038 (I-NextMeta); computed, same as select_next_song
) LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public;
```

Behavior:
- Token + game-state gate runs first, **identical** to `select_next_song`: raises `game_not_found` (`P0002`) / `game_ended` (`P0001`) / `manager_token_required` (`28000`) / `no_genres_selected` (`22023`) before returning any candidate.
- Runs the **same** unplayed-song random picker as `select_next_song`'s random path (exclude already-played, bucket by selected genre, random genre then random song) — including the decade filter (migration 032) and the dead-video auto-skip (migration 045, `unavailable_at IS NULL`), kept in lockstep so a peeked candidate is never one the eventual commit would reject and a prebuffered video is never a dead one.
- **Read-only**: no `start_round`, no `game_rounds` insert, no `active_games` mutation — calling it repeatedly never advances the game.
- **Returns the candidate's metadata** (migration 038): `song_title` / `song_artist` and the computed `is_soundtrack` (same `EXISTS` over soundtrack genres as `select_next_song §3c`), so the manager's Next-round fast path can render the new song's card **in-gesture** from the already-peeked row instead of showing the previous title until `select_next_song` resolves.
- **Pool exhausted → returns zero rows, not an error.** The browser treats "no row" as "nothing to prebuffer"; the real `no_more_songs` still surfaces from the eventual `select_next_song` commit.
- On the actual "Next round" click the browser commits the peeked song via `select_next_song(..., p_song_id => <peeked id>)` (manual-pick path), so the buffered video and the started round can never disagree.

### Idempotency

Idempotent and side-effect-free (read-only). Migration 038 added the metadata columns, which changes the return type, so that migration `DROP`s then re-`CREATE`s the function (a bare `CREATE OR REPLACE` cannot change a function's return type) and re-`GRANT`s EXECUTE.

### Callers

- Manager browser → Supabase PostgREST RPC (`frontend/src/hooks/usePeekNextSong.ts::peekNextSongDirect`). Single caller in the deployed system.

## 3e. `extend_game`: host pushes the 4-hour TTL out

Added in migration 039 (T4.8 / I-Expiry). Called **direct from the manager browser** when the host clicks **Keep playing +1h** in the console's expiry warning banner (shown in the last ~20 minutes before `expires_at`, and kept up for a game that has overrun its `expires_at` but hasn't been swept yet — the sweep is hourly).

```sql
CREATE OR REPLACE FUNCTION extend_game(
  p_game_code     text,
  p_manager_token uuid
) RETURNS timestamptz  -- the new expires_at
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public;
```

Behavior:
- Token + game-state gate runs first, identical to `award_attempt` (mig 034 shape, `LEFT JOIN game_secrets`): raises `game_not_found` (`P0002`) / `game_ended` (`P0001`) / `manager_token_required` (`28000`) before the write.
- Sets `expires_at = GREATEST(expires_at, now()) + interval '1 hour'`. The `GREATEST` matters for an overdue-but-unswept game: the host gets a real hour from now, not a stale hour that is already partly consumed.
- The bump size is **fixed server-side** — there is no caller-supplied interval to abuse.
- A `waiting` (lobby) game is extendable: the TTL runs from creation, so a long lobby is exactly when the extension is needed. An `ended` game is refused (`game_ended`) — it sits on its final scoreboard until the sweep.
- No cap on repeat calls: only the token-holding host can extend, the game is their own, and the sweep resumes the moment they stop.
- The `UPDATE` on `active_games` fans out over Realtime (`expires_at` is in the subscribed column set), so every client's countdown moves without extra plumbing.

### Error semantics

| Failure | Exception |
|---|---|
| Game doesn't exist | `P0002 game_not_found` |
| Game already ended | `P0001 game_ended` |
| Bad/missing token | `28000 manager_token_required` |

### Idempotency

Not idempotent — each call adds another hour. The manager UI disables the banner button from click until the bumped `expires_at` arrives over Realtime, so a double-tap can't stack an unintended second hour.

### Callers

- Manager browser → Supabase PostgREST RPC (`frontend/src/hooks/useManagerActions.ts::extendGameDirect`). Single caller in the deployed system.

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

Called by FastAPI (`POST /games/{code}/end`). Not exposed to anon. As of migration 033 it also snapshots the game into durable history (`archive_game`, §5a) before flipping the status.

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

  -- Snapshot to durable history before marking ended (mig 033). Idempotent and
  -- skips 0-round games; the cast bridges char(6) -> text.
  PERFORM archive_game(p_game_code::text);

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

Writes the durable history snapshot via `archive_game` (§5a) in the same transaction — so a finished game is preserved even though its live rows are swept ~4h later. The pg_cron sweeper (§5) will eventually delete the live game row; setting `status = 'ended'` does not trigger immediate deletion, so the game and its scoreboard remain queryable until `expires_at` is reached. Because the archive runs *before* the status flip, a failed archive aborts the whole transaction and the game stays un-ended (the host can retry) rather than ending up "ended but unarchived".

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
  -- Archive every expiring game to durable history before deleting (mig 033).
  -- archive_game is idempotent and skips 0-round games, so games already
  -- archived by end_game are no-oped and abandoned-but-played games are caught.
  PERFORM archive_game(ag.game_code)
     FROM active_games ag
    WHERE ag.expires_at < now();

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

Archives every expiring game into durable history (`archive_game`, §5a), then deletes every `active_games` row whose `expires_at` has passed. `game_teams` and `game_rounds` cascade-delete via FK (defined in `data-model.md`). The archive + delete run in one transaction, so a game is never deleted without first being archived (a 0-round game is simply skipped by the archiver and deleted).

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

## 5a. `archive_game`: snapshot a finished game into durable history

Added in migration 033. Internal-only (no HTTP caller, not exposed to anon): invoked by `end_game` (§4) and `cleanup_expired_games` (§5). Copies a game's metadata, teams + final scores, and the ordered, **denormalized** song list into the durable `game_history*` tables so a finished game survives the 4h sweep. The denormalized `song_title`/`song_artist`/`youtube_id` are the canonical record — they don't change if the catalog song is later edited or deleted (the soft `song_id` FK then goes NULL via `ON DELETE SET NULL`).

```sql
CREATE OR REPLACE FUNCTION archive_game(p_game_code text)
RETURNS uuid  -- the game_history.id (existing or new), or NULL if skipped
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_started_at timestamptz; v_ended_at timestamptz;
  v_genres uuid[]; v_decades integer[];
  v_round_cnt integer; v_team_cnt integer; v_history_id uuid;
BEGIN
  SELECT ag.started_at, ag.ended_at, ag.selected_genres, ag.selected_decades
    INTO v_started_at, v_ended_at, v_genres, v_decades
    FROM active_games ag WHERE ag.game_code = p_game_code;
  IF NOT FOUND THEN RETURN NULL; END IF;                  -- already swept / never existed

  SELECT count(*) INTO v_round_cnt FROM game_rounds WHERE game_code = p_game_code;
  IF v_round_cnt = 0 THEN RETURN NULL; END IF;            -- nothing worth keeping

  SELECT gh.id INTO v_history_id FROM game_history gh
   WHERE gh.game_code = p_game_code AND gh.started_at = v_started_at;
  IF FOUND THEN RETURN v_history_id; END IF;              -- idempotent: already archived

  SELECT count(*) INTO v_team_cnt FROM game_teams WHERE game_code = p_game_code;

  INSERT INTO game_history (game_code, started_at, ended_at, round_count,
                            selected_genres, selected_decades, team_count)
  VALUES (p_game_code, v_started_at, COALESCE(v_ended_at, now()), v_round_cnt,
          v_genres, v_decades, v_team_cnt)
  ON CONFLICT ON CONSTRAINT game_history_code_started_key DO NOTHING  -- concurrent-race backstop
  RETURNING id INTO v_history_id;
  IF v_history_id IS NULL THEN                            -- lost the race; re-read and bail
    SELECT gh.id INTO v_history_id FROM game_history gh
     WHERE gh.game_code = p_game_code AND gh.started_at = v_started_at;
    RETURN v_history_id;
  END IF;

  INSERT INTO game_history_teams (game_history_id, name, score, joined_at)
  SELECT v_history_id, gt.name, gt.score, gt.joined_at
    FROM game_teams gt WHERE gt.game_code = p_game_code;

  INSERT INTO game_history_songs (game_history_id, round_number, song_id,
                                  song_title, song_artist, youtube_id, start_time)
  SELECT v_history_id, gr.round_number, gr.song_id,
         COALESCE(s.title, '(deleted song)'), COALESCE(s.artist, ''),
         COALESCE(s.youtube_id::text, ''), COALESCE(s.start_time, 0)
    FROM game_rounds gr LEFT JOIN songs s ON s.id = gr.song_id
   WHERE gr.game_code = p_game_code ORDER BY gr.round_number;

  RETURN v_history_id;
END $$;

-- Service-role only (mirror migration 020 lock-down).
REVOKE ALL ON FUNCTION archive_game(text) FROM PUBLIC;
-- (033 also REVOKEs EXECUTE from anon/authenticated and GRANTs it to service_role.)
```

### Error semantics

Never raises. Returns `NULL` (a no-op) when the game doesn't exist or played 0 rounds; returns the existing `game_history.id` when already archived; otherwise the new id. This lets both callers `PERFORM archive_game(...)` unconditionally.

### Idempotency

Idempotent on `(game_code, started_at)` — the existence check short-circuits a repeat call, and the `ON CONFLICT DO NOTHING` on the unique constraint is a backstop for the (vanishingly rare) concurrent end-game/sweep race. `game_code` alone is **not** unique over time (codes recycle after the TTL), which is why the key includes `started_at`.

### Callers

- `end_game` (§4) — before flipping status to `ended`.
- `cleanup_expired_games` (§5) — for every expiring game, before the delete.

## 5b. `set_song_availability`: persist dead-video scan verdicts

Added in migration 045 (I-Liveness Phase 2, issue #248). Service-role only — called by
`POST /admin/songs/check-availability` when the admin scan runs with `commit=true`
(`backend/app/routers/admin_songs.py::_apply_verdicts_blocking`). Writes the
`songs.unavailable_at` flag that the auto-pickers (§3c random path, §3d) filter on, so a
confirmed-dead YouTube video never reaches a round.

```sql
CREATE OR REPLACE FUNCTION set_song_availability(
  p_flag_ids  uuid[],   -- oEmbed 404 verdicts: flag as unavailable
  p_clear_ids uuid[]    -- oEmbed 200 verdicts: restore to playable
) RETURNS TABLE(flagged integer, cleared integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public;
```

Behavior:
- Flagging sets `unavailable_at = now()` **only where it is currently `NULL`** — the
  timestamp records when the video was *first* confirmed dead, and a re-scan
  doesn't rewrite (or bump) already-flagged rows.
- Clearing sets `unavailable_at = NULL` **only where it is currently `NOT NULL`** — a
  restored (or transiently-404ing) video becomes eligible again; this self-healing is why
  a transient 404 can't permanently bury a good song.
- Ambiguous scan verdicts (`401`/`400`/`5xx`/timeout → `unknown`) are never passed in by
  the caller — the endpoint only sends definitive `404`s as `p_flag_ids` and `200`s as
  `p_clear_ids`.
- Returns the counts of rows **actually changed** (surfaced as `flagged`/`cleared` in the
  endpoint's response). `NULL`/empty arrays are no-ops; unknown ids are ignored.
- No parameter DEFAULTs (mig-021 lesson: keep PostgREST named-arg routing unambiguous).

### Idempotency

Idempotent: re-flagging an already-flagged song or re-clearing an already-clear one changes
nothing and counts zero.

### Callers

- FastAPI `POST /admin/songs/check-availability` with `commit=true` (admin-gated) — run
  manually by the operator, and on a schedule once the separate weekly dead-video-scan
  GitHub Actions cron ships (`.github/workflows/dead-video-scan.yml`, its own flagged PR).
  Migration 045 REVOKEs EXECUTE from anon/authenticated (an anon grant would let anyone
  bury the whole catalog) and GRANTs it to service_role, per the migration-020 pattern.

## 6. Function ↔ Caller Reference Matrix

| Function | Anon callable? | Service role callable? | Called by |
|---|---|---|---|
| `buzz_in` | ✅ | ✅ | Browser (team page) |
| `award_attempt` | ✅ (token-gated) | ✅ | Browser (manager page) |
| `release_buzz_lock` | ✅ (token-gated) | ✅ | Browser (manager page) |
| `select_next_song` | ✅ (token-gated) | ✅ | Browser (manager page) |
| `peek_next_song` | ✅ (token-gated, read-only) | ✅ | Browser (manager page) |
| `extend_game` | ✅ (token-gated) | ✅ | Browser (manager page) |
| `start_round` | ❌ | ✅ | Internal call from `select_next_song`. No HTTP caller. |
| `end_round` | ❌ | ✅ | Internal cleanup from `start_round` (which `select_next_song` invokes). No HTTP caller. |
| `award_bonus` | ❌ | ✅ | FastAPI POST /games/.../bonus |
| `end_game` | ❌ | ✅ | FastAPI POST /games/.../end |
| `cleanup_expired_games` | ❌ | ✅ | pg_cron (hourly), manual ops |
| `archive_game` | ❌ | ✅ | Internal call from `end_game` + `cleanup_expired_games`. No HTTP caller. |
| `set_song_availability` | ❌ | ✅ | FastAPI POST /admin/songs/check-availability with `commit=true` |

The six anon-callable functions all validate authentication inside the
function body (`buzz_in` checks the game-code; the other five check the
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
