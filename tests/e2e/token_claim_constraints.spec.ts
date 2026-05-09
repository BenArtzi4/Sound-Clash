// Token-claim constraints. Once a token is claimed, the manager UI
// disables the corresponding toggle and the backend rejects an attempt
// that re-claims it. Covers scenarios 10 and 16.

import { test, expect } from "@playwright/test";
import {
  awardAndContinue,
  openManagerAndCreateGame,
} from "./fixtures/manager-context";
import { buzzAndExpectWinner, joinAsTeam } from "./fixtures/team-context";

test("scenario 10: title toggle disables once title is claimed", async ({ browser }) => {
  const manager = await openManagerAndCreateGame(browser, { genreName: "Rock" });
  const t1 = await joinAsTeam(browser, manager.gameCode, "Alpha");
  const t2 = await joinAsTeam(browser, manager.gameCode, "Bravo");

  await manager.page.getByTestId("start-round").click();
  await buzzAndExpectWinner(t1);
  await awardAndContinue(manager.page, { title: true });

  // T2 buzzes; manager sees the title toggle disabled because it's claimed.
  await buzzAndExpectWinner(t2);
  await expect(manager.page.getByTestId("score-title")).toBeDisabled();
  await expect(manager.page.getByTestId("score-artist")).toBeEnabled();
  await expect(manager.page.getByTestId("score-wrong")).toBeEnabled();

  // The token chip on the manager + display reflects the claim.
  await expect(manager.page.getByTestId("token-chip-title")).toContainText("Alpha");
});

test("scenario 16: continue button disables once both tokens are claimed", async ({
  browser,
}) => {
  const manager = await openManagerAndCreateGame(browser, { genreName: "Rock" });
  const team = await joinAsTeam(browser, manager.gameCode, "Solo");

  await manager.page.getByTestId("start-round").click();
  await buzzAndExpectWinner(team);

  // Toggle both correct, then continue. After award_attempt with both
  // tokens, the round still has buzzed_team_id cleared and both tokens
  // claimed, so Continue Round is disabled (nothing left to win).
  await manager.page.getByTestId("score-title").click();
  await manager.page.getByTestId("score-artist").click();
  await manager.page.getByTestId("continue-round").click();

  await expect(manager.page.getByTestId("continue-round")).toBeDisabled();
  await expect(manager.page.getByTestId("start-round")).toBeEnabled();
});
