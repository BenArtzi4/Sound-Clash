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

_None open._

- **F-P1-6 · `manager_token` loss mid-game orphans the game** `[bug]` — ✅ **RESOLVED**: X-Recovery shipped — `HostRecoveryLink.tsx` is a re-openable token-gated host link/QR on the manager console, so a host whose localStorage is wiped re-authenticates from the same or another device.
- **F-P1-9 · Cross-game score write via `buzz_in`** `[security, medium]` — ✅ **RESOLVED 2026-07-10 (PR #211, mig 041)**: `buzz_in`'s conditional UPDATE now carries `AND EXISTS (SELECT 1 FROM game_teams gt WHERE gt.id = p_team_id AND gt.game_code = p_game_code)`, so a non-member team can never win the lock (race preserved). Merged + applied + verified on prod. Optional defense-in-depth (mirror in `award_attempt`) noted for a future mig 045 — low priority (`award_attempt` credits the game-scoped `active_games.buzzed_team_id`, not a client team-id).

---

## P2 — Edge / minor

### F-P2-1 · Lost localStorage orphans a player; `UNIQUE(game_code,name)` blocks rejoin `[bug]` — ✅ **RESOLVED 2026-07-10 (PR #210)**
- **Evidence:** `003_ephemeral_tables.sql` unique constraint; identity lives only in `game:<code>:team`.
- **Failure:** evicted player can't re-attach to their score; same-name rejoin 409s ("team name already taken").
- **Fix (shipped):** D-4 declined per-team tokens, so `POST /games/{code}/teams` (`_join_team_blocking`) now SELECTs the existing `(game_code, name)` row and returns it (same id, preserved score) before inserting — a same-name rejoin is a reclaim, not a 409. No schema change; the UNIQUE constraint is the concurrent-insert backstop. Phase 5 T5.7, PR #210.

### F-P2-5 · Per-IP rate limits collapse to one global bucket behind the proxy `[availability, low]` — ✅ **FIXED (code-only, PR #231, deployed + edge-verified)** · behavioral two-IP check owed → **[issue #247](https://github.com/BenArtzi4/Sound-Clash/issues/247)**
- **Evidence:** `backend/app/middleware/rate_limit.py` keyed slowapi on `get_remote_address` (`request.client.host`); behind Render/Cloudflare every client shares the proxy hop's IP → one bucket.
- **Failure:** the documented per-IP limits (security-rls.md §4/§6, "10/min/IP") weren't real; on a busy night >10 legitimate hosts creating games in a rolling minute could 429 an innocent host (shared-bucket self-DoS). Brute-force posture unchanged (128-bit token / 16-char admin password carry that). Found by the 2026-07-10 security re-verify.
- **Fix (shipped):** turned the key_func into `client_ip` (`rate_limit.py`) which keys on **`CF-Connecting-IP`** — the Cloudflare header Render sets to the true client IP and *overwrites*, so it's spoof-resistant — falling back to the **rightmost** `X-Forwarded-For` hop (the proxy-appended, non-spoofable one; the leftmost is client-forgeable since Render only appends) then the socket peer. **Code-only** — no `--proxy-headers`/Dockerfile change needed, so no deploy-config flag. Unit tests (`test_rate_limit_key.py`) + a per-IP bucketing integration test (`test_rate_limits.py`). Caveat: trusts the edge; origin-bypass hardening is T5.6's job. Docs: `security-rls.md` §6. Effort S.

### F-P2-6 · Bulk-import CSV upload has no size cap `[availability, low]` — ✅ **RESOLVED 2026-07-10 (PR #215)**
- **Fix (shipped):** `admin_songs.py` bulk-import now rejects an oversized upload with **HTTP 413** (5 MB cap) before buffering/parsing. Admin-gated backend hardening; no buzz-path, no migration.

### F-P2-4 · CSV formula injection in the two curation exporters `[security, low]` — Phase 5 T5.1
- **Evidence:** `add-songs.html:420` + `review.js:403` `csvCell` quote per RFC-4180 but don't neutralize a leading `= + - @ \t \r`; titles derive from attacker-uploadable YouTube titles.
- **Fix:** prefix a leading `'` (or force-quote) when the cell starts with a formula trigger — one mirrored one-liner. Effort S. (Tooling-only; not user-facing, but cheap.) **Maintainer-gated** — the two files are the maintainer's uncommitted in-flight `tools/song-curation/*` (off-limits); see MAINTAINER-GATED-TASKS.md #9.

---

## Cross-references to security fixes (decisions resolved 2026-07-04 — see `05`)
- **D-1 = A** — fix the `manager_token` leak by moving it to a secret table (was F-P0-1). **✅ shipped** (mig 034, game_secrets). Phase 5 hardening items build on it.
- **D-2 = accept** — real-time answer leak documented as a casual-play tradeoff. Phase 5 T5.8.
- **D-3 = A** — Cloudflare edge + WAF for the direct-RPC/Realtime surface + enumeration. Phase 5 T5.6. **Infra/ops — not yet implemented.**
- **D-4 = accept** — buzz-spoofing accepted + documented; F-P2-1 gets same-name reclaim instead. Phase 5 T5.7.
