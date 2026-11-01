import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AgreeNote, LegalLinks } from "./LegalLinks";

// Both open in a new tab: the host's form or a team's game must survive a tap.
function expectNewTab(link: HTMLElement, href: string) {
  expect(link).toHaveAttribute("href", href);
  expect(link).toHaveAttribute("target", "_blank");
  expect(link).toHaveAttribute("rel", "noopener");
}

describe("LegalLinks", () => {
  it("links Privacy and Terms in a new tab", () => {
    render(<LegalLinks className="extra" />);
    const p = screen.getByTestId("legal-links");
    expect(p).toHaveTextContent("Privacy · Terms");
    expect(p.className).toMatch(/extra/);
    expectNewTab(within(p).getByRole("link", { name: "Privacy" }), "/privacy");
    expectNewTab(within(p).getByRole("link", { name: "Terms" }), "/terms");
  });
});

describe("AgreeNote", () => {
  it("says what using the button means and links both pages in a new tab", () => {
    render(<AgreeNote action="joining" />);
    const p = screen.getByTestId("agree-note");
    expect(p).toHaveTextContent("By joining you agree to the Terms and the Privacy policy.");
    expectNewTab(within(p).getByRole("link", { name: "Terms" }), "/terms");
    expectNewTab(within(p).getByRole("link", { name: "Privacy policy" }), "/privacy");
  });
});
