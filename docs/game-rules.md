# Sound Clash: Game Rules

This is the canonical specification of how the game is played. Other docs reference this one for behaviour. If a rule conflicts with another document, this doc wins.

## 1. Roles

| Role | What they do | Per game |
|---|---|---|
| **Manager (host)** | Creates the game, picks genres, advances rounds, judges answers | exactly 1 |
| **Team** | Joins by game code, presses buzzer, gives verbal answer | 1 to N (N typically 2–8) |
| **Display** | Public scoreboard / "TV screen" | 0 to many (read-only) |

The manager and display are typically separate physical screens (laptop + TV). Teams are typically phones in players' hands.

## 2. Game Lifecycle (state machine)

```
        ┌──────────┐  manager creates    ┌──────────┐
        │  (none)  │ ─────────────────▶  │ waiting  │
        └──────────┘                     └────┬─────┘
                                              │ manager presses "Start game"
                                              │ (≥ 1 team must have joined)
                                              ▼
                          ┌────────────┐  manager: next round
                  ┌─────▶ │  playing   │ ─────────────┐
                  │       └─────┬──────┘              │
                  │             │ all rounds done OR  │ (loops per round)
                  │             │ manager: end game   │
                  │             ▼                     │
                  │       ┌────────────┐              │
                  └───────┤   ended    │◀─────────────┘
                          └────────────┘
                                │
                                │ pg_cron sweep (≥4h after started_at)
                                ▼
                            (deleted)
```

### State transitions (authoritative)

| From | Event | To | Performed by |
|---|---|---|---|
| (none) | `POST /games` | `waiting` | Manager (admin auth) |
| `waiting` | manager starts game | `playing` (round 1 active) | Manager (admin auth) |
| `playing` | round complete | `playing` (next round) | Manager (admin auth) |
| `playing` | manager presses "End game" | `ended` | Manager (admin auth) |
| any | `expires_at < now()` | (deleted) | `pg_cron` |

Invalid transitions (e.g., `ended` → `playing`) MUST be rejected by the RPC layer.

## 3. Round Lifecycle

Each round is one song. The round's micro-state is encoded in `active_games` (`buzzed_team_id`, `locked_at`, `current_round_id`) plus the matching `game_rounds` row.

```
   round_started ──▶ song playing ──▶ team buzzes ──▶ buzzer_locked
                                                            │
                                                            ▼
                                                    manager evaluates
                                                            │
                       ┌───── timeout (no buzz) ──┐         │
                       │                          ▼         ▼
                       │                  next_round  or  award_points
                       │                                    │
                       └────────────────────────────────────┘
```

### Round events (server-authoritative)

1. **Round starts**: manager picks (or system random-picks) a song; `start_round` RPC clears prior buzz state and assigns `current_song_id`.
2. **Song plays**: manager controls YouTube IFrame Player.
3. **Buzz**: first team to call `buzz_in` RPC wins; `locked_at` is the server timestamp.
4. **Evaluation**: manager judges the buzzing team's verbal answer and awards points per component (or a timeout penalty).
5. **Round ends**: `award_points` RPC writes the result and clears buzz state for the next round.

## 4. Scoring

Per-round point components (locked at MVP, configurable later):

| Component | Points | When awarded |
|---|---|---|
| Correct Song | **+10** | Manager judges the song title correct |
| Correct Artist | **+5** | Manager judges the artist correct |
| Wrong | **−3** | Team buzzed but got neither title nor artist right |
| Timeout | **0** | Round ends with no buzz; no team's score moves |

Maximum per round from `award_points`: **+15** (title + artist correct). Minimum: **−3** (wrong buzz). The host can also award a discretionary **+4 Bonus** to any team at any time; see §4a.

Scores are integers; ties are allowed. The team with the highest score at game end is the winner; tied teams share the win (no tiebreaker round in MVP; see §11).

### Scoring rules

- `Correct Song` and `Correct Artist` are **accumulating toggles**: the host may select either, both, or neither.
- `Wrong` is **mutually exclusive** with the two correct toggles, both in the UI and in the SQL function (`P0001 wrong_buzz_with_correct`).
- `End Round` finalizes whatever is toggled. With no toggles selected and a buzzed team, the round ends with zero score change.
- `End Round` with no buzz sends `timeout=true`: round ends, no score change.
- Negative team scores are allowed.
- The manager cannot retroactively change a previous round's score in MVP. (Future: an "edit last round" undo flow.)

## 4a. Bonus

A separate manager action, independent of round and buzz state.

- Anytime during a `playing` or `waiting` game, the manager can press **+4 Bonus** in the console.
- A team picker appears listing every team currently in the game. The manager picks one, and that team's score gains **+4** (configurable via the API; the UI uses the default).
- The bonus does **not** end a round, does not touch `game_rounds`, and is not visible in the round-detail breakdown; only in the team's running `game_teams.score`.
- Endpoint: `POST /games/{code}/bonus` (see `api-contracts.md §2.6`). Function: `award_bonus` (see `rpc-functions.md §3a`).

## 5. Song Selection

- Songs come from the `songs` catalog. Manager picks `selected_genres` at game-creation time.
- For each round, the manager either:
  - **(a)** clicks "Random song" → backend `POST /games/{code}/select-song` returns a random song from `songs` filtered by `selected_genres`, **excluding songs already played in this game**, OR
  - **(b)** picks manually from a search/browse UI (out of MVP scope; reserved).
- "No repeats per game" is enforced at the API layer by joining against `game_rounds` for the current `game_code`.
- If all matching songs are exhausted: backend returns 409 with a clear error; manager must add more genres or end the game.

## 6. Buzzer Rules

- Only one team can hold the lock at a time. The atomic guarantee is in the `buzz_in` PL/pgSQL function (see `rpc-functions.md`).
- The buzz button is enabled only while `active_games.status = 'playing'` AND `buzzed_team_id IS NULL`.
- After lock, the button is disabled for ALL teams until the manager either awards points or restarts the song.
- The `locked_at` timestamp is server-authoritative. Clients display "X locked it" with no client-side ordering logic.
- Rejected buzz attempts (lock already held) get a quiet UI signal; no error toast, just disabled state.

## 7. Reconnection (teams)

The current Sound Clash has a 15-second grace window for team disconnect. The new design simplifies this:

- A team's identity is `{ game_team_id (uuid), game_code }`. Both are stored in `localStorage` on join.
- On page reload or temporary disconnect, the page reads `localStorage`, re-subscribes to the Realtime channel, and resumes; no server-side state restoration needed.
- If the team's row was deleted (e.g., game expired or the manager kicked them), the page redirects to the join screen with a message.
- No "reconnect grace period" is enforced. If a team disconnects, the game continues. They can rejoin while the game is `waiting` or `playing`.

## 8. Reconnection (manager)

- Manager identity is "whoever holds the per-game manager token in their browser's localStorage" (`game:<code>:manager-token`). The token is generated at game creation and returned by `POST /games`. Game state is recoverable from the `active_games` row.
- If the manager closes the tab mid-game, the game stays in its current state (`playing`, `buzzed_team_id` still set if mid-buzz). The manager can reload `/manager/game/{code}` in the same browser and resume; the token survives a hard refresh.
- A second device cannot resume management without the token. Losing the host browser ends practical management (the game still runs to its 4-hour TTL; players can keep playing what's already started but no new rounds can be selected without the token).
- **Two manager tabs problem**: opening the same game in two tabs of the same browser shares the token (same localStorage), so both tabs can issue `start_round` / `award_points` RPCs. Practical impact is low (typical use is one host on one device). Mitigation deferred; see §11.

## 9. Timeouts

### Buzz window timeout

- After `start_round`, if no team buzzes within **20 seconds** (configurable), the manager UI shows a "no one buzzed" prompt and the manager presses "End round" with no toggles set → `award_points` is called with `p_timeout = 1` (or all-zero scoring args), the round ends, and no team's score changes. The earlier `-2` timeout penalty was removed in migration 014 because it never actually landed on any team (the SQL guard prevented it) and its UX value was negative.
- The 20-second window is enforced client-side in the manager UI (timer). The server does not auto-timeout.

### Answer-evaluation window

- After buzz lock, the manager has unbounded time to listen and evaluate. No server timeout.
- (Future: optional 10-second answer countdown for tournament mode; out of MVP.)

## 10. Game Expiration & TTL

- `active_games.expires_at = started_at + interval '4 hours'` (fixed at game creation).
- `pg_cron` runs `cleanup_expired_games()` hourly: `DELETE FROM active_games WHERE expires_at < now()`.
- `game_teams` and `game_rounds` cascade-delete via FK.
- **Mid-game truncation**: a marathon session running >4 hours from start will be deleted while still in `playing` state. The frontend handles this by detecting the row vanishing (Realtime DELETE event) and redirecting all clients to a "game expired" page. This is an accepted limitation; documented for users.

## 11. Edge Cases & Open Questions

| Scenario | Behaviour | Status |
|---|---|---|
| All teams disconnect mid-round | Game stays in `playing`. Manager can wait or end the game. No auto-pause. | Defined |
| Manager disconnects | Game stays in current state. Recoverable via reload. | Defined |
| Manager presses "End game" mid-round | `end_game` RPC runs; current round is left without `ended_at`; scoreboard shows current scores. | Defined |
| Tied final scores | Multiple teams shown as "winner"; no tiebreaker round. | Defined for MVP |
| Same team name joined twice | Rejected by `UNIQUE (game_code, name)`. UI shows clear error. | Defined |
| Empty team name / 100-char team name | Rejected at API layer; min 1 char, max 30 chars. | Defined |
| Game created with no genres | Rejected at API layer; min 1 genre required. | Defined |
| Manager restarts the same song | "Restart song" button calls `start_round` RPC again with the same `song_id`. Buzz state cleared. Old round row remains as a no-points-awarded artifact. | Defined |
| Two manager tabs open | Both work. Last write wins. | Accepted limitation; future presence-based detection |
| Network partition splits some teams from Supabase | Affected teams freeze. They reconnect and re-subscribe. Game state is server-authoritative; UI reconciles on reconnect. | Defined |
| User opens browser DevTools and calls `buzz_in` directly | Allowed by RLS. Functionally equivalent to pressing the button. Not a security issue. | Accepted |
| User tries to call `award_points` from the browser | Blocked: only `service_role` can execute it. The browser only has the anon key. | Enforced via RLS |
| Tiebreaker round | Out of MVP. Manager declares tied result manually. | Future |
| Song play_count / popularity | Out of MVP. Game data is ephemeral; cannot accumulate stats without a separate durable counter. | Future |
| Bonus rounds, lightning round, double-or-nothing | Out of MVP. | Future |

## 12. UX Constraints (informational, for frontend work)

- Buzz button must respond in **<100ms** of tap (UI feedback): the actual lock confirmation comes via Realtime in <200ms. Optimistic UI: button shows "buzzing…" immediately, then "locked!" or "too slow" once the Realtime row update arrives.
- Display screen must be readable at 3+ meters (large fonts; high contrast).
- Team page should work on iOS Safari and Chrome Android. iPhone SE viewport is the smallest supported size.
- No notifications, no permissions prompts.

## 13. What is NOT a Game Rule

For clarity; these are out of scope and explicitly NOT enforced by the system:

- Players' real identities (no accounts, no profiles)
- Team chat
- Voice/video communication between teams
- Streaming the manager's screen for remote teams (use Zoom)
- Anti-cheating (Shazam detection, audio fingerprinting on team device)
- Practice mode / single player
