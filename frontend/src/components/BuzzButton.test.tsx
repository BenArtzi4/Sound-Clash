import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BuzzButton } from "./BuzzButton";

describe("BuzzButton", () => {
  it("renders the label and subtitle", () => {
    render(
      <BuzzButton
        disabled={false}
        isBuzzing={false}
        label="GO"
        subtitle="Tap to buzz"
        onBuzz={() => {}}
      />,
    );
    expect(screen.getByText("GO")).toBeInTheDocument();
    expect(screen.getByText("Tap to buzz")).toBeInTheDocument();
  });

  it("fires onBuzz on click when enabled", async () => {
    const user = userEvent.setup();
    const onBuzz = vi.fn();
    render(<BuzzButton disabled={false} isBuzzing={false} onBuzz={onBuzz} />);
    await user.click(screen.getByTestId("buzz"));
    expect(onBuzz).toHaveBeenCalledTimes(1);
  });

  it("does not fire onBuzz when disabled", async () => {
    const user = userEvent.setup();
    const onBuzz = vi.fn();
    render(<BuzzButton disabled isBuzzing={false} onBuzz={onBuzz} />);
    await user.click(screen.getByTestId("buzz"));
    expect(onBuzz).not.toHaveBeenCalled();
  });

  it("fires onBuzz on space key", () => {
    const onBuzz = vi.fn();
    render(<BuzzButton disabled={false} isBuzzing={false} onBuzz={onBuzz} />);
    const btn = screen.getByTestId("buzz");
    fireEvent.keyDown(btn, { key: " " });
    expect(onBuzz).toHaveBeenCalledTimes(1);
  });

  it("fires onBuzz on Enter key", () => {
    const onBuzz = vi.fn();
    render(<BuzzButton disabled={false} isBuzzing={false} onBuzz={onBuzz} />);
    fireEvent.keyDown(screen.getByTestId("buzz"), { key: "Enter" });
    expect(onBuzz).toHaveBeenCalledTimes(1);
  });

  it("ignores keys other than space/enter", () => {
    const onBuzz = vi.fn();
    render(<BuzzButton disabled={false} isBuzzing={false} onBuzz={onBuzz} />);
    fireEvent.keyDown(screen.getByTestId("buzz"), { key: "a" });
    expect(onBuzz).not.toHaveBeenCalled();
  });

  it("uses the visible label and subtitle as the accessible name", () => {
    render(
      <BuzzButton
        disabled={false}
        isBuzzing={false}
        label="BUZZ"
        subtitle="Tap or press space"
        onBuzz={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /BUZZ Tap or press space/i })).toBeInTheDocument();
  });

  it("falls back to label-only accessible name when no subtitle", () => {
    render(<BuzzButton disabled={false} isBuzzing={false} label="BUZZ" onBuzz={() => {}} />);
    expect(screen.getByRole("button", { name: "BUZZ" })).toBeInTheDocument();
  });

  it("fires onBuzz on pointerdown (before click) so a finger-slide release still counts", () => {
    const onBuzz = vi.fn();
    render(<BuzzButton disabled={false} isBuzzing={false} onBuzz={onBuzz} />);
    const btn = screen.getByTestId("buzz");
    fireEvent.pointerDown(btn, { button: 0 });
    expect(onBuzz).toHaveBeenCalledTimes(1);
    fireEvent.click(btn);
    expect(onBuzz).toHaveBeenCalledTimes(1);
  });

  it("ignores non-primary pointer buttons", () => {
    const onBuzz = vi.fn();
    render(<BuzzButton disabled={false} isBuzzing={false} onBuzz={onBuzz} />);
    fireEvent.pointerDown(screen.getByTestId("buzz"), { button: 2 });
    expect(onBuzz).not.toHaveBeenCalled();
  });

  it("reflects the tone prop via data-tone for styling", () => {
    const { rerender } = render(
      <BuzzButton disabled isBuzzing={false} tone="locked-other" onBuzz={() => {}} />,
    );
    expect(screen.getByTestId("buzz")).toHaveAttribute("data-tone", "locked-other");
    rerender(<BuzzButton disabled isBuzzing={false} tone="winner" onBuzz={() => {}} />);
    expect(screen.getByTestId("buzz")).toHaveAttribute("data-tone", "winner");
    rerender(<BuzzButton disabled isBuzzing={false} tone="waiting" onBuzz={() => {}} />);
    expect(screen.getByTestId("buzz")).toHaveAttribute("data-tone", "waiting");
    rerender(<BuzzButton disabled={false} isBuzzing={false} onBuzz={() => {}} />);
    expect(screen.getByTestId("buzz")).toHaveAttribute("data-tone", "idle");
  });
});
