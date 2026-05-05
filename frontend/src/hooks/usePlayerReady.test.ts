import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { usePlayerReady } from "./usePlayerReady";

describe("usePlayerReady", () => {
  it("starts not ready with no pending song", () => {
    const { result } = renderHook(() => usePlayerReady());
    expect(result.current.ready).toBe(false);
    expect(result.current.pendingSong).toBeNull();
  });

  it("queues song when not ready", () => {
    const { result } = renderHook(() => usePlayerReady());
    act(() => {
      result.current.enqueueSong({ youtube_id: "abcdefghijk", start_time: 5 });
    });
    expect(result.current.pendingSong).toEqual({
      youtube_id: "abcdefghijk",
      start_time: 5,
    });
  });

  it("does not queue when ready", () => {
    const { result } = renderHook(() => usePlayerReady());
    act(() => {
      result.current.setReady();
    });
    act(() => {
      result.current.enqueueSong({ youtube_id: "abcdefghijk", start_time: 5 });
    });
    expect(result.current.ready).toBe(true);
    expect(result.current.pendingSong).toBeNull();
  });

  it("flushPendingSong returns and clears the queued song", () => {
    const { result } = renderHook(() => usePlayerReady());
    act(() => {
      result.current.enqueueSong({ youtube_id: "abcdefghijk", start_time: 5 });
    });
    let flushed: { youtube_id: string; start_time: number } | null = null;
    act(() => {
      flushed = result.current.flushPendingSong();
    });
    expect(flushed).toEqual({ youtube_id: "abcdefghijk", start_time: 5 });
    expect(result.current.pendingSong).toBeNull();
  });
});
