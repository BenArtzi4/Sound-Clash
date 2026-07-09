import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./supabase", async () => {
  const mod = await import("../test/supabaseMock");
  return { supabase: mod.supabaseMock };
});

import {
  getSongFetchAttempts,
  resetSupabaseMock,
  setSongFetch,
  setSongFetchFailures,
} from "../test/supabaseMock";
import { fetchSongById, SONG_FETCH_RETRY_DELAYS_MS } from "./songMetadata";

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
    setSongFetch(SONG);
    const song = await fetchSongById("song-1");
    expect(song).toMatchObject({
      id: "song-1",
      title: "Take On Me",
      artist: "a-ha",
      youtube_id: "djV11Xbc914",
      start_time: 10,
      is_soundtrack: false,
    });
    expect(getSongFetchAttempts()).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("derives is_soundtrack from the embedded genre slugs", async () => {
    setSongFetch({ ...SONG, is_soundtrack: true });
    const song = await fetchSongById("song-1");
    expect(song?.is_soundtrack).toBe(true);
  });

  it("retries a transient error and resolves once the fetch succeeds", async () => {
    setSongFetch(SONG);
    setSongFetchFailures(1);
    const promise = fetchSongById("song-1");
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
    const promise = fetchSongById("song-1");
    await vi.advanceTimersByTimeAsync(0);
    for (const delayMs of SONG_FETCH_RETRY_DELAYS_MS) {
      await vi.advanceTimersByTimeAsync(delayMs);
    }
    expect(await promise).toBeNull();
    expect(getSongFetchAttempts()).toBe(SONG_FETCH_RETRY_DELAYS_MS.length + 1);
    // The schedule is exhausted: no further timer is pending.
    expect(vi.getTimerCount()).toBe(0);
  });

  it("treats a missing row as authoritative and does not retry", async () => {
    // No setSongFetch: the mock returns { data: null, error: null }.
    const song = await fetchSongById("song-unknown");
    expect(song).toBeNull();
    expect(getSongFetchAttempts()).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops retrying once cancelled", async () => {
    setSongFetch(SONG);
    setSongFetchFailures(Number.MAX_SAFE_INTEGER);
    let cancelled = false;
    const promise = fetchSongById("song-1", () => cancelled);
    await vi.advanceTimersByTimeAsync(0);
    expect(getSongFetchAttempts()).toBe(1);
    cancelled = true;
    await vi.advanceTimersByTimeAsync(500);
    expect(await promise).toBeNull();
    // The pending backoff resolved into the cancellation check — no attempt 2.
    expect(getSongFetchAttempts()).toBe(1);
  });
});
