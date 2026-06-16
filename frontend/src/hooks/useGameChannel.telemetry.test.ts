import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { useGameChannel } from "./useGameChannel";
import {
  fireGame,
  fireRound,
  fireStatus,
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
});
