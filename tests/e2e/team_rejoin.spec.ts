// Issue #183 — team rejoin / reconnect. Three paths:
//   A. same-browser refresh (localStorage identity survives),
//   B. join by the same team name from a fresh device (open reclaim, T5.7),
//   C. host-only rescue: the console reveals a per-team rejoin QR/link
//      (/join/<CODE>#rt=<token>) that reconnects any device to the exact team.
// Score preservation is asserted exhaustively in the backend tests; here we
// prove the reconnect actually happens in a real browser.

import { test, expect } from "@playwright/test";
import { openManagerAndCreateGame } from "./fixtures/manager-context";
import { joinAsTeam } from "./fixtures/team-context";

test("a team resumes after a refresh and can re-join by name from a new device", async ({
  browser,
}) => {
  const { gameCode } = await openManagerAndCreateGame(browser, { genreName: "Rock" });

  // Path A: same browser, hard refresh — the localStorage identity rehydrates
  // and the player stays on gameplay (never bounced back to /join).
  const team = await joinAsTeam(browser, gameCode, "Warriors");
  await team.page.reload();
  await expect(team.page).toHaveURL(new RegExp(`/team/${gameCode}$`));
  await expect(team.page.getByTestId("buzz")).toBeVisible({ timeout: 15_000 });

  // Path B: a different device with no stored identity re-joins by the SAME
  // name and reclaims the existing team instead of 409-ing. joinAsTeam asserts
  // it lands on gameplay, so a failed reclaim would fail the fixture.
  const rejoined = await joinAsTeam(browser, gameCode, "Warriors");
  await expect(rejoined.page.getByText("Warriors")).toBeVisible();
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
