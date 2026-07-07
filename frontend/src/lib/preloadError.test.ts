import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetChunkReloadGuard, installPreloadErrorHandler } from "./preloadError";

// The sessionStorage key the guard persists its reload budget under. Kept in
// sync with preloadError.ts (internal there; asserted here).
const GUARD_KEY = "sc:chunk-reload-guard";
const T0 = new Date("2026-01-01T00:00:00Z").getTime();
const PAST_WINDOW = 6 * 60_000; // > INCIDENT_WINDOW_MS (5 min)

const reloadMock = vi.fn();
// jsdom's window.location.reload is non-configurable, so mock the whole
// location object (the `location` property on window IS configurable).
const originalLocation = Object.getOwnPropertyDescriptor(window, "location");

function firePreloadError(): Event {
  const event = new Event("vite:preloadError", { cancelable: true });
  window.dispatchEvent(event);
  return event;
}

function readGuard(): { n: number; at: number } | null {
  const raw = window.sessionStorage.getItem(GUARD_KEY);
  return raw ? JSON.parse(raw) : null;
}

// Install exactly once for the whole file. installPreloadErrorHandler is
// idempotent, so the window listener is never stacked; each test resets only
// the persisted budget via _resetChunkReloadGuard.
beforeAll(() => {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { reload: reloadMock },
  });
  installPreloadErrorHandler();
});

afterAll(() => {
  if (originalLocation) Object.defineProperty(window, "location", originalLocation);
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  reloadMock.mockClear();
  window.sessionStorage.clear();
  _resetChunkReloadGuard();
});

afterEach(() => {
  vi.useRealTimers();
  // Restore any spies (e.g. the throwing-storage spy) even if a test failed
  // mid-body, so a throwing stub can't leak into the next test.
  vi.restoreAllMocks();
});

describe("preloadError handler", () => {
  it("reloads once, records the budget, and cancels the event on the first error", () => {
    const event = firePreloadError();
    expect(reloadMock).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    expect(readGuard()).toEqual({ n: 1, at: T0 });
  });

  it("caps auto-reloads per incident, then defers to the ErrorBoundary", () => {
    firePreloadError();
    expect(reloadMock).toHaveBeenCalledTimes(1);

    // A second failure within the incident window has exhausted the budget:
    // no reload, and the event is left to propagate (Vite rethrows -> boundary).
    vi.setSystemTime(T0 + 3_000);
    const second = firePreloadError();
    expect(reloadMock).toHaveBeenCalledTimes(1);
    expect(second.defaultPrevented).toBe(false);
  });

  it("resets the budget after the incident window (a later deploy)", () => {
    firePreloadError();
    expect(reloadMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(T0 + PAST_WINDOW);
    firePreloadError();
    expect(reloadMock).toHaveBeenCalledTimes(2);
  });

  it("does NOT auto-reload when sessionStorage is unavailable (defers to CTA)", () => {
    vi.spyOn(window.Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });

    const event = firePreloadError();
    // No durable budget => auto-reload can't be made loop-safe => defer.
    expect(reloadMock).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    // The spy is restored in afterEach, so it can't leak into later tests.
  });

  it("is idempotent: a repeat install does not re-register the listener", () => {
    // The handler was already installed in beforeAll. A second/third install
    // must hit the `installed` guard and NOT call addEventListener again
    // (belt-and-suspenders over the DOM's own de-dup). Test 1 already proves
    // the one real registration works.
    const addSpy = vi.spyOn(window, "addEventListener");
    installPreloadErrorHandler();
    installPreloadErrorHandler();
    const reRegistrations = addSpy.mock.calls.filter(([type]) => type === "vite:preloadError");
    expect(reRegistrations).toHaveLength(0);
  });
});
