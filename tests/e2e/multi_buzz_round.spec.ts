// Multi-buzz round model: scenarios where multiple buzzes happen on a
// single song before the manager advances. Covers matrix scenarios 1, 2,
// 3, 5, and 7 from the plan.

import { test, expect } from "@playwright/test";
import {
  awardAndAdvance,
  awardAndContinue,
  openManagerAndCreateGame,
} from "./fixtures/manager-context";
import { buzzAndExpectWinner, expectBuzzGreen, joinAsTeam } from "./fixtures/team-context";

async function startNextRound(manager: { page: import("@playwright/test").Page }) {
  await expect(manager.page.getByTestId("start-round")).toBeEnabled();
  await manager.page.getByTestId("start-round").click();
}

test("scenario 1: same team claims title then artist sequentially", async ({ browser }) => {
  const manager = await openManagerAndCreateGame(browser, { genreName: "Rock" });
  const team = await joinAsTeam(browser, manager.gameCode, "Solo");

  await startNextRound(manager);

  await buzzAndExpectWinner(team);
  await awardAndContinue(manager.page, { title: true });

  // Buzzer re-arms; same team buzzes again for artist.
  await expectBuzzGreen(team);
  await buzzAndExpectWinner(team);
  await awardAndAdvance(manager.page, { artist: true });

  const display = await browser.newPage();
  await display.goto(`/display/${manager.gameCode}`);
  await expect(
    display.locator(`[data-team-id]:has-text("Solo"):has-text("15")`).first(),
  ).toBeVisible({ timeout: 10_000 });
});

test("scenario 2: same team claims both tokens atomically", async ({ browser }) => {
  const manager = await openManagerAndCreateGame(browser, { genreName: "Rock" });
  const team = await joinAsTeam(browser, manager.gameCode, "Solo");

  await startNextRound(manager);
  await buzzAndExpectWinner(team);
  await awardAndAdvance(manager.page, { title: true, artist: true });

  const display = await browser.newPage();
  await display.goto(`/display/${manager.gameCode}`);
  await expect(
    display.locator(`[data-team-id]:has-text("Solo"):has-text("15")`).first(),
  ).toBeVisible({ timeout: 10_000 });
});

test("scenario 3: two teams split title and artist", async ({ browser }) => {
  const manager = await openManagerAndCreateGame(browser, { genreName: "Rock" });
  const t1 = await joinAsTeam(browser, manager.gameCode, "Alpha");
  const t2 = await joinAsTeam(browser, manager.gameCode, "Bravo");

  await startNextRound(manager);

  await buzzAndExpectWinner(t1);
  await awardAndContinue(manager.page, { title: true });

  await expectBuzzGreen(t2);
  await buzzAndExpectWinner(t2);
  await awardAndAdvance(manager.page, { artist: true });

  const display = await browser.newPage();
  await display.goto(`/display/${manager.gameCode}`);
  await expect(
    display.locator(`[data-team-id]:has-text("Alpha"):has-text("10")`).first(),
  ).toBeVisible({ timeout: 10_000 });
  await expect(
    display.locator(`[data-team-id]:has-text("Bravo"):has-text("5")`).first(),
  ).toBeVisible({ timeout: 10_000 });
});

test("scenario 5: same team recovers after wrong, then claims both", async ({ browser }) => {
  const manager = await openManagerAndCreateGame(browser, { genreName: "Rock" });
  const team = await joinAsTeam(browser, manager.gameCode, "Solo");

  await startNextRound(manager);

  await buzzAndExpectWinner(team);
  await awardAndContinue(manager.page, { wrong: true });

  await expectBuzzGreen(team);
  await buzzAndExpectWinner(team);
  await awardAndContinue(manager.page, { title: true });

  await expectBuzzGreen(team);
  await buzzAndExpectWinner(team);
  await awardAndAdvance(manager.page, { artist: true });

  // -3 + 10 + 5 = 12.
  const display = await browser.newPage();
  await display.goto(`/display/${manager.gameCode}`);
  await expect(
    display.locator(`[data-team-id]:has-text("Solo"):has-text("12")`).first(),
  ).toBeVisible({ timeout: 10_000 });
});

test("scenario 7: partial claim then advance abandons the open token", async ({ browser }) => {
  const manager = await openManagerAndCreateGame(browser, { genreName: "Rock" });
  const team = await joinAsTeam(browser, manager.gameCode, "Solo");

  await startNextRound(manager);
  await buzzAndExpectWinner(team);
  // Score title only and immediately advance. Artist token is abandoned;
  // no penalty.
  await awardAndAdvance(manager.page, { title: true });

  const display = await browser.newPage();
  await display.goto(`/display/${manager.gameCode}`);
  await expect(
    display.locator(`[data-team-id]:has-text("Solo"):has-text("10")`).first(),
  ).toBeVisible({ timeout: 10_000 });
});
