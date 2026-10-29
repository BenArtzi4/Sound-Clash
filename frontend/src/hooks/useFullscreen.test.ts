import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useFullscreen } from "./useFullscreen";

function allowFullscreen(request = vi.fn(() => Promise.resolve())) {
  Object.defineProperty(document, "fullscreenEnabled", { configurable: true, value: true });
  Object.defineProperty(document.documentElement, "requestFullscreen", {
    configurable: true,
    value: request,
  });
  return request;
}

function setFullscreenElement(el: HTMLElement | null): void {
  Object.defineProperty(document, "fullscreenElement", { configurable: true, value: el });
}

afterEach(() => {
  Reflect.deleteProperty(document, "fullscreenEnabled");
  Reflect.deleteProperty(document, "fullscreenElement");
  Reflect.deleteProperty(document.documentElement, "requestFullscreen");
});

describe("useFullscreen", () => {
  it("is unsupported where the page can't go full screen (iPhone Safari)", () => {
    const { result } = renderHook(() => useFullscreen());
    expect(result.current.supported).toBe(false);
    expect(result.current.active).toBe(false);
  });

  it("asks for full screen with the browser's navigation UI hidden", () => {
    const request = allowFullscreen();
    const { result } = renderHook(() => useFullscreen());
    expect(result.current.supported).toBe(true);
    result.current.enter();
    expect(request).toHaveBeenCalledWith({ navigationUI: "hide" });
  });

  it("swallows a refused request", async () => {
    allowFullscreen(vi.fn(() => Promise.reject(new Error("denied"))));
    const { result } = renderHook(() => useFullscreen());
    await act(async () => {
      result.current.enter();
    });
    expect(result.current.active).toBe(false);
  });

  it("tracks entering and leaving full screen", () => {
    allowFullscreen();
    const { result } = renderHook(() => useFullscreen());
    act(() => {
      setFullscreenElement(document.documentElement);
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    expect(result.current.active).toBe(true);
    act(() => {
      setFullscreenElement(null);
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    expect(result.current.active).toBe(false);
  });
});
