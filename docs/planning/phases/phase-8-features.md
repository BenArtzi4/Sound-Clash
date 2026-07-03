# Phase 8 — Features

**Goal:** add the party-night capabilities that make people want to run Sound Clash again — after the app is fast, smooth, and resilient (Phases 1–4) so features land on a solid base.

**Blocking:** Tier-1 features are mostly autonomous; the strategic ones need **D-5 (win conditions), D-6 (Hebrew i18n), D-9 (binary assets)**.

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
- [ ] **X-Reclaim** — per-team reclaim token. `[M]` — **build with D-4** (per-team secret closes buzz-spoofing too).

### Tier 3 — DB-additive
- [ ] **X-Streaks** — team streak "on fire" badge (re-adds `game_round_attempts` to the publication deliberately). `[M]`
- [ ] **X-GenreSpotlight** — per-round genre spotlight (additive `select_next_song` column). `[M]`

### Tier 4 — strategic (decisions)
- [ ] **X-Win** — win conditions. `[M]` **D-5** (game-rule change).
- [ ] **X-i18n** — Hebrew RTL UI. `[L]` **D-6** (strategic).

---

## Decisions touched
- **D-5** (win conditions), **D-6** (Hebrew i18n), **D-9** (binary assets for SFX/recap/hero) — all gate their respective features.
- **D-4** (per-team auth) should ship *with* X-Reclaim.

## Exit gate (per feature + phase)
- [ ] Each feature: test at the right layer, CHANGELOG entry, docs updated if it touches schema/RPC/contract.
- [ ] Additive RPC columns via `CREATE OR REPLACE` (stable PostgREST routing).
- [ ] Binary assets committed only per D-9's agreed location.
- [ ] **Full-Game Exit Gate** after each feature — plus, for X-Win/X-AutoRelease/X-Extend, an explicit game that exercises the new end/auto-advance/extend path.
