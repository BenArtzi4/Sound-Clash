// Helper that opens a fresh browser context, joins a team, and returns
// the resulting Page parked on /team/<gameCode>.

import { type Browser, type Page, type Route, expect } from "@playwright/test";

export interface JoinedTeam {
  page: Page;
  name: string;
}

export async function joinAsTeam(
  browser: Browser,
  gameCode: string,
  teamName: string,
  preparePage?: (page: Page) => Promise<void>,
): Promise<JoinedTeam> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await preparePage?.(page);
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

// Hold both UI requests at the network boundary so the first lock cannot
// disable the other button before its click is dispatched.
export async function raceTeamBuzzers(a: Page, b: Page): Promise<void> {
  const pages = [a, b];
  const rpc = "**/rest/v1/rpc/buzz_in";
  const { promise, resolve } = Promise.withResolvers<void>();
  let waiting = 0;
  const hold = async (route: Route) => {
    if (route.request().method() === "POST") {
      waiting += 1;
      if (waiting === pages.length) resolve();
      await promise;
    }
    await route.continue();
  };

  await Promise.all(pages.map((page) => page.route(rpc, hold)));
  try {
    const [responses] = await Promise.all([
      Promise.all(pages.map((page) => page.waitForResponse(
        (response) => response.url().endsWith("/rpc/buzz_in") && response.request().method() === "POST",
        { timeout: 10_000 },
      ))),
      Promise.all(pages.map((page) => page.getByTestId("buzz").click({ timeout: 10_000 }))),
    ]);
    const rows = await Promise.all(responses.map(async (response) => {
      expect(response.ok()).toBe(true);
      const [row] = await response.json();
      return row;
    }));
    expect(rows.map((row) => row.locked).sort()).toEqual([false, true]);
    expect(rows[0].locked_team_id).toBe(rows[1].locked_team_id);
  } finally {
    resolve();
    await Promise.all(pages.map((page) => page.unroute(rpc, hold)));
  }
}
