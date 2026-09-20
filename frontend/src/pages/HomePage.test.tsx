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

  // Each card renders its content twice — the resting face and the clipped
  // fill copy — so the accessible name has to come from aria-label, not from
  // the duplicated text. If that ever regresses, getByRole throws on the
  // multiple matches and the whole e2e suite goes with it: every game spec
  // enters through fixtures/manager-context.ts, which clicks /host a game/i.
  it("keeps one uniquely-named link per role despite the duplicated fill copy", () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );
    for (const name of [/host a game/i, /join a game/i, /display screen/i]) {
      expect(screen.getAllByRole("link", { name })).toHaveLength(1);
    }
    // The second copy must stay out of the accessibility tree entirely.
    const hidden = document.querySelectorAll('[aria-hidden="true"]');
    expect(hidden.length).toBeGreaterThanOrEqual(3);
  });

  // The hue of each card comes from --role-* selected by this attribute, so a
  // missing or renamed value silently drops the colour rather than failing.
  it("tags each role with the attribute its colour is keyed on", () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: /host a game/i })).toHaveAttribute("data-role", "host");
    expect(screen.getByRole("link", { name: /join a game/i })).toHaveAttribute("data-role", "play");
    expect(screen.getByRole("link", { name: /display screen/i })).toHaveAttribute(
      "data-role",
      "display",
    );
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
