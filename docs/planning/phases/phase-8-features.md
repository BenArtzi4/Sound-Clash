# Phase 8 — Features

**Goal:** add the party-night capabilities that make people want to run Sound Clash again — after the app is fast, smooth, and resilient (Phases 1–4) so features land on a solid base.

**Scope (resolved 2026-07-04):** D-5 (win conditions) and D-6 (Hebrew i18n) are **out of scope for now** — dropped from this phase. D-4 (per-team tokens) was **declined**, so X-Reclaim becomes a lightweight same-name reclaim (moved to Phase 5 T5.7). D-9 (binary assets) proceeds with per-commit confirmation. Tier-1 features are autonomous.

**Backlog refs:** `03-features.md` (full ranked list + schema mappings).

**Session shape:** one session per feature (each ships with a CHANGELOG entry + a test + the Full-Game Exit Gate). Independent features can run as parallel worktree sessions.

---

## Build order

### Tier 1 — ship first (high impact, cheap)
- [ ] **X-Skip** — host Skip-song button (also lands as F-P1-4 in Phase 4; if Phase 4 ran, this is done). `[S]`
- [ ] **X-Presets** — one-tap genre/decade presets on create. `[S]` frontend-only.
- [ ] **X-SFX** — display sound effects (buzz/correct/wrong). `[S]` **D-9** (audio assets).
- [ ] **X-AutoRelease** — auto lock-release on countdown expiry (opt-in host toggle). `[S]`
- [ ] **X-DarkRoom** — dark-room projector theme. `[S]` frontend-only.

### Tier 2 — high/medium, medium build
- [ ] **X-Recovery** — host recovery link/QR (also F-P1-6 in Phase 4). `[M]`
- [ ] **X-Extend** — extend-game RPC + countdown (also I-Expiry in Phase 4). `[M]`
- [ ] **X-Recap** — shareable post-game recap card PNG. `[M]` **D-9** (generated image).
- [ ] **X-Practice** — solo single-device practice mode. `[M]`
- [ ] ~~**X-Reclaim** — per-team reclaim token.~~ → replaced by a lightweight **same-name reclaim** in Phase 5 T5.7 (D-4 declined the token version).

### Tier 3 — DB-additive
- [ ] **X-Streaks** — team streak "on fire" badge (re-adds `game_round_attempts` to the publication deliberately). `[M]`
- [ ] **X-GenreSpotlight** — per-round genre spotlight (additive `select_next_song` column). `[M]`

### ~~Tier 4 — strategic~~ (out of scope for now)
- ~~**X-Win** — win conditions~~ — D-5 out of scope; revisit later.
- ~~**X-i18n** — Hebrew RTL UI~~ — D-6 out of scope; revisit later.

---

## Decisions touched
- **D-9** (binary assets for SFX/recap/hero) — proceeds with per-commit confirmation.
- **D-5** (win conditions) and **D-6** (Hebrew i18n) — out of scope for now.

## Exit gate (per feature + phase)
- [ ] Each feature: test at the right layer, CHANGELOG entry, docs updated if it touches schema/RPC/contract.
- [ ] Additive RPC columns via `CREATE OR REPLACE` (stable PostgREST routing).
- [ ] Binary assets committed only in the agreed in-repo location, confirmed per commit.
- [ ] **Full-Game Exit Gate** after each feature — plus, for X-AutoRelease/X-Extend, an explicit game that exercises the new auto-advance/extend path.
