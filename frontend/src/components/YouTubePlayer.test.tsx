import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef, type ComponentProps } from "react";
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
  getCurrentTime: ReturnType<typeof vi.fn>;
  getDuration: ReturnType<typeof vi.fn>;
  getPlayerState: ReturnType<typeof vi.fn>;
  getVideoLoadedFraction: ReturnType<typeof vi.fn>;
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
      getCurrentTime: vi.fn(() => 0),
      getDuration: vi.fn(() => 0),
      getPlayerState: vi.fn(() => 1),
      getVideoLoadedFraction: vi.fn(() => 0),
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

  it("resumeIfPaused resumes only when paused (state 2), never when playing or ended", async () => {
    installFakeYT();
    const ref = createRef<YouTubePlayerHandle>();
    const { container } = render(<YouTubePlayer ref={ref} noCover />);
    await flushIframeLoad(container);
    await waitFor(() => expect(lastPlayer).not.toBeNull());

    // Playing (1): no resume — nothing to do.
    lastPlayer?.getPlayerState.mockReturnValue(1);
    act(() => ref.current?.resumeIfPaused());
    expect(lastPlayer?.playVideo).not.toHaveBeenCalled();

    // Ended (0): no resume — a finished clip must not be replayed (spoiler).
    lastPlayer?.getPlayerState.mockReturnValue(0);
    act(() => ref.current?.resumeIfPaused());
    expect(lastPlayer?.playVideo).not.toHaveBeenCalled();

    // Paused (2): resume — the tab was backgrounded / phone locked.
    lastPlayer?.getPlayerState.mockReturnValue(2);
    act(() => ref.current?.resumeIfPaused());
    expect(lastPlayer?.playVideo).toHaveBeenCalledTimes(1);
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
    expect(onError).toHaveBeenCalledWith(150, null);
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

  it("noCover never shows the error, ended or loading labels", async () => {
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
    expect(onError).toHaveBeenCalledWith(150, null);
  });

  it("noCover covers the empty player with the idle label until a video loads", async () => {
    installFakeYT();
    const ref = createRef<YouTubePlayerHandle>();
    const { container, queryByText, rerender } = render(
      <YouTubePlayer ref={ref} noCover idleLabel="Loading player…" />,
    );
    await flushIframeLoad(container);
    await waitFor(() => expect(lastConfig).not.toBeNull());
    expect(queryByText("Loading player…")).not.toBeNull();
    rerender(<YouTubePlayer ref={ref} noCover idleLabel="Ready — press Start game" />);
    expect(queryByText("Ready — press Start game")).not.toBeNull();
    act(() => {
      ref.current?.loadVideoById("liveVIDEO01", 0);
    });
    expect(queryByText("Ready — press Start game")).toBeNull();
  });

  it("noCover lifts the idle panel once a video is prebuffered, so a promoted standby is never covered", async () => {
    installFakeYT();
    const ref = createRef<YouTubePlayerHandle>();
    const { container, queryByText } = render(
      <YouTubePlayer ref={ref} noCover idleLabel="Ready — press Start game" />,
    );
    await flushIframeLoad(container);
    await waitFor(() => expect(lastConfig).not.toBeNull());
    act(() => {
      ref.current?.prebuffer("nextVIDEO01", 5);
    });
    expect(queryByText("Ready — press Start game")).toBeNull();
    act(() => {
      ref.current?.commitPrebuffered(5);
    });
    expect(queryByText("Ready — press Start game")).toBeNull();
  });

  it("noCover keeps the idle panel over an empty player that errors", async () => {
    // YouTube's empty embed sometimes shows its own "An error occurred"
    // screen (code 2) on the waiting screen; the panel must keep hiding it.
    installFakeYT();
    const onError = vi.fn();
    const { container, queryByText } = render(
      <YouTubePlayer noCover onError={onError} idleLabel="Ready — press Start game" />,
    );
    await flushIframeLoad(container);
    await waitFor(() => expect(lastConfig).not.toBeNull());
    act(() => {
      lastConfig?.events?.onError?.({ data: 2 });
    });
    expect(onError).toHaveBeenCalledWith(2, null);
    expect(queryByText("Ready — press Start game")).not.toBeNull();
  });

  it("reports the id of the video that failed (load, then prebuffer)", async () => {
    installFakeYT();
    const onError = vi.fn();
    const ref = createRef<YouTubePlayerHandle>();
    const { container } = render(<YouTubePlayer ref={ref} noCover onError={onError} />);
    await flushIframeLoad(container);
    await waitFor(() => expect(lastConfig).not.toBeNull());
    act(() => {
      ref.current?.loadVideoById("liveVIDEO01", 0);
    });
    act(() => {
      lastConfig?.events?.onError?.({ data: 150 });
    });
    expect(onError).toHaveBeenLastCalledWith(150, "liveVIDEO01");
    act(() => {
      ref.current?.prebuffer("nextVIDEO01", 5);
    });
    act(() => {
      lastConfig?.events?.onError?.({ data: 101 });
    });
    expect(onError).toHaveBeenLastCalledWith(101, "nextVIDEO01");
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

// Song-stall work (2026-10-15). When YouTube fails to load a video it often
// sends no onError at all: the player just sits there, BUFFERING or UNSTARTED,
// with nothing loaded. The console needs to see that on the hidden standby
// (prebufferStatus) and to log it on the live player (onStartStall,
// onEarlyPause). All timing below runs on fake timers, which fake Date too.
describe("YouTubePlayer load health", () => {
  let visibility: "visible" | "hidden" = "visible";
  function setVisibility(v: "visible" | "hidden") {
    visibility = v;
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
  }

  beforeEach(() => {
    visibility = "visible";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibility,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    // Drop the own-property stub so jsdom's own getter is back for later files.
    Reflect.deleteProperty(document, "visibilityState");
  });

  async function mount(props: Partial<ComponentProps<typeof YouTubePlayer>> = {}) {
    installFakeYT();
    const ref = createRef<YouTubePlayerHandle>();
    const utils = render(<YouTubePlayer ref={ref} noCover {...props} />);
    await flushIframeLoad(utils.container);
    await waitFor(() => expect(lastConfig).not.toBeNull());
    act(() => {
      lastConfig?.events?.onReady?.();
    });
    vi.useFakeTimers();
    const player = lastPlayer;
    if (!player) throw new Error("player not constructed");
    return { ref, player, ...utils };
  }
  const state = (data: number) =>
    act(() => {
      lastConfig?.events?.onStateChange?.({ data });
    });
  const advance = (ms: number) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });

  describe("prebufferStatus", () => {
    it("is null unless the player is holding a prebuffer", async () => {
      const { ref } = await mount();
      expect(ref.current?.prebufferStatus()).toBeNull();
      act(() => ref.current?.prebuffer("nextVIDEO01", 30));
      expect(ref.current?.prebufferStatus()).not.toBeNull();
      act(() => ref.current?.commitPrebuffered(30));
      expect(ref.current?.prebufferStatus()).toBeNull();

      act(() => ref.current?.prebuffer("nextVIDEO02", 0));
      act(() => ref.current?.loadVideoById("liveVIDEO01", 0));
      expect(ref.current?.prebufferStatus()).toBeNull();

      act(() => ref.current?.prebuffer("nextVIDEO03", 0));
      act(() => ref.current?.stop());
      expect(ref.current?.prebufferStatus()).toBeNull();
    });

    it("reports the load's age, loaded fraction and player state, then the freeze", async () => {
      const { ref, player } = await mount();
      player.getPlayerState.mockReturnValue(3);
      player.getVideoLoadedFraction.mockReturnValue(0);
      act(() => ref.current?.prebuffer("nextVIDEO01", 30));
      await advance(4000);
      expect(ref.current?.prebufferStatus()).toEqual({
        frozen: false,
        loadedFraction: 0,
        state: 3,
        ageMs: 4000,
      });

      player.getVideoLoadedFraction.mockReturnValue(0.12);
      state(1); // first PLAYING: the prebuffer freezes it
      expect(ref.current?.prebufferStatus()).toMatchObject({ frozen: true, loadedFraction: 0.12 });
    });

    it("restarts the age for a fresh prebuffer", async () => {
      const { ref } = await mount();
      act(() => ref.current?.prebuffer("nextVIDEO01", 30));
      await advance(10_000);
      act(() => ref.current?.prebuffer("nextVIDEO02", 12));
      await advance(2500);
      expect(ref.current?.prebufferStatus()?.ageMs).toBe(2500);
    });

    it("retryPrebuffer re-issues the same load and keeps its age", async () => {
      // The age at Next round counts from the song's FIRST prebuffer, so a
      // retry that is still young can't make a dead standby look fresh.
      const { ref, player } = await mount();
      act(() => ref.current?.prebuffer("nextVIDEO01", 30));
      await advance(10_000);
      act(() => ref.current?.retryPrebuffer());
      expect(player.loadVideoById).toHaveBeenCalledTimes(2);
      expect(player.loadVideoById).toHaveBeenLastCalledWith({
        videoId: "nextVIDEO01",
        startSeconds: 30,
      });
      expect(player.mute).toHaveBeenCalledTimes(2);
      await advance(2500);
      expect(ref.current?.prebufferStatus()).toMatchObject({ frozen: false, ageMs: 12_500 });
    });

    it("retryPrebuffer does nothing without a prebuffer to retry, or once it froze", async () => {
      const { ref, player } = await mount();
      act(() => ref.current?.retryPrebuffer());
      expect(player.loadVideoById).not.toHaveBeenCalled();
      act(() => ref.current?.prebuffer("nextVIDEO01", 30));
      state(1); // frozen: ready, nothing to retry
      act(() => ref.current?.retryPrebuffer());
      act(() => ref.current?.commitPrebuffered(30));
      act(() => ref.current?.retryPrebuffer());
      expect(player.loadVideoById).toHaveBeenCalledTimes(1);
    });

    it("adds up the visible time since the prebuffer, across hidden spells", async () => {
      const { ref } = await mount();
      act(() => ref.current?.prebuffer("nextVIDEO01", 30));
      await advance(9000);
      setVisibility("hidden");
      await advance(2000);
      expect(ref.current?.prebufferStatus()?.ageMs).toBe(9000);
      setVisibility("visible");
      await advance(5000);
      expect(ref.current?.prebufferStatus()?.ageMs).toBe(14_000);
    });

    it("keeps the visible time a retry inherits across a hidden spell", async () => {
      const { ref } = await mount();
      act(() => ref.current?.prebuffer("nextVIDEO01", 30));
      await advance(6000);
      setVisibility("hidden");
      await advance(30_000);
      setVisibility("visible");
      await advance(4000);
      act(() => ref.current?.retryPrebuffer());
      await advance(1000);
      expect(ref.current?.prebufferStatus()?.ageMs).toBe(11_000);
    });

    it("ages a prebuffer issued while hidden only from when the page shows", async () => {
      const { ref } = await mount();
      setVisibility("hidden");
      act(() => ref.current?.prebuffer("nextVIDEO01", 30));
      await advance(5000);
      expect(ref.current?.prebufferStatus()?.ageMs).toBe(0);
      setVisibility("visible");
      await advance(1500);
      expect(ref.current?.prebufferStatus()?.ageMs).toBe(1500);
    });
  });

  describe("onStartStall", () => {
    it("fires once when a loaded song has not started 10 s later", async () => {
      const onStartStall = vi.fn();
      const { ref, player } = await mount({ onStartStall });
      player.getPlayerState.mockReturnValue(-1);
      player.getVideoLoadedFraction.mockReturnValue(0);
      act(() => ref.current?.loadVideoById("liveVIDEO01", 90));
      await advance(9999);
      expect(onStartStall).not.toHaveBeenCalled();
      await advance(1);
      expect(onStartStall).toHaveBeenCalledTimes(1);
      expect(onStartStall).toHaveBeenCalledWith({ state: -1, loadedFraction: 0 });
      await advance(30_000);
      expect(onStartStall).toHaveBeenCalledTimes(1);
    });

    it("reports a committed standby that never starts, with what it had loaded", async () => {
      const onStartStall = vi.fn();
      const { ref, player } = await mount({ onStartStall });
      act(() => ref.current?.prebuffer("nextVIDEO01", 0));
      state(1); // frozen
      player.getPlayerState.mockReturnValue(2);
      player.getVideoLoadedFraction.mockReturnValue(0.3);
      act(() => ref.current?.commitPrebuffered(0));
      await advance(10_000);
      expect(onStartStall).toHaveBeenCalledWith({ state: 2, loadedFraction: 0.3 });
    });

    it("stays quiet once the song reaches PLAYING", async () => {
      const onStartStall = vi.fn();
      const { ref } = await mount({ onStartStall });
      act(() => ref.current?.loadVideoById("liveVIDEO01", 0));
      await advance(8600); // the slowest real start seen in prod Tempo
      state(1);
      await advance(10_000);
      expect(onStartStall).not.toHaveBeenCalled();
    });

    it("measures from the latest load only", async () => {
      const onStartStall = vi.fn();
      const { ref, player } = await mount({ onStartStall });
      player.getPlayerState.mockReturnValue(-1);
      act(() => ref.current?.loadVideoById("liveVIDEO01", 0));
      await advance(6000);
      act(() => ref.current?.loadVideoById("liveVIDEO02", 0));
      await advance(6000);
      expect(onStartStall).not.toHaveBeenCalled();
      await advance(4000);
      expect(onStartStall).toHaveBeenCalledTimes(1);
    });

    it("never fires after the player is stopped or turned into the standby", async () => {
      const onStartStall = vi.fn();
      const { ref } = await mount({ onStartStall });
      act(() => ref.current?.loadVideoById("liveVIDEO01", 0));
      await advance(3000);
      act(() => ref.current?.stop());
      await advance(10_000);
      act(() => ref.current?.loadVideoById("liveVIDEO02", 0));
      await advance(3000);
      act(() => ref.current?.prebuffer("nextVIDEO01", 0));
      await advance(10_000);
      expect(onStartStall).not.toHaveBeenCalled();
    });

    it("stays quiet when the app paused the song before it started (a buzz)", async () => {
      const onStartStall = vi.fn();
      const { ref, player } = await mount({ onStartStall });
      player.getPlayerState.mockReturnValue(3);
      act(() => ref.current?.loadVideoById("liveVIDEO01", 0));
      await advance(3000);
      act(() => ref.current?.pause());
      await advance(30_000);
      expect(onStartStall).not.toHaveBeenCalled();
    });

    it("never fires after unmount", async () => {
      const onStartStall = vi.fn();
      const { ref, unmount } = await mount({ onStartStall });
      act(() => ref.current?.loadVideoById("liveVIDEO01", 0));
      unmount();
      await advance(10_000);
      expect(onStartStall).not.toHaveBeenCalled();
    });

    it("stays quiet when the page was hidden at any point of the wait", async () => {
      const onStartStall = vi.fn();
      const { ref } = await mount({ onStartStall });
      act(() => ref.current?.loadVideoById("liveVIDEO01", 0));
      await advance(2000);
      setVisibility("hidden");
      await advance(1000);
      setVisibility("visible");
      await advance(7000);
      expect(onStartStall).not.toHaveBeenCalled();
    });
  });

  describe("onEarlyPause", () => {
    it("fires when the song pauses by itself right after it started", async () => {
      const onEarlyPause = vi.fn();
      const { ref, player } = await mount({ onEarlyPause });
      player.getPlayerState.mockReturnValue(-1);
      act(() => ref.current?.loadVideoById("liveVIDEO01", 0));
      await advance(400);
      state(1);
      await advance(300);
      state(2);
      expect(onEarlyPause).toHaveBeenCalledTimes(1);
      expect(onEarlyPause).toHaveBeenCalledWith(300);
    });

    it("times the window from a start the PLAYING poll detected", async () => {
      // onStateChange(PLAYING) can be coalesced or missed; the 250 ms poll
      // then detects the start, and the early-pause window must run from it.
      const onEarlyPause = vi.fn();
      const { ref, player } = await mount({ onEarlyPause });
      player.getPlayerState.mockReturnValue(-1);
      act(() => ref.current?.loadVideoById("liveVIDEO01", 0));
      await advance(250);
      player.getPlayerState.mockReturnValue(1);
      await advance(250); // the poll sees PLAYING here
      await advance(300);
      state(2);
      expect(onEarlyPause).toHaveBeenCalledWith(300);
    });

    // A player is stopped each time Next round demotes it. Its next song must
    // still be watched, even when only the PLAYING poll sees that song start.
    it.each([
      [
        "a load",
        (h: YouTubePlayerHandle) => {
          h.loadVideoById("liveVIDEO01", 0);
        },
      ],
      [
        "a committed standby",
        (h: YouTubePlayerHandle) => {
          h.prebuffer("nextVIDEO01", 0);
          lastConfig?.events?.onStateChange?.({ data: 1 }); // the freeze
          h.commitPrebuffered(0);
        },
      ],
    ])("fires for %s after the app's last stop, started by the poll", async (_label, start) => {
      const onEarlyPause = vi.fn();
      const { ref, player } = await mount({ onEarlyPause });
      act(() => ref.current?.stop());
      player.getPlayerState.mockReturnValue(-1);
      act(() => {
        if (ref.current) start(ref.current);
      });
      player.getPlayerState.mockReturnValue(1);
      await advance(250); // the poll sees PLAYING here
      await advance(300);
      state(2);
      expect(onEarlyPause).toHaveBeenCalledWith(300);
    });

    it("fires after a buzz before the start, once the poll sees the resumed song play", async () => {
      // pause() before PLAYING, then play(): the app has not paused the song
      // since it started, so a pause by itself right after is still early.
      const onEarlyPause = vi.fn();
      const { ref, player } = await mount({ onEarlyPause });
      player.getPlayerState.mockReturnValue(3);
      act(() => ref.current?.loadVideoById("liveVIDEO01", 0));
      await advance(1000);
      act(() => ref.current?.pause()); // a buzz
      act(() => ref.current?.play()); // Wrong / Continue
      player.getPlayerState.mockReturnValue(1);
      await advance(250); // the poll sees PLAYING here
      await advance(400);
      state(2);
      expect(onEarlyPause).toHaveBeenCalledWith(400);
    });

    it("fires for a committed standby that pauses after starting, not for pauses before it starts", async () => {
      const onEarlyPause = vi.fn();
      const { ref } = await mount({ onEarlyPause });
      act(() => ref.current?.prebuffer("nextVIDEO01", 0));
      state(1); // the freeze: pauseVideo while prebuffering
      state(2);
      act(() => ref.current?.commitPrebuffered(0));
      state(2); // still paused, before the resume reaches PLAYING
      expect(onEarlyPause).not.toHaveBeenCalled();
      state(1);
      await advance(300);
      state(2);
      expect(onEarlyPause).toHaveBeenCalledWith(300);
    });

    it("ignores pauses the app asked for, including a stop", async () => {
      const onEarlyPause = vi.fn();
      const { ref } = await mount({ onEarlyPause });
      act(() => ref.current?.loadVideoById("liveVIDEO01", 0));
      state(1);
      await advance(500);
      act(() => ref.current?.pause()); // a buzz
      state(2);
      act(() => ref.current?.play()); // Wrong / Continue
      state(1);
      await advance(200);
      act(() => ref.current?.stop()); // Next round demotes it
      state(2);
      expect(onEarlyPause).not.toHaveBeenCalled();
    });

    it("ignores a pause after the first 5 s", async () => {
      const onEarlyPause = vi.fn();
      const { ref } = await mount({ onEarlyPause });
      act(() => ref.current?.loadVideoById("liveVIDEO01", 0));
      state(1);
      await advance(5001);
      state(2);
      expect(onEarlyPause).not.toHaveBeenCalled();
    });

    it("fires at most once per start and never while the page is hidden", async () => {
      const onEarlyPause = vi.fn();
      const { ref } = await mount({ onEarlyPause });
      act(() => ref.current?.loadVideoById("liveVIDEO01", 0));
      state(1);
      setVisibility("hidden");
      state(2); // the browser pauses a hidden tab's media
      expect(onEarlyPause).not.toHaveBeenCalled();
      setVisibility("visible");
      state(1);
      await advance(100);
      state(2);
      state(1);
      state(2);
      expect(onEarlyPause).toHaveBeenCalledTimes(1);
    });
  });
});

// Host transport (2026-10-27): back 10 s, pause / play and forward 10 s over
// the live player's picture on the host console.
describe("YouTubePlayer host transport", () => {
  async function mount(props: Partial<ComponentProps<typeof YouTubePlayer>> = {}) {
    installFakeYT();
    const ref = createRef<YouTubePlayerHandle>();
    const utils = render(<YouTubePlayer ref={ref} noCover controls {...props} />);
    await flushIframeLoad(utils.container);
    await waitFor(() => expect(lastConfig).not.toBeNull());
    act(() => {
      lastConfig?.events?.onReady?.();
    });
    const player = lastPlayer;
    if (!player) throw new Error("player not constructed");
    return { ref, player, ...utils };
  }
  const state = (data: number) =>
    act(() => {
      lastConfig?.events?.onStateChange?.({ data });
    });
  const btn = (name: "back" | "toggle" | "forward") =>
    screen.getByTestId<HTMLButtonElement>(`youtube-player-${name}`);
  // A song that has been loaded and reached PLAYING.
  async function playing(props: Partial<ComponentProps<typeof YouTubePlayer>> = {}) {
    const utils = await mount(props);
    act(() => utils.ref.current?.loadVideoById("liveVIDEO01", 30));
    state(1);
    return utils;
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders no buttons before a song is loaded", async () => {
    await mount();
    expect(screen.queryByTestId("youtube-player-back")).toBeNull();
  });

  it("renders no buttons without `controls` (the hidden standby)", async () => {
    const { ref } = await mount({ controls: false });
    act(() => ref.current?.loadVideoById("liveVIDEO01", 30));
    state(1);
    expect(screen.queryByTestId("youtube-player-back")).toBeNull();
    expect(screen.queryByTestId("youtube-player-toggle")).toBeNull();
  });

  it("keeps the buttons disabled until the song plays, and again after a new load", async () => {
    const { ref } = await mount();
    act(() => ref.current?.loadVideoById("liveVIDEO01", 30));
    expect(btn("back").disabled).toBe(true);
    expect(btn("toggle").disabled).toBe(true);
    expect(btn("forward").disabled).toBe(true);

    state(1);
    expect(btn("back").disabled).toBe(false);
    expect(btn("toggle").disabled).toBe(false);
    expect(btn("forward").disabled).toBe(false);

    act(() => ref.current?.loadVideoById("liveVIDEO02", 0));
    expect(btn("back").disabled).toBe(true);
    state(1);
    expect(btn("back").disabled).toBe(false);
  });

  it("back jumps 10 s earlier, down to 0:00", async () => {
    const { player } = await playing();
    player.getCurrentTime.mockReturnValue(42);
    fireEvent.click(btn("back"));
    expect(player.seekTo).toHaveBeenLastCalledWith(32, true);

    player.getCurrentTime.mockReturnValue(4);
    fireEvent.click(btn("back"));
    expect(player.seekTo).toHaveBeenLastCalledWith(0, true);
  });

  it("forward jumps 10 s later, stopping a second short of the end", async () => {
    const { player } = await playing();
    player.getCurrentTime.mockReturnValue(50);
    player.getDuration.mockReturnValue(200);
    fireEvent.click(btn("forward"));
    expect(player.seekTo).toHaveBeenLastCalledWith(60, true);

    player.getCurrentTime.mockReturnValue(100);
    player.getDuration.mockReturnValue(105);
    fireEvent.click(btn("forward"));
    expect(player.seekTo).toHaveBeenLastCalledWith(104, true);

    // Duration not known yet: a plain jump.
    player.getCurrentTime.mockReturnValue(20);
    player.getDuration.mockReturnValue(0);
    fireEvent.click(btn("forward"));
    expect(player.seekTo).toHaveBeenLastCalledWith(30, true);
  });

  it("moves nothing when YouTube has no song playing, paused or buffering", async () => {
    const { player } = await playing();
    player.seekTo.mockClear();
    for (const s of [-1, 0, 5]) {
      player.getPlayerState.mockReturnValue(s);
      fireEvent.click(btn("back"));
      fireEvent.click(btn("forward"));
    }
    expect(player.seekTo).not.toHaveBeenCalled();
  });

  it("shows −10s / +10s on the picture for 900 ms", async () => {
    const { player } = await playing();
    vi.useFakeTimers();
    player.getCurrentTime.mockReturnValue(42);
    fireEvent.click(btn("back"));
    expect(screen.getByText("−10s")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(899);
    });
    expect(screen.getByText("−10s")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText("−10s")).toBeNull();

    fireEvent.click(btn("forward"));
    expect(screen.getByText("+10s")).toBeInTheDocument();
  });

  it("Pause pauses the song and Play plays it, and the button's label follows", async () => {
    const { player } = await playing();
    expect(btn("toggle").getAttribute("aria-label")).toBe("Pause the song");
    fireEvent.click(btn("toggle"));
    expect(player.pauseVideo).toHaveBeenCalledTimes(1);
    expect(btn("toggle").getAttribute("aria-label")).toBe("Play the song");

    fireEvent.click(btn("toggle"));
    expect(player.playVideo).toHaveBeenCalledTimes(1);
    expect(btn("toggle").getAttribute("aria-label")).toBe("Pause the song");
  });

  it("keeps a host-paused song paused through resumeIfPaused until play() or a new load", async () => {
    const { ref, player } = await playing();
    fireEvent.click(btn("toggle"));
    state(2);
    player.getPlayerState.mockReturnValue(2);

    act(() => ref.current?.resumeIfPaused());
    expect(player.playVideo).not.toHaveBeenCalled();

    // Continue round / Wrong restart the song, which clears the host pause.
    act(() => ref.current?.play());
    expect(player.playVideo).toHaveBeenCalledTimes(1);
    state(1);
    act(() => ref.current?.pause()); // a buzz
    state(2);
    act(() => ref.current?.resumeIfPaused());
    expect(player.playVideo).toHaveBeenCalledTimes(2);

    // So does the next song.
    state(1);
    fireEvent.click(btn("toggle"));
    state(2);
    act(() => ref.current?.loadVideoById("liveVIDEO02", 0));
    act(() => ref.current?.resumeIfPaused());
    expect(player.playVideo).toHaveBeenCalledTimes(3);
  });

  it("does not report the host's own pause as an early pause", async () => {
    const onEarlyPause = vi.fn();
    await playing({ onEarlyPause });
    fireEvent.click(btn("toggle"));
    state(2);
    expect(onEarlyPause).not.toHaveBeenCalled();
  });

  it("during a buzz locks Play but still moves the paused song", async () => {
    const { ref, player } = await playing({ holdPlayback: true });
    act(() => ref.current?.pause());
    state(2);
    player.getPlayerState.mockReturnValue(2);
    expect(btn("toggle").disabled).toBe(true);
    expect(btn("toggle").getAttribute("aria-label")).toBe("Play the song");

    player.getCurrentTime.mockReturnValue(50);
    fireEvent.click(btn("back"));
    expect(player.seekTo).toHaveBeenLastCalledWith(40, true);
    expect(player.playVideo).not.toHaveBeenCalled();
  });

  // A song that played to its end: YouTube reports ENDED and the player stops
  // it (fixed 2026-10-27: the buttons used to go dead here). On a stopped
  // video playVideo and seekTo both start at 0:00, so a replay loads the song
  // again at the point.
  describe("after the song ends", () => {
    async function ended(props: Partial<ComponentProps<typeof YouTubePlayer>> = {}) {
      const utils = await playing(props); // liveVIDEO01, start point 30
      utils.player.getDuration.mockReturnValue(200);
      state(0);
      utils.player.getPlayerState.mockReturnValue(5);
      utils.player.getCurrentTime.mockReturnValue(0);
      utils.player.loadVideoById.mockClear();
      utils.player.seekTo.mockClear();
      utils.player.playVideo.mockClear();
      return utils;
    }
    const replayedFrom = (player: FakeYTPlayer, videoId: string, startSeconds: number) => {
      expect(player.loadVideoById).toHaveBeenLastCalledWith({ videoId, startSeconds });
      expect(player.seekTo).not.toHaveBeenCalled();
      expect(player.playVideo).not.toHaveBeenCalled();
    };

    it("offers back and Replay, not forward", async () => {
      await ended();
      expect(btn("back").disabled).toBe(false);
      expect(btn("forward").disabled).toBe(true);
      expect(btn("toggle").disabled).toBe(false);
      expect(btn("toggle").getAttribute("aria-label")).toBe("Replay the song");
    });

    it("back replays the last 10 s, and the buttons go back to playing", async () => {
      const { player } = await ended();
      fireEvent.click(btn("back"));
      replayedFrom(player, "liveVIDEO01", 190);
      expect(screen.getByText("−10s")).toBeInTheDocument();
      expect(btn("toggle").getAttribute("aria-label")).toBe("Pause the song");
      expect(btn("forward").disabled).toBe(false);
    });

    it("back from the end of a song shorter than 10 s starts it at 0:00", async () => {
      const { player } = await playing();
      player.getDuration.mockReturnValue(6);
      state(0);
      fireEvent.click(btn("back"));
      expect(player.loadVideoById).toHaveBeenLastCalledWith({
        videoId: "liveVIDEO01",
        startSeconds: 0,
      });
    });

    it("forward does nothing on a finished song", async () => {
      const { player } = await ended();
      fireEvent.click(btn("forward"));
      expect(player.loadVideoById).not.toHaveBeenCalled();
      expect(player.seekTo).not.toHaveBeenCalled();
      expect(player.playVideo).not.toHaveBeenCalled();
    });

    it("Replay plays the song again from its start point", async () => {
      const { player } = await ended();
      fireEvent.click(btn("toggle"));
      replayedFrom(player, "liveVIDEO01", 30);
      expect(btn("toggle").getAttribute("aria-label")).toBe("Pause the song");
    });

    it("offers back and Replay again when a replay ends", async () => {
      const { player } = await ended();
      fireEvent.click(btn("back"));
      state(1);
      state(0);
      expect(btn("toggle").getAttribute("aria-label")).toBe("Replay the song");
      fireEvent.click(btn("back"));
      expect(player.loadVideoById).toHaveBeenLastCalledWith({
        videoId: "liveVIDEO01",
        startSeconds: 190,
      });
    });

    it("during a buzz back only picks the point, and play() starts the song there", async () => {
      const { ref, player } = await ended({ holdPlayback: true });
      expect(btn("toggle").disabled).toBe(true);
      fireEvent.click(btn("back"));
      fireEvent.click(btn("back"));
      expect(player.loadVideoById).not.toHaveBeenCalled();
      expect(player.playVideo).not.toHaveBeenCalled();
      expect(screen.getByText("−10s")).toBeInTheDocument();

      act(() => ref.current?.play()); // Wrong / Continue round
      replayedFrom(player, "liveVIDEO01", 180);
    });

    it("play() starts a finished song from its start point, not 0:00", async () => {
      const { ref, player } = await ended();
      act(() => ref.current?.play());
      replayedFrom(player, "liveVIDEO01", 30);
    });

    it("replays a committed prebuffer from that song's own start point", async () => {
      const { ref, player } = await mount();
      act(() => ref.current?.prebuffer("nextVIDEO01", 45));
      state(1); // the freeze
      act(() => ref.current?.commitPrebuffered(45));
      state(1);
      player.getDuration.mockReturnValue(200);
      state(0);
      player.loadVideoById.mockClear();
      fireEvent.click(btn("toggle"));
      expect(player.loadVideoById).toHaveBeenLastCalledWith({
        videoId: "nextVIDEO01",
        startSeconds: 45,
      });
    });

    it("a new song drops the ended state and the picked point", async () => {
      const { ref, player } = await ended({ holdPlayback: true });
      fireEvent.click(btn("back")); // picks 190
      act(() => ref.current?.loadVideoById("liveVIDEO02", 12));
      expect(btn("back").disabled).toBe(true);
      state(1);
      player.loadVideoById.mockClear();
      act(() => ref.current?.play());
      expect(player.loadVideoById).not.toHaveBeenCalled();
      expect(player.playVideo).toHaveBeenCalledTimes(1);
    });

    it("does not report a replay as a new song start", async () => {
      const onPlaying = vi.fn();
      await ended({ onPlaying });
      expect(onPlaying).toHaveBeenCalledTimes(1);
      fireEvent.click(btn("back"));
      state(1);
      expect(onPlaying).toHaveBeenCalledTimes(1);
    });
  });
});

// Final validation 2026-09-22 (F-01): the cover shipped with the pre-redesign
// slate gradient and hard-coded text colours. 01 §2 bans gradients anywhere and
// every colour comes from a token; 04 §2 allows only the four easing tokens.
// #000 behind the iframe is the one literal kept — YouTube letterboxes in black.
describe("YouTubePlayer.module.css", () => {
  it("uses tokens only: no gradient, no hex colour but the black letterbox, no bare easing", () => {
    const css = readFileSync(join(import.meta.dirname, "YouTubePlayer.module.css"), "utf8");
    expect(css).not.toMatch(/gradient\(/);
    expect(css.replace(/#000\b/g, "")).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/\bease(?![-\w])/);
  });
});
