import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./lib/supabase", async () => {
  const mod = await import("./test/supabaseMock");
  return { supabase: mod.supabaseMock };
});

import { App } from "./App";
import { setAdminPassword } from "./context/authStorage";

beforeEach(() => {
  window.history.pushState({}, "", "/");
  window.sessionStorage.clear();
  setAdminPassword(null);
});

afterEach(() => {
  window.sessionStorage.clear();
  setAdminPassword(null);
});

describe("App router", () => {
  it("renders the home page at /", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: /welcome to sound clash/i })).toBeInTheDocument();
  });

  it("guards /manager/create when no admin password is set", () => {
    window.history.pushState({}, "", "/manager/create");
    render(<App />);
    expect(screen.getByPlaceholderText(/password/i)).toBeInTheDocument();
  });

  it("redirects unknown paths home", () => {
    window.history.pushState({}, "", "/totally-bogus");
    render(<App />);
    expect(screen.getByRole("link", { name: /manager console/i })).toBeInTheDocument();
  });
});
