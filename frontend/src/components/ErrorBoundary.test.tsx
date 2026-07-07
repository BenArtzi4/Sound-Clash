import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary";

function Boom(): ReactNode {
  throw new Error("kaboom");
}

const reloadMock = vi.fn();
// jsdom's window.location.reload is non-configurable, so mock the whole
// location object (the `location` property on window IS configurable).
const originalLocation = Object.getOwnPropertyDescriptor(window, "location");
let consoleError: ReturnType<typeof vi.spyOn>;

beforeAll(() => {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { reload: reloadMock },
  });
});

afterAll(() => {
  if (originalLocation) Object.defineProperty(window, "location", originalLocation);
});

beforeEach(() => {
  reloadMock.mockClear();
  // React logs a render error to console.error in addition to our
  // componentDidCatch; silence both so the test output stays clean.
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
});

describe("ErrorBoundary", () => {
  it("renders its children when nothing throws", () => {
    render(
      <ErrorBoundary>
        <p>all good</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText("all good")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a recoverable alert with a Reload CTA when a child throws", () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /something went wrong/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reload/i })).toBeInTheDocument();
    // Assert OUR specific log, not just that console.error fired — React itself
    // also logs caught render errors, so a bare toHaveBeenCalled() would pass
    // even if componentDidCatch's own logging were removed (false-green).
    expect(consoleError).toHaveBeenCalledWith(
      "Unhandled render error:",
      expect.any(Error),
      expect.anything(),
    );
  });

  it("hard-reloads the page when the Reload CTA is clicked", () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    fireEvent.click(screen.getByRole("button", { name: /reload/i }));
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });
});
