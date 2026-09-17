import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "./ToastContext";
import { useToast } from "./useToast";

function Trigger() {
  const { toast } = useToast();
  return <button onClick={() => toast("Saved", { durationMs: 1000 })}>go</button>;
}

describe("ToastProvider exit phase", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it("marks the toast exiting for 160 ms before removing it", () => {
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    act(() => screen.getByText("go").click());
    expect(screen.getByRole("status")).not.toHaveAttribute("data-exiting");
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByRole("status")).toHaveAttribute("data-exiting", "true");
    act(() => vi.advanceTimersByTime(160));
    expect(screen.queryByRole("status")).toBeNull();
  });
});
