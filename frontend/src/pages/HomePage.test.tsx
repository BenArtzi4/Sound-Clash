import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { HomePage } from "./HomePage";

describe("HomePage", () => {
  it("renders three CTAs linking to host/join/display", () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );
    const host = screen.getByRole("link", { name: /manager console/i });
    const join = screen.getByRole("link", { name: /join as team/i });
    const display = screen.getByRole("link", { name: /display screen/i });
    expect(host).toHaveAttribute("href", "/manager/login");
    expect(join).toHaveAttribute("href", "/join");
    expect(display).toHaveAttribute("href", "/display");
  });

  it("renders the How to Play steps", () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: /how to play/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /teams join/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /listen & buzz/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /manager awards/i })).toBeInTheDocument();
  });
});
