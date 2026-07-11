# 02 — Improvements (performance & resilience)

Improvements to *existing* behavior. This is where the north star lives: **fast loads, instant buttons, no lag, no mid-game surprises.** Each item tags its lever — `load` / `smoothness` / `buzz-latency` / `resilience` — and effort (S/M/L). Almost all are low-risk autonomous work.

**Framing reminder:** the `<200ms` buzz number is network+fan-out bound; the items below labeled `load` and `smoothness` are what a user actually *feels* as speed. We ship them as smoothness/load wins, not as "buzzer latency fixes."

> **§A (Load — Phase 1), §B (Smoothness — Phase 2), and §C (Backend-path & Realtime — Phase 3) all shipped and were removed 2026-07-05.** Detail in git history / `CHANGELOG.md`. Section letters below are kept stable (§D, §E) so existing cross-references don't break.
> **Removed 2026-07-07 (verified against code):** I-Resume ✅ shipped (Phase 4 T4.2, PR #187 — `useResumeOnVisible` + `YouTubePlayer.resumeIfPaused()`); I-Reconnect ✅ shipped earlier than planned (PR #163, Phase 2 — `TeamGameplayPage` distinguishes CONNECTING…/RECONNECTING…, closes T4.9); I-Skip ❌ de-scoped (PR #186 — no Skip button, no blocklist; Next round + played-song exclusion already cover dead videos).
> **Removed 2026-07-08:** I-QueueDrain ✅ shipped (Phase 4 T4.3, PR #190 — event gate opens only on a successful snapshot; pending queue capped at 500 with overflow resync).

---

## D. Resilience — mid-game failure modes — Phase 4

Make a real party survive the things that go wrong. (Several of these are also bugs in `01`; here they're framed as the resilience posture.)

- **I-Expiry · Expiry countdown + token-gated extend RPC.** ✅ shipped 2026-07-09 (PR #195, T4.8) — mig 039 `extend_game` (token-gated, `GREATEST(expires_at, now()) + 1h`); the console's "Ends at HH:MM" hint becomes a warning banner with the single **Keep playing +1h** action in the last ~20 min (manager-only, no auto-extend per maintainer).
- **I-GoneDerive · Cascade-ordering guard on the team page.** ✅ shipped 2026-07-08 (PR #192, T4.4) — the team page distinguishes the expiry cascade from a kick via `expires_at` on the server-offset clock; T-CascadeTest pins the ordering.
- **I-NextRecover · Revert the double-buffer on Next-round failure.** ✅ shipped 2026-07-08 (PR #193, T4.5) — on `select_next_song` failure the whole in-gesture swap rolls back: promoted player stopped, `activeKey` reverted, the still-current round's song reloaded, peeked song re-prebuffered so a retry keeps the fast path.
- **I-FinalBoard · Host-visible final board that survives the abrupt delete.** ✅ shipped 2026-07-09 (T4.11) — `useGameChannel` exposes a `finalBoard` last-known-state snapshot (teardown-shrink skipped once ended/expired so a live kick still prunes); Display/Team render the `EndScreen` podium under the banner, Manager keeps the podium **and** the durable-table song export. Pure last-known-state — no `game_history` UI, no admin read, zero new infra.

## E. Disaster recovery & ops (`resilience`/ops) — remaining

> I-DR (committed catalog dump + CI drift-guard) **shipped** in Phase 1 (`catalog-backup.yml`); removed here.

- **I-Liveness · Proactive dead-YouTube-ID check.** `[M]` Batch-validate `youtube_id`s off-line (oEmbed/Data API); flag dead songs so they stop dripping "video unavailable" mid-party across ~1025 aging videos. **→ [issue #248](https://github.com/BenArtzi4/Sound-Clash/issues/248).**
  - **Phase 1 ✅ shipped (PR #TBD, 2026-07-12) — report-only, autonomous.** `POST /admin/songs/check-availability` (admin-gated, paged) probes a page of the catalog via YouTube oEmbed and returns `{checked, dead[], unknown[], next_offset}`. Conservative: only a definitive oEmbed `404` is `dead`; `401`/`400`/`5xx`/timeout are `unknown` (never mislabels a live video). Stdlib `urllib` (no new dep), bounded concurrency, ≤250/page to stay under Render's ~100s timeout. No schema change, no cron, no auto-skip — the admin reviews and fixes/deletes via the existing song CRUD. Validated against real oEmbed (200→ok, 404→dead) and 16 tests.
  - **Phase 2 — FLAGGED follow-up for the maintainer (needs a prod migration + a scheduled job → not autonomous).** Turn the report into an auto-skip so dead videos never reach a round:
    1. **Migration** (`db/migrations/0NN_song_unavailable.sql`): add `songs.unavailable_at timestamptz NULL` (nullable, no default — an idempotent `ADD COLUMN IF NOT EXISTS`). A non-null value means "confirmed dead, skip it".
    2. **RPC filter:** add `AND unavailable_at IS NULL` to the unplayed-song picker in both `select_next_song` (mig 022) and `peek_next_song` (mig 029) so a flagged song is never selected or prebuffered. Label the PR `run-stress` + `run-e2e` (buzz-path/migration). Update `docs/rpc-functions.md` + `docs/data-model.md`.
    3. **Writer:** either (a) a tiny admin `POST /admin/songs/mark-unavailable` the operator calls with the Phase-1 `dead[]` ids (button-averse-friendly: no UI, one curl), or (b) let the availability scan optionally persist `unavailable_at` for `404`s behind an explicit `?commit=true` flag. Keep 401/400/unknown out of any auto-write.
    4. **Schedule (maintainer-gated CI/infra):** a weekly `pg_cron` job or a `.github/workflows/*` cron that pages the whole catalog and marks 404s — a new workflow file needs the `.claude/rules/ci-and-repo-config.md` flag. Alternatively leave it fully manual (operator runs the scan + mark step monthly). **A re-check must clear `unavailable_at` when a video returns 200 again** (transient 404s / restored videos), so the skip self-heals.
    - **Why it's out of Phase-1 scope:** the migration is a prod schema change and the cron is a CI/infra change — both are flag-first per the execution contract. Ship them as a separate maintainer-coordinated PR.
- **I-Alert · Grafana alerts on Realtime connections + message quota.** `[S]` Alert as concurrent Realtime connections approach the ~200 free-tier cap and on monthly message consumption — surfaces both the DoS vector (D-3) and organic overload before players hit "can't subscribe." **Maintainer-only** (needs Grafana dashboard access) — this is the open leftover from Phase 1 T1.7.
- **I-Vitals · Web-Vitals dashboard once Faro sends.** `[S]` `getWebInstrumentations()` already collects vitals; once #145 is fixed, a Grafana dashboard for LCP/TTFB/INP by route makes the load wins measurable.
- **I-BuzzMetric · Server-authoritative buzz-latency metric.** `[M — partial]` A fanout metric now exists (`telemetry.ts` emits `realtime.fanout_ms` from commit_timestamp→local receipt). Still missing: emit `locked_at` so DB-lock latency separates from fanout latency and the buzz span stops conflating RPC + WAL + fanout.
