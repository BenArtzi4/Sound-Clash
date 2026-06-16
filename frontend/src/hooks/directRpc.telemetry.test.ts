import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/supabase", async () => {
  const mod = await import("../test/supabaseMock");
  return { supabase: mod.supabaseMock };
});

// tracedRpc passes through to run() so the supabase mock drives the result; we
// only assert each direct RPC is wrapped with the right span name.
const telemetry = vi.hoisted(() => ({
  tracedRpc: vi.fn((_name: string, _attrs: unknown, run: () => unknown) => run()),
}));
vi.mock("../lib/telemetry", () => telemetry);

import { awardAttemptDirect, releaseBuzzLockDirect } from "./useManagerActions";
import { selectNextSongDirect } from "./useSelectNextSong";
import { peekNextSongDirect } from "./usePeekNextSong";
import { resetSupabaseMock, setRpcResponse } from "../test/supabaseMock";

const TOKEN = "11111111-1111-1111-1111-111111111111";

beforeEach(() => {
  resetSupabaseMock();
  telemetry.tracedRpc.mockClear();
  telemetry.tracedRpc.mockImplementation((_n: string, _a: unknown, run: () => unknown) => run());
});

describe("direct-RPC telemetry wiring", () => {
  it("wraps select_next_song", async () => {
    setRpcResponse({
      data: [
        {
          round_id: "r-1",
          round_number: 1,
          song_id: "s-1",
          song_title: "T",
          song_artist: "A",
          youtube_id: "yt",
          start_time: 0,
          is_soundtrack: false,
        },
      ],
      error: null,
    });
    await selectNextSongDirect("ABCDEF", TOKEN);
    expect(telemetry.tracedRpc).toHaveBeenCalledWith(
      "select_next_song",
      { game_code: "ABCDEF" },
      expect.any(Function),
    );
  });

  it("wraps peek_next_song", async () => {
    setRpcResponse({
      data: [{ song_id: "s-1", youtube_id: "yt", start_time: 0 }],
      error: null,
    });
    await peekNextSongDirect("ABCDEF", TOKEN);
    expect(telemetry.tracedRpc).toHaveBeenCalledWith(
      "peek_next_song",
      { game_code: "ABCDEF" },
      expect.any(Function),
    );
  });

  it("wraps award_attempt", async () => {
    setRpcResponse({
      data: [
        {
          team_id: "team-1",
          points_delta: 10,
          team_total_score: 10,
          title_claimed_by: null,
          artist_claimed_by: null,
        },
      ],
      error: null,
    });
    await awardAttemptDirect("ABCDEF", TOKEN, "r-1", {
      title_correct: true,
      artist_correct: false,
      wrong_buzz: false,
    });
    expect(telemetry.tracedRpc).toHaveBeenCalledWith(
      "award_attempt",
      { game_code: "ABCDEF" },
      expect.any(Function),
    );
  });

  it("wraps release_buzz_lock", async () => {
    setRpcResponse({ data: null, error: null });
    await releaseBuzzLockDirect("ABCDEF", TOKEN);
    expect(telemetry.tracedRpc).toHaveBeenCalledWith(
      "release_buzz_lock",
      { game_code: "ABCDEF" },
      expect.any(Function),
    );
  });
});
