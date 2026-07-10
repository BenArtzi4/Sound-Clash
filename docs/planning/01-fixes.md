# 01 — Fixes (confirmed bugs)

Ranked P0 (fix now / production risk) → P1 (real user-facing bug) → P2 (edge/minor). Each item: evidence (`file:line`), the failure a user hits, the fix, and effort (S=hours, M=1–2 days, L=multi-day). Security-hole fixes that need an architecture call live in [05-decisions-needed.md](05-decisions-needed.md) and are cross-referenced here.

Legend for the perf tag on latency-adjacent items: `buzz-latency` (moves the <200ms number), `load` (time-to-playable), `smoothness` (perceived responsiveness).

> **Resolved items removed 2026-07-05** (shipped in Phases 1–3; detail in git history / `CHANGELOG.md`): F-P0-1 (manager_token leak → `game_secrets`, mig 034), F-P0-2 (catalog DR backup), F-P0-4 (deploy-before-migrate outage), F-P1-8 (busy flag dropped clicks), F-P2-2 (Continue pending flag), F-P2-3 (keep-warm immediate ping). IDs are intentionally not reused.
> **Resolved 2026-07-07** (Phase 4): F-P0-3 (deploy-during-game blank screen → `vite:preloadError` budget-guarded auto-reload + app-level `ErrorBoundary`; runbook §1.2; PR #185). F-P1-4 (dead-video Skip) was **de-scoped** (PR #186): the persistent "Video unavailable" state already ships, **Next round** already moves past a dead song, and select/peek exclude already-played songs — no Skip button, no blocklist.
> **Resolved 2026-07-08** (Phase 4): F-P1-1 (failed hydrate silently dropped all live events → the event gate now opens only on a successful snapshot, events keep queuing on failure, and the queue is capped at 500 with an overflow-triggered resync; PR #190). F-P1-2 (players bounced to Home at the 4h sweep → the team page now tells the expiry cascade apart from a kick via `expires_at` on the server-offset clock and shows the "ended or expired" banner in place; kick-from-live-game still redirects; T-CascadeTest + tightened `expiration.spec.ts`; PR #192). F-P1-3 (failed Next-round left the room in silence → the in-gesture double-buffer swap now rolls back fully on `select_next_song` failure: promoted player stopped, `activeKey` reverted, the still-current round's song reloaded, and the peeked song re-prebuffered so a retry keeps the fast path; PR #193). F-P1-5 (bonus optimistic toast could lie → "Sending +4…" info toast on click, success toast only after the Render call resolves, `busy`-gated in flight; PR #193).
> **Resolved 2026-07-09** (Phase 4): F-P1-7 (per-round song-metadata fetch gave up on the first transient error and blanked the round → both pages now resolve `song_id` via `fetchSongById()` in `lib/songMetadata.ts`, a cancellation-aware bounded backoff retry (5 attempts over ~7.5s); an authoritative "no row" is not retried; also closed tech-debt T-SongFetch by consolidating the duplicated select+cast; PR #194).
> **Resolved 2026-07-10** (Phase 5): F-P2-1 (same-name rejoin 409'd / orphaned an evicted player → `POST /games/{code}/teams` now reclaims the existing `(game_code, name)` row, returning it with the preserved score instead of a 409; the mig-003 UNIQUE constraint stays as the concurrent-insert backstop; Phase 5 T5.7, PR #210).

---

## P0 — Production risk

_None open._ (F-P0-3 shipped 2026-07-07 — Phase 4 T4.0, PR #185.)

---

## P1 — Real user-facing bugs

### F-P1-6 · `manager_token` loss mid-game orphans the game `[bug]` — Phase 4 T4.10
- **Evidence:** `managerToken.ts` — single credential, issued once at create, no re-issue; every host action is token-gated.
- **Failure:** if the host browser evicts localStorage (private mode, cache clear, device swap) the game is dead until the 4h sweep; players sit frozen.
- **Fix:** a host recovery affordance — a re-openable host link/QR embedding the token in the console — so the host can re-authenticate from the same or another device. Autonomous (frontend) once we decide the surface. Effort M. (Feature X-Recovery in `03`.)

### F-P1-9 · Cross-game score write via `buzz_in` `[security, medium]` — **fix PR in flight (mig 041)**
- **Evidence:** `035_buzz_in_drop_round_update.sql` sets `active_games.buzzed_team_id = p_team_id` gated only by the FK (`buzzed_team_id → game_teams.id`), never scoped to `p_game_code`; `036_award_attempt_collapse_writes.sql` then `UPDATE game_teams SET score = … WHERE id = v_team_id` with no game filter. `award_bonus` (`014_scoring_revamp.sql:149-152`) already has the `team_not_in_game` guard buzz_in lacks. Found by the 2026-07-10 adversarial security re-verify (11-agent workflow); adversarially confirmed real & new (not D-4).
- **Failure:** a host holding only their OWN game's manager_token can plant a **foreign** game's team id in their own buzz lock (team UUIDs are anon-readable via the code) and then `award_attempt` mutates that foreign team's score in a game they hold no token for — the victim host never sees a buzz (the lock sits on the attacker's game), so the token gate is bypassed. The anon "lock-grief" half (planting a foreign/unknown team in a stranger's lock) is the same primitive at low severity. Bounded: transient scores in a 4h ephemeral game; attacker must know the victim's projector-visible 6-char code.
- **Fix:** add one race-preserving predicate to buzz_in's conditional UPDATE — `AND EXISTS (SELECT 1 FROM game_teams gt WHERE gt.id = p_team_id AND gt.game_code = p_game_code)` — so a non-member team can never win the lock (closes the vector at the source). Standalone idempotent mig **041**, buzz-path so `run-stress`+`run-e2e` labelled; **PR opened this session, handed to the maintainer to merge + apply mig 041 to prod** (buzz-path + prod migration, not self-merged). Optional defense-in-depth: mirror the guard in `award_attempt` when T7.1 rewrites it. Effort S.

---

## P2 — Edge / minor

### F-P2-1 · Lost localStorage orphans a player; `UNIQUE(game_code,name)` blocks rejoin `[bug]` — ✅ **RESOLVED 2026-07-10 (PR #210)**
- **Evidence:** `003_ephemeral_tables.sql` unique constraint; identity lives only in `game:<code>:team`.
- **Failure:** evicted player can't re-attach to their score; same-name rejoin 409s ("team name already taken").
- **Fix (shipped):** D-4 declined per-team tokens, so `POST /games/{code}/teams` (`_join_team_blocking`) now SELECTs the existing `(game_code, name)` row and returns it (same id, preserved score) before inserting — a same-name rejoin is a reclaim, not a 409. No schema change; the UNIQUE constraint is the concurrent-insert backstop. Phase 5 T5.7, PR #210.

### F-P2-5 · Per-IP rate limits collapse to one global bucket behind the proxy `[availability, low]` — **flag: touches deploy config**
- **Evidence:** `backend/app/middleware/rate_limit.py:12` keys slowapi on `get_remote_address` (`request.client.host`); uvicorn is not started with `--proxy-headers` (`backend/Dockerfile:33`). Behind Render/Cloudflare every client shares the proxy hop's IP → one bucket.
- **Failure:** the documented per-IP limits (security-rls.md §4/§6, "10/min/IP") aren't real; on a busy night >10 legitimate hosts creating games in a rolling minute can 429 an innocent host (shared-bucket self-DoS). Brute-force posture is unchanged (128-bit token / 16-char admin password carry that). Found by the 2026-07-10 security re-verify.
- **Fix:** start uvicorn `--proxy-headers --forwarded-allow-ips=<hop>` and switch the key_func to read the client IP from the TRUSTED `X-Forwarded-For` hop (treat XFF as client-spoofable — only trust the proxy-appended value). **Flag-before-doing** (Dockerfile/deploy config). Effort S.

### F-P2-6 · Bulk-import CSV upload has no size cap `[availability, low]`
- **Evidence:** `backend/app/routers/admin_songs.py:235` does an unbounded `await file.read()`, buffering the whole multipart body into the single free-tier worker's RAM.
- **Failure:** a large upload can OOM the worker. Admin-gated (`require_admin`), so it's a trusted-principal / self-inflicted DoS — no anon reachability, no privilege escalation, hence low. Found by the 2026-07-10 security re-verify.
- **Fix:** reject on `Content-Length` above a small cap and/or read in bounded chunks up to a few MB → HTTP 413 before decode/parse. Optionally batch the per-row DB writes in `csv_import._apply_blocking`. Effort S. (Clean autonomous backend hardening — no buzz-path, no migration.)

### F-P2-4 · CSV formula injection in the two curation exporters `[security, low]` — Phase 5 T5.1
- **Evidence:** `add-songs.html:420` + `review.js:403` `csvCell` quote per RFC-4180 but don't neutralize a leading `= + - @ \t \r`; titles derive from attacker-uploadable YouTube titles.
- **Fix:** prefix a leading `'` (or force-quote) when the cell starts with a formula trigger — one mirrored one-liner. Effort S. (Tooling-only; not user-facing, but cheap.)

---

## Cross-references to security fixes (decisions resolved 2026-07-04 — see `05`)
- **D-1 = A** — fix the `manager_token` leak by moving it to a secret table (was F-P0-1). **✅ shipped** (mig 034, game_secrets). Phase 5 hardening items build on it.
- **D-2 = accept** — real-time answer leak documented as a casual-play tradeoff. Phase 5 T5.8.
- **D-3 = A** — Cloudflare edge + WAF for the direct-RPC/Realtime surface + enumeration. Phase 5 T5.6. **Infra/ops — not yet implemented.**
- **D-4 = accept** — buzz-spoofing accepted + documented; F-P2-1 gets same-name reclaim instead. Phase 5 T5.7.
