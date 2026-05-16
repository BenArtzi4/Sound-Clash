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

  it("renders all seven steps in order with visible numbers", () => {
    render(
      <MemoryRouter>
        <HowToPlayPage />
      </MemoryRouter>,
    );
    const stepHeadings = [
      /host a game/i,
      /pick genres and create/i,
      /open the display screen/i,
      /teams join from their phones/i,
      /start the game/i,
      /buzz and judge/i,
      /award a bonus/i,
    ];
    for (const name of stepHeadings) {
      expect(screen.getByRole("heading", { level: 3, name })).toBeInTheDocument();
    }
    // Numbers 1–7 are rendered as text in the step circles.
    for (let i = 1; i <= 7; i++) {
      expect(screen.getByText(String(i))).toBeInTheDocument();
    }
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
