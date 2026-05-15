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
    const host = screen.getByRole("link", { name: /host a game/i });
    const join = screen.getByRole("link", { name: /join a game/i });
    const display = screen.getByRole("link", { name: /display screen/i });
    expect(host).toHaveAttribute("href", "/manager/create");
    expect(join).toHaveAttribute("href", "/join");
    expect(display).toHaveAttribute("href", "/display");
  });

  it("links to the dedicated How to Play page", () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );
    const howTo = screen.getByRole("link", { name: /how to play/i });
    expect(howTo).toHaveAttribute("href", "/how-to-play");
  });
});
