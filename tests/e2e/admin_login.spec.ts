// Admin login: the password input on /manager/login is accepted blindly
// (validation happens server-side on the first admin call). Wrong
// password manifests as a 401 on POST /games, which ManagerCreateGamePage
// catches and treats as logout + redirect back to /manager/login.
//
// Spec ref: docs/testing-strategy.md §4.4
// + frontend/src/pages/ManagerCreateGamePage.tsx:60-64
// + backend/app/middleware/admin_auth.py (constant-time compare).

import { test, expect } from "@playwright/test";
import { listGenres } from "./fixtures/admin-api";
import { openManagerAndCreateGame } from "./fixtures/manager-context";

test("wrong admin password is rejected at first admin action", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  await page.goto("/manager/login");
  await page.getByTestId("admin-password").fill("definitely-wrong-password");
  await page.getByTestId("admin-login-submit").click();

  // Frontend doesn't validate; we land on /manager/create.
  await expect(page).toHaveURL(/\/manager\/create$/);

  // Pick a genre so the submit button enables, then attempt to create.
  // Use the first genre the public /genres endpoint returns (e.g. "Rock").
  const genres = await listGenres();
  expect(genres.length).toBeGreaterThan(0);
  const first = genres[0]!;
  await expect(page.getByLabel(new RegExp(`^${first.name}$`, "i"))).toBeVisible({
    timeout: 10_000,
  });
  await page.getByLabel(new RegExp(`^${first.name}$`, "i")).check();
  await page.getByRole("button", { name: /create game/i }).click();

  // ApiError(401) -> logout() + navigate replace to /manager/login.
  await expect(page).toHaveURL(/\/manager\/login$/, { timeout: 10_000 });
});

test("correct admin password admits and creates a game", async ({ browser }) => {
  // openManagerAndCreateGame uses ADMIN_PASSWORD; if it lands at
  // /manager/game/<code>, the credential round-trip worked.
  const manager = await openManagerAndCreateGame(browser, {
    totalRounds: 1,
    genreName: "Rock",
  });
  expect(manager.gameCode).toMatch(/^[A-Z2-9]{6}$/);
  await expect(manager.page).toHaveURL(new RegExp(`/manager/game/${manager.gameCode}$`));
});
