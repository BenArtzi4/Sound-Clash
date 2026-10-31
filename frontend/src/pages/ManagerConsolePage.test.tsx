import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forwardRef, useImperativeHandle, useRef } from "react";

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
  // useKeepBackendWarm pings this immediately on mount (T3.5); mock it so the
  // console's keep-warm ping is a no-op in tests.
  getHealth: vi.fn(() => Promise.resolve({ status: "ok", version: "test", supabase: "ok" })),
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
  extendGameDirect: vi.fn(),
}));

vi.mock("../hooks/useSelectNextSong", () => ({
  selectNextSongDirect: vi.fn(),
}));

vi.mock("../hooks/usePeekNextSong", () => ({
  peekNextSongDirect: vi.fn(),
}));

// Telemetry wrapper: assert the headline metrics (song-start, score-start) are
// wired without touching real Faro. startSongStart returns a spy handle so the
// page's songStart.rpcDone(...) calls don't crash.
const telemetry = vi.hoisted(() => {
  const handle = {
    rpcDone: vi.fn(),
    loadIssued: vi.fn(),
    playing: vi.fn(),
    fail: vi.fn(),
  };
  return {
    handle,
    startSongStart: vi.fn(() => handle),
    markScoreStart: vi.fn(),
    failScore: vi.fn(),
    log: vi.fn(),
  };
});
vi.mock("../lib/telemetry", () => ({
  startSongStart: telemetry.startSongStart,
  markScoreStart: telemetry.markScoreStart,
  failScore: telemetry.failScore,
  log: telemetry.log,
  // Also consumed by useGameChannel, which the page renders.
  recordFanout: vi.fn(),
  resolveBuzzE2E: vi.fn(),
  resolveScoreE2E: vi.fn(),
}));

interface MockHandle {
  loadVideoById: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  play: ReturnType<typeof vi.fn>;
  resumeIfPaused: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
}

function makeMockHandle(): MockHandle {
  return {
    loadVideoById: vi.fn(),
    pause: vi.fn(),
    play: vi.fn(),
    resumeIfPaused: vi.fn(),
    stop: vi.fn(),
  };
}

// The console renders ONE player (YouTube's embed rules allow no hidden
// second one). The mock still registers players in mount order, so a test
// can assert there is only one: index 0. `onReadyHandler` / `lastHandle`
// point at it; the handler arrays hold its latest callbacks.
let onReadyHandler: (() => void) | null = null;
let lastHandle: MockHandle | null = null;
let playerHandles: MockHandle[] = [];
let onReadyHandlers: Array<(() => void) | undefined> = [];
let onPlayingHandlers: Array<((d: "statechange" | "poll") => void) | undefined> = [];
let onErrorHandlers: Array<((code: number, videoId: string | null) => void) | undefined> = [];
type StartStall = (info: {
  state: number;
  loadedFraction: number;
  retried: boolean;
  videoId: string | null;
}) => void;
let onStartStallHandlers: Array<StartStall | undefined> = [];
let onEarlyPauseHandlers: Array<((msAfterStart: number) => void) | undefined> = [];
// The idleLabel each player was last rendered with (shown over an empty player).
let idleLabels: Array<string | undefined> = [];
// Each player's last `controls` / `holdPlayback` props (the host's buttons).
let playerControls: Array<boolean | undefined> = [];
let playerHold: Array<boolean | undefined> = [];

// Typed accessor (tsconfig has noUncheckedIndexedAccess): the handle is pushed
// before this is ever read, so a missing index is a test-setup bug.
function handle(i: number): MockHandle {
  const h = playerHandles[i];
  if (!h) throw new Error(`no player handle registered at index ${i}`);
  return h;
}

vi.mock("../components/YouTubePlayer", () => ({
  YouTubePlayer: forwardRef<
    MockHandle,
    {
      onReady?: () => void;
      onPlaying?: (d: "statechange" | "poll") => void;
      onError?: (code: number, videoId: string | null) => void;
      onStartStall?: StartStall;
      onEarlyPause?: (msAfterStart: number) => void;
      testId?: string;
      idleLabel?: string;
      controls?: boolean;
      holdPlayback?: boolean;
    }
  >((props, ref) => {
    const idxRef = useRef<number | null>(null);
    if (idxRef.current === null) {
      idxRef.current = playerHandles.length;
      playerHandles.push(makeMockHandle());
      onReadyHandlers.push(props.onReady);
      onPlayingHandlers.push(props.onPlaying);
      onErrorHandlers.push(props.onError);
      onStartStallHandlers.push(props.onStartStall);
      onEarlyPauseHandlers.push(props.onEarlyPause);
      idleLabels.push(props.idleLabel);
    }
    const idx = idxRef.current;
    // Keep the handler captures current across re-renders — the page recreates
    // these closures each render (onPlayerReady's flushPendingSong, etc.), so
    // the LATEST one is what a test must invoke. onReadyHandler / lastHandle
    // mirror the player (index 0).
    onReadyHandlers[idx] = props.onReady;
    onPlayingHandlers[idx] = props.onPlaying;
    onErrorHandlers[idx] = props.onError;
    onStartStallHandlers[idx] = props.onStartStall;
    onEarlyPauseHandlers[idx] = props.onEarlyPause;
    idleLabels[idx] = props.idleLabel;
    playerControls[idx] = props.controls;
    playerHold[idx] = props.holdPlayback;
    if (idx === 0) {
      onReadyHandler = props.onReady ?? null;
      lastHandle = handle(0);
    }
    useImperativeHandle(ref, () => handle(idx), [idx]);
    return <div data-testid={props.testId ?? "yt-player"} />;
  }),
}));

import { awardBonus, endGame } from "../lib/api";
import {
  awardAttemptDirect,
  extendGameDirect,
  releaseBuzzLockDirect,
} from "../hooks/useManagerActions";
import { _resetServerTime, observeServerTime } from "../hooks/useServerTime";
import { selectNextSongDirect } from "../hooks/useSelectNextSong";
import { peekNextSongDirect } from "../hooks/usePeekNextSong";
import type { ActiveGame, GameRound, SelectSongResponse, Team } from "../lib/types";
import { ToastProvider } from "../context/ToastContext";
import { setManagerToken, getManagerToken } from "../lib/managerToken";
import {
  fireGame,
  fireRound,
  fireSubscribed,
  fireTeam,
  makeActiveGame,
  makePayload,
  makeRound,
  makeTeam,
  resetSupabaseMock,
  setHydrate,
  setSongFetch,
  setSongFetchFailures,
} from "../test/supabaseMock";
import { ManagerConsolePage } from "./ManagerConsolePage";

const TOKEN = "tok-host-1";

beforeEach(() => {
  resetSupabaseMock();
  window.localStorage.clear();
  setManagerToken("ABCDEF", TOKEN);
  onReadyHandler = null;
  lastHandle = null;
  playerHandles = [];
  onReadyHandlers = [];
  onPlayingHandlers = [];
  onErrorHandlers = [];
  onStartStallHandlers = [];
  onEarlyPauseHandlers = [];
  idleLabels = [];
  playerControls = [];
  playerHold = [];
  vi.mocked(selectNextSongDirect).mockReset();
  vi.mocked(peekNextSongDirect).mockReset();
  vi.mocked(awardAttemptDirect).mockReset();
  vi.mocked(releaseBuzzLockDirect).mockReset();
  vi.mocked(extendGameDirect).mockReset();
  vi.mocked(awardBonus).mockReset();
  vi.mocked(endGame).mockReset();
  // Re-establish the telemetry handle impl (afterEach's clearAllMocks drops it).
  telemetry.startSongStart.mockReset();
  telemetry.startSongStart.mockImplementation(() => telemetry.handle);
  telemetry.handle.rpcDone.mockClear();
  telemetry.handle.loadIssued.mockClear();
  telemetry.handle.playing.mockClear();
  telemetry.handle.fail.mockClear();
  telemetry.markScoreStart.mockClear();
  telemetry.failScore.mockClear();
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

  function setVisibility(vis: "visible" | "hidden"): void {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => vis });
  }
  function fireVisibilityChange(): void {
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
  }

  it("resumes the live player when the tab becomes visible during play with no buzz", async () => {
    setHydrate({
      game: makeActiveGame({ status: "playing", round_number: 1 }),
      teams: [makeTeam({ id: "t1", name: "Team 1" })],
      rounds: [makeRound({ round_number: 1 })],
    });
    renderConsole();
    await act(async () => {
      await fireSubscribed();
    });

    setVisibility("visible");
    fireVisibilityChange();

    expect(handle(0).resumeIfPaused).toHaveBeenCalled();
    // Flush any trailing async (keep-warm ping) inside act so its state settle
    // isn't reported as an un-acted update after the test returns.
    await act(async () => {
      await Promise.resolve();
    });
  });

  it("does not resume on tab focus while a buzz is being scored", async () => {
    setHydrate({
      game: makeActiveGame({ status: "playing", round_number: 1, buzzed_team_id: "t1" }),
      teams: [makeTeam({ id: "t1", name: "Team 1" })],
      rounds: [makeRound({ round_number: 1 })],
    });
    renderConsole();
    await act(async () => {
      await fireSubscribed();
    });

    setVisibility("visible");
    fireVisibilityChange();

    expect(handle(0).resumeIfPaused).not.toHaveBeenCalled();
    await act(async () => {
      await Promise.resolve();
    });
  });

  it("gives the player the host's back / pause / forward buttons", async () => {
    setHydrate({
      game: makeActiveGame({ status: "playing", round_number: 1 }),
      teams: [makeTeam({ id: "t1", name: "Team 1" })],
      rounds: [makeRound({ round_number: 1 })],
    });
    renderConsole();
    await act(async () => {
      await fireSubscribed();
    });
    expect(playerControls).toEqual([true]);
    expect(playerHold).toEqual([false]);
    await act(async () => {
      await Promise.resolve();
    });
  });

  it("locks the host's Play button while a team holds the buzz", async () => {
    setHydrate({
      game: makeActiveGame({ status: "playing", round_number: 1, buzzed_team_id: "t1" }),
      teams: [makeTeam({ id: "t1", name: "Team 1" })],
      rounds: [makeRound({ round_number: 1 })],
    });
    renderConsole();
    await act(async () => {
      await fireSubscribed();
    });
    expect(playerHold).toEqual([true]);
    await act(async () => {
      await Promise.resolve();
    });
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
    const startBtn = screen.getByTestId("start-round");
    expect(startBtn).toBeDisabled();
    // While the player is still constructing, the button reads as progress.
    expect(startBtn).toHaveTextContent(/loading player/i);
    act(() => {
      onReadyHandler?.();
    });
    await waitFor(() => expect(startBtn).toBeEnabled());
    expect(startBtn).toHaveTextContent(/start game/i);
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
        release_year: 1992,
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
    // The year from select_next_song's row (mig 050) sits beside the film name.
    expect(screen.getByTestId("song-year")).toHaveTextContent("1992");
  });

  it("opens a song-start span and reports rpcDone when Start is pressed", async () => {
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
        title: "T",
        artist: "A",
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
    await waitFor(() => expect(screen.getByRole("button", { name: /start game/i })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /start game/i }));
    expect(telemetry.startSongStart).toHaveBeenCalledWith({ game_code: "ABCDEF" });
    await waitFor(() =>
      expect(telemetry.handle.rpcDone).toHaveBeenCalledWith(
        expect.objectContaining({ roundNumber: 1, songId: "s1", youtubeId: "abcdefghijk" }),
      ),
    );
  });

  it("marks a score-start span when a correct answer is scored", async () => {
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
    expect(telemetry.markScoreStart).toHaveBeenCalledWith("ABCDEF", "r1", "title");
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

  it("shows the reserved status strip idle copy while playing with no buzz", async () => {
    // The strip is always mounted during play (fixed height) so the scoring
    // buttons don't move when a buzz lands; when nobody is buzzed it reads the
    // idle prompt rather than being absent.
    setHydrate({
      game: makeActiveGame({
        status: "playing",
        buzzed_team_id: null,
        current_round_id: "r1",
      }),
      teams: [makeTeam({ id: "t1", name: "Alice" })],
      rounds: [makeRound({ id: "r1" })],
    });
    renderConsole();
    await act(async () => {
      await fireSubscribed();
    });
    expect(screen.getByText(/waiting for a buzz/i)).toBeInTheDocument();
  });

  it("keeps the buzzed team's name and the sentence in one run of text", async () => {
    // As two direct children of the flex strip, a long name and "buzzed in"
    // rendered as two side-by-side columns. One wrapper keeps them one line.
    setHydrate({
      game: makeActiveGame({
        status: "playing",
        buzzed_team_id: "t1",
        current_round_id: "r1",
      }),
      teams: [makeTeam({ id: "t1", name: "The Midnight Lyric Hunters XL" })],
      rounds: [makeRound({ id: "r1" })],
    });
    renderConsole();
    await act(async () => {
      await fireSubscribed();
    });
    const text = screen.getByTestId("status-text");
    const strip = text.parentElement;
    expect(strip).toHaveAttribute("role", "status");
    expect(strip?.childNodes).toHaveLength(1);
    expect(text).toHaveTextContent("The Midnight Lyric Hunters XL buzzed in — score it:");
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

  it("score buttons carry a decorative icon and keep the four-slot row in a normal round", async () => {
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
    for (const id of ["score-title", "score-artist", "score-wrong", "score-bonus"]) {
      const btn = screen.getByTestId(id);
      // One icon per button, hidden from assistive tech so the name stays the text.
      expect(btn.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(1);
      expect(btn.querySelector("svg:not([aria-hidden])")).toBeNull();
    }
    expect(screen.getByTestId("score-title")).toHaveTextContent("Correct Song+10");
    expect(screen.getByTestId("score-wrong")).toHaveTextContent("Wrong-3");
    expect(screen.getByTestId("score-title").parentElement?.className).not.toMatch(
      /scoreRowSoundtrack/,
    );
  });

  it("soundtrack rounds mark the score row so Correct fills the empty slot", async () => {
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
    setSongFetch({
      id: "song-S",
      title: "Star Wars",
      artist: "Star Wars",
      youtube_id: "abcdefghijk",
      start_time: 0,
      is_soundtrack: true,
    });
    renderConsole();
    await act(async () => {
      await fireSubscribed();
    });
    await waitFor(() => expect(screen.getByTestId("score-soundtrack")).toBeInTheDocument());
    const row = screen.getByTestId("score-soundtrack").parentElement;
    expect(row?.className).toMatch(/scoreRowSoundtrack/);
    // Correct leads the row: the phone layout spans its first child across both columns.
    expect(row?.firstElementChild).toBe(screen.getByTestId("score-soundtrack"));
    expect(
      screen.getByTestId("score-soundtrack").querySelectorAll('svg[aria-hidden="true"]'),
    ).toHaveLength(1);
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

  it("shows the host the song's release year beside the title", async () => {
    setHydrate({
      game: makeActiveGame({
        status: "playing",
        current_round_id: "r1",
        current_song_id: "song-Y",
        round_number: 1,
      }),
      teams: [makeTeam({ id: "t1", name: "Alice" })],
      rounds: [makeRound({ id: "r1", round_number: 1, song_id: "song-Y" })],
    });
    setSongFetch({
      id: "song-Y",
      title: "Bohemian Rhapsody",
      artist: "Queen",
      youtube_id: "abcdefghijk",
      release_year: 1975,
    });
    renderConsole();
    await act(async () => {
      await fireSubscribed();
    });
    // Host-only hint for an optional year bonus question.
    await waitFor(() => expect(screen.getByTestId("song-year")).toHaveTextContent("1975"));
    expect(screen.getByText("Bohemian Rhapsody")).toBeInTheDocument();
    expect(screen.getByText("Queen")).toBeInTheDocument();
  });

  it("shows no year chip when the song's release year is unknown", async () => {
    setHydrate({
      game: makeActiveGame({
        status: "playing",
        current_round_id: "r1",
        current_song_id: "song-Z",
        round_number: 1,
      }),
      teams: [makeTeam({ id: "t1", name: "Alice" })],
      rounds: [makeRound({ id: "r1", round_number: 1, song_id: "song-Z" })],
    });
    setSongFetch({
      id: "song-Z",
      title: "Undated Song",
      artist: "Someone",
      youtube_id: "abcdefghijk",
      release_year: null,
    });
    renderConsole();
    await act(async () => {
      await fireSubscribed();
    });
    await waitFor(() => expect(screen.getByText("Undated Song")).toBeInTheDocument());
    expect(screen.queryByTestId("song-year")).not.toBeInTheDocument();
  });

  it("retries the post-refresh song resolve so the round recovers from a transient blip", async () => {
    // F-P1-7: after a manager-tab refresh mid-round, the song_id -> songs
    // lookup used to give up on the first transient error, leaving the card
    // and the player empty for the whole round. The bounded backoff retry in
    // fetchSongById must recover it, and the recovered song must still flow
    // into the player pipeline (queued here, flushed by onReady).
    vi.useFakeTimers();
    try {
      setHydrate({
        game: makeActiveGame({
          status: "playing",
          current_round_id: "r1",
          current_song_id: "song-1",
          round_number: 1,
        }),
        teams: [makeTeam({ id: "t1", name: "Alice" })],
        rounds: [makeRound({ id: "r1", round_number: 1, song_id: "song-1" })],
      });
      setSongFetch({
        id: "song-1",
        title: "Take On Me",
        artist: "a-ha",
        youtube_id: "djV11Xbc914",
        start_time: 10,
      });
      setSongFetchFailures(1);
      renderConsole();
      await act(async () => {
        await fireSubscribed();
      });
      // The first attempt failed: no song card yet.
      expect(screen.getByText(/no round started yet/i)).toBeInTheDocument();
      // The first backoff retry (500ms) lands and fills the card.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
      expect(screen.getByText("Take On Me")).toBeInTheDocument();
      // The player wasn't ready during the resolve, so the song was queued;
      // onReady flushes it into the live player.
      act(() => {
        onReadyHandler?.();
      });
      expect(lastHandle?.loadVideoById).toHaveBeenCalledWith("djV11Xbc914", 10);
    } finally {
      vi.useRealTimers();
    }
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

  it("Wrong skips the -3 toast when the round's free-guess flag is armed", async () => {
    setHydrate({
      game: makeActiveGame({
        status: "playing",
        buzzed_team_id: "t1",
        current_round_id: "r1",
      }),
      teams: [makeTeam({ id: "t1", name: "Alice" })],
      // free_guess_active is the server's one-shot flag: with it armed the next
      // wrong is waived (0), so the optimistic -3 toast must be suppressed.
      rounds: [makeRound({ id: "r1", title_claimed_by: "t1", free_guess_active: true })],
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

  it("Wrong still shows the -3 toast when a token is claimed but the free-guess flag was consumed", async () => {
    setHydrate({
      game: makeActiveGame({
        status: "playing",
        buzzed_team_id: "t1",
        current_round_id: "r1",
      }),
      teams: [makeTeam({ id: "t1", name: "Alice" })],
      // A token is claimed, but the one-shot free-guess flag was already
      // consumed by an earlier attempt -> the server applies the real -3, so
      // the host's optimistic toast must reflect it rather than be suppressed
      // by the coarse "any token claimed" heuristic.
      rounds: [makeRound({ id: "r1", title_claimed_by: "t1", free_guess_active: false })],
    });
    vi.mocked(awardAttemptDirect).mockResolvedValueOnce({
      round_id: "r1",
      team_id: "t1",
      points_awarded: -3,
      team_total_score: 7,
      title_claimed_by: "t1",
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

  it("Continue stays disabled through the RPC -> Realtime handoff (no flash)", async () => {
    // pendingContinue mirrors pendingWrong: after the click Continue must stay
    // disabled until Realtime clears the buzz lock, with no enable-in-between.
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
    // pendingContinue flips the disabled prop synchronously.
    expect(continueBtn).toBeDisabled();
    await act(async () => {
      resolveRpc(undefined);
    });
    // RPC resolved but the lock hasn't cleared over Realtime yet -- still
    // disabled (this is where the old busy toggle would have flashed enabled).
    expect(continueBtn).toBeDisabled();
    // Realtime clears the buzz lock; the semantic gate (!lockedTeam) now keeps
    // Continue disabled (nothing left to continue).
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
    expect(continueBtn).toBeDisabled();
  });

  it("rapid Correct Song then Wrong both fire — no silent busy drop (F-P1-8/F-P2-2)", async () => {
    // Regression: the shared `busy` gate dropped a distinct second click that
    // landed inside the first action's window. With busy off the hot handlers,
    // both distinct actions must fire.
    setHydrate({
      game: makeActiveGame({
        status: "playing",
        buzzed_team_id: "t1",
        current_round_id: "r1",
      }),
      teams: [makeTeam({ id: "t1", name: "Alice" })],
      rounds: [makeRound({ id: "r1" })],
    });
    let resolve1!: (v: never) => void;
    let resolve2!: (v: never) => void;
    vi.mocked(awardAttemptDirect)
      .mockReturnValueOnce(
        new Promise((res) => {
          resolve1 = res as (v: never) => void;
        }) as never,
      )
      .mockReturnValueOnce(
        new Promise((res) => {
          resolve2 = res as (v: never) => void;
        }) as never,
      );
    renderConsole();
    await act(async () => {
      await fireSubscribed();
    });
    // Correct Song, then immediately Wrong -- distinct actions, first RPC still
    // in flight.
    fireEvent.click(screen.getByTestId("score-title"));
    fireEvent.click(screen.getByTestId("score-wrong"));
    expect(awardAttemptDirect).toHaveBeenCalledTimes(2);
    expect(awardAttemptDirect).toHaveBeenNthCalledWith(1, "ABCDEF", TOKEN, "r1", {
      title_correct: true,
      artist_correct: false,
      wrong_buzz: false,
    });
    expect(awardAttemptDirect).toHaveBeenNthCalledWith(2, "ABCDEF", TOKEN, "r1", {
      title_correct: false,
      artist_correct: false,
      wrong_buzz: true,
    });
    // Let both awaits settle so no state updates land after the test.
    await act(async () => {
      resolve1({
        round_id: "r1",
        team_id: "t1",
        points_awarded: 10,
        team_total_score: 10,
        title_claimed_by: "t1",
        artist_claimed_by: null,
      } as never);
      resolve2({
        round_id: "r1",
        team_id: "t1",
        points_awarded: -3,
        team_total_score: 7,
        title_claimed_by: "t1",
        artist_claimed_by: null,
      } as never);
    });
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
    expect(screen.getByTestId("token-chip-artist")).toHaveAttribute("data-claimed", "true");
    expect(screen.getByTestId("score-artist")).toBeDisabled();
  });

  it("Bonus posts to awardBonus and confirms the +4 only after the call resolves (T4.6)", async () => {
    setHydrate({
      game: makeActiveGame({ status: "playing" }),
      teams: [makeTeam({ id: "t1", name: "Alice" }), makeTeam({ id: "t2", name: "Bob" })],
      rounds: [],
    });
    // Defer the Render call so we can probe the in-flight state: the bonus is
    // the one Render-routed scoring call, and on a cold start it can hang for
    // many seconds — the old optimistic "+4" toast lied during that window
    // (F-P1-5).
    let resolveBonus!: (v: never) => void;
    vi.mocked(awardBonus).mockReturnValueOnce(
      new Promise((res) => {
        resolveBonus = res as (v: never) => void;
      }) as never,
    );
    renderConsole();
    await act(async () => {
      await fireSubscribed();
    });
    fireEvent.click(screen.getByTestId("score-bonus"));
    await waitFor(() => screen.getByTestId("bonus-team-t2"));
    fireEvent.click(screen.getByTestId("bonus-team-t2"));
    // The click is acknowledged (neutral toast, busy gates Bonus + End game)
    // but success is NOT claimed while the call is in flight.
    expect(screen.getByText(/sending \+4 to Bob/i)).toBeInTheDocument();
    expect(screen.queryByText(/\+4 bonus to Bob/i)).not.toBeInTheDocument();
    expect(screen.getByTestId("score-bonus")).toBeDisabled();
    expect(screen.getByTestId("end-game")).toBeDisabled();
    await waitFor(() =>
      expect(awardBonus).toHaveBeenCalledWith("ABCDEF", TOKEN, { team_id: "t2" }),
    );
    await act(async () => {
      resolveBonus({ team_id: "t2", points_awarded: 4, team_total_score: 4 } as never);
    });
    // Only now does the success toast confirm the +4.
    expect(screen.getByText(/\+4 bonus to Bob/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("score-bonus")).toBeEnabled());
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

  it("Bonus surfaces an error toast and never claims success when the API call fails", async () => {
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
    // A failed bonus must not show the success toast (the old optimistic
    // toast fired it before the call, so the host saw success + error stacked).
    expect(screen.queryByText(/\+4 bonus to Alice/i)).not.toBeInTheDocument();
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
    // The post-game song export lives alongside the scoreboard (host-only).
    expect(screen.getByTestId("export-download")).toBeInTheDocument();
  });

  // T4.11 / I-FinalBoard: when the game rows are deleted (End game, or the
  // expiry sweep) the console keeps the podium + song export from the hook's
  // last-known snapshot instead of the bare "no longer exists" message. The
  // songs table is durable, so the export still resolves after the delete.
  describe("final board survives delete (I-FinalBoard)", () => {
    it("keeps the final scoreboard and song export from the snapshot after the game row is deleted", async () => {
      setSongFetch({
        id: "song-1",
        title: "Bohemian Rhapsody",
        artist: "Queen",
        youtube_id: "fJ9rUzIMcZQ",
      });
      setHydrate({
        game: makeActiveGame({ status: "playing", round_number: 1, current_round_id: "r1" }),
        teams: [
          makeTeam({ id: "t1", name: "Alice", score: 20 }),
          makeTeam({ id: "t2", name: "Bob", score: 9 }),
        ],
        rounds: [makeRound({ id: "r1", round_number: 1, song_id: "song-1" })],
      });
      renderConsole();
      await act(async () => {
        await fireSubscribed();
      });

      act(() => {
        fireGame(
          makePayload<ActiveGame>("active_games", "DELETE", { old: { game_code: "ABCDEF" } }),
        );
      });

      // Podium + both teams survive, with the softer "ended or expired" note
      // (not the bare "This game no longer exists.").
      expect(screen.getByText(/this game has ended or expired/i)).toBeInTheDocument();
      expect(screen.queryByText(/this game no longer exists/i)).not.toBeInTheDocument();
      expect(screen.getByText(/final results/i)).toBeInTheDocument();
      expect(screen.getAllByText("Alice").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Bob").length).toBeGreaterThan(0);
      // The song export still resolves the played song from the durable table.
      expect(screen.getByRole("link", { name: /back to home/i })).toBeInTheDocument();
      await waitFor(() => expect(screen.getByTestId("export-download")).toBeEnabled());
    });

    it("falls back to 'no longer exists' when the console opened onto an already-swept game", async () => {
      setHydrate({ game: null, teams: [], rounds: [] });
      renderConsole();
      await act(async () => {
        await fireSubscribed();
      });
      await waitFor(() =>
        expect(screen.getByText(/this game no longer exists/i)).toBeInTheDocument(),
      );
      expect(screen.queryByText(/final results/i)).not.toBeInTheDocument();
    });

    it("holds the full board + export while the post-end sweep cascade-deletes rows", async () => {
      setSongFetch({
        id: "song-1",
        title: "Bohemian Rhapsody",
        artist: "Queen",
        youtube_id: "fJ9rUzIMcZQ",
      });
      setHydrate({
        game: makeActiveGame({ status: "ended", ended_at: "2026-05-05T13:00:00.000Z" }),
        teams: [
          makeTeam({ id: "t1", name: "Alice", score: 20 }),
          makeTeam({ id: "t2", name: "Bob", score: 9 }),
        ],
        rounds: [makeRound({ id: "r1", round_number: 1, song_id: "song-1" })],
      });
      renderConsole();
      await act(async () => {
        await fireSubscribed();
      });
      expect(screen.getByText(/final results/i)).toBeInTheDocument();
      await waitFor(() => expect(screen.getByTestId("export-download")).toBeEnabled());

      // The sweep prunes a team row (and later the round) before the game row.
      act(() => {
        fireTeam(makePayload<Team>("game_teams", "DELETE", { old: { id: "t2" } }));
      });
      act(() => {
        fireRound(makePayload<GameRound>("game_rounds", "DELETE", { old: { id: "r1" } }));
      });

      // Bob stays on the podium and the export stays populated (snapshot holds).
      expect(screen.getAllByText("Bob").length).toBeGreaterThan(0);
      expect(screen.getByTestId("export-download")).toBeEnabled();
    });
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

  // ---- the next song: peek_next_song + an in-tap load on the one player ----
  //
  // YouTube's embed rules allow no hidden player that plays, so since
  // 2026-10-31 the console has one player. The next song is only peeked; the
  // Next-round tap loads it on that player synchronously (mobile browsers
  // allow unmuted playback only inside the tap) and commits its id.

  async function setupPlayingRound() {
    setHydrate({
      game: makeActiveGame({ status: "playing", round_number: 1, current_round_id: "r1" }),
      teams: [],
      rounds: [makeRound({ id: "r1", round_number: 1, song_id: "song-1" })],
    });
    setSongFetch({
      id: "song-1",
      title: "First",
      artist: "A",
      youtube_id: "vid1aaaaaaa",
      start_time: 0,
    });
    const utils = renderConsole();
    await act(async () => {
      await fireSubscribed();
    });
    act(() => {
      onReadyHandler?.();
    });
    await waitFor(() => expect(screen.getByText("First")).toBeInTheDocument());
    return utils;
  }

  const SONG2 = {
    song_id: "song-2",
    youtube_id: "vid2bbbbbbb",
    start_time: 30,
    title: "Song Two",
    artist: "Artist Two",
    is_soundtrack: false,
    release_year: null,
  };
  const SONG2_ROW = {
    id: "song-2",
    title: "Song Two",
    artist: "Artist Two",
    youtube_id: "vid2bbbbbbb",
    start_time: 30,
    is_soundtrack: false,
  };

  // Round 1 is live; once it plays, song 2 is peeked.
  async function peekSong2() {
    const utils = await setupPlayingRound();
    vi.mocked(peekNextSongDirect).mockResolvedValueOnce(SONG2);
    await act(async () => {
      onPlayingHandlers[0]?.("statechange");
    });
    await waitFor(() => expect(peekNextSongDirect).toHaveBeenCalledWith("ABCDEF", TOKEN));
    // Let the peek's promise settle into the console before the click.
    await act(async () => {
      await Promise.resolve();
    });
    return utils;
  }

  it("renders one player only, with the host's buttons", async () => {
    await setupPlayingRound();
    expect(playerHandles).toHaveLength(1);
    // The mock draws the default testId when the page passes none.
    expect(screen.getAllByTestId("yt-player")).toHaveLength(1);
    expect(playerControls).toEqual([true]);
  });

  it("loads the peeked song on the player inside the Next-round tap, then commits its id", async () => {
    await peekSong2();
    let answer: (r: SelectSongResponse) => void = () => {};
    vi.mocked(selectNextSongDirect).mockReturnValueOnce(
      new Promise<SelectSongResponse>((resolve) => {
        answer = resolve;
      }),
    );
    const loadsBefore = handle(0).loadVideoById.mock.calls.length;
    act(() => {
      fireEvent.click(screen.getByTestId("start-round"));
    });
    // All of this happens synchronously in the click, before the RPC answers:
    // a load after the await would be blocked autoplay on iOS.
    expect(handle(0).loadVideoById).toHaveBeenCalledTimes(loadsBefore + 1);
    expect(handle(0).loadVideoById).toHaveBeenLastCalledWith("vid2bbbbbbb", 30);
    expect(handle(0).stop).not.toHaveBeenCalled();
    expect(selectNextSongDirect).toHaveBeenCalledWith("ABCDEF", TOKEN, "song-2");
    expect(telemetry.handle.loadIssued).toHaveBeenCalled();
    expect(screen.getByText("Song Two")).toBeInTheDocument();

    await act(async () => {
      answer({ round_id: "r2", round_number: 2, song: SONG2_ROW });
    });
    // select_next_song answers ~275 ms before the new round's Realtime event;
    // until it lands the old round's song must not be fetched and reloaded
    // over this one, and the song is not loaded a second time.
    await act(async () => {
      await Promise.resolve();
    });
    expect(handle(0).loadVideoById).toHaveBeenCalledTimes(loadsBefore + 1);
    expect(screen.getByText("Song Two")).toBeInTheDocument();
    // Nothing is prebuffered any more: every song is a fresh load.
    expect(telemetry.handle.rpcDone).toHaveBeenCalledWith(
      expect.objectContaining({ preloaded: false, songId: "song-2", roundNumber: 2 }),
    );
  });

  it("records one round for a double click", async () => {
    await peekSong2();
    vi.mocked(selectNextSongDirect).mockReturnValueOnce(new Promise<SelectSongResponse>(() => {}));
    await act(async () => {
      fireEvent.click(screen.getByTestId("start-round"));
      fireEvent.click(screen.getByTestId("start-round"));
    });
    expect(selectNextSongDirect).toHaveBeenCalledTimes(1);
    expect(handle(0).loadVideoById).toHaveBeenLastCalledWith("vid2bbbbbbb", 30);
  });

  it("logs a start stall with its song and whether the player issued the load again", async () => {
    await setupPlayingRound();
    act(() =>
      onStartStallHandlers[0]?.({
        state: -1,
        loadedFraction: 0,
        retried: true,
        videoId: "vid1aaaaaaa",
      }),
    );
    expect(telemetry.log).toHaveBeenCalledWith("warn", "yt_live_stall", {
      kind: "no_start",
      game_code: "ABCDEF",
      state: "-1",
      loaded_fraction: "0",
      retried: "true",
      youtube_id: "vid1aaaaaaa",
      song_id: "song-1",
      title: "First",
      artist: "A",
    });
  });

  // The weekly dead-video scan (.github/workflows/dead-video-scan.yml) reads
  // `message=yt_(player|preload)_error` from Loki and prints context_code,
  // context_youtube_id, context_title, context_artist and context_game_code.
  // A song YouTube silently refuses (nothing loaded, so the player retried it)
  // must keep reaching it as yt_preload_error, as from the old standby.
  it("logs a load that loaded nothing as yt_preload_error, the event the dead-video scan reads", async () => {
    await setupPlayingRound();
    act(() =>
      onStartStallHandlers[0]?.({
        state: 3,
        loadedFraction: 0,
        retried: true,
        videoId: "vid1aaaaaaa",
      }),
    );
    const scanned = telemetry.log.mock.calls.filter((c) =>
      /^yt_(player|preload)_error$/.test(String(c[1])),
    );
    expect(scanned).toEqual([
      [
        "warn",
        "yt_preload_error",
        {
          code: "no_bytes",
          game_code: "ABCDEF",
          youtube_id: "vid1aaaaaaa",
          url: "https://www.youtube.com/watch?v=vid1aaaaaaa",
          song_id: "song-1",
          title: "First",
          artist: "A",
          stall: "no_bytes",
        },
      ],
    ]);
  });

  it("does not report a slow load that has bytes, or a stalled retry, to the dead-video scan", async () => {
    await setupPlayingRound();
    act(() =>
      onStartStallHandlers[0]?.({
        state: 3,
        loadedFraction: 0.2,
        retried: false,
        videoId: "vid1aaaaaaa",
      }),
    );
    act(() =>
      onStartStallHandlers[0]?.({
        state: -1,
        loadedFraction: 0,
        retried: false,
        videoId: "vid1aaaaaaa",
      }),
    );
    expect(telemetry.log).toHaveBeenCalledWith("warn", "yt_live_stall", expect.anything());
    expect(telemetry.log).not.toHaveBeenCalledWith("warn", "yt_preload_error", expect.anything());
  });

  it("logs an early pause with its song", async () => {
    await setupPlayingRound();
    act(() => onEarlyPauseHandlers[0]?.(300));
    expect(telemetry.log).toHaveBeenCalledWith("warn", "yt_live_stall", {
      kind: "early_pause",
      game_code: "ABCDEF",
      ms_after_start: "300",
      youtube_id: "vid1aaaaaaa",
      song_id: "song-1",
      title: "First",
      artist: "A",
    });
  });

  it("logs the failing live song's name and URL when the video errors", async () => {
    await setupPlayingRound();

    act(() => {
      onErrorHandlers[0]?.(150, "vid1aaaaaaa");
    });

    expect(telemetry.log).toHaveBeenCalledWith("warn", "yt_player_error", {
      code: "150",
      game_code: "ABCDEF",
      youtube_id: "vid1aaaaaaa",
      url: "https://www.youtube.com/watch?v=vid1aaaaaaa",
      song_id: "song-1",
      title: "First",
      artist: "A",
    });
    expect(await screen.findByText(/video unavailable/i)).toBeInTheDocument();
  });

  it("names the new song when its in-tap load errors before the round is recorded", async () => {
    await peekSong2();
    vi.mocked(selectNextSongDirect).mockReturnValueOnce(new Promise<SelectSongResponse>(() => {}));
    act(() => {
      fireEvent.click(screen.getByTestId("start-round"));
    });
    act(() => {
      onErrorHandlers[0]?.(101, "vid2bbbbbbb");
    });
    expect(telemetry.log).toHaveBeenCalledWith("warn", "yt_player_error", {
      code: "101",
      game_code: "ABCDEF",
      youtube_id: "vid2bbbbbbb",
      url: "https://www.youtube.com/watch?v=vid2bbbbbbb",
      song_id: "song-2",
      title: "Song Two",
      artist: "Artist Two",
    });
  });

  it("keeps an error from the empty player on the waiting screen silent, and Start game still plays", async () => {
    // YouTube's empty embed sometimes raises its generic "An error occurred"
    // (code 2) on the waiting screen, before any video was loaded into it. No
    // song failed, so there is nothing to tell the host: no toast, a log event
    // of its own with no song attached, and Start game still loads the peeked
    // first song.
    setHydrate({
      game: makeActiveGame({ status: "waiting", round_number: 0 }),
      teams: [],
      rounds: [],
    });
    vi.mocked(peekNextSongDirect).mockResolvedValueOnce({
      song_id: "song-1",
      youtube_id: "vid1aaaaaaa",
      start_time: 12,
      title: "Song One",
      artist: "Artist One",
      is_soundtrack: false,
      release_year: null,
    });
    vi.mocked(selectNextSongDirect).mockResolvedValueOnce({
      round_id: "r1",
      round_number: 1,
      song: {
        id: "song-1",
        title: "First",
        artist: "A",
        youtube_id: "vid1aaaaaaa",
        start_time: 12,
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
    await waitFor(() => expect(peekNextSongDirect).toHaveBeenCalledWith("ABCDEF", TOKEN));

    // The player has never been given a video when it errors.
    act(() => {
      onErrorHandlers[0]?.(2, null);
    });

    expect(telemetry.log).toHaveBeenCalledWith("warn", "yt_idle_player_error", {
      code: "2",
      game_code: "ABCDEF",
    });
    expect(telemetry.log).not.toHaveBeenCalledWith("warn", "yt_player_error", expect.anything());
    expect(screen.queryByText(/video unavailable/i)).toBeNull();

    const startBtn = screen.getByRole("button", { name: /start game/i });
    await waitFor(() => expect(startBtn).toBeEnabled());
    fireEvent.click(startBtn);
    expect(handle(0).loadVideoById).toHaveBeenCalledWith("vid1aaaaaaa", 12);
    await waitFor(() =>
      expect(selectNextSongDirect).toHaveBeenCalledWith("ABCDEF", TOKEN, "song-1"),
    );
    expect(screen.queryByText(/video unavailable/i)).toBeNull();
  });

  it("labels the empty player after the Start button: loading, then ready to start", async () => {
    setHydrate({
      game: makeActiveGame({ status: "waiting", round_number: 0 }),
      teams: [],
      rounds: [],
    });
    renderConsole();
    await act(async () => {
      await fireSubscribed();
    });
    expect(idleLabels[0]).toBe("Loading player…");
    act(() => {
      onReadyHandler?.();
    });
    await waitFor(() => expect(idleLabels[0]).toBe("Ready — press Start game"));
  });

  it("labels an empty player mid-game as loading the song", async () => {
    // A host who reloads mid-round gets a fresh, empty player until the
    // current song is loaded back in.
    await setupPlayingRound();
    expect(idleLabels[0]).toBe("Loading song…");
  });

  it("renders the peeked song's metadata in-gesture on the in-tap path (I-NextMeta)", async () => {
    await setupPlayingRound();
    // The card starts on the current round's song ("First").
    expect(screen.getByText("First")).toBeInTheDocument();

    vi.mocked(peekNextSongDirect).mockResolvedValueOnce({
      ...SONG2,
      title: "Peeked Title",
      artist: "Peeked Artist",
      release_year: 1999,
    });
    // Freeze select_next_song so the card stays at its in-gesture state (the
    // peeked metadata) and the RPC's authoritative reconciliation never runs.
    vi.mocked(selectNextSongDirect).mockReturnValueOnce(new Promise<SelectSongResponse>(() => {}));

    await act(async () => {
      onPlayingHandlers[0]?.("statechange");
    });
    await waitFor(() => expect(peekNextSongDirect).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });

    // Tapping Next round updates the card to the new song's title/artist
    // immediately, from the peeked row (mig 038) — BEFORE select_next_song
    // resolves. Previously the card kept showing the previous song's name.
    await act(async () => {
      fireEvent.click(screen.getByTestId("start-round"));
    });
    expect(screen.getByText("Peeked Title")).toBeInTheDocument();
    expect(screen.getByText("Peeked Artist")).toBeInTheDocument();
    expect(screen.queryByText("First")).not.toBeInTheDocument();
    // The peeked year (mig 050) arrives with the card, not a round-trip later.
    expect(screen.getByTestId("song-year")).toHaveTextContent("1999");
  });

  it("falls back to a random pick when the pool is empty at peek time", async () => {
    await setupPlayingRound();
    // Peek returns null -> no song known in advance.
    vi.mocked(peekNextSongDirect).mockResolvedValueOnce(null);
    vi.mocked(selectNextSongDirect).mockResolvedValueOnce({
      round_id: "r2",
      round_number: 2,
      song: {
        id: "song-2",
        title: "Second",
        artist: "B",
        youtube_id: "vid2bbbbbbb",
        start_time: 0,
        is_soundtrack: false,
      },
    });

    await act(async () => {
      onPlayingHandlers[0]?.("statechange");
    });
    await waitFor(() => expect(peekNextSongDirect).toHaveBeenCalled());
    const loadsBefore = handle(0).loadVideoById.mock.calls.length;

    // Next round uses the 2-arg random pick (no songId); the load waits for it.
    fireEvent.click(screen.getByTestId("start-round"));
    expect(handle(0).loadVideoById).toHaveBeenCalledTimes(loadsBefore);
    await waitFor(() => expect(selectNextSongDirect).toHaveBeenCalledWith("ABCDEF", TOKEN));
    await waitFor(() => expect(handle(0).loadVideoById).toHaveBeenLastCalledWith("vid2bbbbbbb", 0));
    await waitFor(() =>
      expect(telemetry.handle.rpcDone).toHaveBeenCalledWith(
        expect.objectContaining({ preloaded: false }),
      ),
    );
  });

  it("holds the next peek until select_next_song has recorded the new round", async () => {
    // The picker (mig 049) never repeats the genre playing now, so it must see
    // the new round. The new song can reach PLAYING while the select call is
    // still in flight; the peek has to wait for it to resolve.
    await setupPlayingRound();
    vi.mocked(peekNextSongDirect).mockResolvedValueOnce(SONG2).mockResolvedValueOnce(null);
    let resolveSelect: (value: Awaited<ReturnType<typeof selectNextSongDirect>>) => void = () => {};
    vi.mocked(selectNextSongDirect).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSelect = resolve;
      }),
    );

    await act(async () => {
      onPlayingHandlers[0]?.("statechange");
    });
    await waitFor(() => expect(peekNextSongDirect).toHaveBeenCalledTimes(1));
    await act(async () => {
      await Promise.resolve();
    });

    fireEvent.click(screen.getByTestId("start-round"));
    expect(handle(0).loadVideoById).toHaveBeenLastCalledWith("vid2bbbbbbb", 30);
    await act(async () => {
      onPlayingHandlers[0]?.("statechange");
    });
    expect(peekNextSongDirect).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveSelect({ round_id: "r2", round_number: 2, song: SONG2_ROW });
    });
    await waitFor(() => expect(peekNextSongDirect).toHaveBeenCalledTimes(2));
  });

  it("peeks after a random-pick Next round only once the new song is playing", async () => {
    await setupPlayingRound();
    vi.mocked(peekNextSongDirect).mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    vi.mocked(selectNextSongDirect).mockResolvedValueOnce({
      round_id: "r2",
      round_number: 2,
      song: {
        id: "song-2",
        title: "Second",
        artist: "B",
        youtube_id: "vid2bbbbbbb",
        start_time: 0,
        is_soundtrack: false,
      },
    });

    await act(async () => {
      onPlayingHandlers[0]?.("statechange");
    });
    await waitFor(() => expect(peekNextSongDirect).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByTestId("start-round"));
    await waitFor(() => expect(handle(0).loadVideoById).toHaveBeenCalledWith("vid2bbbbbbb", 0));
    await act(async () => {});
    expect(peekNextSongDirect).toHaveBeenCalledTimes(1);

    await act(async () => {
      onPlayingHandlers[0]?.("statechange");
    });
    await waitFor(() => expect(peekNextSongDirect).toHaveBeenCalledTimes(2));
  });

  // Round 1 from the waiting screen: the first song is peeked there, and Start
  // game loads it inside the tap.
  async function waitingWithPeekedFirstSong() {
    setHydrate({
      game: makeActiveGame({ status: "waiting", round_number: 0 }),
      teams: [],
      rounds: [],
    });
    vi.mocked(peekNextSongDirect).mockResolvedValueOnce({
      song_id: "song-1",
      youtube_id: "vid1aaaaaaa",
      start_time: 12,
      title: "Song One",
      artist: "Artist One",
      is_soundtrack: false,
      release_year: null,
    });
    renderConsole();
    await act(async () => {
      await fireSubscribed();
    });
    act(() => {
      onReadyHandler?.();
    });
    await waitFor(() => expect(peekNextSongDirect).toHaveBeenCalledWith("ABCDEF", TOKEN));
    // Peeking needs no player: nothing is loaded before the tap.
    expect(handle(0).loadVideoById).not.toHaveBeenCalled();
    const startBtn = screen.getByRole("button", { name: /start game/i });
    await waitFor(() => expect(startBtn).toBeEnabled());
    return startBtn;
  }

  it("peeks the first song during 'waiting' and loads it in-gesture on Start game", async () => {
    // Regression for the mobile bug: the first song was loaded only AFTER
    // select_next_song resolved (post-await), so mobile blocked its autoplay and
    // round 1 stayed silent until a stray buzz + Continue. The first song is
    // now peeked during the waiting screen, and Start game loads it
    // synchronously inside the tap via the exact peeked song id.
    const startBtn = await waitingWithPeekedFirstSong();
    vi.mocked(selectNextSongDirect).mockResolvedValueOnce({
      round_id: "r1",
      round_number: 1,
      song: {
        id: "song-1",
        title: "First",
        artist: "A",
        youtube_id: "vid1aaaaaaa",
        start_time: 12,
        is_soundtrack: false,
      },
    });
    fireEvent.click(startBtn);
    // Synchronously in the click, before the RPC await.
    expect(handle(0).loadVideoById).toHaveBeenCalledTimes(1);
    expect(handle(0).loadVideoById).toHaveBeenCalledWith("vid1aaaaaaa", 12);
    expect(selectNextSongDirect).toHaveBeenCalledWith("ABCDEF", TOKEN, "song-1");
    await waitFor(() =>
      expect(telemetry.handle.rpcDone).toHaveBeenCalledWith(
        expect.objectContaining({ preloaded: false, songId: "song-1" }),
      ),
    );
  });

  it("a failed Start game silences the player again and keeps the peeked song", async () => {
    const startBtn = await waitingWithPeekedFirstSong();
    const { RpcError } = await import("../hooks/useManagerActions");
    vi.mocked(selectNextSongDirect).mockRejectedValueOnce(new RpcError("network down"));
    fireEvent.click(startBtn);
    await waitFor(() => expect(screen.getByText(/network down/i)).toBeInTheDocument());
    expect(handle(0).loadVideoById).toHaveBeenCalledTimes(1);
    expect(handle(0).stop).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Song One")).not.toBeInTheDocument();
    // The round never advanced, so no new peek: the same song is still next.
    expect(peekNextSongDirect).toHaveBeenCalledTimes(1);
  });

  it("rolls the in-tap start back when select_next_song fails (T4.5)", async () => {
    // If we begin loading the peeked song in-gesture but the round fails to
    // advance server-side, it must not stand: the player is stopped, the song
    // card returns to the still-current round, and that round's song is
    // reloaded so the room isn't silent.
    await peekSong2();
    const { RpcError } = await import("../hooks/useManagerActions");
    vi.mocked(selectNextSongDirect).mockRejectedValueOnce(new RpcError("network down"));
    // Isolate the rollback's reload from the setup-time first-song load.
    handle(0).loadVideoById.mockClear();

    fireEvent.click(screen.getByTestId("start-round"));
    await waitFor(() => expect(screen.getByText(/network down/i)).toBeInTheDocument());
    expect(handle(0).stop).toHaveBeenCalledTimes(1);
    expect(handle(0).loadVideoById.mock.calls).toEqual([
      ["vid2bbbbbbb", 30],
      ["vid1aaaaaaa", 0],
    ]);
    // ...and the card shows it again instead of the peeked next song.
    expect(screen.getByText("First")).toBeInTheDocument();
    expect(screen.queryByText("Song Two")).not.toBeInTheDocument();
    expect(peekNextSongDirect).toHaveBeenCalledTimes(1);
  });

  it("a retry after a failed Next round keeps the in-tap path with the same peeked song", async () => {
    await peekSong2();
    const { RpcError } = await import("../hooks/useManagerActions");
    vi.mocked(selectNextSongDirect)
      .mockRejectedValueOnce(new RpcError("network down"))
      .mockResolvedValueOnce({ round_id: "r2", round_number: 2, song: SONG2_ROW });

    // First click fails and rolls back (restoring the peeked song)...
    fireEvent.click(screen.getByTestId("start-round"));
    await waitFor(() => expect(screen.getByText(/network down/i)).toBeInTheDocument());
    // ...so the retry loads the SAME song in-gesture again.
    handle(0).loadVideoById.mockClear();
    fireEvent.click(screen.getByTestId("start-round"));
    expect(handle(0).loadVideoById).toHaveBeenCalledWith("vid2bbbbbbb", 30);
    await waitFor(() => expect(selectNextSongDirect).toHaveBeenCalledTimes(2));
    expect(selectNextSongDirect).toHaveBeenNthCalledWith(1, "ABCDEF", TOKEN, "song-2");
    expect(selectNextSongDirect).toHaveBeenNthCalledWith(2, "ABCDEF", TOKEN, "song-2");
    await waitFor(() =>
      expect(telemetry.handle.rpcDone).toHaveBeenCalledWith(
        expect.objectContaining({ songId: "song-2" }),
      ),
    );
  });

  describe("expiry countdown + extend (T4.8)", () => {
    // Pin the server-offset clock so expires_at values relative to
    // 2026-05-05T12:00Z are deterministic regardless of the real clock. The
    // observation is first-wins, so the later fireGame payloads (same default
    // commit_timestamp) don't re-pin it.
    beforeEach(() => {
      _resetServerTime();
      observeServerTime("2026-05-05T12:00:00.000Z");
    });
    afterEach(() => {
      _resetServerTime();
    });

    it("shows no expiry UI at all while expiry is far off", async () => {
      setHydrate({ game: makeActiveGame({ status: "waiting" }), teams: [], rounds: [] });
      renderConsole();
      await act(async () => {
        await fireSubscribed();
      });
      expect(screen.queryByTestId("expiry-hint")).not.toBeInTheDocument();
      expect(screen.queryByTestId("expiry-banner")).not.toBeInTheDocument();
    });

    it("Keep playing calls extend_game, stays disabled until the Realtime bump, then the banner clears", async () => {
      const nearExpiryGame = makeActiveGame({
        status: "playing",
        round_number: 1,
        expires_at: "2026-05-05T12:10:00.000Z", // 10 min left on the pinned clock
      });
      setHydrate({ game: nearExpiryGame, teams: [], rounds: [] });
      vi.mocked(extendGameDirect).mockResolvedValueOnce("2026-05-05T13:10:00+00:00");
      renderConsole();
      await act(async () => {
        await fireSubscribed();
      });

      expect(screen.getByTestId("expiry-banner")).toHaveTextContent(/game expires in/i);

      fireEvent.click(screen.getByTestId("extend-game"));
      // The pending flag is keyed on the clicked expires_at, so the button
      // stays disabled across the RPC -> Realtime gap (no double-extend).
      expect(screen.getByTestId("extend-game")).toBeDisabled();
      await waitFor(() => expect(extendGameDirect).toHaveBeenCalledWith("ABCDEF", TOKEN));
      await waitFor(() => expect(screen.getByText(/game extended/i)).toBeInTheDocument());
      expect(screen.getByTestId("extend-game")).toBeDisabled();

      // The Realtime UPDATE with the bumped expires_at clears the banner
      // (70 min left on the pinned clock — back outside the warning window).
      act(() => {
        fireGame(
          makePayload<ActiveGame>("active_games", "UPDATE", {
            new: { ...nearExpiryGame, expires_at: "2026-05-05T13:10:00.000Z" },
          }),
        );
      });
      await waitFor(() => expect(screen.queryByTestId("expiry-banner")).not.toBeInTheDocument());
      expect(screen.queryByTestId("expiry-hint")).not.toBeInTheDocument();
    });

    it("re-enables Keep playing and surfaces an error toast when extend_game fails", async () => {
      setHydrate({
        game: makeActiveGame({
          status: "playing",
          round_number: 1,
          expires_at: "2026-05-05T12:10:00.000Z",
        }),
        teams: [],
        rounds: [],
      });
      const { RpcError } = await import("../hooks/useManagerActions");
      vi.mocked(extendGameDirect).mockRejectedValueOnce(
        new RpcError("manager_token_required", "28000"),
      );
      renderConsole();
      await act(async () => {
        await fireSubscribed();
      });

      fireEvent.click(screen.getByTestId("extend-game"));
      await waitFor(() => expect(screen.getByText(/manager_token_required/i)).toBeInTheDocument());
      expect(screen.getByTestId("extend-game")).toBeEnabled();
    });
  });

  describe("host recovery link (T4.10)", () => {
    // Real tokens are gen_random_uuid(); the recovery hash only accepts the
    // UUID shape, so these tests use one instead of the short TOKEN stub.
    const RECOVERY_UUID = "b3b8c9d0-1234-4abc-9def-0123456789ab";

    // Mirrors what the router shows in the address bar so the tests can
    // assert the token fragment was scrubbed after adoption.
    function LocationProbe() {
      const { hash } = useLocation();
      return <div data-testid="location-hash">{hash}</div>;
    }

    function renderConsoleWithHash(hash: string) {
      return render(
        <MemoryRouter initialEntries={[`/manager/game/ABCDEF${hash}`]}>
          <ToastProvider>
            <Routes>
              <Route path="/" element={<div>home page</div>} />
              <Route
                path="/manager/game/:gameCode"
                element={
                  <>
                    <ManagerConsolePage />
                    <LocationProbe />
                  </>
                }
              />
            </Routes>
          </ToastProvider>
        </MemoryRouter>,
      );
    }

    it("adopts the token from a #mt= recovery hash and scrubs it from the URL", async () => {
      window.localStorage.clear();
      renderConsoleWithHash(`#mt=${RECOVERY_UUID}`);

      // The console accepted the credential on the very first render: no
      // "not the host" screen, straight to connecting.
      expect(screen.queryByText(/you're not the host/i)).not.toBeInTheDocument();
      expect(screen.getByText(/connecting to game/i)).toBeInTheDocument();
      // Persisted for future plain visits...
      expect(getManagerToken("ABCDEF")).toBe(RECOVERY_UUID);
      // ...and the fragment replaced out of the address bar.
      await waitFor(() => expect(screen.getByTestId("location-hash").textContent).toBe(""));
    });

    it("ignores a malformed recovery hash and stores nothing", () => {
      window.localStorage.clear();
      renderConsoleWithHash("#mt=not-a-uuid");

      expect(screen.getByText(/you're not the host of this game/i)).toBeInTheDocument();
      expect(getManagerToken("ABCDEF")).toBeNull();
      // No scrub navigation for a hash we didn't consume.
      expect(screen.getByTestId("location-hash").textContent).toBe("#mt=not-a-uuid");
    });

    it("ignores the recovery hash when a token is already stored (no clobber), but still scrubs it", async () => {
      // beforeEach stored TOKEN. Recovery is for tokenless devices: if the
      // hash won here, any guest who knows the game code could craft a
      // well-formed #mt= link that silently replaces the host's working
      // credential and locks them out of their own game.
      renderConsoleWithHash(`#mt=${RECOVERY_UUID}`);
      expect(getManagerToken("ABCDEF")).toBe(TOKEN);
      // The tokened fragment still shouldn't linger in the address bar.
      await waitFor(() => expect(screen.getByTestId("location-hash").textContent).toBe(""));
    });

    it("keeps the adopted session alive across the scrub when localStorage writes are blocked", async () => {
      // Private-mode / storage-blocked browsers: setItem throws, so the
      // adopted token never persists. The session must survive on the
      // in-memory copy instead of bouncing to "not the host" after the
      // scrub navigation re-runs the token lookup.
      window.localStorage.clear();
      // Spy on the Storage PROTOTYPE: jsdom's named-setter semantics turn a
      // direct `localStorage.setItem = ...` assignment into a stored item
      // instead of a method override, so an instance-level spy never fires.
      const storageProto = Object.getPrototypeOf(window.localStorage) as {
        setItem: (key: string, value: string) => void;
      };
      const setItemSpy = vi.spyOn(storageProto, "setItem").mockImplementation(() => {
        throw new Error("storage blocked");
      });
      try {
        renderConsoleWithHash(`#mt=${RECOVERY_UUID}`);
        expect(screen.getByText(/connecting to game/i)).toBeInTheDocument();
        // Wait for the scrub navigation to land...
        await waitFor(() => expect(screen.getByTestId("location-hash").textContent).toBe(""));
        // ...and the console is still authenticated from the in-memory copy.
        expect(screen.queryByText(/you're not the host/i)).not.toBeInTheDocument();
        expect(screen.getByText(/connecting to game/i)).toBeInTheDocument();
        expect(getManagerToken("ABCDEF")).toBeNull();
      } finally {
        setItemSpy.mockRestore();
      }
    });

    it("offers the backup host link with the tokened URL from the console", async () => {
      setHydrate({ game: makeActiveGame({ status: "waiting" }), teams: [], rounds: [] });
      renderConsole();
      await act(async () => {
        await fireSubscribed();
      });

      const toggle = screen.getByTestId("host-link-toggle");
      expect(screen.queryByTestId("host-link-panel")).not.toBeInTheDocument();
      fireEvent.click(toggle);
      expect(screen.getByTestId("host-link-url")).toHaveTextContent(
        `/manager/game/ABCDEF#mt=${TOKEN}`,
      );
    });
  });
});
