# Phase 6 — Correctness & Docs/Data-Model Hygiene

## ▶ Kickoff
**Model:** Opus 4.8 to apply. **USE A WORKFLOW for the 76-item docs-drift sweep** (T6.1) — one agent per doc: diff doc-vs-code, produce exact edits, verify against migrations/routers; consolidate into 1–2 PRs. Follow [EXECUTION-CONTRACT.md](EXECUTION-CONTRACT.md) for each PR.
**Single-session PRs:** T6.2 (drop `total_rounds`) and T6.3 (`UNIQUE(youtube_id)` after a dedup pass — **D-8 = youtube_id now**, ISRC later). Migrations idempotent; verify no orphaned `song_genres` after dedup. **Gate:** dedup + `total_rounds` drop must not affect song selection (no repeats within a game).

**Goal:** make the effective schema, the RPC signatures, and every spec doc agree with the running code. Docs are the authoritative spec here — every drift is a bug by the repo's own rule.

**Why:** 76 docs-drift findings is the single largest category. Left alone, the spec actively misleads future work (and security reasoning — `data-model.md` currently *under*states the anon surface). Steady autonomous cleanup; interleaves with any phase.

**Backlog refs:** `04-tech-debt.md §E` + `§F` (schema hygiene), D-8.

**Session shape:** **ultracode workflow** — 76 items across 7 docs is exactly "N independent instances of the same shape." Fan out one agent per doc to diff doc-vs-code and produce the exact edits, verify each against migrations/routers, then a single consolidation PR. The schema migrations are separate single-sessions.

---

## Tasks

### T6.1 · Docs-drift sweep `[M — workflow]`
- [ ] `data-model.md`: regenerate the DDL from migrations 001–033 (add `game_round_attempts` + indexes, the three `game_history` tables, `total_rounds`; fix "six tables"→ten; fix §5/§6 anon-EXECUTE list + `award_attempt` signature + callers). (T-DocDataModel)
- [ ] `rpc-functions.md`: add `peek_next_song`; fix §8 auth claims; remove references to deleted REST endpoints. (T-DocRPC)
- [ ] `api-contracts.md`: fix 409-vs-410 status codes; correct the anon-exposed-functions claim; drop removed endpoints. (T-DocContracts)
- [ ] `game-rules.md`: replace "(admin auth)" host transitions with the `manager_token` model. (T-DocGameRules)
- [ ] `runbook.md`: correct the stale DR claim (pairs with I-DR). (T-DocRunbook)
- [ ] `roadmap.md`: reconcile "Out of Scope" (game history + song export shipped). (T-Roadmap)
- [ ] Sweep the smaller drifts surfaced in the map corpus (CLAUDE.md Scoreboard mention, etc.).

### T6.2 · Drop the orphan `total_rounds` column `[S]` — T-TotalRounds
- [ ] Migration `DROP COLUMN IF EXISTS active_games.total_rounds` (mig 015 promised it); sync `data-model.md`.
- [ ] Confirm no code path reads/writes it (backend + frontend grep).

### T6.3 · `UNIQUE(songs.youtube_id)` `[M]` — T-YoutubeUnique, **D-8**
- [ ] One-time dedup pass on prod's ~1025 rows (identify + merge duplicate `youtube_id`s, repoint `song_genres`).
- [ ] Add the unique index migration.
- [ ] Decide D-8 (this now; ISRC later) before starting.

### T6.4 · `game_round_attempts` / `game_history` RLS tests `[S]` — extends T-RLSFix
- [ ] Add RLS coverage for the four tables the suite currently omits (may be done in Phase 3/5).

---

## Decisions touched
- **D-8** (youtube_id-unique vs ISRC) gates T6.3. Recommendation: youtube_id now.

## Exit gate (Phase 6)
- [ ] Every doc in `docs/` that describes schema/RPC/auth matches the code (spot-check each changed section against the cited migration/router).
- [ ] Migrations idempotent (CI applies twice); no dedup regression (row counts sane, no orphaned `song_genres`).
- [ ] `data-model.md` DDL is regenerable-from-migrations (note the method in the doc).
- [ ] **Full-Game Exit Gate** — the dedup + `total_rounds` drop don't affect song selection or gameplay (song pick still works, no repeats within a game).
