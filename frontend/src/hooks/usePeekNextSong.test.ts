import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/supabase", async () => {
  const mod = await import("../test/supabaseMock");
  return { supabase: mod.supabaseMock };
});

import { peekNextSongDirect } from "./usePeekNextSong";
import { RpcError } from "./useManagerActions";
import { resetSupabaseMock, setRpcResponse, supabaseMock } from "../test/supabaseMock";

const TOKEN = "11111111-1111-1111-1111-111111111111";

beforeEach(() => {
  resetSupabaseMock();
});

describe("peekNextSongDirect", () => {
  it("calls peek_next_song with the game code and manager token", async () => {
    setRpcResponse({
      data: [
        {
          song_id: "s-1",
          youtube_id: "abcdefghijk",
          start_time: 12,
          song_title: "Peeked Title",
          song_artist: "Peeked Artist",
          is_soundtrack: false,
        },
      ],
      error: null,
    });

    const result = await peekNextSongDirect("ABCDEF", TOKEN);

    expect(result).toEqual({
      song_id: "s-1",
      youtube_id: "abcdefghijk",
      start_time: 12,
      title: "Peeked Title",
      artist: "Peeked Artist",
      is_soundtrack: false,
    });
    expect(supabaseMock.rpc).toHaveBeenCalledWith("peek_next_song", {
      p_game_code: "ABCDEF",
      p_manager_token: TOKEN,
    });
  });

  it("returns null when the pool is exhausted (zero rows)", async () => {
    setRpcResponse({ data: [], error: null });
    await expect(peekNextSongDirect("ABCDEF", TOKEN)).resolves.toBeNull();
  });

  it("returns null when PostgREST returns null data", async () => {
    setRpcResponse({ data: null, error: null });
    await expect(peekNextSongDirect("ABCDEF", TOKEN)).resolves.toBeNull();
  });

  it("throws RpcError carrying the PL/pgSQL message and sqlstate on a wrong token", async () => {
    setRpcResponse({
      data: null,
      error: { message: "manager_token_required", code: "28000" },
    });
    await expect(peekNextSongDirect("ABCDEF", "wrong-token")).rejects.toMatchObject({
      name: "RpcError",
      message: "manager_token_required",
      sqlstate: "28000",
    });
  });

  it("throws RpcError on a generic failure", async () => {
    setRpcResponse({ data: null, error: { message: "boom" } });
    await expect(peekNextSongDirect("ABCDEF", TOKEN)).rejects.toBeInstanceOf(RpcError);
  });
});
