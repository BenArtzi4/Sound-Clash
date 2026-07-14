# Next session — start here

_Last updated: 2026-07-14 (planning cleanup: after a 5-agent code audit verified every claimed item is really shipped, the completed backlog + phase files were deleted and the survivors consolidated — all open work now lives in **[TASKS.md](TASKS.md)** (§A features / §B residuals / §C maintainer-gated); the decision log is **[DECISIONS.md](DECISIONS.md)**; the process doc moved to **[EXECUTION-CONTRACT.md](EXECUTION-CONTRACT.md)** in this directory. Detail lives in git history. Correction folded in: **issue #183 team rejoin IS merged + live on prod** — PR #260, mig 046 `team_secrets`, `TeamRescueModal` — the previous version of this file predated that merge.)_

## Start the next session with ONE line

Just run the skill — it reads this whole file and picks the next task:

> **`/next-task`**

To point it at a specific task, add a few words, e.g. **`/next-task do X-DarkRoom`**. Everything the skill needs (per-PR loop, gates, env traps, the open-work map below) is in this file + `EXECUTION-CONTRACT.md` + `.claude/rules/lessons-learned.md`, which the skill loads automatically.

## One-glance state (verified against code/git 2026-07-14)

- **Phases 1–7 ✅ complete + live on prod** (`https://www.soundclash.org`). Migrations through **046** applied to prod (046 = `team_secrets`, host-only team rejoin, PR #260, 2026-07-12).
- **Phase 8 🟡 in progress** — shipped: X-Presets (#241), X-Recovery (`HostRecoveryLink`), X-Extend (mig 039 + `ExpiryCountdown`), team rejoin/reconnect (#183 → PR #260). Vetoed by maintainer (don't build): X-AutoRelease, X-Practice, X-Streaks.
- **Recent UX polish shipped 2026-07-13:** manager console fits one phone screen (#177 → PR #264, CSS-only); Display board capped to top 5 + per-player standing chip (#179 → PRs #268/#275); Final Results top-5 + polish (#180 → PRs #266/#272); scroll-to-top on navigation (#181 → #267); standing "Ends at" hint removed from the manager console (#276 — the last-20-min warning banner + "Keep playing +1h" remain).
- **Observability:** Faro re-enabled on prod (#258); the I-Vitals layer is built + merged (#262 — `observability/` dashboard JSON, #254 alert, stale-buzz-lock scan Action); the **Supabase metrics scrape is live since 2026-07-13** (PR #269 — `supabase-soundclash` job in `grafanacloud-prom`). Maintainer still owes the apply steps (dashboard import, contact point + alert rule, `GRAFANA_READ_TOKEN` secret) — see `TASKS.md` §C.
- **Buzzer resilience:** #254 round-advance derivation + 15s locked backstop (#259) and the #261 provisional-lock TTL/reconciler (#263) are live; `stale_buzz_lock_resynced` warns in Loki mark real dropped Realtime events.
- **Load capacity validated (2026-07-14 campaign, PR #279):** all 5 checks PASS on prod free tier — 20 concurrent 10-team games (180 RT sockets), one 30-team game, 60-round soak; 0 lost Realtime events / 0 invariant violations; buzz_in p95 ~100ms (269ms only in 30-way races). One real ceiling: free-tier ~200 RT connections ⇒ ~16 fully-connected 10-team rooms (`TASKS.md` §C LT-Pro). Findings log: `tests/load/FINDINGS.md`; capacity docs updated (`docs/free-tier-budget.md` §2.1, `docs/pre-event-checklist.md` §0).
- **Nothing urgent / on fire. No open production or security holes.**

## What to do next (pick one)

1. **Features (pick + green-light one — `TASKS.md` §A has the design notes):** X-SFX **#244** (needs the D-9 audio-asset sign-off; display-only — must not slow the buzz), X-DarkRoom **#243** (frontend-only, ready to build), X-Recap **#245** (client-side canvas PNG), X-GenreSpotlight **#246** (owes a "why is it good?" case first; DB migration → `run-stress`/`run-e2e` labels + in-prompt merge auth).
2. **Small autonomous residual — I-BuzzMetric (`TASKS.md` §B):** emit `locked_at` so DB-lock latency separates from fan-out latency (`telemetry.ts` already emits `realtime.fanout_ms`; the buzz span still conflates RPC + WAL + fan-out).
3. **Owed to the maintainer (manual):** F-P2-5 two-IP rate-limit check **#247** (laptop ~11 rapid game-creates → last 429s; phone on cellular → 201 proves independent buckets); **prod `ADMIN_PASSWORD` rotation** (shared in-chat 2026-07-12 — after rotating on Render, update the GitHub `ADMIN_PASSWORD` secret + `backend/.env`).
4. **Maintainer-gated infra/ops (`TASKS.md` §C):** T5.6 Cloudflare edge + WAF, I-Vitals apply steps, T5.1 CSV formula-injection guard (off-limits `tools/song-curation/*`), song curation (Hebrew + soundtracks), secret rotation.

## The per-PR loop (from EXECUTION-CONTRACT.md — don't skip)

Branch (`fix/…`/`feature/…`, never `main`) → implement + tests → local checks (frontend: `npm run format:check && npm run lint && npm run typecheck && npm run test:run`; backend from `backend/`: `ruff check . && ruff format --check . && mypy app && pytest` — pytest whenever backend/db changed; db tests need `DATABASE_URL=""` + Docker) → docs-as-spec in the same PR → CHANGELOG `[Unreleased]` if user-visible → `gh pr create --body-file …` → **CI fully green** (`gh pr checks <n> --watch`) → merge (`gh pr merge <n> --squash`, **keep the branch**) → tick the task box in `TASKS.md` + refresh this file.

- **Merge authorization:** the auto-mode classifier does **not** honor documented standing authorizations — only the **current user prompt**. If the live prompt explicitly authorizes it, merge green PRs; otherwise hand every merge to the maintainer. **Never self-merge buzz-path or prod-migration PRs even when authorized** — hand those off so the maintainer applies the migration to prod as a unit.
- **Buzz-race test is the hard gate after ANY buzz-path/RPC edit**; add `run-stress`/`run-e2e` labels to RPC/realtime/migration-touching PRs (the `labeled` event spawns a separate run — watch that one).
- **Stacked squash-merges:** GitHub does NOT auto-retarget a kept stacked branch after its base is squash-merged — `gh pr edit <n> --base main` manually. Use the **two-dot** diff (`git diff origin/main origin/<branch>`) to see a stacked PR's true content.
- Docs-only PRs only run CodeQL (backend/frontend workflows are path-filtered; e2e is label-gated).

## Windows / environment traps (read `.claude/rules/lessons-learned.md` in full)

- **venv is repointed**: `backend\.venv\pyvenv.cfg` points at `C:\Users\yulin\AppData\Local\Programs\Python\Python311`. If it breaks, re-apply the replace from lessons-learned.
- **DB/backend tests**: run from `backend/` with **no path args**; subsets need `-c pyproject.toml --rootdir=. -p no:cov`. Docker Desktop must be running. **Never run the db suite against the shared local stack you also use for e2e** — set `DATABASE_URL=""` so it uses a throwaway testcontainer.
- **Local stack**: `supabase start` (127.0.0.1:54322 db / 54321 api). e2e: `npx playwright test <spec> --project=chromium --retries=0` from `tests/e2e/`.
- **Prod testing needs the Bash sandbox disabled** (blocks non-GitHub egress). Use `https://www.soundclash.org`; `curl -w` is broken (curl 8.8 bug) — use the Playwright MCP. Benign console noise: YouTube `compute-pressure` warnings. Delete `.playwright-mcp/`/`.wrangler/` dirs before lint.
- **Prod migrations** (after merge + maintainer go): `supabase link --project-ref jvfddxuaqcsrguibkymp && supabase db query --linked -f db/migrations/<NNN>.sql`, then `bash ./tests/smoke/post_deploy.sh https://api.soundclash.org`. Hard-required migrations go **before** the deploy (lesson F-P0-4). Pre-flight destructive migrations with the live-games count check.
- **NEVER touch `tools/song-curation/*`** — maintainer's in-flight uncommitted work. Stage by explicit path; never `git add .` / `git reset --hard`.

## Architecture guardrails (from CLAUDE.md)

Buzzer hot path is a PL/pgSQL function called direct from the browser; **Python is deliberately not in any user-perceived hot path**. No state-management libraries, no object storage, no user accounts, no non-YouTube audio. Schema/RPC/RLS changes update `docs/data-model.md`/`rpc-functions.md`/`security-rls.md` in the same PR. Decisions in `DECISIONS.md` are resolved — don't re-litigate.

## Key references

- Plan & status: `README.md` (this dir) · all open work: `TASKS.md` (+ GitHub issues #243–#247) · decisions: `DECISIONS.md`.
- Process: `EXECUTION-CONTRACT.md` (the single process doc, this dir).
- Spec: `docs/architecture.md`, `docs/realtime-design.md`, `docs/rpc-functions.md`, `docs/security-rls.md`, `docs/data-model.md`, `docs/api-contracts.md`.
- Ops/validation: `docs/runbook.md`, `docs/pre-event-checklist.md`, `observability/README.md`.
