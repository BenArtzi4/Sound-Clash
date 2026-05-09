# Playwright-MCP findings — 2026-05-09

Hands-on browser walkthrough of the live local stack (Vite dev + FastAPI on
preview Supabase) driven by the Playwright MCP server. Game played end-to-end
with three teams (Alpha via UI, Bravo + Charlie joined through the FastAPI
`/games/{code}/teams` route, buzzes fired through Supabase PostgREST RPC
directly so the buzz race is real). Coverage: 4 rounds spanning happy path
(title + artist), wrong-buzz (-3 → negative score), timeout (no buzz), buzz
race (concurrent `buzz_in` for two teams, single winner), bonus, end-game,
podium, manager + team refresh mid-game, duplicate name, missing game code,
mobile viewport, late-join after end-game.

## Bugs

### 1. Manager refresh mid-round shows "No round started yet"  · severity: high

**Repro:**
1. Host a game, join as a team, start a round.
2. While the round is active, hit F5 on the manager tab.

**Expected:** the manager keeps seeing the current song's title, artist and
the YouTube player loaded with the song. They can score a buzz, restart the
song, etc.

**Actual:** the round-controls card shows "No round started yet.", the
YouTube player is blank, and Restart-song is greyed out. The round itself
is still alive on the server (`active_games.current_round_id` is set, the
team page still says "Round N", a buzz still locks).
The manager can't recover the round - the only path forward is "Next
round", which selects a *different* song and abandons the in-flight one.

**Why:** `currentSong` lives in `useState` on `ManagerConsolePage` and is
only ever populated by a successful `selectSong` response. The reducer in
`useGameChannel` rehydrates the round row (`game_rounds` has `song_id`) but
the manager never resolves that song id back to a song record after a
remount. There is no `getSong` for anon callers, but RLS already lets anon
SELECT directly from `songs`.

**Fix:** add a rehydration effect in `frontend/src/pages/ManagerConsolePage.tsx`
that watches `state.currentRound.song_id` and, when set with no `currentSong`
mirror, fetches the song row via `supabase.from("songs").select(...).eq("id", ...)`,
populates `currentSong`, and pushes it into the YouTube player once it's
ready. Regression test in `ManagerConsolePage.test.tsx` checks that a
hydrate snapshot with `currentRound.song_id` set ends up showing the song
title and calling `loadVideoById` with the right youtube id.

### 2. YouTube related-video overlay spoils future songs  · severity: high

**Repro:**
1. Start a round.
2. Don't buzz, don't end the round - let the song play to its natural end
   (or skip the player to the song's end with the YT controls when they
   show).

**Expected:** when the song ends, the player goes blank / shows our own
"song ended" cover, with no further YouTube content rendered.

**Actual:** YouTube's end-screen renders inside the iframe with a grid of
"watch next" video tiles (channel-related videos when `rel=0`, plus any
end-screen elements the uploader configured). In the play-through I did,
the recommendations from "We Will Rock You" included tracks like "Don't
Stop Me Now" and "We Are The Champions" - both Queen songs that are in
the seed catalog under the same Rock genre. Anyone watching the manager
tab sees what's coming in future rounds.

**Why:** `YouTubePlayer.tsx` sets `rel: 0`, but `rel=0` only restricts the
endscreen's recommendations to the same channel; it does *not* hide the
endscreen. We never listen for `YT.PlayerState.ENDED` (state code 0), so
once the song finishes the iframe stays in its end state and the
host-side opaque cover (`YouTubePlayer.module.css` `.cover`) has been
hidden ever since `onReady` first fired.

**Fix:** add an `onStateChange` event to the `YT.Player` config. On
`event.data === 0` (ENDED), call `stopVideo()` and flip an `ended` state
flag that re-renders the opaque cover (text: "Song ended"). Reset
`ended` to `false` whenever `loadVideoById` is invoked or when the
imperative `stop()` handle is called for an explicit round end. The
fix lives in `frontend/src/components/YouTubePlayer.tsx`. Regression test
in `frontend/src/components/YouTubePlayer.test.tsx` exercises the
`onStateChange` callback the API gives us and asserts the cover comes
back + `stopVideo` is called.

## Suggestions (no fix in this pass — leave for human review)

These came up while playing but are scope decisions rather than defects:

- **Team end-screen has no celebration / exit.** When the host ends the
  game, the team page just renders "Game over." with the buzz button
  disabled and the scoreboard underneath. No "you won!" confetti, no link
  back to the home page. Compare with the display, which gets a full
  podium. Could mirror `EndScreen` on the team page (with a "you placed
  Nth" line) and add a "Back to home" link.

- **`Round 0` text in the manager header before the game starts.** The
  pill says `waiting` and the meta says `Round 0`. The team and display
  pages avoid the `Round 0` line until status flips to `playing`. The
  manager could match.

- **No way for the host to skip a round mid-song without scoring.** Today
  "End round" with no buzz reads as a timeout (`points_awarded: 0`,
  toast says "Round skipped"), but if the host accidentally picks a song
  the UI shows full title + artist before they even play it. A "Skip
  song" button that pulls a fresh selection without leaving the round in
  the rounds table would feel more natural than the current Restart /
  End round / Next round trio. (Restart re-selects the same song;
  there's no way to roll the dice again on this round number.)

- **Bonus picker doesn't tell the host who already received a bonus this
  game.** Every Bonus click is independent on the server side
  (`award_bonus` is per-team, no per-round limit), but there's no UI
  affordance to notice if you double-bonused the same team. A small
  "+4 (1)" badge on the team button after each award would help.

- **Manager iframe is still interactive on the manager tab.** Even with
  `controls=0`, the YouTube branding overlay lets the host click into
  YouTube proper (`Watch on YouTube` link in the endscreen, channel
  thumbnail, etc.). Adding a transparent click-blocker over the iframe
  during gameplay (re-enable for fullscreen) would lock the host's
  workspace down.

- **Bravo's score going negative is correctly displayed (-3) but the
  scoreboard pill colour stays neutral.** A red badge for negative
  scores would make it obvious at a glance during dramatic comebacks.

- **Display page sound toggle is opt-in per session.** Worth confirming
  with the human whether the default-off is right, or whether we should
  remember the choice in `localStorage` so the operator doesn't have to
  re-enable sounds every time they reload the display.

- **The 10-second answer timer occasionally renders below 10 on first
  paint** (saw "6s" once after a buzz). The `lockedAt` is a Postgres
  `now()` value, so the floor of `(serverTimeNow - lockedAt) / 1000` is
  in principle right, but the manager's first realtime
  `commit_timestamp` (used to set the offset) can have several hundred
  ms of round-trip skew, especially when Supabase is in Singapore.
  Could clamp the initial display to `ANSWER_DURATION_SEC` until the
  first interval tick has run.
