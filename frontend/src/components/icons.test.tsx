import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import * as icons from "./icons";

describe("icons", () => {
  it("every icon is a 24-grid stroke SVG, hidden from AT unless titled", () => {
    for (const [name, Icon] of Object.entries(icons)) {
      const { container, unmount } = render(<Icon />);
      const svg = container.querySelector("svg");
      expect(svg, name).not.toBeNull();
      expect(svg!.getAttribute("viewBox")).toBe("0 0 24 24");
      expect(svg!.getAttribute("aria-hidden")).toBe("true");
      expect(svg!.getAttribute("stroke")).toBe("currentColor");
      expect(svg!.getAttribute("fill")).toBe("none");
      unmount();
    }
  });
  it("exposes a title as an accessible name when given", () => {
    const { container } = render(<icons.FilmIcon title="Soundtrack" />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-hidden")).toBeNull();
    expect(svg.querySelector("title")?.textContent).toBe("Soundtrack");
  });
});
