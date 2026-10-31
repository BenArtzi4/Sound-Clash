import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { CONTACT_EMAIL, PrivacyPage } from "./PrivacyPage";

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

  it("gives a way to reach the maintainer", () => {
    renderPage();
    const link = screen.getByRole("link", { name: CONTACT_EMAIL });
    expect(link).toHaveAttribute("href", `mailto:${CONTACT_EMAIL}`);
  });
});
