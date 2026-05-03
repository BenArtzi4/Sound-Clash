# Sound Clash — Tech Stack

The concrete services that constitute the system, why each was chosen over alternatives, and the free-tier limits relevant to operations.

For quota analysis (capacity in games/month), see `free-tier-budget.md`. For why this combination beats every-Python-on-one-host, see `realtime-design.md`.

## 1. Stack Summary

| Concern | Service | Free-tier scope |
|---|---|---|
| Backend runtime | Render (web service) | 750 hr/mo, 512 MB RAM, sleeps after 15min idle |
| Database + Realtime + RPC | Supabase | 500 MB Postgres, 200 concurrent peers, 2M Realtime msgs/mo |
| Frontend hosting | Cloudflare Pages | Unlimited bandwidth, 500 builds/mo |
| DNS | Cloudflare | Free; existing |
| CI/CD | GitHub Actions | Unlimited for public repos |
| Error tracking | Sentry | 5,000 errors/mo, 10k performance events |
| Render keepalive | cron-job.org | 50 cron jobs |
| Domain | Namecheap (existing) | $12/yr (only paid item) |

## 2. Backend Runtime — Render

**FastAPI in a single Docker container deployed to Render's free web service tier.**

### Why Render

- **Free tier exists and is durable** (no credit-card requirement, no announced sunsetting).
- **GitHub integration**: link the repo, push to `main`, deploy fires automatically.
- **Single Dockerfile autodetect**: no platform-specific build config.
- **Custom domains + auto-managed Let's Encrypt**: `api.soundclash.org` works out of the box.
- **Health-check-aware deploys**: bad deploy doesn't take down a healthy service.
- **Acceptable cold start** for our use: the only cold-affected operation is game creation, not gameplay (see `realtime-design.md`).

### Why not Cloud Run

- Scale-to-zero with 2–5s cold starts is worse UX than Render's "wake on first request after sleep."
- GCP requires a credit card to enable the API even for free-tier usage.
- More complex IaC (Terraform / `gcloud`) for solo maintainer.

### Why not Fly.io

- Free tier requires credit card; the historical "free always-on machines" benefit has shrunk.
- Long-term free status is not guaranteed (Fly has tightened free-tier policy multiple times in 2024–2025).
- Fallback path if Render becomes unsuitable: Fly is well-suited for FastAPI; migrating is a Dockerfile move.

### Why not Oracle Always Free

- Genuinely free, always-on, generous resources.
- But: own VM, own SSL, own monitoring, own deployment pipeline. Significant ops burden for a solo maintainer.
- Reserved as the escape hatch if all managed-PaaS free tiers disappear.

### Configuration

- Environment variables set via Render dashboard (see `runbook.md` §3 for the full list).
- Auto-deploy from `main` branch on push.
- Health check path: `/health`, expects 200.
- Build command: autodetected from Dockerfile.
- Start command: autodetected (`uvicorn app.main:app --host 0.0.0.0 --port $PORT`).

## 3. Database, Realtime, RPC — Supabase

**Supabase is the entire backend data layer.** Postgres for storage, PostgREST for direct-from-browser RPC, Realtime for fan-out, pg_cron for the 4-hour TTL sweep.

### Why Supabase

- **Postgres** is the right database for a small, structured, transactional workload.
- **Realtime built-in**: row-level change events without standing up a separate broker. The single most-load-bearing decision in the architecture.
- **PostgREST**: lets the browser call Postgres RPCs directly. This is what makes <200ms buzzer possible without warm Python.
- **pg_cron available**: scheduled cleanup without an external cron service.
- **Free tier is genuine**: 500MB DB + 200 concurrent peers is comfortable for the expected scale.
- **Ops cost is zero**: managed backups, managed TLS, managed monitoring dashboards.

### Why not Neon (Postgres only)

- Neon is excellent for serverless Postgres, but **no Realtime**. We'd need to bolt on Pusher/Ably for fan-out, which costs money or has tighter quotas.

### Why not Firebase / Firestore

- Document database; bad fit for the relational game schema.
- Vendor lock-in to Google.
- No PL/pgSQL equivalent for the buzzer atomic claim.

### Why not self-hosted Postgres on Render

- Render free Postgres is 1GB but is **deleted after 90 days** unless upgraded. Disqualifying.

### Constraints worth knowing

- **Project pause**: free projects pause after 7 days of zero activity. A weekly cron (`SELECT 1`) prevents this. See `runbook.md`.
- **Single region per project**: pick at creation, can't move.
- **No PITR on free**: 1-day daily backup is the recovery floor.
- **No connection pooler on free** (PgBouncer is Pro-tier in Supabase). FastAPI uses `supabase-py`'s built-in HTTP client, which doesn't need a pooler — calls go through PostgREST, not directly to Postgres. Safe.

### Region choice

Pick the region closest to the primary user geography. For an Israel-based maintainer with EU and Israeli users, `eu-central-1` (Frankfurt) is the closest free-tier region. For US users, `us-east-1`. Decided at project-creation time; immovable later.

## 4. Frontend — Cloudflare Pages

**Static React + Vite SPA hosted on Cloudflare Pages.**

### Why Cloudflare Pages

- **Unlimited bandwidth** on free tier (Vercel free is 100 GB and has commercial-use friction).
- **500 builds/month** is generous; we'll use ~30.
- **Built-in PR preview deploys**: every PR gets a unique URL. Clean QA workflow.
- **Cloudflare DNS already controls the domain**: no extra DNS hops.
- **Native Workers integration** if we ever need edge logic (we don't, in MVP).

### Why not Vercel

- Vercel is the obvious choice for React, but its free-tier bandwidth cap and commercial-use restrictions are tighter than we want for an audience-facing display screen. If a single tournament livestream takes off, we'd hit the cap.
- Vercel locks us to Next.js patterns we don't need (we're a vanilla Vite SPA).

### Why not Netlify

- Comparable to Vercel; same caveats.

### Why not GitHub Pages

- Static-only; can't set custom headers (CSP, etc.).
- Slower CDN globally vs. Cloudflare.

### Configuration

- Build command: `npm run build`.
- Output directory: `frontend/dist`.
- Environment variables (set in Cloudflare dashboard): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL`.
- Custom domain: `soundclash.org` (apex via Cloudflare DNS CNAME flattening).
- `_headers` file in repo defines CSP and security headers (see `security-rls.md` §7).

## 5. DNS — Cloudflare

**`soundclash.org` already lives at Cloudflare.** No migration needed.

Records:
- Apex `soundclash.org` → CNAME-flattened to Cloudflare Pages
- `www.soundclash.org` → CNAME to apex
- `api.soundclash.org` → CNAME to Render (`<service>.onrender.com`)

The legacy AWS records (CloudFront distribution, ALB hostname) are deleted as part of Phase 7 cutover.

## 6. CI/CD — GitHub Actions

**Three workflows + one manual-dispatch.**

| Workflow | Trigger | Runs |
|---|---|---|
| `backend.yml` | PR + push to main | ruff, mypy, pytest; on main: Render deploy hook |
| `frontend.yml` | PR + push to main | eslint, tsc, vitest, build; on main: `wrangler pages deploy` |
| `e2e.yml` | PR (label-gated) + push to main | Playwright against preview Supabase project |
| `db-migrate.yml` | manual dispatch only | Apply SQL migrations to chosen environment |

### Why public repo

GitHub Actions is **unlimited minutes for public repos**, 2,000/mo for private. The codebase has no proprietary IP — public is the right call. Saves CI worry forever.

### Why not GitLab / CircleCI

- GitHub Actions is bundled with the repo host; one less service to manage.
- Integrations with Render, Cloudflare, Sentry are all first-class.

## 7. Error Tracking — Sentry

**Frontend and backend both report to a single Sentry project.**

### Why Sentry

- 5,000 errors/mo on free tier — enough at expected volume.
- 10,000 performance events/mo — enough to instrument the buzzer hot path.
- First-class integrations for FastAPI and React.
- Source-map upload for readable browser stack traces.

### What we instrument

| Layer | What's tracked |
|---|---|
| Frontend (browser) | Unhandled errors, React error boundaries, `buzz_in` RPC duration as a custom transaction |
| Backend (FastAPI) | Unhandled exceptions, slow RPC calls (>1s), 5xx responses |

### What we DON'T send

- Game codes (low sensitivity but they're spammy in the dashboard)
- Team names (user-supplied; could be inappropriate; sanitized via `beforeSend` hook)
- Admin passwords (scrubbed by header filters)
- PII (none collected anyway)

## 8. Render Keepalive — cron-job.org

**External cron pings `https://api.soundclash.org/health` every 14 minutes** to defeat Render's 15-minute idle sleep.

### Why this approach

- Free, no signup friction.
- Truly external (running this from GitHub Actions schedules would burn minutes and is the wrong tool).
- 14-minute interval keeps Render warm; 15-minute interval risks a sleep window.

### Failure mode

If cron-job.org breaks, Render sleeps. The first game creation after sleep stalls 30s. Annoying but recoverable. Monitored: see `runbook.md` §4.2.

### Alternative considered

- Run the keepalive in a GitHub Actions cron schedule. Burns 5 minutes per ping × 96 pings/day = 480 min/day = 14,400 min/month. Way over the 2,000-min free tier. Disqualified.

## 9. Local Development — Supabase CLI

**`supabase start` spins up the entire data layer in Docker** for local dev.

Includes:
- Local Postgres (port 54322)
- Local PostgREST (54321)
- Local Realtime (54321)
- Local Studio UI (54323)

This is the same software as production, just local. Migrations applied identically. See `local-development.md` for the workflow.

## 10. Decision Matrix Summary

For each tier, the alternative considered and the reason for the choice:

| Tier | Chosen | Runner-up | Decisive factor |
|---|---|---|---|
| Backend host | Render | Fly.io | Long-term free-tier durability |
| Database | Supabase | Neon | Realtime built in |
| Realtime | Supabase | Pusher | 200 peers > Pusher's 100; bundled |
| Frontend host | Cloudflare Pages | Vercel | Unlimited bandwidth |
| DNS | Cloudflare | Namecheap | Already the registrar+DNS |
| CI/CD | GitHub Actions | GitLab CI | Bundled with repo host |
| Errors | Sentry | LogRocket | Wider FastAPI/React support |
| Keepalive | cron-job.org | GitHub Actions schedule | Doesn't burn CI minutes |

## 11. Anti-Stack — Things We Explicitly Don't Use

- **Redis / ElastiCache** — Realtime + Postgres do the work; nothing to cache.
- **DynamoDB** — was used in legacy AWS for ephemeral state; replaced by Postgres rows + pg_cron.
- **AWS S3 / Cloudflare R2 / any object storage** — songs are YouTube IDs; no audio files.
- **Kafka / RabbitMQ / message broker** — fan-out is Realtime; no queueing.
- **Kubernetes / ECS** — single FastAPI container on Render is enough.
- **Terraform / Pulumi / CDK** — managed services; clicking a few dashboards once is faster than IaC for this scope. Reconsider if the stack grows.
- **Prometheus / Grafana** — Render and Supabase dashboards cover what's needed; Sentry handles errors. No need for a separate metrics stack.
- **NGINX / HAProxy** — Render and Cloudflare terminate TLS; no reverse-proxy layer needed.
- **Background workers (Celery / RQ)** — no async work that doesn't fit a Postgres function or pg_cron.

The smallest stack that solves the problem is the one we want. Each entry above is a service we'd **add** if a real need appears, not one we removed for fashion.

## 12. Total Annual Cost

See `free-tier-budget.md` for the breakdown. Bottom line: **$12/year** (domain) at expected usage, scaling to ~$300/year only if Realtime peers force a Supabase Pro upgrade.
