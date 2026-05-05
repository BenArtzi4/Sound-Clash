import { act, render } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  YouTubePlayer,
  type YouTubePlayerHandle,
} from "./YouTubePlayer";

interface FakeYTPlayer {
  loadVideoById: ReturnType<typeof vi.fn>;
  pauseVideo: ReturnType<typeof vi.fn>;
  playVideo: ReturnType<typeof vi.fn>;
  stopVideo: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
}

let lastPlayer: FakeYTPlayer | null = null;
let lastConfig: { events?: { onReady?: () => void } } | null = null;

beforeEach(() => {
  lastPlayer = null;
  lastConfig = null;
  delete (window as unknown as { YT?: unknown }).YT;
  delete (window as unknown as { onYouTubeIframeAPIReady?: unknown })
    .onYouTubeIframeAPIReady;
  document
    .querySelectorAll('script[src="https://www.youtube.com/iframe_api"]')
    .forEach((el) => el.remove());
});

afterEach(() => {
  vi.clearAllMocks();
});

function installFakeYT() {
  (window as unknown as { YT: unknown }).YT = {
    Player: vi.fn(
      (
        _el: HTMLElement,
        config: { events?: { onReady?: () => void } },
      ) => {
        lastConfig = config;
        const player: FakeYTPlayer = {
          loadVideoById: vi.fn(),
          pauseVideo: vi.fn(),
          playVideo: vi.fn(),
          stopVideo: vi.fn(),
          destroy: vi.fn(),
        };
        lastPlayer = player;
        return player;
      },
    ),
  };
}

describe("YouTubePlayer", () => {
  it("loads the iframe API script if YT is missing", async () => {
    render(<YouTubePlayer />);
    await act(async () => {
      // simulate the YT API loading and calling the global hook
      installFakeYT();
      const cb = (
        window as unknown as { onYouTubeIframeAPIReady?: () => void }
      ).onYouTubeIframeAPIReady;
      cb?.();
      await Promise.resolve();
    });
    expect(lastPlayer).not.toBeNull();
  });

  it("forwards loadVideoById, play, pause, stop on the imperative handle", async () => {
    installFakeYT();
    const ref = createRef<YouTubePlayerHandle>();
    render(<YouTubePlayer ref={ref} />);
    await act(async () => {
      await Promise.resolve();
    });
    ref.current?.loadVideoById("abcdefghijk", 12);
    ref.current?.play();
    ref.current?.pause();
    ref.current?.stop();
    expect(lastPlayer?.loadVideoById).toHaveBeenCalledWith({
      videoId: "abcdefghijk",
      startSeconds: 12,
    });
    expect(lastPlayer?.playVideo).toHaveBeenCalled();
    expect(lastPlayer?.pauseVideo).toHaveBeenCalled();
    expect(lastPlayer?.stopVideo).toHaveBeenCalled();
  });

  it("calls onReady when the YT player fires onReady", async () => {
    installFakeYT();
    const onReady = vi.fn();
    render(<YouTubePlayer onReady={onReady} />);
    await act(async () => {
      await Promise.resolve();
      lastConfig?.events?.onReady?.();
    });
    expect(onReady).toHaveBeenCalled();
  });
});
