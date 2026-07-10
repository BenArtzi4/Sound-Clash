// T4.10 host recovery: the console's "Backup host link" embeds the manager
// token in the URL fragment, so a host whose localStorage is wiped (new
// device, cleared browser) can re-authenticate by opening the link. This
// simulates the exact failure: grab the link, destroy the credential, confirm
// lock-out, then recover through the link and prove the console works again.

import { test, expect } from "@playwright/test";
import { openManagerAndCreateGame } from "./fixtures/manager-context";

test("wiped-localStorage host recovers console access via the backup host link", async ({
  browser,
}) => {
  const manager = await openManagerAndCreateGame(browser, { genreName: "Rock" });
  const { page, gameCode, managerToken } = manager;

  // 1. Open the disclosure and read the recovery URL off the console.
  await page.getByTestId("host-link-toggle").click();
  const recoveryUrl = (await page.getByTestId("host-link-url").textContent()) ?? "";
  expect(recoveryUrl).toContain(`/manager/game/${gameCode}#mt=${managerToken}`);

  // 2. Destroy the credential — the "phone died / browser data cleared" case.
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await expect(page.getByText(/you're not the host of this game/i)).toBeVisible();

  // 3. Recover through the backup link: the console adopts the token...
  await page.goto(recoveryUrl);
  await expect(page.getByTestId("start-round")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/you're not the host/i)).not.toBeVisible();

  // ...scrubs the fragment from the address bar...
  await expect(page).toHaveURL(new RegExp(`/manager/game/${gameCode}$`));

  // ...and re-persists it, so a plain revisit stays authenticated.
  const stored = await page.evaluate(
    (code) => window.localStorage.getItem(`game:${code}:manager-token`),
    gameCode,
  );
  expect(stored).toBe(managerToken);

  // 4. The recovered console is actually functional, not just rendered:
  //    Start game advances to round 1 (a token-gated select_next_song RPC).
  // 40s ceiling: the YouTube IFrame API's onReady depends on a third-party
  // load from www.youtube.com whose latency varies on the runner (issue #222).
  await expect(page.getByTestId("youtube-player")).toHaveAttribute("data-ready", "true", {
    timeout: 40_000,
  });
  await expect(page.getByTestId("start-round")).toBeEnabled();
  await page.getByTestId("start-round").click();
  await expect(page.getByText(/Round 1$/i)).toBeVisible({ timeout: 15_000 });
});
