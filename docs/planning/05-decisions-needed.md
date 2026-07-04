# 05 — Decisions needed (big changes — ask before code)

These change architecture, game rules, infra, cost posture, or are hard to reverse. Per the maintainer's instruction, **none is implemented without a decision.** Each has a recommendation so the call is easy. Everything *not* here is autonomous.

> **Resolved 2026-07-04:** D-1 → **A** (move token to a secret table); D-3 → **A** (Cloudflare edge + WAF); D-4 → **accept** the tradeoff (no per-team tokens); D-5 & D-6 → **out of scope for now**. D-2/D-7/D-8/D-9 proceed on their recommendations unless the maintainer objects. Details inline below.

---

## D-1 · How to fix the `manager_token` leak (CRITICAL security) `[architecture]`

**Problem:** the host credential is readable by any anon client (table SELECT `USING(true)` on `active_games` + full-row Realtime fan-out). Anyone seeing the projector's game code can hijack host controls. This is the one *critical* finding.

**Options:**
- **(A, recommended) Move `manager_token` out of `active_games`** into a sibling table with no anon SELECT (e.g. `game_secrets(game_id, manager_token)`), and change `useGameChannel` to stop `select('*')`. The token never enters an anon-readable row or a Realtime payload. Migration + a small hook change; the direct-RPC model is unchanged (RPCs still validate `p_manager_token`). ~M.
- **(B) Keep the column but exclude it** from the anon SELECT via a column-scoped grant / view, and select explicit columns in the client. Lighter, but REPLICA IDENTITY FULL still puts the token in the WAL/Realtime payload unless the column is dropped from the replicated row — fragile. Not recommended.
- **(C) Accept the risk** (casual party game, code is on-screen anyway). Cheapest, but it means "anyone in the room can hijack" — inconsistent with wanting production-perfect.

**Recommendation: A.** Ship it in Phase 1/5 as the first security item. ✅ **DECIDED: A (move to secret table).**

## D-2 · Pre-reveal answer leak `[architecture — may accept]`

**Problem:** the moment `select_next_song` inserts the round, `game_rounds.song_id` fans out to every subscriber and one anon `songs` SELECT resolves title/artist — a determined player can see the answer before the reveal.

**Options:**
- **(A) Redesign the reveal path:** keep title/artist off the anon-readable round row; expose only `youtube_id` for the *current* round via a code-gated SECURITY DEFINER RPC; stamp title/artist onto `game_rounds` only once a token is scored. Meaningful work; doesn't fully stop a determined player (the `youtube_id` is still identifiable via YouTube) but removes the one-query answer.
- **(B, recommended) Accept + document** as a known trust tradeoff for casual play, and instead invest in the cheaper integrity wins (D-4 team auth). The clip is *audible to the whole room anyway*; a cheater reading the DB is a narrow, self-defeating exploit at a party.

**Recommendation: B (accept + document)** unless you consider competitive integrity important. ⏳ **Proceeding on B (accept + document)** unless you object.

## D-3 · Rate-limiting / abuse protection for the direct-RPC + Realtime surface `[infra]`

**Problem:** slowapi only guards FastAPI. The five anon RPCs + anon table reads + Realtime have **no throttle**. One anon-key holder can loop heavy reads / open many Realtime connections and degrade or knock over all live games on the free tier. Also: anon can enumerate *every* live game via one `select=*`.

**Options:**
- **(A, recommended) Front the Supabase REST/Realtime hostnames with the existing Cloudflare edge** (Pages already runs on Cloudflare): per-IP rate limits, a WAF rule blocking bulk `select=*` on the ephemeral tables, DDoS mitigation. Plus Supabase Realtime connection caps + a Grafana alert (I-Alert). Real infra work, no code.
- **(B) Supabase-native network restrictions / connection caps only** — lighter, less flexible.
- **(C) Alert-only** (I-Alert) and accept the exposure for now — a niche party game is a low-value target.

**Recommendation: A eventually; C now** (alert first, build the edge proxy when traffic justifies it). ✅ **DECIDED: A (Cloudflare edge + WAF)** — build the full edge proxy. (I-Alert still ships in Phase 1 as the cheap first layer; the edge proxy is the durable fix.)

## D-4 · Per-team authentication (stop buzz-spoofing) `[auth/schema]`

**Problem:** `buzz_in` doesn't verify the caller owns `p_team_id`, and team ids are broadcast to all clients — so any participant can buzz *as another team*, and the host may score the wrong side.

**Options:**
- **(A, recommended) Issue a per-team join secret** (mirroring `manager_token`); validate it inside `buzz_in`. Also lets an evicted player reclaim their team (X-Reclaim / F-P2-1) — build them together. ~M/L; touches the join contract + `buzz_in`.
- **(B) Accept** as a casual-play tradeoff (friends don't grief each other).

**Recommendation: A** — it's the one integrity gap that a normal player could *accidentally or mischievously* trip, and it doubles as the reclaim-token feature. ❌ **DECIDED: B (accept the tradeoff).** No per-team tokens. **Consequences:** buzz-spoofing stays an accepted risk (document it in `security-rls.md`); the lost-localStorage rejoin bug (F-P2-1) is instead addressed by a *simple same-name reclaim* — join with the same name in the same game returns the existing team row rather than 409-ing (no token, consistent with accepting the tradeoff). X-Reclaim (the token version) is dropped; the same-name reclaim is the lightweight substitute.

## D-5 · Win conditions (target score / round limit) `[game rule]`

Games have no finish line. Add optional `win_target_score` / `win_round_limit` at create (nullable, additive migration mirroring `selected_decades`), auto-ending when hit. **Game-rule change.**
**Recommendation: yes, as an *optional* setting** (default off = today's behavior, no surprise). ❌ **DECIDED: out of scope for now.** Revisit later; not on the current roadmap.

## D-6 · Hebrew (RTL) UI internationalization `[strategic]`

~Half the catalog is Hebrew; the audience is largely Israeli; the UI is English-only and the roadmap lists i18n out-of-scope. A Hebrew RTL UI could widen the audience but touches all six pages + an RTL layout pass + a translation workflow. **L effort, strategic.**
**Recommendation: defer** unless growing the Hebrew-speaking audience is a near-term goal — but it's your call, not a default. ❌ **DECIDED: out of scope for now.** Revisit later.

## D-7 · Move scoring authority into the DB `[touches hot RPC]`

Refactor `award_attempt` to compute points server-side (booleans + `is_soundtrack`) instead of trusting client-supplied amounts (T-Scoring). Removes a real corruption footgun and ~6-way duplication, but changes the hot manager RPC and its callers.
**Recommendation: yes, carefully** — behind the buzz-race + full-game gate, in its own PR, after Phase 3's other RPC edits so we touch the function once. ⏳ **Proceeding on yes (careful)** when we reach Phase 7 unless you object.

## D-8 · Dedup strategy for the catalog: `UNIQUE(youtube_id)` vs ISRC (#146) `[data model]`

T-YoutubeUnique adds a structural unique key on `youtube_id` after a dedup pass; issue #146 proposes canonical ISRC recording IDs for cross-upload dedup. These overlap.
**Recommendation:** do `UNIQUE(youtube_id)` now (cheap, structural, catches exact-video dupes); treat ISRC as a *separate later* enrichment for same-song-different-upload dedup. ⏳ **Proceeding on `UNIQUE(youtube_id)` now** unless you object.

## D-9 · Binary assets (need sign-off per repo rule) `[assets]`

Several improvements/features add or replace binary assets: re-encode `how-to-play-hero.png` (2.3MB → WebP), sound-effect files (X-SFX), recap-card generation (X-Recap). The binary-asset rule says ask before committing audio/images and confirm where they live.
**Recommendation:** re-encode the hero image in-repo (it's already there, just smaller); host new audio in the repo under `frontend/public/sfx/` (tiny files). ⏳ **Proceeding on small optimized assets in-repo** unless you object — I'll still confirm at the moment of committing each new binary (per the binary-asset rule).

---

## Summary — resolved 2026-07-04

| # | Decision | Outcome |
|---|---|---|
| D-1 | manager_token leak | ✅ **A** — move to a secret table (do first) |
| D-2 | pre-reveal answer leak | ⏳ accept + document (proceeding) |
| D-3 | RPC/Realtime abuse | ✅ **A** — Cloudflare edge + WAF (I-Alert first as cheap layer) |
| D-4 | per-team auth | ❌ **accept** tradeoff — no per-team tokens; F-P2-1 gets a simple same-name reclaim instead |
| D-5 | win conditions | ❌ out of scope for now |
| D-6 | Hebrew i18n | ❌ out of scope for now |
| D-7 | scoring authority in DB | ⏳ careful yes at Phase 7 (proceeding) |
| D-8 | dedup key | ⏳ `UNIQUE(youtube_id)` now, ISRC later (proceeding) |
| D-9 | binary assets | ⏳ small optimized assets in-repo (proceeding; confirm each commit) |

- **Still needs a flag before doing** (CI/repo rule, not a full decision): T-RLSCI, T-BundleBudget, T-e2eGate, T-Lockfile, the new DR workflow (Phase 1 T1.6). These get a quick heads-up in their PR, not a blocking question.
- **Everything else in `01`–`04`:** autonomous — branch, build, test, PR, gate.
