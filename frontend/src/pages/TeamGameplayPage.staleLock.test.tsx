import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/supabase", async () => {
  const mod = await import("../test/supabaseMock");
  return { supabase: mod.supabaseMock };
});

import { _resetServerTime } from "../hooks/useServerTime";
import type { ActiveGame } from "../lib/types";
import {
  fireGame,
  fireRound,
  fireStatus,
  fireSubscribed,
  makeActiveGame,
  makePayload,
  makeRound,
  makeTeam,
  resetSupabaseMock,
  supabaseMock,
  setHydrate,
} from "../test/supabaseMock";
import { TeamGameplayPage } from "./TeamGameplayPage";

// Regression tests for issue #254: intermittent stuck buzzers in a live
// 10-team, 39-round game (52QCBN). The buzz button's lock state is derived
// entirely from Realtime postgres_changes on active_games, and Supabase
// Realtime never replays an event lost to a dropped socket, a silent
// heartbeat death (~25-50s undetected), or free-tier throughput pressure.
// A client that misses the round-advance active_games UPDATE therefore kept
// the PREVIOUS round's buzz lock — the button read "SOMEONE ELSE BUZZED,
// <prev team> got it first" in a fresh round and never turned green until
// the 60s backstop resync, far slower than a round. These tests simulate
// exactly those losses at the real game's scale.

beforeEach(() => {
  resetSupabaseMock();
  window.localStorage.clear();
  _resetServerTime();
});

afterEach(() => {
  vi.clearAllMocks();
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

const TEAM_COUNT = 10;
const ROUND_ADVANCES = 39;

function makeTeams() {
  return Array.from({ length: TEAM_COUNT }, (_, i) =>
    makeTeam({ id: `team-${i + 1}`, name: `Team ${i + 1}` }),
  );
}

function storeOwnTeam() {
  window.localStorage.setItem("game:ABCDEF:team", JSON.stringify({ id: "team-1", name: "Team 1" }));
}

describe("TeamGameplayPage — stale buzz lock recovery (#254)", () => {
  it("re-arms the buzzer on every round advance even when every active_games UPDATE is dropped (H1)", async () => {
    storeOwnTeam();
    let game: ActiveGame = makeActiveGame({
      status: "playing",
      round_number: 1,
      current_round_id: "r1",
      current_song_id: "song-1",
    });
    setHydrate({
      game,
      teams: makeTeams(),
      rounds: [makeRound({ id: "r1", round_number: 1, song_id: "song-1" })],
    });
    renderAt("/team/ABCDEF");
    await act(async () => {
      await fireSubscribed();
    });
    await waitFor(() => expect(screen.getByTestId("buzz")).toBeEnabled());

    // Play out the real game's profile: on every round, another team wins the
    // buzz race (that active_games UPDATE arrives fine), then the manager hits
    // "Next round" — and the active_games UPDATE that clears the lock is
    // dropped. Only the same-transaction game_rounds events (close prior round
    // + INSERT new round) reach this client, exactly what start_round's single
    // transaction guarantees exists alongside the lost UPDATE.
    for (let n = 2; n <= ROUND_ADVANCES + 1; n++) {
      const locker = `team-${(n % (TEAM_COUNT - 1)) + 2}`;
      // The buzz lock UPDATE carries the DB row as it really is mid-round n-1
      // (only the round-ADVANCE update is dropped in this scenario).
      game = {
        ...game,
        round_number: n - 1,
        current_round_id: `r${n - 1}`,
        current_song_id: `song-${n - 1}`,
        buzzed_team_id: locker,
        locked_at: "2026-05-05T12:01:00.000Z",
      };
      act(() => {
        fireGame(makePayload("active_games", "UPDATE", { new: game }));
      });
      const buzz = screen.getByTestId("buzz");
      expect(buzz).toHaveAttribute("data-tone", "locked-other");
      expect(buzz).toBeDisabled();

      // Round advance with the active_games UPDATE dropped: deliver only the
      // two game_rounds events of start_round's transaction.
      act(() => {
        fireRound(
          makePayload("game_rounds", "UPDATE", {
            new: makeRound({
              id: `r${n - 1}`,
              round_number: n - 1,
              song_id: `song-${n - 1}`,
              ended_at: "2026-05-05T12:02:00.000Z",
            }),
          }),
        );
        fireRound(
          makePayload("game_rounds", "INSERT", {
            new: makeRound({ id: `r${n}`, round_number: n, song_id: `song-${n}` }),
          }),
        );
      });

      // The fresh round must re-arm this team's buzzer immediately — not show
      // the previous round's "SOMEONE ELSE BUZZED, <locker> got it first"
      // until the 60s backstop.
      const rearmed = screen.getByTestId("buzz");
      expect(rearmed).toHaveAttribute("data-tone", "idle");
      expect(rearmed).toBeEnabled();
      expect(screen.getByTestId("round-indicator")).toHaveTextContent(`R${n}`);
    }
  });

  it("keeps the buzzer usable while the channel is reconnecting mid-round (H2)", async () => {
    storeOwnTeam();
    setHydrate({
      game: makeActiveGame({
        status: "playing",
        round_number: 3,
        current_round_id: "r3",
        current_song_id: "song-3",
      }),
      teams: makeTeams(),
      rounds: [makeRound({ id: "r3", round_number: 3, song_id: "song-3" })],
    });
    renderAt("/team/ABCDEF");
    await act(async () => {
      await fireSubscribed();
    });
    await waitFor(() => expect(screen.getByTestId("buzz")).toBeEnabled());

    // The WebSocket hiccups (CHANNEL_ERROR): supabase-js rejoins with backoff
    // that plateaus at 10s, and an outage keeps the app in "reconnecting" the
    // whole time. buzz_in is a PostgREST REST call, independent of the
    // WebSocket — the button must stay usable, not go dead for the outage.
    await act(async () => {
      await fireStatus("CHANNEL_ERROR");
    });
    const buzz = screen.getByTestId("buzz");
    expect(buzz).toHaveAttribute("data-tone", "idle");
    expect(buzz).toBeEnabled();

    // And a press during the blip still fires the RPC.
    act(() => {
      buzz.click();
    });
    await waitFor(() => {
      expect(supabaseMock.rpc).toHaveBeenCalledWith("buzz_in", {
        p_game_code: "ABCDEF",
        p_team_id: "team-1",
      });
    });
  });
});
