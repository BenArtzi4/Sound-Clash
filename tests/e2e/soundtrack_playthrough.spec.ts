// Full 4-team / 15-round playthrough that validates the derive-soundtrack-
// from-genre behaviour (migration 028) end to end against a real catalog.
//
// The game is created across Soundtracks + Rock + Pop so select_next_song
// draws a mix of soundtrack and normal rounds. Each round we:
//   - detect the round type from the manager UI (single "Correct +15"
//     button => soundtrack; the title/artist split => normal),
//   - assert the matching UI contract on BOTH manager and display
//     (soundtrack: 🎬 badge + one reveal row; normal: no badge + two rows),
//   - have a rotating team buzz and score it (single token per round to keep
//     the click flow deterministic),
//   - assert the running total lands precisely on the display scoreboard
//     (which also proves the RPC committed before we advance the round).
//
// Finally we assert at least one of each round type was exercised and the
// podium renders.
//
// Robustness notes: the manager scoring/next-round handlers early-return while
// a prior RPC is in flight (`busy`). The buttons disable optimistically, so a
// naive click-then-click-next can be silently dropped. We therefore (a) only
// click a single scoring control per round, (b) gate on the score landing on
// the display before advancing, and (c) retry the advance until the round
// number actually increments.

import { test, expect, type Page } from "@playwright/test";
import { openManagerAndCreateGame } from "./fixtures/manager-context";
import {
  countSongsInGenreSlugs,
  getCurrentSongId,
  songIsSoundtrack,
} from "./fixtures/supabase-admin";
import { buzzAndExpectWinner, joinAsTeam, type JoinedTeam } from "./fixtures/team-context";

// Target a full 15-round game. Against the real prod catalog (run locally) the
// pool is in the hundreds so all 15 run; against the tiny CI seed we cap at the
// available pool so the game never hits `no_more_songs`. Both still cover at
// least one soundtrack and one normal round.
const TARGET_ROUNDS = 15;
const GENRE_NAMES = ["Soundtracks", "Rock", "Pop"];
const GENRE_SLUGS = ["soundtracks", "rock", "pop"];
const TEAM_NAMES = ["Alpha", "Bravo", "Charlie", "Delta"];

// Click "Next round" (or "Start game" for round 1) and wait for the round
// number to actually increment, retrying if the click was dropped because a
// scoring RPC was still in flight.
async function advanceTo(page: Page, nextRoundNum: number): Promise<void> {
  const heading = page.getByText(new RegExp(`Round ${nextRoundNum}$`, "i"));
  for (let attempt = 0; attempt < 4; attempt++) {
    await expect(page.getByTestId("start-round")).toBeEnabled({ timeout: 15_000 });
    await page.getByTestId("start-round").click();
    try {
      await expect(heading).toBeVisible({ timeout: 8_000 });
      return;
    } catch {
      /* click likely dropped (busy); retry */
    }
  }
  throw new Error(`failed to advance to Round ${nextRoundNum}`);
}

test("4-team 15-round playthrough: soundtrack + normal rounds score and reveal correctly", async ({
  browser,
}, testInfo) => {
  test.setTimeout(360_000);

  const pool = await countSongsInGenreSlugs(GENRE_SLUGS);
  const totalRounds = Math.min(TARGET_ROUNDS, pool);
  expect(totalRounds, "need at least 2 songs to cover both round types").toBeGreaterThanOrEqual(2);

  const manager = await openManagerAndCreateGame(browser, { genreNames: GENRE_NAMES });
  const code = manager.gameCode;

  const teams: JoinedTeam[] = [];
  for (const name of TEAM_NAMES) {
    teams.push(await joinAsTeam(browser, code, name));
  }

  const displayCtx = await browser.newContext();
  const display = await displayCtx.newPage();
  await display.goto(`/display/${code}`);
  for (const name of TEAM_NAMES) {
    await expect(display.locator(`[data-team-id]:has-text("${name}")`).first()).toBeVisible({
      timeout: 15_000,
    });
  }

  const totals: Record<string, number> = Object.fromEntries(TEAM_NAMES.map((n) => [n, 0]));
  let soundtrackRounds = 0;
  let normalRounds = 0;

  await advanceTo(manager.page, 1);

  for (let i = 0; i < totalRounds; i++) {
    const roundNum = i + 1;
    await expect(manager.page.getByText(new RegExp(`Round ${roundNum}$`, "i"))).toBeVisible({
      timeout: 15_000,
    });

    // Ground-truth round type from the DB (set in the same transaction that
    // advanced the round), so detection never races the UI transition.
    const songId = await getCurrentSongId(code);
    expect(songId, "game should have a current song").toBeTruthy();
    const isSoundtrack = await songIsSoundtrack(songId!);

    // Assert both manager and display CONVERGE to the correct UI for this
    // round type. These are auto-retrying assertions, so they tolerate either
    // screen lagging the round transition.
    if (isSoundtrack) {
      await expect(manager.page.getByTestId("soundtrack-badge")).toBeVisible();
      await expect(manager.page.getByTestId("score-soundtrack")).toBeVisible();
      await expect(manager.page.getByTestId("score-title")).toHaveCount(0);
      await expect(manager.page.getByTestId("score-artist")).toHaveCount(0);
      await expect(display.getByTestId("soundtrack-badge")).toBeVisible();
      await expect(display.getByTestId("display-reveal-title")).toHaveCount(1);
      await expect(display.getByTestId("display-reveal-artist")).toHaveCount(0);
    } else {
      await expect(manager.page.getByTestId("soundtrack-badge")).toHaveCount(0);
      await expect(manager.page.getByTestId("score-soundtrack")).toHaveCount(0);
      await expect(manager.page.getByTestId("score-title")).toBeVisible();
      await expect(manager.page.getByTestId("score-artist")).toBeVisible();
      await expect(display.getByTestId("soundtrack-badge")).toHaveCount(0);
      await expect(display.getByTestId("display-reveal-title")).toHaveCount(1);
      await expect(display.getByTestId("display-reveal-artist")).toHaveCount(1);
    }

    const team = teams[i % teams.length]!;
    await buzzAndExpectWinner(team);

    let expected: number;
    if (isSoundtrack) {
      if (soundtrackRounds === 0) {
        await manager.page.screenshot({ path: testInfo.outputPath("soundtrack-manager.png") });
        await display.screenshot({ path: testInfo.outputPath("soundtrack-display.png") });
      }
      await manager.page.getByTestId("score-soundtrack").click();
      expected = 15;
      soundtrackRounds++;
    } else {
      // Alternate single-token awards: even normal round = Correct Song (+10),
      // odd = Correct Artist (+5). One click per round avoids the optimistic
      // double-click race in the title+artist combo path.
      if (normalRounds === 0) {
        await manager.page.screenshot({ path: testInfo.outputPath("normal-manager.png") });
        await display.screenshot({ path: testInfo.outputPath("normal-display.png") });
      }
      if (normalRounds % 2 === 0) {
        await manager.page.getByTestId("score-title").click();
        expected = 10;
      } else {
        await manager.page.getByTestId("score-artist").click();
        expected = 5;
      }
      normalRounds++;
    }
    totals[team.name] += expected;

    // Gate on the exact new total landing on the display scoreboard row (the
    // score span renders the exact number) -- this proves the attempt
    // committed, so the manager's `busy` flag has cleared before we advance.
    const row = display.locator(`[data-team-id]:has-text("${team.name}")`).first();
    await expect(row.getByText(String(totals[team.name]), { exact: true })).toBeVisible({
      timeout: 15_000,
    });

    if (roundNum < totalRounds) {
      await advanceTo(manager.page, roundNum + 1);
    }
  }

  expect(soundtrackRounds, "expected at least one soundtrack round in the mix").toBeGreaterThan(0);
  expect(normalRounds, "expected at least one normal round in the mix").toBeGreaterThan(0);

  // Close the game out and confirm the podium renders.
  const endGameBtn = manager.page.getByTestId("end-game");
  await expect(endGameBtn).toBeEnabled();
  await endGameBtn.click();
  const dialog = manager.page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /^end game$/i }).click();

  await expect(display.getByRole("heading", { name: /final results/i })).toBeVisible({
    timeout: 15_000,
  });
  await expect(display.getByText("WINNER")).toBeVisible();
});
