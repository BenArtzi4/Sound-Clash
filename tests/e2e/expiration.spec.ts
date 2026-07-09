// Game whose `expires_at` is backdated past, then swept by
// cleanup_expired_games(): all open clients (manager, team, display)
// surface the "ended or expired" banner once Realtime delivers the DELETE on
// active_games. Reuses the existing UI status banners (no /expired
// route; see the plan). Each client also keeps the final scoreboard visible
// from its last-known snapshot (T4.11 / I-FinalBoard) rather than collapsing
// to a bare line — the swept team still sees where everyone stood.
//
// Spec ref: docs/testing-strategy.md §4.4 + db/migrations/005_rpc_functions.sql
// (cleanup_expired_games at line 178) + frontend/src/hooks/useGameChannel.ts
// (DELETE on active_games -> status="gone", finalBoard snapshot).

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
  // event first, but the team page must land on the banner either way
  // (T4.4): a missing team row in a game whose expires_at has passed is
  // teardown, not a kick, so the player is never silently bounced home.
  await expect(team.page.getByText(/this game has ended or expired/i)).toBeVisible({
    timeout: 15_000,
  });
  expect(team.page.url()).toContain("/team/");

  // T4.11: the manager keeps the final board (podium + song export) from its
  // last-known snapshot instead of the old "This game no longer exists." line.
  await expect(manager.page.getByText(/this game has ended or expired/i)).toBeVisible({
    timeout: 15_000,
  });
  await expect(manager.page.getByText(/final results/i)).toBeVisible({ timeout: 15_000 });
  await expect(display.page.getByText(/game has ended or expired/i)).toBeVisible({
    timeout: 15_000,
  });

  // Every client's frozen final board still names the team that was in the
  // room when the sweep hit — the standings survive the row delete.
  await expect(display.page.getByText("Ephemeral").first()).toBeVisible({ timeout: 15_000 });
  await expect(team.page.getByText("Ephemeral").first()).toBeVisible({ timeout: 15_000 });
  await expect(manager.page.getByText("Ephemeral").first()).toBeVisible({ timeout: 15_000 });
});
