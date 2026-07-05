# Sound Clash: Security & RLS

How the system protects itself. Read this if you're auditing the design or adding new tables/endpoints.

The threat model is small (no PII, no payments, ephemeral game data) but not zero; service-role key leakage, game-code enumeration, and DoS on free-tier infrastructure are all things to address.

## 1. Two-Principal Model

Every interaction with Postgres happens as one of two principals:

| Principal | What they hold | What they can do | Where they execute |
|---|---|---|---|
| **anon** | Supabase anon key (public) | Whatever RLS allows | Browser |
| **service_role** | Supabase service-role key (secret) | Bypass RLS; everything | FastAPI on Render |

There are no other application principals in MVP. No per-user scoping, no JWTs from Supabase Auth. This is by design (matches today's behavior: anonymous teams + per-game manager tokens for hosts + a single admin password for the durable song catalog). The `authenticated` role exists on hosted Supabase but nothing connects as it; migration 020 still revokes EXECUTE from it on the backend-only RPCs purely defensively.

The anon key ships in the frontend bundle; it's not a secret. RLS policies prevent it from being abused.

The service-role key is server-only. **It must never reach the browser.** The build pipeline for the frontend has zero environment variables prefixed `SUPABASE_SERVICE_ROLE_*` available; only `VITE_SUPABASE_ANON_KEY` and `VITE_SUPABASE_URL`. Verified in CI.

### Application-level credentials

Two distinct shared secrets gate FastAPI endpoints. Both checked with `secrets.compare_digest`.

| Credential | Header | Scope | Lifetime |
|---|---|---|---|
| **manager token** | `X-Manager-Token` | One specific game's host actions (`award_attempt` / `release_buzz_lock` / `select_next_song` / `peek_next_song` via token-gated direct RPC; bonus / end / kick a team via REST) | Minted by an `AFTER INSERT` trigger into `game_secrets` (mig 034), read back by `POST /games`; lives 4h, cascade-deleted when `cleanup_expired_games` removes the game |
| **admin password** | `X-Admin-Password` | Song catalog only (`/admin/songs/*` CRUD + bulk import) | Single env var on FastAPI; rotated by changing the env and restarting |

`POST /games` is **public** (rate-limited 10/min/IP). The browser keeps the returned manager token in `localStorage` under `game:<code>:manager-token` and presents it on subsequent host calls. Players who happen to know the game code cannot manage it because they don't have the token. Hosting requires no signup, login, or persistent identity.

## 2. RLS Policy Matrix

| Table | anon SELECT | anon INSERT | anon UPDATE | anon DELETE |
|---|---|---|---|---|
| `songs`         | ✅ (all rows) | ❌ | ❌ | ❌ |
| `genres`        | ✅ (all rows) | ❌ | ❌ | ❌ |
| `song_genres`   | ✅ (all rows) | ❌ | ❌ | ❌ |
| `active_games`  | ✅ (any row by `game_code`) | ❌ | ❌ | ❌ |
| `game_teams`    | ✅ (any row by `game_code`) | ❌ | ❌ | ❌ |
| `game_rounds`   | ✅ (any row by `game_code`) | ❌ | ❌ | ❌ |
| `game_round_attempts` *(mig 037)* | ❌ (analytics-only) | ❌ | ❌ | ❌ |
| `game_secrets` *(mig 034)*        | ❌ (**host credential**) | ❌ | ❌ | ❌ |
| `game_history` *(mig 033)*        | ❌ (operator-only) | ❌ | ❌ | ❌ |
| `game_history_teams` *(mig 033)*  | ❌ (operator-only) | ❌ | ❌ | ❌ |
| `game_history_songs` *(mig 033)*  | ❌ (operator-only) | ❌ | ❌ | ❌ |

`service_role` bypasses all RLS. The tables `anon` cannot read are `game_secrets` (mig 034), the durable `game_history*` tables (mig 033), and `game_round_attempts` (mig 037 — the per-buzz analytics log; the app never reads it and it's not in the Realtime publication, so it's locked to operators/service-role): each has RLS enabled with no read policy and no anon `GRANT`. **`game_secrets` holds the per-game `manager_token`** — it was moved off `active_games` (mig 034) precisely because `active_games` is anon-readable **and** in the `supabase_realtime` publication, so a token stored there was fanned out to every subscribed player over the WebSocket and returned by the anon `select *` hydrate. `game_secrets` is also deliberately **not** in the Realtime publication. The host-facing "export songs" feature reads the live ephemeral tables in the host's own session, not these.

| RPC function | anon EXECUTE | service_role EXECUTE |
|---|---|---|
| `buzz_in`               | ✅ (no extra auth: knowing the game-code is the auth) | ✅ |
| `award_attempt`         | ✅ (token-gated: validates `p_manager_token` in-body) | ✅ |
| `release_buzz_lock`     | ✅ (token-gated: same as above) | ✅ |
| `select_next_song`      | ✅ (token-gated: same as above; added in migration 022) | ✅ |
| `peek_next_song`        | ✅ (token-gated, read-only prebuffer probe; added in migration 029) | ✅ |
| `start_round`           | ❌ | ✅ |
| `end_round`             | ❌ | ✅ |
| `award_bonus`           | ❌ | ✅ |
| `end_game`              | ❌ | ✅ |
| `cleanup_expired_games` | ❌ | ✅ (called by `pg_cron`, not FastAPI) |
| `archive_game`          | ❌ | ✅ (internal: called by `end_game` + `cleanup_expired_games`; added in migration 033) |

Five RPCs are reachable from the browser: `buzz_in` (the buzzer hot path), `award_attempt` / `release_buzz_lock` (the manager scoring hot path, since migration 021), `select_next_song` (the "Next round" / "Start game" hot path, since migration 022), and `peek_next_song` (the read-only prebuffer probe, since migration 029). All five perform their auth check inside the SECURITY DEFINER function body; `peek_next_song` additionally performs no writes. The `❌` rows are enforced by an explicit `REVOKE EXECUTE ... FROM anon, authenticated` (migration `020_lock_down_backend_rpcs.sql`) **in addition to** the `REVOKE ALL ... FROM PUBLIC` the creating migrations already do: on hosted Supabase the project bootstrap grants EXECUTE on every `public` function directly to `anon`/`authenticated`/`service_role`, so a `REVOKE FROM PUBLIC` alone leaves anon able to call them. Migration 020 also re-asserts `GRANT EXECUTE ... TO service_role` so FastAPI keeps working for the remaining backend-only RPCs.

### Why anon can SELECT any game

Game codes are 6 chars from a 32-character alphabet → ~1 billion combinations. Knowing a code IS the auth. This matches today's behaviour (anyone with the code can join). RLS doesn't try to prevent enumeration; it would require per-game JWTs, which are not in MVP.

### Policies (DDL)

```sql
ALTER TABLE songs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE genres       ENABLE ROW LEVEL SECURITY;
ALTER TABLE song_genres  ENABLE ROW LEVEL SECURITY;
ALTER TABLE active_games ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_teams   ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_rounds  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_read_songs"        ON songs        FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_genres"       ON genres       FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_song_genres"  ON song_genres  FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_active_games" ON active_games FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_game_teams"   ON game_teams   FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_game_rounds"  ON game_rounds  FOR SELECT TO anon USING (true);

-- Durable game history (mig 033): RLS on, but deliberately NO policy of any kind
-- for anon, so every anon access is denied. Operator-only.
ALTER TABLE game_history       ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_history_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_history_songs ENABLE ROW LEVEL SECURITY;

-- Per-buzz analytics log (mig 016): same operator-only posture as of mig 037.
-- RLS on with no policy; award_attempt inserts rows as the table owner (SECURITY
-- DEFINER), so the deny-all policy never blocks the game.
ALTER TABLE game_round_attempts ENABLE ROW LEVEL SECURITY;
```

No `INSERT`, `UPDATE`, or `DELETE` policies are created for `anon` → all writes are denied by default. No policy at all is created for the `game_history*` tables → anon reads are denied too.

### Table grants

```sql
-- anon needs the base-table privilege before RLS even gates anything (it only
-- ever SELECTs; the read policies above scope it). Migration 006.
GRANT SELECT ON songs, genres, song_genres, active_games, game_teams, game_rounds TO anon;

-- service_role bypasses RLS but STILL needs base-table privileges (Postgres
-- checks GRANTs before RLS). Hosted Supabase auto-grants these on bootstrap, so
-- prod has always worked; a migrations-only stack (the CI e2e `supabase start`)
-- does not, so service_role table access 500s with `42501 permission denied`.
-- Migration 030 grants them explicitly -- same "don't trust the auto-grant"
-- stance as the function grants below. No-op in production.
GRANT SELECT, INSERT, UPDATE, DELETE
  ON songs, genres, song_genres, active_games, game_teams, game_rounds
  TO service_role;

-- Durable game history (mig 033): service_role only -- deliberately NO anon
-- grant, so the history stays operator-only even though anon can read the live
-- game tables above.
GRANT SELECT, INSERT, UPDATE, DELETE
  ON game_history, game_history_teams, game_history_songs
  TO service_role;

-- Per-buzz analytics log (mig 037): service_role read/insert only.
GRANT SELECT, INSERT ON game_round_attempts TO service_role;

-- Defense in depth: hosted Supabase auto-grants base privileges on every new
-- public table to anon/authenticated. RLS-with-no-policy already denies anon
-- every row, but we ALSO revoke the base privilege so anon gets a hard
-- permission-denied rather than an RLS-empty result -- the privacy boundary
-- doesn't rest on RLS alone. No-op on a bare-Postgres stack. game_round_attempts
-- (mig 037) is added here: mig 016 created it with NO RLS, so on hosted Supabase
-- anon could read/write it directly until this revoke landed.
REVOKE ALL ON game_history, game_history_teams, game_history_songs, game_round_attempts
  FROM anon, authenticated;
```

### Function grants

```sql
-- buzz_in: browser-callable; the game_code itself is the auth.
REVOKE ALL ON FUNCTION buzz_in(char, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION buzz_in(char, uuid) TO anon;

-- award_attempt / release_buzz_lock: browser-callable via Supabase RPC,
-- gated by the per-game manager_token (validated in the function body,
-- not by GRANT). Migration 021 added the p_manager_token argument and
-- granted EXECUTE to anon on the new signatures.
GRANT EXECUTE ON FUNCTION award_attempt(text, uuid, integer, integer, integer, uuid)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION release_buzz_lock(text, uuid)
  TO anon, authenticated, service_role;

-- Backend-only RPCs: the creating migrations REVOKE FROM PUBLIC; migration 020
-- additionally revokes the direct anon/authenticated grants that hosted
-- Supabase adds, and re-asserts the grant for service_role.
--   start_round, end_round, award_bonus, end_game, cleanup_expired_games,
--   archive_game (mig 033, internal snapshot helper)
```

## 3. Realtime Subscriptions

Supabase Realtime respects RLS for `postgres_changes` events. An anon subscriber receives an event only if their RLS policies would have allowed them to SELECT the row.

For Sound Clash, `anon` can SELECT any game row → anon receives every game's events globally. **This is fine** because:
- Filters at subscription time (`filter: 'game_code=eq.XXXXXX'`) ensure clients only get events for their game.
- Events contain no sensitive data (just team names and scores).

If we ever add per-user scoping, RLS policies become more restrictive and Realtime auto-respects them.

**Publication membership.** Only the three tables the frontend actually subscribes to — `active_games`, `game_teams`, `game_rounds` — are in the `supabase_realtime` publication. `game_secrets` (mig 034) and `game_round_attempts` (mig 037) are deliberately **out** of it: the former is a secret, the latter is an analytics log with no subscriber, so publishing it only burned Realtime quota (a full row WAL-decoded and broadcast on every scored buzz, for nobody). A future streaks feature would re-add `game_round_attempts` to the publication as part of that work.

## 4. Threat Model

| Threat | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Service-role key leak** (e.g., committed to git) | Medium | Critical (full DB access) | Pre-commit hook scanning for `eyJ` JWTs; GitHub secret scanning; Sentry leak detection |
| **Anon key abuse** | Low | Low | Anon can only SELECT + buzz; no privileged operations |
| **Game-code enumeration** | Medium | Low (just join a stranger's game) | Accepted; can mitigate by lengthening code to 8 chars (~10^12 combos) |
| **DoS via game-creation spam** | Medium | Medium (storage growth, FastAPI exhausted) | Rate limit `POST /games` to 10/min/IP at FastAPI; Cloudflare DDoS protection upstream |
| **DoS via team-join spam** | Medium | Low (UNIQUE constraint catches dupes) | Rate limit `POST /games/.../teams` to 30/min/IP |
| **DoS via buzz spam** | Low | Low (Postgres handles concurrency) | Postgres MVCC; no app-level rate limit needed |
| **Cross-site request forgery (CSRF)** | Low | Low | No cookies; admin auth is a header (not auto-sent by browser); SameSite N/A |
| **XSS via team name** | Low | Medium (admin views injected names) | React auto-escapes; never use `dangerouslySetInnerHTML` for user-supplied content; CSP header |
| **Realtime quota exhaustion** | Medium | Medium (game-day outage) | Alert at 75% utilization; document max-concurrent-games limit |
| **Admin password brute force** | Low | High (catalog write access) | 16+ char strong password; rate limit `/admin/*` to 100/min/IP |
| **Manager-token guess for someone else's game** | Very low | Medium (could control a stranger's game) | 128-bit uuid → 2^128 search space; rate-limit on `/games/*` is 100/min/IP per endpoint; tokens auto-expire after 4h with the game row |
| **YouTube ID injection** (admin endpoint) | Low | Low | Validate as 11-char alphanumeric+`-_`; reject others |
| **SQL injection** | Low | Critical | Use parameterized queries everywhere (`supabase-py` does this); functions use prepared parameters |

## 5. Secret Inventory

What secrets exist, where they live, who sees them:

| Secret | Storage | Visible to |
|---|---|---|
| `SUPABASE_ANON_KEY`, `SUPABASE_URL` | Frontend bundle, GitHub secrets, Render env, Cloudflare Pages env | Everyone (intentional) |
| `SUPABASE_SERVICE_ROLE_KEY` | GitHub secrets, Render env | Server-only |
| `ADMIN_PASSWORD` | GitHub secrets, Render env | Server + the catalog operator (gates `/admin/songs/*` only) |
| `manager_token` (per game) | `game_secrets.manager_token` (uuid, anon-invisible; mig 034); host's `localStorage` | Whoever holds the host browser session for that game |
| `RENDER_DEPLOY_HOOK` | GitHub secrets | CI only |
| `CF_API_TOKEN` | GitHub secrets | CI only |
| Postgres direct connection string | Supabase dashboard, **never** in repo | Operator only (rare use) |
| Sentry DSN (frontend) | Public; rate-limit by Sentry side | Everyone |
| Sentry DSN (backend) | Render env | Server only |

Rotation procedures: see `runbook.md` §3.

## 6. Rate Limiting

FastAPI uses `slowapi` (in-memory, per-instance; fine for single Render instance):

```python
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)

@router.post("/games")
@limiter.limit("10/minute")
async def create_game(...):
    ...
```

| Endpoint | Limit | Reason |
|---|---|---|
| `POST /games` | 10/min/IP | Prevent game-code spam |
| `POST /games/*/teams` | 30/min/IP | Prevent team-spam DoS |
| `POST /admin/songs/bulk-import` | 5/min/IP | Heavy CSV processing |
| All `/admin/*` | 100/min/IP | Conservative cap on admin endpoints |
| `GET /health` | unlimited | Used by keepalive |
| `GET /genres` | unlimited | Cached, cheap |

`buzz_in` (PostgREST RPC) is NOT rate-limited; Postgres handles concurrency safely. If abuse is observed, add Postgres-level rate limit via `pg_throttle` extension.

## 7. CSP and HTTP Headers

Frontend served by Cloudflare Pages. Configure via `frontend/public/_headers`:

```
/*
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  Content-Security-Policy: default-src 'self'; script-src 'self' https://www.youtube.com https://s.ytimg.com 'unsafe-inline'; img-src 'self' data: https://i.ytimg.com; frame-src https://www.youtube.com https://www.youtube-nocookie.com; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.soundclash.org https://*.ingest.sentry.io https://*.ingest.de.sentry.io https://*.grafana.net

# content-hashed build output: cache forever, never revalidate
/assets/*
  Cache-Control: public, max-age=31536000, immutable

# un-hashed static (each of /icons/*, /og-image.jpg, /how-to-play-hero.*,
# /manifest.webmanifest is its own block): cache a day
/icons/*
  Cache-Control: public, max-age=86400
```

Notes:
- `'unsafe-inline'` for scripts is needed by Vite's runtime + YouTube IFrame Player. Tighten in a future hardening pass with hashes.
- `frame-src` lists both `https://www.youtube.com` and `https://www.youtube-nocookie.com`. The IFrame Player runs in privacy-enhanced mode (`host: "https://www.youtube-nocookie.com"`) to suppress the doubleclick conversion-tracking pixels; the `youtube.com` entry remains because the IFrame API JS itself still loads from there.
- `connect-src` allows Supabase (REST + Realtime), backend API, Sentry ingest (both `*.ingest.sentry.io` and the EU `*.ingest.de.sentry.io` region), and Grafana Faro (`*.grafana.net`).
- **Caching:** content-hashed `/assets/*` are served `immutable` (a fresh hash on every change makes revalidation pointless, so the browser never re-checks them); the un-hashed static assets (`/icons/*`, `/og-image.jpg`, `/how-to-play-hero.*`, `/manifest.webmanifest`) get `max-age=86400`; and `index.html`, every SPA route, and `sw.js` are deliberately left on the platform default (`max-age=0, must-revalidate`) so a new deploy is always picked up and never served stale over a live game.
- **Resource hints:** `index.html` `preconnect`s the Supabase project host and `api.soundclash.org` (both `crossorigin`, since supabase-js and the REST wrapper use CORS) plus the YouTube origins (`www.youtube.com`, `www.youtube-nocookie.com`, non-`crossorigin`), warming DNS+TLS before the join hydrate / buzz RPC / first song.

Backend (FastAPI) sets:
- `Strict-Transport-Security: max-age=31536000; includeSubDomains` (Render terminates TLS; HSTS still useful)
- `X-Content-Type-Options: nosniff`

## 8. Input Validation

All API inputs validated with Pydantic (FastAPI auto-validates request bodies):

```python
class CreateGameRequest(BaseModel):
    selected_genres: conlist(UUID, min_length=1)

class JoinTeamRequest(BaseModel):
    name: constr(strip_whitespace=True, min_length=1, max_length=30)
```

YouTube ID validation: `re.match(r'^[A-Za-z0-9_-]{11}$', youtube_id)`.

Game code validation: `re.match(r'^[A-Z2-9]{6}$', game_code)` (excludes ambiguous chars).

Reject anything that doesn't fit. Don't try to "fix" invalid input.

## 9. Logging & Sensitive Data

- **Never log secrets**. Add a logging filter that scrubs `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_PASSWORD` from log messages.
- **Never log admin passwords from request headers**. The middleware reads the header, validates, then drops it from the request context.
- **Game codes ARE logged** (low sensitivity; expires in 4h anyway).
- **Team names ARE logged** (entered by users; non-PII assumption).
- Sentry `beforeSend` hook scrubs known sensitive fields.

## 10. Auth Failure Modes

| Scenario | Behaviour |
|---|---|
| `X-Admin-Password` header missing or wrong (`/admin/songs/*`) | 401 Unauthorized, generic message ("admin authentication required"): do NOT distinguish missing from wrong |
| `X-Manager-Token` missing or wrong (`/games/{code}/*`) | 401 Unauthorized, generic message ("manager token required") |
| `/games/{code}/*` against a non-existent game | 404; the dependency runs the lookup before the auth check, so a non-host gets the same 404 a real host would |
| `/games/{code}/*` against an already-ended game | 410 Gone; short-circuited before the route body |
| Anon key omitted on Supabase RPC | PostgREST 401 |
| Service-role key omitted on FastAPI internal call | Should never happen; code path bug; alert via Sentry |

The auth middleware uses constant-time comparison (`secrets.compare_digest`) to prevent timing attacks on the admin password.

## 11. Dependency Security

- Dependabot enabled on the repo for `pip` and `npm`.
- Auto-merge low-severity patch updates.
- Manual review for major version bumps.
- Quarterly: review `pip-audit` and `npm audit` reports.

## 12. What This Doc Doesn't Cover

- **GDPR / privacy regulations**: there is no PII collected (team names are user-chosen pseudonyms), no cookies (sessionStorage only), no third-party tracking. A privacy notice on the site explains this. Not covered here.
- **Terms of Service**: out of scope.
- **Penetration testing**: not budgeted; rely on the small attack surface and dependency hygiene.
- **Audit logging**: not implemented; game data is ephemeral so post-hoc audit is futile. Sentry provides incidental error trail.
- **Bug bounty**: not in scope at MVP.

## 13. Future Hardening

Listed for awareness, not in MVP:

- Replace admin password with Supabase Auth for the catalog operator (manager-token flow needs no change)
- Issue per-game JWT to teams on join → tighten RLS to per-game scope
- Tighten CSP (remove `'unsafe-inline'`, use script hashes)
- Add `pg_throttle` for RPC-level rate limiting
- Add CAPTCHA on team-join if bot abuse appears
- Lengthen game code to 8 chars if enumeration becomes a real concern
