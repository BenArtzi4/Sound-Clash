# Phase 6 — Correctness & Docs/Data-Model Hygiene

## ▶ Kickoff
**Model:** Opus 4.8. Follow [EXECUTION-CONTRACT.md](EXECUTION-CONTRACT.md).
**Scope re-verified 2026-07-07:** the original "76-item docs-drift sweep" had no backing item list, and most named drifts were already fixed by the Phase 1–3 doc syncs (`rpc-functions.md` done; the 409-vs-410 contracts claim turned out false; runbook + roadmap items closed in the planning reorg). **T6.1 is now a single-session sync of ~4 residual drifts — no workflow needed.** T6.2/T6.3 are separate single-session migration PRs (**D-8 = youtube_id now**, ISRC later). Migrations idempotent; verify no orphaned `song_genres` after dedup.
**Gate:** dedup + `total_rounds` drop must not affect song selection (no repeats within a game).

**Goal:** make the effective schema, the RPC signatures, and every spec doc agree with the running code. Docs are the authoritative spec — every drift is a bug by the repo's own rule.

**Backlog refs:** `04-tech-debt.md §E` + `§F` (schema hygiene), D-8.

---

## Tasks

### T6.1 · Residual docs-drift sync `[S — one PR]`
- [ ] `data-model.md`: intro "Six tables" → ten; §5/§6 "only `buzz_in` is anon-EXECUTE" → the five anon-callable RPCs (`buzz_in`, `award_attempt`, `release_buzz_lock`, `select_next_song`, `peek_next_song`). (The `game_round_attempts`/history-table omissions are already fixed.) (T-DocDataModel)
- [ ] `api-contracts.md`: fix "Only one function is exposed to anon" (~line 329); drop the removed `select-song`/`attempt`/`end-round` from the X-Manager-Token list (~line 71). Do **not** "fix" the 409s — code really returns 409 for already-ended /bonus,/end. (T-DocContracts)
- [ ] `game-rules.md`: replace the "(admin auth)" host transitions with the `manager_token` model. (T-DocGameRules)
- [ ] Spot-sweep: grep the four synced docs for other pre-open-hosting or pre-direct-RPC phrasing while in there.

### T6.2 · Drop the orphan `total_rounds` column `[S]` — T-TotalRounds
- [ ] Migration `ALTER TABLE active_games DROP COLUMN IF EXISTS total_rounds` (mig 015 promised it; only relaxed NOT NULL). Confirm no code path reads/writes it (verified none as of 2026-07-07); sync `data-model.md`.

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
