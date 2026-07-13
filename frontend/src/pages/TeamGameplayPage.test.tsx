import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/supabase", async () => {
  const mod = await import("../test/supabaseMock");
  return { supabase: mod.supabaseMock };
});

import { _resetServerTime } from "../hooks/useServerTime";
import type { ActiveGame, Team } from "../lib/types";
import {
  fireGame,
  fireStatus,
  fireSubscribed,
  fireTeam,
  makeActiveGame,
  makePayload,
  makeRound,
  makeTeam,
  resetSupabaseMock,
  setHydrate,
  setRpcResponse,
  supabaseMock,
} from "../test/supabaseMock";
import { TeamGameplayPage } from "./TeamGameplayPage";

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

describe("TeamGameplayPage", () => {
  it("redirects to /join when localStorage is missing", () => {
    renderAt("/team/ABCDEF");
    expect(screen.getByText("join page")).toBeInTheDocument();
  });

  it("renders the team name from storage", async () => {
    window.localStorage.setItem(
      "game:ABCDEF:team",
      JSON.stringify({ id: "team-1", name: "Alice" }),
    );
    setHydrate({
      game: makeActiveGame({ status: "waiting" }),
      teams: [makeTeam({ id: "team-1", name: "Alice" })],
      rounds: [],
    });
    renderAt("/team/ABCDEF");
    await act(async () => {
      await fireSubscribed();
    });
    expect(screen.getAllByText("Alice").length).toBeGreaterThan(0);
  });

  it("disables buzz when game is waiting", async () => {
    window.localStorage.setItem(
      "game:ABCDEF:team",
      JSON.stringify({ id: "team-1", name: "Alice" }),
    );
    setHydrate({
      game: makeActiveGame({ status: "waiting" }),
      teams: [makeTeam({ id: "team-1" })],
      rounds: [],
    });
    renderAt("/team/ABCDEF");
    await act(async () => {
      await fireSubscribed();
    });
    expect(screen.getByTestId("buzz")).toBeDisabled();
  });

  it("enables buzz when playing and unlocked", async () => {
    window.localStorage.setItem(
      "game:ABCDEF:team",
      JSON.stringify({ id: "team-1", name: "Alice" }),
    );
    setHydrate({
      game: makeActiveGame({ status: "playing" }),
      teams: [makeTeam({ id: "team-1" })],
      rounds: [],
    });
    renderAt("/team/ABCDEF");
    await act(async () => {
      await fireSubscribed();
    });
    await waitFor(() => expect(screen.getByTestId("buzz")).toBeEnabled());
  });

  it("flips the buzz button to the winner tone when own team holds the lock", async () => {
    window.localStorage.setItem(
      "game:ABCDEF:team",
      JSON.stringify({ id: "team-1", name: "Alice" }),
    );
    setHydrate({
      game: makeActiveGame({
        status: "playing",
        buzzed_team_id: "team-1",
      }),
      teams: [makeTeam({ id: "team-1", name: "Alice" })],
      rounds: [],
    });
    renderAt("/team/ABCDEF");
    await act(async () => {
      await fireSubscribed();
    });
    const buzz = screen.getByTestId("buzz");
    expect(buzz).toHaveAttribute("data-tone", "winner");
    expect(buzz).toHaveTextContent(/you buzzed/i);
  });

  it("flips the buzz button to the locked-other tone when someone else holds the lock", async () => {
    window.localStorage.setItem(
      "game:ABCDEF:team",
      JSON.stringify({ id: "team-1", name: "Alice" }),
    );
    setHydrate({
      game: makeActiveGame({
        status: "playing",
        buzzed_team_id: "team-2",
      }),
      teams: [makeTeam({ id: "team-1", name: "Alice" }), makeTeam({ id: "team-2", name: "Bob" })],
      rounds: [],
    });
    renderAt("/team/ABCDEF");
    await act(async () => {
      await fireSubscribed();
    });
    const buzz = screen.getByTestId("buzz");
    expect(buzz).toHaveAttribute("data-tone", "locked-other");
    expect(buzz).toHaveTextContent(/Bob got it first/i);
  });

  it("clears storage and goes home when our team is gone after hydrate", async () => {
    window.localStorage.setItem(
      "game:ABCDEF:team",
      JSON.stringify({ id: "team-1", name: "Alice" }),
    );
    setHydrate({
      // Game still alive (expires_at in the future relative to the real
      // clock — no Realtime event pins the server offset in this test): a
      // missing team row on a live game is a kick, so the page bounces home.
      // An expired game shows the ended banner instead; see the T-CascadeTest
      // block below.
      game: makeActiveGame({ status: "playing", expires_at: "2099-01-01T00:00:00.000Z" }),
      teams: [],
      rounds: [],
    });
    renderAt("/team/ABCDEF");
    await act(async () => {
      await fireSubscribed();
    });
    await waitFor(() => expect(screen.getByText("home page")).toBeInTheDocument());
    expect(window.localStorage.getItem("game:ABCDEF:team")).toBeNull();
  });

  it("ignores malformed JSON in storage and treats as missing", () => {
    window.localStorage.setItem("game:ABCDEF:team", "{not json");
    renderAt("/team/ABCDEF");
    expect(screen.getByText("join page")).toBeInTheDocument();
  });

  it("renders the EndScreen podium when the game has ended", async () => {
    window.localStorage.setItem(
      "game:ABCDEF:team",
      JSON.stringify({ id: "team-1", name: "Alice" }),
    );
    setHydrate({
      game: makeActiveGame({ status: "ended" }),
      teams: [makeTeam({ id: "team-1", name: "Alice" })],
      rounds: [],
    });
    renderAt("/team/ABCDEF");
    await act(async () => {
      await fireSubscribed();
    });
    expect(screen.getByText(/^final results$/i)).toBeInTheDocument();
    expect(screen.queryByTestId("buzz")).not.toBeInTheDocument();
  });

  it("never renders the post-buzz countdown timer (the display screen is the source of truth)", async () => {
    // The team screen used to mirror the 10s post-buzz countdown from the
    // display, but it stole vertical real estate from the BUZZ button without
    // adding new info (players are already looking at the display). We now
    // assert there is never a timer here, even mid-buzz with another team
    // holding the lock.
    const FIXED_NOW = 1_780_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(FIXED_NOW);
    const lockedAt = new Date(FIXED_NOW - 2_000).toISOString();
    window.localStorage.setItem(
      "game:ABCDEF:team",
      JSON.stringify({ id: "team-1", name: "Alice" }),
    );
    setHydrate({
      game: makeActiveGame({
        status: "playing",
        current_round_id: "round-1",
        buzzed_team_id: "team-2",
        locked_at: lockedAt,
      }),
      teams: [makeTeam({ id: "team-1" }), makeTeam({ id: "team-2", name: "Bob" })],
      rounds: [makeRound({ id: "round-1" })],
    });
    renderAt("/team/ABCDEF");
    await act(async () => {
      await fireSubscribed();
    });
    expect(screen.queryByRole("timer")).not.toBeInTheDocument();
  });

  it("pops a +N pill on this team's phone when our own score goes up", async () => {
    window.localStorage.setItem(
      "game:ABCDEF:team",
      JSON.stringify({ id: "team-1", name: "Alice" }),
    );
    const me = makeTeam({ id: "team-1", name: "Alice", score: 0 });
    setHydrate({
      game: makeActiveGame({ status: "playing" }),
      teams: [me],
      rounds: [],
    });
    renderAt("/team/ABCDEF");
    await act(async () => {
      await fireSubscribed();
    });
    expect(screen.queryByTestId("point-change")).not.toBeInTheDocument();

    act(() => {
      fireTeam(makePayload("game_teams", "UPDATE", { new: { ...me, score: 10 } }));
    });
    const pill = await screen.findByTestId("point-change");
    expect(pill).not.toHaveTextContent("Alice");
    expect(pill).toHaveTextContent("+10");
  });

  it("pops a -N pill on this team's phone when our own score goes down (wrong buzz)", async () => {
    window.localStorage.setItem(
      "game:ABCDEF:team",
      JSON.stringify({ id: "team-1", name: "Alice" }),
    );
    const me = makeTeam({ id: "team-1", name: "Alice", score: 5 });
    setHydrate({
      game: makeActiveGame({ status: "playing" }),
      teams: [me],
      rounds: [],
    });
    renderAt("/team/ABCDEF");
    await act(async () => {
      await fireSubscribed();
    });
    act(() => {
      fireTeam(makePayload("game_teams", "UPDATE", { new: { ...me, score: 2 } }));
    });
    const pill = await screen.findByTestId("point-change");
    expect(pill).toHaveTextContent("-3");
  });

  // Issue #179: every player keeps their own place + score on their phone, so
  // they stay in the game even when they're off the top-5 Display board.
  it("shows the player's place and score during play", async () => {
    window.localStorage.setItem(
      "game:ABCDEF:team",
      JSON.stringify({ id: "team-2", name: "Bravo" }),
    );
    setHydrate({
      game: makeActiveGame({ status: "playing", round_number: 1 }),
      teams: [
        makeTeam({ id: "team-1", name: "Alpha", score: 30, joined_at: "2026-05-05T12:00:00.000Z" }),
        makeTeam({ id: "team-2", name: "Bravo", score: 20, joined_at: "2026-05-05T12:00:01.000Z" }),
        makeTeam({
          id: "team-3",
          name: "Charlie",
          score: 10,
          joined_at: "2026-05-05T12:00:02.000Z",
        }),
      ],
      rounds: [],
    });
    renderAt("/team/ABCDEF");
    await act(async () => {
      await fireSubscribed();
    });
    await screen.findByTestId("standings");
    expect(screen.getByTestId("standing-rank")).toHaveTextContent("#2 of 3");
    expect(screen.getByTestId("standing-score")).toHaveTextContent("20 pts");
  });

  it("hides the player standing while the game is waiting to start", async () => {
    window.localStorage.setItem(
      "game:ABCDEF:team",
      JSON.stringify({ id: "team-1", name: "Alpha" }),
    );
    setHydrate({
      game: makeActiveGame({ status: "waiting" }),
      teams: [makeTeam({ id: "team-1", name: "Alpha" })],
      rounds: [],
    });
    renderAt("/team/ABCDEF");
    await act(async () => {
      await fireSubscribed();
    });
    expect(screen.queryByTestId("standings")).not.toBeInTheDocument();
  });

  it("updates the player's place live when a rival overtakes their score", async () => {
    window.localStorage.setItem(
      "game:ABCDEF:team",
      JSON.stringify({ id: "team-1", name: "Alpha" }),
    );
    const alpha = makeTeam({
      id: "team-1",
      name: "Alpha",
      score: 10,
      joined_at: "2026-05-05T12:00:00.000Z",
    });
    const bravo = makeTeam({
      id: "team-2",
      name: "Bravo",
      score: 5,
      joined_at: "2026-05-05T12:00:01.000Z",
    });
    setHydrate({
      game: makeActiveGame({ status: "playing", round_number: 1 }),
      teams: [alpha, bravo],
      rounds: [],
    });
    renderAt("/team/ABCDEF");
    await act(async () => {
      await fireSubscribed();
    });
    expect(screen.getByTestId("standing-rank")).toHaveTextContent("#1 of 2");

    // Bravo overtakes -> Alpha drops to #2, own score unchanged.
    act(() => {
      fireTeam(makePayload("game_teams", "UPDATE", { new: { ...bravo, score: 25 } }));
    });
    await waitFor(() => expect(screen.getByTestId("standing-rank")).toHaveTextContent("#2 of 2"));
    expect(screen.getByTestId("standing-score")).toHaveTextContent("10 pts");
  });

  it("shows a bare '#1' with no 'of N' and singular 'pt' for a solo team on 1 point", async () => {
    // A score of exactly 1 is reachable (+4 bonus then a -3 wrong buzz), so the
    // readout must read "1 pt", not "1 pts".
    window.localStorage.setItem("game:ABCDEF:team", JSON.stringify({ id: "team-1", name: "Solo" }));
    setHydrate({
      game: makeActiveGame({ status: "playing", round_number: 1 }),
      teams: [makeTeam({ id: "team-1", name: "Solo", score: 1 })],
      rounds: [],
    });
    renderAt("/team/ABCDEF");
    await act(async () => {
      await fireSubscribed();
    });
    const rank = await screen.findByTestId("standing-rank");
    expect(rank).toHaveTextContent("#1");
    expect(rank).not.toHaveTextContent("of");
    // Anchored: a plain "1 pt" substring would also match "1 pts".
    expect(screen.getByTestId("standing-score")).toHaveTextContent(/^1 pt$/);
  });

  it("reads CONNECTING… before the channel subscribes", async () => {
    window.localStorage.setItem(
      "game:ABCDEF:team",
      JSON.stringify({ id: "team-1", name: "Alice" }),
    );
    // No fireSubscribed: the channel is still connecting, so the button reads
    // as progress rather than the wrong "WAITING for the game to start".
    renderAt("/team/ABCDEF");
    await waitFor(() => expect(screen.getByTestId("buzz")).toHaveTextContent(/connecting/i));
  });

  it("reads RECONNECTING… when the channel drops before the game starts", async () => {
    window.localStorage.setItem(
      "game:ABCDEF:team",
      JSON.stringify({ id: "team-1", name: "Alice" }),
    );
    setHydrate({
      game: makeActiveGame({ status: "waiting" }),
      teams: [makeTeam({ id: "team-1", name: "Alice" })],
      rounds: [],
    });
    renderAt("/team/ABCDEF");
    await act(async () => {
      await fireSubscribed();
    });
    const buzz = screen.getByTestId("buzz");
    await waitFor(() => expect(buzz).toHaveTextContent(/waiting/i));
    // Realtime drops before the host has started the game.
    await act(async () => {
      await fireStatus("CHANNEL_ERROR");
    });
    expect(buzz).toHaveTextContent(/reconnecting/i);
  });

  it("flips to the winner tone from the buzz_in result before any Realtime echo", async () => {
    // No Realtime UPDATE is fired here: the winner tone must come purely from
    // the optimistic provisional lock the buzz_in RPC returns.
    window.localStorage.setItem(
      "game:ABCDEF:team",
      JSON.stringify({ id: "team-1", name: "Alice" }),
    );
    setHydrate({
      game: makeActiveGame({ status: "playing" }),
      teams: [makeTeam({ id: "team-1", name: "Alice" })],
      rounds: [],
    });
    setRpcResponse({
      data: [{ locked: true, locked_team_id: "team-1", locked_at: "2026-05-05T12:00:00Z" }],
      error: null,
    });
    renderAt("/team/ABCDEF");
    await act(async () => {
      await fireSubscribed();
    });
    const buzz = screen.getByTestId("buzz");
    await waitFor(() => expect(buzz).toBeEnabled());
    await act(async () => {
      buzz.click();
    });
    await waitFor(() => expect(buzz).toHaveAttribute("data-tone", "winner"));
    expect(buzz).toHaveTextContent(/you buzzed/i);
  });

  it("flips to locked-other from the buzz_in result when another team wins the race", async () => {
    window.localStorage.setItem(
      "game:ABCDEF:team",
      JSON.stringify({ id: "team-1", name: "Alice" }),
    );
    setHydrate({
      game: makeActiveGame({ status: "playing" }),
      teams: [makeTeam({ id: "team-1", name: "Alice" }), makeTeam({ id: "team-2", name: "Bob" })],
      rounds: [],
    });
    // buzz_in reports the lock belongs to team-2 (we lost the race).
    setRpcResponse({
      data: [{ locked: false, locked_team_id: "team-2", locked_at: "2026-05-05T12:00:00Z" }],
      error: null,
    });
    renderAt("/team/ABCDEF");
    await act(async () => {
      await fireSubscribed();
    });
    const buzz = screen.getByTestId("buzz");
    await waitFor(() => expect(buzz).toBeEnabled());
    await act(async () => {
      buzz.click();
    });
    await waitFor(() => expect(buzz).toHaveAttribute("data-tone", "locked-other"));
    expect(buzz).toHaveTextContent(/Bob got it first/i);
  });

  it("renders the rpc-mock click without error", async () => {
    window.localStorage.setItem(
      "game:ABCDEF:team",
      JSON.stringify({ id: "team-1", name: "Alice" }),
    );
    setHydrate({
      game: makeActiveGame({ status: "playing" }),
      teams: [makeTeam({ id: "team-1" })],
      rounds: [],
    });
    renderAt("/team/ABCDEF");
    await act(async () => {
      await fireSubscribed();
    });
    await waitFor(() => expect(screen.getByTestId("buzz")).toBeEnabled());
    await act(async () => {
      screen.getByTestId("buzz").click();
    });
    expect(supabaseMock.rpc).toHaveBeenCalledWith("buzz_in", {
      p_game_code: "ABCDEF",
      p_team_id: "team-1",
    });
  });

  // T-CascadeTest: cleanup_expired_games cascade-deletes game_teams a beat
  // BEFORE active_games, so at expiry the team's DELETE arrives while the game
  // row is still present — by row absence alone it looks exactly like a kick.
  // These pin the ordering-sensitive distinction: expired game → banner,
  // live game → kick redirect, ended game → podium stays.
  //
  // Clock note: the first fired Realtime event pins serverTimeNow() to its
  // commit_timestamp (2026-05-05T12:00Z default), so expires_at values here are
  // chosen relative to that pinned clock, not the real one.
  describe("expiry teardown vs kick (T-CascadeTest)", () => {
    it("shows the ended banner, not the Home redirect, when the expiry cascade deletes our team row before the game row", async () => {
      window.localStorage.setItem(
        "game:ABCDEF:team",
        JSON.stringify({ id: "team-1", name: "Alice" }),
      );
      // The sweep only deletes games whose expires_at has passed.
      setHydrate({
        game: makeActiveGame({ status: "playing", expires_at: "2026-05-05T11:00:00.000Z" }),
        teams: [makeTeam({ id: "team-1", name: "Alice" })],
        rounds: [],
      });
      renderAt("/team/ABCDEF");
      await act(async () => {
        await fireSubscribed();
      });
      await waitFor(() => expect(screen.getByTestId("buzz")).toBeEnabled());

      // The cascade's first event: our game_teams row is deleted.
      act(() => {
        fireTeam(makePayload<Team>("game_teams", "DELETE", { old: { id: "team-1" } }));
      });
      expect(screen.getByText(/this game has ended or expired/i)).toBeInTheDocument();
      expect(screen.queryByText("home page")).not.toBeInTheDocument();
      expect(window.localStorage.getItem("game:ABCDEF:team")).toBeNull();

      // The active_games DELETE lands a beat later: the banner persists.
      act(() => {
        fireGame(
          makePayload<ActiveGame>("active_games", "DELETE", { old: { game_code: "ABCDEF" } }),
        );
      });
      expect(screen.getByText(/this game has ended or expired/i)).toBeInTheDocument();
      expect(screen.queryByText("home page")).not.toBeInTheDocument();
    });

    it("still bounces home when a live game kicks us mid-play", async () => {
      window.localStorage.setItem(
        "game:ABCDEF:team",
        JSON.stringify({ id: "team-1", name: "Alice" }),
      );
      // Default expires_at (far future) is well ahead of the pinned server
      // clock (12:00Z): a genuine kick, not teardown.
      setHydrate({
        game: makeActiveGame({ status: "playing" }),
        teams: [makeTeam({ id: "team-1", name: "Alice" })],
        rounds: [],
      });
      renderAt("/team/ABCDEF");
      await act(async () => {
        await fireSubscribed();
      });
      await waitFor(() => expect(screen.getByTestId("buzz")).toBeEnabled());

      act(() => {
        fireTeam(makePayload<Team>("game_teams", "DELETE", { old: { id: "team-1" } }));
      });
      await waitFor(() => expect(screen.getByText("home page")).toBeInTheDocument());
      expect(window.localStorage.getItem("game:ABCDEF:team")).toBeNull();
    });

    it("keeps the podium up when the post-end sweep deletes our team row", async () => {
      window.localStorage.setItem(
        "game:ABCDEF:team",
        JSON.stringify({ id: "team-1", name: "Alice" }),
      );
      setHydrate({
        game: makeActiveGame({
          status: "ended",
          ended_at: "2026-05-05T13:00:00.000Z",
          expires_at: "2026-05-05T11:00:00.000Z",
        }),
        teams: [
          makeTeam({ id: "team-1", name: "Alice", score: 10 }),
          makeTeam({ id: "team-2", name: "Bob", score: 3 }),
        ],
        rounds: [],
      });
      renderAt("/team/ABCDEF");
      await act(async () => {
        await fireSubscribed();
      });
      expect(screen.getByText(/^final results$/i)).toBeInTheDocument();

      act(() => {
        fireTeam(makePayload<Team>("game_teams", "DELETE", { old: { id: "team-1" } }));
      });
      expect(screen.getByText(/^final results$/i)).toBeInTheDocument();
      expect(screen.queryByText("home page")).not.toBeInTheDocument();
      expect(window.localStorage.getItem("game:ABCDEF:team")).toBeNull();
    });
  });

  // T4.11 / I-FinalBoard: the final scoreboard survives the row delete. When
  // the game is swept (or ended then swept), the page renders the podium from
  // the hook's last-known snapshot instead of a bare "gone" banner.
  describe("final board survives delete (I-FinalBoard)", () => {
    it("keeps the final scoreboard (with the expired banner) after the game row is deleted mid-play", async () => {
      window.localStorage.setItem(
        "game:ABCDEF:team",
        JSON.stringify({ id: "team-1", name: "Alice" }),
      );
      setHydrate({
        game: makeActiveGame({ status: "playing", expires_at: "2026-05-05T11:00:00.000Z" }),
        teams: [
          makeTeam({ id: "team-1", name: "Alice", score: 8 }),
          makeTeam({ id: "team-2", name: "Bob", score: 3 }),
        ],
        rounds: [],
      });
      renderAt("/team/ABCDEF");
      await act(async () => {
        await fireSubscribed();
      });
      await waitFor(() => expect(screen.getByTestId("buzz")).toBeEnabled());

      act(() => {
        fireGame(
          makePayload<ActiveGame>("active_games", "DELETE", { old: { game_code: "ABCDEF" } }),
        );
      });

      // The podium survives with BOTH teams, plus the "ended or expired"
      // banner because the game never reached the ended state.
      expect(screen.getByText(/^final results$/i)).toBeInTheDocument();
      expect(screen.getByText(/this game has ended or expired/i)).toBeInTheDocument();
      expect(screen.getAllByText("Bob").length).toBeGreaterThan(0);
      expect(screen.queryByText("home page")).not.toBeInTheDocument();
    });

    it("keeps the podium without the expired banner after an ended game's rows are deleted", async () => {
      window.localStorage.setItem(
        "game:ABCDEF:team",
        JSON.stringify({ id: "team-1", name: "Alice" }),
      );
      setHydrate({
        game: makeActiveGame({ status: "ended", ended_at: "2026-05-05T13:00:00.000Z" }),
        teams: [
          makeTeam({ id: "team-1", name: "Alice", score: 8 }),
          makeTeam({ id: "team-2", name: "Bob", score: 3 }),
        ],
        rounds: [],
      });
      renderAt("/team/ABCDEF");
      await act(async () => {
        await fireSubscribed();
      });
      expect(screen.getByText(/^final results$/i)).toBeInTheDocument();

      act(() => {
        fireGame(
          makePayload<ActiveGame>("active_games", "DELETE", { old: { game_code: "ABCDEF" } }),
        );
      });

      expect(screen.getByText(/^final results$/i)).toBeInTheDocument();
      expect(screen.queryByText(/this game has ended or expired/i)).not.toBeInTheDocument();
      expect(screen.getAllByText("Bob").length).toBeGreaterThan(0);
    });

    it("falls back to the bare banner when the game was already gone on arrival (no snapshot)", async () => {
      window.localStorage.setItem(
        "game:ABCDEF:team",
        JSON.stringify({ id: "team-1", name: "Alice" }),
      );
      setHydrate({ game: null, teams: [], rounds: [] });
      renderAt("/team/ABCDEF");
      await act(async () => {
        await fireSubscribed();
      });
      await waitFor(() =>
        expect(screen.getByText(/this game has ended or expired/i)).toBeInTheDocument(),
      );
      expect(screen.queryByText(/^final results$/i)).not.toBeInTheDocument();
    });
  });
});
