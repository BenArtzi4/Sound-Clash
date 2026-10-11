import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/supabase", async () => {
  const mod = await import("../test/supabaseMock");
  return { supabase: mod.supabaseMock };
});

const telemetry = vi.hoisted(() => ({
  log: vi.fn(),
  recordFanout: vi.fn(),
  resolveBuzzE2E: vi.fn(),
  resolveScoreE2E: vi.fn(),
}));
vi.mock("../lib/telemetry", () => telemetry);

import { LOCKED_RESYNC_INTERVAL_MS, STALE_LOCK_CONFIRM_MS, useGameChannel } from "./useGameChannel";
import {
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
} from "../test/supabaseMock";

const TS = "2026-05-05T12:00:05.000Z";

beforeEach(() => {
  resetSupabaseMock();
  telemetry.recordFanout.mockClear();
  telemetry.resolveBuzzE2E.mockClear();
  telemetry.resolveScoreE2E.mockClear();
  telemetry.log.mockClear();
});

describe("useGameChannel telemetry wiring", () => {
  it("records fan-out per table and resolves buzz/score e2e from Realtime", () => {
    const game = makeActiveGame({ status: "playing" });
    setHydrate({ game, teams: [], rounds: [] });
    renderHook(() => useGameChannel("ABCDEF"));

    act(() => {
      fireGame(
        makePayload("active_games", "UPDATE", { new: { ...game, buzzed_team_id: "team-9" } }, TS),
      );
    });
    expect(telemetry.recordFanout).toHaveBeenCalledWith("game", TS);
    expect(telemetry.resolveBuzzE2E).toHaveBeenCalledWith("team-9", TS);

    act(() => {
      fireRound(makePayload("game_rounds", "UPDATE", { new: makeRound({ id: "round-1" }) }, TS));
    });
    expect(telemetry.recordFanout).toHaveBeenCalledWith("round", TS);
    expect(telemetry.resolveScoreE2E).toHaveBeenCalledWith("round-1", TS);

    act(() => {
      fireTeam(makePayload("game_teams", "UPDATE", { new: makeTeam({ id: "team-9" }) }, TS));
    });
    expect(telemetry.recordFanout).toHaveBeenCalledWith("team", TS);
  });

  it("does not resolve a buzz span when no lock is set", () => {
    const game = makeActiveGame({ status: "playing" });
    setHydrate({ game, teams: [], rounds: [] });
    renderHook(() => useGameChannel("ABCDEF"));
    act(() => {
      fireGame(
        makePayload("active_games", "UPDATE", { new: { ...game, buzzed_team_id: null } }, TS),
      );
    });
    expect(telemetry.resolveBuzzE2E).not.toHaveBeenCalled();
  });

  it("logs a warning on a Realtime disconnect", async () => {
    setHydrate({ game: makeActiveGame({ status: "playing" }), teams: [], rounds: [] });
    renderHook(() => useGameChannel("ABCDEF"));
    await act(async () => {
      await fireStatus("CHANNEL_ERROR");
    });
    expect(telemetry.log).toHaveBeenCalledWith(
      "warn",
      "realtime_disconnect",
      expect.objectContaining({ game_code: "ABCDEF", sub_status: "CHANNEL_ERROR" }),
    );
  });

  describe("stale buzz lock diagnostic (#254, #361)", () => {
    const locked = makeActiveGame({
      status: "playing",
      round_number: 3,
      current_round_id: "r3",
      buzzed_team_id: "team-2",
      locked_at: "2026-05-05T12:01:00.000Z",
    });
    const cleared = { ...locked, buzzed_team_id: null, locked_at: null };

    function staleLockWarnings() {
      return telemetry.log.mock.calls.filter((c) => c[1] === "stale_buzz_lock_resynced");
    }

    // Mount holding team-2's lock, then make the DB clear it, and run the
    // locked-cadence backstop tick that reads the cleared row.
    async function tickAfterClear() {
      setHydrate({ game: locked, teams: [], rounds: [makeRound({ id: "r3", round_number: 3 })] });
      const hook = renderHook(() => useGameChannel("ABCDEF"));
      await act(async () => {
        await fireSubscribed();
      });
      setHydrate({ game: cleared, teams: [], rounds: [] });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(LOCKED_RESYNC_INTERVAL_MS + 100);
      });
      return hook;
    }

    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("warns when the clearing Realtime event never arrives", async () => {
      await tickAfterClear();
      // The repair is applied at once; the verdict waits for the in-flight
      // event that would prove nothing was dropped.
      expect(staleLockWarnings()).toHaveLength(0);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(STALE_LOCK_CONFIRM_MS);
      });
      expect(telemetry.log).toHaveBeenCalledWith(
        "warn",
        "stale_buzz_lock_resynced",
        expect.objectContaining({
          game_code: "ABCDEF",
          stale_team: "team-2",
          fresh_team: "none",
        }),
      );
      expect(staleLockWarnings()).toHaveLength(1);
    });

    it("stays quiet when the clearing event arrives just after the poll (#361)", async () => {
      // The poll read the row after the clear committed but its response beat
      // the Realtime frame (which takes ~150-900 ms). Nothing was dropped.
      await tickAfterClear();
      act(() => {
        fireGame(makePayload("active_games", "UPDATE", { new: cleared }, TS));
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(STALE_LOCK_CONFIRM_MS);
      });
      expect(staleLockWarnings()).toHaveLength(0);
    });

    it("stays quiet when the clearing event landed before its render committed", async () => {
      // The frame was received, but the tick's poll resolved before React
      // re-rendered, so the hook still believed team-2 held the lock.
      setHydrate({ game: locked, teams: [], rounds: [makeRound({ id: "r3", round_number: 3 })] });
      renderHook(() => useGameChannel("ABCDEF"));
      await act(async () => {
        await fireSubscribed();
      });
      setHydrate({ game: cleared, teams: [], rounds: [] });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(LOCKED_RESYNC_INTERVAL_MS - 50);
      });
      await act(async () => {
        fireGame(makePayload("active_games", "UPDATE", { new: cleared }, TS));
        await vi.advanceTimersByTimeAsync(150);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(STALE_LOCK_CONFIRM_MS);
      });
      expect(staleLockWarnings()).toHaveLength(0);
    });

    it("still warns when a later buzz by another team arrives inside the window", async () => {
      // A new lock is a different write from the lost clear, so it proves
      // nothing about whether the clear was delivered.
      await tickAfterClear();
      act(() => {
        fireGame(
          makePayload(
            "active_games",
            "UPDATE",
            { new: { ...cleared, buzzed_team_id: "team-7" } },
            TS,
          ),
        );
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(STALE_LOCK_CONFIRM_MS);
      });
      expect(staleLockWarnings()).toHaveLength(1);
    });

    it("drops a pending verdict on unmount", async () => {
      const hook = await tickAfterClear();
      hook.unmount();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(STALE_LOCK_CONFIRM_MS);
      });
      expect(staleLockWarnings()).toHaveLength(0);
    });
  });
});
