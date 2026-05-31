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
  awardBonus: vi.fn(),
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

vi.mock("../hooks/useSelectNextSong", () => ({
  selectNextSongDirect: vi.fn(),
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

import { awardBonus, endGame } from "../lib/api";
import { awardAttemptDirect, releaseBuzzLockDirect } from "../hooks/useManagerActions";
import { selectNextSongDirect } from "../hooks/useSelectNextSong";
import type { ActiveGame, GameRound } from "../lib/types";
import { ToastProvider } from "../context/ToastContext";
import { setManagerToken, getManagerToken } from "../lib/managerToken";
import {
  fireGame,
  fireRound,
  fireSubscribed,
  makeActiveGame,
  makePayload,
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
  vi.mocked(selectNextSongDirect).mockReset();
  vi.mocked(awardAttemptDirect).mockReset();
  vi.mocked(releaseBuzzLockDirect).mockReset();
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

  it("calls selectNextSongDirect with the manager token when Start is pressed", async () => {
    setHydrate({
      game: makeActiveGame({ status: "waiting" }),
      teams: [],
      rounds: [],
    });
    vi.mocked(selectNextSongDirect).mockResolvedValueOnce({
      round_id: "r1",
      round_number: 1,
      song: {
        id: "s1",
        title: "Wayne's World",
        artist: "Wayne's World",
        youtube_id: "abcdefghijk",
        start_time: 0,
        is_soundtrack: true,
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
    // Optimistic toast fires before the RPC settles.
    expect(screen.getByText(/loading next round/i)).toBeInTheDocument();
    await waitFor(() => expect(selectNextSongDirect).toHaveBeenCalledWith("ABCDEF", TOKEN));
    await waitFor(() => expect(screen.getByText("Wayne's World")).toBeInTheDocument());
    // Soundtrack rounds: show name is the only label; no "from X" subline.
    expect(screen.getByTestId("soundtrack-badge")).toBeInTheDocument();
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

  it("Soundtrack rounds show a +15 button that fires both flags and leaves the lock/playback alone", async () => {
    setHydrate({
      game: makeActiveGame({
        status: "playing",
        buzzed_team_id: "t1",
        current_round_id: "r1",
        current_song_id: "song-S",
        round_number: 1,
      }),
      teams: [makeTeam({ id: "t1", name: "Alice" })],
      rounds: [makeRound({ id: "r1", round_number: 1, song_id: "song-S" })],
    });
    // is_soundtrack=true marks the song as a soundtrack round; the manager UI
    // collapses to a single "Correct +15" button.
    setSongFetch({
      id: "song-S",
      title: "Star Wars",
      artist: "Star Wars",
      youtube_id: "abcdefghijk",
      start_time: 0,
      is_soundtrack: true,
    });
    vi.mocked(awardAttemptDirect).mockResolvedValueOnce({
      round_id: "r1",
      team_id: "t1",
      points_awarded: 15,
      team_total_score: 15,
      title_claimed_by: "t1",
      artist_claimed_by: "t1",
    });
    renderConsole();
    await act(async () => {
      await fireSubscribed();
    });
    // Wait for the soundtrack song to land + the score-soundtrack button to render.
    await waitFor(() => expect(screen.getByTestId("score-soundtrack")).toBeInTheDocument());
    // The non-soundtrack title/artist buttons should be replaced, not duplicated.
    expect(screen.queryByTestId("score-title")).not.toBeInTheDocument();
    expect(screen.queryByTestId("score-artist")).not.toBeInTheDocument();
    expect(screen.getByTestId("soundtrack-badge")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("score-soundtrack"));
    // Optimistic toast fires before the RPC settles.
    expect(screen.getByText(/\+15 to Alice/i)).toBeInTheDocument();
    // award_attempt receives both flags so the function sums to +15.
    await waitFor(() =>
      expect(awardAttemptDirect).toHaveBeenCalledWith("ABCDEF", TOKEN, "r1", {
        title_correct: true,
        artist_correct: true,
        wrong_buzz: false,
      }),
    );
    // The round must stay in the fully-scored-but-locked state so the host
    // explicitly advances with Next round — same as a non-soundtrack round
    // where both title + artist were claimed. No auto-unlock, no auto-resume.
    expect(releaseBuzzLockDirect).not.toHaveBeenCalled();
    expect(lastHandle?.play).not.toHaveBeenCalled();
  });

  it("Soundtrack rounds show the film name (artist) with the song title as a hint", async () => {
    setHydrate({
      game: makeActiveGame({
        status: "playing",
        current_round_id: "r1",
        current_song_id: "song-P",
        round_number: 1,
      }),
      teams: [makeTeam({ id: "t1", name: "Alice" })],
      rounds: [makeRound({ id: "r1", round_number: 1, song_id: "song-P" })],
    });
    // Distinct title (song/clip) and artist (film) — the Approach-B shape.
    setSongFetch({
      id: "song-P",
      title: "He's a Pirate",
      artist: "Pirates of the Caribbean",
      youtube_id: "abcdefghijk",
      start_time: 0,
      is_soundtrack: true,
    });
    renderConsole();
    await act(async () => {
      await fireSubscribed();
    });
    // The film/show name (artist) is the answer the host judges.
    await waitFor(() => expect(screen.getByText("Pirates of the Caribbean")).toBeInTheDocument());
    // The song/clip name (title) appears only as a secondary hint.
    expect(screen.getByText("He's a Pirate")).toBeInTheDocument();
    expect(screen.getByTestId("soundtrack-badge")).toBeInTheDocument();
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
    // Optimistic toast fires before the RPC settles.
    expect(screen.getByText(/round continued/i)).toBeInTheDocument();
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

  it("Wrong skips the -3 toast when a token was already claimed (free-guess rule)", async () => {
    setHydrate({
      game: makeActiveGame({
        status: "playing",
        buzzed_team_id: "t1",
        current_round_id: "r1",
      }),
      teams: [makeTeam({ id: "t1", name: "Alice" })],
      // title already claimed earlier this round -> free_guess rule waives -3
      rounds: [makeRound({ id: "r1", title_claimed_by: "t1" })],
    });
    vi.mocked(awardAttemptDirect).mockResolvedValueOnce({
      round_id: "r1",
      team_id: "t1",
      points_awarded: 0,
      team_total_score: 10,
      title_claimed_by: "t1",
      artist_claimed_by: null,
    });
    renderConsole();
    await act(async () => {
      await fireSubscribed();
    });
    fireEvent.click(screen.getByTestId("score-wrong"));
    // The -3 toast must NOT appear since the round is in free-guess state.
    expect(screen.queryByText(/-3 to Alice/i)).not.toBeInTheDocument();
    await waitFor(() =>
      expect(awardAttemptDirect).toHaveBeenCalledWith("ABCDEF", TOKEN, "r1", {
        title_correct: false,
        artist_correct: false,
        wrong_buzz: true,
      }),
    );
  });

  // ---- no-flash regression: scoring buttons stay disabled across RPC + Realtime ----
  // Before the pending-flag fix the disable prop read `busy`, so the button
  // flipped disabled -> enabled (when the RPC resolved and `busy` cleared)
  // -> disabled (when the Realtime UPDATE landed). The visible flicker was
  // the "double flash" the host saw. These tests pin the new behavior:
  // disabled at click time, disabled when the RPC resolves, still disabled
  // after the Realtime UPDATE -- one transition, no enable-in-between.

  it("Correct Song stays disabled through the RPC -> Realtime handoff (no flash)", async () => {
    setHydrate({
      game: makeActiveGame({
        status: "playing",
        buzzed_team_id: "t1",
        current_round_id: "r1",
      }),
      teams: [makeTeam({ id: "t1", name: "Alice" })],
      rounds: [makeRound({ id: "r1" })],
    });
    // Defer the RPC resolution so we can probe state mid-flight.
    let resolveRpc!: (value: never) => void;
    vi.mocked(awardAttemptDirect).mockReturnValueOnce(
      new Promise((res) => {
        resolveRpc = res as (v: never) => void;
      }) as never,
    );
    renderConsole();
    await act(async () => {
      await fireSubscribed();
    });
    const btn = screen.getByTestId("score-title");
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    // Click flipped the pending flag synchronously: still disabled.
    expect(btn).toBeDisabled();
    // Simulate the RPC commit (DB has applied the claim).
    await act(async () => {
      resolveRpc({
        round_id: "r1",
        team_id: "t1",
        points_awarded: 10,
        team_total_score: 10,
        title_claimed_by: "t1",
        artist_claimed_by: null,
      } as never);
    });
    // RPC has resolved but the Realtime UPDATE hasn't landed yet -- in the
    // old code this is where `busy` would have cleared and the button would
    // briefly re-enable. The pending flag keeps it disabled.
    expect(btn).toBeDisabled();
    // Now simulate the Realtime UPDATE on game_rounds.
    await act(async () => {
      fireRound(
        makePayload<GameRound>("game_rounds", "UPDATE", {
          new: makeRound({ id: "r1", title_claimed_by: "t1" }),
          old: makeRound({ id: "r1" }),
        }),
      );
    });
    // Disabled now via the semantic gate (title_claimed_by) -- the pending
    // flag's job is done; the button stayed disabled throughout.
    expect(btn).toBeDisabled();
  });

  it("Correct Artist stays disabled through the RPC -> Realtime handoff (no flash)", async () => {
    setHydrate({
      game: makeActiveGame({
        status: "playing",
        buzzed_team_id: "t1",
        current_round_id: "r1",
      }),
      teams: [makeTeam({ id: "t1" })],
      rounds: [makeRound({ id: "r1" })],
    });
    let resolveRpc!: (value: never) => void;
    vi.mocked(awardAttemptDirect).mockReturnValueOnce(
      new Promise((res) => {
        resolveRpc = res as (v: never) => void;
      }) as never,
    );
    renderConsole();
    await act(async () => {
      await fireSubscribed();
    });
    const btn = screen.getByTestId("score-artist");
    fireEvent.click(btn);
    expect(btn).toBeDisabled();
    await act(async () => {
      resolveRpc({
        round_id: "r1",
        team_id: "t1",
        points_awarded: 5,
        team_total_score: 5,
        title_claimed_by: null,
        artist_claimed_by: "t1",
      } as never);
    });
    expect(btn).toBeDisabled();
    await act(async () => {
      fireRound(
        makePayload<GameRound>("game_rounds", "UPDATE", {
          new: makeRound({ id: "r1", artist_claimed_by: "t1" }),
          old: makeRound({ id: "r1" }),
        }),
      );
    });
    expect(btn).toBeDisabled();
  });

  it("Wrong stays disabled through the RPC -> Realtime handoff (no flash)", async () => {
    setHydrate({
      game: makeActiveGame({
        status: "playing",
        buzzed_team_id: "t1",
        current_round_id: "r1",
      }),
      teams: [makeTeam({ id: "t1" })],
      rounds: [makeRound({ id: "r1" })],
    });
    let resolveRpc!: (value: never) => void;
    vi.mocked(awardAttemptDirect).mockReturnValueOnce(
      new Promise((res) => {
        resolveRpc = res as (v: never) => void;
      }) as never,
    );
    renderConsole();
    await act(async () => {
      await fireSubscribed();
    });
    const btn = screen.getByTestId("score-wrong");
    fireEvent.click(btn);
    expect(btn).toBeDisabled();
    await act(async () => {
      resolveRpc({
        round_id: "r1",
        team_id: "t1",
        points_awarded: -3,
        team_total_score: -3,
        title_claimed_by: null,
        artist_claimed_by: null,
      } as never);
    });
    expect(btn).toBeDisabled();
    // Wrong clears the buzz lock on active_games -- Realtime UPDATE drops
    // buzzed_team_id. After that the semantic gate (!lockedTeam) is what
    // keeps the button disabled.
    await act(async () => {
      fireRound(
        makePayload<GameRound>("game_rounds", "UPDATE", {
          new: makeRound({ id: "r1" }),
          old: makeRound({ id: "r1" }),
        }),
      );
    });
    expect(btn).toBeDisabled();
  });

  it("Wrong re-enables for the next buzz in the same round (multi-buzz)", async () => {
    // Regression for the e2e failures in wrong_buzz_recovery scenarios 8/9
    // and bonus_flow scenario 19: the pendingWrong flag was only cleared on
    // round change, so a second wrong-buzz in the same round left the
    // button permanently disabled.
    setHydrate({
      game: makeActiveGame({
        status: "playing",
        buzzed_team_id: "t1",
        current_round_id: "r1",
      }),
      teams: [makeTeam({ id: "t1" }), makeTeam({ id: "t2", name: "Bravo" })],
      rounds: [makeRound({ id: "r1" })],
    });
    vi.mocked(awardAttemptDirect).mockResolvedValueOnce({
      round_id: "r1",
      team_id: "t1",
      points_awarded: -3,
      team_total_score: -3,
      title_claimed_by: null,
      artist_claimed_by: null,
    } as never);
    renderConsole();
    await act(async () => {
      await fireSubscribed();
    });
    const btn = screen.getByTestId("score-wrong");
    await act(async () => {
      fireEvent.click(btn);
    });
    // Wrong RPC commits, lock releases via Realtime (buzzed_team_id -> null).
    await act(async () => {
      fireGame(
        makePayload<ActiveGame>("active_games", "UPDATE", {
          new: makeActiveGame({
            status: "playing",
            buzzed_team_id: null,
            current_round_id: "r1",
          }),
          old: makeActiveGame({
            status: "playing",
            buzzed_team_id: "t1",
            current_round_id: "r1",
          }),
        }),
      );
    });
    // T2 now buzzes -- new lock, same round.
    await act(async () => {
      fireGame(
        makePayload<ActiveGame>("active_games", "UPDATE", {
          new: makeActiveGame({
            status: "playing",
            buzzed_team_id: "t2",
            current_round_id: "r1",
          }),
          old: makeActiveGame({
            status: "playing",
            buzzed_team_id: null,
            current_round_id: "r1",
          }),
        }),
      );
    });
    expect(btn).toBeEnabled();
  });

  it("Correct Song re-enables after a failed RPC so the host can retry", async () => {
    setHydrate({
      game: makeActiveGame({
        status: "playing",
        buzzed_team_id: "t1",
        current_round_id: "r1",
      }),
      teams: [makeTeam({ id: "t1" })],
      rounds: [makeRound({ id: "r1" })],
    });
    vi.mocked(awardAttemptDirect).mockRejectedValueOnce(new Error("network blip"));
    renderConsole();
    await act(async () => {
      await fireSubscribed();
    });
    const btn = screen.getByTestId("score-title");
    fireEvent.click(btn);
    // After the rejection settles, the pending flag is cleared and the
    // button is re-enabled (lockedTeam still truthy, title not yet
    // claimed). The host can retry.
    await waitFor(() => expect(btn).toBeEnabled());
  });

  it("Continue round does not depend on busy (no flash); auto-disables when lock clears", async () => {
    setHydrate({
      game: makeActiveGame({
        status: "playing",
        buzzed_team_id: "t1",
        current_round_id: "r1",
      }),
      teams: [makeTeam({ id: "t1" })],
      rounds: [makeRound({ id: "r1" })],
    });
    let resolveRpc!: (value: undefined) => void;
    vi.mocked(releaseBuzzLockDirect).mockReturnValueOnce(
      new Promise<undefined>((res) => {
        resolveRpc = res;
      }),
    );
    renderConsole();
    await act(async () => {
      await fireSubscribed();
    });
    const continueBtn = screen.getByTestId("continue-round");
    expect(continueBtn).toBeEnabled();
    fireEvent.click(continueBtn);
    // Mid-RPC: the button is still enabled. The previous implementation
    // would have shown disabled here (busy=true) -- now we drop busy from
    // the gate and rely solely on the semantic state.
    expect(continueBtn).toBeEnabled();
    await act(async () => {
      resolveRpc(undefined);
    });
    // After Realtime clears buzzed_team_id, the semantic gate takes over.
    expect(continueBtn).toBeEnabled(); // still enabled (state hasn't flowed)
  });

  // ---- synchronous double-click guard: useRef in-flight locks ----
  // Two clicks fired in the same React tick both read `busy=false` from the
  // stale closure -- only a useRef-tracked in-flight flag can block the
  // second one synchronously. These tests pin that behavior: deferred RPC,
  // two rapid clicks, exactly one RPC fires.

  it("Next round double-click fires select_next_song exactly once (useRef guard)", async () => {
    setHydrate({
      game: makeActiveGame({ status: "playing", current_round_id: "r1" }),
      teams: [],
      rounds: [makeRound({ id: "r1" })],
    });
    let resolveRpc!: (value: never) => void;
    vi.mocked(selectNextSongDirect).mockReturnValueOnce(
      new Promise((res) => {
        resolveRpc = res as (v: never) => void;
      }) as never,
    );
    renderConsole();
    await act(async () => {
      await fireSubscribed();
    });
    act(() => {
      onReadyHandler?.();
    });
    const btn = screen.getByTestId("start-round");
    await waitFor(() => expect(btn).toBeEnabled());
    // Two clicks in the same synchronous tick. The button stays visually
    // enabled (busy isn't in the disabled prop) so React's render wouldn't
    // intercept; only the useRef guard does.
    fireEvent.click(btn);
    fireEvent.click(btn);
    // Resolve the deferred RPC so the await chain unblocks for cleanup.
    await act(async () => {
      resolveRpc({
        round_id: "r2",
        round_number: 2,
        song: {
          id: "s2",
          title: "T",
          artist: "A",
          youtube_id: "abcdefghijk",
          start_time: 0,
          is_soundtrack: false,
        },
      } as never);
    });
    expect(vi.mocked(selectNextSongDirect)).toHaveBeenCalledTimes(1);
  });

  it("Correct Song double-click fires award_attempt exactly once (useRef guard)", async () => {
    setHydrate({
      game: makeActiveGame({
        status: "playing",
        buzzed_team_id: "t1",
        current_round_id: "r1",
      }),
      teams: [makeTeam({ id: "t1" })],
      rounds: [makeRound({ id: "r1" })],
    });
    let resolveRpc!: (value: never) => void;
    vi.mocked(awardAttemptDirect).mockReturnValueOnce(
      new Promise((res) => {
        resolveRpc = res as (v: never) => void;
      }) as never,
    );
    renderConsole();
    await act(async () => {
      await fireSubscribed();
    });
    const btn = screen.getByTestId("score-title");
    fireEvent.click(btn);
    fireEvent.click(btn);
    await act(async () => {
      resolveRpc({
        round_id: "r1",
        team_id: "t1",
        points_awarded: 10,
        team_total_score: 10,
        title_claimed_by: "t1",
        artist_claimed_by: null,
      } as never);
    });
    expect(vi.mocked(awardAttemptDirect)).toHaveBeenCalledTimes(1);
  });

  it("Continue round double-click fires release_buzz_lock exactly once (useRef guard)", async () => {
    setHydrate({
      game: makeActiveGame({
        status: "playing",
        buzzed_team_id: "t1",
        current_round_id: "r1",
      }),
      teams: [makeTeam({ id: "t1" })],
      rounds: [makeRound({ id: "r1" })],
    });
    let resolveRpc!: (value: undefined) => void;
    vi.mocked(releaseBuzzLockDirect).mockReturnValueOnce(
      new Promise<undefined>((res) => {
        resolveRpc = res;
      }),
    );
    renderConsole();
    await act(async () => {
      await fireSubscribed();
    });
    const btn = screen.getByTestId("continue-round");
    fireEvent.click(btn);
    fireEvent.click(btn);
    await act(async () => {
      resolveRpc(undefined);
    });
    expect(vi.mocked(releaseBuzzLockDirect)).toHaveBeenCalledTimes(1);
  });

  it("Correct Song silently swallows a title_already_claimed RpcError (no toast)", async () => {
    setHydrate({
      game: makeActiveGame({
        status: "playing",
        buzzed_team_id: "t1",
        current_round_id: "r1",
      }),
      teams: [makeTeam({ id: "t1", name: "Alice" })],
      rounds: [makeRound({ id: "r1" })],
    });
    // The RpcError silent-skip branch (reportError) — these messages mean the
    // click was a no-op because Realtime already moved the round forward.
    const { RpcError } = await import("../hooks/useManagerActions");
    vi.mocked(awardAttemptDirect).mockRejectedValueOnce(
      new RpcError("title_already_claimed", "P0001"),
    );
    renderConsole();
    await act(async () => {
      await fireSubscribed();
    });
    fireEvent.click(screen.getByTestId("score-title"));
    // Optimistic toast still fires...
    expect(screen.getByText(/\+10 to Alice/i)).toBeInTheDocument();
    await waitFor(() => expect(awardAttemptDirect).toHaveBeenCalled());
    // ...but the rejection does NOT add an error toast on top.
    expect(screen.queryByText(/title_already_claimed/i)).not.toBeInTheDocument();
  });

  it("Correct Song surfaces an unexpected RpcError as an error toast", async () => {
    setHydrate({
      game: makeActiveGame({
        status: "playing",
        buzzed_team_id: "t1",
        current_round_id: "r1",
      }),
      teams: [makeTeam({ id: "t1", name: "Alice" })],
      rounds: [makeRound({ id: "r1" })],
    });
    const { RpcError } = await import("../hooks/useManagerActions");
    vi.mocked(awardAttemptDirect).mockRejectedValueOnce(
      new RpcError("manager_token_required", "28000"),
    );
    renderConsole();
    await act(async () => {
      await fireSubscribed();
    });
    fireEvent.click(screen.getByTestId("score-title"));
    await waitFor(() => expect(screen.getByText(/manager_token_required/i)).toBeInTheDocument());
  });

  it("Next round with a held buzz selects a new song via the direct RPC (no auto-score)", async () => {
    setHydrate({
      game: makeActiveGame({
        status: "playing",
        buzzed_team_id: "t1",
        current_round_id: "r1",
      }),
      teams: [makeTeam({ id: "t1" })],
      rounds: [makeRound({ id: "r1" })],
    });
    vi.mocked(selectNextSongDirect).mockResolvedValueOnce({
      round_id: "r2",
      round_number: 2,
      song: {
        id: "s2",
        title: "Next",
        artist: "Up",
        youtube_id: "abcdefghijk",
        start_time: 0,
        is_soundtrack: false,
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
    // Optimistic toast fires before the network resolves.
    expect(screen.getByText(/loading next round/i)).toBeInTheDocument();
    // select_next_song (mig 022) closes the prior round inside the function
    // via start_round, so we only call ONE RPC from the browser. The held
    // buzz is cleared as a side effect.
    await waitFor(() => expect(selectNextSongDirect).toHaveBeenCalledWith("ABCDEF", TOKEN));
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
    vi.mocked(selectNextSongDirect).mockResolvedValueOnce({
      round_id: "r2",
      round_number: 2,
      song: {
        id: "s2",
        title: "Next",
        artist: "Up",
        youtube_id: "abcdefghijk",
        start_time: 0,
        is_soundtrack: false,
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
    expect(screen.getByText(/loading next round/i)).toBeInTheDocument();
    await waitFor(() => expect(selectNextSongDirect).toHaveBeenCalledWith("ABCDEF", TOKEN));
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
    // Optimistic toast fires before the RPC settles.
    expect(screen.getByText(/ending game/i)).toBeInTheDocument();
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
    // Alice shows on the podium and in the always-on full scoreboard.
    expect(screen.getAllByText("Alice").length).toBeGreaterThan(0);
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

  it("shows a clear toast when the song pool is exhausted (RpcError no_more_songs)", async () => {
    setHydrate({
      game: makeActiveGame({ status: "playing", round_number: 1 }),
      teams: [],
      rounds: [],
    });
    // select_next_song (mig 022) raises 'no_more_songs' (sqlstate 22023) when
    // the selected-genres pool is exhausted; the PL/pgSQL message bubbles
    // up as RpcError.message in the browser.
    const { RpcError } = await import("../hooks/useManagerActions");
    vi.mocked(selectNextSongDirect).mockRejectedValueOnce(new RpcError("no_more_songs", "22023"));
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
