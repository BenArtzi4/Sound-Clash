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
  awardBonus: vi.fn(),
  endRound: vi.fn(),
  endGame: vi.fn(),
}));

vi.mock("../hooks/useManagerActions", () => ({
  RpcError: class RpcError extends Error {
    sqlstate: string | undefined;
    constructor(message: string, sqlstate?: string) {
      super(message);
      this.sqlstate = sqlstate;
    }
  },
  awardAttemptDirect: vi.fn(),
  releaseBuzzLockDirect: vi.fn(),
}));

interface MockHandle {
  loadVideoById: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  play: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
}

let onReadyHandler: (() => void) | null = null;
let lastHandle: MockHandle | null = null;

vi.mock("../components/YouTubePlayer", () => ({
  YouTubePlayer: forwardRef<MockHandle, { onReady?: () => void }>((props, ref) => {
    onReadyHandler = props.onReady ?? null;
    useImperativeHandle(ref, () => {
      if (!lastHandle) {
        lastHandle = {
          loadVideoById: vi.fn(),
          pause: vi.fn(),
          play: vi.fn(),
          stop: vi.fn(),
        };
      }
      return lastHandle;
    }, []);
    return <div data-testid="yt-player" />;
  }),
}));

import { awardBonus, endGame, endRound, selectSong } from "../lib/api";
import { awardAttemptDirect, releaseBuzzLockDirect } from "../hooks/useManagerActions";
import { ToastProvider } from "../context/ToastContext";
import { setManagerToken, getManagerToken } from "../lib/managerToken";
import {
  fireSubscribed,
  makeActiveGame,
  makeRound,
  makeTeam,
  resetSupabaseMock,
  setHydrate,
  setSongFetch,
} from "../test/supabaseMock";
import { ManagerConsolePage } from "./ManagerConsolePage";

const TOKEN = "tok-host-1";

beforeEach(() => {
  resetSupabaseMock();
  window.localStorage.clear();
  setManagerToken("ABCDEF", TOKEN);
  onReadyHandler = null;
  lastHandle = null;
  vi.mocked(selectSong).mockReset();
  vi.mocked(awardAttemptDirect).mockReset();
  vi.mocked(releaseBuzzLockDirect).mockReset();
  vi.mocked(endRound).mockReset();
  vi.mocked(awardBonus).mockReset();
  vi.mocked(endGame).mockReset();
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
      game: makeActiveGame({ status: "waiting", round_number: 0 }),
      teams: [],
      rounds: [],
    });
    renderConsole();
    await act(async () => {
      await fireSubscribed();
    });
    expect(screen.getAllByText("ABCDEF").length).toBeGreaterThan(0);
    expect(screen.getByText(/round 0$/i)).toBeInTheDocument();
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
        is_soundtrack: true,
        source: "Wayne's World",
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
    // The source string (e.g. soundtrack origin) renders alongside the artist name.
    expect(screen.getByText(/queen.*wayne's world/i)).toBeInTheDocument();
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
    expect(screen.getByTestId("score-title")).toBeEnabled();
    expect(screen.getByTestId("score-artist")).toBeEnabled();
    expect(screen.getByTestId("score-wrong")).toBeEnabled();
  });

  it("Correct Song fires awardAttemptDirect with title_correct=true and toasts +10 immediately", async () => {
    setHydrate({
      game: makeActiveGame({
        status: "playing",
        buzzed_team_id: "t1",
        current_round_id: "r1",
      }),
      teams: [makeTeam({ id: "t1", name: "Alice" })],
      rounds: [makeRound({ id: "r1" })],
    });
    vi.mocked(awardAttemptDirect).mockResolvedValueOnce({
      round_id: "r1",
      team_id: "t1",
      points_awarded: 10,
      team_total_score: 10,
      title_claimed_by: "t1",
      artist_claimed_by: null,
    });
    renderConsole();
    await act(async () => {
      await fireSubscribed();
    });
    fireEvent.click(screen.getByTestId("score-title"));
    // Optimistic toast appears before the RPC settles.
    expect(screen.getByText(/\+10 to Alice/i)).toBeInTheDocument();
    await waitFor(() =>
      expect(awardAttemptDirect).toHaveBeenCalledWith("ABCDEF", TOKEN, "r1", {
        title_correct: true,
        artist_correct: false,
        wrong_buzz: false,
      }),
    );
  });

  it("Correct Artist fires awardAttemptDirect with artist_correct=true and toasts +5 immediately", async () => {
    setHydrate({
      game: makeActiveGame({
        status: "playing",
        buzzed_team_id: "t1",
        current_round_id: "r1",
      }),
      teams: [makeTeam({ id: "t1", name: "Alice" })],
      rounds: [makeRound({ id: "r1" })],
    });
    vi.mocked(awardAttemptDirect).mockResolvedValueOnce({
      round_id: "r1",
      team_id: "t1",
      points_awarded: 5,
      team_total_score: 5,
      title_claimed_by: null,
      artist_claimed_by: "t1",
    });
    renderConsole();
    await act(async () => {
      await fireSubscribed();
    });
    fireEvent.click(screen.getByTestId("score-artist"));
    expect(screen.getByText(/\+5 to Alice/i)).toBeInTheDocument();
    await waitFor(() =>
      expect(awardAttemptDirect).toHaveBeenCalledWith("ABCDEF", TOKEN, "r1", {
        title_correct: false,
        artist_correct: true,
        wrong_buzz: false,
      }),
    );
  });

  it("Continue button calls releaseBuzzLockDirect and resumes the player", async () => {
    setHydrate({
      game: makeActiveGame({
        status: "playing",
        buzzed_team_id: "t1",
        current_round_id: "r1",
      }),
      teams: [makeTeam({ id: "t1" })],
      rounds: [makeRound({ id: "r1" })],
    });
    vi.mocked(releaseBuzzLockDirect).mockResolvedValueOnce(undefined);
    renderConsole();
    await act(async () => {
      await fireSubscribed();
    });
    const continueBtn = screen.getByTestId("continue-round");
    await waitFor(() => expect(continueBtn).toBeEnabled());
    fireEvent.click(continueBtn);
    await waitFor(() => expect(releaseBuzzLockDirect).toHaveBeenCalledWith("ABCDEF", TOKEN));
    await waitFor(() => expect(lastHandle?.play).toHaveBeenCalled());
  });

  it("Continue surfaces an error toast when releaseBuzzLockDirect fails", async () => {
    setHydrate({
      game: makeActiveGame({
        status: "playing",
        buzzed_team_id: "t1",
        current_round_id: "r1",
      }),
      teams: [makeTeam({ id: "t1" })],
      rounds: [makeRound({ id: "r1" })],
    });
    vi.mocked(releaseBuzzLockDirect).mockRejectedValueOnce(new Error("network down"));
    renderConsole();
    await act(async () => {
      await fireSubscribed();
    });
    const continueBtn = screen.getByTestId("continue-round");
    await waitFor(() => expect(continueBtn).toBeEnabled());
    fireEvent.click(continueBtn);
    await waitFor(() => expect(screen.getByText(/network down/i)).toBeInTheDocument());
    expect(lastHandle?.play).not.toHaveBeenCalled();
  });

  it("Correct Song surfaces an error toast when awardAttemptDirect fails", async () => {
    setHydrate({
      game: makeActiveGame({
        status: "playing",
        buzzed_team_id: "t1",
        current_round_id: "r1",
      }),
      teams: [makeTeam({ id: "t1" })],
      rounds: [makeRound({ id: "r1" })],
    });
    vi.mocked(awardAttemptDirect).mockRejectedValueOnce(new Error("rpc exploded"));
    renderConsole();
    await act(async () => {
      await fireSubscribed();
    });
    fireEvent.click(screen.getByTestId("score-title"));
    await waitFor(() => expect(screen.getByText(/rpc exploded/i)).toBeInTheDocument());
  });

  it("Wrong button fires awardAttemptDirect with wrong_buzz=true and resumes the player", async () => {
    setHydrate({
      game: makeActiveGame({
        status: "playing",
        buzzed_team_id: "t1",
        current_round_id: "r1",
      }),
      teams: [makeTeam({ id: "t1", name: "Alice" })],
      rounds: [makeRound({ id: "r1" })],
    });
    vi.mocked(awardAttemptDirect).mockResolvedValueOnce({
      round_id: "r1",
      team_id: "t1",
      points_awarded: -3,
      team_total_score: 0,
      title_claimed_by: null,
      artist_claimed_by: null,
    });
    renderConsole();
    await act(async () => {
      await fireSubscribed();
    });
    fireEvent.click(screen.getByTestId("score-wrong"));
    expect(screen.getByText(/-3 to Alice/i)).toBeInTheDocument();
    await waitFor(() =>
      expect(awardAttemptDirect).toHaveBeenCalledWith("ABCDEF", TOKEN, "r1", {
        title_correct: false,
        artist_correct: false,
        wrong_buzz: true,
      }),
    );
    // Wrong re-arms the buzzers AND resumes the song after the RPC commits.
    await waitFor(() => expect(lastHandle?.play).toHaveBeenCalled());
  });

  it("Wrong does not resume the player when awardAttemptDirect fails", async () => {
    setHydrate({
      game: makeActiveGame({
        status: "playing",
        buzzed_team_id: "t1",
        current_round_id: "r1",
      }),
      teams: [makeTeam({ id: "t1" })],
      rounds: [makeRound({ id: "r1" })],
    });
    vi.mocked(awardAttemptDirect).mockRejectedValueOnce(new Error("rpc down"));
    renderConsole();
    await act(async () => {
      await fireSubscribed();
    });
    fireEvent.click(screen.getByTestId("score-wrong"));
    await waitFor(() => expect(screen.getByText(/rpc down/i)).toBeInTheDocument());
    expect(lastHandle?.play).not.toHaveBeenCalled();
  });

  it("Next round with a held buzz ends the round and selects a new song (no auto-score)", async () => {
    setHydrate({
      game: makeActiveGame({
        status: "playing",
        buzzed_team_id: "t1",
        current_round_id: "r1",
      }),
      teams: [makeTeam({ id: "t1" })],
      rounds: [makeRound({ id: "r1" })],
    });
    vi.mocked(endRound).mockResolvedValueOnce({
      round_id: "r1",
      ended_at: "2026-05-10T12:00:00Z",
    });
    vi.mocked(selectSong).mockResolvedValueOnce({
      round_id: "r2",
      round_number: 2,
      song: {
        id: "s2",
        title: "Next",
        artist: "Up",
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
    fireEvent.click(screen.getByTestId("start-round"));
    await waitFor(() => expect(endRound).toHaveBeenCalledWith("ABCDEF", TOKEN, "r1"));
    await waitFor(() => expect(selectSong).toHaveBeenCalledWith("ABCDEF", TOKEN));
    // Score buttons no longer pre-fire award_attempt on Next; that responsibility
    // belongs to the per-button click. Manager must explicitly score before
    // advancing or accept the no-points outcome.
    expect(awardAttemptDirect).not.toHaveBeenCalled();
  });

  it("Next round with no buzz skips the attempt call (timeout/skip)", async () => {
    setHydrate({
      game: makeActiveGame({
        status: "playing",
        buzzed_team_id: null,
        current_round_id: "r1",
      }),
      teams: [makeTeam({ id: "t1" })],
      rounds: [makeRound({ id: "r1" })],
    });
    vi.mocked(endRound).mockResolvedValueOnce({
      round_id: "r1",
      ended_at: "2026-05-10T12:00:00Z",
    });
    vi.mocked(selectSong).mockResolvedValueOnce({
      round_id: "r2",
      round_number: 2,
      song: {
        id: "s2",
        title: "Next",
        artist: "Up",
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
    fireEvent.click(screen.getByTestId("start-round"));
    await waitFor(() => expect(endRound).toHaveBeenCalledWith("ABCDEF", TOKEN, "r1"));
    await waitFor(() => expect(selectSong).toHaveBeenCalledWith("ABCDEF", TOKEN));
    expect(awardAttemptDirect).not.toHaveBeenCalled();
  });

  it("Continue round is disabled until a team buzzes in", async () => {
    setHydrate({
      game: makeActiveGame({
        status: "playing",
        buzzed_team_id: null,
        current_round_id: "r1",
      }),
      teams: [makeTeam({ id: "t1" })],
      rounds: [makeRound({ id: "r1" })],
    });
    renderConsole();
    await act(async () => {
      await fireSubscribed();
    });
    expect(screen.getByTestId("continue-round")).toBeDisabled();
  });

  it("title toggle is disabled when title token is already claimed", async () => {
    setHydrate({
      game: makeActiveGame({
        status: "playing",
        buzzed_team_id: "t2",
        current_round_id: "r1",
      }),
      teams: [makeTeam({ id: "t1", name: "Alpha" }), makeTeam({ id: "t2", name: "Bravo" })],
      rounds: [makeRound({ id: "r1", title_claimed_by: "t1" })],
    });
    renderConsole();
    await act(async () => {
      await fireSubscribed();
    });
    expect(screen.getByTestId("score-title")).toBeDisabled();
    expect(screen.getByTestId("score-artist")).toBeEnabled();
    expect(screen.getByTestId("score-wrong")).toBeEnabled();
  });

  it("artist chip flips to the claimed state when artist_claimed_by is set", async () => {
    setHydrate({
      game: makeActiveGame({
        status: "playing",
        buzzed_team_id: "t2",
        current_round_id: "r1",
      }),
      teams: [makeTeam({ id: "t1", name: "Alpha" }), makeTeam({ id: "t2", name: "Bravo" })],
      rounds: [makeRound({ id: "r1", artist_claimed_by: "t1" })],
    });
    renderConsole();
    await act(async () => {
      await fireSubscribed();
    });
    expect(screen.getByTestId("token-chip-artist")).toHaveTextContent(/artist\s+✓/i);
    expect(screen.getByTestId("score-artist")).toBeDisabled();
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

  it("Bonus picker can be toggled closed without picking a team", async () => {
    setHydrate({
      game: makeActiveGame({ status: "playing" }),
      teams: [makeTeam({ id: "t1", name: "Alice" })],
      rounds: [],
    });
    renderConsole();
    await act(async () => {
      await fireSubscribed();
    });
    fireEvent.click(screen.getByTestId("score-bonus"));
    await waitFor(() => screen.getByTestId("bonus-team-t1"));
    fireEvent.click(screen.getByTestId("score-bonus"));
    await waitFor(() => expect(screen.queryByTestId("bonus-team-t1")).not.toBeInTheDocument());
    expect(awardBonus).not.toHaveBeenCalled();
  });

  it("Bonus surfaces an error toast when the API call fails", async () => {
    setHydrate({
      game: makeActiveGame({ status: "playing" }),
      teams: [makeTeam({ id: "t1", name: "Alice" })],
      rounds: [],
    });
    vi.mocked(awardBonus).mockRejectedValueOnce(new Error("boom"));
    renderConsole();
    await act(async () => {
      await fireSubscribed();
    });
    fireEvent.click(screen.getByTestId("score-bonus"));
    await waitFor(() => screen.getByTestId("bonus-team-t1"));
    fireEvent.click(screen.getByTestId("bonus-team-t1"));
    await waitFor(() => expect(screen.getByText(/boom/i)).toBeInTheDocument());
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
    expect(screen.queryByTestId("continue-round")).not.toBeInTheDocument();
  });

  it("rehydrates the current song after a manager refresh mid-round", async () => {
    setHydrate({
      game: makeActiveGame({
        status: "playing",
        round_number: 2,
        current_round_id: "r-live",
      }),
      teams: [makeTeam({ id: "t1" })],
      rounds: [makeRound({ id: "r-live", round_number: 2, song_id: "song-X" })],
    });
    setSongFetch({
      id: "song-X",
      title: "Sweet Caroline",
      artist: "Neil Diamond",
      youtube_id: "abcdefghijk",
      start_time: 12,
    });
    renderConsole();
    await act(async () => {
      await fireSubscribed();
    });
    await waitFor(() => expect(screen.getByText("Sweet Caroline")).toBeInTheDocument());
    expect(screen.getByText("Neil Diamond")).toBeInTheDocument();
    act(() => {
      onReadyHandler?.();
    });
    await waitFor(() => expect(lastHandle?.loadVideoById).toHaveBeenCalledWith("abcdefghijk", 12));
  });

  it("shows a clear toast when the song pool is exhausted", async () => {
    setHydrate({
      game: makeActiveGame({ status: "playing", round_number: 1 }),
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
    const next = screen.getByRole("button", { name: /^next round$/i });
    await waitFor(() => expect(next).toBeEnabled());
    fireEvent.click(next);
    await waitFor(() =>
      expect(
        screen.getByText(/all songs in your selected genres have been played/i),
      ).toBeInTheDocument(),
    );
  });
});
