import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useResumeOnVisible } from "./useResumeOnVisible";

function setVisibility(state: "visible" | "hidden"): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
}

function fireVisibilityChange(): void {
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

afterEach(() => {
  setVisibility("visible");
});

describe("useResumeOnVisible", () => {
  it("resumes when the tab becomes visible and shouldResume is true", () => {
    const resume = vi.fn();
    renderHook(() => useResumeOnVisible(() => true, resume));

    setVisibility("visible");
    fireVisibilityChange();

    expect(resume).toHaveBeenCalledTimes(1);
  });

  it("does not resume when the tab is hidden (backgrounded)", () => {
    const resume = vi.fn();
    renderHook(() => useResumeOnVisible(() => true, resume));

    setVisibility("hidden");
    fireVisibilityChange();

    expect(resume).not.toHaveBeenCalled();
  });

  it("does not resume when shouldResume is false (e.g. a buzz is active)", () => {
    const resume = vi.fn();
    renderHook(() => useResumeOnVisible(() => false, resume));

    setVisibility("visible");
    fireVisibilityChange();

    expect(resume).not.toHaveBeenCalled();
  });

  it("reads the latest callbacks after a re-render", () => {
    const resumeA = vi.fn();
    const resumeB = vi.fn();
    const { rerender } = renderHook(({ r }) => useResumeOnVisible(() => true, r), {
      initialProps: { r: resumeA },
    });

    rerender({ r: resumeB });
    setVisibility("visible");
    fireVisibilityChange();

    expect(resumeA).not.toHaveBeenCalled();
    expect(resumeB).toHaveBeenCalledTimes(1);
  });

  it("removes the listener on unmount", () => {
    const resume = vi.fn();
    const { unmount } = renderHook(() => useResumeOnVisible(() => true, resume));

    unmount();
    setVisibility("visible");
    fireVisibilityChange();

    expect(resume).not.toHaveBeenCalled();
  });
});
