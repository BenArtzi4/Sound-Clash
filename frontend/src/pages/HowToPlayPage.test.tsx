import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { HowToPlayPage } from "./HowToPlayPage";

describe("HowToPlayPage", () => {
  it("renders roles, game flow, and scoring sections", () => {
    render(
      <MemoryRouter>
        <HowToPlayPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { level: 1, name: /how to play/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /^roles$/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /game flow/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /^scoring$/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /teams join/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /listen & buzz/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /manager awards/i })).toBeInTheDocument();
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
