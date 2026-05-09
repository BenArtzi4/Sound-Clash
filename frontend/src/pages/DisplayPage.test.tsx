import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
} from "../test/supabaseMock";
import { DisplayPage } from "./DisplayPage";

beforeEach(() => {
  resetSupabaseMock();
});

afterEach(() => {
  vi.clearAllMocks();
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/display" element={<DisplayPage />} />
        <Route path="/display/:gameCode" element={<DisplayPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("DisplayPage entry", () => {
  it("shows the entry form without a code", () => {
    renderAt("/display");
    expect(screen.getByPlaceholderText(/ABCDEF/i)).toBeInTheDocument();
  });

  it("disables Open until the code is valid", () => {
    renderAt("/display");
    const open = screen.getByRole("button", { name: /open/i });
    expect(open).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText(/ABCDEF/i), {
      target: { value: "abcdef" },
    });
    expect(open).toBeEnabled();
  });

  it("navigates to the board on submit", async () => {
    setHydrate({
      game: makeActiveGame({ status: "playing" }),
      teams: [makeTeam({ id: "t1", name: "Alice", score: 7 })],
      rounds: [],
    });
    renderAt("/display");
    fireEvent.change(screen.getByPlaceholderText(/ABCDEF/i), {
      target: { value: "ABCDEF" },
    });
    fireEvent.click(screen.getByRole("button", { name: /open/i }));
    await act(async () => {
      await fireSubscribed();
    });
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());
  });
});

describe("DisplayPage board", () => {
  it("renders waiting banner before the game starts", async () => {
    setHydrate({
      game: makeActiveGame({ status: "waiting" }),
      teams: [],
      rounds: [],
    });
    renderAt("/display/ABCDEF");
    await act(async () => {
      await fireSubscribed();
    });
    expect(screen.getByText(/waiting for the host/i)).toBeInTheDocument();
  });

  it("renders the round banner during play", async () => {
    setHydrate({
      game: makeActiveGame({ status: "playing", round_number: 2 }),
      teams: [makeTeam()],
      rounds: [],
    });
    renderAt("/display/ABCDEF");
    await act(async () => {
      await fireSubscribed();
    });
    expect(screen.getByText(/round 2$/i)).toBeInTheDocument();
  });

  it("renders the buzzed banner when a team locks", async () => {
    setHydrate({
      game: makeActiveGame({
        status: "playing",
        buzzed_team_id: "t1",
      }),
      teams: [makeTeam({ id: "t1", name: "Alice" })],
      rounds: [],
    });
    renderAt("/display/ABCDEF");
    await act(async () => {
      await fireSubscribed();
    });
    expect(screen.getByText(/Alice buzzed in/i)).toBeInTheDocument();
  });

  it("renders the post-buzz countdown when the game is locked with a locked_at", async () => {
    // serverTimeNow is offset-anchored to the first commit_timestamp it sees;
    // making locked_at recent ensures the countdown sits inside (0, 10] sec.
    const lockedAt = new Date(Date.now() - 2_000).toISOString();
    setHydrate({
      game: makeActiveGame({
        status: "playing",
        buzzed_team_id: "t1",
        locked_at: lockedAt,
      }),
      teams: [makeTeam({ id: "t1", name: "Alice" })],
      rounds: [],
    });
    renderAt("/display/ABCDEF");
    await act(async () => {
      await fireSubscribed();
    });
    const timer = screen.getByRole("timer", { name: /time remaining/i });
    const value = parseInt((timer.textContent ?? "").replace(/\D/g, ""), 10);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(10);
  });

  it("does not render the countdown when no team has buzzed yet", async () => {
    setHydrate({
      game: makeActiveGame({ status: "playing", buzzed_team_id: null, locked_at: null }),
      teams: [makeTeam({ id: "t1", name: "Alice" })],
      rounds: [],
    });
    renderAt("/display/ABCDEF");
    await act(async () => {
      await fireSubscribed();
    });
    expect(screen.queryByRole("timer")).not.toBeInTheDocument();
  });

  it("renders the end-screen splash when the game is over", async () => {
    setHydrate({
      game: makeActiveGame({ status: "ended" }),
      teams: [makeTeam({ id: "t1", name: "Alice", score: 12 })],
      rounds: [],
    });
    renderAt("/display/ABCDEF");
    await act(async () => {
      await fireSubscribed();
    });
    expect(screen.getByText(/final results/i)).toBeInTheDocument();
    expect(screen.getByText(/winner/i)).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  it("renders an empty-board hint when no teams have joined", async () => {
    setHydrate({
      game: makeActiveGame({ status: "waiting" }),
      teams: [],
      rounds: [],
    });
    renderAt("/display/ABCDEF");
    await act(async () => {
      await fireSubscribed();
    });
    expect(screen.getByText(/waiting for teams/i)).toBeInTheDocument();
  });

  it("toggles the sound button between off and on states", async () => {
    setHydrate({
      game: makeActiveGame({ status: "waiting" }),
      teams: [],
      rounds: [],
    });
    renderAt("/display/ABCDEF");
    await act(async () => {
      await fireSubscribed();
    });
    const btn = screen.getByRole("button", { name: /enable sound/i });
    expect(btn).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(btn);
    expect(screen.getByRole("button", { name: /sound on/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});
