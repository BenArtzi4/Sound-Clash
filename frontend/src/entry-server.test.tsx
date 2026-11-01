import { act, waitFor } from "@testing-library/react";
import { StrictMode, type Context } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import {
  UNSAFE_DataRouterContext,
  UNSAFE_DataRouterStateContext,
  UNSAFE_LocationContext,
  UNSAFE_NavigationContext,
  UNSAFE_RouteContext,
} from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./lib/supabase", async () => {
  const mod = await import("./test/supabaseMock");
  return { supabase: mod.supabaseMock };
});
vi.mock("./lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./lib/api")>()),
  getHealth: vi.fn(() => Promise.resolve({ status: "ok" })),
  listGenres: vi.fn(() => Promise.resolve([])),
}));

import { App } from "./App";
import { llmsFullTxt, llmsTxt, render, structuredDataFor } from "./entry-server";
import { seo } from "./lib/routeHead";
import { landingFor } from "./seo/landingContent";

const PRERENDERED = seo.pages.filter((p) => p.prerender).map((p) => p.path);

// React's server renderer leaves its last context values on the shared context
// objects until its next render starts, so in one JS realm the client renderer
// would read the server's router as already mounted ("You cannot render a
// <Router> inside another <Router>"). The build renders in Node and the browser
// hydrates in another realm, so this is a test-only effect: put the router
// contexts back to their defaults after each server render.
type Leaky = Context<unknown> & { _currentValue: unknown };
const ROUTER_CONTEXTS = [
  UNSAFE_DataRouterContext,
  UNSAFE_DataRouterStateContext,
  UNSAFE_LocationContext,
  UNSAFE_NavigationContext,
  UNSAFE_RouteContext,
] as unknown as Leaky[];
const DEFAULTS = ROUTER_CONTEXTS.map((c) => c._currentValue);

async function serverHtml(path: string): Promise<string> {
  const { html } = await render(path);
  ROUTER_CONTEXTS.forEach((c, i) => {
    c._currentValue = DEFAULTS[i];
  });
  return html;
}

let mounted: { root: Root; el: HTMLElement } | null = null;

afterEach(() => {
  if (mounted) {
    const { root, el } = mounted;
    act(() => root.unmount());
    el.remove();
    mounted = null;
  }
  vi.restoreAllMocks();
  window.history.pushState({}, "", "/");
});

describe("render (build-time prerender)", () => {
  it("prerenders Home, How to play and every landing page", () => {
    expect(PRERENDERED).toEqual(
      expect.arrayContaining(["/", "/how-to-play", "/guess-the-song-with-friends"]),
    );
  });

  it.each(PRERENDERED)("writes the full markup of %s, lazy chunk included", async (path) => {
    const html = await serverHtml(path);
    const doc = document.createElement("div");
    doc.innerHTML = html;
    const h1 = doc.querySelector("h1")?.textContent ?? "";
    expect(h1.length).toBeGreaterThan(0);
    // The Suspense fallback is a pulsing logo with role=status; a page that
    // came out as its fallback would have no H1 and one of these.
    expect(doc.querySelector('[role="status"][aria-label="Loading"]')).toBeNull();
    if (seo.pages.find((p) => p.path === path)?.landing) {
      expect(h1).toBe(landingFor(path).h1);
    }
  });

  it("gives Home its new below-the-fold section and footer", async () => {
    const html = await serverHtml("/");
    expect(html).toContain("A guess-the-song game for the whole room");
    expect(html).toContain("Is Sound Clash free?");
    expect(html).toContain('href="/guess-the-song-with-friends"');
  });

  // Crawlers and link previews see the video's poster and play button; the
  // YouTube player itself only loads on a tap in the browser.
  it("writes Home's video as a poster, never as a player", async () => {
    const html = await serverHtml("/");
    const doc = document.createElement("div");
    doc.innerHTML = html;
    const button = doc.querySelector("figure button");
    expect(button?.getAttribute("aria-label")).toMatch(/^Play the video: how to play Sound Clash/);
    const poster = button?.querySelector("img");
    expect(poster?.getAttribute("src")).toBe("https://i.ytimg.com/vi/_vFY865K6Qc/oardefault.jpg");
    expect(poster?.getAttribute("loading")).toBe("lazy");
    expect(doc.querySelector("figcaption")?.textContent).toBe("How to play, in 20 seconds");
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("youtube-nocookie");
  });

  it("re-exports the head and text builders the build script calls", () => {
    expect(structuredDataFor("/").length).toBeGreaterThan(0);
    expect(llmsTxt().startsWith("# Sound Clash")).toBe(true);
    expect(llmsFullTxt().startsWith("# Sound Clash")).toBe(true);
  });
});

// main.tsx hydrates the prerendered markup with <App />. If the server tree
// and the client tree ever drift apart (a wrapper that adds a DOM node in one
// but not the other, a render that reads window), React throws the server
// markup away and re-renders, which is a visible flash and lost intro
// animation. These tests hydrate exactly what the build writes.
describe("hydrating the prerendered markup", () => {
  it.each(PRERENDERED)("keeps the server DOM of %s", async (path) => {
    const html = await serverHtml(path);
    const errors: unknown[] = [];
    const consoleError = vi.spyOn(console, "error");

    window.history.pushState({}, "", path);
    const el = document.createElement("div");
    el.id = "root";
    el.innerHTML = html;
    document.body.appendChild(el);
    const h1 = el.querySelector("h1");
    expect(h1).not.toBeNull();

    let root: Root | undefined;
    await act(async () => {
      root = hydrateRoot(
        el,
        <StrictMode>
          <App />
        </StrictMode>,
        { onRecoverableError: (error) => errors.push(error) },
      );
    });
    mounted = { root: root as Root, el };

    // A lazy page hydrates once its chunk has loaded.
    await waitFor(() =>
      expect(Object.keys(h1 ?? {}).some((k) => k.startsWith("__reactFiber"))).toBe(true),
    );
    expect(el.querySelector("h1")).toBe(h1);
    expect(errors).toEqual([]);
    const hydrationWarnings = consoleError.mock.calls.filter((args) =>
      args.some((a) => typeof a === "string" && /hydrat/i.test(a)),
    );
    expect(hydrationWarnings).toEqual([]);
  });
});
