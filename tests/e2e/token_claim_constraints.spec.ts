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

  // The token chip on the manager reflects the claim. The manager view
  // intentionally hides which team claimed each token; the chip just shows
  // a checkmark. The display screen still surfaces the team name for the
  // audience.
  await expect(manager.page.getByTestId("token-chip-title")).toContainText("✓");
});

test("scenario 16: continue button disables once both tokens are claimed", async ({
  browser,
}) => {
  const manager = await openManagerAndCreateGame(browser, { genreName: "Rock" });
  const team = await joinAsTeam(browser, manager.gameCode, "Solo");

  await manager.page.getByTestId("start-round").click();
  await buzzAndExpectWinner(team);

  // Click both correct buttons (each fires award_attempt immediately and
  // disables itself). After both are claimed, press Continue to release
  // the lock; Continue then disables because no buzz is held.
  await awardAndContinue(manager.page, { title: true, artist: true });

  await expect(manager.page.getByTestId("continue-round")).toBeDisabled();
  await expect(manager.page.getByTestId("start-round")).toBeEnabled();
});
