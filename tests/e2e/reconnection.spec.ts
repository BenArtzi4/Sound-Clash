// Team reload mid-game: identity persists in localStorage, useGameChannel
// re-hydrates, and the team can still buzz after the reconnect.
//
// Spec ref: docs/testing-strategy.md §4.4 + frontend/src/pages/TeamGameplayPage.tsx
// (readStoredTeam at line 17, hydrate effect, useGameChannel reconnect).

import { test, expect } from "@playwright/test";
import { joinAsTeam } from "./fixtures/team-context";
import { openManagerAndCreateGame } from "./fixtures/manager-context";

test("team identity survives a mid-game tab reload", async ({ browser }) => {
  const manager = await openManagerAndCreateGame(browser, {
    genreName: "Rock",
  });
  const code = manager.gameCode;

  const team = await joinAsTeam(browser, code, "Persistent");

  // Identity is in localStorage under "game:<code>:team".
  const storedBefore = await team.page.evaluate(
    (c) => window.localStorage.getItem(`game:${c}:team`),
    code,
  );
  expect(storedBefore).not.toBeNull();
  const parsed = JSON.parse(storedBefore!) as { id: string; name: string };
  expect(parsed.name).toBe("Persistent");
  expect(parsed.id).toMatch(/^[0-9a-f-]{36}$/i);

  // Round starts; the team's buzz button flips to the idle (BUZZ) tone.
  await expect(manager.page.getByTestId("start-round")).toBeEnabled();
  await manager.page.getByTestId("start-round").click();
  await expect(team.page.getByTestId("buzz")).toHaveAttribute("data-tone", "idle", {
    timeout: 15_000,
  });

  // Hard reload; useGameChannel re-subscribes, hydrate refetches, and the
  // stored team identity is read again from localStorage.
  await team.page.reload();

  // Still on /team/<code>, still authenticated, identity still in storage.
  await expect(team.page).toHaveURL(new RegExp(`/team/${code}$`));
  const storedAfter = await team.page.evaluate(
    (c) => window.localStorage.getItem(`game:${c}:team`),
    code,
  );
  expect(storedAfter).toBe(storedBefore);

  // Realtime reconnects; buzz button flips back to idle tone.
  await expect(team.page.getByTestId("buzz")).toHaveAttribute("data-tone", "idle", {
    timeout: 15_000,
  });

  // The buzzer is functional after the reconnect.
  await team.page.getByTestId("buzz").click();
  await expect(team.page.getByTestId("buzz")).toHaveAttribute("data-tone", "winner", {
    timeout: 10_000,
  });

  // Score + advance via "Next round" (the multi-buzz manager UI bundles
  // award_attempt + end_round + select-song into one button when toggles
  // are set). Correctness of the score-update path is covered by
  // full_game.spec.ts and buzzer_race.spec.ts via the display.
  await manager.page.getByTestId("score-title").click();
  await manager.page.getByTestId("start-round").click();
  await expect(team.page.getByTestId("buzz")).not.toHaveAttribute("data-tone", "winner", {
    timeout: 10_000,
  });
});
