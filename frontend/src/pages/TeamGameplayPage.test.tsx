import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/supabase", async () => {
  const mod = await import("../test/supabaseMock");
  return { supabase: mod.supabaseMock };
});

import { _resetServerTime } from "../hooks/useServerTime";
import {
  fireSubscribed,
  fireTeam,
  makeActiveGame,
  makePayload,
  makeRound,
  makeTeam,
  resetSupabaseMock,
  setHydrate,
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
      game: makeActiveGame({ status: "playing" }),
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
});
