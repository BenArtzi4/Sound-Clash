# Phase 7 — Cutover Checklist

Pre-cutover sequencing for moving `soundclash.org` from the legacy AWS stack to the new Supabase + Render + Cloudflare Pages system. Walk top-to-bottom; do not skip ahead. Each step has a verification gate that must pass before moving to the next.

For day-2 ops after cutover, see [`runbook.md`](runbook.md). For AWS teardown, see [`aws-teardown-checklist.md`](aws-teardown-checklist.md). For the official Definition of Done, see [`roadmap.md`](roadmap.md) §7 lines 217–227.

---

## Pre-conditions

Before starting, confirm:

- [ ] All Phase 6 e2e suites green on `main` (latest run on GitHub Actions).
- [ ] Backend coverage gate matches the per-phase target in [`testing-strategy.md`](testing-strategy.md) §5. (As of writing: gate at 0; ratchet to 90 in a separate PR before cutover.)
- [ ] You can sign in to: GitHub repo settings, Supabase dashboard (Sound-Clash project), Render dashboard, Cloudflare dashboard, Sentry account, the legacy AWS account.
- [ ] You have a password manager open. Several tokens get generated below; do not lose them.
- [ ] You have ~3 hours uninterrupted. Estimate is generous; cutover plus monitoring is typically 60–90 min, AWS teardown another 60–90.

---

## 1. Sentry projects

Create one project per surface so frontend and backend errors land in separate issue feeds.

- [ ] Sign in to Sentry. Create project `sound-clash-frontend`, platform: `react`. Capture the DSN.
- [ ] Create project `sound-clash-backend`, platform: `python-fastapi`. Capture the DSN.
- [ ] Save both DSNs in your password manager.

**Verify:** both projects appear in your Sentry dashboard with the "Waiting for first event" placeholder.

Free-tier limits documented in [`free-tier-budget.md`](free-tier-budget.md) §2.6 and [`tech-stack.md`](tech-stack.md) §7. The SDK code is already conditional — both surfaces are no-ops until the DSN is set, so it is safe to leave these blank during preview testing.

---

## 2. GitHub repo secrets

The deploy workflows reference these by name. Set them at GitHub repo → Settings → Secrets and variables → Actions.

- [ ] `CF_API_TOKEN` — Cloudflare Pages deploy token. Create at Cloudflare dashboard → My Profile → API Tokens → Create Token → "Edit Cloudflare Pages" template (or custom: `Account.Cloudflare Pages: Edit`). Used at [`.github/workflows/frontend.yml:113`](../.github/workflows/frontend.yml).
- [ ] `CF_ACCOUNT_ID` — Cloudflare account ID, visible in the Cloudflare dashboard URL or the right sidebar of any zone overview. Used at [`.github/workflows/frontend.yml:112`](../.github/workflows/frontend.yml).
- [ ] `RENDER_DEPLOY_HOOK` — populated in step 4 below.

If they are not already set, also confirm the Supabase secrets the backend tests (and prod) require, per [`local-development.md`](local-development.md) §4: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `ADMIN_PASSWORD`, and `SUPABASE_DATABASE_URL` (Session pooler — see [`runbook.md`](runbook.md) §1.3 gotcha).

**Verify:** GitHub Settings → Secrets shows each name with a recent "Updated" timestamp.

---

## 3. Cloudflare Pages project

The frontend deploy job runs `wrangler pages deploy dist --project-name=sound-clash` ([`.github/workflows/frontend.yml:110`](../.github/workflows/frontend.yml)). The project name is exact.

- [ ] Cloudflare dashboard → Workers & Pages → Create application → Pages → Connect to Git → select `BenArtzi4/Sound-Clash`.
- [ ] Project name: `sound-clash` (must match the wrangler arg above).
- [ ] Production branch: `main`. Build command: leave blank (CI builds and uploads via wrangler; we don't want Pages to also build). Build output directory: `dist`.
- [ ] Set environment variables for production:
  - `VITE_SUPABASE_URL` — Supabase project URL
  - `VITE_SUPABASE_ANON_KEY` — Supabase anon key
  - `VITE_API_URL` — `https://api.soundclash.org`
  - `VITE_SENTRY_DSN` — frontend DSN from step 1

**Verify:** project shows in Workers & Pages list. Initial empty deploy may exist — that is fine.

---

## 4. Render web service

Backend deploys via `Dockerfile` autodetect, triggered from a deploy hook. The hook URL gets fed back into the GitHub workflow as a secret.

- [ ] Render dashboard → New → Web Service → connect `BenArtzi4/Sound-Clash`.
- [ ] Name: `sound-clash` (or any name; the URL is internal). Region: nearest to Supabase region. Branch: `main`. Root directory: `backend`. Runtime: `Docker`. Plan: `Free`.
- [ ] Set environment variables (mirror [`backend/.env.example`](../backend/.env.example)):
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `ADMIN_PASSWORD` — generate a fresh ≥16-char random string; save in password manager
  - `CORS_ORIGINS` — `https://soundclash.org`
  - `LOG_LEVEL` — `INFO`
  - `SENTRY_DSN_BACKEND` — backend DSN from step 1
  - `PORT` — leave to Render default (it injects this; the Dockerfile reads it)
- [ ] First deploy will be triggered automatically on save. Let it complete; verify health checks pass in the Render logs.
- [ ] Render dashboard → service → Settings → "Deploy Hook" → copy the URL.
- [ ] Paste the URL as GitHub secret `RENDER_DEPLOY_HOOK` (the empty slot from step 2).

**Verify:** `curl https://<your-render-host>.onrender.com/health` returns 200 with `{"status":"ok",...,"supabase":"ok"}`. The Render-assigned hostname is visible at the top of the service page.

---

## 5. Trigger first deploys via CI

The previous step deployed Render directly. Now confirm the GitHub-driven path also works.

- [ ] Push an empty commit to `main` (or just merge a docs PR), or use GitHub Actions → frontend.yml → Run workflow → main. Same for backend.yml.
- [ ] Watch [`backend.yml`](../.github/workflows/backend.yml) run; the deploy step should fire `RENDER_DEPLOY_HOOK` and Render should rebuild.
- [ ] Watch [`frontend.yml`](../.github/workflows/frontend.yml) run; the wrangler step should upload to the `sound-clash` Pages project.

**Verify:** both workflows green. Render shows a fresh deploy timestamp. Cloudflare Pages → project → Deployments shows a new entry tagged `main`.

---

## 6. Smoke test against the preview environment

Before changing DNS, verify the new stack is healthy by hitting it directly via the Render and Pages auto-assigned hosts.

- [ ] Run `./tests/smoke/post_deploy.sh https://<render-host>.onrender.com`. Expect exit 0 with a `PASS` line.
- [ ] Run the Playwright spec against the Pages preview:
  ```bash
  cd tests/e2e
  BASE_URL=https://<your-pages-host>.pages.dev \
    API_URL=https://<render-host>.onrender.com \
    npx playwright test --config smoke/playwright.smoke.config.ts
  ```
  Expect green.

**Verify:** both pass. If `post_deploy.sh` fails, fix the issue (likely env-var typo or missing Supabase row) before continuing. Do not advance to DNS cutover with a red preview.

---

## 7. DNS cutover

Cloudflare DNS holds `soundclash.org`. Move the apex record off CloudFront and add the API subdomain.

- [ ] Cloudflare dashboard → `soundclash.org` → DNS.
- [ ] Apex `soundclash.org`: change record from CNAME → CloudFront (`d…cloudfront.net`) to CNAME → Cloudflare Pages target (`sound-clash.pages.dev`). Proxy status: proxied (orange cloud).
- [ ] Add CNAME `api` → `<render-host>.onrender.com`. Proxy status: DNS-only (grey cloud — Render terminates TLS itself).
- [ ] In Cloudflare Pages → project → Custom domains → add `soundclash.org`. Cloudflare wires the cert automatically.
- [ ] In Render → service → Settings → Custom Domains → add `api.soundclash.org`. Confirm cert provisioning (1–5 min).

**Verify:** `dig soundclash.org` and `dig api.soundclash.org` both resolve to the new targets. `https://soundclash.org` loads the new app. `https://api.soundclash.org/health` returns 200.

DNS rollback path is documented in [`runbook.md`](runbook.md) §2.4 — flip the apex CNAME back to the CloudFront distribution `E2NIDUY011R5N4` if anything goes wrong in the next 24h. Until step 10 (AWS teardown) executes, this rollback is reversible.

---

## 8. Smoke test against prod

Repeat step 6 against the canonical URLs. This is the gate that satisfies Definition of Done checkbox 4 in [`roadmap.md`](roadmap.md).

- [ ] `./tests/smoke/post_deploy.sh https://api.soundclash.org` → exit 0.
- [ ] Playwright smoke against `https://soundclash.org`:
  ```bash
  cd tests/e2e
  BASE_URL=https://soundclash.org npx playwright test --config smoke/playwright.smoke.config.ts
  ```

**Verify:** both green. Manually load `https://soundclash.org` in a clean browser session and play one full game (manager + 2 teams in incognito tabs) to satisfy DoD checkbox 3.

---

## 9. Activate monitoring

Thresholds and tools are spelled out in [`free-tier-budget.md`](free-tier-budget.md) §4.

- [ ] **Render alerts** (service → Settings → Notifications): 5xx rate > 5%, memory > 450 MB, deploy failure.
- [ ] **Supabase alerts** (project → Settings → Notifications): Realtime peers > 150 (warn) / 180 (critical), Realtime messages > 1.5M / month, Database CPU > 80%.
- [ ] **Sentry alerts** (each project → Alerts → Create Alert):
  - New issue → email
  - For `sound-clash-backend`: transaction `buzz_in` p95 > 250ms (informational)
- [ ] **Cloudflare Pages**: build-failure email is on by default; verify in project → Settings → General → Notifications.
- [ ] **cron-job.org**: ensure the keepalive ping job for `https://api.soundclash.org/health` is running every 14 min ([`tech-stack.md`](tech-stack.md) §8). Update the URL if it was pointing at the legacy host.

**Verify:** trigger a synthetic alert if possible (e.g. throw an error from a non-prod page that points at the prod Sentry DSN, or temporarily set Render memory threshold low). Tear down the synthetic test after verifying the alert lands.

---

## 10. AWS teardown

Wait at least 24 hours after step 7 before starting. The whole window is your rollback budget.

- [ ] Confirm prod has been stable for 24h: zero SEV1/SEV2 in Sentry, no unexpected 5xx in Render logs, traffic patterns look normal.
- [ ] Walk [`aws-teardown-checklist.md`](aws-teardown-checklist.md) in order. Do not skip the verification commands at each step — they catch the case where something is still depending on the resource you are about to delete.
- [ ] Once CloudFront distribution `E2NIDUY011R5N4` is deleted, the rollback path in [`runbook.md`](runbook.md) §2.4 is gone. There is no going back from this step without re-provisioning AWS from scratch.

**Verify:** AWS Cost Explorer → Forecast for next month → $0 (excluding Route 53 hosted-zone fees if you keep DNS at AWS, which we do not — DNS is at Cloudflare).

---

## 11. Final Definition-of-Done pass

Walk the checklist in [`roadmap.md`](roadmap.md) lines 217–227 and tick each box. The list is reproduced here for convenience:

- [ ] `https://soundclash.org` serves the new frontend
- [ ] `https://api.soundclash.org/health` returns 200
- [ ] A real end-to-end game playable from a clean browser session
- [ ] Smoke-test script passes
- [ ] AWS Cost Explorer shows $0 forecasted for next month
- [ ] All AWS resources from the teardown checklist are confirmed deleted
- [ ] `Sound-Clash-legacy` README updated with `LEGACY.md` pointing at `Sound-Clash`
- [ ] `Sound-Clash` README has setup, dev, deploy, runbook links
- [ ] Monitoring active: Render health alerts + Supabase email alerts + Sentry
- [ ] Rollback plan documented (DNS revert to CloudFront within 24h)

Update [`README.md`](../README.md) phase status: tick Phase 7. Open a tiny PR for the README change so the project status reflects reality.

Phase 7 is complete.
