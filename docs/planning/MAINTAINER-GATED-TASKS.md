# Maintainer-gated tasks — the "not autonomously finishable" list

_Created 2026-07-11. These are every remaining plan item that a coding session **cannot** close on its own — each needs a **decision**, a **CI/infra flag**, a **dashboard action**, or **maintainer direction**. The autonomous coding surface (Phases 1–6, T7.1, T7.4, dependabot, CI-cache) is already shipped + live on prod._

**How we work this list:** one item at a time. For each I tell you exactly the human part (a decision or a dashboard action), I do my part (code / PR / verification), and we don't tick the box until it's **shipped and validated** (merged + live, or the rule/alert is live and measured).

Legend: ⬜ not started · 🟡 in progress · ✅ done + validated

---

## Group A — one decision from you, then I ship it end-to-end

### 1. ✅ T5.2 · Team-name guard on join  `[DONE — PR #229 merged + verified live on prod 2026-07-11]`
- **What:** sanitize/validate the team name in the join path before it's stored. Names render on the projector (Display page) and persist **durably** in `game_history` (unlike the 4h-ephemeral tables), so a bad name is both an on-screen and a permanent-record problem. A 1–30 length cap already exists (pydantic `TeamName`).
- **Why not autonomous:** the game is Hebrew-primary + party-flavored — a naive profanity/emoji/control-char filter risks rejecting legit Hebrew (RTL is normal) or wanted emoji. **Needs your content-policy call.**
- **You decide:** how strict the filter is (options presented separately).
- **I do:** implement the chosen policy in the join path + tests + docs; PR → green CI → merge (not buzz-path, not a prod migration → closable this session).
- **Done =** PR merged, filter live, a bad name is rejected/sanitized on the real join flow.

### 2. ✅ T5.4 · `game_history` retention / PII  `[DONE — decided keep+document, PR #230 merged 2026-07-11]`
- **What:** team names in `game_history` are kept **indefinitely** today. Add a retention sweep (e.g. pg_cron like `cleanup_expired_games`) or anonymize names on archive.
- **Why not autonomous:** the retention window is a **policy decision** (keep forever? anonymize after N days? drop names entirely?).
- **You decide:** the window + whether to delete rows or just null-out names.
- **I do:** migration (pg_cron job or anonymization step) + tests + docs; PR → CI → apply to prod on your go-ahead.
- **Done =** the sweep/anonymization is live on prod and verified against a synthetic old row.

### 3. ⬜ T7.6 · T-e2eGate — should e2e gate PRs?
- **What:** today e2e runs only on push-to-main + the `run-e2e` label; backend coverage already gates at 90.
- **Why not autonomous:** it's a **policy call** (do we want every PR blocked on the ~13-min e2e run, given the known #222 YouTube flake?) **and** a `.github/workflows/` change.
- **You decide:** gate all PRs / keep label-gated / gate a fast subset only.
- **I do:** the CI edit once you pick (flag-first).
- **Done =** the chosen gating live on `main` CI.

---

## Group B — CI change (flag-first), then I ship it

### 4. ✅ T7.6 · CI discipline (RLS job + bundle budget + e2e-gate decision)  `[DONE — PR #232 merged 2026-07-11; Phase 7 complete]`
_All three sub-items shipped together in PR #232 (maintainer-authorized CI change), designed + adversarially verified by a pre-ship workflow, CI-validated (the new `rls suite (isolated)` job + bundle-budget step both ran green on the PR). Sub-items below kept for reference._

### 4a. ⬜ T7.6 · T-RLSCI — isolated CI job for the RLS suite
- **What:** give the RLS test suite its own deterministic green/red CI job (it has a history of in-suite contamination flakes; T7.5 fixed the root cause with a LOGIN-role fixture, a dedicated job locks it in).
- **Why not autonomous:** touches `.github/workflows/` → **flag before doing** per repo rule.
- **You do:** approve the CI change (one "go").
- **I do:** add the job + verify it runs green on a PR.
- **Done =** the RLS job is green on `main` and red when RLS breaks.

### 5. ⬜ T7.6 · T-BundleBudget — bundle-size assert in CI
- **What:** post-build bundle-size assert / visualizer so an accidental size regression fails the PR.
- **Why not autonomous:** touches `.github/workflows/` → **flag first**; also needs a **budget number** from you (or I propose one from the current bundle).
- **You do:** approve the CI change + confirm/adjust the budget I propose.
- **I do:** add the assert + wire the current size as the baseline.
- **Done =** a deliberate oversize import fails CI; normal builds pass.

---

## Group C — infra / deploy config you execute, I guide + validate

### 3/6. ✅ F-P2-5 · Rate-limit per-IP behind the proxy  `[DONE — PR #231 merged + deployed; edge-verified. Two-IP check owed to you → issue #247.]`
- **What:** behind Render's proxy every request looks like it comes from the proxy IP, so slowapi's per-IP rate limits collapse into **one shared bucket** (a single abuser can exhaust everyone's limit, or hide in the crowd). Fix = trust `X-Forwarded-For` (uvicorn `--proxy-headers` / forwarded-allow-ips + limiter reads the real client IP).
- **Why not autonomous:** the fix is a **Render start-command / deploy-config** change (yours), possibly plus a small code tweak (mine).
- **You do:** update the Render start command / env as I spec it.
- **I do:** the code side if needed + give exact Render steps + verify the limiter now buckets per real IP.
- **Done =** two IPs get independent rate-limit budgets on prod (verified).

### 7. ⬜ T5.6 · Cloudflare edge + WAF in front of Supabase (D-3)
- **What:** front the Supabase REST + Realtime hostnames with Cloudflare (proxy/Worker): per-IP rate limits, a WAF rule blocking bulk `select=*` on the ephemeral tables, DDoS mitigation.
- **Why not autonomous:** **infra + DNS, largely outside git** — a maintainer ops task.
- **You do:** the Cloudflare + DNS config.
- **I do:** give the rule set + a before/after buzz-p95 measurement plan (the extra hop must not blow the <200ms budget).
- **Done =** WAF/rate-limit rules live, a bulk `select=*` is blocked, buzz p95 unaffected.

### 8. ⬜ T1.7 / I-Alert / I-Vitals · Grafana Realtime alerts + latency dashboard
- **What:** Grafana alerts on Realtime connections (~200 free-tier cap) + message quota; the I-Vitals dashboard once Faro sends web-vitals.
- **Why not autonomous:** needs **Grafana dashboard access** (maintainer).
- **You do:** grant/drive the Grafana dashboard + alert config.
- **I do:** provide the exact PromQL/queries + alert thresholds + panel definitions.
- **Done =** alerts fire on a synthetic breach; the vitals dashboard shows live data.

---

## Group D — direction / off-limits tooling

### 9. ⬜ T5.1 · CSV formula-injection guard (tooling)
- **What:** in `tools/song-curation/add-songs.html` + `review.js` `csvCell`, prefix a leading `'` when a cell starts with `= + - @ \t \r` (mirrored one-liner).
- **Why not autonomous:** these files are your **uncommitted in-flight `tools/song-curation/*`** — off-limits for me to touch.
- **You do:** either apply the one-liner yourself, or explicitly authorize me to edit those two files.
- **I do:** the edit (if authorized) or hand you the exact diff.
- **Done =** an exported cell starting with `=` is prefixed with `'`.

### 10. 🟡 Phase 8 · Features (in progress)
- **What:** the Tier 1–3 feature candidates in `phase-8-features.md`.
- **Shipped:** X-Presets (#241), X-Recovery (`HostRecoveryLink`), X-Extend (mig 039 + `ExpiryCountdown`). **Vetoed → dropped:** X-AutoRelease, X-Practice, X-Streaks.
- **Remaining (each a GitHub issue, pick one to green-light):** X-SFX **#244** (needs your D-9 audio-asset sign-off; must not slow the buzz), X-DarkRoom **#243** (frontend-only), X-Recap **#245** (canvas PNG), X-GenreSpotlight **#246** (owes a "why is it good?" case; DB migration).
- **You do:** pick which feature(s), confirm the design against the vetoes.
- **I do:** design-then-build the chosen one through the normal loop.
- **Done =** the feature is live on prod + passes the full-game exit gate.

### 11. ⬜ Song curation · Hebrew + soundtracks batch (content)
- **What:** add the remaining net-new songs for the Hebrew + soundtrack genres via `tools/song-curation/PLAYBOOK.md`.
- **Why not autonomous:** uses your **uncommitted `tools/song-curation/*`** tooling — off-limits.
- **You do:** run the curation batch.
- **I do:** if you want, generate the idempotent seed SQL from your reviewed CSV (the >100-row import bypasses the Render endpoint per lessons-learned).
- **Done =** the new songs are live in the prod catalog, dedup-clean.

### 12. ⬜ (optional) Secret rotation
- **What:** rotate the DB password / `sb_secret_` service key.
- **Why not autonomous:** Supabase dashboard + secret handling (maintainer).
- **You do:** rotate in the dashboard + update the stored secrets.
- **I do:** provide the checklist + re-run prod smoke after.
- **Done =** rotated, backend still green on prod smoke.

---

## Progress log

- 2026-07-11: file created; starting with **#1 T5.2 (team-name guard)**.
- 2026-07-11: #1 T5.2 — you chose **objective sanitization only**. Implemented as a `BeforeValidator` on `TeamName`, 14 tests + docs + CHANGELOG. **PR #229 merged** (CI green: lint+type+test, codecov, CodeQL), Render deployed, and **verified live on prod**: a join with `  ‹RLO›Party‹ZWSP›‹TAB›Time🎉  ` returned `PartyTime🎉` (control/bidi/zero-width stripped, whitespace trimmed, emoji kept). ✅ DONE.
- 2026-07-11: #2 T5.4 — you chose **keep forever + document as accepted**. Docs-only close (pseudonyms, operator-only, negligible volume): new accepted-tradeoff entry in `security-rls.md` §4 + pointer in `data-model.md` + phase box ticked. **PR #230 merged** (CodeQL green). No deploy needed. ✅ DONE.
- 2026-07-11: #3 F-P2-5 **reclassified** during pre-scoping — the safe fix is a spoof-resistant custom `key_func` (rightmost `X-Forwarded-For` hop), which is **code-only** (no Dockerfile/Render change), so it no longer needs a maintainer deploy action. One empirical unknown: Render's exact XFF format, confirmed on prod after deploy.
- 2026-07-11: #4 T7.6 — shipped all three CI-discipline sub-items in **PR #232** (maintainer-authorized), designed + adversarially verified by a pre-ship workflow: isolated `rls suite (isolated)` job (green on the PR), dependency-free gzipped-JS bundle budget (350037/410000 B, green on the PR), and the e2e-gate decision (keep label-gated, documented in `testing-strategy.md`). **Phase 7 exit gate passed → Phases 1–7 all complete.** Everything below (#5–#10) is genuinely maintainer-gated (infra/dashboard/off-limits-tooling/product-direction) — handed off. ✅ DONE.
- 2026-07-11: #10 Phase 8 — **kicked off on your direction** ("pick phase 8, I wrote there what to do"). Built the first non-vetoed Tier-1 feature **X-Presets** (one-tap Quick-start presets on the create screen) end-to-end: frontend-only, no migration, not buzz-path → **PR #241 merged + live on prod + verified** (live-bundle grep + real-browser check on `soundclash.org/manager/create`). Honored your `phase-8-features.md` markers (skipped X-AutoRelease/X-Practice/X-Streaks; X-GenreSpotlight deferred pending my "why is it good?" writeup). Left `phase-8-features.md` untouched (your uncommitted file) — **tick its `X-Presets` box when convenient**. Phase 8 remains open (more features await your per-feature direction). 🟡 in progress.
- 2026-07-12: **planning cleanup + issue tracker.** Discovered **X-Recovery** (`HostRecoveryLink`) and **X-Extend** (mig 039 + `ExpiryCountdown`) were already shipped but unticked — ticked them + X-Presets in `phase-8-features.md`; dropped the vetoed X-AutoRelease/X-Practice/X-Streaks. Synced the stale `01`–`04` backlog to actual shipped state (Phase 6–7 items marked resolved; D-2/D-4 doc halves closed via #208). Opened GitHub issues for all remaining not-started work so it's pick-up-able: X-SFX #244, X-DarkRoom #243, X-Recap #245, X-GenreSpotlight #246, F-P2-5 two-IP check #247, I-Liveness #248. Docs-only PR. (T-Admin #249 was mis-filed — `AdminSongsPage` was already split in #206/T7.2 — and closed as already-done.)
- 2026-07-11: #3 F-P2-5 — implemented `client_ip` key_func keying on **`CF-Connecting-IP`** (research-confirmed present on Render/Cloudflare) → rightmost-XFF → socket. 6 unit + 1 per-IP integration test, 100% key-func coverage, docs + CHANGELOG. **PR #231 merged, Render deployed.** Prod edge-verified: baseline `POST /games` → 201; spoofed `CF-Connecting-IP` → **403 from Cloudflare** (header is un-forgeable — even stronger than "overwritten"); spoofed `X-Forwarded-For` → 201 (passes, but key uses CF-Connecting-IP on prod). Change is safe-by-construction (a bad key = old shared-bucket, never a regression). ✅ DONE — **owed: your two-IP behavioral check** (laptop vs phone-on-cellular: ~11 rapid game-creates from device A → last one 429s; then create from device B on a *different* network → should be 201, proving independent buckets).
