# Next session — start here

_Last updated: 2026-07-07 — mid-Phase-4: T4.0 (deploy-safe chunks, PR #185) and T4.2 (resume-on-visible, PR #187) shipped; T4.1 de-scoped (PR #186); **T4.3 is next**._

## Short prompt to paste into the fresh session

> **Continue the Sound Clash plan. Read `docs/planning/NEXT-SESSION.md` first, then continue Phase 4 starting at T4.3: follow `docs/planning/phases/EXECUTION-CONTRACT.md` and `docs/planning/phases/phase-4-resilience.md`. Recall the `project_phase3_handoff` memory. Read `.claude/rules/lessons-learned.md` before running anything. Work the tasks one at a time — they cluster on a few shared files; put the parallelism inside each task (fan-out review/verify), not across tasks. The maintainer is button-averse: prefer zero-UI/auto fixes and confirm before adding any button.**

That's all the maintainer needs to paste. The rest of this file is the context the session should load.

---

## Where things stand (2026-07-07)

- **Phases 1, 2, 3 are ✅ complete and live on prod** (`https://www.soundclash.org`). PRs #150–#174 merged; DB migrations through **038** applied + verified on prod (`jvfddxuaqcsrguibkymp`). `main` HEAD after the Phase-4 work below = `6e0481f`.
- **Phase 4 in progress (all frontend-only, no migrations, Cloudflare auto-deploys from `main`):** ✅ **T4.0** deploy-safe chunk loading (PR #185 — `vite:preloadError` budget-guarded auto-reload + app-level `ErrorBoundary`; removed the "never deploy during a live game" caveat). ⏭️ **T4.1 de-scoped** (PR #186 — no Skip button: existing **Next round** already moves past a dead video, and the `youtube_id` blocklist is redundant since select/peek exclude already-played songs). ✅ **T4.2** resume-on-visible (PR #187 — `useResumeOnVisible` + `YouTubePlayer.resumeIfPaused()`, resumes a song the browser paused on tab-background/phone-lock, guarded off during a buzz). Both shipped features were validated by a fan-out adversarial review + a focused verifier before merge.
- The app **works end-to-end on prod** — a full three-tab game was driven on 2026-07-05 (create→join×2→start→buzz-lock→Correct Song→Continue→artist→Next round→Bonus→End→export; Hebrew rendered; zero app console errors; buzz round-trip 154/222 ms).
- **Pre-event validation done (10-team / 40-person):** driven both live-on-prod (2026-07-05) and as a reproducible DB-verified 10-team/30-round e2e (`tests/e2e/ten_teams_thirty_rounds.spec.ts`, 2026-07-06). Every scoring path, the concurrent buzz race, kick, podium, and `game_history` archive were correct. Two **display-scaling** bugs were found and fixed: **B-1** (scoreboard overflowed a 1080p TV at 8+ teams → auto-fit 100dvh frame, PR #176) and **B-2** (scoreboard clipped rows on short/OS-scaled laptops → elastic rows, PR #178). The event-blocker log lives in `playtest/BLOCKERS.md` (untracked, local): **no open blockers remain.**
- **Phase 4 partway (T4.0 + T4.2 shipped, T4.1 de-scoped); Phases 5–8 not started.** After Phase 4, interleave 6/7 while 5/8 unblock.

## What to do next — Phase 4, from T4.3 (resilience: mid-game failure modes)

Follow `phase-4-resilience.md`. Autonomous, one PR per fix. **Do them one at a time, not in parallel** — most remaining tasks edit the same few files, so parallel branches would just conflict and need serial rebasing:

- `ManagerConsolePage.tsx` → T4.5, T4.6, T4.7, T4.10 · `useGameChannel.ts` → T4.3, T4.4, T4.11 · `DisplayPage.tsx` → T4.7, T4.8 · `TeamGameplayPage.tsx` → T4.4, T4.9.

Put the parallelism **inside** each task (fan-out the adversarial review + verify on the finished diff), not across tasks. You may **batch same-file small fixes** into one PR (e.g. T4.5 + T4.6 are both tiny `ManagerConsolePage` changes) to cut PR count.

**Suggested order (value + file affinity):**
1. **T4.3 · Hydrate/queue robustness `[S]`** (F-P1-1, `useGameChannel.ts`). A transient blip at subscribe-time flips `hydrated=true` anyway, so later live events are silently dropped → player stuck frozen until refresh. Only set `hydrated=true` on a successful snapshot; keep queuing on failure; cap the pending array (~500). **Highest-value remaining bug.**
2. **T4.4 · Graceful expiry/team page `[S]`** (F-P1-2 / `I-GoneDerive`, `useGameChannel.ts` + `TeamGameplayPage.tsx`) — pairs with T4.3's hook work. Derive "gone" from `active_games` absence; treat a missing team as a kick only while `state.game` is present.
3. **T4.5 + T4.6 (batch) `[M+S]`** (`ManagerConsolePage.tsx`): next-round failure recovery (F-P1-3 — revert the double-buffer swap if `select_next_song` fails so the room isn't silenced) + bonus-toast honesty (F-P1-5 — confirm the +4 only after the Render call resolves).
4. **T4.7 · Song-metadata retry `[S]`** (F-P1-7, `DisplayPage.tsx` + `ManagerConsolePage.tsx`) — bounded backoff on the per-round `songs` fetch.
5. **T4.8 · Expiry countdown + `extend_game` RPC `[M]`** (`I-Expiry`) — the one task with a **new migration** (token-gated `extend_game`, additive; apply to prod after merge per lessons-learned F-P0-4). Update `rpc-functions.md`/`security-rls.md`.
6. **T4.9 · Reconnecting states `[S]`** (`I-Reconnect`) — **check first: the CONNECTING/RECONNECTING copy may already have shipped** (2026-07-05 changelog); confirm what's left before implementing.
7. **T4.10 · Host recovery QR `[M]`** (F-P1-6, `ManagerConsolePage.tsx`) — re-openable link/QR embedding the `manager_token` (token already lives in `game_secrets` per D-1, so the link carries the value).
8. **T4.11 · (optional) Final board survives delete `[M]`** (`I-FinalBoard`).

**Phase 4 exit gate** adds, beyond the standard full-game gate, a deliberate **"adverse" game** hitting ≥3 failure paths (kill a video → Next round; background the host tab → auto-resume [T4.2, done]; drop the socket → reconnect with no lost events [needs T4.3]).

## The per-PR loop (from EXECUTION-CONTRACT.md — don't skip)

Branch (`fix/…` or `feature/…`, never commit to `main`) → implement + tests at the right layer → local checks → docs-as-spec in the same PR → CHANGELOG `[Unreleased]` entry if user-visible → `gh pr create` (use `--body-file`, PowerShell mangles multiline `--body`) → **CI fully green** → merge only when green + verified end-to-end (`gh pr merge <n> --squash`, keep the branch) → tick the task box.

- **Merge authorization** is in effect for this execution loop: green CI + verified + squash + keep the branch. If CI can't go green or anything's uncertain, stop and hand the PR to the maintainer.
- **Buzz-race test (10 concurrent → 1 winner, looped) is the hard gate after ANY buzz-path/RPC edit.** Add the `run-stress` + `run-e2e` labels to RPC/realtime-touching PRs (a `labeled` event spawns a SEPARATE workflow run — watch that one).
- **Frontend pre-PR:** from `frontend/` — `npm run format:check && npm run lint && npm run typecheck && npm run test:run`.
- **Backend pre-PR:** from `backend/` (venv) — `ruff check . && ruff format --check . && mypy app`; DB/backend tests need Docker.
- One-line commit messages. **No AI attribution / footer / emoji anywhere** (commits, PRs).

## Windows / environment traps (read `.claude/rules/lessons-learned.md` in full)

- **venv is repointed**: `backend\.venv` was created from a since-moved Anaconda; `pyvenv.cfg` is repointed to `C:\Users\yulin\AppData\Local\Programs\Python\Python311`. If it breaks again, re-apply that replace.
- **DB/backend tests**: run from `backend/` with **no path args** (uses `testpaths`), or for a subset `-c pyproject.toml --rootdir=. -p no:cov <paths>`. Docker Desktop must be running. The `test_rls_anon.py` 12-failure pattern in a full run is a known fixture-contamination flake — re-run that file in isolation to confirm green.
- **Local stack**: `supabase start` (127.0.0.1:54322 db / 54321 api), migrations 001–038 applied. DB URL `postgresql://postgres:postgres@127.0.0.1:54322/postgres`. `psql` is at scoop (18.3). e2e: `npx playwright test <spec> --project=chromium --retries=0` from `tests/e2e/`.
- **Prod testing needs the Bash sandbox disabled** (`dangerouslyDisableSandbox`) — the sandbox blocks non-GitHub egress. Use `https://www.soundclash.org`. `curl -w` is broken here (curl 8.8 bug); use the Playwright MCP for timing/UX.
- **Playwright MCP on prod**: the only console errors you'll see from a healthy game are the benign third-party YouTube `compute-pressure` permissions-policy warnings (from `youtube-nocookie.com/player/base.js`) — **not** app errors; disregard them. Delete any `.playwright-mcp/` + `.wrangler/` dirs before lint.
- **Prod migrations** (only after merge + maintainer go): `supabase link --project-ref jvfddxuaqcsrguibkymp` then `supabase db query --linked -f db/migrations/<NNN>.sql` (project already linked; sandbox disabled). **Apply a hard-required migration BEFORE/atomically with the deploy** (lesson F-P0-4). After applying: `bash ./tests/smoke/post_deploy.sh https://api.soundclash.org`. Note: T4.8 adds a new `extend_game` RPC → new migration; it's token-gated and additive (not hard-required by the backend).
- **NEVER touch `tools/song-curation/*`** — the maintainer has uncommitted in-flight work there (`review.css`, `review.js`, `verify.py`, `add-songs.html`). Stage by explicit path; never `git add .` / `git reset --hard`.

## Architecture guardrails (from CLAUDE.md)

Buzzer hot path is a Postgres PL/pgSQL function called direct from the browser; **Python is deliberately not in any user-perceived hot path** (Render cold starts). Don't add Python to the buzz path, a state-management library, object storage, or user accounts. Schema/RPC/RLS changes must update `docs/data-model.md` / `docs/rpc-functions.md` / `docs/security-rls.md` in the same PR.

## Maintainer-only carryovers (cannot be closed in a coding session)

- **T1.7 — Grafana alerts** on Realtime concurrent connections (~200 free-tier cap) + monthly message quota. Needs Grafana dashboard access. (Also I-Alert in `02`.)
- **D-3 — Cloudflare edge + WAF** (Phase 5 T5.6) — infra/ops, not git.
- **Optional** DB-password / `sb_secret_` rotation (Phase 1 follow-up).
- **4 open Dependabot PRs** (#133 checkout v7, #114 codecov v7, #147 @playwright/test, #182 @types/node) — maintainer merges; Claude only opens/updates.

## Key references

- Backlog by category: `01-fixes.md` (open bugs — F-P0-3 is the lone P0), `02-improvements.md` §D/§E, `03-features.md`, `04-tech-debt.md`.
- Decisions (resolved — don't re-litigate): `05-decisions-needed.md`.
- Process: `execution-playbook.md`, `phases/EXECUTION-CONTRACT.md`, `phases/README.md`.
- Spec: `docs/architecture.md`, `docs/realtime-design.md`, `docs/rpc-functions.md`, `docs/security-rls.md`.
- Memory: `project_phase3_handoff` (state), `reference_production_testing`, `reference_windows_gotchas`.
