// Phase 7 prod smoke: a single buzzer round end-to-end against the live
// deployment. Mirrors tests/e2e/buzzer_race.spec.ts but trimmed to the
// minimum that proves the architectural keystone; browser → Supabase
// RPC → Realtime fan-out; survived deploy.
//
// Manual / on-demand. NOT wired into any CI workflow. See tests/smoke/README.md
// for the run command.
//
// Cleanup: ends the game via REST with the captured manager token so we
// don't leave orphan rows lingering on prod for 4h.

import { test, expect, request as pwRequest } from "@playwright/test";
import { joinAsTeam } from "../fixtures/team-context";
import { openManagerAndCreateGame } from "../fixtures/manager-context";

test("prod smoke: one buzzer round end-to-end against the deployed app", async ({
  browser,
  baseURL,
}, testInfo) => {
  test.slow(); // network round-trips to prod are slower than localhost

  const apiBase = process.env.API_URL ?? deriveApiBase(baseURL);
  testInfo.annotations.push({ type: "frontend", description: baseURL ?? "(unset)" });
  testInfo.annotations.push({ type: "backend", description: apiBase });

  // 1. Manager creates a 1-round game in the "Rock" genre via the UI.
  const manager = await openManagerAndCreateGame(browser, {
    totalRounds: 1,
    genreName: "Rock",
  });
  const code = manager.gameCode;
  const token = manager.managerToken;

  // 2. Two teams join in parallel.
  const [team1, team2] = await Promise.all([
    joinAsTeam(browser, code, "smoke-alpha"),
    joinAsTeam(browser, code, "smoke-bravo"),
  ]);

  try {
    // 3. Manager starts the round.
    const startBtn = manager.page.getByTestId("start-round");
    await expect(startBtn).toBeEnabled();
    await startBtn.click();

    // 4. Wait for both team pages to enter "buzz when you know it" state.
    await Promise.all([
      expect(
        team1.page.getByRole("status").filter({ hasText: /Buzz when you know it/i }),
      ).toBeVisible({ timeout: 20_000 }),
      expect(
        team2.page.getByRole("status").filter({ hasText: /Buzz when you know it/i }),
      ).toBeVisible({ timeout: 20_000 }),
    ]);

    // 5. Race. The PL/pgSQL buzz_in function decides the winner atomically.
    await Promise.all([
      team1.page.getByTestId("buzz").click(),
      team2.page.getByTestId("buzz").click(),
    ]);

    // 6. Exactly one tone="winner", one tone="locked-other".
    await expect
      .poll(
        async () => {
          const t1 = await team1.page.getByTestId("buzz").getAttribute("data-tone");
          const t2 = await team2.page.getByTestId("buzz").getAttribute("data-tone");
          return [t1, t2].sort().join(",");
        },
        { timeout: 20_000 },
      )
      .toBe("locked-other,winner");
  } finally {
    // 7. Always end the game so we don't leave a row on prod waiting for
    //    the 4h pg_cron sweep.
    const ctx = await pwRequest.newContext({ baseURL: apiBase });
    const resp = await ctx.post(`/games/${code}/end`, {
      headers: { "X-Manager-Token": token },
    });
    if (!resp.ok()) {
      // Don't mask the original failure; log and continue.
      console.warn(`prod smoke cleanup: end-game returned ${resp.status()} for ${code}`);
    }
    await ctx.dispose();
  }
});

// "https://soundclash.org" -> "https://api.soundclash.org"
// Falls back to localhost mapping for local dress-rehearsals.
function deriveApiBase(frontend: string | undefined): string {
  if (!frontend) return "https://api.soundclash.org";
  if (frontend.includes("localhost")) return frontend.replace(/:\d+$/, ":8000");
  return frontend.replace("://", "://api.");
}
