import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  getHealth: vi.fn(() => Promise.resolve({ status: "ok", version: "test", supabase: "ok" })),
}));

import { createGame, getHealth, listGenres } from "../lib/api";
import { ToastProvider } from "../context/ToastContext";
import { getManagerToken } from "../lib/managerToken";
import { ManagerCreateGamePage } from "./ManagerCreateGamePage";

beforeEach(() => {
  window.localStorage.clear();
  vi.mocked(listGenres).mockReset();
  vi.mocked(createGame).mockReset();
  vi.mocked(getHealth).mockClear();
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
      selected_genres: ["g1"],
      selected_decades: [],
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
      selected_genres: ["g1"],
      selected_decades: [],
    });
    expect(getManagerToken("ZZZZZZ")).toBe("abc-token-123");
  });

  it("sends selected decades in the create payload; a decade alone needs a genre", async () => {
    vi.mocked(listGenres).mockResolvedValueOnce([{ id: "g1", name: "Rock", slug: "rock" }]);
    vi.mocked(createGame).mockResolvedValueOnce({
      game_code: "ZZZZZZ",
      status: "waiting",
      selected_genres: ["g1"],
      selected_decades: [1980],
      started_at: "2026-05-05T12:00:00Z",
      expires_at: "2026-05-05T16:00:00Z",
      manager_token: "abc-token-123",
    });
    renderPage();
    await waitFor(() => screen.getByText("Rock"));
    const submit = screen.getByRole("button", { name: /create game/i });

    // Decades are optional: picking one without a genre keeps submit disabled.
    fireEvent.click(screen.getByLabelText(/80s/i));
    expect(submit).toBeDisabled();

    fireEvent.click(screen.getByLabelText(/rock/i));
    expect(submit).toBeEnabled();
    fireEvent.click(submit);

    await waitFor(() => expect(createGame).toHaveBeenCalled());
    expect(createGame).toHaveBeenCalledWith({
      selected_genres: ["g1"],
      selected_decades: [1980],
    });
  });

  // Regression for the decade-pill tap flash fix (Task 3): the toggle logic
  // itself is correct — the flash was purely a CSS sticky-hover artifact — so
  // these lock the on/off/on state machine and the decade↔genre independence
  // that the CSS change must not disturb. The CSS isn't unit-testable in jsdom.
  it("toggles a decade on/off/on cleanly", async () => {
    vi.mocked(listGenres).mockResolvedValueOnce([{ id: "g1", name: "Rock", slug: "rock" }]);
    renderPage();
    await waitFor(() => screen.getByText("Rock"));

    const eighties = screen.getByLabelText(/^80s$/i);
    expect(eighties).not.toBeChecked();
    fireEvent.click(eighties);
    expect(eighties).toBeChecked();
    fireEvent.click(eighties);
    expect(eighties).not.toBeChecked();
    fireEvent.click(eighties);
    expect(eighties).toBeChecked();
  });

  it("keeps decade and genre selection independent", async () => {
    vi.mocked(listGenres).mockResolvedValueOnce([
      { id: "g1", name: "Rock", slug: "rock" },
      { id: "g2", name: "Pop", slug: "pop" },
    ]);
    renderPage();
    await waitFor(() => screen.getByText("Rock"));

    const rock = screen.getByLabelText(/rock/i);
    const eighties = screen.getByLabelText(/^80s$/i);
    fireEvent.click(rock);
    fireEvent.click(eighties);
    expect(rock).toBeChecked();
    expect(eighties).toBeChecked();

    // Toggling the decade off leaves the genre selected, and vice-versa.
    fireEvent.click(eighties);
    expect(eighties).not.toBeChecked();
    expect(rock).toBeChecked();

    fireEvent.click(rock);
    expect(rock).not.toBeChecked();

    // Re-selecting the decade doesn't resurrect the genre — no cross-talk.
    fireEvent.click(eighties);
    expect(eighties).toBeChecked();
    expect(rock).not.toBeChecked();
    expect(screen.getByLabelText(/^pop$/i)).not.toBeChecked();
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

  describe("presets (X-Presets)", () => {
    const CATALOG = [
      { id: "g-rock", name: "Rock", slug: "rock" },
      { id: "g-pop", name: "Pop", slug: "pop" },
      { id: "g-ipop", name: "Israeli Pop", slug: "israeli-pop" },
      { id: "g-st", name: "Soundtracks", slug: "soundtracks" },
    ];

    it("one-tap preset selects its genres and decades and enables submit", async () => {
      vi.mocked(listGenres).mockResolvedValueOnce(CATALOG);
      vi.mocked(createGame).mockResolvedValueOnce({
        game_code: "ZZZZZZ",
        status: "waiting",
        selected_genres: ["g-rock", "g-pop"],
        selected_decades: [1980, 1990],
        started_at: "2026-05-05T12:00:00Z",
        expires_at: "2026-05-05T16:00:00Z",
        manager_token: "abc-token-123",
      });
      renderPage();
      await waitFor(() => screen.getByText("Rock"));

      const submit = screen.getByRole("button", { name: /create game/i });
      expect(submit).toBeDisabled();

      fireEvent.click(screen.getByRole("button", { name: /80s & 90s Party/i }));

      // Rock + Pop on, the others off; 80s + 90s decades on.
      expect(screen.getByLabelText(/rock/i)).toBeChecked();
      expect(screen.getByLabelText(/^pop$/i)).toBeChecked();
      expect(screen.getByLabelText(/israeli pop/i)).not.toBeChecked();
      expect(screen.getByLabelText(/^80s$/i)).toBeChecked();
      expect(screen.getByLabelText(/^90s$/i)).toBeChecked();
      expect(submit).toBeEnabled();

      fireEvent.click(submit);
      await waitFor(() => expect(createGame).toHaveBeenCalled());
      expect(createGame).toHaveBeenCalledWith({
        selected_genres: ["g-rock", "g-pop"],
        selected_decades: [1980, 1990],
      });
    });

    it("the Everything preset selects every loaded genre and no decade", async () => {
      vi.mocked(listGenres).mockResolvedValueOnce(CATALOG);
      renderPage();
      await waitFor(() => screen.getByText("Rock"));

      fireEvent.click(screen.getByRole("button", { name: /^everything$/i }));

      for (const g of CATALOG) expect(screen.getByLabelText(g.name)).toBeChecked();
      expect(screen.getByLabelText(/^80s$/i)).not.toBeChecked();
    });

    it("skips preset slugs absent from the catalog (graceful degradation)", async () => {
      // Movie Night = soundtracks + israeli-soundtracks, but the catalog here has
      // only 'soundtracks', so the preset resolves to just that one genre.
      vi.mocked(listGenres).mockResolvedValueOnce(CATALOG);
      renderPage();
      await waitFor(() => screen.getByText("Rock"));

      fireEvent.click(screen.getByRole("button", { name: /movie night/i }));

      expect(screen.getByLabelText(/soundtracks/i)).toBeChecked();
      expect(screen.getByLabelText(/rock/i)).not.toBeChecked();
      expect(screen.getByRole("button", { name: /create game/i })).toBeEnabled();
    });

    it("marks the applied preset active and clears it when the selection changes", async () => {
      vi.mocked(listGenres).mockResolvedValueOnce(CATALOG);
      renderPage();
      await waitFor(() => screen.getByText("Rock"));

      const everything = screen.getByRole("button", { name: /^everything$/i });
      expect(everything).toHaveAttribute("aria-pressed", "false");

      fireEvent.click(everything);
      expect(everything).toHaveAttribute("aria-pressed", "true");

      // Editing the chips breaks the exact match, so the preset de-highlights.
      fireEvent.click(screen.getByLabelText(/rock/i));
      expect(everything).toHaveAttribute("aria-pressed", "false");
    });
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

  it("pre-warms the backend on mount", async () => {
    vi.mocked(listGenres).mockResolvedValueOnce([]);
    renderPage();
    await waitFor(() => expect(getHealth).toHaveBeenCalledTimes(1));
  });

  it("shows a spinner and swaps to the loading-songs label after a slow pending create", async () => {
    vi.mocked(listGenres).mockResolvedValueOnce([{ id: "g1", name: "Rock", slug: "rock" }]);
    // A create that never settles, so the slow-pending timer can fire.
    vi.mocked(createGame).mockReturnValueOnce(new Promise(() => {}));
    renderPage();
    await waitFor(() => screen.getByText("Rock"));
    fireEvent.click(screen.getByLabelText(/rock/i));

    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole("button", { name: /create game/i }));
      // Phase 1: spinner + "Creating game…".
      expect(screen.getByTestId("submit-spinner")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /creating game/i })).toBeInTheDocument();

      // Phase 2 (>2.5s): the label swaps to "Loading songs…", spinner stays.
      act(() => {
        vi.advanceTimersByTime(2500);
      });
      expect(screen.getByRole("button", { name: /loading songs/i })).toBeInTheDocument();
      expect(screen.getByTestId("submit-spinner")).toBeInTheDocument();
      // No server/infrastructure wording anywhere.
      expect(screen.queryByText(/waking the server/i)).not.toBeInTheDocument();

      // Phase 3 (>30s): a calm, non-error reassurance line appears below the form.
      act(() => {
        vi.advanceTimersByTime(30000);
      });
      expect(screen.getByText(/still loading — hang tight/i)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
