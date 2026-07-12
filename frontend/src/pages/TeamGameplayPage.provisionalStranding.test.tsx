import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/supabase", async () => {
  const mod = await import("../test/supabaseMock");
  return { supabase: mod.supabaseMock };
});

import { _resetServerTime } from "../hooks/useServerTime";
import { PROVISIONAL_LOCK_TTL_MS } from "../hooks/useBuzzer";
import {
  fireRound,
  fireStatus,
  fireSubscribed,
  makeActiveGame,
  makePayload,
  makeRound,
  makeTeam,
  resetSupabaseMock,
  setHydrate,
  setRpcResponse,
} from "../test/supabaseMock";
import { TeamGameplayPage } from "./TeamGameplayPage";

// Regression tests for issue #261: a team's BUZZ button strands on
// "SOMEONE ELSE BUZZED" on an OPEN round after a WebSocket-only outage. The
// optimistic ("provisional") lock painted from buzz_in is only reconciled when
// the authoritative Realtime lock CHANGES value. When the client's socket is
// down while another team takes the lock AND it is released (or the round
// advances), this tab misses both events, its buzzed_team_id stays null->null,
// the reconciler never fires, and the button stays red/disabled until some
// other team next buzzes. #254 (keep the buzzer live during "reconnecting")
// newly exposes this: before it, a reconnecting button was disabled so no
// provisional could be created mid-outage.
//
// These simulate the exact outage sequence the harness reproduced on prod:
// the socket is half-open (status "reconnecting", the app stays live), the
// player presses and LOSES over REST (buzz_in returns the real winner), and
// the clearing event never reaches this tab. The fix self-heals the guess via
// a round-advance reconciler and a TTL backstop.

beforeEach(() => {
  resetSupabaseMock();
  window.localStorage.clear();
  _resetServerTime();
});

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  window.localStorage.clear();
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/team/:gameCode" element={<TeamGameplayPage />} />
        <Route path="/join/:gameCode" element={<div>join page</div>} />
        <Route path="/" element={<div>home page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

function makeTeams() {
  // team-1 is us; team-2 is the team that wins the buzz we lose.
  return Array.from({ length: 4 }, (_, i) =>
    makeTeam({ id: `team-${i + 1}`, name: `Team ${i + 1}` }),
  );
}

function storeOwnTeam() {
  window.localStorage.setItem("game:ABCDEF:team", JSON.stringify({ id: "team-1", name: "Team 1" }));
}

// Bring the page up to a live, idle, subscribed round with our team joined.
async function mountAtRound(roundNumber: number) {
  storeOwnTeam();
  setHydrate({
    game: makeActiveGame({
      status: "playing",
      round_number: roundNumber,
      current_round_id: `r${roundNumber}`,
      current_song_id: `song-${roundNumber}`,
    }),
    teams: makeTeams(),
    rounds: [
      makeRound({
        id: `r${roundNumber}`,
        round_number: roundNumber,
        song_id: `song-${roundNumber}`,
      }),
    ],
  });
  renderAt("/team/ABCDEF");
  await act(async () => {
    await fireSubscribed();
  });
  await waitFor(() => expect(screen.getByTestId("buzz")).toBeEnabled());
  expect(screen.getByTestId("buzz")).toHaveAttribute("data-tone", "idle");
}

// Drop into the half-open-socket state and lose a buzz over REST, so the button
// paints the provisional "SOMEONE ELSE BUZZED, Team 2 got it first".
async function loseBuzzWhileReconnecting() {
  // The WebSocket goes half-open: status stays "reconnecting", but #254 keeps
  // the button live because buzz_in is an independent REST call.
  await act(async () => {
    await fireStatus("CHANNEL_ERROR");
  });
  expect(screen.getByTestId("buzz")).toBeEnabled();

  // We press and LOSE: buzz_in returns team-2 as the definitive winner. Our
  // dead socket never delivers the authoritative lock event, so we paint it
  // optimistically from the RPC result alone.
  setRpcResponse({
    data: [{ locked: false, locked_team_id: "team-2", locked_at: "2026-05-05T12:01:00Z" }],
    error: null,
  });
  act(() => {
    screen.getByTestId("buzz").click();
  });
  await waitFor(() =>
    expect(screen.getByTestId("buzz")).toHaveAttribute("data-tone", "locked-other"),
  );
  const stranded = screen.getByTestId("buzz");
  expect(stranded).toHaveTextContent(/someone else buzzed/i);
  expect(stranded).toHaveTextContent(/Team 2 got it first/i);
  expect(stranded).toBeDisabled();
}

describe("TeamGameplayPage — provisional lock stranding recovery (#261)", () => {
  // This test waits on the real ~2.5s TTL (window.setTimeout in the hook), so its
  // waitFor budget below is PROVISIONAL_LOCK_TTL_MS + 3000 = 5500ms. Give the
  // `it` an explicit per-test timeout ABOVE that budget: Vitest's default is
  // 5000ms, which would otherwise abort the test at 5000ms with a generic
  // "timed out" before the waitFor could surface a clear assertion failure.
  it(
    "re-arms a stranded 'SOMEONE ELSE BUZZED' button via the TTL after a missed lock + missed release",
    async () => {
      await mountAtRound(4);
      await loseBuzzWhileReconnecting();

      // The manager releases the lock (Continue round), but our socket is still
      // down so we miss that clear too: buzzed_team_id stays null->null from our
      // view and the round never advances, so neither reconciler fires. Before
      // #261 the button strands here for the rest of the round. The TTL backstop
      // must re-arm it on its own -- with NO further events reaching this tab.
      await waitFor(
        () => {
          const buzz = screen.getByTestId("buzz");
          expect(buzz).toHaveAttribute("data-tone", "idle");
          expect(buzz).toBeEnabled();
        },
        { timeout: PROVISIONAL_LOCK_TTL_MS + 3000 },
      );
    },
    PROVISIONAL_LOCK_TTL_MS + 7500,
  );

  it("re-arms immediately when the round advances even though the lock-clearing UPDATE was dropped", async () => {
    await mountAtRound(4);
    await loseBuzzWhileReconnecting();

    // The manager advances the round. The active_games UPDATE that clears the
    // lock + bumps the round is dropped (our socket is half-open), but the
    // same-transaction game_rounds INSERT for the new round still lands.
    // useGameChannel derives the advance from it (round_number 4 -> 5,
    // buzzed_team_id -> null). buzzed_team_id was already null from our view, so
    // the authoritative-lock reconciler does NOT fire -- only the round-advance
    // reconciler clears the stranded provisional. No TTL wait needed.
    act(() => {
      fireRound(
        makePayload("game_rounds", "INSERT", {
          new: makeRound({ id: "r5", round_number: 5, song_id: "song-5" }),
        }),
      );
    });

    const rearmed = screen.getByTestId("buzz");
    expect(rearmed).toHaveAttribute("data-tone", "idle");
    expect(rearmed).toBeEnabled();
    expect(screen.getByTestId("round-indicator")).toHaveTextContent("R5");
  });
});
