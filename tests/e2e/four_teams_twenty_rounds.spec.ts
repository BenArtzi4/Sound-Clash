// Scale check: a four-team game driven entirely through the real UI (manager
// console + four team tabs + the display board), then verified against ground
// truth in the DB.
//
// Target is 20 rounds. Against the local real catalog (hundreds of Rock songs)
// all 20 run; against the tiny CI seed we cap at the available pool so the game
// never hits `no_more_songs` (same approach as soundtrack_playthrough). Either
// way the test exercises four teams, many rounds, live scoring, the podium, and
// the durable game_history archive.
//
// Teams rotate through title, artist and combined awards. A full game also
// exercises a wrong guess and rebuzz, Continue, a free wrong guess, an
// unscored skip and a bonus for another team. The display and archived scores
// must match, and no two rounds may use the same song.

import { test, expect, type Page } from "@playwright/test";
import {
  advanceRound,
  applyCorrect,
  awardAndAdvance,
  awardAndContinue,
  awardBonusToTeam,
  markWrong,
  openManagerAndCreateGame,
  type AttemptToggles,
} from "./fixtures/manager-context";
import { buzzAndExpectWinner, joinAsTeam } from "./fixtures/team-context";
import { countSongsInGenreSlugs } from "./fixtures/supabase-admin";

const TARGET_ROUNDS = 20;

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

function svc(): HeadersInit {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set for DB assertions");
  }
  return { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: svc() });
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

function comboFor(teamIdx: number, round: number): AttemptToggles {
  if (teamIdx === 0) return { title: true, artist: true }; // Alpha: 15
  if (teamIdx === 1) return { title: true }; // Bravo: 10
  if (teamIdx === 2) return { artist: true }; // Charlie: 5
  return round === 8 ? { title: true, artist: true } : { title: true }; // Delta: 10 (15 on r8)
}

const pointsFor = (c: AttemptToggles): number => (c.title ? 10 : 0) + (c.artist ? 5 : 0);

test("4 teams, up to 20 rounds: scoring, unique songs, podium, and archive", async ({
  browser,
}) => {
  test.setTimeout(360_000); // up to 20 rounds across 6 browser contexts

  // Size the playthrough to the Rock pool so the tiny CI seed never exhausts it.
  const pool = await countSongsInGenreSlugs(["rock"]);
  const TOTAL = Math.min(TARGET_ROUNDS, pool);
  expect(TOTAL).toBeGreaterThanOrEqual(1);

  const manager = await openManagerAndCreateGame(browser, { genreName: "Rock" });
  const code = manager.gameCode;

  const teamNames = ["Alpha", "Bravo", "Charlie", "Delta"];
  const teams = [];
  for (const name of teamNames) {
    teams.push(await joinAsTeam(browser, code, name));
  }

  const displayCtx = await browser.newContext();
  const display = await displayCtx.newPage();
  await display.goto(`/display/${code}`);
  for (const name of teamNames) {
    await expect(display.locator(`[data-team-id]:has-text("${name}")`).first()).toBeVisible({
      timeout: 15_000,
    });
  }

  const expected: Record<string, number> = { Alpha: 0, Bravo: 0, Charlie: 0, Delta: 0 };

  // Bootstrap: open round 1 (the "Start game" click; header goes Round 0 -> 1).
  // Each iteration then scores the live round and advances to the next; the last
  // round is scored but not advanced, so exactly TOTAL game_rounds exist.
  await advanceRound(manager.page);

  for (let r = 1; r <= TOTAL; r++) {
    const idx = (r - 1) % 4;
    const team = teams[idx]!;
    const name = teamNames[idx]!;

    if (r === 7 && r < TOTAL) {
      await advanceRound(manager.page); // No team buzzed, so this round has no score.
      continue;
    }

    await buzzAndExpectWinner(team);
    if (r === 2) {
      await markWrong(manager.page);
      expected[name]! -= 3;
      await buzzAndExpectWinner(team);
    }

    const combo = comboFor(idx, r);
    if (r === 3 && r < TOTAL) {
      // Continue releases the lock after a correct guess. The next Wrong is
      // free, and the following Wrong costs points again.
      await awardAndContinue(manager.page, combo);
      await buzzAndExpectWinner(teams[3]!);
      await markWrong(manager.page);
      await buzzAndExpectWinner(teams[3]!);
      await markWrong(manager.page);
      expected.Delta! -= 3;
      await advanceRound(manager.page);
    } else if (r < TOTAL) {
      await awardAndAdvance(manager.page, combo); // score + advance (single accepted click)
    } else {
      await applyCorrect(manager.page, combo); // last round: score only
    }
    expected[name]! += pointsFor(combo);
    if (r === 4) {
      await awardBonusToTeam(manager.page, "Bravo");
      expected.Bravo! += 4;
      await expect(teams[1]!.page.getByTestId("standing-score")).toHaveText(
        String(expected.Bravo) + " pts",
      );
    }

    // Live scoreboard must reflect this team's new running total (scoped to the
    // team's own row, so name+score must co-occur).
    await expect(
      display.locator(`[data-team-id]:has-text("${name}"):has-text("${expected[name]}")`).first(),
    ).toBeVisible({ timeout: 10_000 });
  }

  // Final live totals, all four teams, exact.
  for (const name of teamNames) {
    await expect(
      display.locator(`[data-team-id]:has-text("${name}"):has-text("${expected[name]}")`).first(),
    ).toBeVisible({ timeout: 10_000 });
  }

  // --- End the game: podium + winner ---
  const endBtn = manager.page.getByTestId("end-game");
  await expect(endBtn).toBeEnabled();
  await endBtn.click();
  const dialog = manager.page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /^end game$/i }).click();

  await expect(display.getByRole("heading", { name: /final results/i })).toBeVisible({
    timeout: 15_000,
  });
  await expect(display.getByText("WINNER")).toBeVisible();
  const finalSb = display.getByTestId("final-scoreboard");
  for (const name of teamNames) {
    await expect(finalSb.locator(`[data-team-id]:has-text("${name}")`)).toBeVisible();
  }
  // Alpha is the unique top scorer in this scripted playthrough.
  const winnerName = Object.entries(expected).sort((a, b) => b[1] - a[1])[0]![0];
  expect(winnerName).toBe("Alpha");
  await expect(finalSb.locator(`[data-team-id]:has-text("${winnerName}")`)).toHaveAttribute(
    "data-rank",
    "1",
  );

  // --- Ground truth #1: live game_teams scores ---
  const gtRows = await getJson<Array<{ name: string; score: number }>>(
    `game_teams?game_code=eq.${code}&select=name,score`,
  );
  const gtMap = Object.fromEntries(gtRows.map((r) => [r.name, r.score]));
  expect(gtMap).toEqual(expected);

  // --- Ground truth #2: durable game_history archive (migration 033) ---
  const ghRows = await getJson<
    Array<{ id: string; round_count: number; team_count: number }>
  >(`game_history?game_code=eq.${code}&select=id,round_count,team_count`);
  expect(ghRows.length).toBe(1);
  expect(ghRows[0]!.round_count).toBe(TOTAL);
  expect(ghRows[0]!.team_count).toBe(4);
  const historyId = ghRows[0]!.id;

  const ghtRows = await getJson<Array<{ name: string; score: number }>>(
    `game_history_teams?game_history_id=eq.${historyId}&select=name,score`,
  );
  const ghtMap = Object.fromEntries(ghtRows.map((r) => [r.name, r.score]));
  expect(ghtMap).toEqual(expected);

  const ghsRows = await getJson<Array<{ round_number: number }>>(
    `game_history_songs?game_history_id=eq.${historyId}&select=round_number`,
  );
  expect(ghsRows.length).toBe(TOTAL);
  expect(new Set(ghsRows.map((r) => r.round_number)).size).toBe(TOTAL);
});
