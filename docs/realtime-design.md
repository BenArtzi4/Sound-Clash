# Sound Clash: Realtime Design

This is the central design document of the rewrite. It describes how the system achieves <200ms buzzer latency on a free-tier infrastructure that has no always-on Python WebSocket server. Every other doc references this one for the details below.

## 1. The Problem in One Paragraph

A buzzer game is hard to build on free hosting because the buzzer needs:
1. **Atomic single-winner ordering**: when two teams tap within milliseconds, exactly one wins.
2. **Server-authoritative timestamps**: clients can't be trusted to order themselves.
3. **Low fan-out latency**: all clients see the lock within ~200ms of the press.
4. **Always-available endpoint**: no cold starts in the press path.

Free-tier Python (Render free / Cloud Run scale-to-zero) violates #4 with multi-second cold starts. Free-tier WebSocket platforms either limit connections (Pusher: 100) or burn through quotas. The current architecture (FastAPI WebSocket service in-process broadcast) cannot cost-effectively run 24/7 for free.

## 2. The Resolution: Take Python Out of the Hot Path

| Concern | Old (FastAPI WS) | New (Supabase Realtime + Postgres RPC) |
|---|---|---|
| Atomic lock | Python in-memory `if buzzed_team is None` check | Postgres conditional UPDATE: `WHERE buzzed_team_id IS NULL` |
| Timestamp authority | Python `datetime.utcnow()` | Postgres `now()` |
| Fan-out | `asyncio.gather(send_to_each_client)` | Postgres replication → Supabase Realtime |
| Endpoint availability | Always-on Python WS server | Supabase PostgREST (always on, no cold start) |
| Hot-path latency | ~50–200ms (with warm process) | ~80–180ms (RTT-bound) |
| Idle cost | $$ per month | $0 |

The browser calls Postgres directly via PostgREST; Python is never in the buzz path.

## 3. The Hot Path, Step by Step

```
┌────────────┐  1. supabase.rpc('buzz_in', { p_game_code, p_team_id })
│ Browser    │ ─────────────────────────────────────────────────────────┐
│ (team tab) │                                                          │
└────────────┘                                                          ▼
                                                          ┌──────────────────────┐
                                                          │  Supabase PostgREST  │
                                                          │  /rest/v1/rpc/buzz_in│
                                                          └──────────┬───────────┘
                                                                     │
                                                                     ▼
                                                  ┌────────────────────────────────────┐
                                                  │  Postgres: buzz_in() PL/pgSQL       │
                                                  │  UPDATE active_games               │
                                                  │     SET buzzed_team_id = p_team_id, │
                                                  │         locked_at = now()          │
                                                  │   WHERE game_code = p_game_code    │
                                                  │     AND status = 'playing'         │
                                                  │     AND buzzed_team_id IS NULL     │
                                                  │  RETURNING ...                     │
                                                  └────────────────┬───────────────────┘
                                                                   │  (row replicated)
                                                                   ▼
                                              ┌──────────────────────────────────────┐
                                              │  Supabase Realtime broadcast         │
                                              │  postgres_changes event              │
                                              └────┬──────────────┬──────────────┬───┘
                                                   │              │              │
                                                   ▼              ▼              ▼
                                             ┌─────────┐    ┌─────────┐    ┌─────────┐
                                             │ Manager │    │ Display │    │ Other   │
                                             │ tab     │    │ tab     │    │ teams   │
                                             └─────────┘    └─────────┘    └─────────┘
```

### Latency budget (typical, EU user → eu-central-1 Supabase)

| Hop | Time | Notes |
|---|---|---|
| Browser → Supabase TLS handshake (reused) | 0–10 ms | Connection kept alive |
| Browser → Supabase API RTT | 30–60 ms | Geographic |
| PostgREST dispatch + UPDATE | 5–15 ms | In-memory MVCC, single row |
| Replication slot pickup | 10–30 ms | Realtime worker polls slot |
| Realtime → other subscribers | 30–80 ms | WebSocket fan-out |
| **Caller round-trip** | **45–85 ms** | Buzzer team sees confirmation |
| **Other clients see lock** | **75–195 ms** | Fan-out total |

**Worst-case acceptable**: ~250ms in adverse network conditions. **Hard fail threshold**: >500ms; investigate.

## 4. Race Correctness

### Why the conditional UPDATE is atomic

Postgres MVCC + row-level locking guarantees:

1. Two concurrent calls to `buzz_in(p_game_code='ABCDEF', ...)` both attempt to UPDATE the same row.
2. Postgres acquires a row lock. The first transaction proceeds; the second blocks.
3. The first sees `buzzed_team_id IS NULL`, sets it to its team, commits. Lock released.
4. The second now reads the post-commit snapshot: `buzzed_team_id` is non-null. The `WHERE buzzed_team_id IS NULL` predicate matches zero rows. UPDATE returns "0 rows affected."
5. The PL/pgSQL function detects this via `IF NOT FOUND` and returns `locked: false` with the current holder.

This is well-trodden Postgres territory. No advisory locks, no `SELECT FOR UPDATE`, no application-level coordination needed.

### Stress test (Phase 3 exit criterion)

```python
# tests/db/test_buzz_in_race.py
async def test_concurrent_buzz_one_winner():
    game_code = await create_test_game()
    team_ids = [await create_test_team(game_code) for _ in range(10)]
    results = await asyncio.gather(*[
        rpc_buzz_in(game_code, team_id) for team_id in team_ids
    ])
    winners = [r for r in results if r["locked"]]
    assert len(winners) == 1
```

This test is required to pass 100 consecutive runs before merging Phase 3.

### Why the rest of the system trusts MVCC

`start_round`, `award_points`, `end_game` all use single-row UPDATEs on `active_games`. They serialize on the same row lock as `buzz_in`. The consequence: if a manager calls `start_round` at the same nanosecond a team calls `buzz_in`, one wins and the other sees the post-commit state. Either ordering is valid because both operations are intent-level commands the manager would resolve manually.

## 5. Subscribing to Game State

Each browser opens **one Realtime channel per game** and subscribes to three table change streams (filtered by `game_code`):

- `active_games`: the live game row (status, current round, buzz state)
- `game_teams`: team list and scores
- `game_rounds`: round history (used for "song already played" enforcement and the round info card)

The frontend reduces these change streams into a derived state object:

```ts
interface GameState {
  game: ActiveGame;            // active_games row
  teams: Map<string, Team>;    // keyed by team id
  rounds: GameRound[];         // sorted by round_number
  currentRound: GameRound | null;  // resolved from game.current_round_id
}
```

State updates are applied in the order Realtime delivers events. Postgres replication is ordered per row, but cross-table ordering is not guaranteed. The frontend's reducer is idempotent: applying the same event twice is a no-op.

## 6. Initial State and Reconciliation

When a client subscribes, it does NOT automatically receive a snapshot of current state; Realtime only forwards future changes. Therefore:

```ts
// 1. Subscribe (sets up the channel; will start receiving events)
const channel = supabase.channel(`game:${gameCode}`).on(...).on(...).on(...);

// 2. Wait for SUBSCRIBED status
channel.subscribe(async (status) => {
  if (status !== 'SUBSCRIBED') return;

  // 3. Now fetch the current state. Any events that happened between
  //    SUBSCRIBED and this fetch will be applied via the reducer when
  //    they arrive (idempotent), so no race window.
  const game = await supabase.from('active_games')
    .select('*, game_teams(*), game_rounds(*)')
    .eq('game_code', gameCode)
    .single();
  initState(game.data);
});
```

The order matters: subscribe first, then fetch. If we fetched first then subscribed, events between fetch and subscribe would be lost.

## 7. Reconnection

`supabase-js` reconnects automatically with exponential backoff (1s, 2s, 4s, ..., capped). On reconnect, it re-establishes the WebSocket and resubscribes existing channels. Missed events during disconnect are NOT replayed; Realtime is not durable.

The recovery strategy:

1. On WebSocket reconnect, the frontend re-fetches the full game state (same query as initial fetch).
2. The reducer overwrites local state with the fresh fetch.
3. Future events apply on top.

**Disconnect signaling**: while disconnected, the team UI shows a non-blocking banner ("reconnecting…"). The buzz button is disabled (because the lock state is stale). Once reconnected, normal operation resumes.

### Team identity persistence

A team's identity = `{ game_team_id (uuid), game_code, name }`. Stored in `localStorage`:

```js
localStorage.setItem(`game:${gameCode}:team`, JSON.stringify({ id, name }));
```

On page reload, the team page reads `localStorage`, validates that the team still exists in `game_teams` (via SELECT), and resumes. If the team row was deleted (kicked or game expired), the page redirects to the join screen.

## 8. Time Synchronization

Server-authoritative `locked_at` is the source of truth. But for client-side timer countdowns (e.g., the 20-second buzz window), the client needs a way to convert "server time" into "wall-clock progress on this device."

Strategy: **measure the offset once per session, then trust it.**

```ts
// On first connection or first event with a server timestamp:
const serverNow = new Date(realtimeEvent.commit_timestamp);
const clientNow = new Date();
const offset = serverNow.getTime() - clientNow.getTime();  // ms

// Anywhere we need "now in server time":
function serverTimeNow(): Date {
  return new Date(Date.now() + offset);
}
```

For the buzz window timer:
```ts
const elapsedMs = serverTimeNow().getTime() - new Date(round.started_at).getTime();
const remainingMs = Math.max(0, 20_000 - elapsedMs);
```

Offset accuracy is within ~50ms (one half-RTT to Supabase). Good enough for a 20-second timer.

## 9. YouTube IFrame Player Race

The YouTube IFrame Player loads asynchronously. If a `start_round` event arrives before the player is ready, the song doesn't play.

Mitigation: gate the round-active UI behind a `playerReady` boolean.

```ts
const [playerReady, setPlayerReady] = useState(false);
const [pendingSongLoad, setPendingSongLoad] = useState<{youtube_id: string, start_time: number} | null>(null);

// On player ready:
function onPlayerReady() {
  setPlayerReady(true);
  if (pendingSongLoad) {
    player.loadVideoById(pendingSongLoad.youtube_id, pendingSongLoad.start_time);
    setPendingSongLoad(null);
  }
}

// On round started (Realtime event):
function onRoundStarted(round) {
  if (playerReady) {
    player.loadVideoById(round.song.youtube_id, round.song.start_time);
  } else {
    setPendingSongLoad(round.song);  // play when ready
  }
}
```

The manager UI also disables the "Start round" button until the player reports ready.

## 10. Failure Modes & Mitigations

| Failure | Detection | Mitigation |
|---|---|---|
| Realtime disconnects | `channel.subscribe` callback gets `CLOSED`/`CHANNEL_ERROR` | Show "reconnecting…" banner; disable buzzer; `supabase-js` auto-reconnects |
| `buzz_in` RPC times out | Promise rejects after 10s timeout | Show "buzz failed, try again"; do NOT retry automatically (could double-press) |
| `buzz_in` returns network error | Same | Same |
| Postgres slow query (rare) | RPC RTT > 500ms | Logged client-side via Sentry; investigate; not user-recoverable |
| Realtime quota exhausted | Channel subscribe fails with quota error | Fail-loud at game-creation time (not mid-game); manager sees "service at capacity" |
| Render is cold | First request to FastAPI takes ~30s | UI shows "creating game…" spinner; only happens on game creation, not during play (manager scoring went direct to Postgres in migration 021) |
| FastAPI is down | API call returns 5xx | Game creation impossible; existing games keep working — Realtime + the browser-direct RPCs (`buzz_in`, `award_attempt`, `release_buzz_lock`) are independent of FastAPI, so an entire game including scoring can run with the dyno cold or unreachable, as long as the host's tab already loaded |
| Supabase project is down | Everything fails | Game-day DR: nothing; this is the single point of failure. Free tier accepts this. |

## 11. Single-Manager Invariant

Two browser tabs both authenticated as manager → both can issue admin actions → race conditions at the application level (e.g., two simultaneous `start_round` calls advance round_number twice).

The MVP accepts this and documents it. Mitigation when revisited:

- Use Realtime **presence** to detect multiple manager tabs on the same game.
- The first to subscribe (oldest presence) is the "active manager." Subsequent tabs see a banner "another manager is active; click here to take over." Taking over revokes the old tab's controls (via a Realtime broadcast).

This is non-trivial UX and is explicitly out of MVP. Today the invariant is "the host runs one tab."

## 12. Why Not Approach X?

| Alternative | Why rejected |
|---|---|
| Pusher Channels | 100-connection limit too tight for parallel games; Python still needed for atomic claim → still need warm Python |
| Cloudflare Durable Objects | Requires a JavaScript runtime; user requested Python primary |
| Run Python on Fly.io | Free tier requires CC and is being phased out; long-term free not guaranteed |
| Run Python on Oracle Always Free | Genuine free always-on VM; viable but adds ops burden (own VM, own monitoring, own SSL): Supabase + Render is lower ops cost |
| AWS AppSync | Not free tier above small caps; AWS lock-in is what we're moving away from |
| Roll our own WebSocket on Cloudflare Workers | Reinvents Realtime; Durable Objects already exist; not Python |

The chosen design optimizes for: free, low-ops, Python-friendly, <200ms buzzer. Supabase Realtime + PL/pgSQL satisfies all four.

## 13. Performance Monitoring

Production observability for the hot path:

- **Client-side** (Sentry browser SDK): record `buzz_in` RPC duration as a custom transaction; sample 100% during MVP.
- **Server-side** (Postgres): log slow queries (`log_min_duration_statement = 100`); review `pg_stat_statements` for `buzz_in` p95.
- **Realtime metrics** (Supabase dashboard): connection count, message rate, message lag.

Alert thresholds:
- `buzz_in` RTT p95 > 250ms for 5 minutes → investigate.
- Realtime message lag > 500ms → investigate.
- Sentry rate of `buzz_failed` errors > 1% → investigate.

These are tracked in `runbook.md` and `free-tier-budget.md`.
