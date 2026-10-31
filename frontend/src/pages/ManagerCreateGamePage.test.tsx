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
  getCachedGenres: vi.fn(() => null),
  createGame: vi.fn(),
  getHealth: vi.fn(() => Promise.resolve({ status: "ok", version: "test", supabase: "ok" })),
  // song_pool_counts() (mig 052). Default: not available, as on a database
  // without the migration; the count tests below give it cells.
  loadSongPool: vi.fn(() => Promise.resolve(null)),
}));

import { createGame, getCachedGenres, getHealth, listGenres, loadSongPool } from "../lib/api";
import { ToastProvider } from "../context/ToastContext";
import { getManagerToken } from "../lib/managerToken";
import { ManagerCreateGamePage } from "./ManagerCreateGamePage";

beforeEach(() => {
  window.localStorage.clear();
  vi.mocked(listGenres).mockReset();
  vi.mocked(createGame).mockReset();
  vi.mocked(getHealth).mockClear();
  vi.mocked(loadSongPool).mockReset();
  vi.mocked(loadSongPool).mockResolvedValue(null);
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
  it("shows the small wordmark above the heading", async () => {
    vi.mocked(listGenres).mockResolvedValueOnce([]);
    renderPage();
    await waitFor(() => screen.getByRole("heading", { level: 1, name: /host a game/i }));
    expect(screen.getByText("Sound Clash")).toBeInTheDocument();
  });

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
    // The navigation now awaits the destination chunk's import (the route
    // transition must not animate to the Suspense fallback). Under vitest that
    // is a real module-graph evaluation, which exceeds waitFor's 1 s default on
    // a loaded worker even though the page prefetches it on mount.
    await waitFor(() => expect(screen.getByText("game console")).toBeInTheDocument(), {
      timeout: 5000,
    });
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
        selected_genres: ["g-ipop", "g-pop"],
        selected_decades: [2010, 2020],
        started_at: "2026-05-05T12:00:00Z",
        expires_at: "2026-05-05T16:00:00Z",
        manager_token: "abc-token-123",
      });
      renderPage();
      await waitFor(() => screen.getByText("Rock"));

      const submit = screen.getByRole("button", { name: /create game/i });
      expect(submit).toBeDisabled();

      // Hot Now = mizrahit + israeli-pop + pop + hip-hop + israeli-rap + israeli-rock-pop,
      // scoped to 2010s + 2020s. Against this 4-genre catalog it resolves to the
      // two present slugs (pop + israeli-pop); the rest are silently skipped.
      fireEvent.click(screen.getByRole("button", { name: /hot now/i }));

      // Pop + Israeli Pop on, Rock + Soundtracks off; 2010s + 2020s decades on.
      expect(screen.getByLabelText(/^pop$/i)).toBeChecked();
      expect(screen.getByLabelText(/israeli pop/i)).toBeChecked();
      expect(screen.getByLabelText(/rock/i)).not.toBeChecked();
      expect(screen.getByLabelText(/^2010s$/i)).toBeChecked();
      expect(screen.getByLabelText(/^2020s$/i)).toBeChecked();
      expect(submit).toBeEnabled();

      fireEvent.click(submit);
      await waitFor(() => expect(createGame).toHaveBeenCalled());
      expect(createGame).toHaveBeenCalledWith({
        selected_genres: ["g-ipop", "g-pop"],
        selected_decades: [2010, 2020],
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

  describe("Any year (the default decade choice)", () => {
    it("starts on Any year with no decade picked, and creates with no decade", async () => {
      vi.mocked(listGenres).mockResolvedValueOnce([{ id: "g1", name: "Rock", slug: "rock" }]);
      vi.mocked(createGame).mockReturnValueOnce(new Promise(() => {}));
      renderPage();
      await waitFor(() => screen.getByText("Rock"));

      expect(screen.getByLabelText(/^any year$/i)).toBeChecked();
      for (const d of ["60s", "70s", "80s", "90s", "2000s", "2010s", "2020s"]) {
        expect(screen.getByLabelText(new RegExp(`^${d}$`))).not.toBeChecked();
      }
      fireEvent.click(screen.getByLabelText(/rock/i));
      fireEvent.click(screen.getByRole("button", { name: /create game/i }));
      await waitFor(() => expect(createGame).toHaveBeenCalled());
      expect(createGame).toHaveBeenCalledWith({ selected_genres: ["g1"], selected_decades: [] });
    });

    it("turns off when a decade is picked, clears the decades when ticked, and comes back with the last decade off", async () => {
      vi.mocked(listGenres).mockResolvedValueOnce([{ id: "g1", name: "Rock", slug: "rock" }]);
      renderPage();
      await waitFor(() => screen.getByText("Rock"));
      const anyYear = screen.getByLabelText(/^any year$/i);
      const eighties = screen.getByLabelText(/^80s$/i);
      const nineties = screen.getByLabelText(/^90s$/i);

      fireEvent.click(eighties);
      fireEvent.click(nineties);
      expect(anyYear).not.toBeChecked();

      // Ticking Any year drops every decade.
      fireEvent.click(anyYear);
      expect(anyYear).toBeChecked();
      expect(eighties).not.toBeChecked();
      expect(nineties).not.toBeChecked();

      // Ticking it again keeps it on: there is always a year choice.
      fireEvent.click(anyYear);
      expect(anyYear).toBeChecked();

      // Turning the only decade off again means any year.
      fireEvent.click(eighties);
      expect(anyYear).not.toBeChecked();
      fireEvent.click(eighties);
      expect(anyYear).toBeChecked();
    });

    it("follows the presets: off for Hot Now's decades, on for Everything", async () => {
      vi.mocked(listGenres).mockResolvedValueOnce([
        { id: "g-pop", name: "Pop", slug: "pop" },
        { id: "g-rock", name: "Rock", slug: "rock" },
      ]);
      renderPage();
      await waitFor(() => screen.getByText("Rock"));
      const anyYear = screen.getByLabelText(/^any year$/i);

      fireEvent.click(screen.getByRole("button", { name: /hot now/i }));
      expect(anyYear).not.toBeChecked();
      fireEvent.click(screen.getByRole("button", { name: /^everything$/i }));
      expect(anyYear).toBeChecked();
    });
  });

  describe("song count for the mix (issue #375)", () => {
    const CATALOG = [
      { id: "g-hh", name: "Hip-Hop", slug: "hip-hop" },
      { id: "g-pop", name: "Pop", slug: "pop" },
      { id: "g-rock", name: "Rock", slug: "rock" },
    ];
    // Rock: 300 songs in the 80s, 2 in the 90s. Pop: 40 in the 90s, 1 with an
    // unknown year. One Rock + Pop duet from the 80s. Hip-Hop: 3 in the 2000s
    // and nothing before.
    const POOL = [
      { decade: 1980, genre_ids: ["g-rock"], song_count: 300 },
      { decade: 1990, genre_ids: ["g-rock"], song_count: 2 },
      { decade: 1990, genre_ids: ["g-pop"], song_count: 40 },
      { decade: null, genre_ids: ["g-pop"], song_count: 1 },
      { decade: 1980, genre_ids: ["g-pop", "g-rock"], song_count: 1 },
      { decade: 2000, genre_ids: ["g-hh"], song_count: 3 },
    ];

    async function renderWithPool() {
      vi.mocked(listGenres).mockResolvedValueOnce(CATALOG);
      vi.mocked(loadSongPool).mockResolvedValue(POOL);
      renderPage();
      await waitFor(() => screen.getByText("Rock"));
      return screen.getByTestId("mix-count");
    }

    it("says nothing until a genre is picked", async () => {
      const line = await renderWithPool();
      await waitFor(() => expect(loadSongPool).toHaveBeenCalled());
      expect(line).toHaveTextContent("");
      expect(line).toHaveAttribute("role", "status");
    });

    it("counts the mix live as genres and decades change", async () => {
      const line = await renderWithPool();

      fireEvent.click(screen.getByLabelText(/^rock$/i));
      await waitFor(() => expect(line).toHaveTextContent("303 songs in this mix"));

      // A song in two picked genres counts once; the unknown-year song counts
      // only while no decade is picked.
      fireEvent.click(screen.getByLabelText(/^pop$/i));
      expect(line).toHaveTextContent("344 songs in this mix");

      fireEvent.click(screen.getByLabelText(/^90s$/i));
      expect(line).toHaveTextContent("42 songs in this mix");

      fireEvent.click(screen.getByLabelText(/^80s$/i));
      expect(line).toHaveTextContent("343 songs in this mix");

      fireEvent.click(screen.getByLabelText(/^any year$/i));
      expect(line).toHaveTextContent("344 songs in this mix");
      expect(screen.getByRole("button", { name: /create game/i })).toBeEnabled();
    });

    it("blocks Create on an empty mix and says why, until the mix has songs", async () => {
      const line = await renderWithPool();

      fireEvent.click(screen.getByLabelText(/^hip-hop$/i));
      fireEvent.click(screen.getByLabelText(/^80s$/i));
      await waitFor(() => expect(line).toHaveTextContent(/no songs in this mix/i));
      const submit = screen.getByRole("button", { name: /create game/i });
      expect(submit).toBeDisabled();
      fireEvent.click(submit);
      expect(createGame).not.toHaveBeenCalled();

      // Adding a genre with 80s songs fixes it.
      fireEvent.click(screen.getByLabelText(/^rock$/i));
      expect(line).toHaveTextContent("301 songs in this mix");
      expect(submit).toBeEnabled();
    });

    it("warns when a mix is too small for a whole game", async () => {
      const line = await renderWithPool();
      fireEvent.click(screen.getByLabelText(/^hip-hop$/i));
      await waitFor(() =>
        expect(line).toHaveTextContent("Only 3 songs in this mix, enough for 3 rounds."),
      );
      expect(screen.getByRole("button", { name: /create game/i })).toBeEnabled();
    });

    it("shows no count and blocks nothing when the counts can't load", async () => {
      vi.mocked(listGenres).mockResolvedValueOnce(CATALOG);
      renderPage();
      await waitFor(() => screen.getByText("Rock"));
      await waitFor(() => expect(loadSongPool).toHaveBeenCalled());
      fireEvent.click(screen.getByLabelText(/^hip-hop$/i));
      fireEvent.click(screen.getByLabelText(/^80s$/i));
      expect(screen.getByTestId("mix-count")).toHaveTextContent("");
      expect(screen.getByRole("button", { name: /create game/i })).toBeEnabled();
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

// Home fetches the genre list on landing, so arriving from it the create page
// can draw the real tiles on its first frame: screen changes are instant, and
// a frame of placeholder tiles read as a flicker (10-touch-and-route-motion.md).
describe("ManagerCreateGamePage genres from Home's fetch", () => {
  it("renders cached genres on the first frame, with no placeholder tiles", () => {
    const rock = { id: "g1", name: "Rock", slug: "rock" };
    vi.mocked(getCachedGenres).mockReturnValueOnce([rock]);
    vi.mocked(listGenres).mockResolvedValueOnce([rock]);
    render(
      <MemoryRouter>
        <ToastProvider>
          <ManagerCreateGamePage />
        </ToastProvider>
      </MemoryRouter>,
    );
    expect(screen.getByLabelText(/^rock$/i)).toBeInTheDocument();
  });
});
