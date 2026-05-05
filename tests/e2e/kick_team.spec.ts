// Manager kicks a team mid-game. The kicked team's tab redirects home
// (TeamGameplayPage detects its own row missing post-hydrate and clears
// localStorage). The other team stays put.
//
// Spec ref: docs/testing-strategy.md §4.4
// + frontend/src/pages/TeamGameplayPage.tsx:61-70 (kick detection)
// + backend/app/routers/games.py (DELETE /games/{code}/teams/{id}).

import { test, expect, type Browser } from "@playwright/test";
import { joinAsTeam } from "./fixtures/team-context";
import { openManagerAndCreateGame } from "./fixtures/manager-context";

async function openDisplay(browser: Browser, code: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`/display/${code}`);
  return { page };
}

test("manager kicks a team; that team's tab redirects, other team stays", async ({ browser }) => {
  const manager = await openManagerAndCreateGame(browser, {
    totalRounds: 1,
    genreName: "Rock",
  });
  const code = manager.gameCode;

  const [kicked, survivor, display] = await Promise.all([
    joinAsTeam(browser, code, "KickMe"),
    joinAsTeam(browser, code, "Survivor"),
    openDisplay(browser, code),
  ]);

  // Both teams visible on the display before the kick.
  await expect(display.page.getByText("KickMe")).toBeVisible({ timeout: 10_000 });
  await expect(display.page.getByText("Survivor")).toBeVisible({ timeout: 10_000 });
  expect(await display.page.locator("[data-team-id]").count()).toBe(2);

  // Resolve the kicked team's UUID by reading its localStorage on the
  // team page (the manager UI uses the same id via data-team-id).
  const kickedStored = await kicked.page.evaluate(
    (c) => window.localStorage.getItem(`game:${c}:team`),
    code,
  );
  expect(kickedStored).not.toBeNull();
  const kickedId = (JSON.parse(kickedStored!) as { id: string }).id;

  // Click Kick inside the Teams-panel row scoped by data-team-id; the
  // Scoreboard component also renders a `[data-team-id]` element so we
  // disambiguate by filtering to the row that contains the Kick button.
  const kickRow = manager.page
    .locator(`[data-team-id="${kickedId}"]`)
    .filter({ has: manager.page.getByTestId("kick-team") });
  await expect(kickRow).toBeVisible();
  await kickRow.getByTestId("kick-team").click();
  const dialog = manager.page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /remove team/i }).click();

  // The kicked team's page detects its row missing in state.teams,
  // clears localStorage, and navigates home.
  await expect(kicked.page).toHaveURL(/^[^?]*\/$|\/$/, { timeout: 15_000 });
  const storageAfter = await kicked.page.evaluate(
    (c) => window.localStorage.getItem(`game:${c}:team`),
    code,
  );
  expect(storageAfter).toBeNull();

  // Display shows only the survivor; manager's Teams panel agrees.
  await expect(display.page.getByText("KickMe")).toHaveCount(0, { timeout: 10_000 });
  await expect(display.page.getByText("Survivor")).toBeVisible();
  await expect
    .poll(async () => display.page.locator("[data-team-id]").count(), { timeout: 10_000 })
    .toBe(1);

  // Survivor still functions: starts a round and buzzes successfully.
  await expect(manager.page.getByTestId("start-round")).toBeEnabled();
  await manager.page.getByTestId("start-round").click();
  await expect(
    survivor.page.getByRole("status").filter({ hasText: /Buzz when you know it/i }),
  ).toBeVisible({ timeout: 15_000 });
  await survivor.page.getByTestId("buzz").click();
  await expect(survivor.page.getByTestId("buzz")).toHaveAttribute("data-tone", "winner", {
    timeout: 10_000,
  });
});
