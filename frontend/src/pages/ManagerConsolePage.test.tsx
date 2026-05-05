import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

import { ApiError, awardPoints, endGame, kickTeam, selectSong } from "../lib/api";
import { AuthProvider } from "../context/AuthContext";
import { setAdminPassword } from "../context/authStorage";
import {
  fireSubscribed,
  makeActiveGame,
  makeRound,
  makeTeam,
  resetSupabaseMock,
  setHydrate,
} from "../test/supabaseMock";
import { ManagerConsolePage } from "./ManagerConsolePage";

beforeEach(() => {
  resetSupabaseMock();
  window.sessionStorage.clear();
  setAdminPassword("secret");
  onReadyHandler = null;
  vi.mocked(selectSong).mockReset();
  vi.mocked(awardPoints).mockReset();
  vi.mocked(endGame).mockReset();
  vi.mocked(kickTeam).mockReset();
});

afterEach(() => {
  window.sessionStorage.clear();
  setAdminPassword(null);
  vi.clearAllMocks();
});

function renderConsole() {
  return render(
    <MemoryRouter initialEntries={["/manager/game/ABCDEF"]}>
      <AuthProvider>
        <Routes>
          <Route path="/manager/game/:gameCode" element={<ManagerConsolePage />} />
          <Route path="/manager/login" element={<div>login page</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("ManagerConsolePage", () => {
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

  it("calls selectSong when Start is pressed", async () => {
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
    await waitFor(() => expect(selectSong).toHaveBeenCalledWith("ABCDEF"));
    await waitFor(() => expect(screen.getByText("Bohemian Rhapsody")).toBeInTheDocument());
  });

  it("logs out and redirects on 401 from selectSong", async () => {
    setHydrate({
      game: makeActiveGame({ status: "waiting" }),
      teams: [],
      rounds: [],
    });
    vi.mocked(selectSong).mockRejectedValueOnce(new ApiError("unauthorized", "no", 401));
    renderConsole();
    await act(async () => {
      await fireSubscribed();
    });
    act(() => {
      onReadyHandler?.();
    });
    fireEvent.click(screen.getByRole("button", { name: /start game/i }));
    await waitFor(() => expect(screen.getByText("login page")).toBeInTheDocument());
  });

  it("award button enables only when a team is buzzed", async () => {
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
    expect(screen.getByText(/alice buzzed in/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /award points/i })).toBeEnabled();
  });

  it("calls awardPoints with current checkbox state", async () => {
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
    fireEvent.click(screen.getByLabelText(/^title$/i));
    fireEvent.click(screen.getByRole("button", { name: /award points/i }));
    await waitFor(() =>
      expect(awardPoints).toHaveBeenCalledWith("ABCDEF", {
        round_id: "r1",
        title_correct: true,
        artist_correct: false,
        source_correct: false,
        timeout: false,
      }),
    );
  });

  it("timeout button awards with timeout=true even when checkboxes are checked", async () => {
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
    fireEvent.click(screen.getByRole("button", { name: /timeout/i }));
    await waitFor(() =>
      expect(awardPoints).toHaveBeenCalledWith("ABCDEF", {
        round_id: "r1",
        title_correct: false,
        artist_correct: false,
        source_correct: false,
        timeout: true,
      }),
    );
  });

  it("kick calls api.kickTeam", async () => {
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
    fireEvent.click(screen.getByRole("button", { name: /kick/i }));
    await waitFor(() => expect(kickTeam).toHaveBeenCalledWith("ABCDEF", "t1"));
  });

  it("end button calls api.endGame", async () => {
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
    fireEvent.click(screen.getByRole("button", { name: /end game/i }));
    await waitFor(() => expect(endGame).toHaveBeenCalledWith("ABCDEF"));
  });

  it("sign out clears auth and goes to login", async () => {
    setHydrate({
      game: makeActiveGame({ status: "waiting" }),
      teams: [],
      rounds: [],
    });
    renderConsole();
    await act(async () => {
      await fireSubscribed();
    });
    fireEvent.click(screen.getByRole("button", { name: /sign out/i }));
    await waitFor(() => expect(screen.getByText("login page")).toBeInTheDocument());
  });
});
