// Open a manager browser context, log in, and navigate straight to an
// existing game's console. The game is created via the REST API (not via
// the UI) so the spec body can focus on what's being tested.

import { type Browser, type Page, expect } from "@playwright/test";

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";

export interface ManagerSession {
  page: Page;
}

export async function openManager(browser: Browser, gameCode: string): Promise<ManagerSession> {
  const context = await browser.newContext();
  const page = await context.newPage();

  // Log in via the UI so the in-memory authStorage is populated; the
  // manager console pages use it for X-Admin-Password headers on every
  // admin REST call.
  await page.goto("/manager/login");
  await page.getByPlaceholder(/password/i).fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: /continue/i }).click();
  await expect(page).toHaveURL(/\/manager\/create$/);

  // Then jump straight into the existing game's console.
  await page.goto(`/manager/game/${gameCode}`);
  await expect(page.getByText(gameCode).first()).toBeVisible();

  // Wait for the YT player to be ready so the Start button enables. The
  // player wrapper exposes data-ready on the wrapper div.
  await expect(page.getByTestId("youtube-player")).toHaveAttribute("data-ready", "true", {
    timeout: 20_000,
  });

  return { page };
}
