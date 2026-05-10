// Wrong-buzz recovery scenarios. Wrong does NOT lock a team out -- they
// (or anyone else) can buzz again on the same song. Covers matrix
// scenarios 4, 8, 9, 15, and 18.
//
// Note on free-guess (migration 017): once any correct attempt has been
// scored in a round, the *next* wrong waives the -3 penalty (round-wide,
// next-attempt-only, consumed by use). Scenarios 4/8/9/18 wrong all the
// way through with no correct in between, so the -3 stands. Scenario 15
// has a correct first, so the next wrong is free.

import { test, expect } from "@playwright/test";
import {
  awardAndAdvance,
  awardAndContinue,
  markWrong,
  openManagerAndCreateGame,
  skipRound,
} from "./fixtures/manager-context";
import { buzzAndExpectWinner, expectBuzzGreen, joinAsTeam } from "./fixtures/team-context";

async function startNextRound(manager: { page: import("@playwright/test").Page }) {
  await expect(manager.page.getByTestId("start-round")).toBeEnabled();
  await manager.page.getByTestId("start-round").click();
}

async function expectScore(
  display: import("@playwright/test").Page,
  team: string,
  score: number,
) {
  await expect(
    display.locator(`[data-team-id]:has-text("${team}"):has-text("${score}")`).first(),
  ).toBeVisible({ timeout: 10_000 });
}

test("scenario 4: T1 wrong, T2 wins title, T3 wins artist", async ({ browser }) => {
  const manager = await openManagerAndCreateGame(browser, { genreName: "Rock" });
  const t1 = await joinAsTeam(browser, manager.gameCode, "Alpha");
  const t2 = await joinAsTeam(browser, manager.gameCode, "Bravo");
  const t3 = await joinAsTeam(browser, manager.gameCode, "Charlie");

  await startNextRound(manager);

  await buzzAndExpectWinner(t1);
  await markWrong(manager.page);

  await expectBuzzGreen(t2);
  await buzzAndExpectWinner(t2);
  await awardAndContinue(manager.page, { title: true });

  await expectBuzzGreen(t3);
  await buzzAndExpectWinner(t3);
  await awardAndAdvance(manager.page, { artist: true });

  const display = await browser.newPage();
  await display.goto(`/display/${manager.gameCode}`);
  await expectScore(display, "Alpha", -3);
  await expectScore(display, "Bravo", 10);
  await expectScore(display, "Charlie", 5);
});

test("scenario 8: two wrong buzzers, then correct claims both atomically", async ({
  browser,
}) => {
  const manager = await openManagerAndCreateGame(browser, { genreName: "Rock" });
  const t1 = await joinAsTeam(browser, manager.gameCode, "Alpha");
  const t2 = await joinAsTeam(browser, manager.gameCode, "Bravo");

  await startNextRound(manager);

  await buzzAndExpectWinner(t1);
  await markWrong(manager.page);

  await expectBuzzGreen(t2);
  await buzzAndExpectWinner(t2);
  await markWrong(manager.page);

  await expectBuzzGreen(t1);
  await buzzAndExpectWinner(t1);
  await awardAndAdvance(manager.page, { title: true, artist: true });

  // Alpha: -3 + 15 = 12, Bravo: -3. (No correct between the two wrongs,
  // so free-guess never activates.)
  const display = await browser.newPage();
  await display.goto(`/display/${manager.gameCode}`);
  await expectScore(display, "Alpha", 12);
  await expectScore(display, "Bravo", -3);
});

test("scenario 9: same team double-wrong then claims artist", async ({ browser }) => {
  const manager = await openManagerAndCreateGame(browser, { genreName: "Rock" });
  const team = await joinAsTeam(browser, manager.gameCode, "Solo");

  await startNextRound(manager);

  await buzzAndExpectWinner(team);
  await markWrong(manager.page);

  await expectBuzzGreen(team);
  await buzzAndExpectWinner(team);
  await markWrong(manager.page);

  await expectBuzzGreen(team);
  await buzzAndExpectWinner(team);
  await awardAndAdvance(manager.page, { artist: true });

  // -3 - 3 + 5 = -1.
  const display = await browser.newPage();
  await display.goto(`/display/${manager.gameCode}`);
  await expectScore(display, "Solo", -1);
});

test("scenario 15: team claims title then buzzes wrong (free-guess waiver)", async ({
  browser,
}) => {
  const manager = await openManagerAndCreateGame(browser, { genreName: "Rock" });
  const t1 = await joinAsTeam(browser, manager.gameCode, "Alpha");
  const t2 = await joinAsTeam(browser, manager.gameCode, "Bravo");

  await startNextRound(manager);

  await buzzAndExpectWinner(t1);
  await awardAndContinue(manager.page, { title: true });

  // Alpha already scored title, so this wrong is free (delta = 0).
  await expectBuzzGreen(t1);
  await buzzAndExpectWinner(t1);
  await markWrong(manager.page);

  await expectBuzzGreen(t2);
  await buzzAndExpectWinner(t2);
  await awardAndAdvance(manager.page, { artist: true });

  // Alpha: 10 + 0 = 10, Bravo: 5.
  const display = await browser.newPage();
  await display.goto(`/display/${manager.gameCode}`);
  await expectScore(display, "Alpha", 10);
  await expectScore(display, "Bravo", 5);
});

test("scenario 18: all three teams buzz wrong, manager skips", async ({ browser }) => {
  const manager = await openManagerAndCreateGame(browser, { genreName: "Rock" });
  const t1 = await joinAsTeam(browser, manager.gameCode, "Alpha");
  const t2 = await joinAsTeam(browser, manager.gameCode, "Bravo");
  const t3 = await joinAsTeam(browser, manager.gameCode, "Charlie");

  await startNextRound(manager);

  await buzzAndExpectWinner(t1);
  await markWrong(manager.page);

  await expectBuzzGreen(t2);
  await buzzAndExpectWinner(t2);
  await markWrong(manager.page);

  await expectBuzzGreen(t3);
  await buzzAndExpectWinner(t3);
  await markWrong(manager.page);

  // No more buzzers; manager skips to the next round.
  await skipRound(manager.page);

  const display = await browser.newPage();
  await display.goto(`/display/${manager.gameCode}`);
  await expectScore(display, "Alpha", -3);
  await expectScore(display, "Bravo", -3);
  await expectScore(display, "Charlie", -3);
});
