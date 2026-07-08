# Next session — start here

_Last updated: 2026-07-08 (T4.4 shipped — PR #192). Mid-Phase-4; **T4.5+T4.6 (batch) is next**._

## Short prompt to paste into the fresh session

> **Continue the Sound Clash plan. Read `docs/planning/NEXT-SESSION.md` first, then continue Phase 4 starting at T4.5+T4.6 (one PR, same file): follow `docs/planning/phases/EXECUTION-CONTRACT.md` and `docs/planning/phases/phase-4-resilience.md`. Read `.claude/rules/lessons-learned.md` before running anything. Work the tasks one at a time — they cluster on a few shared files; put the parallelism inside each task (fan-out review/verify on the finished diff), not across tasks. The maintainer is button-averse: prefer zero-UI/auto fixes and confirm before adding any button.**

(Or just run the local **`/next-task`** skill — it encodes the same loop.)

---

## Where things stand (2026-07-08)

- **Phases 1–3 ✅ complete and live on prod** (`https://www.soundclash.org`). PRs #150–#174 merged; DB migrations through **038** applied + verified on prod (`jvfddxuaqcsrguibkymp`).
- **Phase 4 ⏳ in progress (frontend-only until T4.8's migration; Cloudflare auto-deploys from `main`):** ✅ T4.0 deploy-safe chunks (PR #185) · ✅ T4.2 resume-on-visible (PR #187) · ✅ T4.3 hydrate gate + queue cap (PR #190 — gate opens only on a successful snapshot; 500-event cap with overflow resync) · ✅ T4.4 expiry teardown ≠ kick (PR #192 — team page shows the "ended or expired" banner instead of a silent Home bounce when the sweep's cascade deletes the team row first; T-CascadeTest pins the ordering; `expiration.spec.ts` tightened) · ❌ T4.1 de-scoped (PR #186 — no Skip button; Next round + played-song exclusion cover dead videos) · ✅ T4.9 turned out **already shipped** in Phase 2 (PR #163 — CONNECTING…/RECONNECTING… states).
- **Pre-event validation done** (10-team live-prod pass 2026-07-05 + DB-verified 10-team/30-round e2e 2026-07-06); the two display-scaling bugs it found are fixed (PRs #176/#178). No open blockers. Reusable checklist: `docs/pre-event-checklist.md`.
- **Phases 5–8 not started**, but re-verification shrank them: Phase 5's critical item (D-1) and T5.3 already shipped; Phase 6 is down to one doc-sync PR + two migrations; Phase 7 lost T-KeepWarm/T-DocRPC (done). Recommended order after Phase 4: **6 → 7 → 5 → 8** (see `phases/README.md`).

## What to do next — Phase 4 from T4.5+T4.6 (recommended order)

Follow `phase-4-resilience.md`. One PR per fix; **serial, not parallel** — the tasks cluster on `useGameChannel.ts`, `ManagerConsolePage.tsx`, `TeamGameplayPage.tsx`, `DisplayPage.tsx`. Batch tiny same-file fixes (T4.5+T4.6) into one PR.

1. **T4.5 + T4.6 (batch) `[M+S]`** — `ManagerConsolePage.tsx`: revert the double-buffer swap when `select_next_song` fails (partial recovery exists; the `activeKey` revert doesn't) + confirm the +4 bonus toast only after the Render call resolves.
2. **T4.7 · Song-metadata retry `[S]`** — bounded backoff on the per-round `songs` fetch (display + manager).
3. **T4.8 · Expiry countdown + `extend_game` RPC `[M]`** — the one task with a **migration** (token-gated, additive). Update `rpc-functions.md`/`security-rls.md`/`data-model.md`; apply to prod before/with the deploy (lesson F-P0-4). Confirm the "keep playing" surface with the maintainer (button-averse).
4. **T4.10 · Host recovery QR/link `[M]`** — re-openable host link embedding the `manager_token`.
5. **T4.11 · (optional) Final board survives delete `[M]`.**

**Phase 4 exit gate** adds a deliberate **"adverse" game** hitting ≥3 failure paths (dead video → Next round; host tab backgrounded → auto-resume [done]; socket drop → reconnect with no lost events [T4.3 ✅]).

## The per-PR loop (from EXECUTION-CONTRACT.md — don't skip)

Branch (`fix/…`/`feature/…`, never `main`) → implement + tests → local checks (frontend: `npm run format:check && npm run lint && npm run typecheck && npm run test:run`; backend from `backend/`: `ruff check . && ruff format --check . && mypy app && pytest` — pytest whenever backend/db changed, e.g. T4.8) → docs-as-spec in the same PR → CHANGELOG `[Unreleased]` if user-visible → `gh pr create --body-file …` → **CI fully green** (`gh pr checks <n> --watch`) → merge only when green + verified (`gh pr merge <n> --squash`, **keep the branch**) → tick the phase-file box + refresh this file.

- **Merge authorization is in effect** for this loop (green CI + verified + squash + keep branch); if anything's uncertain, stop and hand the PR to the maintainer.
- **Buzz-race test is the hard gate after ANY buzz-path/RPC edit**; add `run-stress`/`run-e2e` labels to RPC/realtime-touching PRs (the `labeled` event spawns a separate run — watch that one).
- Docs-only PRs only run CodeQL (backend/frontend workflows are path-filtered; e2e is label-gated).

## Windows / environment traps (read `.claude/rules/lessons-learned.md` in full)

- **venv is repointed**: `backend\.venv\pyvenv.cfg` points at `C:\Users\yulin\AppData\Local\Programs\Python\Python311`. If it breaks, re-apply the replace from lessons-learned.
- **DB/backend tests**: run from `backend/` with **no path args**; subsets need `-c pyproject.toml --rootdir=. -p no:cov`. Docker Desktop must be running. **Never run the db suite against the shared local stack you also use for e2e** — it truncates the catalog (set `DATABASE_URL` empty so it uses a testcontainer, or re-seed after). The `test_rls_anon.py` 12-failure pattern in a full run is a known flake — re-run the file in isolation.
- **Local stack**: `supabase start` (127.0.0.1:54322 db / 54321 api), migrations 001–038. e2e: `npx playwright test <spec> --project=chromium --retries=0` from `tests/e2e/`.
- **Prod testing needs the Bash sandbox disabled** (blocks non-GitHub egress). Use `https://www.soundclash.org`; `curl -w` is broken (curl 8.8 bug) — use the Playwright MCP. Benign console noise: YouTube `compute-pressure` warnings. Delete `.playwright-mcp/`/`.wrangler/` dirs before lint.
- **Prod migrations** (after merge + maintainer go): `supabase link --project-ref jvfddxuaqcsrguibkymp && supabase db query --linked -f db/migrations/<NNN>.sql`, then `bash ./tests/smoke/post_deploy.sh https://api.soundclash.org`. Hard-required migrations go **before** the deploy (lesson F-P0-4).
- **NEVER touch `tools/song-curation/*`** — maintainer's uncommitted in-flight work (release_year tooling). Stage by explicit path; never `git add .` / `git reset --hard`.

## Architecture guardrails (from CLAUDE.md)

Buzzer hot path is a PL/pgSQL function called direct from the browser; **Python is deliberately not in any user-perceived hot path**. No state-management libraries, no object storage, no user accounts, no non-YouTube audio. Schema/RPC/RLS changes update `docs/data-model.md`/`rpc-functions.md`/`security-rls.md` in the same PR. Decisions in `05-decisions-needed.md` are resolved — don't re-litigate.

## Maintainer-only carryovers (not closable by a coding session)

- **T1.7 / I-Alert** — Grafana alerts on Realtime connections (~200 free-tier cap) + message quota; **I-Vitals** dashboard once Faro sends.
- **D-3 / T5.6** — Cloudflare edge + WAF (infra/ops).
- Optional DB-password / `sb_secret_` rotation.
- **Dependabot PRs** #133 (checkout v7), #114 (codecov v7), #147 (@playwright/test), #182 (@types/node) — maintainer merges.
- **Song curation** — Hebrew + soundtrack genres batch via `tools/song-curation/PLAYBOOK.md` (in-flight uncommitted tooling; see `03-features.md` §Content).

## Key references

- Backlog: `01-fixes.md` (no open P0s), `02-improvements.md` §D/§E, `03-features.md`, `04-tech-debt.md`. Decisions: `05-decisions-needed.md` (log; all resolved).
- Process: `phases/EXECUTION-CONTRACT.md` (the single process doc) · roadmap: `phases/README.md`.
- Spec: `docs/architecture.md`, `docs/realtime-design.md`, `docs/rpc-functions.md`, `docs/security-rls.md`.
- Ops/validation: `docs/runbook.md`, `docs/pre-event-checklist.md`.
