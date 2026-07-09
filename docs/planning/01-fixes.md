# 01 — Fixes (confirmed bugs)

Ranked P0 (fix now / production risk) → P1 (real user-facing bug) → P2 (edge/minor). Each item: evidence (`file:line`), the failure a user hits, the fix, and effort (S=hours, M=1–2 days, L=multi-day). Security-hole fixes that need an architecture call live in [05-decisions-needed.md](05-decisions-needed.md) and are cross-referenced here.

Legend for the perf tag on latency-adjacent items: `buzz-latency` (moves the <200ms number), `load` (time-to-playable), `smoothness` (perceived responsiveness).

> **Resolved items removed 2026-07-05** (shipped in Phases 1–3; detail in git history / `CHANGELOG.md`): F-P0-1 (manager_token leak → `game_secrets`, mig 034), F-P0-2 (catalog DR backup), F-P0-4 (deploy-before-migrate outage), F-P1-8 (busy flag dropped clicks), F-P2-2 (Continue pending flag), F-P2-3 (keep-warm immediate ping). IDs are intentionally not reused.
> **Resolved 2026-07-07** (Phase 4): F-P0-3 (deploy-during-game blank screen → `vite:preloadError` budget-guarded auto-reload + app-level `ErrorBoundary`; runbook §1.2; PR #185). F-P1-4 (dead-video Skip) was **de-scoped** (PR #186): the persistent "Video unavailable" state already ships, **Next round** already moves past a dead song, and select/peek exclude already-played songs — no Skip button, no blocklist.
> **Resolved 2026-07-08** (Phase 4): F-P1-1 (failed hydrate silently dropped all live events → the event gate now opens only on a successful snapshot, events keep queuing on failure, and the queue is capped at 500 with an overflow-triggered resync; PR #190). F-P1-2 (players bounced to Home at the 4h sweep → the team page now tells the expiry cascade apart from a kick via `expires_at` on the server-offset clock and shows the "ended or expired" banner in place; kick-from-live-game still redirects; T-CascadeTest + tightened `expiration.spec.ts`; PR #192). F-P1-3 (failed Next-round left the room in silence → the in-gesture double-buffer swap now rolls back fully on `select_next_song` failure: promoted player stopped, `activeKey` reverted, the still-current round's song reloaded, and the peeked song re-prebuffered so a retry keeps the fast path; PR #193). F-P1-5 (bonus optimistic toast could lie → "Sending +4…" info toast on click, success toast only after the Render call resolves, `busy`-gated in flight; PR #193).
> **Resolved 2026-07-09** (Phase 4): F-P1-7 (per-round song-metadata fetch gave up on the first transient error and blanked the round → both pages now resolve `song_id` via `fetchSongById()` in `lib/songMetadata.ts`, a cancellation-aware bounded backoff retry (5 attempts over ~7.5s); an authoritative "no row" is not retried; also closed tech-debt T-SongFetch by consolidating the duplicated select+cast; PR #194).

---

## P0 — Production risk

_None open._ (F-P0-3 shipped 2026-07-07 — Phase 4 T4.0, PR #185.)

---

## P1 — Real user-facing bugs

### F-P1-6 · `manager_token` loss mid-game orphans the game `[bug]` — Phase 4 T4.10
- **Evidence:** `managerToken.ts` — single credential, issued once at create, no re-issue; every host action is token-gated.
- **Failure:** if the host browser evicts localStorage (private mode, cache clear, device swap) the game is dead until the 4h sweep; players sit frozen.
- **Fix:** a host recovery affordance — a re-openable host link/QR embedding the token in the console — so the host can re-authenticate from the same or another device. Autonomous (frontend) once we decide the surface. Effort M. (Feature X-Recovery in `03`.)

---

## P2 — Edge / minor

### F-P2-1 · Lost localStorage orphans a player; `UNIQUE(game_code,name)` blocks rejoin `[bug]` — Phase 5 T5.7
- **Evidence:** `003_ephemeral_tables.sql` unique constraint; identity lives only in `game:<code>:team`.
- **Failure:** evicted player can't re-attach to their score; same-name rejoin 409s ("team name already taken").
- **Fix (decided):** D-4 declined per-team tokens, so the fix is a **simple same-name reclaim** — `join_team` returns the existing team row when the same name rejoins the same game (no token). Lands in Phase 5 T5.7. Effort S–M.

### F-P2-4 · CSV formula injection in the two curation exporters `[security, low]` — Phase 5 T5.1
- **Evidence:** `add-songs.html:420` + `review.js:403` `csvCell` quote per RFC-4180 but don't neutralize a leading `= + - @ \t \r`; titles derive from attacker-uploadable YouTube titles.
- **Fix:** prefix a leading `'` (or force-quote) when the cell starts with a formula trigger — one mirrored one-liner. Effort S. (Tooling-only; not user-facing, but cheap.)

---

## Cross-references to security fixes (decisions resolved 2026-07-04 — see `05`)
- **D-1 = A** — fix the `manager_token` leak by moving it to a secret table (was F-P0-1). **✅ shipped** (mig 034, game_secrets). Phase 5 hardening items build on it.
- **D-2 = accept** — real-time answer leak documented as a casual-play tradeoff. Phase 5 T5.8.
- **D-3 = A** — Cloudflare edge + WAF for the direct-RPC/Realtime surface + enumeration. Phase 5 T5.6. **Infra/ops — not yet implemented.**
- **D-4 = accept** — buzz-spoofing accepted + documented; F-P2-1 gets same-name reclaim instead. Phase 5 T5.7.
