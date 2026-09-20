import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
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

  // Each CTA is a TransitionLink that preloads its destination's lazy chunk
  // before navigating, so the route transition never animates to the Suspense
  // fallback. jsdom has no startViewTransition, so this exercises the plain
  // fallback path — and, with it, that the preload really runs and a click on
  // a real <a href> still navigates.
  it.each([
    [/host a game/i, "/manager/create", "host"],
    [/display screen/i, "/display", "display"],
    [/how to play/i, "/how-to-play", "how to play"],
  ])("preloads and navigates when %s is clicked", async (name, path, marker) => {
    render(
      <MemoryRouter>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path={path} element={<p>{marker} page</p>} />
        </Routes>
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole("link", { name }));
    await waitFor(
      () => expect(screen.getByText(`${marker} page`)).toBeInTheDocument(),
      // The preload is a real module-graph evaluation under vitest.
      { timeout: 5000 },
    );
  });
});
