import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { startSongStart } from "../lib/telemetry";
import { failedVideoContext, useHostPlayer } from "./useHostPlayer";
import { usePlayerReady } from "./usePlayerReady";

vi.mock("../context/useToast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../lib/telemetry", () => ({ startSongStart: vi.fn(), log: vi.fn() }));

const live = { id: "song-1", title: "First", artist: "A", youtube_id: "vid1aaaaaaa" };
const next = { id: "song-2", title: "Second", artist: "B", youtube_id: "vid2bbbbbbb" };

describe("failedVideoContext", () => {
  it("names the candidate whose video failed, whatever its position", () => {
    expect(failedVideoContext("ABCDEF", 150, "vid2bbbbbbb", [live, next])).toEqual({
      code: "150",
      game_code: "ABCDEF",
      youtube_id: "vid2bbbbbbb",
      url: "https://www.youtube.com/watch?v=vid2bbbbbbb",
      song_id: "song-2",
      title: "Second",
      artist: "B",
    });
  });

  it("takes a text code for a load YouTube failed without an error code", () => {
    expect(failedVideoContext("ABCDEF", "no_bytes", "vid1aaaaaaa", [live])).toMatchObject({
      code: "no_bytes",
      youtube_id: "vid1aaaaaaa",
      song_id: "song-1",
    });
  });

  it("keeps the id and URL but omits song fields for an unknown video", () => {
    expect(failedVideoContext("ABCDEF", 100, "otherVIDEO1", [live, next])).toEqual({
      code: "100",
      game_code: "ABCDEF",
      youtube_id: "otherVIDEO1",
      url: "https://www.youtube.com/watch?v=otherVIDEO1",
    });
  });
});

describe("deferred song-start telemetry", () => {
  function setup() {
    const trace = { rpcDone: vi.fn(), loadIssued: vi.fn(), playing: vi.fn(), fail: vi.fn() };
    vi.mocked(startSongStart).mockReturnValueOnce(trace);
    const { result, unmount } = renderHook(() =>
      useHostPlayer("ABCDEF", null, null, usePlayerReady()),
    );
    const loadVideoById = vi.fn();
    result.current.playerRef.current = {
      loadVideoById,
      pause: vi.fn(),
      play: vi.fn(),
      resumeIfPaused: vi.fn(),
      stop: vi.fn(),
    };
    act(() => {
      result.current.beginSongStart("fallback").rpcDone({ roundNumber: 1 });
      result.current.loadSongIntoPlayer({ youtube_id: next.youtube_id, start_time: 15 });
    });
    return { result, trace, loadVideoById, unmount };
  }

  it("starts the playback stage when readiness flushes the load", () => {
    const { result, trace, loadVideoById } = setup();
    expect(trace.loadIssued).not.toHaveBeenCalled();
    expect(loadVideoById).not.toHaveBeenCalled();
    result.current.handlePlayerPlaying("statechange");
    expect(trace.playing).not.toHaveBeenCalled();

    act(() => result.current.onPlayerReady());
    expect(trace.loadIssued).toHaveBeenCalledTimes(1);
    expect(trace.loadIssued).toHaveBeenCalledBefore(loadVideoById);
    expect(loadVideoById).toHaveBeenCalledWith(next.youtube_id, 15);

    result.current.handlePlayerPlaying("poll");
    expect(trace.playing).toHaveBeenCalledExactlyOnceWith("poll");
  });

  it("times out waiting for readiness without marking a load", () => {
    vi.useFakeTimers();
    try {
      const { result, trace, loadVideoById, unmount } = setup();
      act(() => vi.advanceTimersByTime(8000));
      expect(trace.playing).toHaveBeenCalledExactlyOnceWith("timeout");
      expect(trace.loadIssued).not.toHaveBeenCalled();

      act(() => result.current.onPlayerReady());
      expect(loadVideoById).toHaveBeenCalledWith(next.youtube_id, 15);
      expect(trace.loadIssued).not.toHaveBeenCalled();
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });
});
