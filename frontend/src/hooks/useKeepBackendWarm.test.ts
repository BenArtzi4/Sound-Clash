import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/api", () => ({
  getHealth: vi.fn(() => Promise.resolve({ status: "ok", version: "test", supabase: "ok" })),
}));

import { getHealth } from "../lib/api";
import { KEEP_WARM_INTERVAL_MS, useKeepBackendWarm } from "./useKeepBackendWarm";

const getHealthMock = vi.mocked(getHealth);

function setHidden(hidden: boolean): void {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
}

beforeEach(() => {
  vi.useFakeTimers();
  getHealthMock.mockClear();
  setHidden(false);
});

afterEach(() => {
  vi.useRealTimers();
  setHidden(false);
});

describe("useKeepBackendWarm", () => {
  it("pings /health immediately on mount, then once per interval, while active", () => {
    renderHook(() => useKeepBackendWarm(true));
    // Immediate warm on mount (no waiting up to 10 min for the first tick).
    expect(getHealthMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(KEEP_WARM_INTERVAL_MS + 100);
    expect(getHealthMock).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(KEEP_WARM_INTERVAL_MS);
    expect(getHealthMock).toHaveBeenCalledTimes(3);
  });

  it("never pings while inactive", () => {
    renderHook(() => useKeepBackendWarm(false));
    vi.advanceTimersByTime(KEEP_WARM_INTERVAL_MS * 3);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(getHealthMock).not.toHaveBeenCalled();
  });

  it("re-warms when the tab returns to the foreground", () => {
    renderHook(() => useKeepBackendWarm(true));
    expect(getHealthMock).toHaveBeenCalledTimes(1); // mount ping

    // Tab hidden: visibilitychange must NOT ping.
    setHidden(true);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(getHealthMock).toHaveBeenCalledTimes(1);

    // Tab visible again: fires an extra warm (mobile froze the interval while
    // backgrounded, so this is the ping that actually matters).
    setHidden(false);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(getHealthMock).toHaveBeenCalledTimes(2);
  });

  it("stops pinging (interval + visibility) after unmount", () => {
    const { unmount } = renderHook(() => useKeepBackendWarm(true));
    expect(getHealthMock).toHaveBeenCalledTimes(1); // mount

    unmount();
    vi.advanceTimersByTime(KEEP_WARM_INTERVAL_MS * 2);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(getHealthMock).toHaveBeenCalledTimes(1); // nothing after unmount
  });

  it("stops pinging once it flips from active to inactive", () => {
    const { rerender } = renderHook(({ active }) => useKeepBackendWarm(active), {
      initialProps: { active: true },
    });
    expect(getHealthMock).toHaveBeenCalledTimes(1); // mount ping (active)

    rerender({ active: false });
    vi.advanceTimersByTime(KEEP_WARM_INTERVAL_MS * 2);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(getHealthMock).toHaveBeenCalledTimes(1);
  });

  it("a rejected health ping does not throw", () => {
    getHealthMock.mockReturnValueOnce(Promise.reject(new Error("cold")));
    expect(() => renderHook(() => useKeepBackendWarm(true))).not.toThrow();
    // The immediate mount ping was the rejected one; swallowed by .catch.
    expect(getHealthMock).toHaveBeenCalledTimes(1);
  });
});
