import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/supabase", async () => {
  const mod = await import("../test/supabaseMock");
  return { supabase: mod.supabaseMock };
});

// Mock the telemetry wrapper so we can assert the buzz hot path is instrumented.
// tracedRpc must pass through to its `run()` so the supabase mock still drives
// the result.
const telemetry = vi.hoisted(() => ({
  markBuzzStart: vi.fn(),
  failBuzz: vi.fn(),
  tracedRpc: vi.fn((_name: string, _attrs: unknown, run: () => unknown) => run()),
}));
vi.mock("../lib/telemetry", () => telemetry);

import { useBuzzer } from "./useBuzzer";
import { makeActiveGame, makeTeam, resetSupabaseMock, setRpcResponse } from "../test/supabaseMock";
import type { GameState } from "../lib/types";

function buildState(): GameState {
  const game = makeActiveGame({ status: "playing", buzzed_team_id: null, round_number: 3 });
  const team = makeTeam();
  return { game, teams: new Map([[team.id, team]]), rounds: [], currentRound: null };
}

beforeEach(() => {
  resetSupabaseMock();
  telemetry.markBuzzStart.mockClear();
  telemetry.failBuzz.mockClear();
  telemetry.tracedRpc.mockClear();
  telemetry.tracedRpc.mockImplementation((_n: string, _a: unknown, run: () => unknown) => run());
});

describe("useBuzzer telemetry wiring", () => {
  it("opens a buzz e2e span and wraps buzz_in in a traced RPC", async () => {
    const { result } = renderHook(() => useBuzzer("ABCDEF", "team-1", buildState()));
    await act(async () => {
      await result.current.buzz();
    });
    expect(telemetry.markBuzzStart).toHaveBeenCalledWith("ABCDEF", "team-1", 3);
    expect(telemetry.tracedRpc).toHaveBeenCalledWith(
      "buzz_in",
      { game_code: "ABCDEF" },
      expect.any(Function),
    );
  });

  it("closes the buzz span via failBuzz when the RPC errors", async () => {
    setRpcResponse({ data: null, error: { message: "boom" } });
    const { result } = renderHook(() => useBuzzer("ABCDEF", "team-1", buildState()));
    await act(async () => {
      await result.current.buzz();
    });
    expect(telemetry.failBuzz).toHaveBeenCalledWith("team-1");
  });

  it("does not open a span when the buzz is blocked (not playing)", async () => {
    const game = makeActiveGame({ status: "waiting" });
    const state: GameState = {
      game,
      teams: new Map(),
      rounds: [],
      currentRound: null,
    };
    const { result } = renderHook(() => useBuzzer("ABCDEF", "team-1", state));
    await act(async () => {
      await result.current.buzz();
    });
    expect(telemetry.markBuzzStart).not.toHaveBeenCalled();
  });
});
