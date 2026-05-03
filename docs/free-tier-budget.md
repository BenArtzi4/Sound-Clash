# Sound Clash — Free-Tier Budget

This is the early-warning system. It quantifies how many games you can run per month before hitting any free-tier ceiling, and which numbers to watch.

The design target is **comfortably free for 50–100 games per month**. Beyond that, this doc tells you what to upgrade and when.

## 1. Per-Game Resource Estimate

A typical Sound Clash game has these characteristics (used as the unit of capacity throughout this doc):

| Property | Estimate |
|---|---|
| Duration | 30 minutes |
| Teams | 4 |
| Spectator displays | 1 |
| Manager | 1 |
| Total concurrent clients | 6 |
| Rounds | 10 |
| Buzz events | ~10 (one per round) |
| Round-state UPDATEs | ~30 (start, buzz lock, award, ...) |
| Team list UPDATEs | ~5 (joins) |
| Realtime messages per game | ~250 |
| FastAPI requests per game | ~30 (create, joins, song picks, awards, end) |

These numbers are pessimistic — real-world will be lower. Round up for safety.

## 2. Service-by-Service Quota Analysis

### 2.1 Supabase (free tier)

| Resource | Limit | Per-game use | Capacity (games/mo) | Notes |
|---|---|---|---|---|
| Postgres storage | 500 MB | ~5 KB (rounds + teams + game row) | n/a (cleared in 4h) | songs catalog ~5–20 MB indefinitely |
| Database egress | 2 GB / mo | ~50 KB per game (queries + RPC) | **40,000 games** | Far above any practical use |
| Realtime concurrent peers | 200 | 6 | **33 games in parallel** | Hard cap; affects max simultaneous games |
| Realtime messages | 2,000,000 / mo | 250 | **8,000 games/mo** | Comfortable |
| Auth users | 50,000 | 0 | n/a | Not used in MVP |
| Storage | 1 GB | 0 | n/a | Not used (YouTube only) |
| Bandwidth | 5 GB | minimal | n/a | |
| Edge function invocations | 500k / mo | 0 | n/a | Not used in MVP |

**Binding constraint**: 200 concurrent peers = max **33 simultaneous games**. Anything beyond that needs Supabase Pro ($25/mo, 500 peers).

**Soft constraint**: 2M messages/mo = ~8,000 games. Realistically you'll hit the 200-peer ceiling first.

**Project pause policy**: Supabase pauses free projects after 7 days of inactivity. Mitigation: a tiny GitHub Action that hits a SELECT once a week (not strictly necessary if you actually run games).

### 2.2 Render (free web service)

| Resource | Limit | Notes |
|---|---|---|
| Service hours | 750 / mo | Single service uses ~720 (24/7) — below cap |
| RAM | 512 MB | FastAPI + supabase-py easily fits |
| Build minutes | included | |
| Bandwidth | 100 GB / mo | ~30 KB per game request × 30 reqs × 8000 games ≈ 7 GB; safe |
| Idle sleep | 15 min idle → sleep | Acceptable: FastAPI is off the buzzer hot path |
| Cold start | ~30 s wake | Felt only on game creation after long idle |

**Binding constraint**: cold-start UX. The first game-creation request after a >15min idle period stalls ~30s. Mitigation: cron-job.org pings `/health` every 14 minutes (free tier: 50 cron jobs).

### 2.3 Cloudflare Pages

| Resource | Limit | Notes |
|---|---|---|
| Bandwidth | unlimited | Best-in-class for static sites |
| Builds | 500 / mo | A merge to `main` consumes 1; we'll be far under |
| Concurrent builds | 1 | Builds queue but don't fail |
| Custom domains | 100 | We use 1 |
| File count per deployment | 20,000 | Vite builds well under this |

**No binding constraint** at any realistic usage.

### 2.4 Cloudflare DNS

Free, no quotas relevant to this project.

### 2.5 GitHub Actions

| Resource | Limit (public repo) | Limit (private) | Notes |
|---|---|---|---|
| Minutes | unlimited | 2,000 / mo | Public repo recommended for unlimited CI |
| Storage (artifacts/cache) | 500 MB | 500 MB | Tests don't store much |
| Concurrent jobs | 20 | 20 | |

**Recommendation**: keep the new `Sound-Clash` repo public. Saves CI worry.

### 2.6 Sentry (free tier — error tracking)

| Resource | Limit | Notes |
|---|---|---|
| Errors | 5,000 / mo | At 1% error rate per game request × 30 reqs × 8000 games = 2400/mo; safe at expected volume |
| Performance events | 10,000 / mo | Sample buzzer transactions at 100% during MVP; throttle later |
| Replays | 50 / mo | Use sparingly for debugging |
| Team members | 1 | Solo maintainer |

### 2.7 cron-job.org (Render keepalive)

| Resource | Limit | Notes |
|---|---|---|
| Cron jobs | 50 | Use 1 |
| Min interval | 1 minute | We use 14 min |

### 2.8 Domain (paid; not free)

`soundclash.org` registration ~$10–15 / yr. The only non-free cost.

## 3. Monthly Budget Summary

If you run **100 games per month**:

| Service | Usage | % of Quota | Status |
|---|---|---|---|
| Supabase Realtime peers | 6 concurrent | 3% | comfortable |
| Supabase Realtime msgs | 25,000 | 1.25% | comfortable |
| Supabase egress | 5 MB | 0.25% | comfortable |
| Render hours | 720 | 96% | by design (always-on) |
| Render bandwidth | 90 MB | 0.09% | comfortable |
| Cloudflare Pages | <1 build/day | <5% | comfortable |
| GitHub Actions (public) | unlimited | n/a | n/a |
| Sentry errors | <30 | <1% | comfortable |

**Total monthly cost: $0** (excluding the domain).

If you run **1,000 games per month**:

| Service | Usage | % of Quota | Status |
|---|---|---|---|
| Supabase Realtime peers | 6 concurrent (worst-case if many sequential) | up to 200 if parallel | watch |
| Supabase Realtime msgs | 250,000 | 12.5% | comfortable |
| Supabase egress | 50 MB | 2.5% | comfortable |
| Render hours | 720 | 96% | unchanged |
| Render bandwidth | 900 MB | 0.9% | comfortable |
| Sentry errors | ~300 | 6% | comfortable |

Still $0/month. The constraint kicks in only with **simultaneous games** (concurrent peers), not total volume.

## 4. Alert Thresholds

Configure these alerts:

### Supabase (dashboard email alerts)
- Realtime peers > 150 (75% of cap) → warn
- Realtime peers > 180 (90%) → critical
- Realtime messages > 1.5M / mo (75%) → warn
- DB egress > 1.5 GB / mo (75%) → warn
- DB size > 400 MB (80%) → warn

### Render (dashboard alerts)
- Service unhealthy (5xx rate > 5% over 5min) → critical
- Memory > 450 MB (88%) → warn
- Build failures → critical

### Sentry
- New issue (any error) → email
- Error rate > 1% of `buzz_in` calls → critical
- Performance: `buzz_in` p95 > 250ms over 1 hour → warn

### Cloudflare Pages
- Build failure → email

## 5. Scale-Out Triggers

Upgrade only when you actually hit a ceiling. Order of likely upgrade:

| Trigger | Upgrade | Cost / mo | What it gives |
|---|---|---|---|
| Realtime peers approach 200 cap | **Supabase Pro** | $25 | 500 concurrent peers, 5M msgs, daily backups, point-in-time recovery, 8GB DB |
| Cold-start UX hurts game-day flow | **Render Starter** | $7 | No idle sleep; 512MB → 1GB optional |
| Sentry errors > 5k/mo | **Sentry Team** | $26 | 50k errors |
| Want multi-region | **Migrate FastAPI to Fly.io** | $0–$5 | Multi-region machines |
| Want multi-tenant managers | **Supabase Auth + Pro** | $25 | OAuth providers + Pro storage limits |

If you ever ship publicly and run 1000+ concurrent games, the bottleneck is Supabase peers; Pro is the answer. Until then, free is genuinely free.

## 6. What Costs Money If You're Not Careful

Listed for awareness — none of these are in the current design, but they're easy mistakes to make later:

- **Sending audio via Realtime.** Don't. Audio is YouTube-embedded; messages are JSON state changes only. A single audio packet would blow the message budget.
- **Subscribing to entire tables instead of filtered rows.** Always include `filter: 'game_code=eq.XXXXXX'` on `postgres_changes` subscriptions, otherwise every client receives every game's events → quota exhaustion.
- **Polling instead of subscribing.** A team page polling `/games/{code}/state` every second = 86,400 requests / day per team. Don't do it.
- **Logging Realtime payloads at INFO level on the server.** Log volumes climb fast. Use DEBUG, sample, or skip.
- **Running database migrations from CI on every push.** Run them on manual dispatch only.
- **AWS resources still up after migration.** Verify AWS Cost Explorer = $0 forecast post-cutover. CloudFront is the most likely lingering cost.
- **NAT Gateway anywhere.** $32/month minimum on AWS. The new design has no AWS — but if you ever go back, never put a service behind a NAT.

## 7. Cost Comparison vs. Current Architecture

| Architecture | Idle/mo | 100 games/mo | 1000 games/mo |
|---|---|---|---|
| Current AWS always-on | ~$105 | ~$105 | ~$110 |
| Current AWS on-demand (deploy/destroy) | ~$0.02 | ~$1.50 | ~$15 |
| **New free-tier (this design)** | **$0** | **$0** | **$0** |
| New + Supabase Pro (when needed) | $25 | $25 | $25 |

The design saves $1,200+/year vs. always-on AWS, with significantly better UX (no deploy ritual, no 15min wait between sessions).

## 8. Annual Total Cost of Ownership (TCO)

Year 1 estimate at expected usage:

| Item | Cost |
|---|---|
| `soundclash.org` domain renewal | $12 |
| Supabase free tier | $0 |
| Render free tier | $0 |
| Cloudflare Pages | $0 |
| GitHub | $0 |
| Sentry | $0 |
| cron-job.org | $0 |
| **Total** | **$12 / year** |

If volume forces upgrades, year 2+ would be ~$300/year (Supabase Pro). Compare with current AWS always-on at ~$1,260/year.

## 9. Capacity Planning Worksheet

Use this when planning a launch (e.g., a tournament with many parallel games):

```
1. Number of simultaneous games: ___
2. Multiply by 6 (typical clients per game): ___ concurrent peers
3. Compare to 200 (free tier limit): ____% utilization

If > 80%, schedule games sequentially OR upgrade to Pro.
```

For example, 30 simultaneous games = 180 concurrent peers = 90% utilization → cutting it close; upgrade.
