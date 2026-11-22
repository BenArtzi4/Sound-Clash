import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const funnel = vi.hoisted(() => ({ trackCta: vi.fn() }));
vi.mock("../lib/funnel", () => funnel);

import { SiteFooter } from "./SiteFooter";

afterEach(() => {
  vi.clearAllMocks();
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SiteFooter />
    </MemoryRouter>,
  );
}

describe("SiteFooter", () => {
  it("links the Product Hunt page in a new tab and says when Sound Clash launched there", () => {
    renderAt("/");
    const link = screen.getByRole("link", { name: "Product Hunt" });
    expect(link).toHaveAttribute("href", "https://www.producthunt.com/products/sound-clash");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener");
    expect(link.closest("p")).toHaveTextContent(
      "Sound Clash launched on Product Hunt on 22 November 2026. Questions and ideas are welcome there.",
    );
    expect(link.closest("footer")).not.toBeNull();
  });

  it("counts a tap on the Product Hunt link", () => {
    renderAt("/how-to-play");
    fireEvent.click(screen.getByRole("link", { name: "Product Hunt" }));
    expect(funnel.trackCta).toHaveBeenCalledWith("footer_producthunt");
  });

  it("loads nothing from Product Hunt: no badge image or script", () => {
    const { container } = renderAt("/");
    expect(container.querySelector("img, script, iframe")).toBeNull();
  });
});
