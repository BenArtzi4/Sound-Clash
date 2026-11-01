import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { CONTACT_EMAIL } from "../lib/contact";
import { TermsPage, YOUTUBE_TERMS_URL } from "./TermsPage";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/terms"]}>
      <TermsPage />
    </MemoryRouter>,
  );
}

describe("TermsPage", () => {
  it("covers the game, YouTube, fair play, no warranty, privacy and questions", () => {
    renderPage();
    expect(screen.getByRole("heading", { level: 1, name: "Terms of use" })).toBeInTheDocument();
    for (const name of [
      "The game",
      "Songs play on YouTube",
      "Play fair",
      "No warranty",
      "Privacy",
      "Changes and questions",
    ]) {
      expect(screen.getByRole("heading", { level: 2, name })).toBeInTheDocument();
    }
  });

  // YouTube API Services Developer Policies III.A.1: link the YouTube Terms of
  // Service and say in our own terms that users agree to be bound by them.
  it("links the YouTube Terms of Service and binds users to them", () => {
    renderPage();
    const link = screen.getByRole("link", { name: "YouTube Terms of Service" });
    expect(link).toHaveAttribute("href", YOUTUBE_TERMS_URL);
    expect(YOUTUBE_TERMS_URL).toBe("https://www.youtube.com/t/terms");
    expect(link.closest("li")).toHaveTextContent(
      "By using Sound Clash, you agree to be bound by the YouTube Terms of Service.",
    );
    expect(document.body).toHaveTextContent("Sound Clash uses YouTube API Services");
  });

  it("says the service is free, account-free and provided as is", () => {
    renderPage();
    const text = document.body.textContent ?? "";
    expect(text).toContain("no accounts");
    expect(text).toContain("provided as is, without any warranty");
    expect(text).toContain("may change, pause or stop at any time");
    expect(text).toContain("No bots, scripts or other automated use");
    expect(screen.getByText(/^Updated \d{1,2} [A-Z][a-z]+ \d{4}\.$/)).toBeInTheDocument();
  });

  it("links the privacy page and gives a way to reach the maintainer", () => {
    renderPage();
    expect(screen.getByRole("link", { name: "privacy page" })).toHaveAttribute("href", "/privacy");
    const mail = screen.getByRole("link", { name: CONTACT_EMAIL });
    expect(mail).toHaveAttribute("href", `mailto:${CONTACT_EMAIL}`);
  });

  it("names no one: the operator is named only on the privacy page", () => {
    renderPage();
    expect(document.body.textContent ?? "").not.toMatch(/Ben Artzi/);
  });
});
