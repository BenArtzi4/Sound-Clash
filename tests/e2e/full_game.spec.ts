// 3-round happy-path under the multi-buzz model. Each round, the same
// team buzzes once, the manager toggles whichever scoring bits the round
// expects, and presses "Next round" to advance. The Display page renders
// the running scoreboard; the EndScreen + podium close out.

import { test, expect } from "@playwright/test";
import { awardAndAdvance } from "./fixtures/manager-context";
import { buzzAndExpectWinner, joinAsTeam } from "./fixtures/team-context";
import { openManagerAndCreateGame } from "./fixtures/manager-context";

test("3-round game: award accumulates and podium renders on display", async ({ browser }) => {
  const manager = await openManagerAndCreateGame(browser, {
    genreName: "Rock",
  });
  const code = manager.gameCode;

  const team = await joinAsTeam(browser, code, "Solo");

  const displayCtx = await browser.newContext();
  const display = await displayCtx.newPage();
  await display.goto(`/display/${code}`);
  await expect(display.getByText("Solo")).toBeVisible();

  type RoundPoints = { title: boolean; artist: boolean; expected: number };
  const rounds: RoundPoints[] = [
    { title: true, artist: false, expected: 10 },
    { title: true, artist: true, expected: 15 },
    { title: false, artist: true, expected: 5 },
  ];

  let runningTotal = 0;

  for (let i = 0; i < rounds.length; i++) {
    const r = rounds[i]!;
    const roundNum = i + 1;

    await expect(manager.page.getByTestId("start-round")).toBeEnabled();
    await manager.page.getByTestId("start-round").click();

    await expect(
      manager.page.getByText(new RegExp(`Round ${roundNum}$`, "i")),
    ).toBeVisible({ timeout: 10_000 });

    await buzzAndExpectWinner(team);

    // Toggle the scoring bits and press Next round (which scores + closes
    // + advances in one action).
    await awardAndAdvance(manager.page, { title: r.title, artist: r.artist });

    runningTotal += r.expected;

    await expect(
      display.locator(`[data-team-id]:has-text("Solo"):has-text("${runningTotal}")`).first(),
    ).toBeVisible({ timeout: 10_000 });
  }

  const endScreenHeading = display.getByRole("heading", { name: /final results/i });
  const endGameBtn = manager.page.getByTestId("end-game");
  await expect(endGameBtn).toBeEnabled();
  await endGameBtn.click();
  const dialog = manager.page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /^end game$/i }).click();

  await expect(endScreenHeading).toBeVisible({ timeout: 15_000 });
  await expect(display.getByText("WINNER")).toBeVisible();
  await expect(display.getByText("Solo")).toBeVisible();

  await expect(display.getByText(`${runningTotal}pts`).first()).toBeVisible({
    timeout: 5_000,
  });
});
