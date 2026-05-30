// Bonus +4 mechanic. Independent of round state; works during waiting
// and playing. Covers scenarios 11, 12, 13, and the four-team scenario 19.

import { test, expect } from "@playwright/test";
import {
  awardAndAdvance,
  awardAndContinue,
  awardBonusToTeam,
  markWrong,
  openManagerAndCreateGame,
} from "./fixtures/manager-context";
import { buzzAndExpectWinner, expectBuzzGreen, joinAsTeam } from "./fixtures/team-context";

async function expectScore(
  display: import("@playwright/test").Page,
  team: string,
  score: number,
) {
  await expect(
    display.locator(`[data-team-id]:has-text("${team}"):has-text("${score}")`).first(),
  ).toBeVisible({ timeout: 10_000 });
}

test("scenario 11: bonus mid-round goes to a non-buzzed team", async ({ browser }) => {
  const manager = await openManagerAndCreateGame(browser, { genreName: "Rock" });
  const t1 = await joinAsTeam(browser, manager.gameCode, "Alpha");
  const t2 = await joinAsTeam(browser, manager.gameCode, "Bravo");

  await manager.page.getByTestId("start-round").click();
  await buzzAndExpectWinner(t1);
  await awardAndContinue(manager.page, { title: true });

  // Manager rewards Bravo +4 mid-round.
  await awardBonusToTeam(manager.page, "Bravo");

  await expectBuzzGreen(t2);
  await buzzAndExpectWinner(t2);
  await awardAndAdvance(manager.page, { artist: true });

  // Alpha: 10, Bravo: 4 + 5 = 9.
  const display = await browser.newPage();
  await display.goto(`/display/${manager.gameCode}`);
  await expectScore(display, "Alpha", 10);
  await expectScore(display, "Bravo", 9);
});

test("scenario 12: bonus before any round, while game is in 'waiting'", async ({
  browser,
}) => {
  const manager = await openManagerAndCreateGame(browser, { genreName: "Rock" });
  await joinAsTeam(browser, manager.gameCode, "Solo");

  // Game is waiting; bonus button should still be enabled.
  await expect(manager.page.getByTestId("score-bonus")).toBeEnabled();
  await awardBonusToTeam(manager.page, "Solo");

  const display = await browser.newPage();
  await display.goto(`/display/${manager.gameCode}`);
  await expectScore(display, "Solo", 4);
});

test("scenario 13: bonus picker only lists current teams", async ({ browser }) => {
  const manager = await openManagerAndCreateGame(browser, { genreName: "Rock" });
  await joinAsTeam(browser, manager.gameCode, "Alpha");
  await joinAsTeam(browser, manager.gameCode, "Bravo");

  // Open the picker and confirm both teams listed. The picker buttons'
  // accessible name is their aria-label ("Award +4 bonus to <name>").
  await manager.page.getByTestId("score-bonus").click();
  await expect(
    manager.page.getByRole("button", { name: "Award +4 bonus to Alpha", exact: true }),
  ).toBeVisible();
  await expect(
    manager.page.getByRole("button", { name: "Award +4 bonus to Bravo", exact: true }),
  ).toBeVisible();
  // No third "Charlie" team listed.
  await expect(
    manager.page.getByRole("button", { name: "Award +4 bonus to Charlie", exact: true }),
  ).toHaveCount(0);
});

test("scenario 19: four teams, two wrongs + two splits + bonus to a wrong-guesser", async ({
  browser,
}) => {
  const manager = await openManagerAndCreateGame(browser, { genreName: "Rock" });
  const t1 = await joinAsTeam(browser, manager.gameCode, "Alpha");
  const t2 = await joinAsTeam(browser, manager.gameCode, "Bravo");
  const t3 = await joinAsTeam(browser, manager.gameCode, "Charlie");
  const t4 = await joinAsTeam(browser, manager.gameCode, "Delta");

  await manager.page.getByTestId("start-round").click();

  // T1 wrong → -3 (no prior correct, full penalty applies)
  await buzzAndExpectWinner(t1);
  await markWrong(manager.page);

  // T2 artist correct → +5  (free-guess flag now active for next attempt)
  await expectBuzzGreen(t2);
  await buzzAndExpectWinner(t2);
  await awardAndContinue(manager.page, { artist: true });

  // T3 wrong → 0 (free-guess waives the -3; flag is then consumed)
  await expectBuzzGreen(t3);
  await buzzAndExpectWinner(t3);
  await markWrong(manager.page);

  // T4 title correct → +10
  await expectBuzzGreen(t4);
  await buzzAndExpectWinner(t4);
  await awardAndContinue(manager.page, { title: true });

  // Bonus +4 to T1, then advance.
  await awardBonusToTeam(manager.page, "Alpha");
  await manager.page.getByTestId("start-round").click();

  // Alpha: -3 + 4 = 1, Bravo: 5, Charlie: 0 (free-guess), Delta: 10.
  const display = await browser.newPage();
  await display.goto(`/display/${manager.gameCode}`);
  await expectScore(display, "Alpha", 1);
  await expectScore(display, "Bravo", 5);
  await expectScore(display, "Charlie", 0);
  await expectScore(display, "Delta", 10);
});
