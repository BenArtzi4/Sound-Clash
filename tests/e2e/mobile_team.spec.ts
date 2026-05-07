// Mobile team viewport: iPhone 12 dimensions, the buzzer is reachable
// and tappable, and a buzz round still produces a winner-tone + score.
// We don't switch to the dedicated `mobile` Playwright project (that's
// a multi-browser-matrix follow-up); per-test test.use() overrides the
// context to ship within the chromium-only CI gate.
//
// Spec ref: docs/testing-strategy.md §4.4
// + frontend/src/pages/TeamGameplayPage.module.css (mobile breakpoint).

import { test, expect, devices, type Browser } from "@playwright/test";
import { joinAsTeam } from "./fixtures/team-context";
import { openManagerAndCreateGame } from "./fixtures/manager-context";

async function joinAsMobileTeam(browser: Browser, code: string, name: string) {
  // Phone-shaped browser context for just the team tab.
  const ctx = await browser.newContext({ ...devices["iPhone 12"] });
  const page = await ctx.newPage();
  await page.goto(`/join/${code}`);
  await page.locator("#game-code").fill(code);
  await page.locator("#team-name").fill(name);
  await page.getByRole("button", { name: /join game/i }).click();
  await expect(page).toHaveURL(new RegExp(`/team/${code}$`));
  await expect(page.getByRole("status").filter({ hasText: /Connected/i })).toBeVisible({
    timeout: 15_000,
  });
  return { page, name };
}

test("mobile viewport: team can join, buzz, and score", async ({ browser }) => {
  const manager = await openManagerAndCreateGame(browser, {
    genreName: "Rock",
  });
  const code = manager.gameCode;

  const team = await joinAsMobileTeam(browser, code, "Mobile");

  // Buzzer should be visible on the small viewport without horizontal
  // scrolling; Playwright's auto-scroll-into-view + visible check
  // approximates this.
  const buzz = team.page.getByTestId("buzz");
  await expect(buzz).toBeVisible();
  expect(await buzz.boundingBox()).not.toBeNull();

  // Manager starts the round (manager runs at desktop chromium viewport).
  await expect(manager.page.getByTestId("start-round")).toBeEnabled();
  await manager.page.getByTestId("start-round").click();
  await expect(
    team.page.getByRole("status").filter({ hasText: /Buzz when you know it/i }),
  ).toBeVisible({ timeout: 15_000 });

  // Tap. Playwright synthesizes a touch from .click() in a touch-enabled
  // device descriptor.
  await buzz.click();
  await expect(buzz).toHaveAttribute("data-tone", "winner", { timeout: 10_000 });

  // Award and confirm the score reaches the team's own scoreboard on
  // the small viewport.
  await manager.page.getByTestId("score-title").click();
  await manager.page.getByTestId("end-round").click();
  await expect(
    team.page.locator('[data-team-id]:has-text("Mobile"):has-text("10")').first(),
  ).toBeVisible({ timeout: 10_000 });
});
