import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Logo } from "./Logo";

describe("Logo", () => {
  it("keeps the literal wordmark text and names itself for view transitions", () => {
    render(<Logo size="large" />);
    const text = screen.getByText("Sound Clash");
    expect(text).toBeInTheDocument();
    expect(text.closest("[style]")?.getAttribute("style")).toContain(
      "view-transition-name: wordmark",
    );
  });
  it("renders the equaliser mark as an svg, not gradient bars", () => {
    const { container } = render(<Logo />);
    expect(container.querySelector("svg")).not.toBeNull();
  });
});
