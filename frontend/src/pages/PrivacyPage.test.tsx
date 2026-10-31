import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { CONTACT_EMAIL } from "../lib/contact";
import { GOOGLE_PRIVACY_URL, PrivacyPage } from "./PrivacyPage";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/privacy"]}>
      <PrivacyPage />
    </MemoryRouter>,
  );
}

describe("PrivacyPage", () => {
  it("covers what is stored, on the device, usage, services and questions", () => {
    renderPage();
    expect(screen.getByRole("heading", { level: 1, name: "Privacy" })).toBeInTheDocument();
    for (const name of [
      "While you play",
      "On your device",
      "Usage and errors",
      "Services that handle this data",
      "Songs from YouTube",
      "Questions",
    ]) {
      expect(screen.getByRole("heading", { level: 2, name })).toBeInTheDocument();
    }
  });

  it("names every service that sees visitor data", () => {
    renderPage();
    const text = document.body.textContent ?? "";
    for (const service of [
      "Supabase",
      "Render",
      "Cloudflare",
      "Grafana Cloud",
      "Sentry",
      "YouTube",
    ]) {
      expect(text).toContain(service);
    }
  });

  // YouTube API Services Developer Policies III.A.2.b, c and g: say the site
  // uses YouTube API Services, link the Google Privacy Policy, and disclose
  // that YouTube may set cookies on the device that plays the songs.
  it("carries the notices YouTube's API policies require", () => {
    renderPage();
    const link = screen.getByRole("link", { name: "Google Privacy Policy" });
    expect(link).toHaveAttribute("href", GOOGLE_PRIVACY_URL);
    expect(GOOGLE_PRIVACY_URL).toBe("https://www.google.com/policies/privacy");
    const section = screen.getByRole("heading", { level: 2, name: "Songs from YouTube" })
      .parentElement as HTMLElement;
    expect(section).toHaveTextContent("Sound Clash uses YouTube API Services");
    expect(section).toHaveTextContent("cookies");
    expect(section).toHaveTextContent("no YouTube or Google sign-in");
  });

  it("gives a way to reach the maintainer", () => {
    renderPage();
    const link = screen.getByRole("link", { name: CONTACT_EMAIL });
    expect(link).toHaveAttribute("href", `mailto:${CONTACT_EMAIL}`);
  });
});
