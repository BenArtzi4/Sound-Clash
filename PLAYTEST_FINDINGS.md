# Sound Clash playtest — findings & follow-ups

Driven through Playwright MCP against `http://localhost:5173` with backend on `:8000`.
Game: 3 teams (Alpha / Bravo / Charlie) + Manager + Display, 3-round happy path
plus a battery of edge / simple cases. This file is a punch list — each item has
a Severity, where it surfaced, and (for fixes) a concrete plan. Items at the
bottom are suggestions for later that I deliberately did **not** ship.

## Status legend

- 🔴 **Bug** — actual misbehaviour, fix in this pass.
- 🟠 **UX gap** — works but reads wrong / surprises a user; fix in this pass if cheap.
- 🟢 **Suggestion** — nice-to-have, leaving for the user to decide.

---

## Findings

### ✅ 1. YouTube end-screen / pause-state suggestions revealed song info

**Where:** Manager — embedded YouTube player after a buzz.

**Symptom:** When a team buzzed, the player paused and YouTube's embedded
"more videos" / channel cards appeared inside the iframe with related
song titles + thumbnails (e.g. "Carly Rae Jepsen — Call Me Maybe",
"Britney Spears — Oops!...I Did It Again"). Same with the natural-end
state.

**Fix shipped:** `YouTubePlayer` already covers the iframe on natural
end via the existing `ended` state. Added a new `coverWhilePaused` prop
that the manager wires from `lockedTeam != null`, so the same black
"Ready" overlay is layered over the player while a buzz is being scored.
The host (and the room behind them) no longer sees the YouTube pause-
state thumbnail at all between buzz and award. (`YouTubePlayer.tsx` +
`ManagerConsolePage.tsx`.)

### ✅ 2. Team view never showed a "Winner" celebration after the game ended

**Where:** `/team/<code>` after the host clicks End game.

**Symptom:** All teams saw `Game over.` with the regular Scoreboard and
a still-rendered (disabled) BUZZ button. No celebration, no winner
acknowledgement — Display + Manager already showed a confetti podium.

**Fix shipped:** When `state.game.status === "ended"`, the team page
short-circuits to render the same `<EndScreen>` component the manager
and display use. The team's row gets a "WINNER" pill if they won, and
the BUZZ button is gone (there's nothing left to do). One existing
test was updated from asserting "Game over." to asserting on the
"FINAL RESULTS" heading + absence of the buzz button.

### ✅ 3. End-round / Restart-song stayed active after a round was already scored

**Where:** Manager Console.

**Symptom:** After awarding points (or marking wrong), the round showed
"Song ended" but `End round` and `Restart song` remained enabled.
Clicking `End round` again hit `award_points` a second time, which the
SQL function rejects with `round_already_ended` → confusing red toast.

**Fix shipped:** The manager now derives `roundAlreadyScored` from
`state.currentRound?.ended_at != null` and folds that into both
`endRoundDisabled` and `restartDisabled`. After scoring, the only
enabled action is "Next round", which is the intended path.

### ✅ 4. YouTube iframe rendered in Hebrew on a Hebrew-locale browser

**Where:** Manager — iframe player chrome.

**Symptom:** Captions / button labels ("הפעלת הסרטון" / "הסתרת כפתורי
הנגן") rendered in Hebrew because the YT API picks up the operator's
browser/IP locale.

**Fix shipped:** Added `hl: "en"` to the `playerVars` config in
`YouTubePlayer.tsx`. Cosmetic, but keeps the host's view consistent
across operator locales.

---

## Edge cases — exercised live, all green ✅

- ✅ Timeout with no buzz → ending the round awards 0 points, advances cleanly
- ✅ Wrong-buzz penalty → team can go and stay negative (-3, then -6 after a 2nd wrong)
- ✅ Two teams buzzing → first to commit wins (`Latecomer buzzed first` shown
  to the loser), losing team's button locks instantly via Realtime
- ✅ Restart song → works (calls `selectSong(currentSong.id)`); the round
  counter does increment because the SQL function unconditionally bumps
  `round_number + 1`. Documented intentional behaviour
  (`docs/game-rules.md` §11), see suggestion below for a UX polish.
- ✅ Manager tab refresh mid-round → manager-token survives via
  localStorage, console rehydrates, song reloads into the player from
  `current_round.song_id`
- ✅ Team tab refresh → team-id survives via localStorage, scoreboard +
  ranking restored
- ✅ End game from `waiting` state → goes straight to FINAL RESULTS with
  a clean "Game ended without any teams." copy
- ✅ Joining mid-round → late team sees current round number in their
  header, their BUZZ button is live immediately
- ✅ Duplicate team name → backend returns 409, friendly inline error
  "That team name is already taken."
- ✅ Mobile viewport (390 × 844) on team / manager / display — all three
  flow on a phone (manager has a known overlap, see below)
- ✅ Display "Enable sound" toggle — flips between 🔇 / 🔊 cleanly
- ✅ Empty-state for invalid display code → "Game has ended or expired."
  (note in suggestions — wording could be clearer for never-existed)
- ✅ Empty-state for invalid join code → "That game code does not exist."

## Items I deliberately did NOT fix (and why)

- 🔵 **Catalog typo "Californiacation"**: this is a row in the `songs`
  table, not a code bug. Worth a separate fixup but lives in the seed
  data / production catalog — out of scope for a UI fix PR.

- 🔵 **`docs/playwright-mcp-findings.md`**: separate doc, not touched
  to keep this PR scoped to the UI fixes the user asked for.

---

## Suggestions (not implementing — for the user to choose)

- 🟢 **Buzz audio / haptic feedback**: when a team buzzes, every
  team's device could vibrate (`navigator.vibrate(50)`) and the
  manager could hear a short blip. Makes simultaneous buzzes feel
  less ambiguous on phones.

- 🟢 **Manager "Skip song" shortcut**: separate from `End round
  (timeout)`. Currently the only way to abandon a song is to end the
  round, which records a timeout. A dedicated "Skip" that doesn't
  attribute a timeout would be useful for "audio's broken / pick
  another."

- 🟢 **`Restart song` should not bump the round counter**: SQL-level.
  Today `start_round` always does `round_number + 1`, so "Restart
  song" jumps Round 2 → Round 3 even though the host's mental model is
  "play the same one again." Fix would be a new RPC (e.g. `restart_round`)
  that reuses `current_round_id` and just clears `buzzed_team_id` /
  resets `ended_at` — no new `game_rounds` row. Behavioural change,
  needs `docs/game-rules.md` §11 update.

- 🟢 **Lobby "Start" gate by team count**: today the host can hit
  Start game with 0 teams (no error, just an empty round). Disable
  Start until ≥1 team has joined, or warn with a toast.

- 🟢 **Mobile manager: floating action bar overlaps scoreboard**:
  on 390 × 844 the sticky `Restart / End round / Next` footer covers
  the top scoreboard row. Either pad the scroll area by the footer
  height or auto-collapse the footer when the action set is purely
  passive (between rounds).

- 🟢 **Mobile manager: song title is visible in the iframe thumbnail**.
  Even with `coverWhilePaused`, the *first* frame of a paused video
  shows the title above the thumbnail. Could be hidden by always
  starting `coverWhilePaused=true` until the round is "in progress
  and unbuzzed".

- 🟢 **Display QR contrast**: light grey on light gradient background
  is hard for a phone camera at TV-watching distance. Bump to
  white-on-black inside the QR card.

- 🟢 **Display empty-state copy for invalid code**: currently shows
  "Game has ended or expired." even if the code never existed. A
  separate "Game not found." path would be friendlier.

- 🟢 **Manager kick-team UI**: `kickTeam` API + backend endpoint exist
  (`DELETE /games/{code}/teams/{id}` + `kickTeam` in `lib/api.ts`),
  but no UI surfaces it. Would be a single trash icon next to each
  team in the manager Teams panel.

- 🟢 **Per-team buzz history**: a small "buzzed first N times" stat at
  the end of the game — fun for replay value.

- 🟢 **Catalog cleanup**: at least one row has a typo
  ("Californiacation" → "Californication"). A periodic catalog audit
  (or a host-side report-broken-row link) would help.
