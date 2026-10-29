import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWakeLock } from "./useWakeLock";

// A stand-in for WakeLockSentinel: release() resolves and fires "release",
// like the browser's when the page hides.
function makeSentinel() {
  const onRelease: Array<() => void> = [];
  const sentinel = {
    released: false,
    release: vi.fn(() => {
      sentinel.released = true;
      onRelease.forEach((fn) => fn());
      return Promise.resolve();
    }),
    addEventListener: (type: string, fn: () => void) => {
      if (type === "release") onRelease.push(fn);
    },
  };
  return sentinel;
}

let request: ReturnType<typeof vi.fn>;

function setVisibility(state: "visible" | "hidden"): void {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
}

beforeEach(() => {
  request = vi.fn(() => Promise.resolve(makeSentinel()));
  Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request } });
  setVisibility("visible");
});

afterEach(() => {
  Reflect.deleteProperty(navigator, "wakeLock");
  setVisibility("visible");
});

describe("useWakeLock", () => {
  it("holds a screen lock while active and releases it on unmount", async () => {
    const sentinel = makeSentinel();
    request.mockResolvedValueOnce(sentinel);
    const { unmount } = renderHook(() => useWakeLock(true));
    await act(async () => {});
    expect(request).toHaveBeenCalledWith("screen");
    unmount();
    expect(sentinel.release).toHaveBeenCalledTimes(1);
  });

  it("asks for nothing while inactive", async () => {
    renderHook(() => useWakeLock(false));
    await act(async () => {});
    expect(request).not.toHaveBeenCalled();
  });

  it("releases the lock when it turns inactive", async () => {
    const sentinel = makeSentinel();
    request.mockResolvedValueOnce(sentinel);
    const { rerender } = renderHook(({ on }) => useWakeLock(on), { initialProps: { on: true } });
    await act(async () => {});
    rerender({ on: false });
    expect(sentinel.release).toHaveBeenCalledTimes(1);
  });

  it("takes the lock again when the page comes back after the browser dropped it", async () => {
    const first = makeSentinel();
    request.mockResolvedValueOnce(first);
    renderHook(() => useWakeLock(true));
    await act(async () => {});
    expect(request).toHaveBeenCalledTimes(1);

    // Hidden: the browser releases the lock itself.
    setVisibility("hidden");
    await act(async () => {
      await first.release();
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(request).toHaveBeenCalledTimes(1);

    setVisibility("visible");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("does not stack a second lock while one is held or pending", async () => {
    renderHook(() => useWakeLock(true));
    // Still pending: a visibilitychange must not send a second request.
    document.dispatchEvent(new Event("visibilitychange"));
    await act(async () => {});
    document.dispatchEvent(new Event("visibilitychange"));
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("does not ask while the page is hidden", async () => {
    setVisibility("hidden");
    renderHook(() => useWakeLock(true));
    await act(async () => {});
    expect(request).not.toHaveBeenCalled();
  });

  it("releases a lock that arrives after unmount", async () => {
    const sentinel = makeSentinel();
    let resolve: (s: ReturnType<typeof makeSentinel>) => void = () => {};
    request.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const { unmount } = renderHook(() => useWakeLock(true));
    unmount();
    await act(async () => {
      resolve(sentinel);
    });
    expect(sentinel.release).toHaveBeenCalledTimes(1);
  });

  it("shrugs off a refused request (battery saver) and tries again later", async () => {
    request.mockRejectedValueOnce(new Error("NotAllowedError"));
    renderHook(() => useWakeLock(true));
    await act(async () => {});
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("does nothing where the browser has no Wake Lock API", async () => {
    Reflect.deleteProperty(navigator, "wakeLock");
    expect(() => renderHook(() => useWakeLock(true))).not.toThrow();
    await act(async () => {});
    expect(request).not.toHaveBeenCalled();
  });
});
