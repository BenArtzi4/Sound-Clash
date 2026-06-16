import { act, render, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { YouTubePlayer, type YouTubePlayerHandle } from "./YouTubePlayer";

interface FakeYTPlayer {
  loadVideoById: ReturnType<typeof vi.fn>;
  pauseVideo: ReturnType<typeof vi.fn>;
  playVideo: ReturnType<typeof vi.fn>;
  stopVideo: ReturnType<typeof vi.fn>;
  mute: ReturnType<typeof vi.fn>;
  unMute: ReturnType<typeof vi.fn>;
  seekTo: ReturnType<typeof vi.fn>;
  getPlayerState: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
}

let lastPlayer: FakeYTPlayer | null = null;
let lastConfig: {
  events?: {
    onReady?: () => void;
    onError?: (event: { data: number }) => void;
    onStateChange?: (event: { data: number }) => void;
  };
} | null = null;

function installFakeYT() {
  function FakePlayer(
    _el: HTMLElement,
    config: {
      events?: {
        onReady?: () => void;
        onError?: (event: { data: number }) => void;
        onStateChange?: (event: { data: number }) => void;
      };
    },
  ): FakeYTPlayer {
    const instance: FakeYTPlayer = {
      loadVideoById: vi.fn(),
      pauseVideo: vi.fn(),
      playVideo: vi.fn(),
      stopVideo: vi.fn(),
      mute: vi.fn(),
      unMute: vi.fn(),
      seekTo: vi.fn(),
      getPlayerState: vi.fn(() => 1),
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

// In jsdom the iframe never actually navigates, so the `load` event the
// production mount effect awaits before constructing the YT.Player has to
// be dispatched manually. In real browsers the iframe genuinely loads once
// at youtube-nocookie.com and emits `load` itself.
async function flushIframeLoad(container: HTMLElement): Promise<void> {
  // Yield to the microtask queue so the effect's `await loadApi()` resolves
  // and the `addEventListener('load', ...)` call has run before we dispatch.
  await act(async () => {
    await Promise.resolve();
  });
  const iframe = container.querySelector("iframe");
  if (!iframe) return;
  await act(async () => {
    iframe.dispatchEvent(new Event("load"));
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("YouTubePlayer", () => {
  it("constructs a player when YT API is already available", async () => {
    installFakeYT();
    const { container } = render(<YouTubePlayer />);
    await flushIframeLoad(container);
    await waitFor(() => expect(lastPlayer).not.toBeNull());
  });

  it("forwards loadVideoById, play, pause, stop on the imperative handle", async () => {
    installFakeYT();
    const ref = createRef<YouTubePlayerHandle>();
    const { container } = render(<YouTubePlayer ref={ref} />);
    await flushIframeLoad(container);
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
    const { container } = render(<YouTubePlayer onReady={onReady} />);
    await flushIframeLoad(container);
    await waitFor(() => expect(lastConfig).not.toBeNull());
    act(() => {
      lastConfig?.events?.onReady?.();
    });
    expect(onReady).toHaveBeenCalled();
  });

  it("renders an error message and invokes onError when YT fires onError", async () => {
    installFakeYT();
    const onError = vi.fn();
    const { findByRole, container } = render(<YouTubePlayer onError={onError} />);
    await flushIframeLoad(container);
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
    const { findByRole, container } = render(<YouTubePlayer hideOverlay />);
    await flushIframeLoad(container);
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

  it("re-shows the cover and stops the video when the song ends", async () => {
    installFakeYT();
    const ref = createRef<YouTubePlayerHandle>();
    const { container } = render(<YouTubePlayer ref={ref} hideOverlay />);
    await flushIframeLoad(container);
    await waitFor(() => expect(lastConfig).not.toBeNull());
    // After ready the cover is hidden so the video is visible.
    act(() => {
      lastConfig?.events?.onReady?.();
    });
    let cover = container.querySelector('[class*="cover"]');
    expect(cover?.className).toContain("coverHidden");
    // Now the YT player fires ENDED (state code 0). The cover must come back
    // (so YouTube's endscreen can't be seen or clicked through to other songs)
    // and stopVideo must be called to halt playback.
    act(() => {
      lastConfig?.events?.onStateChange?.({ data: 0 });
    });
    cover = container.querySelector('[class*="cover"]');
    expect(cover?.className).not.toContain("coverHidden");
    expect(cover?.textContent).toMatch(/song ended/i);
    expect(lastPlayer?.stopVideo).toHaveBeenCalled();
  });

  it("hides the cover again when loadVideoById is called after a previous ENDED", async () => {
    installFakeYT();
    const ref = createRef<YouTubePlayerHandle>();
    const { container } = render(<YouTubePlayer ref={ref} hideOverlay />);
    await flushIframeLoad(container);
    await waitFor(() => expect(lastConfig).not.toBeNull());
    act(() => {
      lastConfig?.events?.onReady?.();
    });
    act(() => {
      lastConfig?.events?.onStateChange?.({ data: 0 });
    });
    expect(container.querySelector('[class*="cover"]')?.className).not.toContain("coverHidden");
    // Manager picks Next round -> loadVideoById on the imperative handle.
    act(() => {
      ref.current?.loadVideoById("xxxxxxxxxxx", 0);
    });
    expect(container.querySelector('[class*="cover"]')?.className).toContain("coverHidden");
  });

  it("non-ENDED state changes do not bring the cover back", async () => {
    installFakeYT();
    const { container } = render(<YouTubePlayer hideOverlay />);
    await flushIframeLoad(container);
    await waitFor(() => expect(lastConfig).not.toBeNull());
    act(() => {
      lastConfig?.events?.onReady?.();
    });
    // YT.PlayerState.PLAYING = 1, PAUSED = 2, BUFFERING = 3, CUED = 5.
    for (const code of [1, 2, 3, 5]) {
      act(() => {
        lastConfig?.events?.onStateChange?.({ data: code });
      });
    }
    expect(container.querySelector('[class*="cover"]')?.className).toContain("coverHidden");
    expect(lastPlayer?.stopVideo).not.toHaveBeenCalled();
  });

  it("loadVideoById clears a previous onError so the next song doesn't inherit 'Video unavailable'", async () => {
    installFakeYT();
    const ref = createRef<YouTubePlayerHandle>();
    const { container, findByRole, queryByRole } = render(<YouTubePlayer ref={ref} hideOverlay />);
    await flushIframeLoad(container);
    await waitFor(() => expect(lastConfig).not.toBeNull());
    act(() => {
      lastConfig?.events?.onReady?.();
    });
    // First song fails: YT fires onError -> cover shows the error.
    act(() => {
      lastConfig?.events?.onError?.({ data: 150 });
    });
    expect((await findByRole("alert")).textContent).toContain("Video unavailable");
    // Manager clicks Next round: loadVideoById must reset errorCode so the
    // next song's load doesn't keep the old error overlay on screen.
    act(() => {
      ref.current?.loadVideoById("xxxxxxxxxxx", 0);
    });
    expect(queryByRole("alert")).toBeNull();
  });

  it("noCover prop renders only the iframe with no overlay element", async () => {
    installFakeYT();
    const ref = createRef<YouTubePlayerHandle>();
    const { container, queryByRole, queryByText } = render(<YouTubePlayer ref={ref} noCover />);
    await flushIframeLoad(container);
    await waitFor(() => expect(lastConfig).not.toBeNull());
    // Even after all the events that would normally surface a cover, none
    // of the cover labels should render in noCover mode.
    act(() => {
      lastConfig?.events?.onReady?.();
    });
    act(() => {
      lastConfig?.events?.onError?.({ data: 150 });
    });
    act(() => {
      lastConfig?.events?.onStateChange?.({ data: 0 });
    });
    expect(queryByRole("alert")).toBeNull();
    expect(queryByText(/video unavailable/i)).toBeNull();
    expect(queryByText(/song ended/i)).toBeNull();
    expect(queryByText(/loading player/i)).toBeNull();
    // The iframe itself is still mounted and the imperative handle still works.
    expect(container.querySelector("iframe")).not.toBeNull();
  });

  it("noCover still invokes the onError callback so parents can react", async () => {
    installFakeYT();
    const onError = vi.fn();
    const { container } = render(<YouTubePlayer noCover onError={onError} />);
    await flushIframeLoad(container);
    await waitFor(() => expect(lastConfig).not.toBeNull());
    act(() => {
      lastConfig?.events?.onError?.({ data: 150 });
    });
    expect(onError).toHaveBeenCalledWith(150);
  });

  it("uses a custom testId on the wrapper when provided", async () => {
    installFakeYT();
    const { container } = render(<YouTubePlayer noCover testId="youtube-player-preload" />);
    await flushIframeLoad(container);
    await waitFor(() => expect(lastPlayer).not.toBeNull());
    expect(container.querySelector('[data-testid="youtube-player-preload"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="youtube-player"]')).toBeNull();
  });

  it("prebuffer mutes, loads, and freezes the video on PLAYING without firing onPlaying", async () => {
    installFakeYT();
    const onPlaying = vi.fn();
    const ref = createRef<YouTubePlayerHandle>();
    const { container } = render(<YouTubePlayer ref={ref} noCover onPlaying={onPlaying} />);
    await flushIframeLoad(container);
    await waitFor(() => expect(lastConfig).not.toBeNull());
    act(() => {
      lastConfig?.events?.onReady?.();
    });

    act(() => {
      ref.current?.prebuffer("nextvideoid", 30);
    });
    expect(lastPlayer?.mute).toHaveBeenCalled();
    expect(lastPlayer?.loadVideoById).toHaveBeenCalledWith({
      videoId: "nextvideoid",
      startSeconds: 30,
    });

    // The silently-buffering player reaches PLAYING: it must be paused (frozen,
    // buffered) and must NOT resolve the song-start span.
    act(() => {
      lastConfig?.events?.onStateChange?.({ data: 1 });
    });
    expect(lastPlayer?.pauseVideo).toHaveBeenCalled();
    expect(onPlaying).not.toHaveBeenCalled();
  });

  it("commitPrebuffered seeks, unmutes, plays, and re-arms onPlaying for the resume", async () => {
    installFakeYT();
    const onPlaying = vi.fn();
    const ref = createRef<YouTubePlayerHandle>();
    const { container } = render(<YouTubePlayer ref={ref} noCover onPlaying={onPlaying} />);
    await flushIframeLoad(container);
    await waitFor(() => expect(lastConfig).not.toBeNull());
    act(() => {
      lastConfig?.events?.onReady?.();
    });

    // Prebuffer + freeze.
    act(() => {
      ref.current?.prebuffer("nextvideoid", 30);
    });
    act(() => {
      lastConfig?.events?.onStateChange?.({ data: 1 });
    });
    expect(onPlaying).not.toHaveBeenCalled();

    // Host clicks Next round -> promote the buffered video to live playback.
    act(() => {
      ref.current?.commitPrebuffered(30);
    });
    expect(lastPlayer?.seekTo).toHaveBeenCalledWith(30, true);
    expect(lastPlayer?.unMute).toHaveBeenCalled();
    expect(lastPlayer?.playVideo).toHaveBeenCalled();

    // The resume reaches PLAYING: now onPlaying fires exactly once.
    act(() => {
      lastConfig?.events?.onStateChange?.({ data: 1 });
    });
    expect(onPlaying).toHaveBeenCalledTimes(1);
    expect(onPlaying).toHaveBeenCalledWith("statechange");
  });

  it("loadVideoById unmutes (recovering a player previously used as a muted prebuffer)", async () => {
    installFakeYT();
    const ref = createRef<YouTubePlayerHandle>();
    const { container } = render(<YouTubePlayer ref={ref} noCover />);
    await flushIframeLoad(container);
    await waitFor(() => expect(lastPlayer).not.toBeNull());
    act(() => {
      ref.current?.prebuffer("a", 0);
    });
    act(() => {
      ref.current?.loadVideoById("b", 0);
    });
    expect(lastPlayer?.unMute).toHaveBeenCalled();
    expect(lastPlayer?.loadVideoById).toHaveBeenLastCalledWith({ videoId: "b", startSeconds: 0 });
  });

  it("loads the iframe API script when YT is not yet on window", async () => {
    const { container } = render(<YouTubePlayer />);
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
    await flushIframeLoad(container);
    await waitFor(() => expect(lastPlayer).not.toBeNull());
  });
});
