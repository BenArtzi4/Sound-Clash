// Game whose `expires_at` is backdated past, then swept by
// cleanup_expired_games(): all open clients (manager, team, display)
// surface the "gone" banner once Realtime delivers the DELETE on
// active_games. Reuses the existing UI status banners (no /expired
// route — see the plan).
//
// Spec ref: docs/testing-strategy.md §4.4 + db/migrations/005_rpc_functions.sql
// (cleanup_expired_games at line 178) + frontend/src/hooks/useGameChannel.ts
// (DELETE on active_games -> status="gone").

import { test, expect, type Browser } from "@playwright/test";
import { joinAsTeam } from "./fixtures/team-context";
import { openManagerAndCreateGame } from "./fixtures/manager-context";
import { setExpiresAtPast, cleanupExpiredGames } from "./fixtures/supabase-admin";

async function openDisplay(browser: Browser, code: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`/display/${code}`);
  return { page };
}

test("expired game is swept; all clients surface the 'gone' banner", async ({ browser }) => {
  const manager = await openManagerAndCreateGame(browser, {
    totalRounds: 1,
    genreName: "Rock",
  });
  const code = manager.gameCode;

  const [team, display] = await Promise.all([
    joinAsTeam(browser, code, "Ephemeral"),
    openDisplay(browser, code),
  ]);

  // Display should already show the team before we expire the game.
  await expect(display.page.getByText("Ephemeral")).toBeVisible({ timeout: 10_000 });

  // Backdate expires_at and run the cleanup that pg_cron normally fires
  // hourly. The function returns the number of rows it deleted.
  await setExpiresAtPast(code);
  const deleted = await cleanupExpiredGames();
  expect(deleted).toBeGreaterThanOrEqual(1);

  // The cleanup deletes active_games; ON DELETE CASCADE prunes
  // game_teams. Logical replication can emit the parent or the child
  // event first depending on transaction ordering, so the team page
  // settles in one of two valid states:
  //   - team row vanishes first: TeamGameplayPage's "kicked" path
  //     (clearStoredTeam + navigate("/")) fires.
  //   - active_games vanishes first: status="gone" renders the
  //     "this game has ended or expired" banner.
  // Manager/display have no team identity to lose; they always hit the
  // "gone" banner.
  await expect
    .poll(
      async () => {
        const url = team.page.url();
        if (/\/$/.test(url) && !/\/team\//.test(url)) return "redirected-home";
        const banner = await team.page.getByText(/this game has ended or expired/i).count();
        return banner > 0 ? "banner-shown" : "still-loading";
      },
      { timeout: 15_000 },
    )
    .not.toBe("still-loading");

  await expect(
    manager.page.getByText(/this game no longer exists/i),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    display.page.getByText(/game has ended or expired/i),
  ).toBeVisible({ timeout: 15_000 });
});
