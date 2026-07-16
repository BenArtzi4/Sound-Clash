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
| (none) | `POST /games` | `waiting` | Manager — open hosting (no auth); response returns the game's `manager_token` |
| `waiting` | manager starts game | `playing` (round 1 active) | Manager via `select_next_song` RPC (`manager_token`) |
| `playing` | round complete | `playing` (next round) | Manager via `select_next_song` RPC (`manager_token`) |
| `playing` | manager presses "End game" | `ended` | Manager via `POST /games/{code}/end` (`X-Manager-Token`) |
| any | `expires_at < now()` | (deleted) | `pg_cron` |

Invalid transitions (e.g., `ended` → `playing`) MUST be rejected by the RPC layer.

## 3. Round Lifecycle

Each round is one song. The song carries **two independent claim tokens — TITLE and ARTIST**. Multiple teams can buzz on the same song until both tokens are claimed (or the manager advances). The round's micro-state lives in `active_games` (`buzzed_team_id`, `locked_at`, `current_round_id`) plus the matching `game_rounds` row (`title_claimed_by`, `artist_claimed_by`, `ended_at`).

```
       ┌────────────────────────────────────────────────────────────┐
       │                                                            │
       │                       ┌─────── continue ──────┐            │
       ▼                       │                       │            │
  round starts ──▶ song ──▶ team buzzes ──▶ manager evaluates       │
                            (buzzer locks)                          │
                                  │                                 │
                                  ▼                                 │
                          award_attempt RPC                         │
                          (score, lock cleared)                     │
                                  │                                 │
                                  ├──────  next round ──────────────┘
                                  │
                                  ▼
                          end_round + start_round
                          (new song)
```

### Round events (server-authoritative)

1. **Round starts**: manager picks (or system random-picks) a song; `start_round` RPC defensively closes any prior open round, then clears buzz state and assigns `current_song_id`.
2. **Song plays**: manager controls YouTube IFrame Player.
3. **Buzz**: a team calls `buzz_in` RPC; the first one to satisfy `buzzed_team_id IS NULL` wins. `locked_at` is the server timestamp.
4. **Evaluation**: manager judges the verbal answer. Each verdict button — `Correct Song` (+10), `Correct Artist` (+5), `Wrong` (−3) — fires `award_attempt` **immediately on click**; the score commits the moment the manager clicks. A correct verdict keeps the buzzing team on the floor for the other token and refreshes its 10-second answer countdown (migration 019); a Wrong verdict re-arms the buzzers and resumes the song.
5. **Continue Round**: manager presses "Continue round" to re-open buzzes after a correct verdict — `release_buzz_lock` clears the buzz lock and the song resumes, **leaving the round open**. Other teams (or the same team) can buzz again immediately. No scoring happens here.
6. **Next Round**: manager presses "Next round". (Any held buzz should be scored first via the verdict buttons; Next Round does not auto-score.) `end_round` closes the current round and `start_round` advances to the next song. Any unclaimed tokens are abandoned (no penalty).

### Token claim rules

- `title_claimed_by` and `artist_claimed_by` start NULL each round. The first team that gets the manager to set the corresponding toggle in their `award_attempt` claims it.
- A team that claims a token cannot reclaim it. The manager UI greys out the matching toggle on subsequent buzzes; the backend rejects with `P0001 title_already_claimed` / `artist_already_claimed` if the UI is bypassed.
- Wrong does **not** claim either token. A team can buzz wrong, get -3, and buzz again on the same song.

## 4. Scoring

Per-round point components (locked at MVP, configurable later):

| Component | Points | When awarded |
|---|---|---|
| Correct Song | **+10** | Manager toggles "Correct Song" on a buzz; claims TITLE token |
| Correct Artist | **+5** | Manager toggles "Correct Artist" on a buzz; claims ARTIST token |
| Wrong | **−3** or **0** | Team buzzed but got neither title nor artist right; see free-guess rule below |
| Skip / abandoned token | **0** | Manager advances with one or both tokens unclaimed; no team's score moves |

Maximum per **buzz** from `award_attempt`: **+15** (title + artist together). Minimum per buzz: **−3** (wrong buzz with no prior correct in the round). A round can accumulate multiple buzz outcomes — e.g. T1 wrong → -3, T2 title → +10, T3 artist → +5. The host can also grant a discretionary **+4 Bonus** to any team at any time; see §4a.

### Soundtrack rounds

When the current song belongs to a **soundtrack genre** (`Soundtracks` or `Israeli Soundtracks`), the round plays differently:

- A 🎬 **Soundtrack** badge appears on both the manager and display screens above the song area, so everyone knows the round is a soundtrack round.
- The manager's two scoring buttons collapse into a single **Correct (+15)** button. The team's job is to name the **work** (the film / TV show / game / musical), not the song title — soundtrack trivia in practice means players recognise the show, not the track. Wrong (−3) still applies.
- The single Correct button fires `award_attempt` with **both** correct flags (`p_correct_title` and `p_correct_artist`) so the DB claims both tokens and sums `10 + 5 = 15` — no new RPC, no soundtrack-specific scoring branch in the DB. Since migration 043 the DB derives those magnitudes itself; the client only sends the flags (T7.1).
- On the display, the reveal panel shows a single **🎬 <work name>** row (instead of the separate "🎵 Title" / "🎤 Artist" rows) once the manager confirms. The work name shown is the song's **`artist`** field. On the manager screen the song's `title` also appears as a smaller hint (the clip that's playing, e.g. "Hakuna Matata"), but only when it differs from the work name.

**Admin convention for soundtrack songs**: store the **work name in the `artist` field** (e.g. `artist = "The Lion King"`, `artist = "Star Wars"`) — that's the answer revealed on screen and the thing players must name. Put the **song/clip name in `title`** (e.g. `title = "Hakuna Matata"`, `title = "The Imperial March"`); it's shown only as a host-side hint. When there's no distinct clip name, set `title = artist`. Then **tag the song with the Soundtracks genre** — or **Israeli Soundtracks** for Hebrew film / TV themes, so the host can filter to a Hebrew-only or English-only soundtrack round. That genre tag is the single soundtrack marker: there is no separate per-song flag, checkbox, or `source` column. A song is a soundtrack round purely because it belongs to a soundtrack genre.

### Free-guess rule

After any team scores a correct token in a round, a "free-guess" flag activates for that round. The very next `award_attempt` in that round, if Wrong, costs **0** instead of −3. The flag is consumed by that next attempt regardless of outcome (and re-activates the moment another correct attempt happens). This rewards a team that got one half of the song right — they (or anyone) can risk the other half without paying for being wrong.

- Scope: round-wide. Whichever team buzzes the next attempt benefits, not just the team that scored the prior correct.
- The flag persists only across one attempt. If that attempt is wrong → flag clears. If it's correct → flag stays armed for the attempt after that.
- `start_round` resets the flag for each new song.
- Bonus does **not** activate or consume the flag.

Scores are integers; ties are allowed. The team with the highest score at game end is the winner; tied teams share the win (no tiebreaker round in MVP; see §11).

### Scoring rules

- `Correct Song` and `Correct Artist` are **accumulating toggles** within a single buzz: the host may select either, both, or neither (which is treated as a no-score; the API rejects an attempt with no flags set).
- `Wrong` is **mutually exclusive** with the two correct toggles, both in the UI and in the SQL function (`P0001 wrong_buzz_with_correct`).
- `Correct Song` / `Correct Artist` each fire `award_attempt` immediately on click. The buzzing team keeps the floor for the other token (its answer countdown restarts) until the manager presses `Continue Round` or `Wrong`. Disabled when no buzz is held; the matching toggle also greys out once that token is claimed.
- `Continue Round` calls `release_buzz_lock` (no scoring): it clears the buzz lock and resumes the song, leaving the round open. Disabled when no buzz is held.
- `Wrong` is its own one-click action: it fires `award_attempt` immediately with `wrong_buzz=true` (no Continue Round press needed), re-arms the buzzers, resumes the song, and may waive the −3 per the free-guess rule above.
- `Next Round` advances to the next song: `end_round` closes the current round and `start_round` advances. It does not auto-score a held buzz — the manager should use the verdict buttons first.
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
  - **(a)** clicks "Random song" → browser calls the `select_next_song` PL/pgSQL function direct via Supabase PostgREST RPC; it returns a random song from `songs` filtered by `selected_genres`, **excluding songs already played in this game**, OR
  - **(b)** picks manually from a search/browse UI (out of MVP scope; reserved).
- "No repeats per game" is enforced inside the PL/pgSQL function by joining against `game_rounds` for the current `game_code`.
- **Every eligible song is equally likely — no song has priority** (migration 047, "uniform per song"). A song is eligible if it belongs to *any* selected genre (and passes the optional decade filter and the dead-video skip); the pick is a single uniform random draw over that de-duplicated set. A song tagged in two selected genres is counted **once** (no double-weight), and a small genre does not get out-sized airtime — each genre's share of rounds is just its share of the eligible songs. (Before migration 047 the pick gave each *genre* equal weight — one genre chosen uniformly, then a song within it — which over-represented songs in small genres and songs tagged in multiple selected genres.)
- If all matching songs are exhausted: the function raises `no_more_songs` (sqlstate `22023`); the manager UI surfaces a friendly "All songs in your selected genres have been played" toast.

## 6. Buzzer Rules

- Only one team can hold the lock at a time. The atomic guarantee is in the `buzz_in` PL/pgSQL function (see `rpc-functions.md`).
- The buzz button is enabled only while `active_games.status = 'playing'` AND `buzzed_team_id IS NULL`.
- After lock, the button is disabled for ALL teams until the manager presses "Wrong" (`award_attempt` with `wrong_buzz`), "Continue round" (`release_buzz_lock`), or "Next round" (`select_next_song`) — any of which clears `buzzed_team_id`. A Correct Song / Correct Artist verdict keeps the lock on the buzzing team (so they get the other token) and only refreshes `locked_at`. (Clients don't depend solely on the clearing Realtime event arriving: the Next-round clear is re-derived from the new round's INSERT, and mid-round clears are backstopped at 15s while a lock is held — #254.)
- A team that buzzed wrong (or correct) on the current song is **not** locked out for the remainder of the round; the buzzer re-arms for everyone, including them. The only constraint is that an already-claimed token cannot be re-claimed by anyone.
- The `locked_at` timestamp is server-authoritative. Clients display "X locked it" with no client-side ordering logic.
- Rejected buzz attempts (lock already held) get a quiet UI signal; no error toast, just disabled state.

## 7. Reconnection (teams)

The current Sound Clash has a 15-second grace window for team disconnect. The new design simplifies this:

- A team's identity is `{ game_team_id (uuid), game_code }`. Both are stored in `localStorage` on join.
- On page reload or temporary disconnect, the page reads `localStorage`, re-subscribes to the Realtime channel, and resumes; no server-side state restoration needed.
- If the team's row was deleted, the page distinguishes why before acting: a kick from a live game clears the stored identity and redirects home, while a game that has ended or passed its `expires_at` (the expiry sweep cascade-deletes `game_teams` just before `active_games`) keeps the player on `/team/` and shows the "game has ended or expired" banner **with the final scoreboard** rendered from the last-known state (T4.11 / I-FinalBoard) — the swept player still sees where everyone stood, not a bare line.
- No "reconnect grace period" is enforced. If a team disconnects, the game continues. They can rejoin while the game is `waiting` or `playing`. While the Realtime channel is `reconnecting` mid-game, the BUZZ button stays live — `buzz_in` goes over REST and the DB adjudicates, so a press during a blip is either a normal win or a normal loss (#254).
- If `localStorage` is lost (different device, cleared storage), rejoining with the **same team name** resumes the same team: `POST /games/{code}/teams` reclaims the existing `(game_code, name)` row (same id, preserved score) rather than creating a fresh duplicate (T5.7 / F-P2-1).

## 8. Reconnection (manager)

- Manager identity is "whoever holds the per-game manager token in their browser's localStorage" (`game:<code>:manager-token`). The token is generated at game creation and returned by `POST /games`. Game state is recoverable from the `active_games` row.
- If the manager closes the tab mid-game, the game stays in its current state (`playing`, `buzzed_team_id` still set if mid-buzz). The manager can reload `/manager/game/{code}` in the same browser and resume; the token survives a hard refresh.
- A second device cannot resume management without the token. Losing the host browser ends practical management (the game still runs to its 4-hour TTL; players can keep playing what's already started but no new rounds can be selected without the token).
- **Two manager tabs problem**: opening the same game in two tabs of the same browser shares the token (same localStorage), so both tabs can issue `select_next_song` / `award_attempt` RPCs. Practical impact is low (typical use is one host on one device). Mitigation deferred; see §11.

## 9. Timeouts

### Buzz window timeout

- After `start_round`, if no team buzzes within **20 seconds** (configurable), the manager presses "Next round" without selecting any toggles. With no buzz held, `end_round` runs (closing the current round) and `start_round` loads the next song. No team's score changes.
- The 20-second window is enforced client-side in the manager UI (timer). The server does not auto-timeout.

### Answer-evaluation window

- After buzz lock, the team + display pages show a **10-second answer countdown** derived purely from `active_games.locked_at` (`ANSWER_DURATION_SEC` in the frontend). It is informational/cosmetic — the **server never auto-timeouts**; the manager has unbounded time to listen and evaluate, and nothing happens when the countdown hits zero.
- The countdown **restarts** when the manager marks a Correct Song / Correct Artist: `award_attempt` keeps the same team on the floor for the other token but sets `locked_at = now()` (migration 019), so the floor-holding team gets a fresh 10 seconds for the remaining half. A Wrong clears the lock (countdown disappears until the next buzz); Continue Round clears the lock too.

## 10. Game Expiration & TTL

- `active_games.expires_at = now() + interval '4 hours'`, stamped at game **creation** — lobby time counts against it.
- **Host extension (T4.8, migration 039)**: in the last ~20 minutes before the game would be swept, the manager console shows a warning banner with a **Keep playing +1h** action (there is no standing "Ends at" hint outside that window). Each press calls the token-gated `extend_game` RPC, which sets `expires_at = GREATEST(expires_at, now()) + 1 hour`. Repeat presses stack; an ended game can't be extended. The banner (and action) also covers a game that has overrun its `expires_at` but hasn't been swept yet.
- `pg_cron` runs `cleanup_expired_games()` hourly: `DELETE FROM active_games WHERE expires_at < now()`.
- `game_teams` and `game_rounds` cascade-delete via FK.
- **Mid-game truncation**: a marathon session running >4 hours from start, whose host never extends, will be deleted while still in `playing` state. The frontend handles this by detecting the rows vanishing (Realtime DELETE events) and showing a "game has ended or expired" banner in place on every client — no navigation; the team page in particular distinguishes this teardown from a kick (see §7). Every client also keeps the **final scoreboard** from its last-known snapshot under the banner (T4.11 / I-FinalBoard); the manager additionally keeps the song export, which still resolves because the `songs` catalog is durable. This is an accepted limitation; documented for users.

## 11. Edge Cases & Open Questions

| Scenario | Behaviour | Status |
|---|---|---|
| All teams disconnect mid-round | Game stays in `playing`. Manager can wait or end the game. No auto-pause. | Defined |
| Manager disconnects | Game stays in current state. Recoverable via reload. | Defined |
| Manager presses "End game" mid-round | `end_game` RPC runs; current round is left without `ended_at`; scoreboard shows current scores. | Defined |
| Tied final scores | Multiple teams shown as "winner"; no tiebreaker round. | Defined for MVP |
| Same team name joined twice | Reclaims the existing team (same id, preserved score) instead of erroring — the "player refreshed / lost their tab" recovery path (T5.7 / F-P2-1). `UNIQUE (game_code, name)` is the race backstop. | Defined |
| Empty team name / 100-char team name | Rejected at API layer; min 1 char, max 30 chars. | Defined |
| Game created with no genres | Rejected at API layer; min 1 genre required. | Defined |
| Manager restarts the same song | "Restart song" button calls `select_next_song` with a manual `p_song_id`. Buzz state cleared. Old round row remains as a no-points-awarded artifact. | Defined |
| Two manager tabs open | Both work. Last write wins. | Accepted limitation; future presence-based detection |
| Network partition splits some teams from Supabase | Affected teams freeze. They reconnect and re-subscribe. Game state is server-authoritative; UI reconciles on reconnect. | Defined |
| User opens browser DevTools and calls `buzz_in` directly | Allowed by RLS. Functionally equivalent to pressing the button. Not a security issue. | Accepted |
| User tries to call `award_attempt` / `release_buzz_lock` / `select_next_song` from the browser with the wrong `p_manager_token` | Blocked: the function raises `manager_token_required` (sqlstate `28000`) before any side effect. The token is a 128-bit uuid and effectively unguessable. | Enforced inside the SECURITY DEFINER function body |
| User tries to call `start_round` / `end_round` / `end_game` / `award_bonus` directly | Blocked: only `service_role` can execute them. The browser only has the anon key. | Enforced via RLS / explicit REVOKE (migration 020) |
| Tiebreaker round | Out of MVP. Manager declares tied result manually. | Future |
| Song play_count / popularity | Out of MVP. Game data is ephemeral; cannot accumulate stats without a separate durable counter. | Future |
| Bonus rounds, lightning round, double-or-nothing | Out of MVP. | Future |

## 12. UX Constraints (informational, for frontend work)

- Buzz button must respond in **<100ms** of tap (UI feedback): the actual lock confirmation comes via Realtime in <200ms. Optimistic UI: button shows "buzzing…" immediately, then "locked!" or "too slow" once the Realtime row update arrives.
- Display screen must be readable at 3+ meters (large fonts; high contrast). The leaderboard shows only the **top 5 teams** (ranked by score, ties broken by earlier `joined_at`); a "+N more teams playing" line names how many are off the board (issue #179).
- Team page should work on iOS Safari and Chrome Android. iPhone SE viewport is the smallest supported size. Each player's own **place + score** is shown on their buzzer screen from the moment they join (the waiting screen included) — just the place (e.g. "#3"), using the same dense ranking as the Display board and final screen (tied teams share a place) so it matches the board row exactly — and it updates live on every score change, so a team off the top-5 board always knows where it stands.
- No notifications, no permissions prompts.

## 13. What is NOT a Game Rule

For clarity; these are out of scope and explicitly NOT enforced by the system:

- Players' real identities (no accounts, no profiles)
- Team chat
- Voice/video communication between teams
- Streaming the manager's screen for remote teams (use Zoom)
- Anti-cheating (Shazam detection, audio fingerprinting on team device)
- Practice mode / single player
