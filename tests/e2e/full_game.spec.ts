// 3-round happy-path. Same setup as buzzer_race but with one team that
// always wins and incrementing-points awards. End with the EndScreen
// rendering the podium on the Display page.

import { test, expect } from "@playwright/test";
import { joinAsTeam } from "./fixtures/team-context";
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

    // Manager header shows "Round N" once start_round has completed.
    await expect(
      manager.page.getByText(new RegExp(`Round ${roundNum}$`, "i")),
    ).toBeVisible({ timeout: 10_000 });

    // Team can now buzz.
    await expect(team.page.getByTestId("buzz")).toHaveAttribute("data-tone", "idle", {
      timeout: 10_000,
    });
    await team.page.getByTestId("buzz").click();
    await expect(team.page.getByTestId("buzz")).toHaveAttribute("data-tone", "winner", {
      timeout: 10_000,
    });

    // Manager toggles the right scoring buttons and ends the round.
    if (r.title) {
      await manager.page.getByTestId("score-title").click();
    }
    if (r.artist) {
      await manager.page.getByTestId("score-artist").click();
    }
    await manager.page.getByTestId("end-round").click();

    runningTotal += r.expected;

    // Score reaches the running total on the display before we move on.
    await expect(
      display.locator(`[data-team-id]:has-text("Solo"):has-text("${runningTotal}")`).first(),
    ).toBeVisible({ timeout: 10_000 });
  }

  // The host explicitly ends the game; there's no auto-end behavior to fall back on.
  const endScreenHeading = display.getByRole("heading", { name: /final results/i });
  const endGameBtn = manager.page.getByTestId("end-game");
  await expect(endGameBtn).toBeEnabled();
  await endGameBtn.click();
  const dialog = manager.page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /^end game$/i }).click();

  // Display flips to the EndScreen.
  await expect(endScreenHeading).toBeVisible({ timeout: 15_000 });
  await expect(display.getByText("WINNER")).toBeVisible();
  await expect(display.getByText("Solo")).toBeVisible();

  // CountUp animation settles within ~2s. The podium score renders the
  // number and the "pts" unit as siblings, so we assert the final
  // "<total>pts" text becomes visible rather than poking at textContent.
  await expect(display.getByText(`${runningTotal}pts`).first()).toBeVisible({
    timeout: 5_000,
  });
});
