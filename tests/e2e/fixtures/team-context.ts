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
  // BuzzButton mounts only after Realtime SUBSCRIBED — wait for it.
  await expect(page.getByTestId("buzz")).toBeVisible({ timeout: 15_000 });

  return { page, name: teamName };
}

export async function buzzAndExpectWinner(team: JoinedTeam): Promise<void> {
  await expect(team.page.getByTestId("buzz")).toHaveAttribute("data-tone", "idle", {
    timeout: 10_000,
  });
  await team.page.getByTestId("buzz").click();
  await expect(team.page.getByTestId("buzz")).toHaveAttribute("data-tone", "winner", {
    timeout: 10_000,
  });
}

export async function expectBuzzGreen(team: JoinedTeam): Promise<void> {
  await expect(team.page.getByTestId("buzz")).toHaveAttribute("data-tone", "idle", {
    timeout: 10_000,
  });
}
