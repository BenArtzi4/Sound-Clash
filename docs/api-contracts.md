# Sound Clash: API Contracts

This is the wire-format contract between the frontend and the backend (FastAPI on Render + Supabase). It is the document the frontend codes against and the backend implements. Drift between this doc and reality is a bug.

## 1. Overview

Three categories of API:

| Category | Transport | Endpoint | Authn |
|---|---|---|---|
| **REST (FastAPI)** | HTTPS | `https://api.soundclash.org` | `X-Manager-Token` for `/games/{code}/*` host actions; `X-Admin-Password` for `/admin/songs/*`; nothing for game creation, joining, or `/genres` |
| **Postgres RPC (PostgREST)** | HTTPS | `https://<project>.supabase.co/rest/v1/rpc/<fn>` | Supabase **anon key** in `apikey` + `Authorization` headers |
| **Realtime (Supabase)** | WebSocket | `wss://<project>.supabase.co/realtime/v1` | Supabase **anon key** |

All payloads are JSON. All timestamps are ISO 8601 UTC with `Z` suffix (e.g., `2026-05-03T14:23:01.234Z`).

All responses include the conventional fields:
- Success: HTTP 2xx + body specified per endpoint.
- Error: HTTP 4xx/5xx + `{ "error": "<machine_code>", "message": "<human readable>", "details": <optional> }`.

Canonical error codes: `validation_error`, `unauthorized`, `forbidden`, `not_found`, `conflict`, `gone`, `rate_limited`, `internal_error`.

---

## 2. REST Endpoints (FastAPI)

### 2.1 `GET /health`

Liveness probe. No auth.

**Response 200**:
```json
{ "status": "ok", "version": "<git_sha>", "supabase": "ok" }
```

`supabase` is `"ok"` if the server can reach Supabase, `"degraded"` otherwise (still 200; the server is up).

---

### 2.2 `POST /games`

Create a new game. **No auth.** Anyone can host. Rate-limited 10/min/IP.

**Request body**:
```json
{
  "selected_genres": ["<genre_uuid>", "..."]
}
```

Validation:
- `selected_genres`: at least 1 genre UUID

Games run for as many rounds as the host wants and end only when the host calls `POST /games/{code}/end`. There is no per-game round limit.

**Response 201**:
```json
{
  "game_code": "ABCDEF",
  "status": "waiting",
  "selected_genres": ["..."],
  "started_at": "2026-05-03T14:23:01.234Z",
  "expires_at": "2026-05-03T18:23:01.234Z",
  "manager_token": "1f1a2b3c-4d5e-6f70-8190-a1b2c3d4e5f6"
}
```

The `manager_token` is generated server-side (`gen_random_uuid()`) and is the host's credential for every other `/games/{code}/*` call. The host's browser stores it in `localStorage` under `game:<code>:manager-token` and presents it as `X-Manager-Token` on `select-song`, `attempt`, `end-round`, `bonus`, `end`, and `kick-team`. The token never leaves the host's device.

Game-code generation: 6 chars from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (no 0/O, 1/I/L, no lowercase). On collision (UNIQUE violation), retry up to 5 times then 500.

**Errors**: `validation_error` (400), `rate_limited` (429).

---

### 2.3 `POST /games/{game_code}/teams`

Team joins a game. **No auth.** Anyone with the game code can call this.

**Request body**:
```json
{ "name": "Team Awesome" }
```

Validation:
- `name`: 1–30 chars, trimmed; no leading/trailing whitespace; uniqueness within the game enforced by UNIQUE constraint.

**Response 201**:
```json
{
  "id": "<team_uuid>",
  "game_code": "ABCDEF",
  "name": "Team Awesome",
  "score": 0,
  "joined_at": "2026-05-03T14:25:11.000Z"
}
```

The frontend stores `id` in `localStorage` keyed by `game_code` for reconnection.

**Errors**: `validation_error` (400; bad name), `not_found` (404; game doesn't exist), `gone` (410; game expired or ended), `conflict` (409; name already taken).

---

### 2.4 `POST /games/{game_code}/select-song`

Manager: pick the next song (random within `selected_genres`, excluding songs already played in this game) and start the round. **Manager-token auth required.**

**Headers**: `X-Manager-Token: <token>` (the value returned by `POST /games`)

**Request body**: `{}` (reserved; future may include `song_id` for manual pick)

**Response 200**:
```json
{
  "round_id": "<round_uuid>",
  "round_number": 3,
  "song": {
    "id": "<song_uuid>",
    "title": "Song Title",
    "artist": "Artist Name",
    "youtube_id": "dQw4w9WgXcQ",
    "start_time": 30,
    "is_soundtrack": false,
    "source": null
  }
}
```

Server-side: calls Postgres `start_round(p_game_code, p_song_id)` RPC. Returns the new round id.

**Errors**: `unauthorized` (401), `not_found` (404), `gone` (410), `conflict` (409; game not in `playing` state, or all songs in selected genres exhausted).

---

### 2.5 Scoring an attempt — direct Postgres RPC (no FastAPI hop)

Migration 021 moved scoring off FastAPI: the manager browser calls the
``award_attempt`` PL/pgSQL function directly via Supabase PostgREST, the
same way the buzzer calls ``buzz_in``. Removing the Render round-trip drops
manager-action latency from ~400-600ms to ~150ms.

The function takes the per-game `manager_token` as its last argument and
validates it (constant comparison on a fixed-width uuid) before performing
any side effect. See `docs/rpc-functions.md §3` for the full signature and
`docs/security-rls.md §2` for the auth model.

```ts
const { data, error } = await supabase.rpc("award_attempt", {
  p_game_code: gameCode,
  p_round_id: roundId,
  p_title: titleCorrect ? 10 : 0,
  p_artist: artistCorrect ? 5 : 0,
  p_wrong_buzz: wrongBuzz ? 3 : 0,
  p_manager_token: managerToken,
});
```

Frontend wrapper: `frontend/src/hooks/useManagerActions.ts::awardAttemptDirect`
(boolean → integer translation + shape normalisation).

**Behavior**:
- `p_title = 10` → +10 to the buzzed team; claims the TITLE token.
- `p_artist = 5` → +5 to the buzzed team; claims the ARTIST token.
- Both → +15 in one shot (claims both tokens).
- `p_wrong_buzz = 3` → −3 to the buzzed team. Mutually exclusive with the two above; if a token was already claimed earlier in the round the SQL function waives the penalty (free-guess rule, migration 017).
- The buzz lock is **only** cleared on the wrong-buzz path. A correct attempt leaves `active_games.buzzed_team_id` and `locked_at` in place — the answering team retains the floor for the other token until the manager presses Continue or Next round.

**Errors** (raised as PostgrestError with the named code in `message`):
- `manager_token_required` (sqlstate `28000`) — bad/missing token.
- `game_not_found` (sqlstate `P0002`) — game code unknown.
- `game_ended` (sqlstate `P0001`) — game already ended.
- `round_not_found` (sqlstate `P0002`), `round_already_ended` (P0001), `no_buzz_to_score` (P0001), `title_already_claimed` / `artist_already_claimed` (P0001), `wrong_buzz_with_correct` (P0001).

---

### 2.5a Releasing the buzz lock — direct Postgres RPC

Manager presses Continue (resume the song without scoring). Same direct-RPC
pattern as 2.5; the function checks the manager token internally.

```ts
const { error } = await supabase.rpc("release_buzz_lock", {
  p_game_code: gameCode,
  p_manager_token: managerToken,
});
```

Frontend wrapper: `frontend/src/hooks/useManagerActions.ts::releaseBuzzLockDirect`.

Idempotent: safe to call when no buzz is held. Errors mirror 2.5 (token / game lookup).

---

### 2.5b `POST /games/{game_code}/end-round`

Manager: close the current round (advance to "Next round"). Idempotent. **Manager-token auth required.**

**Headers**: `X-Manager-Token: <token>`

**Request body**:
```json
{ "round_id": "<round_uuid>" }
```

**Response 200**:
```json
{
  "round_id": "<round_uuid>",
  "ended_at": "<timestamptz>"
}
```

Server-side: calls Postgres `end_round` RPC. Stamps `game_rounds.ended_at` and clears any held buzz lock. Calling on an already-ended round is a no-op (returns the existing `ended_at`).

**Errors**: `unauthorized` (401), `not_found` (404; round doesn't exist).

---

### 2.6 `POST /games/{game_code}/bonus`

Manager: award a discretionary bonus to any team in the game. Independent of round state and the buzz lock; the host picks the team. **Manager-token auth required.**

**Headers**: `X-Manager-Token: <token>`

**Request body**:
```json
{
  "team_id": "<team_uuid>",
  "points": 4
}
```

`points` is optional and defaults to `4`. Must be `>= 1`.

**Response 200**:
```json
{
  "team_id": "<team_uuid>",
  "points_awarded": 4,
  "team_total_score": 18
}
```

Server-side: calls Postgres `award_bonus` RPC. Does not touch round state.

**Errors**: `unauthorized` (401), `not_found` (404; team not in this game, or game does not exist), `conflict` (409; game already ended), `validation_error` (422; non-positive `points`).

---

### 2.7 `POST /games/{game_code}/end`

Manager: end the game manually. **Manager-token auth required.**

**Headers**: `X-Manager-Token: <token>`

**Response 200**:
```json
{
  "game_code": "ABCDEF",
  "status": "ended",
  "ended_at": "2026-05-03T15:48:00.000Z"
}
```

**Errors**: `unauthorized` (401), `not_found` (404), `conflict` (409; already ended).

---

### 2.8 `DELETE /games/{game_code}/teams/{team_id}`

Manager: kick a team. **Manager-token auth required.**

**Headers**: `X-Manager-Token: <token>`

**Response 204** (no body).

Cascade: any future actions by the kicked team are rejected because their row is gone. Their browser detects the Realtime DELETE event and redirects to a "you've been kicked" screen.

**Errors**: `unauthorized` (401), `not_found` (404).

---

### 2.9 `GET /genres`

Public. List all genres.

**Response 200**:
```json
[
  { "id": "<uuid>", "name": "Rock", "slug": "rock" },
  { "id": "<uuid>", "name": "Pop",  "slug": "pop"  }
]
```

---

### 2.10 Admin Songs CRUD

All under `/admin/songs/*`. **Admin-password auth required** on every endpoint (`X-Admin-Password` header). This is the only surface that still uses the global admin password; game hosting is open.

| Method | Path | Purpose |
|---|---|---|
| `GET`    | `/admin/songs` | List songs (paginated, `?page=1&per_page=50&search=&genre=`) |
| `GET`    | `/admin/songs/{id}` | Get one song |
| `POST`   | `/admin/songs` | Create a song (body: `title, artist, youtube_id, start_time, is_soundtrack, source, genre_ids[]`) |
| `PUT`    | `/admin/songs/{id}` | Update a song (full replacement; partial use PATCH if needed later) |
| `DELETE` | `/admin/songs/{id}` | Delete a song (cascades to `song_genres`) |
| `POST`   | `/admin/songs/bulk-import` | Multipart CSV upload; columns: `title, artist, youtube_id, start_time, is_soundtrack, source, genres` (semicolon-separated genre slugs) |

Bulk import is idempotent on `youtube_id`: existing songs are updated, new ones are inserted.

---

## 3. Postgres RPC (PostgREST)

Called by the **browser** with the anon key. Only one function is exposed to anon: `buzz_in`.

### 3.1 `POST /rest/v1/rpc/buzz_in`

**Headers**:
- `apikey: <SUPABASE_ANON_KEY>`
- `Authorization: Bearer <SUPABASE_ANON_KEY>`
- `Content-Type: application/json`

**Body**:
```json
{ "p_game_code": "ABCDEF", "p_team_id": "<team_uuid>" }
```

**Response 200** (single-row return; PostgREST returns an array):
```json
[
  { "locked": true, "locked_team_id": "<team_uuid>", "locked_at": "2026-05-03T14:30:12.123Z" }
]
```

- `locked: true` → this caller won the lock.
- `locked: false` → the lock was already held; `locked_team_id` is whoever holds it.

This call must complete in <100ms (RTT to Supabase). Fan-out to other clients via Realtime takes another ~50–100ms.

**Errors**: PostgREST returns 4xx with `code`, `message`, `hint`. Treat anything non-200 as "buzz failed; refresh state from Realtime."

---

## 4. Supabase Realtime (Subscriptions)

The frontend uses `@supabase/supabase-js`'s `channel()` API to subscribe to row-level changes. Three subscriptions per game.

### 4.1 Channel: `game:{game_code}`

Subscribes to row changes on three tables, filtered by `game_code`:

```ts
supabase
  .channel(`game:${gameCode}`)
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'active_games',
    filter: `game_code=eq.${gameCode}`
  }, handleGameChange)
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'game_teams',
    filter: `game_code=eq.${gameCode}`
  }, handleTeamChange)
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'game_rounds',
    filter: `game_code=eq.${gameCode}`
  }, handleRoundChange)
  .subscribe();
```

### 4.2 Event payloads

Each `postgres_changes` callback receives:
```ts
{
  schema: 'public',
  table: 'active_games' | 'game_teams' | 'game_rounds',
  commit_timestamp: string,
  eventType: 'INSERT' | 'UPDATE' | 'DELETE',
  new: <row | {}>,    // present on INSERT and UPDATE
  old: <row | {}>,    // present on UPDATE and DELETE (only PK by default)
  errors: null | string[]
}
```

The frontend maintains derived state:
- **Game state**: latest `active_games` row.
- **Teams**: full team list, updated on INSERT/UPDATE/DELETE.
- **Current round**: the `game_rounds` row whose id matches `active_games.current_round_id`.

### 4.3 Buzz lock event (specifically)

When a team buzzes:
1. `buzz_in` UPDATEs `active_games` setting `buzzed_team_id` and `locked_at`.
2. Realtime fires `postgres_changes` on `active_games` with `eventType: 'UPDATE'` and the new row.
3. All subscribed clients see `new.buzzed_team_id` go non-null and update their UI.

There is no separate "buzzer_locked" event type. The data model IS the event stream.

### 4.4 Reconnection

`supabase-js` auto-reconnects with exponential backoff. On reconnect, it re-fetches the current state via the channel. The frontend should re-fetch the latest `active_games` row via `select()` after `subscribe()` to handle missed events during the disconnect.

```ts
channel.subscribe(async (status) => {
  if (status === 'SUBSCRIBED') {
    const { data } = await supabase
      .from('active_games')
      .select('*, game_teams(*), game_rounds(*)')
      .eq('game_code', gameCode)
      .single();
    setGameState(data);
  }
});
```

### 4.5 Quotas

Free tier: 200 concurrent peers, 2M messages/month, 100 channels per client. See `free-tier-budget.md` for capacity analysis.

---

## 5. Headers and CORS

### CORS

FastAPI allows: `https://soundclash.org`, `https://www.soundclash.org`, and (in dev) `http://localhost:5173`.

Methods: `GET, POST, PUT, DELETE, OPTIONS`. Headers: `Content-Type, X-Admin-Password, X-Manager-Token`.

### Cache-Control

- `GET /genres`: `public, max-age=600` (genres rarely change)
- All game-state endpoints: `no-store` (game state is live)
- `GET /admin/songs`: `private, no-cache`

### Versioning

The API is unversioned at MVP. Breaking changes will introduce `/v2/` prefix. The frontend pins a known-good API SHA in `VITE_API_VERSION` for diagnostics.

---

## 6. Rate Limits (server-side)

FastAPI uses `slowapi` (Redis-free, in-memory):

| Endpoint | Limit | Reason |
|---|---|---|
| `POST /games` | 10 / minute / IP | Prevent game-code spam |
| `POST /games/*/teams` | 30 / minute / IP | Prevent team-spam DoS |
| `POST /admin/songs/bulk-import` | 5 / minute / IP | Heavy operation |
| All admin endpoints | 100 / minute / IP | Conservative cap |

`buzz_in` RPC is not rate-limited at the API layer (Postgres handles concurrency safely). Future: add Postgres-side rate limit if abuse seen.

---

## 7. Idempotency

- `POST /games`: not idempotent (each call creates a new game). Frontend must not retry on network error without user confirmation.
- `POST /games/{code}/teams`: idempotent on `(game_code, name)`: UNIQUE constraint catches retries.
- `POST /games/{code}/select-song`: not idempotent; each call advances the round number. Frontend must not retry without user confirmation.
- `award_attempt` RPC (direct from manager browser): NOT idempotent. Each call records one attempt against the open round. Manager UI guards against double-submit with a busy flag; the SQL function additionally raises `title_already_claimed` / `artist_already_claimed` on retry. Calling on an ended round raises `round_already_ended`.
- `POST /games/{code}/end-round`: idempotent. A second call on an already-ended round returns the existing `ended_at`.
- `POST /games/{code}/end`: idempotent; calling on an already-`ended` game is a 409 (conflict), not a no-op, to surface the inconsistency to the manager UI.
- `buzz_in` RPC: implicitly idempotent (the `IS NULL` predicate prevents double-claim).

---

## 8. Out of Scope (for MVP)

- Pagination cursor for `/admin/songs` (offset pagination only)
- WebHooks
- API key for third parties
- Public songs API
- OpenAPI / Swagger UI (will be auto-generated by FastAPI but not formally maintained)
- gRPC, GraphQL
