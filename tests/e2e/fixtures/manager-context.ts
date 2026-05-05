// Open a manager browser context, log in, and create the game via the UI.
//
// Why UI-create instead of REST: `authStorage` is intentionally in-memory
// only. A `page.goto(/manager/game/<code>)` is a hard navigation that
// wipes the password, RequireAuth then bounces to /manager/login. Using
// the create-game form keeps everything on a single client-side
// navigation chain.

import { type Browser, type Page, expect } from "@playwright/test";

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";

export interface ManagerSession {
  page: Page;
  gameCode: string;
}

interface CreateOpts {
  totalRounds: number;
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

  // 1. Login
  await page.goto("/manager/login");
  await page.getByPlaceholder(/password/i).fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: /continue/i }).click();
  await expect(page).toHaveURL(/\/manager\/create$/);

  // 2. Wait for genres to load (the form fetches them on mount).
  const genreLabel = page.getByLabel(new RegExp(`^${opts.genreName}$`, "i"));
  await expect(genreLabel).toBeVisible({ timeout: 10_000 });

  // 3. Set the rounds slider. Range inputs need the React-friendly value
  //    setter so the controlled component picks the change up.
  await page.getByTestId("rounds-slider").evaluate((el, val) => {
    const input = el as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(input, String(val));
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, opts.totalRounds);

  // 4. Pick a genre and submit.
  await genreLabel.check();
  await page.getByRole("button", { name: /create game/i }).click();

  // 5. App navigates to /manager/game/<code> client-side; auth password
  //    survives. Extract the generated code from the URL.
  await page.waitForURL(/\/manager\/game\/[A-Z2-9]{6}$/, { timeout: 15_000 });
  const match = page.url().match(/\/manager\/game\/([A-Z2-9]{6})$/);
  if (!match) throw new Error(`failed to read game code from URL: ${page.url()}`);
  const gameCode = match[1]!;

  // 6. Wait for the YouTube player wrapper to flip to ready so the Start
  //    button enables.
  await expect(page.getByTestId("youtube-player")).toHaveAttribute("data-ready", "true", {
    timeout: 20_000,
  });

  return { page, gameCode };
}
