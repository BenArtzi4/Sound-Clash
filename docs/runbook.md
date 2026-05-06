# Sound Clash — Runbook

How to operate the live system. This is for the on-call human (probably you) — what to do, in what order, when something breaks or needs to change.

For *building* the system, see `roadmap.md` and `tasks.md`. For *quotas*, see `free-tier-budget.md`. This doc is for *day 2+ operations*.

## 0. Where Things Live (single source of truth)

| What | Where | URL / Path |
|---|---|---|
| User-facing app | Cloudflare Pages | https://soundclash.org |
| API | Render | https://api.soundclash.org |
| Database | Supabase | https://app.supabase.com → project `Sound-Clash` |
| DNS | Cloudflare | https://dash.cloudflare.com → `soundclash.org` |
| Source code | GitHub | https://github.com/BenArtzi4/Sound-Clash |
| Legacy AWS code (read-only reference) | GitHub | https://github.com/BenArtzi4/Sound-Clash-legacy |
| Error tracking | Sentry | https://sentry.io → project `sound-clash` |
| Keepalive | cron-job.org | https://console.cron-job.org |

Bookmark these as a folder.

## 1. Deploy a New Version

### 1.1 Backend (FastAPI on Render)

The pipeline:
```
git push origin main
   ↓
GitHub Actions (.github/workflows/backend.yml)
   ↓ (on green)
Render deploy hook fires
   ↓
Render builds Docker image, deploys, health-checks
   ↓
New version live at api.soundclash.org
```

Manually trigger from Render dashboard if needed: Service → "Manual Deploy" → "Deploy latest commit."

### 1.2 Frontend (Cloudflare Pages)

Pages auto-deploys on `main` push. The workflow runs `vitest`, builds, and uploads via `wrangler pages deploy`.

Preview deploys: every PR gets a unique URL (`<branch>.sound-clash.pages.dev`). Test there before merging.

### 1.3 Database migrations

Migrations are NOT auto-applied. They run on manual dispatch:

```
GitHub Actions → "db-migrate" workflow → Run workflow → choose env (preview / prod) → Run
```

The workflow runs `db/migrate.sh` against the chosen Supabase project URL. Migrations are idempotent — running twice is safe.

**Connection-string gotcha**: the `SUPABASE_DATABASE_URL` secret for each environment must use Supabase's **Session pooler** URL, not the **Direct connection** URL. GitHub Actions runners have no IPv6 connectivity, and direct connections to `db.<ref>.supabase.co:5432` are IPv6-only on the free tier. The pooler URL looks like `postgresql://postgres.<ref>:[password]@aws-0-<region>.pooler.supabase.com:5432/postgres` and is IPv4-reachable. Find it in: Supabase project → Project Settings → Database → Connection string → choose **Session pooler**.

**Order of operations for a deploy that includes a migration**:
1. Open PR with backend code + new migration file.
2. Merge PR (do NOT deploy backend yet — Render is paused or manual).
3. Run `db-migrate` workflow against prod.
4. Verify migration succeeded (check `cron.job_run_details` if it touched cron).
5. Trigger Render deploy.

This avoids the race where new backend code expects schema that isn't there yet.

## 2. Rollback

### 2.1 Backend rollback

Render dashboard → Service → "Deploys" tab → previous green deploy → "Rollback to this deploy". Effect is immediate (~30 seconds).

If you can't reach Render, you can `git revert` the bad commit and push — the next deploy will roll forward to the reverted state.

### 2.2 Frontend rollback

Cloudflare Pages dashboard → project → "Deployments" → previous deployment → "Rollback to this deployment". Or `git revert` and push.

### 2.3 Database rollback

Postgres migrations are forward-only by design. To revert:

- **Soft revert** (most common): write a new migration that reverses the change. Apply it.
- **Hard revert** (data corruption only): restore from Supabase backup. Free tier has 1 day of backups; Pro has more.

Supabase free tier does NOT have point-in-time recovery. For prod-impacting incidents, accept that the last full backup is your floor.

### 2.4 DNS rollback (cutover undo)

> **No longer available as of 2026-05-07.** The legacy CloudFront distribution `E2NIDUY011R5N4`, the ALBs, the ECR images, the ACM cert, and all S3 backing data were deleted during Phase 7 teardown. There is nothing to revert DNS to. If the new stack breaks, the recovery path is **forward** (deploy a fix) or **rebuild from source** per §6 — there is no quick DNS flip back.
>
> The original rollback procedure is preserved below for historical reference.

If the migration cutover fails and you need to send traffic back to the legacy AWS stack:
1. DNS → `soundclash.org` records (currently at Namecheap, not Cloudflare) → change `www` CNAME from `sound-clash.pages.dev` back to the CloudFront distribution domain (was `d149g9hh3mks89.cloudfront.net`, distribution ID `E2NIDUY011R5N4`).
2. Propagation: 5-30 min at Namecheap.
3. Spin AWS back up if it was destroyed (legacy repo's `scripts/ondemand/deploy-all.sh` — file no longer present in the current legacy clone; would need to be re-created from git history).

This rollback path was only available while the AWS stack remained alive. After the Phase 7 teardown the option is gone.

## 3. Secret Rotation

Secrets are stored in three places. Rotating means updating all three (if shared) or just the relevant one.

### 3.1 `ADMIN_PASSWORD`

1. Generate new password (>=16 chars, random).
2. Update GitHub repo secret `ADMIN_PASSWORD`.
3. Update Render env var `ADMIN_PASSWORD` (Service → Environment → Edit). Triggers a redeploy.
4. Tell the host(s) the new password (out-of-band, e.g., in person).

The frontend does NOT have this secret; users enter it via the admin login form.

### 3.2 `SUPABASE_SERVICE_ROLE_KEY`

This one is sensitive — it bypasses RLS. Rotate if leaked.

1. Supabase dashboard → Settings → API → "Reset service role key". (This invalidates all sessions using the old key.)
2. Update GitHub repo secret `SUPABASE_SERVICE_ROLE_KEY`.
3. Update Render env var `SUPABASE_SERVICE_ROLE_KEY`. Triggers redeploy.
4. Verify by hitting an admin endpoint.

### 3.3 `SUPABASE_ANON_KEY` and `SUPABASE_URL`

The anon key is shipped to the browser — it's not really a secret, but rotating it invalidates open browser sessions.

1. Supabase dashboard → Settings → API → "Reset anon key".
2. Update GitHub repo secrets and Render env vars.
3. Update Cloudflare Pages env vars (`VITE_SUPABASE_ANON_KEY`, `VITE_SUPABASE_URL`).
4. Trigger frontend redeploy. Active games will need to refresh.

### 3.4 `RENDER_DEPLOY_HOOK`

1. Render dashboard → Service → Settings → "Deploy Hook" → "Regenerate".
2. Update GitHub repo secret `RENDER_DEPLOY_HOOK`.

### 3.5 Cloudflare API token

1. Cloudflare dashboard → "My Profile" → API Tokens → revoke + create new.
2. Update GitHub repo secret `CF_API_TOKEN`.

## 4. Common Issues

### 4.1 "Buzzer is slow"

Symptoms: lock event takes >500ms; users complain.

Triage:
1. Check Sentry: are `buzz_in` performance entries spiking? Is it client-side (RTT) or server-side (Postgres)?
2. Check Supabase dashboard → Database → Query Performance: is `buzz_in` slow?
3. Check Realtime tab: any peer count or message lag warnings?
4. Try the buzzer yourself from a known-fast network. Compare.

Common causes:
- Supabase region far from users (deal: pick region matching geography at project creation; not movable without migration).
- Network congestion (transient; wait it out).
- Postgres CPU saturation (free tier). Restart project if available; consider Pro upgrade.

### 4.2 "Game won't start" (cold-start)

Symptoms: manager presses "Create game", waits 30+ seconds, then it works.

Cause: Render free tier sleeping after 15min idle. First request wakes it.

Mitigation already in place: cron-job.org pings `/health` every 14 min.

If this is happening, check:
1. cron-job.org dashboard → is the keepalive job running? Last execution time?
2. Render dashboard → service status → is it asleep?

If keepalive is broken, fix it. If keepalive is running but service still sleeps, Render may have changed free-tier policy — investigate.

### 4.3 "Realtime updates aren't arriving"

Symptoms: a team buzzes; the manager doesn't see it.

Triage:
1. Check Supabase dashboard → Realtime tab → connection count and message rate. If 0, Realtime is broken.
2. Check the affected client's browser DevTools → Network → WS tab. Is the WebSocket open?
3. Check console for `supabase-js` errors.
4. Refresh the page — does it work after?

Common causes:
- WebSocket blocked by firewall (corporate networks, schools). Mitigation: educate user, offer mobile hotspot.
- Subscription filter mismatch. Verify `filter: 'game_code=eq.XXXXXX'` is correct.
- Quota exhausted (peers > 200). Check Supabase Realtime tab — if at limit, peers are being rejected. Upgrade to Pro.

### 4.4 "Catalog admin password rejected"

Symptoms: requests to `/admin/songs/*` return 401. (Game hosting is open and does not use this password — see §4.4b for token issues.)

Triage:
1. Verify Render env var `ADMIN_PASSWORD` (Service → Environment).
2. Check that the request is sending the `X-Admin-Password` header (DevTools → Network → request headers, or `curl -H 'X-Admin-Password: ...'`).
3. Verify it matches what Render expects (typo? leading/trailing whitespace?).

Mitigation: rotate password (§3.1).

### 4.4b "I'm the host but the manager console says I'm not"

Symptoms: visiting `/manager/game/<code>` shows "You're not the host of this game."

Cause: the per-game manager token isn't in the browser's localStorage under `game:<code>:manager-token`. Most likely the host opened the URL in a different browser / incognito / device than the one that ran `POST /games`. Tokens never leave the host's device.

Triage:
1. Have the original host re-open the page in the browser they used to create the game. The token survives a hard refresh.
2. If the original browser is gone, there is no recovery: tokens are not stored server-side as anything but the row itself, and no one else has the value. Create a new game.
3. If you are debugging and have service-role access, you can read the token from the row: `SELECT manager_token FROM active_games WHERE game_code = '<code>';` — but this is a debug-only escape hatch, not a normal flow.

### 4.5 "Game expired mid-session"

Symptoms: marathon session crosses 4-hour mark; game vanishes.

Cause: by design (`expires_at` is fixed-from-start; pg_cron sweeps).

Mitigation: end the game before 4 hours, or accept the limitation. Future: make `expires_at` sliding (refresh on activity) — see open items in `realtime-design.md`.

### 4.6 "Songs catalog data lost"

Symptoms: `SELECT count(*) FROM songs` is 0 or much smaller than expected.

Triage:
1. Check Supabase backup tab. Restore from latest snapshot.
2. If no usable backup, re-run data migration from legacy AWS RDS (`scripts/import-songs.py`).
3. Investigate: did someone accidentally drop the table? Check `pg_audit` if enabled.

Songs are durable — they should never be deleted en masse. Loss is an incident.

## 5. Incident Response

### Severity classes

| Class | Definition | Response time |
|---|---|---|
| **SEV1** | App unreachable for all users; data loss; security breach | Immediate; drop other work |
| **SEV2** | Major feature broken (buzzer not working); some users affected | Within 1 hour |
| **SEV3** | Minor degradation; workaround exists | Same day |
| **SEV4** | Nuisance; cosmetic | Backlog |

### Response playbook

1. **Acknowledge** — receive the alert; confirm you're investigating (e.g., reply to the email).
2. **Assess** — check the dashboards in §0. Identify which service is impacted.
3. **Contain** — if user-impacting, take the bandage step:
   - Frontend issue? Roll back (§2.2).
   - Backend issue? Roll back (§2.1).
   - Supabase issue? You can't roll back a managed service; check Supabase status page (https://status.supabase.com) and post a status to users.
4. **Diagnose** — find the root cause via logs.
5. **Fix** — write a fix, test, deploy.
6. **Postmortem** — for SEV1/SEV2, write a 1-page postmortem in `docs/postmortems/YYYY-MM-DD-<title>.md`. Sections: timeline, impact, root cause, what fixed it, what we'll do to prevent it.

## 6. Backups & Disaster Recovery

### What's backed up

| Data | Backup mechanism | Retention |
|---|---|---|
| Songs catalog (`songs`, `genres`, `song_genres`) | Supabase daily backup (free tier) | 1 day |
| Active game data | Not backed up (ephemeral) | n/a |
| Source code | GitHub | indefinite |
| Configuration (env vars, secrets) | Manually documented in 1Password / Bitwarden / wherever | indefinite |

### Recovery scenarios

| Scenario | Recovery |
|---|---|
| Bad migration drops a column | Restore from Supabase backup (lose <1 day of data). |
| Bad code deletes all songs | Same. |
| Render service deleted | Re-create from Dockerfile + env vars. ~10 min. |
| Cloudflare Pages project deleted | Re-create, link to GitHub repo. Auto-deploys latest main. ~10 min. |
| Supabase project deleted | Re-create. Apply all migrations from `db/migrations/`. Re-import songs. ~1 hour. |
| Domain expires | Re-register; update DNS. |

The system is designed to be **rebuildable from source** — if everything except the GitHub repo is gone, you can reconstruct in under an hour. The songs catalog is the only critical persistent state, and it's regenerable from the legacy CSV (`s3://soundclash-songs-data/songs.csv`) if you keep that file as belt-and-suspenders.

## 7. Routine Maintenance

| Cadence | Task |
|---|---|
| Weekly | Glance at Sentry dashboard for new error trends |
| Weekly | Glance at Supabase Realtime peers/msgs charts |
| Monthly | Review free-tier utilization (`free-tier-budget.md` thresholds) |
| Monthly | Review Render bandwidth + service hours |
| Monthly | Update dependencies (Dependabot PRs) — merge if green |
| Quarterly | Test rollback procedure (§2) on staging — actually do it |
| Quarterly | Test backup restore (§6) on a preview project |
| Annually | Rotate `ADMIN_PASSWORD` (§3.1) |
| Annually | Rotate Supabase service-role key (§3.2) |

## 8. Emergency Contacts

- **You**: benartzi4@gmail.com
- **Supabase support** (free tier): community Discord + GitHub issues; no SLA
- **Render support**: support@render.com (no free-tier SLA)
- **Cloudflare**: dashboard support tab

For critical production issues on free tiers, expect community-grade support response (hours to days). Plan for self-service recovery.
