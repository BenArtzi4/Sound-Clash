import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./lib/supabase", async () => {
  const mod = await import("./test/supabaseMock");
  return { supabase: mod.supabaseMock };
});

import { App } from "./App";

beforeEach(() => {
  window.history.pushState({}, "", "/");
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

describe("App router", () => {
  it("renders the home page at /", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: /welcome to sound clash/i })).toBeInTheDocument();
  });

  it("renders /manager/create publicly (no password prompt)", async () => {
    window.history.pushState({}, "", "/manager/create");
    render(<App />);
    // ManagerCreateGamePage is lazy-loaded; findByRole waits for the chunk
    // to settle before asserting.
    expect(
      await screen.findByRole("heading", { name: /host a game/i }),
    ).toBeInTheDocument();
  });

  it("redirects unknown paths home", () => {
    window.history.pushState({}, "", "/totally-bogus");
    render(<App />);
    expect(screen.getByRole("link", { name: /host a game/i })).toBeInTheDocument();
  });
});
