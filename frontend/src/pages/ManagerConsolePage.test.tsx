import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forwardRef, useImperativeHandle } from "react";

vi.mock("../lib/supabase", async () => {
  const mod = await import("../test/supabaseMock");
  return { supabase: mod.supabaseMock };
});

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
  selectSong: vi.fn(),
  awardPoints: vi.fn(),
  awardBonus: vi.fn(),
  endGame: vi.fn(),
  kickTeam: vi.fn(),
}));

interface MockHandle {
  loadVideoById: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  play: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
}

let onReadyHandler: (() => void) | null = null;

vi.mock("../components/YouTubePlayer", () => ({
  YouTubePlayer: forwardRef<MockHandle, { onReady?: () => void }>((props, ref) => {
    onReadyHandler = props.onReady ?? null;
    useImperativeHandle(ref, () => ({
      loadVideoById: vi.fn(),
      pause: vi.fn(),
      play: vi.fn(),
      stop: vi.fn(),
    }));
    return <div data-testid="yt-player" />;
  }),
}));

import { awardBonus, awardPoints, endGame, kickTeam, selectSong } from "../lib/api";
import { ToastProvider } from "../context/ToastContext";
import { setManagerToken, getManagerToken } from "../lib/managerToken";
import {
  fireSubscribed,
  makeActiveGame,
  makeRound,
  makeTeam,
  resetSupabaseMock,
  setHydrate,
} from "../test/supabaseMock";
import { ManagerConsolePage } from "./ManagerConsolePage";

const TOKEN = "tok-host-1";

beforeEach(() => {
  resetSupabaseMock();
  window.localStorage.clear();
  setManagerToken("ABCDEF", TOKEN);
  onReadyHandler = null;
  vi.mocked(selectSong).mockReset();
  vi.mocked(awardPoints).mockReset();
  vi.mocked(awardBonus).mockReset();
  vi.mocked(endGame).mockReset();
  vi.mocked(kickTeam).mockReset();
});

afterEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
});

function renderConsole() {
  return render(
    <MemoryRouter initialEntries={["/manager/game/ABCDEF"]}>
      <ToastProvider>
        <Routes>
          <Route path="/" element={<div>home page</div>} />
          <Route path="/manager/game/:gameCode" element={<ManagerConsolePage />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe("ManagerConsolePage", () => {
  it("shows the not-host branch when no manager token is stored", () => {
    window.localStorage.clear();
    renderConsole();
    expect(screen.getByText(/you're not the host of this game/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /back to home/i })).toBeInTheDocument();
  });

  it("renders connecting state while subscribing", () => {
    renderConsole();
    expect(screen.getByText(/connecting to game/i)).toBeInTheDocument();
  });

  it("renders the game code, status pill and round counter", async () => {
    setHydrate({
      game: makeActiveGame({ status: "waiting", round_number: 0, total_rounds: 5 }),
      teams: [],
      rounds: [],
    });
    renderConsole();
    await act(async () => {
      await fireSubscribed();
    });
    expect(screen.getAllByText("ABCDEF").length).toBeGreaterThan(0);
    expect(screen.getByText(/round 0 of 5/i)).toBeInTheDocument();
  });

  it("disables Start until player is ready", async () => {
    setHydrate({
      game: makeActiveGame({ status: "waiting" }),
      teams: [],
      rounds: [],
    });
    renderConsole();
    await act(async () => {
      await fireSubscribed();
    });
    const startBtn = screen.getByRole("button", { name: /start game/i });
    expect(startBtn).toBeDisabled();
    act(() => {
      onReadyHandler?.();
    });
    await waitFor(() => expect(startBtn).toBeEnabled());
  });

  it("calls selectSong with the manager token when Start is pressed", async () => {
    setHydrate({
      game: makeActiveGame({ status: "waiting" }),
      teams: [],
      rounds: [],
    });
    vi.mocked(selectSong).mockResolvedValueOnce({
      round_id: "r1",
      round_number: 1,
      song: {
        id: "s1",
        title: "Bohemian Rhapsody",
        artist: "Queen",
        youtube_id: "abcdefghijk",
        start_time: 0,
        is_soundtrack: false,
        source: null,
      },
    });
    renderConsole();
    await act(async () => {
      await fireSubscribed();
    });
    act(() => {
      onReadyHandler?.();
    });
    await waitFor(() => expect(screen.getByRole("button", { name: /start game/i })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /start game/i }));
    await waitFor(() => expect(selectSong).toHaveBeenCalledWith("ABCDEF", TOKEN));
    await waitFor(() => expect(screen.getByText("Bohemian Rhapsody")).toBeInTheDocument());
  });

  it("score buttons enable only when a team is buzzed", async () => {
    setHydrate({
      game: makeActiveGame({
        status: "playing",
        buzzed_team_id: "t1",
        current_round_id: "r1",
      }),
      teams: [makeTeam({ id: "t1", name: "Alice" })],
      rounds: [makeRound({ id: "r1" })],
    });
    renderConsole();
    await act(async () => {
      await fireSubscribed();
    });
    const banner = screen.getByText(/buzzed in/i).closest('[role="status"]');
    expect(banner?.textContent).toMatch(/alice/i);
    expect(banner?.textContent).toMatch(/buzzed in/i);
    expect(screen.getByTestId("score-title")).toBeEnabled();
    expect(screen.getByTestId("score-artist")).toBeEnabled();
    expect(screen.getByTestId("score-wrong")).toBeEnabled();
    expect(screen.getByTestId("end-round")).toBeEnabled();
  });

  it("calls awardPoints with the manager token + toggled buttons", async () => {
    setHydrate({
      game: makeActiveGame({
        status: "playing",
        buzzed_team_id: "t1",
        current_round_id: "r1",
      }),
      teams: [makeTeam({ id: "t1" })],
      rounds: [makeRound({ id: "r1" })],
    });
    vi.mocked(awardPoints).mockResolvedValueOnce({
      round_id: "r1",
      team_id: "t1",
      points_awarded: 10,
      team_total_score: 10,
    });
    renderConsole();
    await act(async () => {
      await fireSubscribed();
    });
    fireEvent.click(screen.getByTestId("score-title"));
    fireEvent.click(screen.getByTestId("end-round"));
    await waitFor(() =>
      expect(awardPoints).toHaveBeenCalledWith("ABCDEF", TOKEN, {
        round_id: "r1",
        title_correct: true,
        artist_correct: false,
        wrong_buzz: false,
        timeout: false,
      }),
    );
  });

  it("Wrong button sends wrong_buzz=true and clears positives", async () => {
    setHydrate({
      game: makeActiveGame({
        status: "playing",
        buzzed_team_id: "t1",
        current_round_id: "r1",
      }),
      teams: [makeTeam({ id: "t1" })],
      rounds: [makeRound({ id: "r1" })],
    });
    vi.mocked(awardPoints).mockResolvedValueOnce({
      round_id: "r1",
      team_id: "t1",
      points_awarded: -3,
      team_total_score: 0,
    });
    renderConsole();
    await act(async () => {
      await fireSubscribed();
    });
    // Toggle title first, then Wrong should clear it.
    fireEvent.click(screen.getByTestId("score-title"));
    fireEvent.click(screen.getByTestId("score-wrong"));
    fireEvent.click(screen.getByTestId("end-round"));
    await waitFor(() =>
      expect(awardPoints).toHaveBeenCalledWith("ABCDEF", TOKEN, {
        round_id: "r1",
        title_correct: false,
        artist_correct: false,
        wrong_buzz: true,
        timeout: false,
      }),
    );
  });

  it("End round with no buzz sends timeout=true", async () => {
    setHydrate({
      game: makeActiveGame({
        status: "playing",
        buzzed_team_id: null,
        current_round_id: "r1",
      }),
      teams: [],
      rounds: [makeRound({ id: "r1" })],
    });
    vi.mocked(awardPoints).mockResolvedValueOnce({
      round_id: "r1",
      team_id: null,
      points_awarded: 0,
      team_total_score: 0,
    });
    renderConsole();
    await act(async () => {
      await fireSubscribed();
    });
    const ends = screen.getAllByTestId(/^end-round/);
    fireEvent.click(ends[0]!);
    await waitFor(() =>
      expect(awardPoints).toHaveBeenCalledWith("ABCDEF", TOKEN, {
        round_id: "r1",
        title_correct: false,
        artist_correct: false,
        wrong_buzz: false,
        timeout: true,
      }),
    );
  });

  it("Bonus opens a team picker and posts to awardBonus", async () => {
    setHydrate({
      game: makeActiveGame({ status: "playing" }),
      teams: [makeTeam({ id: "t1", name: "Alice" }), makeTeam({ id: "t2", name: "Bob" })],
      rounds: [],
    });
    vi.mocked(awardBonus).mockResolvedValueOnce({
      team_id: "t2",
      points_awarded: 4,
      team_total_score: 4,
    });
    renderConsole();
    await act(async () => {
      await fireSubscribed();
    });
    fireEvent.click(screen.getByTestId("score-bonus"));
    await waitFor(() => screen.getByTestId("bonus-team-t2"));
    fireEvent.click(screen.getByTestId("bonus-team-t2"));
    await waitFor(() =>
      expect(awardBonus).toHaveBeenCalledWith("ABCDEF", TOKEN, { team_id: "t2" }),
    );
  });

  it("kick opens a confirm dialog and calls api.kickTeam after confirm", async () => {
    setHydrate({
      game: makeActiveGame({ status: "playing" }),
      teams: [makeTeam({ id: "t1", name: "Alice" })],
      rounds: [],
    });
    vi.mocked(kickTeam).mockResolvedValueOnce(undefined);
    renderConsole();
    await act(async () => {
      await fireSubscribed();
    });
    fireEvent.click(screen.getByRole("button", { name: /^kick$/i }));
    await waitFor(() => screen.getByRole("dialog"));
    expect(kickTeam).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /remove team/i }));
    await waitFor(() => expect(kickTeam).toHaveBeenCalledWith("ABCDEF", TOKEN, "t1"));
  });

  it("kick can be cancelled from the confirm dialog", async () => {
    setHydrate({
      game: makeActiveGame({ status: "playing" }),
      teams: [makeTeam({ id: "t1", name: "Alice" })],
      rounds: [],
    });
    renderConsole();
    await act(async () => {
      await fireSubscribed();
    });
    fireEvent.click(screen.getByRole("button", { name: /^kick$/i }));
    await waitFor(() => screen.getByRole("dialog"));
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(kickTeam).not.toHaveBeenCalled();
  });

  it("end game confirms, calls endGame, and clears the manager token", async () => {
    setHydrate({
      game: makeActiveGame({ status: "playing" }),
      teams: [],
      rounds: [],
    });
    vi.mocked(endGame).mockResolvedValueOnce({
      game_code: "ABCDEF",
      status: "ended",
      ended_at: "2026-05-05T13:00:00Z",
    });
    renderConsole();
    await act(async () => {
      await fireSubscribed();
    });
    fireEvent.click(screen.getByRole("button", { name: /^end game$/i }));
    const endDialog = await waitFor(() => screen.getByRole("dialog"));
    expect(endGame).not.toHaveBeenCalled();
    fireEvent.click(within(endDialog).getByRole("button", { name: /^end game$/i }));
    await waitFor(() => expect(endGame).toHaveBeenCalledWith("ABCDEF", TOKEN));
    await waitFor(() => expect(getManagerToken("ABCDEF")).toBeNull());
  });

  it("Home button navigates back to the landing page", async () => {
    setHydrate({
      game: makeActiveGame({ status: "playing" }),
      teams: [],
      rounds: [],
    });
    renderConsole();
    await act(async () => {
      await fireSubscribed();
    });
    fireEvent.click(screen.getByRole("button", { name: /^home$/i }));
    await waitFor(() => expect(screen.getByText("home page")).toBeInTheDocument());
  });

  it("renders the EndScreen with the FINAL RESULTS heading when the game is ended", async () => {
    setHydrate({
      game: makeActiveGame({ status: "ended" }),
      teams: [makeTeam({ id: "t1", name: "Alice", score: 30 })],
      rounds: [],
    });
    renderConsole();
    await act(async () => {
      await fireSubscribed();
    });
    expect(screen.getByText(/final results/i)).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    // Round controls should be gone — the End screen short-circuits the rest of the layout.
    expect(screen.queryByTestId("end-round")).not.toBeInTheDocument();
  });

  it("auto-ends the game after the final round is awarded", async () => {
    setHydrate({
      game: makeActiveGame({
        status: "playing",
        buzzed_team_id: "t1",
        current_round_id: "r1",
        round_number: 5,
        total_rounds: 5,
      }),
      teams: [makeTeam({ id: "t1" })],
      rounds: [makeRound({ id: "r1" })],
    });
    vi.mocked(awardPoints).mockResolvedValueOnce({
      round_id: "r1",
      team_id: "t1",
      points_awarded: 10,
      team_total_score: 10,
    });
    vi.mocked(endGame).mockResolvedValueOnce({
      game_code: "ABCDEF",
      status: "ended",
      ended_at: "2026-05-05T13:00:00Z",
    });
    renderConsole();
    await act(async () => {
      await fireSubscribed();
    });
    fireEvent.click(screen.getByTestId("end-round"));
    await waitFor(() => expect(endGame).toHaveBeenCalledWith("ABCDEF", TOKEN));
    await waitFor(() => expect(getManagerToken("ABCDEF")).toBeNull());
  });

  it("does not auto-end before the final round", async () => {
    setHydrate({
      game: makeActiveGame({
        status: "playing",
        buzzed_team_id: "t1",
        current_round_id: "r1",
        round_number: 2,
        total_rounds: 5,
      }),
      teams: [makeTeam({ id: "t1" })],
      rounds: [makeRound({ id: "r1" })],
    });
    vi.mocked(awardPoints).mockResolvedValueOnce({
      round_id: "r1",
      team_id: "t1",
      points_awarded: 10,
      team_total_score: 10,
    });
    renderConsole();
    await act(async () => {
      await fireSubscribed();
    });
    fireEvent.click(screen.getByTestId("end-round"));
    await waitFor(() => expect(awardPoints).toHaveBeenCalled());
    expect(endGame).not.toHaveBeenCalled();
  });

  it("Restart song re-selects the current song via selectSong with a song_id", async () => {
    setHydrate({
      game: makeActiveGame({ status: "playing", round_number: 1, current_round_id: "r1" }),
      teams: [],
      rounds: [makeRound({ id: "r1", song_id: "song-A" })],
    });
    vi.mocked(selectSong).mockResolvedValueOnce({
      round_id: "r2",
      round_number: 2,
      song: {
        id: "song-A",
        title: "Bohemian Rhapsody",
        artist: "Queen",
        youtube_id: "abcdefghijk",
        start_time: 0,
        is_soundtrack: false,
        source: null,
      },
    });
    renderConsole();
    await act(async () => {
      await fireSubscribed();
    });
    act(() => {
      onReadyHandler?.();
    });
    // Restart needs `currentSong` (local React state populated by a successful
    // selectSong). Trigger one Next-round click to seed it, then Restart.
    const next = screen.getAllByRole("button", { name: /^next round$/i })[0]!;
    await waitFor(() => expect(next).toBeEnabled());
    fireEvent.click(next);
    await waitFor(() => expect(screen.getByText("Bohemian Rhapsody")).toBeInTheDocument());

    // Set up the next response for the Restart click — same song.
    vi.mocked(selectSong).mockResolvedValueOnce({
      round_id: "r3",
      round_number: 3,
      song: {
        id: "song-A",
        title: "Bohemian Rhapsody",
        artist: "Queen",
        youtube_id: "abcdefghijk",
        start_time: 0,
        is_soundtrack: false,
        source: null,
      },
    });
    const restart = screen.getAllByRole("button", { name: /^restart song$/i })[0]!;
    await waitFor(() => expect(restart).toBeEnabled());
    fireEvent.click(restart);
    await waitFor(() => expect(selectSong).toHaveBeenLastCalledWith("ABCDEF", TOKEN, "song-A"));
  });

  it("shows a clear toast when the song pool is exhausted", async () => {
    setHydrate({
      game: makeActiveGame({ status: "playing", round_number: 1, total_rounds: 5 }),
      teams: [],
      rounds: [],
    });
    const { ApiError } = await import("../lib/api");
    const exhausted = new ApiError("conflict", "no songs left", 409);
    Object.assign(exhausted, { details: { reason: "no_more_songs" } });
    vi.mocked(selectSong).mockRejectedValueOnce(exhausted);
    renderConsole();
    await act(async () => {
      await fireSubscribed();
    });
    act(() => {
      onReadyHandler?.();
    });
    const next = screen.getAllByRole("button", { name: /^next round$/i })[0]!;
    await waitFor(() => expect(next).toBeEnabled());
    fireEvent.click(next);
    await waitFor(() =>
      expect(
        screen.getByText(/all songs in your selected genres have been played/i),
      ).toBeInTheDocument(),
    );
  });
});
