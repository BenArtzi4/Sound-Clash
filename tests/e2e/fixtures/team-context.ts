// Helper that opens a fresh browser context, joins a team, and returns
// the resulting Page parked on /team/<gameCode>.

import { type Browser, type Page, expect } from "@playwright/test";

export interface JoinedTeam {
  page: Page;
  name: string;
}

export async function joinAsTeam(
  browser: Browser,
  gameCode: string,
  teamName: string,
): Promise<JoinedTeam> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`/join/${gameCode}`);

  await page.locator("#game-code").fill(gameCode);
  await page.locator("#team-name").fill(teamName);
  await page.getByRole("button", { name: /join game/i }).click();

  await expect(page).toHaveURL(new RegExp(`/team/${gameCode}$`));
  await expect(page.getByRole("status").filter({ hasText: /Connected/i })).toBeVisible({
    timeout: 15_000,
  });

  return { page, name: teamName };
}
