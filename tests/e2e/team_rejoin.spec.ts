// Issue #183 — team rejoin / reconnect. Paths:
//   A. same-browser refresh (localStorage identity survives),
//   B. same browser re-enters its own name on the join form (stored identity),
//   C. a different device typing a taken name is refused, never merged into
//      that team (game XSU8WK, 2026-10-02),
//   D. host-only rescue: the console reveals a per-team rejoin QR/link
//      (/join/<CODE>#rt=<token>) that reconnects any device to the exact team.
// Score preservation is asserted exhaustively in the backend tests; here we
// prove the reconnect actually happens in a real browser.

import { test, expect } from "@playwright/test";
import { openManagerAndCreateGame } from "./fixtures/manager-context";
import { joinAsTeam } from "./fixtures/team-context";

test("a team resumes from its own browser, and a taken name is refused on another device", async ({
  browser,
}) => {
  const { gameCode } = await openManagerAndCreateGame(browser, { genreName: "Rock" });

  // Path A: same browser, hard refresh — the localStorage identity rehydrates
  // and the player stays on gameplay (never bounced back to /join).
  const team = await joinAsTeam(browser, gameCode, "Warriors");
  await team.page.reload();
  await expect(team.page).toHaveURL(new RegExp(`/team/${gameCode}$`));
  await expect(team.page.getByTestId("buzz")).toBeVisible({ timeout: 15_000 });

  // Path B: the same browser goes back through the join form and types its own
  // name (different case). The server refuses the taken name, and the stored
  // identity takes the player straight back to their team.
  await team.page.goto(`/join/${gameCode}`);
  await team.page.locator("#team-name").fill("warriors");
  await team.page.getByRole("button", { name: /join game/i }).click();
  await expect(team.page).toHaveURL(new RegExp(`/team/${gameCode}$`));
  await expect(team.page.getByTestId("buzz")).toBeVisible({ timeout: 15_000 });

  // Path C: a different device with no stored identity types the same name.
  // It is told the name is taken and stays on the join form.
  const otherContext = await browser.newContext();
  const other = await otherContext.newPage();
  await other.goto(`/join/${gameCode}`);
  await other.locator("#team-name").fill("Warriors");
  await other.getByRole("button", { name: /join game/i }).click();
  await expect(other.getByText(/already taken/i)).toBeVisible({ timeout: 15_000 });
  await expect(other).toHaveURL(new RegExp(`/join/${gameCode}$`));
  await otherContext.close();
});

test("host reconnects a team to a new device via the rescue link", async ({ browser }) => {
  const { page, gameCode } = await openManagerAndCreateGame(browser, { genreName: "Rock" });

  // A team joins on its own device.
  await joinAsTeam(browser, gameCode, "Warriors");

  // The console shows "Reconnect a team" once a team exists (Realtime propagates
  // the join). Open it, pick the team, and read its rejoin link off the modal.
  await expect(page.getByTestId("rescue-open")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("rescue-open").click();
  await page.getByRole("dialog").getByRole("button", { name: /Warriors/i }).click();

  await expect(page.getByTestId("rescue-url")).toBeVisible({ timeout: 15_000 });
  const rejoinUrl = ((await page.getByTestId("rescue-url").textContent()) ?? "").trim();
  expect(rejoinUrl).toContain(`/join/${gameCode}#rt=`);

  // The team's original device is gone; a brand-new device opens the rejoin
  // link (as if it scanned the QR) and reconnects to the exact same team.
  const rescuedContext = await browser.newContext();
  const rescued = await rescuedContext.newPage();
  await rescued.goto(rejoinUrl);

  await expect(rescued).toHaveURL(new RegExp(`/team/${gameCode}$`), { timeout: 15_000 });
  await expect(rescued.getByTestId("buzz")).toBeVisible({ timeout: 15_000 });
  await expect(rescued.getByText("Warriors")).toBeVisible();

  await rescuedContext.close();
});
