import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/supabase", async () => {
  const mod = await import("../test/supabaseMock");
  return { supabase: mod.supabaseMock };
});

import { PROVISIONAL_LOCK_TTL_MS, useBuzzer } from "./useBuzzer";
import {
  makeActiveGame,
  makeTeam,
  resetSupabaseMock,
  setRpcResponse,
  supabaseMock,
} from "../test/supabaseMock";
import { RpcError } from "../lib/rpcError";
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
    roundNumber: number;
  }> = {},
): GameState {
  const game = makeActiveGame({
    status: overrides.status ?? "playing",
    buzzed_team_id: overrides.buzzedTeamId ?? null,
    round_number: overrides.roundNumber ?? 1,
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
    // The buzz path now throws the shared RpcError (uniform with the manager
    // RPCs) instead of the raw PostgREST error object.
    expect(result.current.error).toBeInstanceOf(RpcError);
    expect(result.current.error?.message).toBe("boom");
  });

  it("paints an optimistic winner lock the instant buzz_in resolves", async () => {
    // buzz_in RETURNS (locked, locked_team_id, locked_at) as a one-row array.
    setRpcResponse({
      data: [{ locked: true, locked_team_id: "team-1", locked_at: "2026-05-05T12:00:00Z" }],
      error: null,
    });
    const state = buildState();
    const { result } = renderHook(() => useBuzzer("ABCDEF", "team-1", state));
    expect(result.current.isLocked).toBe(false);
    await act(async () => {
      await result.current.buzz();
    });
    // No Realtime UPDATE has landed (state prop unchanged), yet the button is
    // already locked to us from the RPC result alone.
    expect(result.current.isLocked).toBe(true);
    expect(result.current.lockedByMe).toBe(true);
    expect(result.current.lockedTeamId).toBe("team-1");
  });

  it("paints an optimistic locked-other lock when we lose the race", async () => {
    setRpcResponse({
      data: [{ locked: false, locked_team_id: "team-2", locked_at: "2026-05-05T12:00:00Z" }],
      error: null,
    });
    const state = buildState();
    const { result } = renderHook(() => useBuzzer("ABCDEF", "team-1", state));
    await act(async () => {
      await result.current.buzz();
    });
    expect(result.current.isLocked).toBe(true);
    expect(result.current.lockedByMe).toBe(false);
    expect(result.current.lockedTeamId).toBe("team-2");
  });

  it("rolls the optimistic lock back when the RPC errors", async () => {
    setRpcResponse({ data: null, error: { message: "boom" } });
    const state = buildState();
    const { result } = renderHook(() => useBuzzer("ABCDEF", "team-1", state));
    await act(async () => {
      await result.current.buzz();
    });
    expect(result.current.error).not.toBeNull();
    // No provisional lock is left behind, so the player can retry.
    expect(result.current.isLocked).toBe(false);
    expect(result.current.lockedTeamId).toBeNull();
  });

  it("lets the Realtime lock override a wrong optimistic guess", async () => {
    setRpcResponse({
      data: [{ locked: true, locked_team_id: "team-1", locked_at: "2026-05-05T12:00:00Z" }],
      error: null,
    });
    const { result, rerender } = renderHook(({ gs }) => useBuzzer("ABCDEF", "team-1", gs), {
      initialProps: { gs: buildState() },
    });
    await act(async () => {
      await result.current.buzz();
    });
    expect(result.current.lockedByMe).toBe(true);
    // The authoritative Realtime UPDATE says team-2 actually holds the lock.
    // The provisional guess must be dropped and the DB truth win.
    rerender({ gs: buildState({ buzzedTeamId: "team-2" }) });
    expect(result.current.lockedByMe).toBe(false);
    expect(result.current.lockedTeamId).toBe("team-2");
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

// Regression coverage for issue #261: a provisional (optimistic) lock painted
// from buzz_in strands the button on "SOMEONE ELSE BUZZED" forever if the
// client misses BOTH the authoritative lock event and its release during a
// WS-only outage (WebSocket down, REST up -- the #254 "reconnecting" state).
// The authoritative lock stays null->null from this tab's view, so the only
// pre-existing reconciler (the realtimeLock effect) never fires. The fix adds
// a round-advance reconciler and a TTL backstop; these tests pin both, and the
// TTL case fails before the fix (the guess never clears) and passes after.
describe("useBuzzer — provisional lock reconciliation (#261)", () => {
  it("re-arms the button within the TTL when the client missed both the lock and its release", async () => {
    vi.useFakeTimers();
    try {
      // We press and LOSE: buzz_in returns team-2 as the definitive winner.
      setRpcResponse({
        data: [{ locked: false, locked_team_id: "team-2", locked_at: "2026-05-05T12:00:00Z" }],
        error: null,
      });
      const state = buildState({ buzzedTeamId: null });
      const { result } = renderHook(() => useBuzzer("ABCDEF", "team-1", state));
      await act(async () => {
        await result.current.buzz();
      });
      // Optimistic paint: "SOMEONE ELSE BUZZED", team-2 got it first.
      expect(result.current.isLocked).toBe(true);
      expect(result.current.lockedByMe).toBe(false);
      expect(result.current.lockedTeamId).toBe("team-2");

      // The authoritative lock never changes from this tab's view (the client
      // missed the lock event AND its release over the dead socket), so neither
      // reconciler fires. Just before the TTL the guess is still held.
      act(() => {
        vi.advanceTimersByTime(PROVISIONAL_LOCK_TTL_MS - 1);
      });
      expect(result.current.isLocked).toBe(true);

      // At the TTL the provisional self-expires and the button re-arms to idle.
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(result.current.isLocked).toBe(false);
      expect(result.current.lockedTeamId).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears the provisional on a round advance even when the authoritative lock never changed", async () => {
    setRpcResponse({
      data: [{ locked: false, locked_team_id: "team-2", locked_at: "2026-05-05T12:00:00Z" }],
      error: null,
    });
    const { result, rerender } = renderHook(({ gs }) => useBuzzer("ABCDEF", "team-1", gs), {
      initialProps: { gs: buildState({ buzzedTeamId: null, roundNumber: 1 }) },
    });
    await act(async () => {
      await result.current.buzz();
    });
    expect(result.current.lockedTeamId).toBe("team-2");

    // The round advances (round_number 1 -> 2) with buzzed_team_id still null
    // from this tab's view -- it missed the advance UPDATE that nulled the lock,
    // but round_number moving proves the prior round (and its lock) is over.
    rerender({ gs: buildState({ buzzedTeamId: null, roundNumber: 2 }) });
    expect(result.current.isLocked).toBe(false);
    expect(result.current.lockedTeamId).toBeNull();
  });

  it("keeps the optimistic winner paint through the fan-out window and lets the real lock confirm it", async () => {
    vi.useFakeTimers();
    try {
      // We press and WIN: provisional = ourselves.
      setRpcResponse({
        data: [{ locked: true, locked_team_id: "team-1", locked_at: "2026-05-05T12:00:00Z" }],
        error: null,
      });
      const { result, rerender } = renderHook(({ gs }) => useBuzzer("ABCDEF", "team-1", gs), {
        initialProps: { gs: buildState({ buzzedTeamId: null }) },
      });
      await act(async () => {
        await result.current.buzz();
      });
      expect(result.current.lockedByMe).toBe(true);

      // Partway through the fan-out window, before any Realtime echo: the
      // provisional must still hold (the TTL has NOT fired) so the happy-path
      // "YOU BUZZED" paint is never prematurely dropped.
      act(() => {
        vi.advanceTimersByTime(300);
      });
      expect(result.current.lockedByMe).toBe(true);

      // The real Realtime lock lands (buzzed_team_id = us). Advancing well past
      // the TTL must NOT clear it: once the authoritative lock holds, the
      // provisional TTL is irrelevant and the button stays "YOU BUZZED".
      rerender({ gs: buildState({ buzzedTeamId: "team-1" }) });
      act(() => {
        vi.advanceTimersByTime(PROVISIONAL_LOCK_TTL_MS * 2);
      });
      expect(result.current.lockedByMe).toBe(true);
      expect(result.current.lockedTeamId).toBe("team-1");
    } finally {
      vi.useRealTimers();
    }
  });
});
