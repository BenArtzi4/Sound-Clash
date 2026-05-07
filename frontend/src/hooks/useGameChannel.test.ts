import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/supabase", async () => {
  const mod = await import("../test/supabaseMock");
  return { supabase: mod.supabaseMock };
});

import type { ActiveGame, GameRound, Team } from "../lib/types";
import { gameReducer, useGameChannel } from "./useGameChannel";
import {
  channelMock,
  fireGame,
  fireStatus,
  fireSubscribed,
  makeActiveGame,
  makePayload,
  makeRound,
  makeTeam,
  resetSupabaseMock,
  setHydrate,
  supabaseMock,
} from "../test/supabaseMock";

beforeEach(() => {
  resetSupabaseMock();
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
    const game = makeActiveGame({ current_round_id: "r1" });
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
});
