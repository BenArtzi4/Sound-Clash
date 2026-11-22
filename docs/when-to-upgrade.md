# When to pay for an upgrade

This file decides when Sound Clash needs a paid plan. It holds the numbers we measured, the triggers that start a purchase, and a 10-minute monthly check. [free-tier-budget.md](free-tier-budget.md) has the long quota analysis from the design phase.

**Decision on 2026-11-22: pay nothing now.** Every free limit is far away. The one real speed problem (the backend REST calls) has a free fix: move the backend to Frankfurt (§4). Check the numbers once a month (§5). Pay only when a trigger in §3 fires.

## 1. What the game uses now (measured 2026-11-22)

Usage grew a lot. The design target was 50–100 games per month. Now it is 60–120 games per week (some of these are our own test scripts). But the free limits are about **how many devices are connected at the same time**, not about the total number of games. On that measure we use about 16%.

| Service | Free limit | Used now | % | Source |
| --- | --- | --- | --- | --- |
| Supabase Realtime peak connections | 200 | ~32 (estimate) | ~16% | `game_history`: teams + host + display of overlapping games. Peak was 5 games at once (2026-11-06 21:37 Israel) or one 30-team game (2026-11-10). |
| Supabase Realtime messages | 2 M / month | ~0.2–0.4 M (estimate) | ~10–20% | ~7,800 rounds/month × ~7 row changes × ~5 listening devices. Read the real number (§5). |
| Supabase egress | 5 GB / month | not measured | ? | Read it on the Usage page (§5). |
| Supabase database size | 500 MB | 20 MB | 4% | `pg_database_size` |
| Supabase DB connections | 60 | 23 now, max 30% of capacity (Nov 10–17) | ≤30% | `pg_stat_activity`, production game review of Nov 10–17 |
| Grafana Cloud logs | 50 GB / month | 0.35 GB (Nov 1–22) | 0.7% | `grafanacloud_org_logs_usage` |
| Grafana Cloud traces | 50 GB / month | 0.03 GB | <0.1% | `grafanacloud_org_traces_usage` |
| Grafana Faro sessions | 50,000 / month | 1,907 | 3.8% | `grafanacloud_org_fe_o11y_billable_sessions` |
| Grafana metrics series | 10,000 | 716 | 7% | `grafanacloud_org_metrics_billable_series` |
| Render free instance hours | 750 / month | ~720 (always on) | 96% by design | one service, kept warm |
| Render keepalive (cron-job.org) | – | 50 of the last 50 pings OK | – | `/jobs/7569155/history` |
| Cloudflare Pages | unlimited | – | – | – |
| Sentry errors | 5,000 / month | not measured | ? | errors only; read it on the Sentry Stats page |

Games per week (`game_history`, not flagged as test, at least one round):

| Week of | Games | Games with 2+ teams | Rounds |
| --- | ---: | ---: | ---: |
| 2026-10-26 | 79 | 43 | 2,028 |
| 2026-11-02 | 89 | 30 | 2,079 |
| 2026-11-09 | 118 | 26 | 2,250 |
| 2026-11-16 (6 days) | 63 | 18 | 1,248 |

Backups are not a reason to buy Supabase Pro: `catalog-backup.yml` keeps a weekly encrypted copy of the song catalog (last success 2026-11-16). Game rows delete themselves after 4 hours, so the catalog is the only data that must survive.

## 2. Where the time goes, and what money can fix

| Part of the game | Measured | Cause | Does money fix it? |
| --- | --- | --- | --- |
| Buzzer and scoring in the database | `award_attempt` 5.7 ms average, `award_bonus` 2.2 ms | Postgres functions | **No.** The database is not the slow part. |
| Buzz → lock shown on the other screens | median 468 ms, p95 838 ms | Supabase Realtime delivery (Postgres Changes) | **No.** Supabase Pro runs on the same Realtime service. A bigger database does not make it faster. |
| Song start (YouTube) | p95 3.5 s | YouTube player | **No.** |
| Backend REST: create game, join team, end game, kick team | p95 create 2.5 s, join 3.0 s, end 7.6 s (Nov 10–17) | The backend server is far from the players and from the database, and the free instance has 0.1 CPU | **Partly.** First do the free fix in §4. |

How we know the backend is far away (measured from Israel on 2026-11-22, warm server, reused connection):

- A backend page with no database work (`/docs`): 210–260 ms.
- `/health`, which makes one database call: 410–470 ms.
- Supabase (Frankfurt) directly: 11–16 ms.

So one trip to the backend costs about 200 ms, and one trip from the backend to the database costs about 200 ms more. A server in Frankfurt next to Supabase would make both trips short. The backend is very likely in a US region (Render's default is Oregon). Check the region in the Render dashboard (§4 step 1).

Bonus no longer goes through the backend (PR #418). Only actions that happen once or twice per game still use it.

## 3. Upgrade triggers

Upgrade only when one of these happens. Write the date and the number in the log (§6).

| # | Trigger | Then buy | Cost | What it gives |
| --- | --- | --- | --- | --- |
| 1 | Supabase **Realtime peak connections > 150** in a month | Supabase Pro | $25 / month | 500 connections, 5 M messages, 250 GB egress, daily backups, no pause |
| 2 | You plan an event with **more than ~20 games at the same time**, or more than ~150 phones and screens connected at once | Supabase Pro, at least 1 day before the event | $25 / month | same as 1 |
| 3 | **Realtime messages > 1.5 M** in a month | Supabase Pro | $25 / month | same as 1 |
| 4 | **Egress > 3.5 GB** in a month | Supabase Pro | $25 / month | same as 1 |
| 5 | **Database size > 400 MB** | Supabase Pro | $25 / month | 8 GB database |
| 6 | Supabase sends a usage email (quota near or over) | Supabase Pro, the same day | $25 / month | Over-quota free projects can be limited |
| 7 | After the Frankfurt move (§4): **join or create p95 > 1.5 s** over one week, OR the keepalive fails again and a host waits ~30 s for a cold start | Render Starter | $7 / month | 0.5 CPU (5× free), never sleeps, no keepalive needed |
| 8 | Grafana logs or traces **> 40 GB**, or Faro sessions **> 40,000** in a month | Nothing first: send less telemetry (`frontend/src/lib/telemetry.ts`). Pay only if you need the data. | – | – |
| 9 | Sentry **> 4,000 errors** in a month | Nothing first: fix the noisy error. Sentry Team only if the errors are real and different. | $26 / month | 50k errors |

Supabase Pro: change the plan when no game is live. Supabase can restart the database for a few minutes when the compute size changes. Check with `select count(*) from active_games where ended_at is null and expires_at > now();`.

Do **not** pay for these. They do not help this game now:

- A bigger Supabase database (more compute). Database calls take milliseconds and connections peak at 30%.
- Paid logs, traces or monitoring. We use less than 8% of every free Grafana quota.
- Multi-region hosting (Fly.io and similar). Players are in Israel and Europe, and Supabase is in Frankfurt.

Free gaps that money does not fix:

- **Backend traces are empty.** Tempo has 0 traces from `sound-clash-backend` (Nov 10–17). `backend/app/middleware/otel.py` sends traces only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set on the Render service. Set the `OTEL_EXPORTER_OTLP_*` variables (Grafana Cloud → OpenTelemetry) during the move in §4.
- **The buzz-to-lock time on other screens** comes from Realtime Postgres Changes. If it must get faster, the option to measure is Supabase Realtime Broadcast from the database. That is engineering work, not a purchase, and it touches the hot path (see [realtime-design.md](realtime-design.md)).

## 4. Free fix first: move the backend to Frankfurt

Render cannot change the region of an existing service. Make a new service in Frankfurt, then move the domain.

1. Render dashboard → the backend service → **Settings** → read **Region**. If it is already Frankfurt, stop here: the slow part is the 0.1 CPU, so go to trigger 7.
2. Write down the build command, start command, root directory, branch and health check path from the old service's Settings.
3. **New → Web Service** → same GitHub repo and branch → **Region: Frankfurt (EU Central)** → instance type **Free** → the same commands from step 2.
4. Copy every environment variable from the old service (**Environment** tab) to the new one. Add the `OTEL_EXPORTER_OTLP_*` variables too (see §3, free gaps).
5. Wait for the first deploy. Open `https://<new-name>.onrender.com/health`. It must return `"status":"ok"` and `"supabase":"ok"`.
6. Pick a quiet time with no live game (query in §3). Remove `api.soundclash.org` from the old service (**Settings → Custom Domains**). Add it to the new service. In Cloudflare DNS, point the `api` CNAME to `<new-name>.onrender.com`. Keep it **DNS only** (grey cloud): Render issues its own certificate.
7. When the certificate is ready (a few minutes), run `bash ./tests/smoke/post_deploy.sh https://api.soundclash.org` and host one short real game.
8. New service → **Settings → Deploy Hook** → copy it into the GitHub secret `RENDER_DEPLOY_HOOK`.
9. After 1–2 days with no problems, **suspend** the old service. Free instance hours (750 / month) are shared by all free services in the workspace.
10. One week later, compare create, join and end p95 with the numbers in §2. Write them in the log. If join or create p95 is still above 1.5 s, trigger 7 fires.

Expected result: create, join and end get about 2–4× faster. This is an estimate. Trust only the week-later measurement.

## 5. Monthly check (10 minutes, first Sunday of the month)

Ask Claude: "run the monthly upgrade check from `docs/when-to-upgrade.md`". Or do it by hand:

1. **Supabase dashboard → Organization → Usage** (the maintainer reads this; no API gives it to us). Write down: Realtime Peak Connections, Realtime Messages, Egress, Database Size.
2. **Busiest moment from the archive** (estimate of peak connections):
   ```sql
   with g as (
     select started_at s,
            case when ended_at - started_at > interval '3 hours'
                 then started_at + least(interval '4 hours', round_count * interval '100 seconds' + interval '20 minutes')
                 else ended_at end e,
            team_count + 2 peers
     from game_history
     where not is_test and round_count > 0 and started_at > now() - interval '35 days'),
   t as (select generate_series(date_trunc('minute', now() - interval '35 days'), now(), interval '5 min') ts)
   select ts at time zone 'Asia/Jerusalem' il_time, count(*) games, sum(peers) peers
   from t join g on ts between s and e group by ts order by peers desc limit 5;
   ```
   Run it with `supabase db query --linked "<query>"` (sandbox off).
3. **Grafana usage**, datasource `grafanacloud-usage`, instant query:
   `{__name__=~"grafanacloud_org_(logs|traces|fe_o11y|metrics)_(usage|included_usage|billable_sessions|included_sessions|billable_series|included_series)"}`
4. **Render keepalive**: `curl -s -H "Authorization: Bearer $CRONJOB_API_KEY" https://api.cron-job.org/jobs/7569155/history` → count the OK pings (status 1).
5. **Backend speed**: p95 of the create, join and end REST calls in Tempo for the last 7 days (real hosts only, see `.claude/rules/lessons/observability.md`).
6. **Sentry → Stats**: errors this month.
7. Compare every number with §3. Add one row to §6.

## 6. Log

| Date | Peak connections | Realtime messages | Egress | DB size | Games / week | REST p95 (create / join / end) | Decision |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-11-22 | ~32 (estimate) | ~0.2–0.4 M (estimate) | not read | 20 MB | 63–118 | 2.5 / 3.0 / 7.6 s | Pay nothing. Move the backend to Frankfurt (free). |

## Sources

- Supabase quotas and prices: [pricing](https://supabase.com/pricing), [Realtime pricing](https://supabase.com/docs/guides/realtime/pricing), [Realtime limits](https://supabase.com/docs/guides/realtime/limits), [egress](https://supabase.com/docs/guides/platform/manage-your-usage/egress). Check the live page before you buy: prices change.
- Render instance types and prices: [pricing](https://render.com/pricing).
- Grafana free quotas: read from the `grafanacloud_org_*_included_*` metrics above.
