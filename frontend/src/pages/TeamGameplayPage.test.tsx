import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/supabase", async () => {
  const mod = await import("../test/supabaseMock");
  return { supabase: mod.supabaseMock };
});

import {
  fireSubscribed,
  makeActiveGame,
  makeTeam,
  resetSupabaseMock,
  setHydrate,
  supabaseMock,
} from "../test/supabaseMock";
import { TeamGameplayPage } from "./TeamGameplayPage";

beforeEach(() => {
  resetSupabaseMock();
  window.localStorage.clear();
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

  it("renders the team name and game code from storage", async () => {
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
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("ABCDEF")).toBeInTheDocument();
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

  it("shows ‘you buzzed’ banner when own team holds the lock", async () => {
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
    expect(screen.getByText(/you buzzed in/i)).toBeInTheDocument();
  });

  it("shows other team locked it when someone else holds the lock", async () => {
    window.localStorage.setItem(
      "game:ABCDEF:team",
      JSON.stringify({ id: "team-1", name: "Alice" }),
    );
    setHydrate({
      game: makeActiveGame({
        status: "playing",
        buzzed_team_id: "team-2",
      }),
      teams: [
        makeTeam({ id: "team-1", name: "Alice" }),
        makeTeam({ id: "team-2", name: "Bob" }),
      ],
      rounds: [],
    });
    renderAt("/team/ABCDEF");
    await act(async () => {
      await fireSubscribed();
    });
    expect(screen.getByText(/Bob locked it/i)).toBeInTheDocument();
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
    await waitFor(() =>
      expect(screen.getByText("home page")).toBeInTheDocument(),
    );
    expect(window.localStorage.getItem("game:ABCDEF:team")).toBeNull();
  });

  it("ignores malformed JSON in storage and treats as missing", () => {
    window.localStorage.setItem("game:ABCDEF:team", "{not json");
    renderAt("/team/ABCDEF");
    expect(screen.getByText("join page")).toBeInTheDocument();
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
