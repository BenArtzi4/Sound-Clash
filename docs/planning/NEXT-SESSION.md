# Next session — start here

_Last updated: 2026-09-22 (the **UI redesign is complete, live and validated** — all 12 tasks, PRs #303-#320, plus the Home colour pass #323/#324; its final validation ran 2026-09-22 → GO, fix PRs #329-#334 + #339 merged. This file was two months stale and had been pointing sessions at X-DarkRoom #243, which the redesign's dark base theme already delivered. Everything below is re-verified against `git log origin/main`.)_

## Start the next session with ONE line

Just run the skill — it reads this whole file and picks the next task:

> **`/next-task`**

To point it at a specific task, add a few words, e.g. **`/next-task do X-Recap`**. Everything the skill needs (per-PR loop, gates, env traps, the open-work map below) is in this file + `EXECUTION-CONTRACT.md` + `.claude/rules/lessons-learned.md`, which the skill loads automatically.

## One-glance state (verified against code/git 2026-07-14)

- **Phases 1–7 ✅ complete + live on prod** (`https://www.soundclash.org`). Migrations through **046** applied to prod (046 = `team_secrets`, host-only team rejoin, PR #260, 2026-07-12).
- **Phase 8 🟡 in progress** — shipped: X-Presets (#241), X-Recovery (`HostRecoveryLink`), X-Extend (mig 039 + `ExpiryCountdown`), team rejoin/reconnect (#183 → PR #260). Vetoed by maintainer (don't build): X-AutoRelease, X-Practice, X-Streaks.
- **Recent UX polish shipped 2026-07-13:** manager console fits one phone screen (#177 → PR #264, CSS-only); Display board capped to top 5 + per-player standing chip (#179 → PRs #268/#275); Final Results top-5 + polish (#180 → PRs #266/#272); scroll-to-top on navigation (#181 → #267); standing "Ends at" hint removed from the manager console (#276 — the last-20-min warning banner + "Keep playing +1h" remain).
- **Observability:** Faro re-enabled on prod (#258); the I-Vitals layer is built + merged (#262 — `observability/` dashboard JSON, #254 alert, stale-buzz-lock scan Action); the **Supabase metrics scrape is live since 2026-07-13** (PR #269 — `supabase-soundclash` job in `grafanacloud-prom`). Maintainer still owes the apply steps (dashboard import, contact point + alert rule, `GRAFANA_READ_TOKEN` secret) — see `TASKS.md` §C.
- **Buzzer resilience:** #254 round-advance derivation + 15s locked backstop (#259) and the #261 provisional-lock TTL/reconciler (#263) are live; `stale_buzz_lock_resynced` warns in Loki mark real dropped Realtime events.
- **UI redesign ✅ complete + live (2026-09-17 → 2026-09-20).** All 12 tasks merged (PRs #303-#320); plan in `docs/planning/ui-redesign/`. Dark Rogue-Studio system: `--bg` is now the warm near-black `#14120E`, Anton + Instrument Sans self-hosted, one icon set, view-transition route changes. **This delivered X-DarkRoom #243** as the base theme rather than a toggle — do not build it. Home got a colour pass on 2026-09-20 (#323/#324): hero wordmark, three colour-coded role cards, diagonal `clip-path` fill. Prod pass 29/29. **Final validation (`08-final-validation.md`, full mode) ran 2026-09-22 → GO** — report `docs/planning/ui-redesign/validation/2026-09-22-final-validation.md`; fix PRs #329–#334 and the #339 revert are merged (`main` `3c675c5`); the maintainer's real-iPhone check passed.
- **Redesign follow-ups: all closed 2026-09-22.** PR #340 (console status-strip gap), #341 (close-out docs) and #342 (the three taste calls: bone digit in the buzzed rank ring, "Leaderboard" heading on Final Results, small wordmark on Join / Host / Display entry) are merged and prod-verified; issues #335 / #336 closed as not planned, #337 closed by #340. Only the validation report's two optional device lines (two-phone game, TV glance) remain the maintainer's call.
- **Nothing urgent / on fire. No open production or security holes.**

## What to do next (pick one)

1. ~~Finish the redesign~~ **done.** The final validation ran 2026-09-22 (GO), the border-token contrast fix shipped 2026-09-21 (PR #326) and the OG image + PWA icons in PR #327. Nothing from the redesign is open (#340 / #341 / #342 merged, #335–#337 closed).
2. **Features (pick + green-light one — `TASKS.md` §A has the design notes):** X-SFX **#244** (needs the D-9 audio-asset sign-off; display-only — must not slow the buzz), ~~X-DarkRoom #243~~ (**delivered by the redesign — do not build**), X-Recap **#245** (client-side canvas PNG), X-GenreSpotlight **#246** (owes a "why is it good?" case first; DB migration → `run-stress`/`run-e2e` labels + in-prompt merge auth).
3. **Small autonomous residual — I-BuzzMetric (`TASKS.md` §B):** emit `locked_at` so DB-lock latency separates from fan-out latency (`telemetry.ts` already emits `realtime.fanout_ms`; the buzz span still conflates RPC + WAL + fan-out).
4. **Owed to the maintainer (manual):** F-P2-5 two-IP rate-limit check **#247** (laptop ~11 rapid game-creates → last 429s; phone on cellular → 201 proves independent buckets); **prod `ADMIN_PASSWORD` rotation** (shared in-chat 2026-07-12 — after rotating on Render, update the GitHub `ADMIN_PASSWORD` secret + `backend/.env`).
5. **Maintainer-gated infra/ops (`TASKS.md` §C):** T5.6 Cloudflare edge + WAF, I-Vitals apply steps, T5.1 CSV formula-injection guard (off-limits `tools/song-curation/*`), song curation (Hebrew + soundtracks), secret rotation.

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
