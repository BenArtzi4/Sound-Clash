import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/supabase", async () => {
  const mod = await import("../test/supabaseMock");
  return { supabase: mod.supabaseMock };
});

import { _resetServerTime } from "./useServerTime";
import type { ActiveGame, GameRound, Team } from "../lib/types";
import {
  gameReducer,
  LOCKED_RESYNC_INTERVAL_MS,
  MAX_PENDING_EVENTS,
  RESYNC_INTERVAL_MS,
  useGameChannel,
} from "./useGameChannel";
import {
  channelMock,
  fireGame,
  fireRound,
  fireStatus,
  fireSubscribed,
  fireTeam,
  makeActiveGame,
  makePayload,
  makeRound,
  makeTeam,
  resetSupabaseMock,
  setHydrate,
  setHydrateError,
  supabaseMock,
} from "../test/supabaseMock";

beforeEach(() => {
  resetSupabaseMock();
  _resetServerTime();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("gameReducer", () => {
  it("HYDRATE builds initial state with sorted rounds and current round", () => {
    const game = makeActiveGame({ current_round_id: "r1" });
    const next = gameReducer(null, {
      type: "HYDRATE",
      game,
      teams: [makeTeam({ id: "t1" })],
      rounds: [makeRound({ id: "r2", round_number: 2 }), makeRound({ id: "r1", round_number: 1 })],
    });
    expect(next?.game).toBe(game);
    expect(next?.teams.get("t1")?.id).toBe("t1");
    expect(next?.rounds.map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(next?.currentRound?.id).toBe("r1");
  });

  it("HYDRATE returns the same state reference when nothing changed (skips re-render cascade)", () => {
    const game = makeActiveGame({ current_round_id: "r1" });
    const team = makeTeam({ id: "t1", score: 10 });
    const round = makeRound({ id: "r1", round_number: 1 });
    const start = gameReducer(null, {
      type: "HYDRATE",
      game,
      teams: [team],
      rounds: [round],
    });
    // Same wire data, fresh object identities (mirrors what PostgREST returns
    // on a backstop poll when no events have happened in the last 20s).
    const repeat = gameReducer(start, {
      type: "HYDRATE",
      game: { ...game },
      teams: [{ ...team }],
      rounds: [{ ...round }],
    });
    expect(repeat).toBe(start);
  });

  it("HYDRATE returns a new state reference when a team's score changed", () => {
    const game = makeActiveGame({ current_round_id: "r1" });
    const team = makeTeam({ id: "t1", score: 10 });
    const round = makeRound({ id: "r1", round_number: 1 });
    const start = gameReducer(null, {
      type: "HYDRATE",
      game,
      teams: [team],
      rounds: [round],
    });
    const next = gameReducer(start, {
      type: "HYDRATE",
      game,
      teams: [{ ...team, score: 20 }],
      rounds: [round],
    });
    expect(next).not.toBe(start);
    expect(next?.teams.get("t1")?.score).toBe(20);
  });

  it.each([
    ["game_code", { game_code: "DIFFERENT" }],
    ["status", { status: "playing" as const }],
    ["round_number", { round_number: 5 }],
    ["current_round_id", { current_round_id: "different-round" }],
    ["buzzed_team_id", { buzzed_team_id: "different-team" }],
    ["locked_at", { locked_at: "2026-05-15T12:00:00Z" }],
    ["ended_at", { ended_at: "2026-05-15T13:00:00Z" }],
    ["current_song_id", { current_song_id: "different-song" }],
    ["started_at", { started_at: "2099-01-01T00:00:00Z" }],
    ["expires_at", { expires_at: "2099-01-01T04:00:00Z" }],
  ])("HYDRATE re-dispatches when ActiveGame.%s changes", (_field, override) => {
    const game = makeActiveGame({ current_round_id: "r1" });
    const round = makeRound({ id: "r1", round_number: 1 });
    const start = gameReducer(null, {
      type: "HYDRATE",
      game,
      teams: [],
      rounds: [round],
    });
    const next = gameReducer(start, {
      type: "HYDRATE",
      game: { ...game, ...override },
      teams: [],
      rounds: [round],
    });
    expect(next).not.toBe(start);
  });

  it("HYDRATE re-dispatches when selected_genres differ in length", () => {
    const game = makeActiveGame({ selected_genres: ["rock"] });
    const start = gameReducer(null, {
      type: "HYDRATE",
      game,
      teams: [],
      rounds: [],
    });
    const next = gameReducer(start, {
      type: "HYDRATE",
      game: { ...game, selected_genres: ["rock", "pop"] },
      teams: [],
      rounds: [],
    });
    expect(next).not.toBe(start);
  });

  it("HYDRATE re-dispatches when selected_genres differ in content", () => {
    const game = makeActiveGame({ selected_genres: ["rock"] });
    const start = gameReducer(null, {
      type: "HYDRATE",
      game,
      teams: [],
      rounds: [],
    });
    const next = gameReducer(start, {
      type: "HYDRATE",
      game: { ...game, selected_genres: ["pop"] },
      teams: [],
      rounds: [],
    });
    expect(next).not.toBe(start);
  });

  it("HYDRATE re-dispatches when the number of teams changes", () => {
    const game = makeActiveGame();
    const start = gameReducer(null, {
      type: "HYDRATE",
      game,
      teams: [makeTeam({ id: "t1" })],
      rounds: [],
    });
    const next = gameReducer(start, {
      type: "HYDRATE",
      game,
      teams: [makeTeam({ id: "t1" }), makeTeam({ id: "t2" })],
      rounds: [],
    });
    expect(next).not.toBe(start);
  });

  it.each([
    ["name", { name: "Renamed" }],
    ["joined_at", { joined_at: "2099-01-01T00:00:00Z" }],
  ])("HYDRATE re-dispatches when team.%s changes", (_field, override) => {
    const game = makeActiveGame();
    const team = makeTeam({ id: "t1" });
    const start = gameReducer(null, {
      type: "HYDRATE",
      game,
      teams: [team],
      rounds: [],
    });
    const next = gameReducer(start, {
      type: "HYDRATE",
      game,
      teams: [{ ...team, ...override }],
      rounds: [],
    });
    expect(next).not.toBe(start);
  });

  it("HYDRATE re-dispatches when a team id is replaced (same count, different members)", () => {
    const game = makeActiveGame();
    const start = gameReducer(null, {
      type: "HYDRATE",
      game,
      teams: [makeTeam({ id: "t1" })],
      rounds: [],
    });
    const next = gameReducer(start, {
      type: "HYDRATE",
      game,
      teams: [makeTeam({ id: "t2" })],
      rounds: [],
    });
    expect(next).not.toBe(start);
  });

  it("HYDRATE re-dispatches when the number of rounds changes", () => {
    const game = makeActiveGame();
    const start = gameReducer(null, {
      type: "HYDRATE",
      game,
      teams: [],
      rounds: [makeRound({ id: "r1", round_number: 1 })],
    });
    const next = gameReducer(start, {
      type: "HYDRATE",
      game,
      teams: [],
      rounds: [makeRound({ id: "r1", round_number: 1 }), makeRound({ id: "r2", round_number: 2 })],
    });
    expect(next).not.toBe(start);
  });

  it.each([
    ["ended_at", { ended_at: "2026-05-15T12:01:00Z" }],
    ["title_claimed_by", { title_claimed_by: "team-x" }],
    ["artist_claimed_by", { artist_claimed_by: "team-x" }],
    ["buzzed_team_id", { buzzed_team_id: "team-x" }],
    ["song_id", { song_id: "song-x" }],
    ["free_guess_active", { free_guess_active: true }],
    ["started_at", { started_at: "2099-01-01T00:00:00Z" }],
    ["title_points", { title_points: 99 }],
    ["artist_points", { artist_points: 99 }],
    ["wrong_buzz_penalty", { wrong_buzz_penalty: -99 }],
  ])("HYDRATE re-dispatches when round.%s changes", (_field, override) => {
    const game = makeActiveGame({ current_round_id: "r1" });
    const round = makeRound({ id: "r1", round_number: 1 });
    const start = gameReducer(null, {
      type: "HYDRATE",
      game,
      teams: [],
      rounds: [round],
    });
    const next = gameReducer(start, {
      type: "HYDRATE",
      game,
      teams: [],
      rounds: [{ ...round, ...override }],
    });
    expect(next).not.toBe(start);
  });

  it("GAME_CHANGE UPDATE replaces game and recomputes currentRound", () => {
    const round = makeRound({ id: "r1" });
    const start = gameReducer(null, {
      type: "HYDRATE",
      game: makeActiveGame(),
      teams: [],
      rounds: [round],
    });
    const updated = makeActiveGame({
      status: "playing",
      current_round_id: "r1",
    });
    const next = gameReducer(start, {
      type: "GAME_CHANGE",
      payload: makePayload("active_games", "UPDATE", { new: updated }),
    });
    expect(next?.game.status).toBe("playing");
    expect(next?.currentRound?.id).toBe("r1");
  });

  it("GAME_CHANGE UPDATE carries a bumped expires_at into state (extend_game path)", () => {
    // After the manager's "Keep playing +1h" fires extend_game, the only thing
    // that moves the expiry warning back out of the window is the Realtime
    // UPDATE on active_games with the new expires_at. Assert that update flows
    // through the reducer so the ExpiryCountdown re-reads a later deadline.
    const start = gameReducer(null, {
      type: "HYDRATE",
      game: makeActiveGame({ status: "playing", expires_at: "2026-05-05T12:10:00.000Z" }),
      teams: [],
      rounds: [],
    });
    const bumped = makeActiveGame({
      status: "playing",
      expires_at: "2026-05-05T13:10:00.000Z",
    });
    const next = gameReducer(start, {
      type: "GAME_CHANGE",
      payload: makePayload("active_games", "UPDATE", { new: bumped }),
    });
    expect(next?.game.expires_at).toBe("2026-05-05T13:10:00.000Z");
  });

  it("GAME_CHANGE DELETE returns null", () => {
    const start = gameReducer(null, {
      type: "HYDRATE",
      game: makeActiveGame(),
      teams: [],
      rounds: [],
    });
    const next = gameReducer(start, {
      type: "GAME_CHANGE",
      payload: makePayload<ActiveGame>("active_games", "DELETE", {
        old: { game_code: "ABCDEF" },
      }),
    });
    expect(next).toBeNull();
  });

  it("TEAM_CHANGE INSERT adds, UPDATE replaces, DELETE removes", () => {
    const t1 = makeTeam({ id: "t1", name: "Alice", score: 0 });
    let state = gameReducer(null, {
      type: "HYDRATE",
      game: makeActiveGame(),
      teams: [],
      rounds: [],
    });
    state = gameReducer(state, {
      type: "TEAM_CHANGE",
      payload: makePayload("game_teams", "INSERT", { new: t1 }),
    });
    expect(state?.teams.get("t1")?.score).toBe(0);

    state = gameReducer(state, {
      type: "TEAM_CHANGE",
      payload: makePayload("game_teams", "UPDATE", {
        new: { ...t1, score: 15 },
      }),
    });
    expect(state?.teams.get("t1")?.score).toBe(15);

    state = gameReducer(state, {
      type: "TEAM_CHANGE",
      payload: makePayload<Team>("game_teams", "DELETE", {
        old: { id: "t1" },
      }),
    });
    expect(state?.teams.has("t1")).toBe(false);
  });

  it("TEAM_CHANGE DELETE without old.id is a no-op", () => {
    const start = gameReducer(null, {
      type: "HYDRATE",
      game: makeActiveGame(),
      teams: [makeTeam({ id: "t1" })],
      rounds: [],
    });
    const next = gameReducer(start, {
      type: "TEAM_CHANGE",
      payload: makePayload("game_teams", "DELETE", { old: {} }),
    });
    expect(next?.teams.has("t1")).toBe(true);
  });

  it("ROUND_CHANGE INSERT adds and sorts, UPDATE patches, DELETE removes", () => {
    // round_number 2 keeps both INSERTs below at-or-behind the game row, so
    // the round-advance derivation (#254, tested separately) stays out of
    // this test's add/sort/patch/remove mechanics.
    const game = makeActiveGame({ current_round_id: "r1", round_number: 2 });
    let state = gameReducer(null, {
      type: "HYDRATE",
      game,
      teams: [],
      rounds: [],
    });
    state = gameReducer(state, {
      type: "ROUND_CHANGE",
      payload: makePayload("game_rounds", "INSERT", {
        new: makeRound({ id: "r2", round_number: 2 }),
      }),
    });
    state = gameReducer(state, {
      type: "ROUND_CHANGE",
      payload: makePayload("game_rounds", "INSERT", {
        new: makeRound({ id: "r1", round_number: 1 }),
      }),
    });
    expect(state?.rounds.map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(state?.currentRound?.id).toBe("r1");

    state = gameReducer(state, {
      type: "ROUND_CHANGE",
      payload: makePayload("game_rounds", "UPDATE", {
        new: makeRound({
          id: "r1",
          round_number: 1,
          ended_at: "2026-05-05T12:01:00Z",
        }),
      }),
    });
    expect(state?.currentRound?.ended_at).toBe("2026-05-05T12:01:00Z");

    state = gameReducer(state, {
      type: "ROUND_CHANGE",
      payload: makePayload<GameRound>("game_rounds", "DELETE", {
        old: { id: "r1" },
      }),
    });
    expect(state?.rounds.find((r) => r.id === "r1")).toBeUndefined();
    expect(state?.currentRound).toBeNull();
  });

  it("ROUND_CHANGE DELETE with no id is a no-op", () => {
    const game = makeActiveGame();
    let state = gameReducer(null, {
      type: "HYDRATE",
      game,
      teams: [],
      rounds: [makeRound({ id: "r1", round_number: 1 })],
    });
    state = gameReducer(state, {
      type: "ROUND_CHANGE",
      payload: makePayload("game_rounds", "DELETE", { old: {} }),
    });
    expect(state?.rounds.length).toBe(1);
  });

  // The round-advance derivation (#254): start_round inserts the new round and
  // updates active_games in one transaction, so a round INSERT ahead of the
  // game row proves the game row moved — the reducer derives that transition
  // rather than depending on the (droppable) active_games UPDATE event.
  it("ROUND_CHANGE INSERT ahead of the game row derives the round-advance transition", () => {
    const start = gameReducer(null, {
      type: "HYDRATE",
      game: makeActiveGame({
        status: "playing",
        round_number: 4,
        current_round_id: "r4",
        current_song_id: "song-4",
        buzzed_team_id: "team-2",
        locked_at: "2026-05-05T12:01:00Z",
      }),
      teams: [],
      rounds: [makeRound({ id: "r4", round_number: 4, song_id: "song-4" })],
    });
    const next = gameReducer(start, {
      type: "ROUND_CHANGE",
      payload: makePayload("game_rounds", "INSERT", {
        new: makeRound({ id: "r5", round_number: 5, song_id: "song-5" }),
      }),
    });
    expect(next?.game.round_number).toBe(5);
    expect(next?.game.current_round_id).toBe("r5");
    expect(next?.game.current_song_id).toBe("song-5");
    expect(next?.game.buzzed_team_id).toBeNull();
    expect(next?.game.locked_at).toBeNull();
    expect(next?.currentRound?.id).toBe("r5");
  });

  it("ROUND_CHANGE INSERT of round 1 derives the waiting→playing start transition", () => {
    // The same derivation covers a dropped "Start game" UPDATE: the very first
    // round INSERT flips the stale waiting view to playing.
    const start = gameReducer(null, {
      type: "HYDRATE",
      game: makeActiveGame({ status: "waiting", round_number: 0 }),
      teams: [],
      rounds: [],
    });
    const next = gameReducer(start, {
      type: "ROUND_CHANGE",
      payload: makePayload("game_rounds", "INSERT", {
        new: makeRound({ id: "r1", round_number: 1, song_id: "song-1" }),
      }),
    });
    expect(next?.game.status).toBe("playing");
    expect(next?.game.round_number).toBe(1);
    expect(next?.game.current_round_id).toBe("r1");
    expect(next?.currentRound?.id).toBe("r1");
  });

  it("ROUND_CHANGE INSERT at or behind the game row never touches the game (a replayed INSERT cannot wipe a live buzz lock)", () => {
    // When the active_games UPDATE arrived first (the normal order is not
    // guaranteed) — or Realtime re-delivers the current round's INSERT — the
    // round is NOT ahead, and the derivation must no-op: re-nulling
    // buzzed_team_id here would destroy a live buzz lock mid-round.
    const game = makeActiveGame({
      status: "playing",
      round_number: 5,
      current_round_id: "r5",
      current_song_id: "song-5",
      buzzed_team_id: "team-3",
      locked_at: "2026-05-05T12:03:00Z",
    });
    const start = gameReducer(null, {
      type: "HYDRATE",
      game,
      teams: [],
      rounds: [makeRound({ id: "r4", round_number: 4, song_id: "song-4" })],
    });
    const next = gameReducer(start, {
      type: "ROUND_CHANGE",
      payload: makePayload("game_rounds", "INSERT", {
        new: makeRound({ id: "r5", round_number: 5, song_id: "song-5" }),
      }),
    });
    expect(next?.game).toBe(game);
    expect(next?.game.buzzed_team_id).toBe("team-3");
    // The INSERT itself still lands: the round is merged and becomes current.
    expect(next?.rounds.map((r) => r.id)).toEqual(["r4", "r5"]);
    expect(next?.currentRound?.id).toBe("r5");
  });

  it("idempotency: applying the same INSERT twice is a no-op", () => {
    let state = gameReducer(null, {
      type: "HYDRATE",
      game: makeActiveGame(),
      teams: [],
      rounds: [],
    });
    const round = makeRound({ id: "r1", round_number: 1 });
    state = gameReducer(state, {
      type: "ROUND_CHANGE",
      payload: makePayload("game_rounds", "INSERT", { new: round }),
    });
    const before = state?.rounds.length;
    state = gameReducer(state, {
      type: "ROUND_CHANGE",
      payload: makePayload("game_rounds", "INSERT", { new: round }),
    });
    expect(state?.rounds.length).toBe(before);
  });

  it("GAME_DELETED returns null", () => {
    expect(gameReducer(null, { type: "GAME_DELETED" })).toBeNull();
  });

  it("non-HYDRATE actions on null state return null", () => {
    expect(
      gameReducer(null, {
        type: "TEAM_CHANGE",
        payload: makePayload("game_teams", "INSERT", { new: makeTeam() }),
      }),
    ).toBeNull();
    expect(
      gameReducer(null, {
        type: "GAME_CHANGE",
        payload: makePayload("active_games", "UPDATE", {
          new: makeActiveGame(),
        }),
      }),
    ).toBeNull();
    expect(
      gameReducer(null, {
        type: "ROUND_CHANGE",
        payload: makePayload("game_rounds", "INSERT", { new: makeRound() }),
      }),
    ).toBeNull();
  });
});

describe("useGameChannel - subscription", () => {
  it("subscribes to all three tables with the right filter", () => {
    renderHook(() => useGameChannel("ABCDEF"));
    expect(supabaseMock.channel).toHaveBeenCalledWith("game:ABCDEF");
    expect(channelMock.on).toHaveBeenCalledTimes(3);
    const tables = channelMock.on.mock.calls.map(
      (c: unknown[]) => (c[1] as { table: string }).table,
    );
    expect(tables).toContain("active_games");
    expect(tables).toContain("game_teams");
    expect(tables).toContain("game_rounds");
    for (const call of channelMock.on.mock.calls) {
      const opts = call[1] as { filter: string };
      expect(opts.filter).toBe("game_code=eq.ABCDEF");
    }
  });

  it("fires the initial hydrate immediately on mount, before SUBSCRIBED", async () => {
    const game = makeActiveGame({ status: "playing" });
    const team = makeTeam({ id: "t1" });
    setHydrate({ game, teams: [team], rounds: [] });
    const { result } = renderHook(() => useGameChannel("ABCDEF"));

    // The initial hydrate runs on mount in parallel with the WebSocket
    // handshake: state is populated and the three state GETs have already
    // fired WITHOUT the Realtime SUBSCRIBED callback ever running (status is
    // still "connecting"). This is the time-to-BUZZ win.
    await waitFor(() => {
      expect(result.current.state?.teams.get("t1")?.id).toBe("t1");
    });
    expect(result.current.status).toBe("connecting");
    expect(supabaseMock.from.mock.calls.length).toBe(3);
  });

  it("re-hydrates on SUBSCRIBED after the immediate mount hydrate (gap coverage)", async () => {
    const game = makeActiveGame({ status: "playing" });
    setHydrate({ game, teams: [], rounds: [] });
    const { result } = renderHook(() => useGameChannel("ABCDEF"));

    // Immediate mount hydrate: one pass over the three ephemeral tables.
    await waitFor(() => expect(supabaseMock.from.mock.calls.length).toBe(3));

    // SUBSCRIBED fires a SECOND hydrate so nothing committed during the
    // handshake window is missed; total is now two passes = six table reads.
    await act(async () => {
      await fireSubscribed();
    });
    await waitFor(() => expect(result.current.status).toBe("subscribed"));
    expect(supabaseMock.from.mock.calls.length).toBe(6);
  });

  it("hydrates on SUBSCRIBED and applies events afterwards", async () => {
    const game = makeActiveGame({ status: "waiting" });
    const team = makeTeam({ id: "t1" });
    setHydrate({ game, teams: [team], rounds: [] });
    const { result } = renderHook(() => useGameChannel("ABCDEF"));
    await act(async () => {
      await fireSubscribed();
    });
    await waitFor(() => {
      expect(result.current.status).toBe("subscribed");
      expect(result.current.state?.teams.get("t1")?.id).toBe("t1");
    });
    act(() => {
      fireGame(
        makePayload("active_games", "UPDATE", {
          new: { ...game, status: "playing" },
        }),
      );
    });
    expect(result.current.state?.game.status).toBe("playing");
  });

  it("status flips to gone when the game row is deleted", async () => {
    const game = makeActiveGame();
    setHydrate({ game, teams: [], rounds: [] });
    const { result } = renderHook(() => useGameChannel("ABCDEF"));
    await act(async () => {
      await fireSubscribed();
    });
    act(() => {
      fireGame(
        makePayload<ActiveGame>("active_games", "DELETE", {
          old: { game_code: "ABCDEF" },
        }),
      );
    });
    await waitFor(() => expect(result.current.status).toBe("gone"));
  });

  it("tears down the resync interval + channel once the game is gone", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const game = makeActiveGame();
      setHydrate({ game, teams: [], rounds: [] });
      renderHook(() => useGameChannel("ABCDEF"));
      await act(async () => {
        await fireSubscribed();
      });
      const callsBeforeGone = supabaseMock.from.mock.calls.length;
      supabaseMock.removeChannel.mockClear();

      // Game row deleted -> status gone -> the live plumbing is torn down.
      act(() => {
        fireGame(
          makePayload<ActiveGame>("active_games", "DELETE", {
            old: { game_code: "ABCDEF" },
          }),
        );
      });
      expect(supabaseMock.removeChannel).toHaveBeenCalled();

      // Advancing well past the backstop interval must NOT trigger any further
      // hydrate: the interval was cleared on teardown, so an overnight display
      // on an ended game stops polling instead of hitting the DB forever.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(RESYNC_INTERVAL_MS * 2 + 1000);
      });
      expect(supabaseMock.from.mock.calls.length).toBe(callsBeforeGone);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stays 'gone' after teardown even when the channel then reports CLOSED", async () => {
    const game = makeActiveGame();
    setHydrate({ game, teams: [], rounds: [] });
    const { result } = renderHook(() => useGameChannel("ABCDEF"));
    await act(async () => {
      await fireSubscribed();
    });

    // Game deleted -> status "gone" + teardownLive() (which removeChannel()s).
    act(() => {
      fireGame(
        makePayload<ActiveGame>("active_games", "DELETE", {
          old: { game_code: "ABCDEF" },
        }),
      );
    });
    await waitFor(() => expect(result.current.status).toBe("gone"));

    // The real Supabase client fires a CLOSED channel-status callback when the
    // channel is removed. It must NOT flip "gone" back to "idle" — doing so
    // replaced the "game has ended" banner with a stuck "Connecting…" state for
    // every client of a swept game (regression from the teardown-on-gone change).
    await act(async () => {
      await fireStatus("CLOSED");
    });
    expect(result.current.status).toBe("gone");
  });

  it("flips to reconnecting on CHANNEL_ERROR", async () => {
    const { result } = renderHook(() => useGameChannel("ABCDEF"));
    await act(async () => {
      await fireStatus("CHANNEL_ERROR");
    });
    await waitFor(() => expect(result.current.status).toBe("reconnecting"));
  });

  it("flips to idle on CLOSED", async () => {
    const { result } = renderHook(() => useGameChannel("ABCDEF"));
    await act(async () => {
      await fireStatus("CLOSED");
    });
    await waitFor(() => expect(result.current.status).toBe("idle"));
  });

  it("removes channel on unmount", () => {
    const { unmount } = renderHook(() => useGameChannel("ABCDEF"));
    unmount();
    expect(supabaseMock.removeChannel).toHaveBeenCalled();
  });

  it("hydrate handles a missing game row by setting status gone", async () => {
    setHydrate({ game: null, teams: [], rounds: [] });
    const { result } = renderHook(() => useGameChannel("ABCDEF"));
    await act(async () => {
      await fireSubscribed();
    });
    await waitFor(() => expect(result.current.status).toBe("gone"));
  });

  it("queues Realtime events that arrive during hydration and replays them after HYDRATE", async () => {
    const game = makeActiveGame({ status: "waiting" });
    setHydrate({ game, teams: [], rounds: [] });
    const { result } = renderHook(() => useGameChannel("ABCDEF"));

    // Begin subscription handshake but don't await it yet; we want to
    // interleave a Realtime UPDATE before hydrate's SELECTs settle.
    const subPromise = fireSubscribed();

    // This UPDATE arrives while state is still null. Without queuing the
    // reducer's null guards drop it; with queuing it replays after HYDRATE.
    fireGame(
      makePayload("active_games", "UPDATE", {
        new: { ...game, status: "playing" },
      }),
    );

    await act(async () => {
      await subPromise;
    });

    await waitFor(() => {
      expect(result.current.state?.game.status).toBe("playing");
    });
  });

  it("keeps queuing after a failed hydrate and replays on the next successful one", async () => {
    const game = makeActiveGame({ status: "waiting" });
    setHydrate({ game, teams: [], rounds: [] });
    setHydrateError({ message: "fetch failed" });
    const { result } = renderHook(() => useGameChannel("ABCDEF"));

    // The SUBSCRIBED hydrate fails: the error surfaces but the event gate
    // must stay closed (state stays null, events keep queuing).
    await act(async () => {
      await fireSubscribed();
    });
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.state).toBeNull();

    // A live event lands while state is still null. The old behavior flipped
    // `hydrated` on the failure, so this dispatched against the reducer's
    // null guards and vanished until a manual refresh (F-P1-1).
    act(() => {
      fireGame(
        makePayload("active_games", "UPDATE", {
          new: { ...game, status: "playing" },
        }),
      );
    });
    expect(result.current.state).toBeNull();

    // The backend recovers and the next authoritative hydrate (re-SUBSCRIBED
    // after a reconnect) succeeds: the queued event drains on top of the
    // snapshot, and the stale error clears.
    setHydrateError(null);
    await act(async () => {
      await fireSubscribed();
    });
    await waitFor(() => expect(result.current.state?.game.status).toBe("playing"));
    expect(result.current.error).toBeNull();
  });

  it("resyncs instead of silently dropping when the pending queue overflows", async () => {
    const game = makeActiveGame({ status: "waiting" });
    setHydrate({ game, teams: [makeTeam({ id: "t1", score: 0 })], rounds: [] });
    setHydrateError({ message: "db down" });
    const { result } = renderHook(() => useGameChannel("ABCDEF"));
    await act(async () => {
      await fireSubscribed();
    });
    expect(result.current.state).toBeNull();

    // The DB recovers, but the next scheduled hydrate (60s backstop) hasn't
    // fired yet while live events flood past the queue cap.
    setHydrateError(null);
    const callsBefore = supabaseMock.from.mock.calls.length;
    await act(async () => {
      for (let i = 1; i <= MAX_PENDING_EVENTS + 1; i++) {
        fireTeam(
          makePayload("game_teams", "UPDATE", {
            new: makeTeam({ id: "t1", score: i }),
          }),
        );
      }
    });

    // Overflow triggered exactly one fresh hydrate (3 table reads) — not one
    // per overflowing event.
    expect(supabaseMock.from.mock.calls.length).toBe(callsBefore + 3);
    // Its snapshot plus the drained tail preserve the newest event: the final
    // score is the last update, not the snapshot's 0 and not silently stale.
    await waitFor(() => {
      expect(result.current.state?.teams.get("t1")?.score).toBe(MAX_PENDING_EVENTS + 1);
    });
    expect(result.current.error).toBeNull();
  });

  it("re-runs hydrate every RESYNC_INTERVAL_MS as a Realtime backstop", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const game = makeActiveGame();
      setHydrate({ game, teams: [], rounds: [] });
      renderHook(() => useGameChannel("ABCDEF"));
      await act(async () => {
        await fireSubscribed();
      });
      const callsAfterInit = supabaseMock.from.mock.calls.length;
      // Tick past one resync interval; the inner setInterval callback should
      // fire and run hydrate() once.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(RESYNC_INTERVAL_MS + 500);
      });
      // Each hydrate hits the three ephemeral tables.
      expect(supabaseMock.from.mock.calls.length).toBe(callsAfterInit + 3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the quiet 60s cadence while no buzz lock is held (no hydrate on the tight tick)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const game = makeActiveGame();
      setHydrate({ game, teams: [], rounds: [] });
      renderHook(() => useGameChannel("ABCDEF"));
      await act(async () => {
        await fireSubscribed();
      });
      const callsAfterInit = supabaseMock.from.mock.calls.length;
      // One tight tick passes with no lock held: the backstop must NOT fire —
      // the 15s cadence is reserved for locked state (#254).
      await act(async () => {
        await vi.advanceTimersByTimeAsync(LOCKED_RESYNC_INTERVAL_MS + 500);
      });
      expect(supabaseMock.from.mock.calls.length).toBe(callsAfterInit);
      // ...but the quiet 60s cadence still lands.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(RESYNC_INTERVAL_MS - LOCKED_RESYNC_INTERVAL_MS);
      });
      expect(supabaseMock.from.mock.calls.length).toBe(callsAfterInit + 3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("tightens the backstop to LOCKED_RESYNC_INTERVAL_MS while a buzz lock is held and repairs a stale lock (#254)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      // The client saw team-2 buzz...
      const locked = makeActiveGame({
        status: "playing",
        round_number: 3,
        current_round_id: "r3",
        buzzed_team_id: "team-2",
        locked_at: "2026-05-05T12:01:00.000Z",
      });
      setHydrate({
        game: locked,
        teams: [],
        rounds: [makeRound({ id: "r3", round_number: 3 })],
      });
      const { result } = renderHook(() => useGameChannel("ABCDEF"));
      await act(async () => {
        await fireSubscribed();
      });
      await waitFor(() => expect(result.current.state?.game.buzzed_team_id).toBe("team-2"));
      const callsAfterInit = supabaseMock.from.mock.calls.length;

      // ...then the DB cleared the lock (release_buzz_lock / a wrong-buzz
      // award — writes with NO redundant Realtime signal) and the UPDATE was
      // lost. Time is the only recovery: one tight tick later the backstop
      // hydrates and un-strands the button, instead of leaving it dead for up
      // to 60s (longer than many rounds).
      setHydrate({
        game: { ...locked, buzzed_team_id: null, locked_at: null },
        teams: [],
        rounds: [],
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(LOCKED_RESYNC_INTERVAL_MS + 500);
      });
      expect(supabaseMock.from.mock.calls.length).toBe(callsAfterInit + 3);
      await waitFor(() => expect(result.current.state?.game.buzzed_team_id).toBeNull());
    } finally {
      vi.useRealTimers();
    }
  });

  it("exposes null finalBoard before any board has been seen", () => {
    const { result } = renderHook(() => useGameChannel("ABCDEF"));
    expect(result.current.finalBoard).toBeNull();
  });

  it("holds the last-known board as finalBoard after the game row is deleted", async () => {
    const game = makeActiveGame({ status: "playing" });
    setHydrate({
      game,
      teams: [makeTeam({ id: "t1", name: "Alice", score: 5 }), makeTeam({ id: "t2", score: 3 })],
      rounds: [makeRound({ id: "r1", round_number: 1, song_id: "song-1" })],
    });
    const { result } = renderHook(() => useGameChannel("ABCDEF"));
    await act(async () => {
      await fireSubscribed();
    });

    // The game row is deleted (End game, or the expiry sweep's final DELETE).
    act(() => {
      fireGame(makePayload<ActiveGame>("active_games", "DELETE", { old: { game_code: "ABCDEF" } }));
    });

    await waitFor(() => expect(result.current.status).toBe("gone"));
    // Live state is gone, but the snapshot survives with the full board so the
    // pages can still render the final scoreboard + song export.
    expect(result.current.state).toBeNull();
    expect(result.current.finalBoard?.teams.size).toBe(2);
    expect(result.current.finalBoard?.teams.get("t1")?.score).toBe(5);
    expect(result.current.finalBoard?.rounds.length).toBe(1);
  });

  it("keeps the full board in finalBoard when the expiry sweep shrinks an ended game before deleting it", async () => {
    const game = makeActiveGame({ status: "ended", ended_at: "2026-05-05T13:00:00.000Z" });
    setHydrate({
      game,
      teams: [makeTeam({ id: "t1", score: 10 }), makeTeam({ id: "t2", score: 4 })],
      rounds: [makeRound({ id: "r1", round_number: 1 })],
    });
    const { result } = renderHook(() => useGameChannel("ABCDEF"));
    await act(async () => {
      await fireSubscribed();
    });
    expect(result.current.finalBoard?.teams.size).toBe(2);

    // The sweep cascade-deletes a team row while the game (ended) row still
    // exists. Live state shrinks; the snapshot must NOT follow it down.
    act(() => {
      fireTeam(makePayload<Team>("game_teams", "DELETE", { old: { id: "t2" } }));
    });
    expect(result.current.state?.teams.size).toBe(1);
    expect(result.current.finalBoard?.teams.size).toBe(2);

    // A round row cascade-deletes too — the snapshot keeps the full history.
    act(() => {
      fireRound(makePayload<GameRound>("game_rounds", "DELETE", { old: { id: "r1" } }));
    });
    expect(result.current.state?.rounds.length).toBe(0);
    expect(result.current.finalBoard?.rounds.length).toBe(1);

    // The game row DELETE lands last: still the full snapshot.
    act(() => {
      fireGame(makePayload<ActiveGame>("active_games", "DELETE", { old: { game_code: "ABCDEF" } }));
    });
    await waitFor(() => expect(result.current.status).toBe("gone"));
    expect(result.current.finalBoard?.teams.size).toBe(2);
    expect(result.current.finalBoard?.rounds.length).toBe(1);
  });

  it("honors a host kick during the overdue-but-unswept window (kicked team does not linger on the final board)", async () => {
    // A game can be past expires_at but still `playing` (kept alive by the
    // "Keep playing +1h" banner) while the hourly sweep hasn't run. A kick there
    // is a real host action — one team removed, the room still populated, rounds
    // intact — and must be honored, NOT frozen out as if it were teardown. This
    // is the case the clock-only guard got wrong (review finding).
    const game = makeActiveGame({ status: "playing", expires_at: "2026-05-05T11:00:00.000Z" });
    setHydrate({
      game,
      teams: [makeTeam({ id: "t1", score: 7 }), makeTeam({ id: "t2", score: 2 })],
      rounds: [],
    });
    const { result } = renderHook(() => useGameChannel("ABCDEF"));
    await act(async () => {
      await fireSubscribed();
    });

    act(() => {
      fireTeam(makePayload<Team>("game_teams", "DELETE", { old: { id: "t2" } }));
    });
    expect(result.current.state?.teams.size).toBe(1);
    // Snapshot follows the kick — t2 is gone, not preserved by a false teardown.
    expect(result.current.finalBoard?.teams.size).toBe(1);
    expect(result.current.finalBoard?.teams.has("t2")).toBe(false);
  });

  it("holds the board when the sweep removes the LAST team of an overdue-unended game", async () => {
    // The sweep's cascade DELETE that empties the room (not a kick — a kick
    // never removes the last team) is teardown: the final board keeps the team
    // so a single-team game still shows a scoreboard, not "no teams". This is
    // the ordering the expiration e2e relies on (child DELETE before the game
    // DELETE).
    const game = makeActiveGame({ status: "playing", expires_at: "2026-05-05T11:00:00.000Z" });
    setHydrate({ game, teams: [makeTeam({ id: "t1", name: "Solo", score: 9 })], rounds: [] });
    const { result } = renderHook(() => useGameChannel("ABCDEF"));
    await act(async () => {
      await fireSubscribed();
    });

    act(() => {
      fireTeam(makePayload<Team>("game_teams", "DELETE", { old: { id: "t1" } }));
    });
    expect(result.current.state?.teams.size).toBe(0);
    expect(result.current.finalBoard?.teams.size).toBe(1);
    expect(result.current.finalBoard?.teams.get("t1")?.name).toBe("Solo");
  });

  it("holds the board when an overdue-unended sweep drops a round (rounds-first cascade)", async () => {
    // A shrink that also removes a round is unmistakably the cascade, never a
    // kick — hold the whole board even with multiple teams still present.
    const game = makeActiveGame({ status: "playing", expires_at: "2026-05-05T11:00:00.000Z" });
    setHydrate({
      game,
      teams: [makeTeam({ id: "t1", score: 7 }), makeTeam({ id: "t2", score: 2 })],
      rounds: [makeRound({ id: "r1", round_number: 1 })],
    });
    const { result } = renderHook(() => useGameChannel("ABCDEF"));
    await act(async () => {
      await fireSubscribed();
    });

    act(() => {
      fireRound(makePayload<GameRound>("game_rounds", "DELETE", { old: { id: "r1" } }));
    });
    expect(result.current.state?.rounds.length).toBe(0);
    expect(result.current.finalBoard?.rounds.length).toBe(1);
    // A team DELETE arriving after (state now has 0 rounds) is still teardown.
    act(() => {
      fireTeam(makePayload<Team>("game_teams", "DELETE", { old: { id: "t2" } }));
    });
    expect(result.current.finalBoard?.teams.size).toBe(2);
  });

  it("lets a genuine kick from a live game update the snapshot (kicked team does not resurface)", async () => {
    // A live (not ended, not expired) game whose team row is deleted is a kick,
    // not teardown — the kicked team should be gone from the final board too.
    const game = makeActiveGame({ status: "playing" }); // default expires_at is far future
    setHydrate({
      game,
      teams: [makeTeam({ id: "t1", score: 7 }), makeTeam({ id: "t2", score: 2 })],
      rounds: [],
    });
    const { result } = renderHook(() => useGameChannel("ABCDEF"));
    await act(async () => {
      await fireSubscribed();
    });

    act(() => {
      fireTeam(makePayload<Team>("game_teams", "DELETE", { old: { id: "t2" } }));
    });
    expect(result.current.finalBoard?.teams.size).toBe(1);
    expect(result.current.finalBoard?.teams.has("t2")).toBe(false);

    // If the game is later deleted, the snapshot reflects the post-kick roster.
    act(() => {
      fireGame(makePayload<ActiveGame>("active_games", "DELETE", { old: { game_code: "ABCDEF" } }));
    });
    await waitFor(() => expect(result.current.status).toBe("gone"));
    expect(result.current.finalBoard?.teams.size).toBe(1);
  });

  it("triggers an immediate hydrate when the tab becomes visible again", async () => {
    const game = makeActiveGame();
    setHydrate({ game, teams: [], rounds: [] });
    renderHook(() => useGameChannel("ABCDEF"));
    await act(async () => {
      await fireSubscribed();
    });
    // After the initial hydrate, capture the supabase.from call count so we
    // can tell whether visibilitychange triggered the extra hydrate.
    const callsAfterInit = supabaseMock.from.mock.calls.length;

    // Simulate tab going to the background; dispatch should be a no-op
    // (stopResync), so the call count must not change.
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(supabaseMock.from.mock.calls.length).toBe(callsAfterInit);

    // Tab returns: the hook hydrates immediately and restarts the interval.
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    // Each hydrate hits 3 tables. Calls should increase by 3.
    expect(supabaseMock.from.mock.calls.length).toBe(callsAfterInit + 3);

    // Reset document.hidden back to its default so it doesn't leak.
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
  });
});
