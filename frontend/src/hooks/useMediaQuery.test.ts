import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMediaQuery } from "./useMediaQuery";

type Listener = () => void;

function stubMatchMedia(initial: boolean) {
  const listeners = new Set<Listener>();
  const list = {
    matches: initial,
    addEventListener: vi.fn((_type: string, cb: Listener) => listeners.add(cb)),
    removeEventListener: vi.fn((_type: string, cb: Listener) => listeners.delete(cb)),
  };
  const matchMedia = vi.fn((_query: string) => list);
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: matchMedia,
  });
  return {
    list,
    matchMedia,
    change(next: boolean) {
      list.matches = next;
      listeners.forEach((cb) => cb());
    },
  };
}

afterEach(() => {
  Reflect.deleteProperty(window, "matchMedia");
});

describe("useMediaQuery", () => {
  it("reports the fallback where matchMedia doesn't exist", () => {
    expect(renderHook(() => useMediaQuery("(min-width: 1024px)", true)).result.current).toBe(true);
    expect(renderHook(() => useMediaQuery("(min-width: 1024px)", false)).result.current).toBe(
      false,
    );
  });

  it("reads the query on the first render and follows changes", () => {
    const mq = stubMatchMedia(false);
    const { result, unmount } = renderHook(() => useMediaQuery("(min-width: 1024px)", true));

    expect(mq.matchMedia).toHaveBeenCalledWith("(min-width: 1024px)");
    expect(result.current).toBe(false);

    act(() => mq.change(true));
    expect(result.current).toBe(true);

    unmount();
    expect(mq.list.removeEventListener).toHaveBeenCalledWith(
      "change",
      mq.list.addEventListener.mock.calls[0]?.[1],
    );
  });
});
