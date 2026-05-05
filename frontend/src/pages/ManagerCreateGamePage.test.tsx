import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/api", () => ({
  ApiError: class ApiError extends Error {
    code: string;
    status: number;
    details: unknown;
    constructor(code: string, message: string, status: number) {
      super(message);
      this.code = code;
      this.status = status;
      this.details = undefined;
    }
  },
  listGenres: vi.fn(),
  createGame: vi.fn(),
}));

import { createGame, listGenres } from "../lib/api";
import { ToastProvider } from "../context/ToastContext";
import { getManagerToken } from "../lib/managerToken";
import { ManagerCreateGamePage } from "./ManagerCreateGamePage";

beforeEach(() => {
  window.localStorage.clear();
  vi.mocked(listGenres).mockReset();
  vi.mocked(createGame).mockReset();
});

afterEach(() => {
  window.localStorage.clear();
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/manager/create"]}>
      <ToastProvider>
        <Routes>
          <Route path="/" element={<div>home page</div>} />
          <Route path="/manager/create" element={<ManagerCreateGamePage />} />
          <Route path="/manager/game/:gameCode" element={<div>game console</div>} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe("ManagerCreateGamePage", () => {
  it("loads genres and disables submit until at least one is selected", async () => {
    vi.mocked(listGenres).mockResolvedValueOnce([
      { id: "g1", name: "Rock", slug: "rock" },
      { id: "g2", name: "Pop", slug: "pop" },
    ]);
    renderPage();
    await waitFor(() => screen.getByText("Rock"));
    const submit = screen.getByRole("button", { name: /create game/i });
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/rock/i));
    expect(submit).toBeEnabled();
  });

  it("creates the game, stores the manager token, and navigates", async () => {
    vi.mocked(listGenres).mockResolvedValueOnce([{ id: "g1", name: "Rock", slug: "rock" }]);
    vi.mocked(createGame).mockResolvedValueOnce({
      game_code: "ZZZZZZ",
      status: "waiting",
      total_rounds: 10,
      selected_genres: ["g1"],
      started_at: "2026-05-05T12:00:00Z",
      expires_at: "2026-05-05T16:00:00Z",
      manager_token: "abc-token-123",
    });
    renderPage();
    await waitFor(() => screen.getByText("Rock"));
    fireEvent.click(screen.getByLabelText(/rock/i));
    fireEvent.click(screen.getByRole("button", { name: /create game/i }));
    await waitFor(() => expect(screen.getByText("game console")).toBeInTheDocument());
    expect(createGame).toHaveBeenCalledWith({
      total_rounds: 10,
      selected_genres: ["g1"],
    });
    expect(getManagerToken("ZZZZZZ")).toBe("abc-token-123");
  });

  it("shows the error message when createGame fails", async () => {
    vi.mocked(listGenres).mockResolvedValueOnce([{ id: "g1", name: "Rock", slug: "rock" }]);
    vi.mocked(createGame).mockRejectedValueOnce(new Error("boom"));
    renderPage();
    await waitFor(() => screen.getByText("Rock"));
    fireEvent.click(screen.getByLabelText(/rock/i));
    fireEvent.click(screen.getByRole("button", { name: /create game/i }));
    await waitFor(() => expect(screen.getByText(/boom/i)).toBeInTheDocument());
  });

  it("shows an error if listGenres fails", async () => {
    vi.mocked(listGenres).mockRejectedValueOnce(new Error("offline"));
    renderPage();
    await waitFor(() => expect(screen.getByText(/offline/i)).toBeInTheDocument());
  });

  it("Cancel returns to home", async () => {
    vi.mocked(listGenres).mockResolvedValueOnce([]);
    renderPage();
    await waitFor(() => screen.getByRole("link", { name: /cancel/i }));
    fireEvent.click(screen.getByRole("link", { name: /cancel/i }));
    await waitFor(() => expect(screen.getByText("home page")).toBeInTheDocument());
  });
});
