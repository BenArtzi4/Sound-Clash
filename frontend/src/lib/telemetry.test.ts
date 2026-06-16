import { describe, expect, it, vi } from "vitest";

// Mutable fake env + fake Faro/OTel, created at hoist time so the vi.mock
// factories (hoisted) and the test bodies share the same objects. We toggle
// envMock.VITE_FARO_URL + call _resetTelemetry()/initTelemetry() to flip the
// module between enabled and disabled — no module resets or env stubs needed.
// (The Faro SDK is dynamically imported by initTelemetry; vi.mock intercepts
// dynamic imports too, so the fakes still apply.)
const h = vi.hoisted(() => {
  const makeSpan = () => ({ setAttribute: vi.fn(), setStatus: vi.fn(), end: vi.fn() });
  const startSpan = vi.fn(() => makeSpan());
  const tracer = { startSpan };
  const otel = {
    trace: { getTracer: vi.fn(() => tracer), setSpan: vi.fn((ctx: unknown) => ctx) },
    context: { active: vi.fn(() => ({})) },
  };
  const pushEvent = vi.fn();
  const pushLog = vi.fn();
  const faro = { api: { getOTEL: vi.fn(() => otel), pushEvent, pushLog } };
  const initializeFaro = vi.fn(() => faro);
  const envMock: {
    VITE_SUPABASE_URL: string;
    VITE_SUPABASE_ANON_KEY: string;
    VITE_API_URL: string;
    VITE_SENTRY_DSN: string | undefined;
    VITE_FARO_URL: string | undefined;
  } = {
    VITE_SUPABASE_URL: "http://localhost:54321",
    VITE_SUPABASE_ANON_KEY: "anon-test",
    VITE_API_URL: "http://localhost:8000",
    VITE_SENTRY_DSN: undefined,
    VITE_FARO_URL: undefined,
  };
  return { makeSpan, startSpan, otel, pushEvent, pushLog, faro, initializeFaro, envMock };
});

vi.mock("./env", () => ({ env: h.envMock }));
vi.mock("@grafana/faro-web-sdk", () => ({
  initializeFaro: h.initializeFaro,
  getWebInstrumentations: () => [],
  LogLevel: { INFO: "info", WARN: "warn", ERROR: "error" },
}));
vi.mock("@grafana/faro-web-tracing", () => ({
  TracingInstrumentation: class {},
}));

import * as tele from "./telemetry";

const FARO_URL = "https://faro-collector-test.grafana.net/collect/abc";

async function enable() {
  h.envMock.VITE_FARO_URL = FARO_URL;
  tele._resetTelemetry();
  await tele.initTelemetry();
}

async function disable() {
  h.envMock.VITE_FARO_URL = undefined;
  tele._resetTelemetry();
  await tele.initTelemetry();
}

// New spans created since index `i` (mock call history is never cleared, so we
// slice rather than reset — keeps the fake implementations intact).
function spansFrom(i: number) {
  return h.startSpan.mock.results.slice(i).map((r) => r.value);
}
function spanCount() {
  return h.startSpan.mock.results.length;
}

describe("telemetry (disabled — VITE_FARO_URL unset)", () => {
  it("never initializes Faro and reports disabled", async () => {
    h.initializeFaro.mockClear();
    await disable();
    expect(tele.isEnabled()).toBe(false);
    expect(h.initializeFaro).not.toHaveBeenCalled();
  });

  it("tracedRpc passes the resolved value through unchanged", async () => {
    await disable();
    const value = { data: [1], error: null };
    await expect(
      tele.tracedRpc("buzz_in", { game_code: "ABC" }, () => Promise.resolve(value)),
    ).resolves.toBe(value);
  });

  it("tracedRpc rejects with the same error (non-blocking contract)", async () => {
    await disable();
    const err = new Error("boom");
    await expect(tele.tracedRpc("buzz_in", {}, () => Promise.reject(err))).rejects.toBe(err);
  });

  it("tracedFetch passes the response through unchanged", async () => {
    await disable();
    const res = new Response("ok", { status: 200 });
    await expect(tele.tracedFetch("POST", "POST /games", () => Promise.resolve(res))).resolves.toBe(
      res,
    );
  });

  it("all span/log helpers are no-throw no-ops", async () => {
    await disable();
    const before = spanCount();
    expect(() => {
      const song = tele.startSongStart({ game_code: "ABC" });
      song.rpcDone({ roundNumber: 1, songId: "s1", youtubeId: "yt" });
      song.loadIssued();
      song.playing("statechange");
      song.fail("x");
      tele.markBuzzStart("ABC", "team1", 2);
      tele.resolveBuzzE2E("team1", new Date().toISOString());
      tele.failBuzz("team1");
      tele.markScoreStart("ABC", "r1", "title");
      tele.resolveScoreE2E("r1", new Date().toISOString());
      tele.failScore("r1", "title");
      tele.recordFanout("game", new Date().toISOString());
      const pi = tele.startPlayerInit();
      pi.apiLoaded(true);
      pi.ready();
      tele.log("error", "msg", { k: "v" });
    }).not.toThrow();
    expect(spanCount()).toBe(before);
  });
});

describe("telemetry (enabled)", () => {
  it("initializes Faro once and reports enabled (idempotent)", async () => {
    h.envMock.VITE_FARO_URL = FARO_URL;
    tele._resetTelemetry();
    const before = h.initializeFaro.mock.calls.length;
    await tele.initTelemetry();
    await tele.initTelemetry();
    expect(h.initializeFaro.mock.calls.length - before).toBe(1);
    expect(tele.isEnabled()).toBe(true);
  });

  it("tracedRpc starts a span, returns the value, and ends the span", async () => {
    await enable();
    const i = spanCount();
    const value = { data: 1, error: null };
    const out = await tele.tracedRpc("award_attempt", { game_code: "ABC" }, () =>
      Promise.resolve(value),
    );
    expect(out).toBe(value);
    const span = spansFrom(i)[0];
    expect(span.setAttribute).toHaveBeenCalledWith("rpc.name", "award_attempt");
    expect(span.setStatus).not.toHaveBeenCalled();
    expect(span.end).toHaveBeenCalledTimes(1);
  });

  it("tracedRpc marks the span errored when the result carries an error", async () => {
    await enable();
    const i = spanCount();
    await tele.tracedRpc("buzz_in", {}, () => Promise.resolve({ error: { message: "nope" } }));
    const span = spansFrom(i)[0];
    expect(span.setStatus).toHaveBeenCalledWith({ code: 2 });
    expect(span.end).toHaveBeenCalled();
  });

  it("tracedRpc ends the span and rethrows on rejection", async () => {
    await enable();
    const i = spanCount();
    const err = new Error("io");
    await expect(tele.tracedRpc("buzz_in", {}, () => Promise.reject(err))).rejects.toBe(err);
    const span = spansFrom(i)[0];
    expect(span.setStatus).toHaveBeenCalledWith({ code: 2 });
    expect(span.end).toHaveBeenCalled();
  });

  it("tracedFetch records status and flags non-2xx", async () => {
    await enable();
    const i = spanCount();
    await tele.tracedFetch("POST", "POST /games/:code/bonus", () =>
      Promise.resolve(new Response("err", { status: 500 })),
    );
    const span = spansFrom(i)[0];
    expect(span.setAttribute).toHaveBeenCalledWith("http.status_code", 500);
    expect(span.setStatus).toHaveBeenCalledWith({ code: 2 });
  });

  it("startSongStart runs the parent+children lifecycle and ends every span", async () => {
    await enable();
    const i = spanCount();
    const song = tele.startSongStart({ game_code: "ABC" });
    song.rpcDone({ roundNumber: 3, songId: "s1", youtubeId: "yt" });
    song.loadIssued();
    song.playing("statechange");
    // parent + click_to_rpc + rpc_to_load + load_to_playing = 4 spans, all ended.
    const spans = spansFrom(i);
    expect(spans.length).toBe(4);
    for (const s of spans) expect(s.end).toHaveBeenCalled();
    expect(() => song.playing("poll")).not.toThrow();
  });

  it("startSongStart records the preloaded flag on the parent span", async () => {
    await enable();
    const i = spanCount();
    const song = tele.startSongStart({ game_code: "ABC" });
    song.rpcDone({ roundNumber: 2, songId: "s1", youtubeId: "yt", preloaded: true });
    song.loadIssued();
    song.playing("statechange");
    // The parent span is the first one startSongStart opened.
    const parent = spansFrom(i)[0];
    expect(parent.setAttribute).toHaveBeenCalledWith("preloaded", true);
  });

  it("startSongStart.fail errors the span", async () => {
    await enable();
    const i = spanCount();
    const song = tele.startSongStart({ game_code: "ABC" });
    song.fail("rpc_failed");
    const span = spansFrom(i)[0];
    expect(span.setStatus).toHaveBeenCalledWith({ code: 2 });
    expect(span.end).toHaveBeenCalled();
  });

  it("buzz e2e: mark then resolve ends the span with an outcome", async () => {
    await enable();
    const i = spanCount();
    tele.markBuzzStart("ABC", "team1", 1);
    const span = spansFrom(i)[0];
    tele.resolveBuzzE2E("team1", new Date().toISOString());
    expect(span.setAttribute).toHaveBeenCalledWith("outcome", "won");
    expect(span.end).toHaveBeenCalled();
  });

  it("buzz e2e: a losing team is marked lost_race", async () => {
    await enable();
    const i = spanCount();
    tele.markBuzzStart("ABC", "team1", 1);
    const span = spansFrom(i)[0];
    tele.resolveBuzzE2E("team2", new Date().toISOString());
    expect(span.setAttribute).toHaveBeenCalledWith("outcome", "lost_race");
  });

  it("buzz e2e: failBuzz closes an open span as errored", async () => {
    await enable();
    const i = spanCount();
    tele.markBuzzStart("ABC", "team1");
    const span = spansFrom(i)[0];
    tele.failBuzz("team1");
    expect(span.setStatus).toHaveBeenCalledWith({ code: 2 });
    expect(span.end).toHaveBeenCalled();
  });

  it("score e2e: mark then resolve ends the matching span only", async () => {
    await enable();
    const i = spanCount();
    tele.markScoreStart("ABC", "r1", "title");
    const span = spansFrom(i)[0];
    tele.resolveScoreE2E("r1", new Date().toISOString());
    expect(span.end).toHaveBeenCalled();
    expect(() => tele.resolveScoreE2E("other", new Date().toISOString())).not.toThrow();
  });

  it("score e2e: failScore closes an open span as errored", async () => {
    await enable();
    const i = spanCount();
    tele.markScoreStart("ABC", "r1", "artist");
    const span = spansFrom(i)[0];
    tele.failScore("r1", "artist");
    expect(span.setStatus).toHaveBeenCalledWith({ code: 2 });
    expect(span.end).toHaveBeenCalled();
  });

  it("recordFanout pushes an event; log pushes a log", async () => {
    await enable();
    tele.recordFanout("round", new Date().toISOString());
    expect(h.pushEvent).toHaveBeenLastCalledWith(
      "realtime_fanout",
      expect.objectContaining({ event_type: "round" }),
    );
    tele.log("warn", "hello", { a: "b" });
    expect(h.pushLog).toHaveBeenLastCalledWith(["hello"], { level: "warn", context: { a: "b" } });
  });

  it("startPlayerInit runs api_load → player_ready and ends the spans", async () => {
    await enable();
    const i = spanCount();
    const pi = tele.startPlayerInit();
    pi.apiLoaded(false);
    pi.ready();
    const spans = spansFrom(i);
    expect(spans.length).toBeGreaterThan(0);
    for (const s of spans) expect(s.end).toHaveBeenCalled();
  });

  it("recovers (stays disabled) when initializeFaro throws", async () => {
    h.initializeFaro.mockImplementationOnce(() => {
      throw new Error("init failed");
    });
    h.envMock.VITE_FARO_URL = FARO_URL;
    tele._resetTelemetry();
    await tele.initTelemetry();
    expect(tele.isEnabled()).toBe(false);
  });
});
