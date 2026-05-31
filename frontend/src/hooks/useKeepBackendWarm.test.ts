import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/api", () => ({
  getHealth: vi.fn(() => Promise.resolve({ status: "ok", version: "test", supabase: "ok" })),
}));

import { getHealth } from "../lib/api";
import { KEEP_WARM_INTERVAL_MS, useKeepBackendWarm } from "./useKeepBackendWarm";

const getHealthMock = vi.mocked(getHealth);

beforeEach(() => {
  vi.useFakeTimers();
  getHealthMock.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useKeepBackendWarm", () => {
  it("pings /health once per interval while active (no immediate ping)", () => {
    renderHook(() => useKeepBackendWarm(true));
    expect(getHealthMock).not.toHaveBeenCalled();

    vi.advanceTimersByTime(KEEP_WARM_INTERVAL_MS + 100);
    expect(getHealthMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(KEEP_WARM_INTERVAL_MS);
    expect(getHealthMock).toHaveBeenCalledTimes(2);
  });

  it("never pings while inactive", () => {
    renderHook(() => useKeepBackendWarm(false));
    vi.advanceTimersByTime(KEEP_WARM_INTERVAL_MS * 3);
    expect(getHealthMock).not.toHaveBeenCalled();
  });

  it("stops pinging after unmount", () => {
    const { unmount } = renderHook(() => useKeepBackendWarm(true));
    vi.advanceTimersByTime(KEEP_WARM_INTERVAL_MS + 100);
    expect(getHealthMock).toHaveBeenCalledTimes(1);

    unmount();
    vi.advanceTimersByTime(KEEP_WARM_INTERVAL_MS * 2);
    expect(getHealthMock).toHaveBeenCalledTimes(1);
  });

  it("stops pinging once it flips from active to inactive", () => {
    const { rerender } = renderHook(({ active }) => useKeepBackendWarm(active), {
      initialProps: { active: true },
    });
    vi.advanceTimersByTime(KEEP_WARM_INTERVAL_MS + 100);
    expect(getHealthMock).toHaveBeenCalledTimes(1);

    rerender({ active: false });
    vi.advanceTimersByTime(KEEP_WARM_INTERVAL_MS * 2);
    expect(getHealthMock).toHaveBeenCalledTimes(1);
  });

  it("a rejected health ping does not throw", () => {
    getHealthMock.mockReturnValueOnce(Promise.reject(new Error("cold")));
    renderHook(() => useKeepBackendWarm(true));
    expect(() => vi.advanceTimersByTime(KEEP_WARM_INTERVAL_MS + 100)).not.toThrow();
    expect(getHealthMock).toHaveBeenCalledTimes(1);
  });
});
