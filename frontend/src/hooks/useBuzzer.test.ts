import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/supabase", async () => {
  const mod = await import("../test/supabaseMock");
  return { supabase: mod.supabaseMock };
});

import { useBuzzer } from "./useBuzzer";
import {
  makeActiveGame,
  makeTeam,
  resetSupabaseMock,
  setRpcResponse,
  supabaseMock,
} from "../test/supabaseMock";
import type { GameState } from "../lib/types";

beforeEach(() => {
  resetSupabaseMock();
});

afterEach(() => {
  vi.clearAllMocks();
});

function buildState(
  overrides: Partial<{
    status: "waiting" | "playing" | "ended";
    buzzedTeamId: string | null;
  }> = {},
): GameState {
  const game = makeActiveGame({
    status: overrides.status ?? "playing",
    buzzed_team_id: overrides.buzzedTeamId ?? null,
  });
  const team = makeTeam();
  return {
    game,
    teams: new Map([[team.id, team]]),
    rounds: [],
    currentRound: null,
  };
}

describe("useBuzzer", () => {
  it("calls rpc('buzz_in') with game code and team id", async () => {
    const state = buildState();
    const { result } = renderHook(() => useBuzzer("ABCDEF", "team-1", state));
    await act(async () => {
      await result.current.buzz();
    });
    expect(supabaseMock.rpc).toHaveBeenCalledWith("buzz_in", {
      p_game_code: "ABCDEF",
      p_team_id: "team-1",
    });
  });

  it("does not call rpc when game status is not playing", async () => {
    const state = buildState({ status: "waiting" });
    const { result } = renderHook(() => useBuzzer("ABCDEF", "team-1", state));
    await act(async () => {
      await result.current.buzz();
    });
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });

  it("does not call rpc when game is already locked by someone", async () => {
    const state = buildState({ buzzedTeamId: "team-2" });
    const { result } = renderHook(() => useBuzzer("ABCDEF", "team-1", state));
    expect(result.current.isLocked).toBe(true);
    expect(result.current.lockedByMe).toBe(false);
    await act(async () => {
      await result.current.buzz();
    });
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });

  it("reports lockedByMe when own team holds the lock", () => {
    const state = buildState({ buzzedTeamId: "team-1" });
    const { result } = renderHook(() => useBuzzer("ABCDEF", "team-1", state));
    expect(result.current.lockedByMe).toBe(true);
  });

  it("captures rpc errors", async () => {
    setRpcResponse({ data: null, error: { message: "boom" } });
    const state = buildState();
    const { result } = renderHook(() => useBuzzer("ABCDEF", "team-1", state));
    await act(async () => {
      await result.current.buzz();
    });
    expect(result.current.error).not.toBeNull();
  });

  it("reports state correctly when gameState is null", async () => {
    const { result } = renderHook(() => useBuzzer("ABCDEF", "team-1", null));
    expect(result.current.isLocked).toBe(false);
    expect(result.current.lockedByMe).toBe(false);
    await act(async () => {
      await result.current.buzz();
    });
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });

  it("blocks double-press while a buzz is in flight", async () => {
    let resolveRpc: (v: { data: unknown; error: null }) => void = () => {};
    supabaseMock.rpc.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRpc = resolve;
        }),
    );
    const state = buildState();
    const { result } = renderHook(() => useBuzzer("ABCDEF", "team-1", state));
    void result.current.buzz();
    void result.current.buzz();
    await waitFor(() => expect(result.current.isBuzzing).toBe(true));
    expect(supabaseMock.rpc).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveRpc({ data: [], error: null });
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.isBuzzing).toBe(false));
  });
});
