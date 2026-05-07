# Sound Clash: Security & RLS

How the system protects itself. Read this if you're auditing the design or adding new tables/endpoints.

The threat model is small (no PII, no payments, ephemeral game data) but not zero; service-role key leakage, game-code enumeration, and DoS on free-tier infrastructure are all things to address.

## 1. Two-Principal Model

Every interaction with Postgres happens as one of two principals:

| Principal | What they hold | What they can do | Where they execute |
|---|---|---|---|
| **anon** | Supabase anon key (public) | Whatever RLS allows | Browser |
| **service_role** | Supabase service-role key (secret) | Bypass RLS; everything | FastAPI on Render |

There are no other roles in MVP. No `authenticated`, no per-user scoping, no JWTs from Supabase Auth. This is by design (matches today's behavior: anonymous teams + per-game manager tokens for hosts + a single admin password for the durable song catalog).

The anon key ships in the frontend bundle; it's not a secret. RLS policies prevent it from being abused.

The service-role key is server-only. **It must never reach the browser.** The build pipeline for the frontend has zero environment variables prefixed `SUPABASE_SERVICE_ROLE_*` available; only `VITE_SUPABASE_ANON_KEY` and `VITE_SUPABASE_URL`. Verified in CI.

### Application-level credentials

Two distinct shared secrets gate FastAPI endpoints. Both checked with `secrets.compare_digest`.

| Credential | Header | Scope | Lifetime |
|---|---|---|---|
| **manager token** | `X-Manager-Token` | One specific game's host actions (`select-song`, `award-points`, `end`, kick a team) | Generated server-side at `POST /games`; lives 4h with the row; auto-expires when `cleanup_expired_games` deletes the game |
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

`service_role` bypasses all RLS.

| RPC function | anon EXECUTE | service_role EXECUTE |
|---|---|---|
| `buzz_in`               | ✅ | ✅ |
| `start_round`           | ❌ | ✅ |
| `award_points`          | ❌ | ✅ |
| `award_bonus`           | ❌ | ✅ |
| `end_game`              | ❌ | ✅ |
| `cleanup_expired_games` | ❌ | ✅ |

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
```

No `INSERT`, `UPDATE`, or `DELETE` policies are created for `anon` → all writes are denied by default.

### Function grants

```sql
REVOKE ALL ON FUNCTION buzz_in(char, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION buzz_in(char, uuid) TO anon;

-- All other functions: no GRANT to anon. Only service_role can call.
```

## 3. Realtime Subscriptions

Supabase Realtime respects RLS for `postgres_changes` events. An anon subscriber receives an event only if their RLS policies would have allowed them to SELECT the row.

For Sound Clash, `anon` can SELECT any game row → anon receives every game's events globally. **This is fine** because:
- Filters at subscription time (`filter: 'game_code=eq.XXXXXX'`) ensure clients only get events for their game.
- Events contain no sensitive data (just team names and scores).

If we ever add per-user scoping, RLS policies become more restrictive and Realtime auto-respects them.

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
| `manager_token` (per game) | `active_games.manager_token` (uuid); host's `localStorage` | Whoever holds the host browser session for that game |
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

Frontend served by Cloudflare Pages. Configure via `_headers` file:

```
/*
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  Content-Security-Policy: default-src 'self'; script-src 'self' https://www.youtube.com https://s.ytimg.com 'unsafe-inline'; img-src 'self' data: https://i.ytimg.com; frame-src https://www.youtube.com; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.soundclash.org https://o*.ingest.sentry.io
```

Notes:
- `'unsafe-inline'` for scripts is needed by Vite's runtime + YouTube IFrame Player. Tighten in a future hardening pass with hashes.
- `frame-src https://www.youtube.com` is required for the IFrame Player.
- `connect-src` allows Supabase (REST + Realtime), backend API, and Sentry ingest only.

Backend (FastAPI) sets:
- `Strict-Transport-Security: max-age=31536000; includeSubDomains` (Render terminates TLS; HSTS still useful)
- `X-Content-Type-Options: nosniff`

## 8. Input Validation

All API inputs validated with Pydantic (FastAPI auto-validates request bodies):

```python
class CreateGameRequest(BaseModel):
    total_rounds: conint(ge=1, le=50) = 10
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
