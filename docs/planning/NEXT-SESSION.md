# Next session — start here

_Last updated: 2026-07-07 — after Phase 3 + the pre-event 10-team validation & display fixes (B-1/B-2) shipped._

## Short prompt to paste into the fresh session

> **Continue the Sound Clash plan. Read `docs/planning/NEXT-SESSION.md` first, then start Phase 4: follow `docs/planning/phases/EXECUTION-CONTRACT.md` and `docs/planning/phases/phase-4-resilience.md`. Recall the `project_phase3_handoff` memory. Read `.claude/rules/lessons-learned.md` before running anything.**

That's all the maintainer needs to paste. The rest of this file is the context the session should load.

---

## Where things stand (2026-07-07)

- **Phases 1, 2, 3 are ✅ complete and live on prod** (`https://www.soundclash.org`). PRs #150–#174 merged; DB migrations through **038** applied + verified on prod (`jvfddxuaqcsrguibkymp`). `main` HEAD = `22fe0a8`.
- The app **works end-to-end on prod** — a full three-tab game was driven on 2026-07-05 (create→join×2→start→buzz-lock→Correct Song→Continue→artist→Next round→Bonus→End→export; Hebrew rendered; zero app console errors; buzz round-trip 154/222 ms).
- **Pre-event validation done (10-team / 40-person):** driven both live-on-prod (2026-07-05) and as a reproducible DB-verified 10-team/30-round e2e (`tests/e2e/ten_teams_thirty_rounds.spec.ts`, 2026-07-06). Every scoring path, the concurrent buzz race, kick, podium, and `game_history` archive were correct. Two **display-scaling** bugs were found and fixed: **B-1** (scoreboard overflowed a 1080p TV at 8+ teams → auto-fit 100dvh frame, PR #176) and **B-2** (scoreboard clipped rows on short/OS-scaled laptops → elastic rows, PR #178). The event-blocker log lives in `playtest/BLOCKERS.md` (untracked, local): **no open blockers remain.**
- **Phases 4–8 are 0% started.** Recommended order: **Phase 4 (resilience)** → then interleave 6/7 while 5/8 unblock.

## What to do next — Phase 4 (resilience: mid-game failure modes)

Follow `phase-4-resilience.md`. It's autonomous, one session/PR per fix. **Do these two first — they're the highest value for a real party and both small:**

1. **T4.0 · F-P0-3 deploy-safe chunk loading `[S]` — the one still-open P0.** Add a `vite:preloadError → location.reload()` handler (sessionStorage-guarded against loops) + a route-level `ErrorBoundary`. Without it, any Cloudflare deploy *during a live game* can blank a player's screen on navigation (routes are `React.lazy`). This removes the "never deploy during a game" operational caveat entirely.
2. **T4.1 · Dead-video Skip `[S–M]`.** The persistent "Video unavailable" state already ships; add the one-tap **Skip song** button + blocklist the errored `youtube_id`. Most likely in-game hiccup today (host currently has to press Next round to move past a dead video).

Then the rest of Phase 4 (T4.2–T4.11): resume-after-phone-lock, hydrate/queue robustness, graceful expiry (F-P1-2 team-page root-cause refactor), next-round failure recovery, bonus-toast honesty, metadata retry, expiry countdown + `extend_game` RPC, reconnecting states, host-recovery QR, final-board-survives-delete.

**Phase 4 exit gate** adds, beyond the standard full-game gate, a deliberate **"adverse" game** hitting ≥3 failure paths (kill a video → Skip; background the host tab → resume; drop the socket → reconnect with no lost events).

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
