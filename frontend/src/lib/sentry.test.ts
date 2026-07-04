import { describe, expect, it, vi } from "vitest";

// Mutable fake env + fake Sentry, created at hoist time so the vi.mock factories
// (hoisted) and the test bodies share the same objects. We flip
// envMock.VITE_SENTRY_DSN + call _resetSentry() to move the module between
// enabled and disabled. vi.mock intercepts the dynamic import("@sentry/react")
// inside loadSentry, so the fake applies there too.
const h = vi.hoisted(() => {
  const init = vi.fn();
  const captureException = vi.fn();
  const envMock: { VITE_SENTRY_DSN: string | undefined } = { VITE_SENTRY_DSN: undefined };
  return { init, captureException, envMock };
});

vi.mock("./env", () => ({ env: h.envMock }));
vi.mock("@sentry/react", () => ({ init: h.init, captureException: h.captureException }));

import * as sentry from "./sentry";

const DSN = "https://public@o1.ingest.sentry.io/2";

function enable() {
  h.envMock.VITE_SENTRY_DSN = DSN;
  sentry._resetSentry();
}

function disable() {
  h.envMock.VITE_SENTRY_DSN = undefined;
  sentry._resetSentry();
}

// The "error" handler installErrorBuffer just registered on window. We invoke it
// directly instead of dispatching a real uncaught ErrorEvent — an unhandled
// error event surfaces as harness noise in jsdom/vitest.
function grabErrorHandler(): (e: { error: unknown }) => void {
  const add = vi.spyOn(window, "addEventListener");
  sentry.installErrorBuffer();
  const call = add.mock.calls.find((c) => c[0] === "error");
  add.mockRestore();
  return call?.[1] as unknown as (e: { error: unknown }) => void;
}

describe("sentry (disabled — VITE_SENTRY_DSN unset)", () => {
  it("installErrorBuffer attaches no listeners and loadSentry never inits", async () => {
    disable();
    h.init.mockClear();
    const add = vi.spyOn(window, "addEventListener");
    sentry.installErrorBuffer();
    expect(add).not.toHaveBeenCalled();
    add.mockRestore();
    await sentry.loadSentry();
    expect(h.init).not.toHaveBeenCalled();
  });
});

describe("sentry (enabled)", () => {
  it("buffers an early error and replays it into Sentry once loaded", async () => {
    enable();
    h.init.mockClear();
    h.captureException.mockClear();
    const handler = grabErrorHandler();

    const err = new Error("early boom");
    handler({ error: err });

    await sentry.loadSentry();

    expect(h.init).toHaveBeenCalledWith(expect.objectContaining({ dsn: DSN, tracesSampleRate: 0 }));
    expect(h.captureException).toHaveBeenCalledWith(err);
  });

  it("detaches its native handlers after loading (Sentry's globals take over)", async () => {
    enable();
    const remove = vi.spyOn(window, "removeEventListener");
    sentry.installErrorBuffer();
    await sentry.loadSentry();
    expect(remove).toHaveBeenCalledWith("error", expect.any(Function));
    expect(remove).toHaveBeenCalledWith("unhandledrejection", expect.any(Function));
    remove.mockRestore();
  });

  it("installErrorBuffer is idempotent (second call does not double-attach)", () => {
    enable();
    const add = vi.spyOn(window, "addEventListener");
    sentry.installErrorBuffer();
    const afterFirst = add.mock.calls.length;
    sentry.installErrorBuffer();
    expect(add.mock.calls.length).toBe(afterFirst);
    add.mockRestore();
  });

  it("loadSentry swallows a Sentry.init failure", async () => {
    enable();
    h.init.mockImplementationOnce(() => {
      throw new Error("init failed");
    });
    sentry.installErrorBuffer();
    await expect(sentry.loadSentry()).resolves.toBeUndefined();
  });

  it("loadSentry works with nothing buffered", async () => {
    enable();
    h.init.mockClear();
    h.captureException.mockClear();
    // No installErrorBuffer() call — buffer is null.
    await sentry.loadSentry();
    expect(h.init).toHaveBeenCalledTimes(1);
    expect(h.captureException).not.toHaveBeenCalled();
  });
});
