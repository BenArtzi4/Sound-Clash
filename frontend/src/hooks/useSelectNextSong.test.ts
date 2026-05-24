import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/supabase", async () => {
  const mod = await import("../test/supabaseMock");
  return { supabase: mod.supabaseMock };
});

import { selectNextSongDirect } from "./useSelectNextSong";
import { RpcError } from "./useManagerActions";
import { resetSupabaseMock, setRpcResponse, supabaseMock } from "../test/supabaseMock";

const TOKEN = "11111111-1111-1111-1111-111111111111";

function row(overrides: Record<string, unknown> = {}) {
  return {
    round_id: "r-1",
    round_number: 1,
    song_id: "s-1",
    song_title: "Bohemian Rhapsody",
    song_artist: "Queen",
    youtube_id: "abcdefghijk",
    start_time: 0,
    source: "Wayne's World",
    ...overrides,
  };
}

beforeEach(() => {
  resetSupabaseMock();
});

describe("selectNextSongDirect", () => {
  it("calls select_next_song with the manager token and a null p_song_id by default", async () => {
    setRpcResponse({ data: [row()], error: null });

    const result = await selectNextSongDirect("ABCDEF", TOKEN);

    expect(result.round_id).toBe("r-1");
    expect(result.round_number).toBe(1);
    expect(result.song.id).toBe("s-1");
    expect(result.song.title).toBe("Bohemian Rhapsody");
    expect(result.song.artist).toBe("Queen");
    expect(result.song.source).toBe("Wayne's World");
    expect(supabaseMock.rpc).toHaveBeenCalledWith("select_next_song", {
      p_game_code: "ABCDEF",
      p_manager_token: TOKEN,
      p_song_id: null,
    });
  });

  it("forwards an explicit song id for the manual-pick path", async () => {
    setRpcResponse({ data: [row({ song_id: "s-manual" })], error: null });
    await selectNextSongDirect("ABCDEF", TOKEN, "s-manual");
    expect(supabaseMock.rpc).toHaveBeenCalledWith("select_next_song", {
      p_game_code: "ABCDEF",
      p_manager_token: TOKEN,
      p_song_id: "s-manual",
    });
  });

  it("throws RpcError carrying the PL/pgSQL message and sqlstate on a wrong token", async () => {
    setRpcResponse({
      data: null,
      error: { message: "manager_token_required", code: "28000" },
    });
    await expect(selectNextSongDirect("ABCDEF", "wrong-token")).rejects.toMatchObject({
      name: "RpcError",
      message: "manager_token_required",
      sqlstate: "28000",
    });
  });

  it("throws RpcError when the pool is exhausted (no_more_songs)", async () => {
    setRpcResponse({
      data: null,
      error: { message: "no_more_songs", code: "22023" },
    });
    await expect(selectNextSongDirect("ABCDEF", TOKEN)).rejects.toMatchObject({
      name: "RpcError",
      message: "no_more_songs",
    });
  });

  it("raises RpcError when PostgREST returns an empty array (no row from RETURNS TABLE)", async () => {
    setRpcResponse({ data: [], error: null });
    await expect(selectNextSongDirect("ABCDEF", TOKEN)).rejects.toBeInstanceOf(RpcError);
  });

  it("preserves null source on the returned Song shape", async () => {
    setRpcResponse({ data: [row({ source: null })], error: null });
    const result = await selectNextSongDirect("ABCDEF", TOKEN);
    expect(result.song.source).toBeNull();
  });
});
