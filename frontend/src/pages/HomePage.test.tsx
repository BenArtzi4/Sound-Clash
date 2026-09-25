import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
});

// Screen changes are instant (docs/planning/ui-redesign/10-touch-and-route-motion.md):
// no view transition, no wordmark morph. The stub runs the update callback, so
// a regression shows up as a non-zero count rather than a stuck navigation.
describe("HomePage navigation", () => {
  let transitions = 0;

  beforeEach(() => {
    transitions = 0;
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: (cb: () => unknown) => {
        transitions += 1;
        void cb();
        return { finished: Promise.resolve() };
      },
    });
  });
  afterEach(() => {
    Reflect.deleteProperty(document, "startViewTransition");
  });

  it.each([
    [/host a game/i, "/manager/create", "host"],
    [/display screen/i, "/display", "display"],
    [/how to play/i, "/how-to-play", "how to play"],
  ])("opens %s with no view transition", async (name, path, marker) => {
    render(
      <MemoryRouter>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path={path} element={<p>{marker} page</p>} />
        </Routes>
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole("link", { name }));
    await waitFor(() => expect(screen.getByText(`${marker} page`)).toBeInTheDocument(), {
      timeout: 5000,
    });
    expect(transitions).toBe(0);
  });
});

// Touch gets a ripple from the finger; a mouse keeps the diagonal hover sweep.
describe("HomePage touch ripple", () => {
  function hostCard() {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );
    const card = screen.getByRole("link", { name: /host a game/i });
    vi.spyOn(card, "getBoundingClientRect").mockReturnValue(
      DOMRect.fromRect({ x: 0, y: 100, width: 300, height: 80 }),
    );
    return card;
  }

  it("spreads a ripple from where the finger lands", () => {
    const card = hostCard();
    fireEvent.pointerDown(card, { pointerType: "touch", clientX: 60, clientY: 120 });
    const dot = card.querySelector<HTMLElement>("[data-ripple]");
    expect(dot).not.toBeNull();
    // Sized to reach the farthest corner from the touch point (240, 60 away),
    // and centred on that point (60, 20 inside the card).
    const r = Math.hypot(240, 60);
    expect(parseFloat(dot!.style.width)).toBeCloseTo(2 * r);
    expect(parseFloat(dot!.style.height)).toBeCloseTo(2 * r);
    expect(parseFloat(dot!.style.left) + r).toBeCloseTo(60);
    expect(parseFloat(dot!.style.top) + r).toBeCloseTo(20);
  });

  // iOS Safari snapshots Home for its swipe-back preview at the moment the
  // page changes. A tap that navigates in the same instant bakes the ripple
  // into that snapshot, so the swipe back showed the pressed card. The tap
  // clears it and waits for a painted frame before leaving.
  it("clears the ripple and paints a clean frame before leaving on a touch tap", async () => {
    const frames: ((time: number) => void)[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: (time: number) => void) => frames.push(cb));
    try {
      render(
        <MemoryRouter>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/display" element={<p>display page</p>} />
          </Routes>
        </MemoryRouter>,
      );
      const card = screen.getByRole("link", { name: /display screen/i });
      fireEvent.pointerDown(card, { pointerType: "touch", clientX: 10, clientY: 10 });
      fireEvent.pointerUp(card, { pointerType: "touch", clientX: 10, clientY: 10 });
      fireEvent.click(card);
      expect(card.querySelector("[data-ripple]")).toBeNull();
      // Two frames: the first runs before the clean paint, the second after it.
      act(() => frames.shift()?.(0));
      expect(screen.queryByText("display page")).toBeNull();
      act(() => frames.shift()?.(16));
      expect(await screen.findByText("display page")).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("leaves a mouse press to the hover sweep", () => {
    const card = hostCard();
    fireEvent.pointerDown(card, { pointerType: "mouse", clientX: 60, clientY: 120 });
    expect(card.querySelector("[data-ripple]")).toBeNull();
  });

  it("fades the ripple out when the finger lifts, then removes it", () => {
    vi.useFakeTimers();
    try {
      const card = hostCard();
      fireEvent.pointerDown(card, { pointerType: "touch", clientX: 60, clientY: 120 });
      fireEvent.pointerUp(card, { pointerType: "touch", clientX: 60, clientY: 120 });
      expect(card.querySelector("[data-ripple]")).toHaveAttribute("data-leaving");
      vi.advanceTimersByTime(500);
      expect(card.querySelector("[data-ripple]")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

// The fade-up is for someone opening the site on Home. Replaying it on every
// mount blanked the first frame after a back-swipe (the "loads, flashes, loads
// again" report). The landing path is read when the module first evaluates, so
// each case imports a fresh copy of the page.
describe("HomePage intro", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  async function freshHome(landingPath: string) {
    window.history.replaceState(null, "", landingPath);
    vi.resetModules();
    return (await import("./HomePage")).HomePage;
  }
  function renderHome(Home: typeof HomePage) {
    return render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>,
    ).container.firstElementChild;
  }

  it("plays when the site opens on Home", async () => {
    const Home = await freshHome("/");
    expect(renderHome(Home)).toHaveAttribute("data-intro", "true");
  });

  it("does not replay when you come back to Home", async () => {
    const Home = await freshHome("/");
    renderHome(Home);
    cleanup();
    expect(renderHome(Home)).not.toHaveAttribute("data-intro");
  });

  it("does not play when the site opened on another page", async () => {
    const Home = await freshHome("/join");
    expect(renderHome(Home)).not.toHaveAttribute("data-intro");
  });
});
