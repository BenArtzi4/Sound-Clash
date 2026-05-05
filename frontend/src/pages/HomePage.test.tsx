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
    const join = screen.getByRole("link", { name: /join a team/i });
    const display = screen.getByRole("link", { name: /open display/i });
    expect(host).toHaveAttribute("href", "/manager/login");
    expect(join).toHaveAttribute("href", "/join");
    expect(display).toHaveAttribute("href", "/display");
  });
});
