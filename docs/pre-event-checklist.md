# Pre-Event Validation Checklist

How to prove the live game at `https://www.soundclash.org` works end-to-end — buzzers, manager console, display, scoring, every button, and the edge cases — before running it with a large group (e.g. 10 teams / 40 people).

This is the reusable distillation of the full validation run performed before the 2026-07 event (2 agent passes + a DB-verified 10-team/30-round e2e; both blockers found were fixed and shipped — PRs #176/#178). Re-run it before any big event, or after any risky change close to one.

**How to use**
- A Claude Code session works through the **agent-driven** sections automatically. Paste the prompt from §"Session prompt" below into a fresh session.
- The host walks through the **human dry-run** (§8) with real phones.
- Log only **game-breaking** issues (blocks play / wrong results / crash / unusable at scale) — cosmetic findings are out of scope. Mark items `[x]` pass · `[!]` blocker · `[~]` couldn't test.

---

## 0. Ground truth (expected values)

**URLs / routes:** Live app `https://www.soundclash.org` · API `https://api.soundclash.org` · Home `/` · Join `/join` and `/join/<CODE>` · Team `/team/<CODE>` · Create `/manager/create` · Console `/manager/game/<CODE>` · Display `/display` and `/display/<CODE>`.

**Formats:** Game code = 6 chars, A–Z + digits 2–9 (no 0/1/O/I), case-insensitive on entry. Team name = 1–30 chars, unique per game (duplicate → 409). One phone per team.

**Scoring (labels / points / test-ids):**

| Action | Label | Points | test-id |
|---|---|---|---|
| Correct Song | `Correct Song` | +10 | `score-title` |
| Correct Artist | `Correct Artist` | +5 | `score-artist` |
| Soundtrack correct (replaces both, soundtrack rounds) | `Correct` | +15 | `score-soundtrack` |
| Wrong | `Wrong` | −3 (waived once right after a correct — "free guess") | `score-wrong` |
| Bonus | `Bonus` → pick team | +4 | `score-bonus`, `bonus-team-<id>` |
| Continue round | `Continue round` | — | `continue-round` |
| Start / Next | `Start game` → `Next round` | — | `start-round` |
| End game | `End game` (confirm dialog) | — | `end-game` |
| Buzzer | `BUZZ` | — | `buzz` |

**Known facts to plan around:**
- Join rate limit 30/min per IP, create 10/min per IP (slowapi) — but the limiter keys on the CDN egress IP, so in practice it did **not** throttle per real client IP (good for shared venue Wi-Fi; verified 35 rapid joins → zero 429s).
- The **4-hour expiry clock starts at game creation**, not the first round. Create the real game shortly before kickoff.
- Song-pool exhaustion: Next round with no songs left → "All songs in your selected genres have been played…" toast and no advance. Pick enough genres (≥3) for 12+ rounds.
- No "Kick team" button in the UI; kicking is a token-gated `DELETE /games/<code>/teams/<id>` API call.
- Display shows the **top 5 teams** (with a "+N more teams playing" hint below), auto-fitting screens from 1080p down to short/OS-scaled laptops — regression-tested by `tests/e2e/display_fit.spec.ts`. Every other team still sees its own place + score on its phone.

## 1. Pre-flight (agent)

- [ ] `GET https://api.soundclash.org/health` → 200, supabase reachable (also wakes the Render cold start).
- [ ] `bash ./tests/smoke/post_deploy.sh https://api.soundclash.org` exits 0 (needs the Bash sandbox disabled; creates + ends a real game).
- [ ] `https://www.soundclash.org` Home loads with zero app console errors (ignore third-party YouTube `compute-pressure` warnings).

## 2. Automated regression (agent, local stack — deepest net)

Requires Docker + `supabase start`. If the local stack can't come up, skip and note it — §3–§7 against prod still validate the real thing.

- [ ] `cd tests/e2e && npm test` — or at minimum: `buzzer_race`, `full_game`, `multi_buzz_round`, `wrong_buzz_recovery`, `token_claim_constraints`, `bonus_flow`, `soundtrack_playthrough`, `reconnection`, `expiration`, `display_fit`, `four_teams_twenty_rounds`, and `ten_teams_thirty_rounds` (the DB-verified scale spec).
- [ ] Any failure: confirm it isn't a known Windows/Docker flake (`.claude/rules/lessons-learned.md`) before treating it as real.

## 3. Host + display + join (agent, live on prod)

- [ ] Create a game (≥3 genres) → redirect to console; code shown; status `waiting`; manager token in localStorage, not on screen; a second context without the token sees "You're not the host of this game."
- [ ] Display shows waiting banner, QR → `/join/<CODE>`; joined teams appear live.
- [ ] Join: valid join lands on `/team/<CODE>`; invalid code → 404 message; duplicate name → 409 message.
- [ ] `Start game` enables once the player is ready; round 1 starts and a song plays.

## 4. Buzzer + scoring — every button (agent, prod, 3–4 team tabs)

- [ ] Buzz states: WAITING (pre-start) → BUZZ → BUZZED! → YOU BUZZED / SOMEONE ELSE BUZZED; lock <200ms; concurrent buzz race → exactly one winner.
- [ ] Correct Song +10, then a second team Correct Artist +5; both chips claimed → Continue and Song/Artist buttons disable.
- [ ] Wrong −3 does **not** lock the team out; free-guess waiver right after a correct; Continue releases the lock with no score; re-claim guard (no double points).
- [ ] Soundtrack round: single `Correct` +15 + 🎬 badge.
- [ ] Bonus +4 works in both `waiting` and `playing`.
- [ ] End game → confirm → FINAL RESULTS podium on all three screens; manager gets the song export.
- [ ] Scores agree on manager, teams, and display throughout. Hebrew titles render on all three screens.

## 5. Scale + known-risk (agent, prod)

- [ ] Join 10 teams; display shows **all** rows + QR on a 1080p window *and* a short window (~1280×720).
- [ ] Advance ≥12 rounds without pool exhaustion using the real event genres.
- [ ] A burst of rapid joins produces no 429s (or, if it ever does, players switch to cellular data).

## 6. Resilience (agent, prod)

- [ ] Team, manager, and display tabs each survive a mid-game reload (identity, score, buzzer intact).
- [ ] A late joiner mid-game appears on the display and can buzz next round.
- [ ] Joining an ended game → 410 message.

## 7. Adverse paths (agent, prod — post-Phase-4 additions)

- [ ] Background the host tab mid-song, return → the song auto-resumes (unless a buzz is being scored).
- [ ] If a video errors: persistent "Video unavailable" state + Next round recovers cleanly.

## 8. Human dry-run (host, real devices — before the event)

- [ ] 10 phones scan the QR, join with distinct names, all appear on the display.
- [ ] Several phones buzz at the same instant → exactly one winner everywhere.
- [ ] Score a few rounds with every button; scores match on phones and display.
- [ ] ≥8 rounds play reliably on the venue network; buzz feels instant; end game → podium.

## Go / No-Go

All agent sections pass with zero open blockers **and** the human dry-run is done → **GO**. Any open game-breaking issue → fix and re-run the affected section first.

---

## Session prompt

> Validate that the Sound Clash game works end-to-end before a live event. Read `docs/pre-event-checklist.md` and drive §1–§7 live against production (`https://www.soundclash.org`) with the Playwright MCP browser (sandbox disabled — it blocks non-GitHub egress). Create real games (they auto-expire in 4h; end them when done). Log ONLY game-breaking issues; report a final GO / NO-GO with what passed and any blockers. Do not fix anything unless asked afterwards.
