import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/supabase", async () => {
  const mod = await import("../test/supabaseMock");
  return { supabase: mod.supabaseMock };
});

vi.mock("../lib/api", () => ({ awardBonus: vi.fn() }));

import { awardBonus } from "../lib/api";
import {
  awardAttemptDirect,
  awardBonusDirect,
  extendGameDirect,
  releaseBuzzLockDirect,
  RpcError,
} from "./useManagerActions";
import { resetSupabaseMock, setRpcResponse, supabaseMock } from "../test/supabaseMock";

const TOKEN = "11111111-1111-1111-1111-111111111111";

beforeEach(() => {
  resetSupabaseMock();
  vi.mocked(awardBonus).mockReset();
});

describe("awardAttemptDirect", () => {
  it("sends the attempt flags as booleans and passes the manager token", async () => {
    // T7.1: the DB derives the point magnitudes; the wire carries only booleans,
    // routed to award_attempt's boolean overload (mig 043).
    setRpcResponse({
      data: [
        {
          team_id: "t1",
          points_delta: 10,
          team_total_score: 10,
          title_claimed_by: "t1",
          artist_claimed_by: null,
        },
      ],
      error: null,
    });

    const res = await awardAttemptDirect("ABCDEF", TOKEN, "r1", 1, {
      title_correct: true,
      artist_correct: false,
      wrong_buzz: false,
    });

    expect(res.points_awarded).toBe(10);
    expect(res.team_total_score).toBe(10);
    expect(res.title_claimed_by).toBe("t1");
    expect(supabaseMock.rpc).toHaveBeenCalledWith("award_attempt", {
      p_game_code: "ABCDEF",
      p_round_id: "r1",
      p_buzz_attempt_id: 1,
      p_correct_title: true,
      p_correct_artist: false,
      p_wrong: false,
      p_manager_token: TOKEN,
    });
  });

  it("maps a wrong buzz to p_wrong=true with both correct flags false", async () => {
    setRpcResponse({
      data: [
        {
          team_id: "t1",
          points_delta: -3,
          team_total_score: 7,
          title_claimed_by: null,
          artist_claimed_by: null,
        },
      ],
      error: null,
    });

    await awardAttemptDirect("ABCDEF", TOKEN, "r1", 1, {
      title_correct: false,
      artist_correct: false,
      wrong_buzz: true,
    });

    const firstCall = vi.mocked(supabaseMock.rpc).mock.calls[0];
    expect(firstCall).toBeDefined();
    const params = (firstCall as unknown as [string, Record<string, unknown>])[1];
    expect(params.p_wrong).toBe(true);
    expect(params.p_correct_title).toBe(false);
    expect(params.p_correct_artist).toBe(false);
  });

  it("throws RpcError carrying the PL/pgSQL message and sqlstate", async () => {
    setRpcResponse({
      data: null,
      error: { message: "manager_token_required", code: "28000" },
    });

    await expect(
      awardAttemptDirect("ABCDEF", "wrong-token", "r1", 1, {
        title_correct: true,
        artist_correct: false,
        wrong_buzz: false,
      }),
    ).rejects.toMatchObject({
      name: "RpcError",
      message: "manager_token_required",
      sqlstate: "28000",
    });
  });

  it("raises when PostgREST returns an empty array (no row from RETURNS TABLE)", async () => {
    setRpcResponse({ data: [], error: null });
    await expect(
      awardAttemptDirect("ABCDEF", TOKEN, "r1", 1, {
        title_correct: true,
        artist_correct: false,
        wrong_buzz: false,
      }),
    ).rejects.toBeInstanceOf(RpcError);
  });
});

describe("awardBonusDirect", () => {
  it("passes only the team and manager credentials and returns the committed score", async () => {
    setRpcResponse({ data: 0, error: null });
    await expect(awardBonusDirect("ABCDEF", TOKEN, "t1")).resolves.toBe(0);
    expect(supabaseMock.rpc).toHaveBeenCalledWith("award_manager_bonus", {
      p_game_code: "ABCDEF",
      p_team_id: "t1",
      p_manager_token: TOKEN,
    });
  });

  it("preserves a rejected token and rejects a missing score", async () => {
    setRpcResponse({ data: null, error: { code: "28000", message: "manager_token_required" } });
    await expect(awardBonusDirect("ABCDEF", TOKEN, "t1")).rejects.toMatchObject({
      sqlstate: "28000",
    });
    setRpcResponse({ data: null, error: null });
    await expect(awardBonusDirect("ABCDEF", TOKEN, "t1")).rejects.toBeInstanceOf(RpcError);
    expect(awardBonus).not.toHaveBeenCalled();
  });

  it("uses the existing bonus endpoint when PostgREST cannot resolve the new RPC", async () => {
    setRpcResponse({ data: null, error: { code: "PGRST202", message: "function missing" } });
    vi.mocked(awardBonus).mockResolvedValue({
      team_id: "t1",
      points_awarded: 4,
      team_total_score: 14,
    });
    await expect(awardBonusDirect("ABCDEF", TOKEN, "t1")).resolves.toBe(14);
    expect(awardBonus).toHaveBeenCalledWith("ABCDEF", TOKEN, { team_id: "t1" });
  });

  it("never repeats a bonus after an uncertain RPC outcome", async () => {
    setRpcResponse({ data: null, error: { code: "", message: "Failed to fetch" } });
    await expect(awardBonusDirect("ABCDEF", TOKEN, "t1")).rejects.toBeInstanceOf(RpcError);
    expect(awardBonus).not.toHaveBeenCalled();
  });
});

describe("releaseBuzzLockDirect", () => {
  it("passes the manager token", async () => {
    setRpcResponse({ data: null, error: null });
    await releaseBuzzLockDirect("ABCDEF", TOKEN, 1);
    expect(supabaseMock.rpc).toHaveBeenCalledWith("release_buzz_lock", {
      p_game_code: "ABCDEF",
      p_buzz_attempt_id: 1,
      p_manager_token: TOKEN,
    });
  });

  it("throws RpcError on a wrong token", async () => {
    setRpcResponse({
      data: null,
      error: { message: "manager_token_required", code: "28000" },
    });
    await expect(releaseBuzzLockDirect("ABCDEF", "wrong", 1)).rejects.toBeInstanceOf(RpcError);
  });
});

describe("extendGameDirect", () => {
  it("passes the manager token and returns the new expires_at string", async () => {
    // RETURNS timestamptz arrives as a bare JSON string.
    setRpcResponse({ data: "2026-05-05T17:00:00+00:00", error: null });
    const newExpiresAt = await extendGameDirect("ABCDEF", TOKEN);
    expect(newExpiresAt).toBe("2026-05-05T17:00:00+00:00");
    expect(supabaseMock.rpc).toHaveBeenCalledWith("extend_game", {
      p_game_code: "ABCDEF",
      p_manager_token: TOKEN,
    });
  });

  it("throws RpcError carrying the PL/pgSQL message and sqlstate", async () => {
    setRpcResponse({
      data: null,
      error: { message: "manager_token_required", code: "28000" },
    });
    await expect(extendGameDirect("ABCDEF", "wrong")).rejects.toMatchObject({
      name: "RpcError",
      message: "manager_token_required",
      sqlstate: "28000",
    });
  });

  it("raises when the RPC resolves without a timestamp", async () => {
    setRpcResponse({ data: null, error: null });
    await expect(extendGameDirect("ABCDEF", TOKEN)).rejects.toBeInstanceOf(RpcError);
  });
});
