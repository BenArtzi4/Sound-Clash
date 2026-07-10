# Phase 6 — Correctness & Docs/Data-Model Hygiene

## ▶ Kickoff
**Model:** Opus 4.8. Follow [EXECUTION-CONTRACT.md](EXECUTION-CONTRACT.md).
**Scope re-verified 2026-07-07:** the original "76-item docs-drift sweep" had no backing item list, and most named drifts were already fixed by the Phase 1–3 doc syncs (`rpc-functions.md` done; the 409-vs-410 contracts claim turned out false; runbook + roadmap items closed in the planning reorg). **T6.1 is now a single-session sync of ~4 residual drifts — no workflow needed.** T6.2/T6.3 are separate single-session migration PRs (**D-8 = youtube_id now**, ISRC later). Migrations idempotent; verify no orphaned `song_genres` after dedup.
**Gate:** dedup + `total_rounds` drop must not affect song selection (no repeats within a game).

**Goal:** make the effective schema, the RPC signatures, and every spec doc agree with the running code. Docs are the authoritative spec — every drift is a bug by the repo's own rule.

**Backlog refs:** `04-tech-debt.md §E` + `§F` (schema hygiene), D-8.

---

## Tasks

### T6.1 · Residual docs-drift sync `[S — one PR]` ✅ (PR #199)
- [x] `data-model.md`: intro "Six tables" → **eleven** (the plan's "ten" under-counted — `game_round_attempts` mig 037 is a real table not in the §2 DDL block); §5/§6 "only `buzz_in` is anon-EXECUTE" → the **six** anon-callable RPCs (`buzz_in`, `award_attempt`, `release_buzz_lock`, `select_next_song`, `peek_next_song`, `extend_game` — mig 039 added `extend_game` after this file was written). §6 table callers also fixed (award_attempt/start_round/end_round were wrong). (T-DocDataModel)
- [x] `api-contracts.md`: fixed "Only one function is exposed to anon" (§3, was ~line 357). The X-Manager-Token list (~line 71) was **already** corrected in a Phase 4 sync — no removed endpoints remained there. Left the 409s as-is (correct). (T-DocContracts)
- [x] `game-rules.md`: replaced the "(admin auth)" host transitions with the open-hosting / `manager_token` model. (T-DocGameRules)
- [x] Spot-sweep: caught the same drift class in `architecture.md` (§5 "Nothing else" + stale `select-song`/`award-points` gate list), `diagrams/internal.md` + its hand-maintained `internal.html` mirror (the "only RPC anon EXECUTEs on" auth-table rows and the `/games/*` Mermaid node listing removed endpoints). All synced.

### T6.2 · Drop the orphan `total_rounds` column `[S]` — T-TotalRounds ✅ (PR #TBD)
- [x] Migration `040_drop_total_rounds_column.sql` = `ALTER TABLE active_games DROP COLUMN IF EXISTS total_rounds` (mig 015 promised it; only relaxed NOT NULL). Re-verified no code path reads/writes it (2026-07-10: repo-wide grep hits only mig 003/015 + docs — zero frontend/backend/RPC refs). Applied twice against the local stack (APPLY #2 = idempotent skip NOTICE); a create-game INSERT that omits the column still succeeds. Synced `data-model.md` ledger (015 → "actual DROP is mig 040"; appended 038/039/040). Prod apply deferred to maintainer go (hard-required-nothing drop).

### T6.3 · `UNIQUE(songs.youtube_id)` `[M]` — T-YoutubeUnique, **D-8**
- [ ] One-time dedup pass on prod's catalog (identify + merge duplicate `youtube_id`s, repoint `song_genres` — the known Avicii "Wake Me Up" double-upload is a same-song-different-video case, not a `youtube_id` dupe).
- [ ] Add the unique index migration (idempotent).

---

## Removed (verified done, 2026-07-07)
- ~~T-DocRPC~~ — `peek_next_song` documented, §8 in-body auth acknowledged, removed endpoints reframed.
- ~~T-DocRunbook~~ — DR section corrected in Phase 1; the stale legacy-AWS-fallback line was removed in the planning reorg.
- ~~T-Roadmap~~ — the historical `docs/roadmap.md` was removed in the planning reorg.
- ~~T6.4 RLS coverage~~ — `test_rls_anon.py` already covers `game_round_attempts` + the three `game_history` tables (the separate **fixture** fix remains Phase 7 T7.5).

## Exit gate (Phase 6)
- [ ] Every doc in `docs/` that describes schema/RPC/auth matches the code (spot-check each changed section against the cited migration/router).
- [ ] Migrations idempotent (CI applies twice); no dedup regression (row counts sane, no orphaned `song_genres`).
- [ ] **Full-Game Exit Gate** — the dedup + `total_rounds` drop don't affect song selection or gameplay (song pick still works, no repeats within a game).
