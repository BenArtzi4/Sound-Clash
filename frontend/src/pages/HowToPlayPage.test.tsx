import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { HowToPlayPage } from "./HowToPlayPage";

describe("HowToPlayPage", () => {
  it("renders roles, steps, scoring, and rules sections", () => {
    render(
      <MemoryRouter>
        <HowToPlayPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { level: 1, name: /how to play/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /^roles$/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /steps to run a game/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /^scoring$/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /rules & faq/i })).toBeInTheDocument();
  });

  it("groups the steps into a Set up phase and a Play phase", () => {
    render(
      <MemoryRouter>
        <HowToPlayPage />
      </MemoryRouter>,
    );
    expect(screen.getByText(/^set up$/i)).toBeInTheDocument();
    expect(screen.getByText(/^play$/i)).toBeInTheDocument();
  });

  it("renders all seven steps in order with visible numbers", () => {
    render(
      <MemoryRouter>
        <HowToPlayPage />
      </MemoryRouter>,
    );
    const stepTitles = [
      /host a game/i,
      /^pick genres$/i,
      /open the display/i,
      /^teams join$/i,
      /^start$/i,
      /buzz & judge/i,
      /^bonus$/i,
    ];
    for (const name of stepTitles) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
    // Numbers 1–7 are rendered as text in the step circles (1–4 setup, 5–7 play).
    for (let i = 1; i <= 7; i++) {
      expect(screen.getByText(String(i))).toBeInTheDocument();
    }
  });

  it("calls out that audio plays from the host's phone", () => {
    render(
      <MemoryRouter>
        <HowToPlayPage />
      </MemoryRouter>,
    );
    expect(screen.getByText(/audio plays from the host's phone/i)).toBeInTheDocument();
  });

  it("surfaces the key gameplay rules in the FAQ", () => {
    render(
      <MemoryRouter>
        <HowToPlayPage />
      </MemoryRouter>,
    );
    expect(screen.getByText(/free guess after a correct answer/i)).toBeInTheDocument();
    expect(screen.getByText(/two answers per song/i)).toBeInTheDocument();
    expect(screen.getByText(/wrong buzz doesn't lock you out/i)).toBeInTheDocument();
    expect(screen.getByText(/bonus anytime/i)).toBeInTheDocument();
    expect(screen.getByText(/one phone per team/i)).toBeInTheDocument();
  });

  it("renders the hero image near the top", () => {
    render(
      <MemoryRouter>
        <HowToPlayPage />
      </MemoryRouter>,
    );
    const hero = screen.getByRole("img", { name: /three-screen setup/i });
    expect(hero).toHaveAttribute("src", "/how-to-play-hero.png");
  });

  it("links back to the home page", () => {
    render(
      <MemoryRouter>
        <HowToPlayPage />
      </MemoryRouter>,
    );
    const back = screen.getByRole("link", { name: /back/i });
    expect(back).toHaveAttribute("href", "/");
  });
});
