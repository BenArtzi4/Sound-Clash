import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetServerTime,
  observeServerTime,
  serverTimeNow,
  useServerTime,
} from "./useServerTime";

beforeEach(() => {
  _resetServerTime();
});

afterEach(() => {
  vi.useRealTimers();
  _resetServerTime();
});

describe("useServerTime", () => {
  it("uses no offset before any event is observed", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-05T12:00:00.000Z"));
    expect(serverTimeNow().toISOString()).toBe("2026-05-05T12:00:00.000Z");
  });

  it("computes offset from the first observed commit timestamp", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-05T12:00:00.500Z"));
    observeServerTime("2026-05-05T12:00:00.000Z");
    expect(serverTimeNow().toISOString()).toBe("2026-05-05T12:00:00.000Z");
    vi.advanceTimersByTime(1000);
    expect(serverTimeNow().toISOString()).toBe("2026-05-05T12:00:01.000Z");
  });

  it("ignores subsequent observations once an offset is set", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-05T12:00:00.500Z"));
    observeServerTime("2026-05-05T12:00:00.000Z");
    observeServerTime("2026-05-05T12:00:05.000Z");
    expect(serverTimeNow().toISOString()).toBe("2026-05-05T12:00:00.000Z");
  });

  it("ignores invalid timestamps", () => {
    observeServerTime("not-a-date");
    expect(serverTimeNow().getTime()).toBeCloseTo(Date.now(), -2);
  });

  it("hook returns the same module-scope helpers", () => {
    const hook = useServerTime();
    expect(hook.serverTimeNow).toBe(serverTimeNow);
    expect(hook.observeServerTime).toBe(observeServerTime);
  });
});
