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
    expect(screen.getByText(/round 2 of 10/i)).toBeInTheDocument();
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

  it("renders the ended banner when the game is over", async () => {
    setHydrate({
      game: makeActiveGame({ status: "ended" }),
      teams: [],
      rounds: [],
    });
    renderAt("/display/ABCDEF");
    await act(async () => {
      await fireSubscribed();
    });
    expect(screen.getByText(/game over/i)).toBeInTheDocument();
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
