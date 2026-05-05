import { act, render, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { YouTubePlayer, type YouTubePlayerHandle } from "./YouTubePlayer";

interface FakeYTPlayer {
  loadVideoById: ReturnType<typeof vi.fn>;
  pauseVideo: ReturnType<typeof vi.fn>;
  playVideo: ReturnType<typeof vi.fn>;
  stopVideo: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
}

let lastPlayer: FakeYTPlayer | null = null;
let lastConfig: {
  events?: {
    onReady?: () => void;
    onError?: (event: { data: number }) => void;
  };
} | null = null;

function installFakeYT() {
  function FakePlayer(
    _el: HTMLElement,
    config: {
      events?: {
        onReady?: () => void;
        onError?: (event: { data: number }) => void;
      };
    },
  ): FakeYTPlayer {
    const instance: FakeYTPlayer = {
      loadVideoById: vi.fn(),
      pauseVideo: vi.fn(),
      playVideo: vi.fn(),
      stopVideo: vi.fn(),
      destroy: vi.fn(),
    };
    lastConfig = config;
    lastPlayer = instance;
    return instance;
  }
  (window as unknown as { YT: { Player: unknown } }).YT = {
    Player: FakePlayer,
  };
}

beforeEach(() => {
  lastPlayer = null;
  lastConfig = null;
  delete (window as unknown as { YT?: unknown }).YT;
  delete (window as unknown as { onYouTubeIframeAPIReady?: unknown }).onYouTubeIframeAPIReady;
  document
    .querySelectorAll('script[src="https://www.youtube.com/iframe_api"]')
    .forEach((el) => el.remove());
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("YouTubePlayer", () => {
  it("constructs a player when YT API is already available", async () => {
    installFakeYT();
    render(<YouTubePlayer />);
    await waitFor(() => expect(lastPlayer).not.toBeNull());
  });

  it("forwards loadVideoById, play, pause, stop on the imperative handle", async () => {
    installFakeYT();
    const ref = createRef<YouTubePlayerHandle>();
    render(<YouTubePlayer ref={ref} />);
    await waitFor(() => expect(lastPlayer).not.toBeNull());
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
    await waitFor(() => expect(lastConfig).not.toBeNull());
    act(() => {
      lastConfig?.events?.onReady?.();
    });
    expect(onReady).toHaveBeenCalled();
  });

  it("renders an error message and invokes onError when YT fires onError", async () => {
    installFakeYT();
    const onError = vi.fn();
    const { findByRole } = render(<YouTubePlayer onError={onError} />);
    await waitFor(() => expect(lastConfig).not.toBeNull());
    act(() => {
      lastConfig?.events?.onError?.({ data: 150 });
    });
    const alert = await findByRole("alert");
    expect(alert.textContent).toContain("Video unavailable");
    expect(onError).toHaveBeenCalledWith(150);
  });

  it("keeps the overlay visible on error even when hideOverlay is true", async () => {
    installFakeYT();
    const { findByRole } = render(<YouTubePlayer hideOverlay />);
    await waitFor(() => expect(lastConfig).not.toBeNull());
    act(() => {
      lastConfig?.events?.onReady?.();
    });
    act(() => {
      lastConfig?.events?.onError?.({ data: 100 });
    });
    const alert = await findByRole("alert");
    expect(alert.className).not.toContain("coverHidden");
  });

  it("loads the iframe API script when YT is not yet on window", async () => {
    render(<YouTubePlayer />);
    await waitFor(() =>
      expect(
        document.querySelector('script[src="https://www.youtube.com/iframe_api"]'),
      ).not.toBeNull(),
    );
    // Now simulate the script finishing: install YT and fire the global hook.
    await act(async () => {
      installFakeYT();
      const cb = (window as unknown as { onYouTubeIframeAPIReady?: () => void })
        .onYouTubeIframeAPIReady;
      cb?.();
    });
    await waitFor(() => expect(lastPlayer).not.toBeNull());
  });
});
