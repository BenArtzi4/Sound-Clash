import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Logo } from "./Logo";

describe("Logo", () => {
  // The wordmark no longer morphs between pages (ui-redesign 10), so it must
  // not name itself for a view transition.
  it("keeps the literal wordmark text and takes no view-transition name", () => {
    const { container } = render(<Logo size="large" />);
    expect(screen.getByText("Sound Clash")).toBeInTheDocument();
    expect(container.innerHTML).not.toContain("view-transition-name");
  });
  it("renders the equaliser mark as an svg, not gradient bars", () => {
    const { container } = render(<Logo />);
    expect(container.querySelector("svg")).not.toBeNull();
  });
});
