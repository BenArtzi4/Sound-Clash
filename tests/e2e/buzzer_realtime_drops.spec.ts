// Buzzer resilience under DROPPED Realtime frames -- the outage class the rest
// of the e2e suite never simulates (it only does hard reloads). Gated behind the
// `run-e2e` label like the rest of the Playwright suite. See fixtures/realtime-
// drop.ts for the page.routeWebSocket() man-in-the-middle and the direct-RPC
// game control (no manager UI -> no YouTube 40s flake, #222).
//
// Scope: this spec exercises the two DB-authoritative recovery paths that a unit
// test can't (they need real Supabase Realtime fan-out), each by dropping the
// specific frame that carries the signal:
//   1. #254 -- drop each round's lock-clearing active_games UPDATE (while
//      delivering the same-transaction game_rounds INSERT) and assert every
//      buzzer still re-arms via the round-advance derivation, with exactly one
//      winner per race. This is also the path the #261 fix rides for the
//      round_number reconciler, so it guards against a regression there.
//   2. #259 -- drop the signal-less release_buzz_lock UPDATE and assert recovery
//      via the 15s locked backstop.
//
// The #261 provisional-stranding fix itself (TTL + round-advance reconciler in
// useBuzzer) is covered deterministically by the Vitest suite -- the hook test
// (useBuzzer.test.ts) and the page-level regression
// (TeamGameplayPage.provisionalStranding.test.tsx), both of which fail before
// the fix and pass after. It is intentionally NOT reproduced here: #261 is a
// NON-healing scenario (the client must miss the lock AND its release with no
// authoritative recovery), which is fundamentally at odds with the client's
// REST self-healing at the e2e layer, so it belongs in the deterministic unit
// tests rather than a timing-sensitive browser test.

import { test, expect, type Page } from "@playwright/test";
import {
  advanceRound,
  createGame,
  joinTeamWithDropControl,
  releaseBuzzLock,
  type DropTeam,
} from "./fixtures/realtime-drop";
import { countSongsInGenreSlugs } from "./fixtures/supabase-admin";

async function expectIdle(page: Page, timeout = 15_000): Promise<void> {
  await expect(page.getByTestId("buzz")).toHaveAttribute("data-tone", "idle", {
    timeout,
  });
  await expect(page.getByTestId("buzz")).toBeEnabled();
}

// Poll both tabs until the race has resolved to exactly one winner + one
// locked-other (buzz_in decides the winner atomically server-side).
async function expectExactlyOneWinner(a: Page, b: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        const [ta, tb] = await Promise.all([
          a.getByTestId("buzz").getAttribute("data-tone"),
          b.getByTestId("buzz").getAttribute("data-tone"),
        ]);
        return [ta, tb].sort().join(",");
      },
      { timeout: 15_000 },
    )
    .toBe("locked-other,winner");
}

test.describe("buzzer resilience under dropped Realtime frames", () => {
  test("#254 -- every buzzer re-arms via derivation when each round's advance UPDATE is dropped", async ({
    browser,
  }) => {
    const game = await createGame("rock");
    const teamA = await joinTeamWithDropControl(browser, game, "Ayers");
    const teamB = await joinTeamWithDropControl(browser, game, "Bexley");
    const tabs: DropTeam[] = [teamA, teamB];

    // Size the playthrough to the Rock pool (the CI seed is small); each
    // select_next_song consumes one unplayed song.
    const pool = await countSongsInGenreSlugs(["rock"]);
    const rounds = Math.min(pool, 4);
    expect(rounds).toBeGreaterThanOrEqual(2);

    await advanceRound(game); // open round 1
    await Promise.all(tabs.map((t) => expectIdle(t.page)));

    for (let r = 1; r <= rounds; r++) {
      // Both race. buzz_in picks exactly one winner atomically; the lock-ACQUIRE
      // UPDATE is delivered (only the lock-CLEARS are droppable), so both tabs
      // agree on the winner.
      await Promise.all(tabs.map((t) => t.page.getByTestId("buzz").click()));
      await expectExactlyOneWinner(teamA.page, teamB.page);

      if (r === rounds) break;

      // Victimise one tab (rotating so both are covered): drop its round-advance
      // active_games UPDATE. The other tab gets it normally. The same-transaction
      // game_rounds INSERT reaches BOTH, so the victim re-arms purely via the
      // round-advance derivation -- the path the #261 fix rides for provisionals.
      const victim = tabs[(r - 1) % tabs.length]!;
      const other = tabs[r % tabs.length]!;
      victim.control.dropLockClears = true;
      other.control.dropLockClears = false;

      const droppedBefore = victim.control.dropped;
      await advanceRound(game);

      // Both re-arm on the fresh round: the victim via derivation, the other via
      // the delivered UPDATE. Neither strands on the prior "SOMEONE ELSE BUZZED".
      await Promise.all(tabs.map((t) => expectIdle(t.page)));
      // The victim re-arms off the delivered game_rounds INSERT, which can beat
      // the dropped active_games UPDATE, so poll for the drop rather than read
      // it the instant expectIdle resolves.
      await expect
        .poll(() => victim.control.dropped, { timeout: 8000 })
        .toBeGreaterThan(droppedBefore);
      victim.control.dropLockClears = false;
    }
  });

  test("#259 -- a dropped release_buzz_lock UPDATE recovers via the 15s locked backstop", async ({
    browser,
  }) => {
    const game = await createGame("rock");
    const team = await joinTeamWithDropControl(browser, game, "Backstop");

    await advanceRound(game); // open round 1
    await expectIdle(team.page);

    // The team buzzes and wins; its own lock-acquire UPDATE is delivered.
    await team.page.getByTestId("buzz").click();
    await expect(team.page.getByTestId("buzz")).toHaveAttribute(
      "data-tone",
      "winner",
      {
        timeout: 15_000,
      },
    );

    // Now drop the lock-CLEAR, then release: the release_buzz_lock UPDATE (its
    // only Realtime signal) never reaches this tab, so the button stays stuck on
    // "YOU BUZZED". The locked-cadence backstop (15s) re-hydrates over REST and
    // repairs it -- the one recovery path for a signal-less clear (#259).
    team.control.dropLockClears = true;
    await releaseBuzzLock(game);

    // First confirm the release UPDATE really was intercepted (so the button is
    // genuinely stuck on a stale lock), then that the 15s locked backstop repairs
    // it. Generous ceiling: one 15s backstop tick + hydrate + fan-out.
    await expect
      .poll(() => team.control.dropped, { timeout: 8000 })
      .toBeGreaterThan(0);
    await expectIdle(team.page, 25_000);
  });
});
