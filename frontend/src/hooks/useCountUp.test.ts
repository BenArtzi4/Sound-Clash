import { StrictMode } from "react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCountUp } from "./useCountUp";

const realMatchMedia = window.matchMedia;
const realRaf = window.requestAnimationFrame;

function mockMotion(reduce: boolean): void {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: reduce && query.includes("reduce"),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

describe("useCountUp", () => {
  afterEach(() => {
    window.matchMedia = realMatchMedia;
    window.requestAnimationFrame = realRaf;
    vi.useRealTimers();
  });

  it("returns the target immediately when motion is unavailable (jsdom has no matchMedia)", () => {
    const { result } = renderHook(() => useCountUp(42));
    expect(result.current).toBe(42);
  });

  it("returns the target immediately under reduced motion, even with a `from`", () => {
    mockMotion(true);
    const { result } = renderHook(() => useCountUp(42, { from: 0 }));
    expect(result.current).toBe(42);
  });

  it("jumps to a new value with no animation when motion is unavailable", () => {
    const { result, rerender } = renderHook(({ v }: { v: number }) => useCountUp(v), {
      initialProps: { v: 10 },
    });
    expect(result.current).toBe(10);
    rerender({ v: 25 });
    expect(result.current).toBe(25);
  });

  it("eases from the previous value to the new one when motion is allowed", () => {
    mockMotion(false);
    vi.useFakeTimers();
    let now = 0;
    const nowSpy = vi.spyOn(performance, "now").mockImplementation(() => now);
    const frames: Array<(t: number) => void> = [];
    window.requestAnimationFrame = ((cb: (t: number) => void) => {
      frames.push(cb);
      return frames.length;
    }) as unknown as typeof window.requestAnimationFrame;

    const { result, rerender } = renderHook(
      ({ v }: { v: number }) => useCountUp(v, { duration: 600 }),
      { initialProps: { v: 10 } },
    );
    expect(result.current).toBe(10);

    rerender({ v: 110 });
    // Still on the old value until the rAF loop starts.
    expect(result.current).toBe(10);
    act(() => {
      vi.advanceTimersByTime(0);
    });
    // Half-way through: eased, so past the mid-point but short of the target.
    now = 300;
    act(() => {
      frames.shift()?.(now);
    });
    expect(result.current).toBeGreaterThan(10);
    expect(result.current).toBeLessThan(110);
    // The final frame lands exactly on the target.
    now = 600;
    act(() => {
      frames.shift()?.(now);
    });
    expect(result.current).toBe(110);
    nowSpy.mockRestore();
  });

  it("rolls up from `from` on mount when motion is allowed", () => {
    mockMotion(false);
    vi.useFakeTimers();
    // jsdom ships no requestAnimationFrame, so the hook would otherwise take
    // its "motion unavailable" path and jump straight to the total.
    window.requestAnimationFrame = (() => 1) as unknown as typeof window.requestAnimationFrame;
    const { result } = renderHook(() => useCountUp(42, { from: 0, delay: 100 }));
    // First paint opens at `from`; the roll-up only starts after the delay.
    expect(result.current).toBe(0);
  });

  it("ignores `from` when motion is unavailable (jsdom): the total shows at once", () => {
    const { result } = renderHook(() => useCountUp(42, { from: 0 }));
    expect(result.current).toBe(42);
  });

  // StrictMode mounts, unmounts and re-mounts every effect. If the cleanup
  // advances the animation's start point to the target, the second run sees
  // "already there" and bails — leaving the podium reading 0pts forever, which
  // is exactly what full_game.spec.ts caught.
  it("still animates when the effect is mounted twice (StrictMode)", () => {
    mockMotion(false);
    vi.useFakeTimers();
    let now = 0;
    const nowSpy = vi.spyOn(performance, "now").mockImplementation(() => now);
    const frames: Array<(t: number) => void> = [];
    window.requestAnimationFrame = ((cb: (t: number) => void) => {
      frames.push(cb);
      return frames.length;
    }) as unknown as typeof window.requestAnimationFrame;

    const { result } = renderHook(() => useCountUp(30, { from: 0, duration: 900 }), {
      wrapper: StrictMode,
    });
    expect(result.current).toBe(0);

    act(() => {
      vi.advanceTimersByTime(0);
    });
    now = 900;
    act(() => {
      // Both mounts queue a frame; running them all must land on the target,
      // never leave the display stranded at `from`.
      for (const f of frames.splice(0)) f(now);
    });
    expect(result.current).toBe(30);
    nowSpy.mockRestore();
  });
});
