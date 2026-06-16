// Latency telemetry — the single place the observability vendor (Grafana Faro
// → Grafana Cloud Tempo/Loki) is wired in. Every other module imports the
// small wrapper API below and never touches Faro directly, so:
//   - call sites stay clean (no span bookkeeping leaking into game logic), and
//   - swapping the vendor later is a one-file change.
//
// Hard contracts every export must honour (the buzzer hot path depends on them):
//   1. No-op when telemetry is disabled (VITE_FARO_URL unset — dev, tests, or a
//      prod build before the collector URL is provisioned).
//   2. Never throw. A telemetry bug must not break a buzz or a score.
//   3. Never block. Callers must not `await` anything here; spans end fire-and-
//      forget on a later tick. Faro batches/exports off the critical path.
//
// Why Faro and not raw OpenTelemetry-web: a Grafana Cloud OTLP *write* token is
// a real credential and cannot ship in the browser bundle. Faro posts to a
// public collector endpoint (app-key in the URL, designed for browser
// exposure) and lands the same data in Tempo (traces) + Loki (logs).

import type { Faro, LogLevel } from "@grafana/faro-web-sdk";
import { env } from "./env";

// Derive the OTel trace/span types straight from Faro's return type so we don't
// take a direct dependency on @opentelemetry/api (it is only a transitive dep).
type FaroOtel = NonNullable<ReturnType<Faro["api"]["getOTEL"]>>;
type Tracer = ReturnType<FaroOtel["trace"]["getTracer"]>;
type Span = ReturnType<Tracer["startSpan"]>;

type AttrValue = string | number | boolean | undefined | null;
type Attributes = Record<string, AttrValue>;

// OTel SpanStatusCode.ERROR === 2. Inlined to avoid importing the enum from the
// transitive @opentelemetry/api package.
const STATUS_ERROR = 2 as const;

// Stable span "op" names. Tempo groups by span name, so keeping these constant
// (never inline a literal at a call site) is what makes p50/p95/p99 queries
// durable. Attributes carry the specifics (game_code, song_id, rpc.name, …).
export const SPAN_OPS = {
  songStart: "game.song_start",
  songClickToRpc: "game.song_start.click_to_rpc",
  songRpcToLoad: "game.song_start.rpc_to_load",
  songLoadToPlaying: "game.song_start.load_to_playing",
  buzzE2e: "game.buzz.e2e",
  scoreE2e: "game.score.e2e",
  rpc: "db.rpc",
  rest: "http.client",
  playerInit: "game.player_init",
} as const;

let faro: Faro | undefined;
let otel: FaroOtel | undefined;
let tracer: Tracer | undefined;
let initStarted = false;
// LogLevel values, captured at init so `log()` doesn't need a static import of
// the (otherwise lazily-loaded) Faro module.
let levels: Record<"info" | "warn" | "error", LogLevel> | undefined;

/** True once Faro has initialized and a tracer is available. */
export function isEnabled(): boolean {
  return tracer !== undefined;
}

/**
 * Initialize Faro once. Safe to call unconditionally on app start: it resolves
 * immediately (no-op) when VITE_FARO_URL is unset or when already initialized.
 * Must never throw — a telemetry init failure cannot take down the app.
 *
 * The Faro SDK is **dynamically imported** so it (~tens of KB) is a lazy chunk
 * fetched off the critical render path, and is never downloaded at all in a
 * build whose collector URL is unset. Returns a promise so tests can await it;
 * production calls it fire-and-forget (`void initTelemetry()`).
 */
export async function initTelemetry(): Promise<void> {
  const url = env.VITE_FARO_URL;
  if (faro || initStarted || !url) return;
  initStarted = true;
  try {
    const sdk = await import("@grafana/faro-web-sdk");
    const { TracingInstrumentation } = await import("@grafana/faro-web-tracing");
    const instance = sdk.initializeFaro({
      url,
      app: {
        name: "sound-clash-web",
        environment: import.meta.env.MODE,
      },
      instrumentations: [
        ...sdk.getWebInstrumentations(),
        // `instrumentations: []` turns OFF auto fetch/XHR patching while keeping
        // the OTel tracer provider + OTLP-over-Faro exporter wired up. We trace
        // the network manually (tracedRpc / tracedFetch) instead. Why fully
        // manual: auto fetch instrumentation injects a W3C `traceparent` header
        // into outgoing requests, which would turn every cross-origin Supabase
        // RPC into a CORS-preflighted call Supabase may reject — unacceptable on
        // the <200ms buzzer path. Manual-only means nothing ever touches the
        // Supabase request, and we still get clean named spans for querying.
        new TracingInstrumentation({ instrumentations: [] }),
      ],
    });
    levels = { info: sdk.LogLevel.INFO, warn: sdk.LogLevel.WARN, error: sdk.LogLevel.ERROR };
    otel = instance.api.getOTEL();
    tracer = otel?.trace.getTracer("sound-clash-web");
    faro = instance;
  } catch {
    // Swallow: telemetry is best-effort and must not affect gameplay.
    faro = undefined;
    otel = undefined;
    tracer = undefined;
    initStarted = false;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function setAttrs(span: Span, attrs: Attributes): void {
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== undefined && v !== null) span.setAttribute(k, v);
  }
}

/** Start a span parented to `parent` (for cross-file, non-callback nesting). */
function startChild(name: string, parent: Span, attrs: Attributes = {}): Span | undefined {
  if (!tracer || !otel) return undefined;
  const ctx = otel.trace.setSpan(otel.context.active(), parent);
  const span = tracer.startSpan(name, undefined, ctx);
  setAttrs(span, attrs);
  return span;
}

/** Milliseconds between a Realtime row's commit and our receipt of the event. */
function fanoutMs(commitTimestamp: string): number | undefined {
  const parsed = Date.parse(commitTimestamp);
  if (Number.isNaN(parsed)) return undefined;
  const delta = Date.now() - parsed;
  // Negative => client clock ahead of server; clamp rather than store garbage.
  return delta < 0 ? 0 : delta;
}

// ---------------------------------------------------------------------------
// Generic wrappers
// ---------------------------------------------------------------------------

/**
 * Wrap a Supabase PostgREST RPC call. Captures one `db.rpc` span (attribute
 * `rpc.name`) covering the network round-trip. PostgREST reports failures in
 * the resolved `{ error }` field rather than throwing, so we mark the span
 * errored when `error` is set. Returns the run() result untouched.
 */
export async function tracedRpc<T extends { error?: unknown }>(
  rpcName: string,
  attrs: Attributes,
  run: () => PromiseLike<T>,
): Promise<T> {
  if (!tracer) return run();
  const span = tracer.startSpan(SPAN_OPS.rpc);
  setAttrs(span, { "rpc.name": rpcName, ...attrs });
  try {
    const result = await run();
    if (result && result.error) span.setStatus({ code: STATUS_ERROR });
    return result;
  } catch (e) {
    span.setStatus({ code: STATUS_ERROR });
    throw e;
  } finally {
    span.end();
  }
}

/** Wrap a REST fetch to our FastAPI backend. One `http.client` span. */
export async function tracedFetch<T extends Response>(
  method: string,
  route: string,
  run: () => Promise<T>,
): Promise<T> {
  if (!tracer) return run();
  const span = tracer.startSpan(SPAN_OPS.rest);
  setAttrs(span, { "http.method": method, "http.route": route });
  try {
    const res = await run();
    setAttrs(span, { "http.status_code": res.status });
    if (!res.ok) span.setStatus({ code: STATUS_ERROR });
    return res;
  } catch (e) {
    span.setStatus({ code: STATUS_ERROR });
    throw e;
  } finally {
    span.end();
  }
}

// ---------------------------------------------------------------------------
// Song-start: click → audio actually playing (the headline "how long did the
// song take to start?"). Parent span with three children. The end-point
// (PLAYING) is detected by YouTubePlayer; see resolveSongStart via the handle.
// ---------------------------------------------------------------------------

export interface SongStartHandle {
  /** Call when select_next_song resolves; supplies the round/song identity. */
  rpcDone(info: { roundNumber?: number; songId?: string; youtubeId?: string }): void;
  /** Call right after loadVideoById is issued to the player. */
  loadIssued(): void;
  /** Call when the player reaches PLAYING (or the load times out). Ends all. */
  playing(detection: "statechange" | "poll" | "timeout"): void;
  /** Call on any error (RPC failure, player error). Ends all, errored. */
  fail(reason: string): void;
}

const INERT_SONG_START: SongStartHandle = {
  rpcDone: () => {},
  loadIssued: () => {},
  playing: () => {},
  fail: () => {},
};

export function startSongStart(attrs: { game_code: string }): SongStartHandle {
  if (!tracer) return INERT_SONG_START;
  const parent = tracer.startSpan(SPAN_OPS.songStart);
  setAttrs(parent, attrs);
  let child = startChild(SPAN_OPS.songClickToRpc, parent);
  let done = false;

  const closeChild = (): void => {
    child?.end();
    child = undefined;
  };

  return {
    rpcDone(info) {
      if (done) return;
      setAttrs(parent, {
        round_number: info.roundNumber,
        song_id: info.songId,
        youtube_id: info.youtubeId,
      });
      closeChild();
      child = startChild(SPAN_OPS.songRpcToLoad, parent);
    },
    loadIssued() {
      if (done) return;
      closeChild();
      child = startChild(SPAN_OPS.songLoadToPlaying, parent);
    },
    playing(detection) {
      if (done) return;
      done = true;
      closeChild();
      setAttrs(parent, { playing_detection: detection });
      if (detection === "timeout") parent.setStatus({ code: STATUS_ERROR });
      parent.end();
    },
    fail(reason) {
      if (done) return;
      done = true;
      closeChild();
      setAttrs(parent, { error_reason: reason });
      parent.setStatus({ code: STATUS_ERROR });
      parent.end();
    },
  };
}

// ---------------------------------------------------------------------------
// Buzz e2e: pointerdown → this client observes the buzz lock in Realtime. The
// start is marked in useBuzzer (it has the game context); the end is resolved
// in useGameChannel when active_games.buzzed_team_id transitions to set. Keyed
// by the local team's id — at most one open span per client.
// ---------------------------------------------------------------------------

const buzzSpans = new Map<string, Span>();

export function markBuzzStart(gameCode: string, teamId: string, roundNumber?: number): void {
  if (!tracer) return;
  buzzSpans.get(teamId)?.end(); // defensive: close a prior unresolved span
  const span = tracer.startSpan(SPAN_OPS.buzzE2e);
  setAttrs(span, { game_code: gameCode, team_id: teamId, round_number: roundNumber });
  buzzSpans.set(teamId, span);
}

export function resolveBuzzE2E(buzzedTeamId: string, commitTimestamp: string): void {
  if (buzzSpans.size === 0) return;
  const lag = fanoutMs(commitTimestamp);
  for (const [teamId, span] of buzzSpans) {
    setAttrs(span, {
      outcome: teamId === buzzedTeamId ? "won" : "lost_race",
      "realtime.fanout_ms": lag,
    });
    span.end();
  }
  buzzSpans.clear();
}

/** Close an open buzz span when the RPC itself failed (no lock will arrive). */
export function failBuzz(teamId: string): void {
  const span = buzzSpans.get(teamId);
  if (!span) return;
  setAttrs(span, { outcome: "error" });
  span.setStatus({ code: STATUS_ERROR });
  span.end();
  buzzSpans.delete(teamId);
}

// ---------------------------------------------------------------------------
// Score e2e: scoring click → ROUND_CHANGE for that round arrives in Realtime.
// Keyed by `${roundId}:${verdict}` so concurrent verdicts don't collide.
// ---------------------------------------------------------------------------

const scoreSpans = new Map<string, Span>();

export function markScoreStart(gameCode: string, roundId: string, verdict: string): void {
  if (!tracer) return;
  const key = `${roundId}:${verdict}`;
  scoreSpans.get(key)?.end();
  const span = tracer.startSpan(SPAN_OPS.scoreE2e);
  setAttrs(span, { game_code: gameCode, round_id: roundId, verdict });
  scoreSpans.set(key, span);
}

export function resolveScoreE2E(roundId: string, commitTimestamp: string): void {
  if (scoreSpans.size === 0) return;
  const lag = fanoutMs(commitTimestamp);
  for (const [key, span] of scoreSpans) {
    if (!key.startsWith(`${roundId}:`)) continue;
    setAttrs(span, { "realtime.fanout_ms": lag });
    span.end();
    scoreSpans.delete(key);
  }
}

/** Close an open score span when the RPC failed (no ROUND_CHANGE will arrive). */
export function failScore(roundId: string, verdict: string): void {
  const key = `${roundId}:${verdict}`;
  const span = scoreSpans.get(key);
  if (!span) return;
  span.setStatus({ code: STATUS_ERROR });
  span.end();
  scoreSpans.delete(key);
}

// ---------------------------------------------------------------------------
// Realtime fan-out lag, per event type — the cheapest, backend-free signal of
// Supabase Realtime health. Pushed as a Faro event (queryable in Loki).
// ---------------------------------------------------------------------------

export function recordFanout(eventType: "game" | "team" | "round", commitTimestamp: string): void {
  if (!faro) return;
  const lag = fanoutMs(commitTimestamp);
  if (lag === undefined) return;
  try {
    faro.api.pushEvent("realtime_fanout", { event_type: eventType, fanout_ms: String(lag) });
  } catch {
    // best-effort
  }
}

// ---------------------------------------------------------------------------
// YouTube player init: mount → first onReady. One span per page load.
// ---------------------------------------------------------------------------

export interface PlayerInitHandle {
  apiLoaded(apiCached: boolean): void;
  ready(): void;
}

const INERT_PLAYER_INIT: PlayerInitHandle = { apiLoaded: () => {}, ready: () => {} };

export function startPlayerInit(): PlayerInitHandle {
  if (!tracer) return INERT_PLAYER_INIT;
  const parent = tracer.startSpan(SPAN_OPS.playerInit);
  let child = startChild("game.player_init.api_load", parent);
  let done = false;
  return {
    apiLoaded(apiCached) {
      if (done) return;
      setAttrs(parent, { api_cached: apiCached });
      child?.end();
      child = startChild("game.player_init.player_ready", parent);
    },
    ready() {
      if (done) return;
      done = true;
      child?.end();
      parent.end();
    },
  };
}

// ---------------------------------------------------------------------------
// Structured logs → Loki. Use sparingly, never on the buzzer path.
// ---------------------------------------------------------------------------

export function log(
  level: "info" | "warn" | "error",
  message: string,
  context?: Record<string, string>,
): void {
  if (!faro || !levels) return;
  try {
    faro.api.pushLog([message], { level: levels[level], context });
  } catch {
    // best-effort
  }
}

// Test-only: reset module state between tests.
export function _resetTelemetry(): void {
  faro = undefined;
  otel = undefined;
  tracer = undefined;
  levels = undefined;
  initStarted = false;
  buzzSpans.clear();
  scoreSpans.clear();
}
