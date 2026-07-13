// Event-scale validation: a TEN-team game driven entirely through the real UI
// (manager console + ten team tabs + the display board), then verified against
// ground truth in the DB after every round. This is the reproducible companion
// to the manual "real 10-team / 40-person event" playtest.
//
// The headline test targets 30 rounds on a Rock+Pop pool (all "normal" rounds,
// so the per-round point math is fully deterministic) and deliberately cycles
// through EVERY scoring path so each is exercised, most of them several times:
//   - Correct Song only            (+10)
//   - Correct Artist only          (+5)
//   - Both title+artist, one team  (+15, claimed atomically)
//   - Title and Artist by DIFFERENT teams in one round (multi-buzz split)
//   - Wrong buzz (-3) then a second team buzzes and wins (release lock)
//   - Continue round with NO score awarded (release_buzz_lock no-op path)
//   - a concurrent buzz race (all teams buzz one round -> exactly ONE winner)
//   - Bonus (+4) via the manager's team picker
//   - kick a team mid-game (DELETE) and confirm standings stay correct
// The soundtrack path (single 🎬 token, +15, film-name reveal) is covered by a
// second, focused test below (kept separate so the 30-round score math stays
// deterministic instead of depending on random soundtrack interleaving).
//
// Sizing: against the local expanded catalog (47 Rock+Pop songs) all 30 rounds
// run; against the tiny CI seed the game is capped at the available pool (same
// approach as four_teams_twenty_rounds / soundtrack_playthrough) so it never
// hits `no_more_songs`. When the pool caps the run short of a scenario's round,
// that scenario is skipped and logged (no silent truncation), and the coverage
// guard at the end only requires the paths whose scheduled round actually ran.
// Rounds 1-7 cover all seven round-consuming paths (+ the round-2 bonus
// overlay) so even the 7-song CI seed exercises every scoring path; the
// kick-seeding round and the volume rounds come after.
//
// Robustness: the manager console serialises every scoring/advance action behind
// a `busy` flag and each handler early-returns while it's set, so a click fired
// off the *optimistic* disabled flag can be silently dropped on a slow stack
// (see .claude/rules/lessons-learned.md, 2026-06-24). We reuse the manager-
// context fixtures, which gate every chained click on the Bonus button
// re-enabling ("last RPC settled") and keep round-advance a single, generously-
// waited click. Correctness is asserted against the DB (authoritative) each
// round; the live display is asserted too, which doubles as a Realtime-fan-out-
// at-10-teams check.

import { test, expect, type Page } from "@playwright/test";
import {
  advanceRound,
  applyCorrect,
  awardAndContinue,
  awardBonusToTeam,
  markWrong,
  openManagerAndCreateGame,
} from "./fixtures/manager-context";
import {
  buzzAndExpectWinner,
  expectBuzzGreen,
  joinAsTeam,
  type JoinedTeam,
} from "./fixtures/team-context";
import { countSongsInGenreSlugs } from "./fixtures/supabase-admin";

const TARGET_ROUNDS = 30;
const TEAM_COUNT = 10;
const BONUS_TEAM = "Team08"; // receives the +4 host bonus
const KICK_TEAM = "Team10"; // scored in R8, then kicked after R8

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const API_URL = process.env.API_URL ?? "http://localhost:8000";

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

const teamName = (i: number): string => `Team${String(i + 1).padStart(2, "0")}`;

// ---------------------------------------------------------------------------
// DB ground-truth helpers
// ---------------------------------------------------------------------------

async function dbScores(code: string): Promise<Record<string, number>> {
  const rows = await getJson<Array<{ name: string; score: number }>>(
    `game_teams?game_code=eq.${code}&select=name,score`,
  );
  return Object.fromEntries(rows.map((r) => [r.name, r.score]));
}

async function dbBuzzedTeamId(code: string): Promise<string | null> {
  const rows = await getJson<Array<{ buzzed_team_id: string | null }>>(
    `active_games?game_code=eq.${code}&select=buzzed_team_id`,
  );
  return rows[0]?.buzzed_team_id ?? null;
}

async function teamIdMap(code: string): Promise<{
  byName: Record<string, string>;
  byId: Record<string, string>;
}> {
  const rows = await getJson<Array<{ id: string; name: string }>>(
    `game_teams?game_code=eq.${code}&select=id,name`,
  );
  const byName: Record<string, string> = {};
  const byId: Record<string, string> = {};
  for (const r of rows) {
    byName[r.name] = r.id;
    byId[r.id] = r.name;
  }
  return { byName, byId };
}

// Assert the authoritative DB score for a team converges to `expected`. Also
// serves as a commit gate: it only passes once award_attempt / award_bonus has
// landed in Postgres.
async function expectDbScore(code: string, name: string, expected: number): Promise<void> {
  await expect
    .poll(async () => (await dbScores(code))[name] ?? 0, {
      timeout: 15_000,
      message: `DB score for ${name} should be ${expected}`,
    })
    .toBe(expected);
}

// Assert the live display scoreboard row for a team shows `expected`. The row
// is a single <li data-team-id> with exactly [rank, name, score] spans, so the
// 3rd span is the score -- matching on it exactly avoids the substring trap
// (":has-text('15')" would also match "150").
async function expectDisplayScore(display: Page, name: string, expected: number): Promise<void> {
  const row = display.locator(`[data-team-id]:has-text("${name}")`).first();
  await expect(row.locator("span").nth(2)).toHaveText(String(expected), { timeout: 15_000 });
}

// ---------------------------------------------------------------------------
// Concurrent buzz race: every active team buzzes the same fresh round; exactly
// one wins the lock. Returns the winning team's name (read from the DB, the
// single source of truth for the lock).
// ---------------------------------------------------------------------------
async function runBuzzRace(
  code: string,
  racers: JoinedTeam[],
  byId: Record<string, string>,
): Promise<string> {
  // All must be armed (fresh round, no lock) before the race.
  for (const t of racers) {
    await expect(t.page.getByTestId("buzz")).toHaveAttribute("data-tone", "idle", {
      timeout: 10_000,
    });
  }
  // Fire all buzzes as close to simultaneously as possible. We must NOT use
  // locator.click(): it waits for the button to be "enabled", but the instant
  // one team wins, every other button disables (buzzDisabled includes
  // isLocked), so the serialized clicks that haven't dispatched yet would hang
  // until the test timeout. dispatchEvent skips the actionability wait and
  // fires the exact handler the button uses (onPointerDown -> buzz), so all ten
  // buzz_in RPCs launch before any lock propagates -- a genuine concurrent
  // race. buzz_in's atomic conditional UPDATE guarantees exactly one satisfies
  // buzzed_team_id IS NULL regardless of ordering; the rest observe the lock
  // and their handler no-ops.
  await Promise.all(
    racers.map((t) => t.page.getByTestId("buzz").dispatchEvent("pointerdown", { button: 0 })),
  );

  // The DB lock is the definitive winner.
  let winnerId: string | null = null;
  await expect
    .poll(
      async () => {
        winnerId = await dbBuzzedTeamId(code);
        return winnerId;
      },
      { timeout: 10_000, message: "exactly one team should hold the buzz lock after the race" },
    )
    .not.toBeNull();
  const winnerName = byId[winnerId!];
  expect(winnerName, "the DB lock winner must be one of the racers").toBeTruthy();

  // UI cross-check: the winner shows the winner tone; EVERY other racer shows
  // "someone else buzzed" -> so exactly one winner, all others locked out.
  const winner = racers.find((t) => t.name === winnerName)!;
  await expect(winner.page.getByTestId("buzz")).toHaveAttribute("data-tone", "winner", {
    timeout: 10_000,
  });
  for (const t of racers) {
    if (t.name === winnerName) continue;
    await expect(t.page.getByTestId("buzz")).toHaveAttribute("data-tone", "locked-other", {
      timeout: 10_000,
    });
  }
  return winnerName;
}

// ---------------------------------------------------------------------------
// Kick a team mid-game via the real FastAPI DELETE endpoint (the production
// path; there is no kick button in the manager UI). Token-gated, returns 204.
// ---------------------------------------------------------------------------
async function kickTeamViaApi(code: string, managerToken: string, teamId: string): Promise<void> {
  const res = await fetch(`${API_URL}/games/${code}/teams/${teamId}`, {
    method: "DELETE",
    headers: { "X-Manager-Token": managerToken },
  });
  expect(res.status, "kick DELETE should return 204").toBe(204);
}

// ===========================================================================
// Headline test
// ===========================================================================
test("10 teams, up to 30 rounds: every scoring path, live scores, podium & archive all correct", async ({
  browser,
}, testInfo) => {
  test.setTimeout(540_000); // 30 rounds across 12 browser contexts

  // Size to the Rock+Pop pool so the tiny CI seed never exhausts it.
  const pool = await countSongsInGenreSlugs(["rock", "pop"]);
  const TOTAL = Math.min(TARGET_ROUNDS, pool);
  expect(TOTAL, "need at least a handful of songs").toBeGreaterThanOrEqual(1);
  testInfo.annotations.push({ type: "rounds", description: `${TOTAL} (pool=${pool})` });
  if (TOTAL < TARGET_ROUNDS) {
    // eslint-disable-next-line no-console
    console.warn(
      `[ten_teams] pool=${pool} caps the run at ${TOTAL} rounds; scenarios scheduled beyond that are skipped.`,
    );
  }

  // --- Manager + 10 teams + display ---
  const manager = await openManagerAndCreateGame(browser, { genreNames: ["Rock", "Pop"] });
  const code = manager.gameCode;

  const teams: JoinedTeam[] = [];
  for (let i = 0; i < TEAM_COUNT; i++) {
    teams.push(await joinAsTeam(browser, code, teamName(i)));
  }
  // Mutable roster: the kicked team is removed so it's never buzzed again.
  let active = [...teams];

  const displayCtx = await browser.newContext();
  const display = await displayCtx.newPage();
  await display.goto(`/display/${code}`);
  // Only the top 5 render on the board (issue #179); at 0-0 the tiebreak is
  // earlier joined_at, so Team01-05 (the first to join) fill the board while the
  // other five are named by the hint. Wait on the hint as the fully-hydrated
  // gate, then confirm the board is capped at five rows.
  await expect(display.getByTestId("more-teams")).toHaveText(
    `+${TEAM_COUNT - 5} more teams playing`,
    { timeout: 20_000 },
  );
  await expect(display.locator("[data-team-id]")).toHaveCount(5);

  const { byName, byId } = await teamIdMap(code);
  const expected: Record<string, number> = Object.fromEntries(teams.map((t) => [t.name, 0]));
  const paths = new Set<string>(); // which scoring paths were actually exercised

  const teamByName = (name: string): JoinedTeam => active.find((t) => t.name === name)!;

  // Apply a delta map to expected, then assert every touched team against the
  // DB (the authoritative running total). This also gates the round: it only
  // returns once award_attempt/award_bonus has committed. The live display is
  // checked at a few explicit checkpoints and exhaustively at the end (rather
  // than every round) to keep the 10-team run inside the foreground time budget
  // while still proving Realtime fan-out at scale.
  async function settle(delta: Record<string, number>): Promise<void> {
    for (const [name, d] of Object.entries(delta)) {
      expected[name] = (expected[name] ?? 0) + d;
    }
    for (const name of Object.keys(delta)) {
      await expectDbScore(code, name, expected[name]!);
    }
  }

  // --- Per-round scenario execution (buzz + score only; the single per-round
  //     advance is done by the caller so the last round can be scored without
  //     advancing, keeping exactly TOTAL rounds). Returns the score delta. ---
  type Scenario =
    | { type: "song" | "artist" | "both" | "noscore"; a: string }
    | { type: "split" | "wrong"; a: string; b: string }
    | { type: "race" };

  function planFor(r: number): Scenario {
    switch (r) {
      case 1:
        return { type: "song", a: "Team01" };
      case 2:
        return { type: "artist", a: "Team02" };
      case 3:
        return { type: "both", a: "Team01" };
      case 4:
        return { type: "split", a: "Team03", b: "Team04" };
      case 5:
        return { type: "wrong", a: "Team05", b: "Team06" };
      case 6:
        // noscore sits inside rounds 1-7 so the capped CI pool still covers it.
        return { type: "noscore", a: "Team07" };
      case 7:
        return { type: "race" };
      case 8:
        // Give the sacrificial team a score just before the R8 kick overlay;
        // only matters when TOTAL > 8, so it lives outside the 1-7 core.
        return { type: "song", a: KICK_TEAM };
      default: {
        // Volume rounds 9..TOTAL: even -> feed the leader (+15), odd -> cycle a
        // list that repeats every path (incl. split/wrong/race) on other teams.
        const v = r - 9;
        if (v % 2 === 0) return { type: "both", a: "Team01" };
        const odd: Scenario[] = [
          { type: "split", a: "Team02", b: "Team03" },
          { type: "wrong", a: "Team04", b: "Team05" },
          { type: "race" },
          { type: "song", a: "Team06" },
          { type: "artist", a: "Team07" },
          { type: "both", a: "Team08" },
          { type: "song", a: "Team09" },
          { type: "artist", a: "Team02" },
          { type: "both", a: "Team03" },
          { type: "song", a: "Team04" },
          { type: "artist", a: "Team05" },
        ];
        return odd[Math.floor(v / 2) % odd.length]!;
      }
    }
  }

  async function runScenario(s: Scenario): Promise<Record<string, number>> {
    switch (s.type) {
      case "song": {
        paths.add("song+10");
        await buzzAndExpectWinner(teamByName(s.a));
        await applyCorrect(manager.page, { title: true });
        return { [s.a]: 10 };
      }
      case "artist": {
        paths.add("artist+5");
        await buzzAndExpectWinner(teamByName(s.a));
        await applyCorrect(manager.page, { artist: true });
        return { [s.a]: 5 };
      }
      case "both": {
        paths.add("both+15");
        await buzzAndExpectWinner(teamByName(s.a));
        await applyCorrect(manager.page, { title: true, artist: true });
        return { [s.a]: 15 };
      }
      case "split": {
        paths.add("multibuzz-split");
        await buzzAndExpectWinner(teamByName(s.a));
        await awardAndContinue(manager.page, { title: true }); // a +10, lock released
        await expectBuzzGreen(teamByName(s.b));
        await buzzAndExpectWinner(teamByName(s.b));
        await applyCorrect(manager.page, { artist: true }); // b +5
        return { [s.a]: 10, [s.b]: 5 };
      }
      case "wrong": {
        paths.add("wrong-then-win");
        await buzzAndExpectWinner(teamByName(s.a));
        await markWrong(manager.page); // a -3, lock released
        await expectBuzzGreen(teamByName(s.b));
        await buzzAndExpectWinner(teamByName(s.b));
        await applyCorrect(manager.page, { title: true }); // b +10
        return { [s.a]: -3, [s.b]: 10 };
      }
      case "noscore": {
        paths.add("continue-noscore");
        await buzzAndExpectWinner(teamByName(s.a));
        await awardAndContinue(manager.page, {}); // release lock, no score
        return {};
      }
      case "race": {
        paths.add("concurrent-race");
        const winner = await runBuzzRace(code, active, byId);
        await applyCorrect(manager.page, { title: true }); // winner +10
        return { [winner]: 10 };
      }
    }
  }

  // Bootstrap round 1 (Start game: header Round 0 -> 1).
  await advanceRound(manager.page);

  for (let r = 1; r <= TOTAL; r++) {
    await expect(manager.page.getByText(new RegExp(`Round ${r}$`, "i"))).toBeVisible({
      timeout: 15_000,
    });

    const delta = await runScenario(planFor(r));
    await settle(delta);

    // Early Realtime-at-scale checkpoint: the first score lands on the live
    // display across all ten team rows.
    if (r === 1) await expectDisplayScore(display, "Team01", expected["Team01"]!);

    // --- Bonus overlay: after round 2 is scored, before advancing. ---
    if (r === 2) {
      paths.add("bonus+4");
      await awardBonusToTeam(manager.page, BONUS_TEAM);
      await settle({ [BONUS_TEAM]: 4 });
    }

    // Advance to the next round, except after the final round (so exactly
    // TOTAL game_rounds rows exist).
    if (r < TOTAL) {
      await advanceRound(manager.page);
    }

    // --- Kick overlay: after round 8 advances (no active buzz), remove the
    //     sacrificial team that scored in R8. Standings for everyone else must
    //     be untouched. ---
    if (r === 8 && TOTAL > 8) {
      paths.add("kick-midgame");
      const kickId = byName[KICK_TEAM]!;
      const kicked = teamByName(KICK_TEAM);
      const survivorsBefore = { ...expected };
      delete survivorsBefore[KICK_TEAM];

      await kickTeamViaApi(code, manager.managerToken, kickId);

      // The kicked player's tab is bounced home (Realtime removed its row).
      await expect(kicked.page.getByTestId("buzz")).toHaveCount(0, { timeout: 15_000 });
      // The display drops the team.
      await expect(display.locator(`[data-team-id]:has-text("${KICK_TEAM}")`)).toHaveCount(0, {
        timeout: 15_000,
      });
      // The DB now holds exactly 9 teams; every survivor keeps its exact score.
      const after = await dbScores(code);
      expect(Object.keys(after).length).toBe(TEAM_COUNT - 1);
      expect(after[KICK_TEAM]).toBeUndefined();
      for (const [name, score] of Object.entries(survivorsBefore)) {
        expect(after[name], `survivor ${name} score unchanged by kick`).toBe(score);
      }
      // Realtime checkpoint: a survivor's score still renders on the display
      // after the kick redrew the board.
      await expectDisplayScore(display, "Team01", expected["Team01"]!);

      // Drop from local roster + expectations so later rounds ignore it.
      active = active.filter((t) => t.name !== KICK_TEAM);
      delete expected[KICK_TEAM];
    }
  }

  // The last round was scored but not advanced, so its correct-answer team
  // still holds the buzz lock. Release it so the final board is a clean,
  // no-buzz state before the podium-color assertions.
  const cont = manager.page.getByTestId("continue-round");
  if (await cont.isEnabled()) {
    await cont.click();
    await expect(cont).toBeDisabled({ timeout: 10_000 });
  }

  // ---- Final live scoreboard: the top 5 survivors show their exact totals on
  //      the board; everyone below the cut is named by the "+N more" hint
  //      (issue #179). Every survivor's total is still checked against the DB
  //      via settle() each round, so board-invisibility loses no coverage. ----
  const rankedSurvivors = Object.entries(expected).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    // Earlier joiner wins ties; teams joined in TeamNN order, so the padded name
    // sorts the same way the board's joined_at tiebreak does.
    return a[0].localeCompare(b[0]);
  });
  for (const [name, total] of rankedSurvivors.slice(0, 5)) {
    await expectDisplayScore(display, name, total);
  }
  await expect(display.locator("[data-team-id]")).toHaveCount(5);
  const hiddenSurvivors = rankedSurvivors.length - 5;
  if (hiddenSurvivors > 0) {
    await expect(display.getByTestId("more-teams")).toHaveText(
      `+${hiddenSurvivors} more ${hiddenSurvivors === 1 ? "team" : "teams"} playing`,
    );
  }

  // ---- Podium colors on the live display (gold/silver/bronze on ranks 1-3) ----
  const sorted = Object.entries(expected).sort((a, b) => b[1] - a[1]);
  const leaderName = sorted[0]![0];
  expect(leaderName, "Team01 is designed to be the unique top scorer").toBe("Team01");
  expect(sorted[0]![1], "top score must be strictly greater than 2nd (unique leader)").toBeGreaterThan(
    sorted[1]![1],
  );
  const rows = display.locator("[data-team-id]");
  await expect(rows.nth(0)).toHaveClass(/bigRowGold/);
  await expect(rows.nth(0)).toHaveAttribute("data-team-id", byName[leaderName]!);
  // Medals follow the dense place (game-rules.md §4: tied teams share it):
  // rank 1 gold, 2 silver, 3 bronze, rank 4+ none. A team tied for 3rd shares
  // bronze, so assert each row's medal against its data-rank rather than its
  // position (position-based medals broke when 3rd/4th tied).
  const medalByRank: Record<string, RegExp> = {
    "1": /bigRowGold/,
    "2": /bigRowSilver/,
    "3": /bigRowBronze/,
  };
  const rowCount = await rows.count();
  for (let i = 0; i < rowCount; i++) {
    const row = rows.nth(i);
    const rank = (await row.getAttribute("data-rank"))!;
    const medal = medalByRank[rank];
    if (medal) {
      await expect(row).toHaveClass(medal);
    } else {
      await expect(row).not.toHaveClass(/bigRowGold|bigRowSilver|bigRowBronze/);
    }
  }

  // ---- End the game: podium + winner ----
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
  await expect(finalSb.locator(`[data-team-id="${byName[leaderName]!}"]`)).toHaveAttribute(
    "data-rank",
    "1",
  );

  // ---- Ground truth #1: live game_teams scores ----
  const gt = await dbScores(code);
  expect(gt).toEqual(expected);

  // ---- Ground truth #2: durable game_history archive (migration 033) ----
  const survivorCount = Object.keys(expected).length;
  const ghRows = await getJson<Array<{ id: string; round_count: number; team_count: number }>>(
    `game_history?game_code=eq.${code}&select=id,round_count,team_count`,
  );
  expect(ghRows.length).toBe(1);
  expect(ghRows[0]!.round_count).toBe(TOTAL);
  expect(ghRows[0]!.team_count).toBe(survivorCount);
  const historyId = ghRows[0]!.id;

  const ghtRows = await getJson<Array<{ name: string; score: number }>>(
    `game_history_teams?game_history_id=eq.${historyId}&select=name,score`,
  );
  expect(ghtRows.length).toBe(survivorCount);
  expect(Object.fromEntries(ghtRows.map((r) => [r.name, r.score]))).toEqual(expected);

  const ghsRows = await getJson<Array<{ round_number: number }>>(
    `game_history_songs?game_history_id=eq.${historyId}&select=round_number`,
  );
  expect(ghsRows.length).toBe(TOTAL);
  expect(new Set(ghsRows.map((r) => r.round_number)).size).toBe(TOTAL);

  // ---- Coverage guard: every scoring path whose scheduled round actually ran ----
  // The pool can cap TOTAL below a path's round (skipped + logged above); a
  // skipped path must not fail the guard. Each entry is [path, first round
  // that schedules it]; kick-midgame already keys off TOTAL below.
  const wantPaths: Array<[string, number]> = [
    ["song+10", 1],
    ["artist+5", 2],
    ["bonus+4", 2],
    ["both+15", 3],
    ["multibuzz-split", 4],
    ["wrong-then-win", 5],
    ["continue-noscore", 6],
    ["concurrent-race", 7],
  ];
  for (const [p, firstRound] of wantPaths) {
    if (TOTAL < firstRound) continue;
    expect(paths.has(p), `scoring path '${p}' should have been exercised`).toBe(true);
  }
  if (TOTAL > 8) expect(paths.has("kick-midgame")).toBe(true);
  testInfo.annotations.push({ type: "paths", description: [...paths].sort().join(", ") });
});

// ===========================================================================
// Focused soundtrack test: single 🎬 token, +15, film-name reveal.
// (Kept separate from the 30-round game so its score math stays deterministic.)
// ===========================================================================
test("soundtrack round: single +15 token, 🎬 badge + film reveal, scores correctly", async ({
  browser,
}) => {
  test.setTimeout(180_000);

  const pool = await countSongsInGenreSlugs(["soundtracks", "israeli-soundtracks"]);
  const rounds = Math.min(2, pool);
  expect(rounds, "need at least one soundtrack song").toBeGreaterThanOrEqual(1);

  const manager = await openManagerAndCreateGame(browser, { genreName: "Soundtracks" });
  const code = manager.gameCode;

  const names = ["Alpha", "Bravo", "Charlie"];
  const st: JoinedTeam[] = [];
  for (const n of names) st.push(await joinAsTeam(browser, code, n));

  const displayCtx = await browser.newContext();
  const display = await displayCtx.newPage();
  await display.goto(`/display/${code}`);
  for (const n of names) {
    await expect(display.locator(`[data-team-id]:has-text("${n}")`).first()).toBeVisible({
      timeout: 20_000,
    });
  }

  const expected: Record<string, number> = { Alpha: 0, Bravo: 0, Charlie: 0 };

  await advanceRound(manager.page); // start round 1

  for (let r = 1; r <= rounds; r++) {
    await expect(manager.page.getByText(new RegExp(`Round ${r}$`, "i"))).toBeVisible({
      timeout: 15_000,
    });

    // Manager renders the single +15 soundtrack control (no title/artist split).
    await expect(manager.page.getByTestId("soundtrack-badge")).toBeVisible();
    await expect(manager.page.getByTestId("score-soundtrack")).toBeVisible();
    await expect(manager.page.getByTestId("score-title")).toHaveCount(0);
    await expect(manager.page.getByTestId("score-artist")).toHaveCount(0);
    // Display shows the 🎬 badge and exactly one reveal row (the film name).
    await expect(display.getByTestId("soundtrack-badge")).toBeVisible();
    await expect(display.getByTestId("display-reveal-title")).toHaveCount(1);
    await expect(display.getByTestId("display-reveal-artist")).toHaveCount(0);
    // Before the answer is claimed, the film name is hidden.
    await expect(display.getByTestId("display-reveal-title")).toContainText("???");

    const team = st[(r - 1) % st.length]!;
    await buzzAndExpectWinner(team);
    await manager.page.getByTestId("score-soundtrack").click();
    expected[team.name]! += 15;

    // Score lands on the display, and the film name is now revealed (no "???").
    await expectDisplayScore(display, team.name, expected[team.name]!);
    await expect(display.getByTestId("display-reveal-title")).not.toContainText("???", {
      timeout: 10_000,
    });

    if (r < rounds) await advanceRound(manager.page);
  }

  // DB ground truth.
  const gt = Object.fromEntries(
    (
      await getJson<Array<{ name: string; score: number }>>(
        `game_teams?game_code=eq.${code}&select=name,score`,
      )
    ).map((row) => [row.name, row.score]),
  );
  expect(gt).toEqual(expected);

  // End game -> podium renders.
  const endBtn = manager.page.getByTestId("end-game");
  await expect(endBtn).toBeEnabled();
  await endBtn.click();
  const dialog = manager.page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /^end game$/i }).click();
  await expect(display.getByRole("heading", { name: /final results/i })).toBeVisible({
    timeout: 15_000,
  });
});
