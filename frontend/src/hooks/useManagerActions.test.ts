import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/supabase", async () => {
  const mod = await import("../test/supabaseMock");
  return { supabase: mod.supabaseMock };
});

import {
  awardAttemptDirect,
  releaseBuzzLockDirect,
  RpcError,
} from "./useManagerActions";
import { resetSupabaseMock, setRpcResponse, supabaseMock } from "../test/supabaseMock";

const TOKEN = "11111111-1111-1111-1111-111111111111";

beforeEach(() => {
  resetSupabaseMock();
});

describe("awardAttemptDirect", () => {
  it("translates booleans to point integers and passes the manager token", async () => {
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

    const res = await awardAttemptDirect("ABCDEF", TOKEN, "r1", {
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
      p_title: 10,
      p_artist: 0,
      p_wrong_buzz: 0,
      p_manager_token: TOKEN,
    });
  });

  it("maps wrong_buzz to the -3 penalty integer", async () => {
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

    await awardAttemptDirect("ABCDEF", TOKEN, "r1", {
      title_correct: false,
      artist_correct: false,
      wrong_buzz: true,
    });

    const firstCall = vi.mocked(supabaseMock.rpc).mock.calls[0];
    expect(firstCall).toBeDefined();
    const params = (firstCall as unknown as [string, Record<string, unknown>])[1];
    expect(params.p_wrong_buzz).toBe(3);
    expect(params.p_title).toBe(0);
    expect(params.p_artist).toBe(0);
  });

  it("throws RpcError carrying the PL/pgSQL message and sqlstate", async () => {
    setRpcResponse({
      data: null,
      error: { message: "manager_token_required", code: "28000" },
    });

    await expect(
      awardAttemptDirect("ABCDEF", "wrong-token", "r1", {
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
      awardAttemptDirect("ABCDEF", TOKEN, "r1", {
        title_correct: true,
        artist_correct: false,
        wrong_buzz: false,
      }),
    ).rejects.toBeInstanceOf(RpcError);
  });
});

describe("releaseBuzzLockDirect", () => {
  it("passes the manager token", async () => {
    setRpcResponse({ data: null, error: null });
    await releaseBuzzLockDirect("ABCDEF", TOKEN);
    expect(supabaseMock.rpc).toHaveBeenCalledWith("release_buzz_lock", {
      p_game_code: "ABCDEF",
      p_manager_token: TOKEN,
    });
  });

  it("throws RpcError on a wrong token", async () => {
    setRpcResponse({
      data: null,
      error: { message: "manager_token_required", code: "28000" },
    });
    await expect(releaseBuzzLockDirect("ABCDEF", "wrong")).rejects.toBeInstanceOf(RpcError);
  });
});
