import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ getHealth: vi.fn() }));
vi.mock("../lib/api", () => ({ getHealth: h.getHealth }));

import { usePrewarmBackend, useSlowPending } from "./useBackendWarmup";

describe("usePrewarmBackend", () => {
  beforeEach(() => h.getHealth.mockReset());

  it("pings getHealth once on mount", () => {
    h.getHealth.mockResolvedValue({});
    renderHook(() => usePrewarmBackend());
    expect(h.getHealth).toHaveBeenCalledTimes(1);
  });

  it("swallows a getHealth rejection", async () => {
    h.getHealth.mockRejectedValueOnce(new Error("cold"));
    renderHook(() => usePrewarmBackend());
    // Flush the rejected promise + its .catch so a mishandled rejection would
    // surface here rather than as a late unhandled-rejection warning.
    await act(async () => {
      await Promise.resolve();
    });
    expect(h.getHealth).toHaveBeenCalledTimes(1);
  });
});

describe("useSlowPending", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("stays false until pending has held for the delay, then flips true", () => {
    const { result, rerender } = renderHook(({ p }) => useSlowPending(p, 2500), {
      initialProps: { p: false },
    });
    expect(result.current).toBe(false);
    rerender({ p: true });
    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(2499));
    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe(true);
  });

  it("resets to false the moment pending goes false", () => {
    const { result, rerender } = renderHook(({ p }) => useSlowPending(p, 1000), {
      initialProps: { p: true },
    });
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current).toBe(true);
    rerender({ p: false });
    expect(result.current).toBe(false);
  });
});
