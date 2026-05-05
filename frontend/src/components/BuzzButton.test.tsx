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
});
