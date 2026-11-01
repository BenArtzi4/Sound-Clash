import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./supabase", async () => {
  const mod = await import("../test/supabaseMock");
  return { supabase: mod.supabaseMock };
});

import {
  getSongBatchAttempts,
  getSongFetchAttempts,
  resetSupabaseMock,
  setSongBatchFailures,
  setSongFetch,
  setSongFetchFailures,
  supabaseMock,
} from "../test/supabaseMock";
import {
  fetchSongById,
  fetchSongsByIds,
  SETLIST_FETCH_RETRY_DELAYS_MS,
  SONG_FETCH_RETRY_DELAYS_MS,
} from "./songMetadata";

const SONG = {
  id: "song-1",
  title: "Take On Me",
  artist: "a-ha",
  youtube_id: "djV11Xbc914",
  start_time: 10,
};

beforeEach(() => {
  resetSupabaseMock();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("fetchSongById", () => {
  it("resolves on the first attempt without scheduling a retry", async () => {
    setSongFetch({ ...SONG, release_year: 1985 });
    const song = await fetchSongById("ABCDEF", "song-1");
    expect(song).toEqual({
      id: "song-1",
      title: "Take On Me",
      artist: "a-ha",
      youtube_id: "djV11Xbc914",
      start_time: 10,
      release_year: 1985,
      is_soundtrack: false,
    });
    expect(getSongFetchAttempts()).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("asks the game-scoped round_song RPC, never the songs table", async () => {
    setSongFetch(SONG);
    await fetchSongById("ABCDEF", "song-1");
    expect(supabaseMock.rpc).toHaveBeenCalledTimes(1);
    expect(supabaseMock.rpc).toHaveBeenCalledWith("round_song", {
      p_game_code: "ABCDEF",
      p_song_id: "song-1",
    });
    expect(supabaseMock.from).not.toHaveBeenCalled();
  });

  it("derives is_soundtrack from the embedded genre slugs", async () => {
    setSongFetch({ ...SONG, is_soundtrack: true });
    const song = await fetchSongById("ABCDEF", "song-1");
    expect(song?.is_soundtrack).toBe(true);
  });

  it("retries a transient error and resolves once the fetch succeeds", async () => {
    setSongFetch(SONG);
    setSongFetchFailures(1);
    const promise = fetchSongById("ABCDEF", "song-1");
    // Let the first (failing) attempt settle and schedule its retry.
    await vi.advanceTimersByTimeAsync(0);
    expect(getSongFetchAttempts()).toBe(1);
    await vi.advanceTimersByTimeAsync(500);
    const song = await promise;
    expect(song?.title).toBe("Take On Me");
    expect(getSongFetchAttempts()).toBe(2);
  });

  it("gives up after exhausting the bounded retry schedule", async () => {
    setSongFetch(SONG);
    setSongFetchFailures(Number.MAX_SAFE_INTEGER);
    const promise = fetchSongById("ABCDEF", "song-1");
    await vi.advanceTimersByTimeAsync(0);
    for (const delayMs of SONG_FETCH_RETRY_DELAYS_MS) {
      await vi.advanceTimersByTimeAsync(delayMs);
    }
    expect(await promise).toBeNull();
    expect(getSongFetchAttempts()).toBe(SONG_FETCH_RETRY_DELAYS_MS.length + 1);
    // The schedule is exhausted: no further timer is pending.
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retries when the request itself throws (network failure)", async () => {
    setSongFetch(SONG);
    supabaseMock.rpc.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const promise = fetchSongById("ABCDEF", "song-1");
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(500);
    expect((await promise)?.title).toBe("Take On Me");
    expect(supabaseMock.rpc).toHaveBeenCalledTimes(2);
  });

  it("treats a missing row as authoritative and does not retry", async () => {
    // No setSongFetch: the mock returns { data: null, error: null }.
    const song = await fetchSongById("ABCDEF", "song-unknown");
    expect(song).toBeNull();
    expect(getSongFetchAttempts()).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops retrying once cancelled", async () => {
    setSongFetch(SONG);
    setSongFetchFailures(Number.MAX_SAFE_INTEGER);
    let cancelled = false;
    const promise = fetchSongById("ABCDEF", "song-1", () => cancelled);
    await vi.advanceTimersByTimeAsync(0);
    expect(getSongFetchAttempts()).toBe(1);
    cancelled = true;
    await vi.advanceTimersByTimeAsync(500);
    expect(await promise).toBeNull();
    // The pending backoff resolved into the cancellation check — no attempt 2.
    expect(getSongFetchAttempts()).toBe(1);
  });
});

describe("fetchSongsByIds", () => {
  it("asks game_setlist once and maps the requested ids", async () => {
    setSongFetch({ ...SONG, release_year: 1985 });
    setSongFetch({ id: "song-2", title: "Two", artist: "B", youtube_id: "bbbbbbbbbbb" });
    setSongFetch({
      id: "song-3",
      title: "Theme",
      artist: "Film",
      youtube_id: "ccccccccccc",
      is_soundtrack: true,
    });
    const map = await fetchSongsByIds("ABCDEF", ["song-1", "song-3", "song-missing"]);
    expect(supabaseMock.rpc).toHaveBeenCalledTimes(1);
    expect(supabaseMock.rpc).toHaveBeenCalledWith("game_setlist", { p_game_code: "ABCDEF" });
    expect(supabaseMock.from).not.toHaveBeenCalled();
    // Only the ids asked for; a missing one is simply absent.
    expect([...(map?.keys() ?? [])]).toEqual(["song-1", "song-3"]);
    expect(map?.get("song-1")).toEqual({
      id: "song-1",
      title: "Take On Me",
      artist: "a-ha",
      youtube_id: "djV11Xbc914",
      release_year: 1985,
      is_soundtrack: false,
    });
    expect(map?.get("song-3")?.is_soundtrack).toBe(true);
  });

  it("keeps one entry when a song played in two rounds", async () => {
    supabaseMock.rpc.mockImplementationOnce(async () => ({
      data: [1, 2].map((round_number) => ({
        round_number,
        id: "song-1",
        title: "Again",
        artist: "A",
        youtube_id: "aaaaaaaaaaa",
        start_time: 0,
        release_year: null,
        genre_slugs: ["rock"],
      })),
      error: null,
    }));
    const map = await fetchSongsByIds("ABCDEF", ["song-1"]);
    expect(map?.size).toBe(1);
    expect(map?.get("song-1")?.title).toBe("Again");
  });

  it("treats a null genre_slugs as no genre", async () => {
    supabaseMock.rpc.mockImplementationOnce(async () => ({
      data: [
        {
          round_number: 1,
          id: "song-1",
          title: "T",
          artist: "A",
          youtube_id: "aaaaaaaaaaa",
          start_time: 0,
          release_year: null,
          genre_slugs: null,
        },
      ],
      error: null,
    }));
    const map = await fetchSongsByIds("ABCDEF", ["song-1"]);
    expect(map?.get("song-1")?.is_soundtrack).toBe(false);
  });

  it("retries when the request itself throws (network failure)", async () => {
    setSongFetch(SONG);
    supabaseMock.rpc.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const promise = fetchSongsByIds("ABCDEF", ["song-1"]);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(SETLIST_FETCH_RETRY_DELAYS_MS[0] ?? 0);
    expect((await promise)?.get("song-1")?.title).toBe("Take On Me");
    expect(supabaseMock.rpc).toHaveBeenCalledTimes(2);
  });

  it("retries a failed read, then gives up and returns null", async () => {
    setSongFetch(SONG);
    setSongBatchFailures(Number.MAX_SAFE_INTEGER);
    const promise = fetchSongsByIds("ABCDEF", ["song-1"]);
    await vi.advanceTimersByTimeAsync(0);
    for (const delayMs of SETLIST_FETCH_RETRY_DELAYS_MS) {
      await vi.advanceTimersByTimeAsync(delayMs);
    }
    expect(await promise).toBeNull();
    expect(getSongBatchAttempts()).toBe(SETLIST_FETCH_RETRY_DELAYS_MS.length + 1);
  });
});
