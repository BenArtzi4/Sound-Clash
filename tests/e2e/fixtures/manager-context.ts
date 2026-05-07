// Open a manager browser context and create a game from the home page.
//
// Hosting is open: no password, no /manager/login. Game creation now
// returns a per-game manager_token, which the page stores in localStorage
// (`game:<code>:manager-token`) before navigating to /manager/game/<code>.
// We mirror that flow through the UI so subsequent manager-only API calls
// driven by the page (select-song, award-points, end, kick-team) attach
// the X-Manager-Token header automatically.
//
// For specs that need to drive the backend RPCs directly (e.g. forced
// expiration), `openManagerAndCreateGame` also returns the token; read
// it from `ManagerSession.managerToken` and forward it on REST requests.

import { type Browser, type Page, expect } from "@playwright/test";

export interface ManagerSession {
  page: Page;
  gameCode: string;
  managerToken: string;
}

interface CreateOpts {
  // Display name as it appears in the UI (e.g. "Rock", "Pop"), matched
  // case-insensitively.
  genreName: string;
}

export async function openManagerAndCreateGame(
  browser: Browser,
  opts: CreateOpts,
): Promise<ManagerSession> {
  const context = await browser.newContext();
  const page = await context.newPage();

  // 1. Land on home and click the "Host a game" CTA.
  await page.goto("/");
  await page.getByRole("link", { name: /host a game/i }).click();
  await expect(page).toHaveURL(/\/manager\/create$/);

  // 2. Wait for genres to load (the form fetches them on mount).
  const genreLabel = page.getByLabel(new RegExp(`^${opts.genreName}$`, "i"));
  await expect(genreLabel).toBeVisible({ timeout: 10_000 });

  // 3. Pick a genre and submit.
  await genreLabel.check();
  await page.getByRole("button", { name: /create game/i }).click();

  // 4. App navigates to /manager/game/<code> client-side. Read the code
  //    out of the URL.
  await page.waitForURL(/\/manager\/game\/[A-Z2-9]{6}$/, { timeout: 15_000 });
  const match = page.url().match(/\/manager\/game\/([A-Z2-9]{6})$/);
  if (!match) throw new Error(`failed to read game code from URL: ${page.url()}`);
  const gameCode = match[1]!;

  // 5. Read the manager token the create-game flow stored in localStorage.
  const managerToken = await page.evaluate(
    (code) => window.localStorage.getItem(`game:${code}:manager-token`),
    gameCode,
  );
  if (!managerToken) {
    throw new Error(`manager token missing in localStorage for ${gameCode}`);
  }

  // 6. Wait for the YouTube player wrapper to flip to ready so the Start
  //    button enables.
  await expect(page.getByTestId("youtube-player")).toHaveAttribute("data-ready", "true", {
    timeout: 20_000,
  });

  return { page, gameCode, managerToken };
}
