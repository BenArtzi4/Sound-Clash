// Phase 6 headline e2e: 4 contexts (manager, team1, team2, display) racing
// the buzzer. Asserts exactly one team wins, all four contexts agree on
// the winner, and the awarded score propagates over Realtime.
//
// Spec ref: docs/testing-strategy.md §4.4 + docs/realtime-design.md §3.

import { test, expect, type Browser } from "@playwright/test";
import { joinAsTeam } from "./fixtures/team-context";
import { openManagerAndCreateGame } from "./fixtures/manager-context";

async function openDisplay(browser: Browser, code: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`/display/${code}`);
  return { page };
}

test("two teams race the buzzer; exactly one wins; all contexts agree", async ({ browser }) => {
  // 1. Manager creates the game via the UI (REST create would force a
  //    hard nav to /manager/game/<code> and lose the in-memory password).
  const manager = await openManagerAndCreateGame(browser, {
    totalRounds: 1,
    genreName: "Rock",
  });
  const code = manager.gameCode;

  // 2. Game now exists; open the other three contexts in parallel.
  const [team1, team2, display] = await Promise.all([
    joinAsTeam(browser, code, "Alpha"),
    joinAsTeam(browser, code, "Bravo"),
    openDisplay(browser, code),
  ]);

  // 3. Both teams visible on display before we start.
  await expect(display.page.getByText("Alpha")).toBeVisible();
  await expect(display.page.getByText("Bravo")).toBeVisible();

  // 4. Manager starts the round.
  const startBtn = manager.page.getByTestId("start-round");
  await expect(startBtn).toBeEnabled();
  await startBtn.click();

  // 5. Wait for the team pages to flip into "Buzz when you know it!".
  await Promise.all([
    expect(team1.page.getByRole("status").filter({ hasText: /Buzz when you know it/i })).toBeVisible({
      timeout: 15_000,
    }),
    expect(team2.page.getByRole("status").filter({ hasText: /Buzz when you know it/i })).toBeVisible({
      timeout: 15_000,
    }),
  ]);

  // 6. Race. Promise.all schedules both clicks back-to-back; the actual
  //    winner is decided server-side by the buzz_in PL/pgSQL function's
  //    conditional UPDATE.
  await Promise.all([team1.page.getByTestId("buzz").click(), team2.page.getByTestId("buzz").click()]);

  // 7. Wait for the locked state to actually propagate (one of the two
  //    tones must be "winner", the other "locked-other").
  await expect
    .poll(
      async () => {
        const t1 = await team1.page.getByTestId("buzz").getAttribute("data-tone");
        const t2 = await team2.page.getByTestId("buzz").getAttribute("data-tone");
        return [t1, t2].sort().join(",");
      },
      { timeout: 15_000 },
    )
    .toBe("locked-other,winner");

  const team1Tone = await team1.page.getByTestId("buzz").getAttribute("data-tone");
  const winnerName = team1Tone === "winner" ? "Alpha" : "Bravo";

  // 8. Manager and display agree on the winner.
  await expect(
    manager.page.getByRole("status").filter({ hasText: new RegExp(`${winnerName}.*buzzed in`, "i") }),
  ).toBeVisible({ timeout: 10_000 });
  await expect(
    display.page.getByRole("status").filter({ hasText: new RegExp(`${winnerName}.*buzzed in`, "i") }),
  ).toBeVisible({ timeout: 10_000 });

  // 9. Manager checks Title and awards points; the winner's score should
  //    update on display + both team scoreboards.
  await manager.page.getByLabel(/^title$/i).check();
  await manager.page.getByTestId("award-points").click();

  for (const page of [team1.page, team2.page, display.page]) {
    await expect(
      page.locator(`[data-team-id]:has-text("${winnerName}"):has-text("10")`).first(),
    ).toBeVisible({ timeout: 10_000 });
  }
});
