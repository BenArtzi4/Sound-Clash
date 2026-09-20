import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useViewTransitionNavigate } from "./useViewTransitionNavigate";

const wrapper = ({ children }: { children: ReactNode }) => <MemoryRouter>{children}</MemoryRouter>;

afterEach(() => {
  delete (document as unknown as { startViewTransition?: unknown }).startViewTransition;
  delete (window as unknown as { matchMedia?: unknown }).matchMedia;
});

describe("useViewTransitionNavigate", () => {
  it("navigates plainly when the browser has no startViewTransition", async () => {
    const { result } = renderHook(() => ({ go: useViewTransitionNavigate(), loc: useLocation() }), {
      wrapper,
    });
    await act(async () => {
      await result.current.go("/join");
    });
    expect(result.current.loc.pathname).toBe("/join");
  });

  it("awaits the preload, then wraps navigation in startViewTransition", async () => {
    const calls: string[] = [];
    (
      document as unknown as { startViewTransition: (cb: () => void) => unknown }
    ).startViewTransition = (cb) => {
      calls.push("vt");
      cb();
      return { finished: Promise.resolve() };
    };
    const { result } = renderHook(() => ({ go: useViewTransitionNavigate(), loc: useLocation() }), {
      wrapper,
    });
    await act(async () => {
      await result.current.go("/display", {
        preload: async () => {
          calls.push("preload");
        },
      });
    });
    expect(calls).toEqual(["preload", "vt"]);
    expect(result.current.loc.pathname).toBe("/display");
  });

  it("still navigates when the preload rejects", async () => {
    const vt = vi.fn((cb: () => void) => {
      cb();
      return { finished: Promise.resolve() };
    });
    (document as unknown as { startViewTransition: unknown }).startViewTransition = vt;
    const { result } = renderHook(() => ({ go: useViewTransitionNavigate(), loc: useLocation() }), {
      wrapper,
    });
    await act(async () => {
      await result.current.go("/how-to-play", {
        preload: () => Promise.reject(new Error("stale chunk")),
      });
    });
    expect(vt).toHaveBeenCalledTimes(1);
    expect(result.current.loc.pathname).toBe("/how-to-play");
  });

  // Regression guard for the bug that made the plan's flushSync version a
  // no-op: react-router's declarative <BrowserRouter> routes location updates
  // through React.startTransition, so the DOM is still the OLD page when the
  // update callback returns. The callback must hand the browser a promise that
  // settles on React's commit, or the browser captures old-as-new and the real
  // swap moments later aborts the transition (measured: 240 ms of animation
  // ending at ~45 ms).
  it("returns a promise from the update callback so the browser waits for the commit", async () => {
    let callbackResult: unknown;
    (
      document as unknown as { startViewTransition: (cb: () => unknown) => unknown }
    ).startViewTransition = (cb) => {
      callbackResult = cb();
      return { finished: Promise.resolve() };
    };
    const { result } = renderHook(() => ({ go: useViewTransitionNavigate(), loc: useLocation() }), {
      wrapper,
    });
    await act(async () => {
      await result.current.go("/join");
    });
    expect(callbackResult).toBeInstanceOf(Promise);
    // And it always settles: nothing mutates the DOM in this harness, so the
    // hard cap is what resolves it — a navigation that changes nothing must
    // never hold rendering suppressed until the browser's own 4 s timeout.
    await act(async () => {
      await callbackResult;
    });
    expect(result.current.loc.pathname).toBe("/join");
  });

  it("skips the transition under prefers-reduced-motion", async () => {
    const vt = vi.fn((cb: () => void) => {
      cb();
      return { finished: Promise.resolve() };
    });
    (document as unknown as { startViewTransition: unknown }).startViewTransition = vt;
    window.matchMedia = vi
      .fn()
      .mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia;
    const { result } = renderHook(() => ({ go: useViewTransitionNavigate(), loc: useLocation() }), {
      wrapper,
    });
    await act(async () => {
      await result.current.go("/join");
    });
    expect(vt).not.toHaveBeenCalled();
    expect(result.current.loc.pathname).toBe("/join");
  });

  it("runs the transition when reduced motion is not requested", async () => {
    const vt = vi.fn((cb: () => void) => {
      cb();
      return { finished: Promise.resolve() };
    });
    (document as unknown as { startViewTransition: unknown }).startViewTransition = vt;
    window.matchMedia = vi
      .fn()
      .mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia;
    const { result } = renderHook(() => ({ go: useViewTransitionNavigate(), loc: useLocation() }), {
      wrapper,
    });
    await act(async () => {
      await result.current.go("/join");
    });
    expect(vt).toHaveBeenCalledTimes(1);
    expect(window.matchMedia).toHaveBeenCalledWith("(prefers-reduced-motion: reduce)");
    expect(result.current.loc.pathname).toBe("/join");
  });

  it("forwards navigate options such as replace", async () => {
    const { result } = renderHook(() => ({ go: useViewTransitionNavigate(), loc: useLocation() }), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <MemoryRouter initialEntries={["/", "/join"]}>{children}</MemoryRouter>
      ),
    });
    await act(async () => {
      await result.current.go("/display", { replace: true });
    });
    expect(result.current.loc.pathname).toBe("/display");
  });
});
