# Phase 8 — Features

## ▶ Kickoff
**Model:** Opus 4.8. Follow [EXECUTION-CONTRACT.md](EXECUTION-CONTRACT.md). One session/PR per feature; each ships a CHANGELOG entry + a test + passes the full-game gate.
**Build order:** Tier-1 first (X-Presets ✅ → then X-SFX, X-DarkRoom), then Tier-2/3. **D-9 = small optimized assets in-repo** (confirm each binary commit). **Out of scope:** D-5 (win conditions) and D-6 (Hebrew i18n). **Parallel-friendly:** independent features can run as separate worktree sessions.

**Goal:** add the party-night capabilities that make people want to run Sound Clash again — after the app is fast, smooth, and resilient (Phases 1–4) so features land on a solid base.

**Scope (resolved 2026-07-04):** D-5 (win conditions) and D-6 (Hebrew i18n) are **out of scope for now** — dropped from this phase. D-4 (per-team tokens) was **declined**, so X-Reclaim becomes a lightweight same-name reclaim (moved to Phase 5 T5.7). D-9 (binary assets) proceeds with per-commit confirmation. Tier-1 features are autonomous.

**Tracking (2026-07-12):** shipped features were ticked, and the three standing vetoes (X-AutoRelease / X-Practice / X-Streaks — "don't do it") were pruned. Each **not-started** feature is now tracked as its own GitHub issue so it can be picked up independently: **X-SFX → #244**, **X-DarkRoom → #243**, **X-Recap → #245**, **X-GenreSpotlight → #246**.

**Backlog refs:** `03-features.md` (full ranked list + schema mappings).

**Session shape:** one session per feature (each ships with a CHANGELOG entry + a test + the Full-Game Exit Gate). Independent features can run as parallel worktree sessions.

---

## Build order

### Tier 1 — ship first (high impact, cheap)
- ~~**X-Skip** — host Skip-song button~~ — **declined in Phase 4 T4.1 (PR #186)**: Next round + the persistent "Video unavailable" state already cover dead videos; don't rebuild. `[—]`
- [x] **X-Presets** — one-tap genre/decade presets on create. `[S]` frontend-only. ✅ **shipped live on prod (PR #241, 2026-07-11)**.
- [ ] **X-SFX** — display sound effects (buzz/correct/wrong). `[S]` **D-9** (audio assets). **Must not slow the buzz** (display-only). → **issue #244**.
- [ ] **X-DarkRoom** — dark-room projector theme. `[S]` frontend-only. → **issue #243**.

### Tier 2 — high/medium, medium build
- [x] **X-Recovery** — host recovery link/QR. `[M]` ✅ **shipped** (`HostRecoveryLink.tsx` — token-gated recovery URL + QR on the manager console; closes **F-P1-6**).
- [x] **X-Extend** — extend-game RPC + countdown. `[M]` ✅ **shipped** (PR #195, T4.8 — mig 039 `extend_game` + `ExpiryCountdown` "Keep playing +1h"; = I-Expiry).
- [ ] **X-Recap** — shareable post-game recap card PNG. `[M]` **D-9** (generated image). → **issue #245**.
- [ ] ~~**X-Reclaim** — per-team reclaim token.~~ → replaced by a lightweight **same-name reclaim** in Phase 5 T5.7 (D-4 declined the token version).

### Tier 3 — DB-additive
- [ ] **X-GenreSpotlight** — per-round genre spotlight (additive `select_next_song` column). `[M]` — value case owed ("why is it good?") before building; DB migration → `run-stress`/`run-e2e` labels + in-prompt merge auth. → **issue #246**.

### ~~Tier 4 — strategic~~ (out of scope for now)
- ~~**X-Win** — win conditions~~ — D-5 out of scope; revisit later (explain what a "win condition" is when revisited).
- ~~**X-i18n** — Hebrew RTL UI~~ — D-6 out of scope; maintainer does not want to do it.

---

## Decisions touched
- **D-9** (binary assets for SFX/recap/hero) — proceeds with per-commit confirmation.
- **D-5** (win conditions) — out of scope for now; when revisited, explain what a "win condition" is first.
- **D-6** (Hebrew i18n) — out of scope; maintainer does not want to do it.

## Pruned 2026-07-12 (maintainer cleanup)
- **Shipped → ticked:** X-Presets (#241), X-Recovery, X-Extend (#195).
- **Vetoed → dropped:** X-AutoRelease, X-Practice, X-Streaks ("don't do it").
- **Not-started → tracked as issues:** X-SFX #244, X-DarkRoom #243, X-Recap #245, X-GenreSpotlight #246.

## Exit gate (per feature + phase)
- [ ] Each feature: test at the right layer, CHANGELOG entry, docs updated if it touches schema/RPC/contract.
- [ ] Additive RPC columns via `CREATE OR REPLACE` (stable PostgREST routing).
- [ ] Binary assets committed only in the agreed in-repo location, confirmed per commit.
- [ ] **Full-Game Exit Gate** after each feature — plus, for X-Extend, an explicit game that exercises the extend path.
